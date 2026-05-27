const express = require('express');
const { postJournalEntry } = require('../services/zoho');
const orgs = require('../config/orgs.json');

const router = express.Router();

router.post('/', async (req, res) => {
  const { sheetName, journalDate, referenceNumber, notes, lineItems } = req.body;

  if (!sheetName || !journalDate || !lineItems || lineItems.length === 0) {
    return res.status(400).json({ error: 'Missing required fields: sheetName, journalDate, lineItems.' });
  }

  const orgId = orgs[sheetName];
  if (!orgId || orgId === 'ZOHO_ORG_ID_HERE') {
    return res.status(400).json({ error: `No Zoho org ID mapped for entity "${sheetName}". Update server/config/orgs.json.` });
  }

  const totalDebit = lineItems.filter((l) => l.debit_or_credit === 'debit').reduce((s, l) => s + l.amount, 0);
  const totalCredit = lineItems.filter((l) => l.debit_or_credit === 'credit').reduce((s, l) => s + l.amount, 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(422).json({ error: `Debits (${totalDebit.toFixed(2)}) do not equal credits (${totalCredit.toFixed(2)}).` });
  }

  const zohoLineItems = lineItems.map((l) => ({
    account_id: l.account_id,
    ...(l.debit_or_credit === 'debit' ? { debit_amount: l.amount } : { credit_amount: l.amount }),
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
    res.json({ journalId: journal.journal_id, referenceNumber: journal.reference_number });
  } catch (err) {
    console.error('Post JE error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
