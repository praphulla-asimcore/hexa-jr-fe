const express = require('express');
const jwt = require('jsonwebtoken');
const { postJournalEntry } = require('../services/zoho');
const { getDb } = require('../services/db');
const { sendJournalNotification } = require('../services/email');
const orgs = require('../config/orgs.json');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'hexa-jwt-secret-change-in-prod';

function getUser(req) {
  try {
    const raw = req.headers['x-auth-token'];
    if (!raw) return null;
    return jwt.verify(raw, JWT_SECRET);
  } catch {
    return null;
  }
}

router.post('/', async (req, res) => {
  const { sheetName, journalDate, referenceNumber, notes, lineItems, module: mod = 'csi' } = req.body;

  if (!sheetName || !journalDate || !lineItems || lineItems.length === 0) {
    return res.status(400).json({ error: 'Missing required fields: sheetName, journalDate, lineItems.' });
  }

  const orgEntry = orgs[sheetName];
  const orgId = orgEntry?.id;
  if (!orgId) {
    return res.status(400).json({ error: `No Zoho org ID mapped for entity "${sheetName}". Update server/config/orgs.json.` });
  }

  const totalDebit = lineItems.filter((l) => l.debit_or_credit === 'debit').reduce((s, l) => s + l.amount, 0);
  const totalCredit = lineItems.filter((l) => l.debit_or_credit === 'credit').reduce((s, l) => s + l.amount, 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(422).json({ error: `Debits (${totalDebit.toFixed(2)}) do not equal credits (${totalCredit.toFixed(2)}).` });
  }

  const round2 = (n) => Math.round(parseFloat(n) * 100) / 100;

  const zohoLineItems = lineItems.map((l) => ({
    account_id: l.account_id,
    debit_or_credit: l.debit_or_credit,
    amount: round2(l.amount),
    description: l.description,
  }));

  const payload = {
    journal_date: journalDate,
    reference_number: referenceNumber,
    notes,
    line_items: zohoLineItems,
  };

  try {
    const journal = await postJournalEntry(orgId, payload);
    const user = getUser(req);

    const postedByEmail = user?.email || 'unknown';
    const postedByName = user?.name || 'Unknown User';
    const totalAmount = round2(totalDebit);

    // Record to Supabase (fire-and-forget)
    const db = getDb();
    if (db) {
      db.from('journal_posts').insert({
        module: mod,
        entity: sheetName,
        org_id: orgId,
        journal_id: journal?.journal_id,
        reference_number: journal?.reference_number || referenceNumber,
        journal_date: journalDate,
        total_amount: totalAmount,
        notes,
        posted_by_email: postedByEmail,
        posted_by_name: postedByName,
      }).then(() => {}).catch(() => {});
    }

    // Send email notifications (fire-and-forget)
    if (db) {
      db.from('users').select('email').eq('status', 'active').then(({ data }) => {
        const recipients = (data || []).map((u) => u.email).filter(Boolean);
        if (recipients.length) {
          sendJournalNotification({
            postedByName,
            postedByEmail,
            module: mod,
            entity: sheetName,
            referenceNumber: journal?.reference_number || referenceNumber,
            journalDate,
            amount: totalAmount,
            recipients,
          }).catch(() => {});
        }
      }).catch(() => {});
    }

    res.json({ journalId: journal?.journal_id, referenceNumber: journal?.reference_number });
  } catch (err) {
    console.error('Post JE error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
