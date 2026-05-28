const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');
const { Resend } = require('resend');
const { getDb } = require('../services/db');
const { parseExcelBuffer } = require('../services/parser');
const { postJournalEntry } = require('../services/zoho');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'hexa-jwt-secret-change-in-prod';
const APP_URL = process.env.APP_URL || 'https://hexajrfe.hexamatics.finance';
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@hexamatics.finance';

const APPROVERS = {
  reviewer: { name: 'Asim Subedi', email: 'asim.ovc977@gmail.com' },
  final:    { name: 'Praphulla Subedi', email: 'praphulla@hexamatics.com' },
  director: { name: 'Dato Thiruchelvapalan', email: 'thiruchelvapalan@hexamatics.com' },
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.includes('spreadsheet') ||
      file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls');
    cb(null, ok);
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

const anyFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Auth ────────────────────────────────────────────────────────────────────

function getUser(req) {
  try {
    const raw = req.headers['x-auth-token'];
    if (!raw) return null;
    return jwt.verify(raw, JWT_SECRET);
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Authentication required.' });
  req.user = u;
  next();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getResend() {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
}

function round2(n) { return Math.round(parseFloat(n) * 100) / 100; }

async function auditLog(db, caseId, eventType, by, userId, ip, meta) {
  try {
    await db.from('payroll_audit_log').insert({
      case_id: caseId, event_type: eventType, performed_by: by,
      user_id: userId, ip_address: ip, metadata: meta,
    });
  } catch (_) {}
}

async function generateRef(db, type, entity, period) {
  const { count } = await db.from('payroll_cases')
    .select('id', { count: 'exact', head: true })
    .eq('type', type).eq('entity', entity).eq('period', period);
  const seqNo = (count || 0) + 1;
  return { ref: `${type}-${entity}-${period}-${String(seqNo).padStart(3, '0')}`, seqNo };
}

function buildCheckData(entities) {
  const flags = [];
  let consultants = 0, gross = 0, ctc = 0, net = 0;
  const stat = { epf: 0, eis: 0, socso: 0, hrdf: 0, mtd: 0 };

  for (const ent of entities) {
    consultants += ent.employees.length;
    for (const emp of ent.employees) {
      gross += emp.grossSalary; ctc += emp.ctcHexa; net += emp.netSalary;
      stat.epf += emp.epfEmployer; stat.eis += emp.eisEmployer;
      stat.socso += emp.socsoEmployer; stat.hrdf += emp.hrdf; stat.mtd += emp.mtd;

      const expectedCTC = emp.grossSalary + emp.epfEmployer + emp.eisEmployer + emp.socsoEmployer + emp.hrdf;
      if (Math.abs(emp.ctcHexa - expectedCTC) > 0.01) {
        flags.push({ code: 'CTC_VARIANCE', employee: emp.name || emp.employeeId, entity: ent.sheetName,
          expected: round2(expectedCTC), actual: emp.ctcHexa, diff: round2(Math.abs(emp.ctcHexa - expectedCTC)) });
      }
      if (emp.netSalary === 0) flags.push({ code: 'ZERO_NET', employee: emp.name, entity: ent.sheetName });
    }
    if (ent.missingColumns?.length) flags.push({ code: 'MISSING_COLUMNS', entity: ent.sheetName, columns: ent.missingColumns });
  }

  return {
    consultantCount: consultants, entityCount: entities.length,
    grossPayrollTotal: round2(gross), ctcTotal: round2(ctc), netSalaryTotal: round2(net),
    statutory: { epf: round2(stat.epf), eis: round2(stat.eis), socso: round2(stat.socso), hrdf: round2(stat.hrdf), mtd: round2(stat.mtd) },
    flagCount: flags.length, flags,
    generatedAt: new Date().toISOString(), generatedBy: 'Hexa Check Engine v1.0',
  };
}

// ─── Email helpers ────────────────────────────────────────────────────────────

const logoImg = `<img src="https://hexajrfe.hexamatics.finance/hexa-logo.png" alt="Hexa" style="height:28px;margin-bottom:24px"/>`;
const emailWrap = (body) => `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">${logoImg}${body}<p style="color:#999;font-size:12px;margin-top:32px">Hexa Finance · hexamatics.finance · Do not forward this link.</p></div>`;

function fmtRM(n) { return `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`; }

function tableRow(k, v) { return `<tr><td style="padding:6px 0;color:#888;width:170px">${k}</td><td style="color:#111;font-weight:600">${v}</td></tr>`; }

async function emailCheckApproval(resend, { to, name, role, kase, approveUrl, rejectUrl, check }) {
  if (!resend) return;
  const label = kase.type === 'CSI' ? 'CSI Payroll' : 'Internal Payroll';
  await resend.emails.send({
    from: EMAIL_FROM, to,
    subject: `[Hexa Finance] ${label} Check — ${role} Required | ${kase.reference}`,
    html: emailWrap(`
      <h2 style="font-size:18px;font-weight:700;color:#111;margin:0 0 4px">Check File Approval — ${role}</h2>
      <p style="color:#555;margin:0 0 20px">Hi ${name}, you are assigned as <strong>${role}</strong> for the following payroll run.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
        ${tableRow('Reference', `<span style="color:#6366f1">${kase.reference}</span>`)}
        ${tableRow('Type', label)}
        ${tableRow('Entity', kase.entity_name || kase.entity)}
        ${tableRow('Period', kase.period)}
        ${tableRow('Consultants', check.consultantCount)}
        ${tableRow('Gross Payroll', fmtRM(check.grossPayrollTotal))}
        ${tableRow('Total CTC', fmtRM(check.ctcTotal))}
        ${tableRow('Exceptions', `<span style="color:${check.flagCount > 0 ? '#ef4444' : '#22c55e'}">${check.flagCount} flag(s)</span>`)}
      </table>
      ${check.flagCount > 0 ? `<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#991b1b">
        ${check.flags.slice(0, 5).map(f => `<div>⚠ ${f.code}${f.employee ? ` — ${f.employee}` : ''}</div>`).join('')}
        ${check.flagCount > 5 ? `<div>...and ${check.flagCount - 5} more</div>` : ''}
      </div>` : ''}
      <div style="margin-bottom:24px">
        <a href="${approveUrl}" style="display:inline-block;background:#22c55e;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-right:12px">Approve</a>
        <a href="${rejectUrl}" style="display:inline-block;background:#ef4444;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Reject</a>
      </div>`),
  });
}

async function emailPaymentApproval(resend, { kase, check, approveUrl, rejectUrl }) {
  if (!resend) return;
  const dir = APPROVERS.director;
  const label = kase.type === 'CSI' ? 'CSI Payroll' : 'Internal Payroll';
  await resend.emails.send({
    from: EMAIL_FROM, to: dir.email,
    subject: `[Hexa Finance] Payment Approval Required | ${kase.reference} | ${fmtRM(check.ctcTotal)}`,
    html: emailWrap(`
      <h2 style="font-size:18px;font-weight:700;color:#111;margin:0 0 4px">Payment Approval Required</h2>
      <p style="color:#555;margin:0 0 20px">Hi ${dir.name}, the following payroll run has been approved and uploaded to the bank portal. Your payment approval is required.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
        ${tableRow('Reference', `<span style="color:#6366f1">${kase.reference}</span>`)}
        ${tableRow('Type', label)}
        ${tableRow('Entity', kase.entity_name || kase.entity)}
        ${tableRow('Period', kase.period)}
        ${tableRow('Consultants', check.consultantCount)}
        ${tableRow('Gross Payroll', fmtRM(check.grossPayrollTotal))}
        ${tableRow('Total CTC', `<strong style="font-size:16px">${fmtRM(check.ctcTotal)}</strong>`)}
        ${tableRow('Bank Portal Ref', kase.bank_portal_ref || '—')}
        ${tableRow('Check Approved by', kase.check_final_approver_name || '—')}
        ${tableRow('Reviewed by', kase.check_reviewer_name || '—')}
      </table>
      <p style="color:#555;font-size:14px;margin-bottom:20px">This payroll has passed both the internal check gate and has been uploaded to the bank. Bank confirmation reference: <strong>${kase.bank_portal_ref || 'see attached'}</strong>.</p>
      <div style="margin-bottom:24px">
        <a href="${approveUrl}" style="display:inline-block;background:#22c55e;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin-right:12px">Approve Payment</a>
        <a href="${rejectUrl}" style="display:inline-block;background:#ef4444;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Reject</a>
      </div>`),
  });
}

async function emailNotify(resend, { to, kase, title, body }) {
  if (!resend || !to) return;
  await resend.emails.send({
    from: EMAIL_FROM, to,
    subject: `[Hexa Finance] ${title} | ${kase.reference}`,
    html: emailWrap(`<h2 style="font-size:18px;font-weight:700;color:#111;margin:0 0 8px">${title}</h2><p style="color:#555;margin:0 0 12px">${body}</p><p style="color:#888;font-size:13px">Reference: <strong>${kase.reference}</strong></p>`),
  });
}

function approvalPage(title, color, msg) {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="font-family:Inter,sans-serif;padding:40px;background:#f8fafc">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.08);text-align:center">
      <div style="width:64px;height:64px;border-radius:50%;background:${color}22;margin:0 auto 20px;display:flex;align-items:center;justify-content:center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h2 style="color:${color};margin:0 0 8px">${title}</h2>
      <p style="color:#64748b;margin:0 0 24px">${msg}</p>
      <p style="color:#94a3b8;font-size:13px">You may close this window.</p>
    </div>
  </body></html>`;
}

// ─── Step 1: Upload ───────────────────────────────────────────────────────────

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { type = 'CSI', entity, entityName, period, paymentDate } = req.body;
  if (!entity || !period) return res.status(400).json({ error: 'entity and period are required.' });
  if (!/^\d{6}$/.test(period)) return res.status(400).json({ error: 'period must be YYYYMM (e.g. 202506).' });
  if (!['CSI', 'PAYROLL'].includes(type.toUpperCase())) return res.status(400).json({ error: 'type must be CSI or PAYROLL.' });

  let parsedEntities;
  try {
    parsedEntities = parseExcelBuffer(req.file.buffer);
  } catch (err) {
    return res.status(422).json({ error: `Parse error: ${err.message}` });
  }
  if (!parsedEntities.length) return res.status(422).json({ error: 'No valid data found in file. Check column headers.' });

  const fileHash = sha256(req.file.buffer);
  const ip = getIp(req);
  const typeUp = type.toUpperCase();
  const entityCode = entity.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

  const { ref, seqNo } = await generateRef(db, typeUp, entityCode, period);

  const { data: kase, error } = await db.from('payroll_cases').insert({
    reference: ref, type: typeUp, entity: entityCode,
    entity_name: entityName || parsedEntities[0]?.sheetName || entityCode,
    period, seq_no: seqNo, status: 'uploaded',
    original_file_name: req.file.originalname,
    original_file_hash: fileHash,
    parsed_data: { entities: parsedEntities },
    uploaded_by_id: String(req.user.id || ''),
    uploaded_by_name: req.user.name || req.user.email,
    uploaded_by_email: req.user.email,
    uploaded_at: new Date().toISOString(), upload_ip: ip,
    payment_date: paymentDate || null,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  await auditLog(db, kase.id, 'UPLOAD', req.user.name || req.user.email, String(req.user.id || ''), ip, {
    fileName: req.file.originalname, fileHash,
    stamp: `Uploaded by: ${req.user.name} | Date-Time: ${new Date().toISOString()} | IP: ${ip} | File Hash: ${fileHash}`,
    entityCount: parsedEntities.length,
    consultantCount: parsedEntities.reduce((s, e) => s + e.employees.length, 0),
  });

  res.json({ case: kase });
});

// ─── Step 2: Generate check file ─────────────────────────────────────────────

router.post('/:id/gen-check', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: kase } = await db.from('payroll_cases').select('*').eq('id', req.params.id).single();
  if (!kase) return res.status(404).json({ error: 'Case not found.' });
  if (kase.status !== 'uploaded') return res.status(409).json({ error: `Cannot generate check from status: ${kase.status}` });

  const checkData = buildCheckData(kase.parsed_data?.entities || []);
  const now = new Date().toISOString();

  const { data: updated } = await db.from('payroll_cases').update({
    status: 'check_generated', check_data: checkData, check_generated_at: now,
  }).eq('id', kase.id).select().single();

  await auditLog(db, kase.id, 'CHECK_GENERATED', req.user.name || req.user.email, String(req.user.id || ''), getIp(req), {
    stamp: `Generated by: Hexa Check Engine | Ref: ${kase.reference} | Generated: ${now}`,
    consultantCount: checkData.consultantCount, ctcTotal: checkData.ctcTotal, flagCount: checkData.flagCount,
  });

  res.json({ case: updated });
});

// ─── Step 3a: Send check approval email to reviewer ───────────────────────────

router.post('/:id/send-check-approval', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: kase } = await db.from('payroll_cases').select('*').eq('id', req.params.id).single();
  if (!kase) return res.status(404).json({ error: 'Case not found.' });
  if (kase.status !== 'check_generated') return res.status(409).json({ error: `Cannot send approval from status: ${kase.status}` });

  const token = crypto.randomBytes(32).toString('hex');
  await db.from('payroll_approval_tokens').insert({
    case_id: kase.id, step: 3,
    approver_email: APPROVERS.reviewer.email, approver_name: APPROVERS.reviewer.name,
    approver_role: 'reviewer', token,
  });

  const base = `${APP_URL}/api/payroll-cases/approve/${token}`;
  const resend = getResend();
  try {
    await emailCheckApproval(resend, {
      to: APPROVERS.reviewer.email, name: APPROVERS.reviewer.name, role: 'First Reviewer',
      kase, approveUrl: `${base}?action=approve`, rejectUrl: `${base}?action=reject`,
      check: kase.check_data,
    });
  } catch (e) { console.error('Email error:', e.message); }

  await db.from('payroll_cases').update({ status: 'check_approval_sent', check_approval_sent_at: new Date().toISOString() }).eq('id', kase.id);
  await auditLog(db, kase.id, 'CHECK_APPROVAL_SENT', req.user.name || req.user.email, String(req.user.id || ''), getIp(req), { sentTo: APPROVERS.reviewer.email });

  res.json({ sent: true });
});

// ─── Step 3b: Email link — approve/reject check ───────────────────────────────

router.get('/approve/:token', async (req, res) => {
  const { action } = req.query;
  if (!['approve', 'reject'].includes(action)) return res.send(approvalPage('Invalid Link', '#ef4444', 'Invalid action.'));

  const db = getDb();
  if (!db) return res.send(approvalPage('Unavailable', '#ef4444', 'Service temporarily unavailable.'));

  const { data: tok } = await db.from('payroll_approval_tokens')
    .select('*, payroll_cases(*)')
    .eq('token', req.params.token).single();

  if (!tok) return res.send(approvalPage('Not Found', '#ef4444', 'This approval link is invalid or expired.'));
  if (tok.status !== 'pending') return res.send(approvalPage(`Already ${tok.status}`, '#6366f1', 'This approval was already recorded.'));

  const kase = tok.payroll_cases;
  const now = new Date().toISOString();

  if (action === 'reject') {
    await db.from('payroll_approval_tokens').update({ status: 'rejected', action_at: now }).eq('id', tok.id);
    await db.from('payroll_cases').update({
      status: 'check_rejected', check_rejected_at: now,
      check_rejection_reason: `Rejected by ${tok.approver_name} at ${now}`,
    }).eq('id', kase.id);
    await auditLog(db, kase.id, 'CHECK_REJECTED', tok.approver_name, null, null, {
      role: tok.approver_role,
      stamp: `Rejected by: ${tok.approver_name} | Role: ${tok.approver_role} | Date-Time: ${now}`,
    });
    return res.send(approvalPage('Rejected', '#ef4444', `Check file for ${kase.reference} has been rejected. The finance team will be notified.`));
  }

  // Approve
  await db.from('payroll_approval_tokens').update({ status: 'approved', action_at: now }).eq('id', tok.id);
  await auditLog(db, kase.id, `CHECK_${tok.approver_role.toUpperCase()}_APPROVED`, tok.approver_name, null, null, {
    stamp: `Approved by: ${tok.approver_name} | Role: ${tok.approver_role} | Date-Time: ${now}`,
  });

  if (tok.approver_role === 'reviewer') {
    // Chain to final approver
    await db.from('payroll_cases').update({
      status: 'check_reviewer_approved', check_reviewer_name: tok.approver_name, check_reviewer_approved_at: now,
    }).eq('id', kase.id);

    const nextToken = crypto.randomBytes(32).toString('hex');
    await db.from('payroll_approval_tokens').insert({
      case_id: kase.id, step: 3,
      approver_email: APPROVERS.final.email, approver_name: APPROVERS.final.name,
      approver_role: 'final', token: nextToken,
    });

    const base = `${APP_URL}/api/payroll-cases/approve/${nextToken}`;
    const resend = getResend();
    try {
      await emailCheckApproval(resend, {
        to: APPROVERS.final.email, name: APPROVERS.final.name, role: 'Final Approver',
        kase: { ...kase, check_reviewer_name: tok.approver_name },
        approveUrl: `${base}?action=approve`, rejectUrl: `${base}?action=reject`,
        check: kase.check_data,
      });
    } catch (e) { console.error('Email error:', e.message); }

    return res.send(approvalPage('Approved', '#22c55e', `Thank you ${tok.approver_name}. Your approval for ${kase.reference} is recorded. The final approver has been notified.`));
  }

  // Final approver — generate approval certificate
  const cert = {
    type: 'CSI_CHECK_APPROVAL', reference: kase.reference,
    approvedBy: tok.approver_name, reviewedBy: kase.check_reviewer_name,
    entity: kase.entity_name || kase.entity, period: kase.period,
    consultantCount: kase.check_data?.consultantCount, ctcTotal: kase.check_data?.ctcTotal,
    flagCount: kase.check_data?.flagCount, timestamp: now,
    stamp: `Approved by: ${tok.approver_name} | Reviewed by: ${kase.check_reviewer_name} | Date-Time: ${now}`,
  };

  await db.from('payroll_cases').update({
    status: 'check_approved', check_final_approver_name: tok.approver_name,
    check_approved_at: now, check_approval_cert: cert,
  }).eq('id', kase.id);

  await auditLog(db, kase.id, 'CHECK_FULLY_APPROVED', tok.approver_name, null, null, { cert });

  const resend = getResend();
  try {
    const updatedKase = { ...kase, check_reviewer_name: kase.check_reviewer_name || tok.approver_name };
    await emailNotify(resend, {
      to: kase.uploaded_by_email, kase: updatedKase,
      title: 'Check Approved — Proceed to Bank File Generation',
      body: `The check file for ${kase.reference} has been fully approved by ${tok.approver_name} (reviewed by ${kase.check_reviewer_name}). Log in to generate the bank upload file.`,
    });
  } catch (e) { console.error('Notify error:', e.message); }

  return res.send(approvalPage('Fully Approved', '#22c55e', `Check file for ${kase.reference} has been approved. The finance team has been notified to proceed.`));
});

// ─── Step 4: Generate bank file ───────────────────────────────────────────────

router.post('/:id/gen-bank-file', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: kase } = await db.from('payroll_cases').select('*').eq('id', req.params.id).single();
  if (!kase) return res.status(404).json({ error: 'Case not found.' });
  if (kase.status !== 'check_approved') return res.status(409).json({ error: `Bank file requires check approval. Current status: ${kase.status}` });

  const entities = kase.parsed_data?.entities || [];
  const check = kase.check_data || {};
  const now = new Date().toISOString();

  const rows = [['Seq', 'Entity', 'Employee ID', 'Name', 'Cost Centre', 'Gross Salary', 'Net Salary', 'CTC (Hexa)', 'EPF Employer', 'EIS Employer', 'SOCSO Employer', 'HRDF', 'MTD']];
  let seq = 1;
  for (const ent of entities) {
    for (const emp of ent.employees) {
      rows.push([seq++, ent.sheetName, emp.employeeId, emp.name, emp.costCentre,
        emp.grossSalary, emp.netSalary, emp.ctcHexa,
        emp.epfEmployer, emp.eisEmployer, emp.socsoEmployer, emp.hrdf, emp.mtd]);
    }
  }
  rows.push([]);
  rows.push(['', 'TOTAL', '', '', '',
    check.grossPayrollTotal, check.netSalaryTotal, check.ctcTotal,
    check.statutory?.epf, check.statutory?.eis, check.statutory?.socso,
    check.statutory?.hrdf, check.statutory?.mtd]);

  const stampRow = [`Generated by: Hexa System | Triggered by: ${kase.check_final_approver_name} approval | Ref: ${kase.reference} | ${now}`];
  rows.push([]); rows.push(stampRow);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Bank Upload');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fileHash = sha256(buf);
  const fileName = `BANKFILE-${kase.reference}.xlsx`;

  await db.from('payroll_cases').update({
    status: 'bank_file_generated',
    bank_file_name: fileName, bank_file_hash: fileHash,
    bank_file_data: buf.toString('base64'),
    bank_file_generated_at: now, bank_file_triggered_by: kase.check_final_approver_name,
  }).eq('id', kase.id);

  await auditLog(db, kase.id, 'BANK_FILE_GENERATED', req.user.name || req.user.email, String(req.user.id || ''), getIp(req), {
    fileName, fileHash,
    stamp: `Generated by: AI Engine | Triggered by: ${kase.check_final_approver_name} | Ref: ${kase.reference} | ${now}`,
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(buf);
});

// ─── Step 5a: Log bank upload ─────────────────────────────────────────────────

router.post('/:id/log-bank-upload', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { bankPortalRef } = req.body;
  if (!bankPortalRef?.trim()) return res.status(400).json({ error: 'bankPortalRef is required.' });

  const { data: kase } = await db.from('payroll_cases').select('id,status').eq('id', req.params.id).single();
  if (!kase) return res.status(404).json({ error: 'Case not found.' });
  if (kase.status !== 'bank_file_generated') return res.status(409).json({ error: `Cannot log bank upload from status: ${kase.status}` });

  const now = new Date().toISOString();
  await db.from('payroll_cases').update({
    status: 'bank_uploaded', bank_upload_by: req.user.name || req.user.email,
    bank_portal_ref: bankPortalRef.trim(), bank_upload_at: now,
  }).eq('id', kase.id);

  await auditLog(db, kase.id, 'BANK_UPLOADED', req.user.name || req.user.email, String(req.user.id || ''), getIp(req), {
    bankPortalRef: bankPortalRef.trim(),
    stamp: `Uploaded to bank by: ${req.user.name} | Bank Portal Ref: ${bankPortalRef} | Date-Time: ${now}`,
  });

  res.json({ logged: true });
});

// ─── Step 5b: Attach bank receipt ────────────────────────────────────────────

router.post('/:id/upload-receipt', requireAuth, anyFile.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No receipt file uploaded.' });

  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: kase } = await db.from('payroll_cases').select('id,status').eq('id', req.params.id).single();
  if (!kase) return res.status(404).json({ error: 'Case not found.' });
  if (kase.status !== 'bank_uploaded') return res.status(409).json({ error: 'Log bank upload before attaching receipt.' });

  const now = new Date().toISOString();
  await db.from('payroll_cases').update({
    bank_receipt_name: req.file.originalname,
    bank_receipt_attached_at: now,
  }).eq('id', kase.id);

  await auditLog(db, kase.id, 'BANK_RECEIPT_ATTACHED', req.user.name || req.user.email, String(req.user.id || ''), getIp(req), {
    fileName: req.file.originalname,
    stamp: `Receipt attached by: ${req.user.name} | File: ${req.file.originalname} | Date-Time: ${now}`,
  });

  res.json({ attached: true });
});

// ─── Step 6a: Send payment approval to director ───────────────────────────────

router.post('/:id/send-payment-approval', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: kase } = await db.from('payroll_cases').select('*').eq('id', req.params.id).single();
  if (!kase) return res.status(404).json({ error: 'Case not found.' });
  if (kase.status !== 'bank_uploaded') return res.status(409).json({ error: `Must be in bank_uploaded status. Current: ${kase.status}` });
  if (!kase.bank_receipt_attached_at) return res.status(409).json({ error: 'Bank receipt must be attached before sending payment approval.' });

  const token = crypto.randomBytes(32).toString('hex');
  await db.from('payroll_approval_tokens').insert({
    case_id: kase.id, step: 6,
    approver_email: APPROVERS.director.email, approver_name: APPROVERS.director.name,
    approver_role: 'director', token,
  });

  const base = `${APP_URL}/api/payroll-cases/director/${token}`;
  const resend = getResend();
  try {
    await emailPaymentApproval(resend, {
      kase, check: kase.check_data,
      approveUrl: `${base}?action=approve`, rejectUrl: `${base}?action=reject`,
    });
  } catch (e) { console.error('Email error:', e.message); }

  await db.from('payroll_cases').update({ status: 'payment_approval_sent', payment_approval_sent_at: new Date().toISOString() }).eq('id', kase.id);
  await auditLog(db, kase.id, 'PAYMENT_APPROVAL_SENT', req.user.name || req.user.email, String(req.user.id || ''), getIp(req), { sentTo: APPROVERS.director.email });

  res.json({ sent: true });
});

// ─── Step 6b: Director email link — approve/reject payment ───────────────────

router.get('/director/:token', async (req, res) => {
  const { action } = req.query;
  if (!['approve', 'reject'].includes(action)) return res.send(approvalPage('Invalid Link', '#ef4444', 'Invalid action.'));

  const db = getDb();
  if (!db) return res.send(approvalPage('Unavailable', '#ef4444', 'Service temporarily unavailable.'));

  const { data: tok } = await db.from('payroll_approval_tokens')
    .select('*, payroll_cases(*)')
    .eq('token', req.params.token).single();

  if (!tok) return res.send(approvalPage('Not Found', '#ef4444', 'This link is invalid or expired.'));
  if (tok.status !== 'pending') return res.send(approvalPage(`Already ${tok.status}`, '#6366f1', 'This approval was already recorded.'));

  const kase = tok.payroll_cases;
  const now = new Date().toISOString();

  if (action === 'reject') {
    await db.from('payroll_approval_tokens').update({ status: 'rejected', action_at: now }).eq('id', tok.id);
    await db.from('payroll_cases').update({
      status: 'payment_rejected', payment_rejected_at: now,
      payment_rejection_reason: `Rejected by ${tok.approver_name} at ${now}`,
    }).eq('id', kase.id);
    await auditLog(db, kase.id, 'PAYMENT_REJECTED', tok.approver_name, null, null, {
      stamp: `Rejected by: ${tok.approver_name} | Role: Director | Date-Time: ${now}`,
    });
    return res.send(approvalPage('Payment Rejected', '#ef4444', `Payment for ${kase.reference} has been rejected. The finance team will be notified.`));
  }

  const cert = {
    type: 'PAYMENT_APPROVAL', reference: kase.reference,
    approvedBy: tok.approver_name,
    amount: fmtRM(kase.check_data?.ctcTotal || 0),
    consultantCount: kase.check_data?.consultantCount,
    bankPortalRef: kase.bank_portal_ref,
    entity: kase.entity_name || kase.entity, period: kase.period,
    timestamp: now,
    stamp: `Payment Approved by: ${tok.approver_name} | Amount: ${fmtRM(kase.check_data?.ctcTotal || 0)} | Ref: ${kase.reference} | Date-Time: ${now}`,
  };

  await db.from('payroll_approval_tokens').update({ status: 'approved', action_at: now }).eq('id', tok.id);
  await db.from('payroll_cases').update({
    status: 'payment_approved', payment_approved_by: tok.approver_name,
    payment_approved_at: now, payment_approval_cert: cert,
  }).eq('id', kase.id);

  await auditLog(db, kase.id, 'PAYMENT_APPROVED', tok.approver_name, null, null, { cert });

  const resend = getResend();
  try {
    await emailNotify(resend, {
      to: kase.uploaded_by_email, kase,
      title: 'Payment Approved — Post to Zoho Books',
      body: `Payment for ${kase.reference} has been approved by ${tok.approver_name} (${fmtRM(kase.check_data?.ctcTotal || 0)}). You may now post the journal entry to Zoho Books.`,
    });
  } catch (e) { console.error('Notify error:', e.message); }

  return res.send(approvalPage('Payment Approved', '#22c55e', `Payment for ${kase.reference} approved. Amount: ${fmtRM(kase.check_data?.ctcTotal || 0)}. The finance team has been notified.`));
});

// ─── Step 7: Post to Zoho Books ───────────────────────────────────────────────

router.post('/:id/post-zoho', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: kase } = await db.from('payroll_cases').select('*').eq('id', req.params.id).single();
  if (!kase) return res.status(404).json({ error: 'Case not found.' });
  if (kase.status !== 'payment_approved') return res.status(409).json({ error: `Zoho posting requires payment approval. Status: ${kase.status}` });
  if (!kase.check_approval_cert || !kase.payment_approval_cert) return res.status(409).json({ error: 'Both approval certificates must exist.' });

  const { orgId, journalDate, lineItems, sheetName } = req.body;
  if (!orgId || !journalDate || !lineItems?.length || !sheetName) {
    return res.status(400).json({ error: 'orgId, journalDate, sheetName, and lineItems are required.' });
  }

  const now = new Date().toISOString();
  const narration = `${kase.type} Payroll – ${kase.period} – ${kase.entity_name || kase.entity} – Ref: ${kase.reference} – Approved: ${kase.payment_approved_by} – Posted: ${now}`;

  const round2local = (n) => Math.round(parseFloat(n) * 100) / 100;
  const totalDebit = lineItems.filter(l => l.debit_or_credit === 'debit').reduce((s, l) => s + l.amount, 0);
  const totalCredit = lineItems.filter(l => l.debit_or_credit === 'credit').reduce((s, l) => s + l.amount, 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(422).json({ error: `Debits (${totalDebit.toFixed(2)}) ≠ credits (${totalCredit.toFixed(2)}).` });
  }

  let journal;
  try {
    journal = await postJournalEntry(orgId, {
      journal_date: journalDate,
      reference_number: kase.reference,
      notes: narration,
      line_items: lineItems.map(l => ({ account_id: l.account_id, debit_or_credit: l.debit_or_credit, amount: round2local(l.amount), description: l.description })),
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }

  await db.from('payroll_cases').update({
    status: 'zoho_posted', zoho_org_id: orgId,
    zoho_journal_ids: [journal?.journal_id].filter(Boolean),
    zoho_posted_at: now, zoho_posted_by: req.user.name || req.user.email,
    audit_assembled_at: now,
  }).eq('id', kase.id);

  // Also record in journal_posts for dashboard stats
  try {
    await db.from('journal_posts').insert({
      module: kase.type.toLowerCase(), entity: sheetName, org_id: orgId,
      journal_id: journal?.journal_id, reference_number: kase.reference,
      journal_date: journalDate, total_amount: round2local(totalDebit),
      notes: narration, posted_by_email: req.user.email, posted_by_name: req.user.name || req.user.email,
    });
  } catch (_) {}

  await auditLog(db, kase.id, 'ZOHO_POSTED', req.user.name || req.user.email, String(req.user.id || ''), getIp(req), {
    journalId: journal?.journal_id, orgId,
    stamp: `Posted by: System API | Initiated by: ${req.user.name} | Zoho Journal No: ${journal?.journal_id} | Date-Time: ${now}`,
  });

  res.json({ journalId: journal?.journal_id, referenceNumber: kase.reference });
});

// ─── Get case (with audit log) ────────────────────────────────────────────────

router.get('/:id', requireAuth, async (req, res) => {
  // Must come AFTER named routes like /approve/:token and /director/:token
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: kase } = await db.from('payroll_cases').select('*').eq('id', req.params.id).single();
  if (!kase) return res.status(404).json({ error: 'Case not found.' });

  const { data: logs } = await db.from('payroll_audit_log')
    .select('*').eq('case_id', kase.id).order('created_at', { ascending: true });

  res.json({ case: kase, auditLog: logs || [] });
});

// ─── List cases ───────────────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.json({ cases: [] });

  let q = db.from('payroll_cases')
    .select('id,reference,type,entity,entity_name,period,status,uploaded_by_name,uploaded_at,check_data,zoho_journal_ids,zoho_posted_at,check_approved_at,payment_approved_at')
    .order('created_at', { ascending: false }).limit(100);

  if (req.query.type) q = q.eq('type', req.query.type.toUpperCase());

  const { data } = await q;
  res.json({ cases: data || [] });
});

module.exports = router;
