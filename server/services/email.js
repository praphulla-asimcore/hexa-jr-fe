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

module.exports = { sendInvite, sendJournalNotification };
