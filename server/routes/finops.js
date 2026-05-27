const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { getDb } = require('../services/db');
const { sendPirApprovalEmail } = require('../services/email');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'hexa-jwt-secret-change-in-prod';

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.includes('spreadsheet') ||
      file.originalname.endsWith('.xlsx') ||
      file.originalname.endsWith('.xls') ||
      file.originalname.endsWith('.csv');
    cb(null, ok);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

function getUser(req) {
  try {
    const raw = req.headers['x-auth-token'];
    if (!raw) return null;
    return jwt.verify(raw, JWT_SECRET);
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required.' });
  req.user = user;
  next();
}

// POST /api/finops/parse-beneficiary — parse uploaded beneficiary master Excel
router.post('/parse-beneficiary', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (rows.length < 2) return res.status(422).json({ error: 'File has no data rows.' });

    // Detect header row (first row with "Name" or "Consultant Name")
    const header = rows[0].map((c) => String(c).trim().toLowerCase());
    const col = (names) => {
      for (const n of names) {
        const idx = header.findIndex((h) => h.includes(n));
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const iName    = col(['consultant name', 'name', 'beneficiary name']);
    const iMode    = col(['payment mode', 'mode']);
    const iFavCode = col(['fav bene', 'favourite', 'beneficiary code']);
    const iAcct    = col(['account number', 'account no', 'credit account']);
    const iBank    = col(['bank code']);
    const iIdNum   = col(['id number', 'ic', 'passport', 'nric', 'id no']);
    const iIdType  = col(['id type', 'id_type']);
    const iEmail   = col(['email']);
    const iAdvice  = col(['advice prefix', 'advice', 'description prefix']);

    if (iName < 0 || iAcct < 0) {
      return res.status(422).json({ error: 'Could not find required columns: Name and Account Number.' });
    }

    const beneficiaries = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[iName] || '').trim();
      if (!name) continue;
      beneficiaries.push({
        beneficiaryName: name,
        paymentMode:     String(r[iMode] || 'IT').trim().toUpperCase(),
        favBeneCode:     iAdvice >= 0 ? String(r[iFavCode] || '').trim() : '',
        accountNumber:   String(r[iAcct] || '').trim(),
        bankCode:        iBank >= 0 ? String(r[iBank] || '').trim() : '',
        idNumber:        iIdNum >= 0 ? String(r[iIdNum] || '').trim() : '',
        idType:          iIdType >= 0 ? String(r[iIdType] || 'ic').trim().toLowerCase() : 'ic',
        email:           iEmail >= 0 ? String(r[iEmail] || '').trim() : '',
        advicePrefix:    iAdvice >= 0 ? String(r[iAdvice] || '').trim() : name,
      });
    }

    if (!beneficiaries.length) return res.status(422).json({ error: 'No data rows found.' });
    res.json({ beneficiaries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/finops/save-pir
router.post('/save-pir', requireAuth, async (req, res) => {
  const { pirData, reviewerEmail, approverEmail } = req.body;
  if (!pirData?.payoutDate) return res.status(400).json({ error: 'pirData with payoutDate required.' });

  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const token = crypto.randomBytes(32).toString('hex');

  const { data, error } = await db.from('pir_approvals').insert({
    payout_date:       pirData.payoutDate,
    total_amount:      pirData.grandTotal,
    pir_data:          pirData,
    approval_status:   'pending',
    reviewer_email:    reviewerEmail || null,
    approver_email:    approverEmail || null,
    approval_token:    token,
    created_by_email:  req.user.email,
    created_by_name:   req.user.name || req.user.email,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ id: data.id, token });
});

// POST /api/finops/send-approval-email
router.post('/send-approval-email', requireAuth, async (req, res) => {
  const { pirId } = req.body;
  if (!pirId) return res.status(400).json({ error: 'pirId required.' });

  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: pir, error } = await db.from('pir_approvals').select('*').eq('id', pirId).single();
  if (error || !pir) return res.status(404).json({ error: 'PIR record not found.' });

  const appUrl = process.env.APP_URL || 'https://hexajrfe.hexamatics.finance';
  const approveUrl = `${appUrl}/api/finops/action?token=${pir.approval_token}&action=approve`;
  const rejectUrl  = `${appUrl}/api/finops/action?token=${pir.approval_token}&action=reject`;

  const recipients = [pir.reviewer_email, pir.approver_email].filter(Boolean);
  if (!recipients.length) return res.status(400).json({ error: 'No reviewer or approver email configured.' });

  try {
    await sendPirApprovalEmail({
      recipients,
      pir,
      approveUrl,
      rejectUrl,
      createdBy: req.user.name || req.user.email,
    });
    await db.from('pir_approvals').update({ email_sent_at: new Date().toISOString() }).eq('id', pirId);
    res.json({ sent: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/finops/action?token=xxx&action=approve|reject — email link handler
router.get('/action', async (req, res) => {
  const { token, action } = req.query;
  if (!token || !['approve', 'reject'].includes(action)) {
    return res.status(400).send(htmlPage('Invalid link.', '#ef4444', 'The link is invalid or missing parameters.'));
  }

  const db = getDb();
  if (!db) return res.status(503).send(htmlPage('Unavailable', '#ef4444', 'Service temporarily unavailable.'));

  const { data: pir } = await db.from('pir_approvals').select('*').eq('approval_token', token).single();
  if (!pir) return res.status(404).send(htmlPage('Not Found', '#ef4444', 'This PIR record was not found or the link has expired.'));

  if (pir.approval_status !== 'pending') {
    const color = pir.approval_status === 'approved' ? '#22c55e' : '#ef4444';
    return res.send(htmlPage(`Already ${pir.approval_status}`, color, `This PIR was already ${pir.approval_status}. No further action needed.`));
  }

  const status = action === 'approve' ? 'approved' : 'rejected';
  await db.from('pir_approvals').update({
    approval_status: status,
    approved_at:     new Date().toISOString(),
    approved_by:     'email-link',
  }).eq('id', pir.id);

  const color = status === 'approved' ? '#22c55e' : '#ef4444';
  res.send(htmlPage(
    status === 'approved' ? 'PIR Approved' : 'PIR Rejected',
    color,
    `Payout Date: ${pir.payout_date} · Total: RM ${Number(pir.total_amount).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`
  ));
});

function htmlPage(title, color, subtitle) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;background:#f8fafc">
    <div style="max-width:440px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
      <div style="width:60px;height:60px;border-radius:50%;background:${color}22;margin:0 auto 20px;display:flex;align-items:center;justify-content:center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h2 style="color:${color};margin:0 0 8px">${title}</h2>
      <p style="color:#64748b;margin:0 0 24px">${subtitle}</p>
      <p style="color:#94a3b8;font-size:13px">You can close this window.</p>
    </div>
  </body></html>`;
}

// POST /api/finops/set-status — manual approve/reject from app
router.post('/set-status', requireAuth, async (req, res) => {
  const { pirId, status } = req.body;
  if (!pirId || !['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'pirId and status (approved|rejected|pending) required.' });
  }

  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  await db.from('pir_approvals').update({
    approval_status: status,
    approved_at:     status !== 'pending' ? new Date().toISOString() : null,
    approved_by:     status !== 'pending' ? req.user.email : null,
  }).eq('id', pirId);

  res.json({ updated: true });
});

// GET /api/finops/pir-status/:id
router.get('/pir-status/:id', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.json({ approval_status: 'pending' });
  const { data } = await db.from('pir_approvals')
    .select('id, approval_status, approved_at, approved_by, email_sent_at')
    .eq('id', req.params.id).single();
  res.json(data || { approval_status: 'pending' });
});

// GET /api/finops/history
router.get('/history', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.json({ approvals: [] });
  const { data } = await db.from('pir_approvals')
    .select('id, payout_date, total_amount, approval_status, created_by_name, created_at, email_sent_at, approved_at')
    .order('created_at', { ascending: false })
    .limit(50);
  res.json({ approvals: data || [] });
});

// POST /api/finops/generate-bank-report — stream Bank Report XLSX
router.post('/generate-bank-report', requireAuth, (req, res) => {
  const { beneficiaryData, payoutDate, startRefNumber = 100 } = req.body;
  if (!beneficiaryData?.length || !payoutDate) {
    return res.status(400).json({ error: 'beneficiaryData and payoutDate required.' });
  }

  const [year, month, day] = payoutDate.split('-');
  const valueDate = `${day}${month}${year}`;
  const mmyy = `${month}${year.slice(2)}`;
  const debitAccount = process.env.BANK_DEBIT_ACCOUNT || '';
  const notifyEmails = (process.env.BANK_NOTIFY_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean);

  const headers = [
    'Payment Mode', 'Value Date', 'Customer Reference Number', 'Favourite Beneficiary Code',
    'Transaction Amount (RM)', 'Credit Account Number', 'Beneficiary Name 1', 'Beneficiary Name 2',
    'Beneficiary Name 3', 'New IC No', 'Old IC No', 'Business Registration Number',
    'Police/ Army ID/ Passport No', 'Beneficiary Bank Code', 'Email', 'Advice Detail',
    'Debit \r\nDescription', 'Credit \r\nDescription', 'Joint Name', 'Joint New ID No',
    'Joint Old ID No', 'Joint Business Reg. No.', 'Joint Police/ Army ID/ Passport No.',
    'Purpose of Transfer', 'Others  Purpose of Transfer', 'Rentas Instruction to Bank',
    'Charges Borne by', 'Email 2', 'Email 3', 'Email 4', 'Email 5',
  ];

  const rows = [headers];
  let ref = startRefNumber;

  for (const b of beneficiaryData) {
    const advice = `${b.advicePrefix || b.beneficiaryName}_${mmyy}`;
    const row = new Array(31).fill('');
    row[0]  = b.paymentMode || 'IT';
    row[1]  = valueDate;
    row[2]  = ref;
    row[3]  = b.favBeneCode || '';
    row[4]  = parseFloat(b.amount) || 0;
    row[5]  = b.accountNumber || '';
    row[6]  = b.beneficiaryName || '';
    if (b.idType === 'ic')       row[9]  = b.idNumber || '';
    else if (b.idType === 'old_ic') row[10] = b.idNumber || '';
    else if (b.idType === 'brn')    row[11] = b.idNumber || '';
    else if (b.idType === 'passport') row[12] = b.idNumber || '';
    row[13] = b.bankCode || '';
    row[14] = b.email || notifyEmails[0] || '';
    row[15] = advice;
    row[16] = advice;
    row[17] = advice;
    if (notifyEmails[1]) row[28] = notifyEmails[1];
    if (notifyEmails[2]) row[29] = notifyEmails[2];
    rows.push(row);
    ref++;
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, `Bank Report ${valueDate}_CSI`);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Bank_Report_CSI_${valueDate}.xlsx"`);
  res.send(buf);
});

// POST /api/finops/generate-bank-txt — generate RCgen TXT
router.post('/generate-bank-txt', requireAuth, (req, res) => {
  const { beneficiaryData, payoutDate, startRefNumber = 100 } = req.body;
  if (!beneficiaryData?.length || !payoutDate) {
    return res.status(400).json({ error: 'beneficiaryData and payoutDate required.' });
  }

  const [year, month, day] = payoutDate.split('-');
  const valueDate = `${day}${month}${year}`;
  const mmyy = `${month}${year.slice(2)}`;

  const corporateId  = process.env.BANK_CORPORATE_ID || 'MYMHEXAMATI';
  const groupId      = process.env.BANK_GROUP_ID || 'MYMHEXA1D';
  const debitAccount = process.env.BANK_DEBIT_ACCOUNT || '';
  const notifyEmails = (process.env.BANK_NOTIFY_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean);

  const now = new Date();
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  // 00 header — security key left blank (RCGEN2 proprietary; test with bank if accepted)
  const lines = [`00|${corporateId}|${groupId}||B||||||||||||||||||||||||`];

  let ref = startRefNumber;
  for (const b of beneficiaryData) {
    const advice = `${b.advicePrefix || b.beneficiaryName}_${mmyy}`;
    const amount = parseFloat(b.amount || 0).toFixed(2);
    const payMode = b.paymentMode || 'IT';

    let icFields = '||||';
    if (b.idType === 'ic')        icFields = `${b.idNumber}|||`;
    else if (b.idType === 'old_ic') icFields = `|${b.idNumber}||`;
    else if (b.idType === 'brn')    icFields = `||${b.idNumber}|`;
    else if (b.idType === 'passport') icFields = `|||${b.idNumber}`;

    const e1 = notifyEmails[0] || '';
    const e2 = notifyEmails[1] || '';
    const e3 = notifyEmails[2] || '';

    // 01 record (transaction)
    const empty = '|'.repeat(200);
    lines.push(
      `01|${payMode}|Domestic Payments (MY)||${valueDate}|||${ref}||${advice}|MYR|${amount}|Y|MYR|${debitAccount}|${b.accountNumber || ''}|${b.favBeneCode || ''}||Y|${b.beneficiaryName || ''}||||${icFields}|${b.bankCode || ''}||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||${advice}|||||||01${empty}`
    );
    // 02 record (email advice)
    lines.push(`02|PA|${ref}|${e1}|||${advice}|||||||${amount}|||||||${e2}|${e3}||||||||||||||||||`);

    ref++;
  }

  const filename = `RCgen_Payment_DP_${ts}.txt`;
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lines.join('\n'));
});

function pad(n) { return String(n).padStart(2, '0'); }

module.exports = router;
