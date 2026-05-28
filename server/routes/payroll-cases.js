const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');
const { Resend } = require('resend');
const { getDb } = require('../services/db');
const { parseExcelBuffer } = require('../services/parser');
const { postJournalEntry, createExpense, attachJournalDocument } = require('../services/zoho');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'hexa-jwt-secret-change-in-prod';
const APP_URL = process.env.APP_URL || 'https://hexajrfe.hexamatics.finance';
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@hexamatics.finance';

const APPROVERS = {
  reviewer: { name: 'Asim Subedi', email: 'asim.ovc977@gmail.com' },
  final:    { name: 'Praphulla Subedi', email: 'praphulla@hexamatics.com' },
  director: { name: 'Dato Thiruchelvapalan', email: 'tripathisonee@gmail.com' },
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

// Malaysian bank name → SWIFT/bank code lookup
const MY_BANK_CODES = {
  maybank: 'MBBEMYKL', 'maybank islamic': 'MBBEMYKL',
  'public bank': 'PBBEMYKL', 'public bank berhad': 'PBBEMYKL',
  'cimb': 'CIBBMYKL', 'cimb bank': 'CIBBMYKL',
  'rhb': 'RHBBMYKL', 'rhb bank': 'RHBBMYKL',
  'hong leong': 'HLBBMYKL', 'hong leong bank': 'HLBBMYKL',
  'ambank': 'ARBKMYKL',
  'bank islam': 'BIMBMYKL', 'bank islam malaysia berhad': 'BIMBMYKL',
  'bank muamalat': 'BMMBMYKL',
  'hsbc': 'HBMBMYKL', 'hsbc bank': 'HBMBMYKL',
  'ocbc': 'OCBCMYKL',
  'standard chartered': 'SCBLMYKL',
  'affin': 'PHBMMYKL', 'affin bank': 'PHBMMYKL',
  'alliance bank': 'MFBBMYKL',
  'bank rakyat': 'BKRMMYKL',
  'bsn': 'BSNAMYK1',
};

function bankNameToCode(name) {
  if (!name) return '';
  return MY_BANK_CODES[name.trim().toLowerCase()] || '';
}

async function fetchAirtableConsultants() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;
  if (!apiKey || !baseId || !tableName) return [];

  const records = [];
  let offset = null;
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('cellFormat', 'string');
    url.searchParams.set('timeZone', 'Asia/Kuala_Lumpur');
    url.searchParams.set('userLocale', 'en-MY');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) break;
    const data = await res.json();
    for (const r of (data.records || [])) {
      const f = r.fields;
      records.push({
        employeeNumber: String(f['Employee Number'] || '').trim(),
        employeeId: String(f['Employee ID'] || '').trim(),
        name: String(f['Full Legal Name'] || '').trim(),
        bankName: String(f['Bank Name'] || '').trim(),
        accountNo: String(f['Bank Account Number'] || '').trim(),
        idNumber: String(f['ID Number'] || '').trim(),
      });
    }
    offset = data.offset || null;
  } while (offset);

  return records;
}

function matchConsultant(emp, airtableList) {
  // Try exact employee number match first
  const byNum = airtableList.find(a => a.employeeNumber === emp.employeeId || a.employeeId === emp.employeeId);
  if (byNum) return byNum;
  // Fallback: name contains match (case-insensitive)
  const empNameLower = emp.name.toLowerCase();
  return airtableList.find(a => {
    const aLower = a.name.toLowerCase();
    return aLower === empNameLower || aLower.includes(empNameLower) || empNameLower.includes(aLower);
  }) || null;
}

function pad(n) { return String(n).padStart(2, '0'); }

const PDFDocument = require('pdfkit');

function bufferFromPdfStream(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function pdfHeader(doc, title, ref) {
  doc.fontSize(18).fillColor('#6366f1').text('Hexamatics Finance', { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(13).fillColor('#111').text(title);
  doc.fontSize(9).fillColor('#64748b').text(`Ref: ${ref}  ·  Generated: ${new Date().toISOString()}`);
  doc.moveDown(0.5);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#6366f1').lineWidth(1.5).stroke();
  doc.moveDown(0.5);
}

function pdfRow(doc, label, value, opts = {}) {
  const y = doc.y;
  doc.fontSize(9).fillColor('#64748b').text(label, doc.page.margins.left, y, { width: 160 });
  doc.fontSize(9).fillColor(opts.color || '#111').text(String(value ?? '—'), doc.page.margins.left + 165, y);
  doc.moveDown(0.35);
}

function pdfSection(doc, title) {
  doc.moveDown(0.4);
  doc.fontSize(10).fillColor('#6366f1').text(title.toUpperCase(), { characterSpacing: 0.5 });
  doc.moveDown(0.3);
}

function fmtRMpdf(n) {
  if (n == null) return '—';
  return 'RM ' + Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2 });
}

async function buildCheckReportPdf(kase) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const check = kase.check_data || {};
  const entities = kase.parsed_data?.entities || [];

  pdfHeader(doc, 'Payroll Check Report', kase.reference);

  pdfSection(doc, 'Case Details');
  pdfRow(doc, 'Reference', kase.reference);
  pdfRow(doc, 'Type', kase.type);
  pdfRow(doc, 'Entity', kase.entity_name || kase.entity);
  pdfRow(doc, 'Period', kase.period);
  pdfRow(doc, 'Payment Date', kase.payment_date || '—');
  pdfRow(doc, 'Uploaded by', kase.uploaded_by_name);
  pdfRow(doc, 'Upload Timestamp', kase.uploaded_at);
  pdfRow(doc, 'File Hash (SHA-256)', kase.original_file_hash || '—');

  pdfSection(doc, 'Payroll Summary');
  pdfRow(doc, 'Consultants', check.consultantCount);
  pdfRow(doc, 'Gross Payroll', fmtRMpdf(check.grossPayrollTotal));
  pdfRow(doc, 'Net Salary Total', fmtRMpdf(check.netSalaryTotal));
  pdfRow(doc, 'Total CTC (Hexa)', fmtRMpdf(check.ctcTotal));

  pdfSection(doc, 'Statutory Breakdown');
  pdfRow(doc, 'EPF (Employer)', fmtRMpdf(check.statutory?.epf));
  pdfRow(doc, 'EIS (Employer)', fmtRMpdf(check.statutory?.eis));
  pdfRow(doc, 'SOCSO (Employer)', fmtRMpdf(check.statutory?.socso));
  pdfRow(doc, 'HRDF', fmtRMpdf(check.statutory?.hrdf));
  pdfRow(doc, 'MTD / PCB', fmtRMpdf(check.statutory?.mtd));

  pdfSection(doc, `Exceptions (${check.flagCount || 0} flags)`);
  if (!check.flagCount) {
    doc.fontSize(9).fillColor('#166534').text('✓ No exceptions — all checks passed.');
    doc.moveDown(0.3);
  } else {
    for (const f of (check.flags || [])) {
      doc.fontSize(9).fillColor('#991b1b').text(`⚠ ${f.code}${f.employee ? ` — ${f.employee}` : ''}${f.entity ? ` (${f.entity})` : ''}${f.diff ? `  Δ ${fmtRMpdf(f.diff)}` : ''}`);
      doc.moveDown(0.25);
    }
  }

  pdfSection(doc, 'Approval Stamps');
  pdfRow(doc, 'Check Reviewer', kase.check_reviewer_name || '—');
  pdfRow(doc, 'Reviewer Approved', kase.check_reviewer_approved_at || '—');
  pdfRow(doc, 'Final Approver', kase.check_final_approver_name || '—');
  pdfRow(doc, 'Final Approved', kase.check_approved_at || '—');
  if (kase.check_approval_cert?.stamp) {
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor('#475569').text(kase.check_approval_cert.stamp, { lineGap: 2 });
    doc.moveDown(0.3);
  }
  pdfRow(doc, 'Payment Approved by', kase.payment_approved_by || '—');
  pdfRow(doc, 'Payment Approved at', kase.payment_approved_at || '—');
  if (kase.payment_approval_cert?.stamp) {
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor('#475569').text(kase.payment_approval_cert.stamp, { lineGap: 2 });
    doc.moveDown(0.3);
  }

  // Consultant list (new page)
  doc.addPage();
  pdfHeader(doc, 'Consultant Detail List', kase.reference);

  const colX = [40, 80, 130, 215, 285, 340, 390, 440, 490, 540];
  const colW = [35, 45, 80, 65, 50, 45, 45, 45, 45, 45];
  const headers = ['#', 'Emp ID', 'Name', 'Entity', 'Gross', 'Net', 'CTC', 'EPF', 'MTD', 'Cost Ctr'];

  // Table header
  doc.fontSize(8).fillColor('#fff');
  doc.rect(40, doc.y, 515, 14).fill('#6366f1');
  headers.forEach((h, i) => doc.fillColor('#fff').text(h, colX[i], doc.y - 12, { width: colW[i] }));
  doc.moveDown(0.1);

  let rowNum = 1;
  for (const ent of entities) {
    for (const emp of ent.employees) {
      if (doc.y > 760) { doc.addPage(); }
      const bg = rowNum % 2 === 0 ? '#f8fafc' : '#fff';
      const rowY = doc.y;
      doc.rect(40, rowY, 515, 13).fill(bg);
      doc.fillColor('#111');
      [rowNum, emp.employeeId, emp.name.slice(0, 18), ent.sheetName.slice(0, 12),
        fmtRMpdf(emp.grossSalary), fmtRMpdf(emp.netSalary), fmtRMpdf(emp.ctcHexa),
        fmtRMpdf(emp.epfEmployer), fmtRMpdf(emp.mtd), emp.costCentre.slice(0, 10)
      ].forEach((v, i) => doc.fontSize(7).text(String(v), colX[i], rowY + 2, { width: colW[i] }));
      doc.moveDown(0.15);
      rowNum++;
    }
  }

  // Totals row
  doc.moveDown(0.2);
  doc.fontSize(8).fillColor('#6366f1').text(`TOTAL  ${fmtRMpdf(check.grossPayrollTotal)} gross  |  ${fmtRMpdf(check.netSalaryTotal)} net  |  ${fmtRMpdf(check.ctcTotal)} CTC`);

  return bufferFromPdfStream(doc);
}

async function buildAuditPackagePdf(kase, logs) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const check = kase.check_data || {};

  pdfHeader(doc, `Audit Package — ${kase.reference}`, kase.reference);

  doc.fontSize(9).fillColor('#64748b').text(`Retention: 7 years  ·  Read-only  ·  Append-only storage  ·  ${new Date().toISOString()}`);
  doc.moveDown(0.5);

  pdfSection(doc, 'Case Overview');
  pdfRow(doc, 'Reference', kase.reference);
  pdfRow(doc, 'Type', kase.type);
  pdfRow(doc, 'Entity', kase.entity_name || kase.entity);
  pdfRow(doc, 'Period', kase.period);
  pdfRow(doc, 'Payment Date', kase.payment_date || '—');
  pdfRow(doc, 'Status', kase.status);
  pdfRow(doc, 'Consultants', check.consultantCount);
  pdfRow(doc, 'Total CTC', fmtRMpdf(check.ctcTotal));

  pdfSection(doc, 'Document Registry');
  const docs = [
    ['1', 'Original File', kase.original_file_name || '—', kase.original_file_hash ? kase.original_file_hash.slice(0, 32) + '…' : ''],
    ['2', 'AI Check File', kase.check_generated_at || '—', `Flags: ${check.flagCount || 0}`],
    ['3', 'Check Approval Certificate', kase.check_approved_at || '—', kase.check_approval_cert?.stamp?.slice(0, 60) || ''],
    ['4', 'Bank Upload File (RCMS XLSX)', kase.bank_file_name || '—', kase.bank_file_hash ? kase.bank_file_hash.slice(0, 32) + '…' : ''],
    ['5', 'RCgen Payment TXT', kase.bank_receipt_name || '—', ''],
    ['6', 'Bank Upload Log', kase.bank_upload_at ? `By: ${kase.bank_upload_by}  Ref: ${kase.bank_portal_ref}` : '—', ''],
    ['7', 'Payment Approval Certificate', kase.payment_approved_at || '—', kase.payment_approval_cert?.stamp?.slice(0, 60) || ''],
    ['8', 'Zoho Journal', (kase.zoho_journal_ids || [])[0] || '—', kase.zoho_posted_at || ''],
    ['9', 'Audit Log', `${logs.length} events`, ''],
  ];

  for (const [num, name, detail, stamp] of docs) {
    const done = detail !== '—' && detail !== '';
    doc.fontSize(9).fillColor(done ? '#166534' : '#94a3b8').text(`${done ? '✓' : '○'}  ${num}. ${name}`, { continued: false });
    if (detail && detail !== '—') {
      doc.fontSize(8).fillColor('#374151').text(`   ${detail}`, { indent: 16 });
    }
    if (stamp) doc.fontSize(7).fillColor('#64748b').text(`   ${stamp}`, { indent: 16 });
    doc.moveDown(0.2);
  }

  pdfSection(doc, 'Check Approval Certificate');
  if (kase.check_approval_cert) {
    for (const [k, v] of Object.entries(kase.check_approval_cert)) {
      if (typeof v !== 'object') pdfRow(doc, k, v);
    }
  }

  pdfSection(doc, 'Payment Approval Certificate');
  if (kase.payment_approval_cert) {
    for (const [k, v] of Object.entries(kase.payment_approval_cert)) {
      if (typeof v !== 'object') pdfRow(doc, k, v);
    }
  }

  // Audit log (new page)
  doc.addPage();
  pdfHeader(doc, 'Immutable Audit Log', kase.reference);
  doc.fontSize(9).fillColor('#374151').text(`${logs.length} events recorded`);
  doc.moveDown(0.4);

  for (const l of logs) {
    if (doc.y > 760) doc.addPage();
    doc.fontSize(8).fillColor('#6366f1').text(l.event_type, { continued: true });
    doc.fillColor('#374151').text(`  —  ${l.performed_by || 'System'}`, { continued: true });
    doc.fillColor('#94a3b8').text(`  ${l.created_at || ''}  ${l.ip_address ? `[${l.ip_address}]` : ''}`);
    if (l.metadata?.stamp) {
      doc.fontSize(7).fillColor('#64748b').text(`   ${l.metadata.stamp}`, { lineGap: 1 });
    }
    doc.moveDown(0.2);
  }

  return bufferFromPdfStream(doc);
}

async function generateAndStoreBankFiles(kase, db, triggeredBy) {
  const entities = kase.parsed_data?.entities || [];
  const check = kase.check_data || {};
  const now = new Date().toISOString();

  const paymentDateStr = kase.payment_date || new Date().toISOString().slice(0, 10);
  const [yr, mo, dy] = paymentDateStr.split('-');
  const valueDate = `${dy}${mo}${yr}`;
  const mmyy = `${mo}${yr.slice(2)}`;

  let airtableList = [];
  try { airtableList = await fetchAirtableConsultants(); } catch (_) {}

  const corporateId  = process.env.BANK_CORPORATE_ID  || 'MYMHEXAMATI';
  const groupId      = process.env.BANK_GROUP_ID       || 'MYMHEXA1D';
  const debitAccount = process.env.BANK_DEBIT_ACCOUNT  || '';
  const notifyEmails = (process.env.BANK_NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

  const beneficiaries = [];
  let seqRef = 100;
  for (const ent of entities) {
    for (const emp of ent.employees) {
      const matched = matchConsultant(emp, airtableList);
      beneficiaries.push({
        seq: seqRef++,
        employeeId: emp.employeeId,
        name: matched?.name || emp.name,
        costCentre: emp.costCentre,
        amount: emp.netSalary,
        accountNumber: matched?.accountNo || '',
        bankName: matched?.bankName || '',
        bankCode: bankNameToCode(matched?.bankName),
        idNumber: matched?.idNumber || '',
        advicePrefix: (matched?.name || emp.name).replace(/\s+/g, '_'),
        email: notifyEmails[0] || '',
        entity: ent.sheetName,
        paymentMode: 'IT',
        matched: !!matched,
      });
    }
  }

  // RCMS XLSX
  const RCMS_HEADERS = [
    'Payment Mode','Value Date','Customer Reference Number','Favourite Beneficiary Code',
    'Transaction Amount (RM)','Credit Account Number','Beneficiary Name 1','Beneficiary Name 2',
    'Beneficiary Name 3','New IC No','Old IC No','Business Registration Number',
    'Police/ Army ID/ Passport No','Beneficiary Bank Code','Email','Advice Detail',
    'Debit Description','Credit Description','Joint Name','Joint New ID No',
    'Joint Old ID No','Joint Business Reg. No.','Joint Police/ Army ID/ Passport No.',
    'Purpose of Transfer','Others Purpose of Transfer','Rentas Instruction to Bank',
    'Charges Borne by','Email 2','Email 3','Email 4','Email 5',
  ];
  const xlsxRows = [RCMS_HEADERS];
  for (const b of beneficiaries) {
    const advice = `${b.advicePrefix}_${mmyy}`;
    const row = new Array(31).fill('');
    row[0] = b.paymentMode; row[1] = valueDate; row[2] = b.seq;
    row[4] = b.amount; row[5] = b.accountNumber; row[6] = b.name;
    row[9] = b.idNumber; row[13] = b.bankCode; row[14] = b.email;
    row[15] = advice; row[16] = advice; row[17] = advice;
    if (notifyEmails[1]) row[28] = notifyEmails[1];
    xlsxRows.push(row);
  }
  xlsxRows.push([]);
  xlsxRows.push(['','','','', check.netSalaryTotal,'', `TOTAL — ${beneficiaries.length} consultants`,'','','','','','','','','', `Ref: ${kase.reference}`,'','','','','','','','','','','','','','']);
  xlsxRows.push([]);
  xlsxRows.push([`Generated by: Hexa System | Triggered by: ${triggeredBy} approval | Ref: ${kase.reference} | ${now}`]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(xlsxRows), `Bank_${valueDate}_CSI`);
  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const xlsxHash = sha256(xlsxBuf);
  const xlsxName = `RCMS_BankUpload_${kase.reference}_${valueDate}.xlsx`;

  // RCgen TXT
  const tsNow = new Date();
  const tsPart = `${tsNow.getFullYear()}${pad(tsNow.getMonth()+1)}${pad(tsNow.getDate())}${pad(tsNow.getHours())}${pad(tsNow.getMinutes())}${pad(tsNow.getSeconds())}`;
  const txtLines = [`00|${corporateId}|${groupId}||B||||||||||||||||||||||||`];
  for (const b of beneficiaries) {
    const advice = `${b.advicePrefix}_${mmyy}`;
    const amount = parseFloat(b.amount || 0).toFixed(2);
    const empty = '|'.repeat(200);
    txtLines.push(`01|${b.paymentMode}|Domestic Payments (MY)||${valueDate}|||${b.seq}||${advice}|MYR|${amount}|Y|MYR|${debitAccount}|${b.accountNumber}|||Y|${b.name}||||${b.idNumber}|||${b.bankCode}||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||${advice}|||||||01${empty}`);
    txtLines.push(`02|PA|${b.seq}|${b.email}|||${advice}|||||||${amount}|||||||${notifyEmails[1]||''}|${notifyEmails[2]||''}||||||||||||||||||`);
  }
  const txtBuf = Buffer.from(txtLines.join('\n'), 'utf8');
  const txtHash = sha256(txtBuf);
  const txtName = `RCgen_Payment_DP_${tsPart}.txt`;

  await db.from('payroll_cases').update({
    status: 'bank_file_generated',
    bank_file_name: xlsxName, bank_file_hash: xlsxHash,
    bank_file_data: xlsxBuf.toString('base64'),
    bank_file_generated_at: now, bank_file_triggered_by: triggeredBy,
    bank_receipt_name: txtName,
    bank_receipt_data: txtBuf.toString('base64'),
  }).eq('id', kase.id);

  await auditLog(db, kase.id, 'BANK_FILE_AUTO_GENERATED', triggeredBy, null, null, {
    xlsxName, xlsxHash, txtName, txtHash,
    matched: beneficiaries.filter(b => b.matched).length,
    unmatched: beneficiaries.filter(b => !b.matched).length,
    stamp: `Auto-generated by: System | Triggered by: ${triggeredBy} approval | Ref: ${kase.reference} | ${now}`,
  });

  return { xlsxName, txtName, matched: beneficiaries.filter(b => b.matched).length, total: beneficiaries.length };
}

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

async function emailCheckApproval(resend, { to, name, role, kase, approveUrl, rejectUrl, check, entities }) {
  if (!resend) return;
  const label = kase.type === 'CSI' ? 'CSI Payroll' : 'Internal Payroll';

  // Full consultant breakdown table
  const allEmployees = (entities || []).flatMap(ent =>
    ent.employees.map(emp => ({ ...emp, entity: ent.sheetName }))
  );
  const MAX_ROWS = 100;
  const empRows = allEmployees.slice(0, MAX_ROWS).map((emp, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'}">
      <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:12px">${emp.employeeId}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:12px">${emp.name}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:12px">${emp.entity}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right">${fmtRM(emp.grossSalary)}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right">${fmtRM(emp.netSalary)}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right;font-weight:600">${fmtRM(emp.ctcHexa)}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right">${fmtRM(emp.epfEmployer)}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right">${fmtRM(emp.mtd)}</td>
    </tr>`).join('');

  const statRows = Object.entries(check.statutory || {}).map(([k, v]) =>
    tableRow(k.toUpperCase(), fmtRM(v))
  ).join('');

  await resend.emails.send({
    from: EMAIL_FROM, to,
    subject: `[Hexa Finance] ${label} Check — ${role} Required | ${kase.reference}`,
    html: emailWrap(`
      <h2 style="font-size:18px;font-weight:700;color:#111;margin:0 0 4px">Check File Approval — ${role}</h2>
      <p style="color:#555;margin:0 0 20px">Hi ${name}, you are assigned as <strong>${role}</strong> for the following payroll run. Please review the full details below.</p>

      <h3 style="font-size:13px;font-weight:700;color:#6366f1;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.05em">Summary</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
        ${tableRow('Reference', `<span style="color:#6366f1;font-weight:700">${kase.reference}</span>`)}
        ${tableRow('Type', label)}
        ${tableRow('Entity', kase.entity_name || kase.entity)}
        ${tableRow('Period', kase.period)}
        ${tableRow('Payment Date', kase.payment_date || '—')}
        ${tableRow('Consultants', check.consultantCount)}
        ${tableRow('Gross Payroll', fmtRM(check.grossPayrollTotal))}
        ${tableRow('Net Salary', fmtRM(check.netSalaryTotal))}
        ${tableRow('Total CTC', `<strong style="font-size:16px;color:#111">${fmtRM(check.ctcTotal)}</strong>`)}
        ${tableRow('Exceptions', `<span style="color:${check.flagCount > 0 ? '#ef4444' : '#22c55e'};font-weight:700">${check.flagCount} flag(s)</span>`)}
      </table>

      <h3 style="font-size:13px;font-weight:700;color:#6366f1;margin:16px 0 8px;text-transform:uppercase;letter-spacing:0.05em">Statutory Breakdown</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
        ${statRows}
      </table>

      ${check.flagCount > 0 ? `
      <h3 style="font-size:13px;font-weight:700;color:#ef4444;margin:16px 0 8px;text-transform:uppercase">Exceptions / Flags</h3>
      <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#991b1b">
        ${check.flags.map(f => `<div style="margin-bottom:4px">⚠ <strong>${f.code}</strong>${f.employee ? ` — ${f.employee}` : ''}${f.entity ? ` (${f.entity})` : ''}${f.diff ? ` Δ ${fmtRM(f.diff)}` : ''}</div>`).join('')}
      </div>` : '<div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:10px 14px;margin-bottom:20px;font-size:13px;color:#166534">✓ No exceptions — all checks passed.</div>'}

      <h3 style="font-size:13px;font-weight:700;color:#6366f1;margin:16px 0 8px;text-transform:uppercase;letter-spacing:0.05em">Full Consultant List (${allEmployees.length})</h3>
      <div style="overflow-x:auto;margin-bottom:24px">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:600px">
          <thead>
            <tr style="background:#f1f5f9">
              <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #e2e8f0">Emp ID</th>
              <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #e2e8f0">Name</th>
              <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #e2e8f0">Entity</th>
              <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2e8f0">Gross</th>
              <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2e8f0">Net</th>
              <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2e8f0">CTC</th>
              <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2e8f0">EPF</th>
              <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2e8f0">MTD</th>
            </tr>
          </thead>
          <tbody>${empRows}</tbody>
          <tfoot>
            <tr style="background:#f8fafc;font-weight:700">
              <td colspan="3" style="padding:6px 8px;border-top:2px solid #e2e8f0">TOTAL</td>
              <td style="padding:6px 8px;border-top:2px solid #e2e8f0;text-align:right">${fmtRM(check.grossPayrollTotal)}</td>
              <td style="padding:6px 8px;border-top:2px solid #e2e8f0;text-align:right">${fmtRM(check.netSalaryTotal)}</td>
              <td style="padding:6px 8px;border-top:2px solid #e2e8f0;text-align:right">${fmtRM(check.ctcTotal)}</td>
              <td style="padding:6px 8px;border-top:2px solid #e2e8f0;text-align:right">${fmtRM(check.statutory?.epf)}</td>
              <td style="padding:6px 8px;border-top:2px solid #e2e8f0;text-align:right">${fmtRM(check.statutory?.mtd)}</td>
            </tr>
          </tfoot>
        </table>
        ${allEmployees.length > MAX_ROWS ? `<p style="font-size:12px;color:#64748b;margin-top:4px">Showing first ${MAX_ROWS} of ${allEmployees.length} consultants.</p>` : ''}
      </div>

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

// ─── Step 3a: Send check approval + book accrual journals in Zoho ─────────────

router.post('/:id/send-check-approval', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: kase } = await db.from('payroll_cases').select('*').eq('id', req.params.id).single();
  if (!kase) return res.status(404).json({ error: 'Case not found.' });
  if (kase.status !== 'check_generated') return res.status(409).json({ error: `Cannot send approval from status: ${kase.status}` });

  const { orgId, debitAccountId, creditAccountId } = req.body;

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
      check: kase.check_data, entities: kase.parsed_data?.entities || [],
    });
  } catch (e) { console.error('Email error:', e.message); }

  const now = new Date().toISOString();
  const journalDate = kase.payment_date || now.slice(0, 10);

  // Auto-book accrual journals: DR Salary Expense / CR Salary Payable — one per consultant
  const accrualResults = [];
  if (orgId && debitAccountId && creditAccountId) {
    const entities = kase.parsed_data?.entities || [];
    const allEmployees = entities.flatMap(ent => ent.employees.map(emp => ({ ...emp, entityName: ent.sheetName })));
    for (const emp of allEmployees) {
      const empRef = `ACCR-${kase.reference}-${emp.employeeId}`;
      const narration = `Payroll Accrual – ${kase.period} – ${emp.name} (${emp.employeeId}) – Ref: ${kase.reference}`;
      const amount = round2(emp.ctcHexa);
      try {
        const j = await postJournalEntry(orgId, {
          journal_date: journalDate,
          reference_number: empRef,
          notes: narration,
          line_items: [
            { account_id: debitAccountId,  debit_or_credit: 'debit',  amount, description: `${emp.name} – ${kase.period}` },
            { account_id: creditAccountId, debit_or_credit: 'credit', amount, description: `${emp.name} – ${kase.period}` },
          ],
        });
        accrualResults.push({ name: emp.name, journalId: j?.journal_id, success: true });
      } catch (err) {
        accrualResults.push({ name: emp.name, error: err.message, success: false });
      }
    }
    await auditLog(db, kase.id, 'ZOHO_ACCRUAL_BOOKED', req.user.name || req.user.email, String(req.user.id || ''), getIp(req), {
      orgId, posted: accrualResults.filter(r=>r.success).length, failed: accrualResults.filter(r=>!r.success).length,
    });
  }

  await db.from('payroll_cases').update({
    status: 'check_approval_sent',
    check_approval_sent_at: now,
    zoho_org_id: orgId || kase.zoho_org_id || null,
  }).eq('id', kase.id);

  await auditLog(db, kase.id, 'CHECK_APPROVAL_SENT', req.user.name || req.user.email, String(req.user.id || ''), getIp(req), { sentTo: APPROVERS.reviewer.email });

  res.json({ sent: true, accrualResults });
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
        check: kase.check_data, entities: kase.parsed_data?.entities || [],
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

  // Auto-generate bank files immediately after final approval
  let bankFileResult = null;
  try {
    const freshKase = { ...kase, check_final_approver_name: tok.approver_name, check_approval_cert: cert };
    bankFileResult = await generateAndStoreBankFiles(freshKase, db, tok.approver_name);
  } catch (e) { console.error('Auto bank file error (non-fatal):', e.message); }

  const resend = getResend();
  try {
    const bankMsg = bankFileResult
      ? `Bank upload files have been auto-generated (${bankFileResult.matched}/${bankFileResult.total} consultants matched from Airtable). Log in to download and proceed to Step 5.`
      : `Log in to generate the bank upload file (Step 4).`;
    await emailNotify(resend, {
      to: kase.uploaded_by_email,
      kase: { ...kase, check_reviewer_name: kase.check_reviewer_name || tok.approver_name },
      title: 'Check Approved — Bank Files Ready',
      body: `The check file for ${kase.reference} has been fully approved by ${tok.approver_name} (reviewed by ${kase.check_reviewer_name}). ${bankMsg}`,
    });
  } catch (e) { console.error('Notify error:', e.message); }

  return res.send(approvalPage('Fully Approved', '#22c55e', `Check file for ${kase.reference} has been approved and bank files have been auto-generated. The finance team has been notified.`));
});

// ─── Step 4: Generate bank files (RCMS XLSX + RCgen TXT) ─────────────────────

router.post('/:id/gen-bank-file', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: kase } = await db.from('payroll_cases').select('*').eq('id', req.params.id).single();
  if (!kase) return res.status(404).json({ error: 'Case not found.' });
  if (!['check_approved', 'bank_file_generated'].includes(kase.status)) {
    return res.status(409).json({ error: `Bank file requires check approval. Status: ${kase.status}` });
  }

  const triggeredBy = req.user.name || req.user.email;
  await generateAndStoreBankFiles(kase, db, triggeredBy);

  // Re-fetch to get stored file data
  const { data: updated } = await db.from('payroll_cases')
    .select('bank_file_name, bank_file_data').eq('id', kase.id).single();

  const buf = Buffer.from(updated.bank_file_data, 'base64');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${updated.bank_file_name}"`);
  res.send(buf);
});

// GET /:id/bank-file-txt — download RCgen TXT
router.get('/:id/bank-file-txt', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });
  const { data: kase } = await db.from('payroll_cases').select('bank_receipt_name,bank_receipt_data').eq('id', req.params.id).single();
  if (!kase?.bank_receipt_data) return res.status(404).json({ error: 'TXT file not found. Generate bank files first.' });
  const buf = Buffer.from(kase.bank_receipt_data, 'base64');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="${kase.bank_receipt_name}"`);
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

// ─── Step 6b: In-app manual payment confirmation ──────────────────────────────

router.post('/:id/confirm-payment', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: kase } = await db.from('payroll_cases').select('*').eq('id', req.params.id).single();
  if (!kase) return res.status(404).json({ error: 'Case not found.' });
  if (!['payment_approval_sent', 'bank_uploaded'].includes(kase.status)) {
    return res.status(409).json({ error: `Cannot confirm payment from status: ${kase.status}` });
  }

  const now = new Date().toISOString();
  const cert = {
    type: 'PAYMENT_APPROVAL', reference: kase.reference,
    approvedBy: req.user.name || req.user.email,
    amount: `RM ${Number(kase.check_data?.ctcTotal || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`,
    consultantCount: kase.check_data?.consultantCount,
    bankPortalRef: kase.bank_portal_ref,
    entity: kase.entity_name || kase.entity, period: kase.period,
    timestamp: now, confirmedVia: 'in-app',
    stamp: `Payment Approved in Bank by: ${req.user.name} | Ref: ${kase.reference} | Date-Time: ${now} | Confirmed via: In-App`,
  };

  await db.from('payroll_cases').update({
    status: 'payment_approved',
    payment_approved_by: req.user.name || req.user.email,
    payment_approved_at: now, payment_approval_cert: cert,
  }).eq('id', kase.id);

  await auditLog(db, kase.id, 'PAYMENT_CONFIRMED_INAPP', req.user.name || req.user.email, String(req.user.id || ''), getIp(req), { cert });
  res.json({ confirmed: true });
});

// ─── Step 7: Post to Zoho Books — one journal entry per consultant ────────────

router.post('/:id/post-zoho', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: kase } = await db.from('payroll_cases').select('*').eq('id', req.params.id).single();
  if (!kase) return res.status(404).json({ error: 'Case not found.' });
  if (kase.status !== 'payment_approved') return res.status(409).json({ error: `Zoho posting requires payment approval. Status: ${kase.status}` });
  if (!kase.check_approval_cert || !kase.payment_approval_cert) return res.status(409).json({ error: 'Both approval certificates must exist.' });

  const { orgId, journalDate, payableAccountId, bankAccountId, sheetName } = req.body;
  if (!orgId || !journalDate || !payableAccountId || !bankAccountId || !sheetName) {
    return res.status(400).json({ error: 'orgId, journalDate, payableAccountId, bankAccountId, and sheetName are required.' });
  }

  const now = new Date().toISOString();
  const round2local = (n) => Math.round(parseFloat(n) * 100) / 100;

  const entities = kase.parsed_data?.entities || [];
  const allEmployees = entities.flatMap(ent => ent.employees.map(emp => ({ ...emp, entityName: ent.sheetName })));
  if (!allEmployees.length) return res.status(400).json({ error: 'No employee data found in case.' });

  // Book payment clearing: DR Salary Payable / CR Bank — one expense per consultant
  const results = [];
  for (const emp of allEmployees) {
    const amount = round2local(emp.ctcHexa);
    try {
      const expense = await createExpense(orgId, {
        account_id: payableAccountId,
        paid_through_account_id: bankAccountId,
        date: journalDate,
        amount,
        description: `${kase.type} Salary Payment – ${emp.name} (${emp.employeeId}) – ${kase.period} – Ref: ${kase.reference} – Approved: ${kase.payment_approved_by}`,
        reference_number: `PMT-${kase.reference}-${emp.employeeId}`,
        currency_code: 'MYR', exchange_rate: 1, is_billable: false,
      });
      results.push({ employeeId: emp.employeeId, name: emp.name, amount, journalId: expense?.expense_id, success: true });
    } catch (err) {
      results.push({ employeeId: emp.employeeId, name: emp.name, amount, error: err.message, success: false });
    }
  }

  const posted = results.filter(r => r.success);
  const failed  = results.filter(r => !r.success);
  const journalIds = posted.map(r => r.journalId).filter(Boolean);

  if (!posted.length) {
    return res.status(502).json({ error: 'All payment entries failed.', results });
  }

  // Attach Check Report PDF + Audit Package PDF to first expense
  if (journalIds[0]) {
    try {
      const { data: logRows } = await db.from('payroll_audit_log')
        .select('*').eq('case_id', kase.id).order('created_at', { ascending: true });
      const checkPdf = await buildCheckReportPdf(kase);
      const auditPdf = await buildAuditPackagePdf(kase, logRows || []);
      // Attach to the accrual journal from step 3 if exists, or skip
      if (kase.zoho_journal_ids?.[0]) {
        await attachJournalDocument(orgId, kase.zoho_journal_ids[0], checkPdf, `CheckReport-${kase.reference}.pdf`, 'application/pdf');
        await attachJournalDocument(orgId, kase.zoho_journal_ids[0], auditPdf, `AuditPackage-${kase.reference}.pdf`, 'application/pdf');
      }
    } catch (attachErr) {
      console.error('Zoho attachment error (non-fatal):', attachErr.message);
    }
  }

  await db.from('payroll_cases').update({
    status: 'zoho_posted', zoho_org_id: orgId,
    zoho_journal_ids: journalIds,
    zoho_posted_at: now, zoho_posted_by: req.user.name || req.user.email,
    audit_assembled_at: now,
  }).eq('id', kase.id);

  // Record summary in journal_posts for dashboard
  try {
    await db.from('journal_posts').insert({
      module: kase.type.toLowerCase(), entity: sheetName, org_id: orgId,
      journal_id: journalIds[0], reference_number: kase.reference,
      journal_date: journalDate,
      total_amount: round2local(allEmployees.reduce((s, e) => s + e.ctcHexa, 0)),
      notes: `${kase.type} Payroll – ${kase.period} – ${kase.entity_name || kase.entity} – Ref: ${kase.reference} – ${posted.length} consultants posted`,
      posted_by_email: req.user.email, posted_by_name: req.user.name || req.user.email,
    });
  } catch (_) {}

  await auditLog(db, kase.id, 'ZOHO_POSTED', req.user.name || req.user.email, String(req.user.id || ''), getIp(req), {
    journalIds, posted: posted.length, failed: failed.length, orgId,
    stamp: `Posted by: System API | Initiated by: ${req.user.name} | ${posted.length} journals | Ref: ${kase.reference} | Date-Time: ${now}`,
  });

  res.json({ posted: posted.length, failed: failed.length, results, referenceNumber: kase.reference });
});

// ─── Delete case (only if not completed) ─────────────────────────────────────

router.delete('/:id', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: kase } = await db.from('payroll_cases').select('id,status,reference').eq('id', req.params.id).single();
  if (!kase) return res.status(404).json({ error: 'Case not found.' });
  if (kase.status === 'zoho_posted') {
    return res.status(403).json({ error: 'Completed cases cannot be deleted.' });
  }

  // Delete tokens and audit log first (FK cascade should handle it, but be explicit)
  await db.from('payroll_approval_tokens').delete().eq('case_id', kase.id);
  await db.from('payroll_audit_log').delete().eq('case_id', kase.id);
  await db.from('payroll_cases').delete().eq('id', kase.id);

  res.json({ deleted: true, reference: kase.reference });
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
