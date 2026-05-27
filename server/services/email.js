const { Resend } = require('resend');

let _resend = null;

function getResend() {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

const FROM = process.env.EMAIL_FROM || 'noreply@hexamatics.finance';

async function sendInvite({ to, name, inviteUrl }) {
  const resend = getResend();
  if (!resend) return;
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'You\'ve been invited to Hexa Finance',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <img src="https://hexajrfe.hexamatics.finance/hexa-logo.png" alt="Hexa" style="height:32px;margin-bottom:24px" />
        <h2 style="font-size:20px;font-weight:700;color:#111;margin:0 0 8px">You're invited</h2>
        <p style="color:#555;margin:0 0 24px">Hi ${name || to}, you have been invited to access the Hexa Finance Journal Poster.</p>
        <a href="${inviteUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Accept Invitation</a>
        <p style="color:#999;font-size:12px;margin-top:24px">This link expires in 48 hours.</p>
      </div>
    `,
  });
}

async function sendJournalNotification({ postedByName, postedByEmail, module: mod, entity, referenceNumber, journalDate, amount, recipients }) {
  const resend = getResend();
  if (!resend || !recipients?.length) return;
  const moduleLabel = mod === 'payroll' ? 'Payroll' : 'CSI';
  await resend.emails.send({
    from: FROM,
    to: recipients,
    subject: `[Hexa Finance] ${moduleLabel} Journal Posted — ${entity} ${referenceNumber}`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <img src="https://hexajrfe.hexamatics.finance/hexa-logo.png" alt="Hexa" style="height:32px;margin-bottom:24px" />
        <h2 style="font-size:18px;font-weight:700;color:#111;margin:0 0 16px">Journal Entry Posted</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#888;width:140px">Module</td><td style="color:#111;font-weight:600">${moduleLabel}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Entity</td><td style="color:#111;font-weight:600">${entity}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Reference</td><td style="color:#111;font-weight:600">${referenceNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Date</td><td style="color:#111">${journalDate}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Amount</td><td style="color:#111">RM ${Number(amount).toLocaleString('en-MY', { minimumFractionDigits: 2 })}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Posted by</td><td style="color:#111">${postedByName} (${postedByEmail})</td></tr>
        </table>
        <p style="color:#999;font-size:12px;margin-top:24px">Hexa Finance · hexamatics.finance</p>
      </div>
    `,
  });
}

async function sendPirApprovalEmail({ recipients, pir, approveUrl, rejectUrl, createdBy }) {
  const resend = getResend();
  if (!resend || !recipients?.length) return;

  const amount = Number(pir.total_amount).toLocaleString('en-MY', { minimumFractionDigits: 2 });
  const rowCount = pir.pir_data?.rows?.length || 0;

  const rowsHtml = (pir.pir_data?.rows || []).map((r) => `
    <tr>
      <td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:12px">${r.payoutDate}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:12px">${r.beneficiary}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:12px">${r.description}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:right">RM ${Number(r.amountRequested).toLocaleString('en-MY', { minimumFractionDigits: 2 })}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:12px">${r.complianceCheck}</td>
    </tr>`).join('');

  await resend.emails.send({
    from: FROM,
    to: recipients,
    subject: `[Hexa Finance] PIR Check — Approval Required (${pir.payout_date})`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:720px;margin:0 auto;padding:32px 24px">
        <img src="https://hexajrfe.hexamatics.finance/hexa-logo.png" alt="Hexa" style="height:32px;margin-bottom:24px" />
        <h2 style="font-size:18px;font-weight:700;color:#111;margin:0 0 4px">MY_PIR Summary — Review &amp; Approval Required</h2>
        <p style="color:#555;margin:0 0 24px">Prepared by: <strong>${createdBy}</strong> &nbsp;·&nbsp; Payout Date: <strong>${pir.payout_date}</strong> &nbsp;·&nbsp; ${rowCount} consultants &nbsp;·&nbsp; Total: <strong>RM ${amount}</strong></p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:28px">
          <thead>
            <tr style="background:#f8fafc">
              <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #e2e8f0;font-size:12px">Date</th>
              <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #e2e8f0;font-size:12px">Beneficiary</th>
              <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #e2e8f0;font-size:12px">Description</th>
              <th style="padding:6px 8px;text-align:right;border-bottom:2px solid #e2e8f0;font-size:12px">Amount</th>
              <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #e2e8f0;font-size:12px">Compliance</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot>
            <tr style="background:#f8fafc;font-weight:700">
              <td colspan="3" style="padding:8px;text-align:right;font-size:13px">Total CSI</td>
              <td style="padding:8px;text-align:right;font-size:13px">RM ${amount}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div style="margin-bottom:32px">
          <a href="${approveUrl}" style="display:inline-block;background:#22c55e;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin-right:12px">Approve</a>
          <a href="${rejectUrl}" style="display:inline-block;background:#ef4444;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Reject</a>
        </div>
        <p style="color:#999;font-size:12px">Hexa Finance &nbsp;·&nbsp; hexamatics.finance</p>
      </div>`,
  });
}

module.exports = { sendInvite, sendJournalNotification, sendPirApprovalEmail };
