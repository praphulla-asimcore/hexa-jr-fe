import React, { useState, useRef, useEffect } from 'react';
import { REGISTERED_BENEFICIARIES } from '../data/beneficiaryData.js';
import orgsConfig from '../orgsConfig.js';
import './FinanceOps.css';

function fmt(n) {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '0.00';
  return num.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildPirData(entities, payoutDate) {
  const [year, month, day] = payoutDate.split('-');
  const mmyy = `${month}${year.slice(2)}`;
  const displayDate = `${day}/${month}/${year}`;
  const rows = [];
  for (const entity of entities) {
    for (const emp of entity.employees) {
      rows.push({
        payoutDate: displayDate,
        payoutNature: 'Domestic Payment',
        type: 'CSI',
        beneficiary: emp.name,
        description: `${entity.sheetName}_${emp.name}_${mmyy}`,
        amountRequested: emp.netSalary,
        amountPIR: emp.netSalary,
        difference: 0,
        complianceCheck: 'Yes-FTEC',
        remarks: '',
        entity: entity.sheetName,
      });
    }
  }
  const total = rows.reduce((s, r) => s + r.amountRequested, 0);
  const grandTotal = Math.round(total * 100) / 100;
  return { title: 'MY_PIR Summary', subtitle: `Payout Details of ${displayDate}`, payoutDate, displayDate, rows, totalCSI: grandTotal, grandTotal };
}

function downloadCSV(pirData) {
  const esc = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;
  const line = (arr) => arr.map(esc).join(',');
  const lines = [
    line(['MY_PIR Summary']),
    line([`Payout Details of ${pirData.displayDate}`]),
    line([]),
    line(['Payout Date', 'Payout Nature', 'Type', 'Beneficiary', 'Expenses Description', 'Amount requested', 'Amount as per PIR', 'Difference', 'Compliance Check', 'Remarks']),
    ...pirData.rows.map((r) => line([r.payoutDate, r.payoutNature, r.type, r.beneficiary, r.description, r.amountRequested, r.amountPIR, r.difference, r.complianceCheck, r.remarks])),
    line(['', '', '', 'Total CSI', '', pirData.totalCSI, pirData.totalCSI, 0, '', '']),
    line([]),
    line(['', '', '', 'Grand Total', '', pirData.grandTotal, pirData.grandTotal, 0, '', '']),
  ];
  const csv = '﻿' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `PIR_Check_CSI_${pirData.payoutDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}


const STEPS = [
  { key: 'upload', label: 'Upload CSI' },
  { key: 'pir', label: 'PIR Check' },
  { key: 'approval', label: 'Approval' },
  { key: 'bank', label: 'Bank Upload' },
];

const STORAGE_KEY = 'hx_pir_state';

function saveState(pirId, step) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ pirId, step })); } catch {}
}
function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}

export default function FinanceOps({ authToken, user, resumePirId }) {
  const [step, setStepRaw] = useState('upload');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [entities, setEntities] = useState([]);
  const [payoutDate, setPayoutDate] = useState('');
  const [pirData, setPirData] = useState(null);
  const [pirId, setPirId] = useState(null);
  const [approvalStatus, setApprovalStatus] = useState('pending');
  const [reviewerEmail, setReviewerEmail] = useState('ujjwal@hexamatics.com');
  const [approverEmail, setApproverEmail] = useState('praphulla@hexamatics.com');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [settingStatus, setSettingStatus] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [beneficiaries, setBeneficiaries] = useState(null);
  const [generatingXlsx, setGeneratingXlsx] = useState(false);
  const [generatingTxt, setGeneratingTxt] = useState(false);
  const [bankError, setBankError] = useState('');
  const [resuming, setResuming] = useState(false);

  // Payment Completed state
  const [paymentOrg, setPaymentOrg] = useState('HCSSB');
  const [paymentAccounts, setPaymentAccounts] = useState([]);
  const [loadingPaymentAccounts, setLoadingPaymentAccounts] = useState(false);
  const [paymentAccountsError, setPaymentAccountsError] = useState('');
  const [payableAccountId, setPayableAccountId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [bookingPayment, setBookingPayment] = useState(false);
  const [paymentResult, setPaymentResult] = useState(null);
  const [paymentError, setPaymentError] = useState('');

  const fileRef = useRef();

  const headers = authToken ? { 'x-auth-token': authToken } : {};

  function setStep(s) {
    setStepRaw(s);
    if (pirId) saveState(pirId, s);
  }

  // Restore saved workflow on mount (either from prop or localStorage)
  useEffect(() => {
    const saved = resumePirId ? { pirId: resumePirId, step: 'approval' } : loadState();
    if (!saved?.pirId || !authToken) return;
    setResuming(true);
    fetch(`/api/finops/pir/${saved.pirId}`, { headers })
      .then((r) => r.ok ? r.json() : null)
      .then((rec) => {
        if (!rec?.pir_data) return;
        setPirData(rec.pir_data);
        setPayoutDate(rec.payout_date || '');
        setPirId(rec.id);
        setApprovalStatus(rec.approval_status || 'pending');
        setReviewerEmail(rec.reviewer_email || 'ujjwal@hexamatics.com');
        setApproverEmail(rec.approver_email || 'praphulla@hexamatics.com');
        setEmailSent(!!rec.email_sent_at);
        const restoredStep = rec.approval_status === 'approved' ? 'bank'
          : rec.approval_status === 'rejected' ? 'approval'
          : saved.step || 'approval';
        setStepRaw(restoredStep);
        saveState(rec.id, restoredStep);
      })
      .catch(() => {})
      .finally(() => setResuming(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist pirId+step whenever either changes
  useEffect(() => {
    if (pirId) saveState(pirId, step);
  }, [pirId, step]);

  // ── Step 1: Upload ──────────────────────────────────────
  async function handleFileUpload(file) {
    if (!payoutDate) { setUploadError('Please select a payout date first.'); return; }
    setUploading(true); setUploadError('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/parse', { method: 'POST', headers, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Parse failed.');
      setEntities(data.entities);
      const pir = buildPirData(data.entities, payoutDate);
      setPirData(pir);
      setStep('pir');
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  // ── Step 2 → 3: save PIR to DB ─────────────────────────
  async function handleProceedToApproval() {
    try {
      const res = await fetch('/api/finops/save-pir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ pirData, reviewerEmail, approverEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      setPirId(data.id);
      saveState(data.id, 'approval');
      setStepRaw('approval');
    } catch (err) {
      setStepRaw('approval');
    }
  }

  // ── Step 3: send approval email ────────────────────────
  async function handleSendEmail() {
    if (!pirId) { setApprovalError('PIR not saved. Go back and retry.'); return; }
    setSendingEmail(true); setApprovalError('');
    try {
      const res = await fetch('/api/finops/send-approval-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ pirId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed.');
      setEmailSent(true);
    } catch (err) {
      setApprovalError(err.message);
    } finally {
      setSendingEmail(false);
    }
  }

  async function handleSetStatus(status) {
    if (!pirId) { setApprovalStatus(status); setStep('bank'); return; }
    setSettingStatus(true); setApprovalError('');
    try {
      await fetch('/api/finops/set-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ pirId, status }),
      });
      setApprovalStatus(status);
      if (status === 'approved') setStep('bank');
    } catch (err) {
      setApprovalError(err.message);
    } finally {
      setSettingStatus(false);
    }
  }

  // ── Step 4: auto-match from Bank Beneficiary Registry ──
  function autoMatchFromRegistry(rows) {
    const byName = {};
    for (const b of REGISTERED_BENEFICIARIES) {
      byName[b.name.toLowerCase().trim()] = b;
    }
    return rows.map((row) => {
      const reg = byName[row.beneficiary.toLowerCase().trim()];
      if (!reg) {
        return { beneficiaryName: row.beneficiary, amount: row.amountRequested, description: row.description, matched: false };
      }
      const idType = reg.idType === 'NRIC' ? 'ic' : 'passport';
      const idNumber = reg.idType === 'NRIC' ? reg.idNew : reg.passport;
      const paymentMode = reg.bankCode === 'MBBEMYKL' ? 'IT' : 'IG';
      return {
        beneficiaryName: row.beneficiary,
        amount: row.amountRequested,
        description: row.description,
        favBeneCode: reg.code,
        accountNumber: reg.accountNo,
        bankCode: reg.bankCode,
        idNumber,
        idType,
        paymentMode,
        email: reg.email || '',
        advicePrefix: row.beneficiary,
        matched: true,
      };
    });
  }

  useEffect(() => {
    if (step === 'bank' && pirData?.rows && !beneficiaries) {
      setBeneficiaries(autoMatchFromRegistry(pirData.rows));
    }
  }, [step, pirData]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDownload(type) {
    const setter = type === 'xlsx' ? setGeneratingXlsx : setGeneratingTxt;
    setter(true); setBankError('');
    const matched = (beneficiaries || []).filter((b) => b.matched);
    try {
      const res = await fetch(`/api/finops/generate-bank-${type === 'xlsx' ? 'report' : 'txt'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ beneficiaryData: matched, payoutDate }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const [year, month, day] = payoutDate.split('-');
      a.download = type === 'xlsx'
        ? `Bank_Report_CSI_${day}${month}${year}.xlsx`
        : `RCgen_Payment_DP_${day}${month}${year}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setBankError(err.message);
    } finally {
      setter(false);
    }
  }

  // ── Payment Completed ───────────────────────────────────
  async function loadPaymentAccounts(orgKey) {
    const org = orgsConfig[orgKey];
    if (!org?.id) return;
    setLoadingPaymentAccounts(true);
    setPaymentAccountsError('');
    setPayableAccountId('');
    setBankAccountId('');
    setPaymentAccounts([]);
    try {
      const res = await fetch(`/api/accounts/${org.id}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load accounts.');
      setPaymentAccounts(data.accounts || []);
    } catch (err) {
      setPaymentAccountsError(err.message);
    } finally {
      setLoadingPaymentAccounts(false);
    }
  }

  async function handleBookPayment() {
    if (!payableAccountId || !bankAccountId) {
      setPaymentError('Please select both the payable account and bank account.');
      return;
    }
    const matched = (beneficiaries || []).filter((b) => b.matched);
    if (!matched.length) { setPaymentError('No matched consultants to book.'); return; }

    setBookingPayment(true);
    setPaymentError('');
    setPaymentResult(null);

    try {
      const org = orgsConfig[paymentOrg];
      const res = await fetch('/api/finops/book-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          pirId,
          orgId: org.id,
          payableAccountId,
          bankAccountId,
          payoutDate,
          beneficiaryData: matched,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Booking failed.');
      setPaymentResult(data);
    } catch (err) {
      setPaymentError(err.message);
    } finally {
      setBookingPayment(false);
    }
  }

  // ── Step indicator ─────────────────────────────────────
  const stepIdx = STEPS.findIndex((s) => s.key === step);

  if (resuming) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 32, color: 'var(--text-muted)' }}>
      <span className="spinner" />
      Restoring your workflow…
    </div>
  );

  return (
    <div className="finops-screen fade-in">
      <div className="screen-header">
        <h1 className="screen-title">Finance Operations</h1>
        <p className="screen-subtitle">PIR Check, approval workflow and bank payment file generation.</p>
      </div>

      <div className="flow-steps" style={{ marginBottom: 28 }}>
        {STEPS.map((s, i) => (
          <React.Fragment key={s.key}>
            <div className={`flow-step ${step === s.key ? 'flow-step-active' : i < stepIdx ? 'flow-step-done' : ''}`}>
              <span className="flow-step-num">{i + 1}</span>
              <span className="flow-step-label">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <span className="flow-step-sep" />}
          </React.Fragment>
        ))}
      </div>

      {/* ── Step 1: Upload ── */}
      {step === 'upload' && (
        <div className="finops-card card fade-in">
          <h2 className="finops-section-title">Upload CSI File</h2>
          <p className="finops-hint">Upload the CSI Excel file and select the payout date to generate the PIR Check.</p>
          <div className="finops-field">
            <label className="label">Payout Date</label>
            <input type="date" value={payoutDate} onChange={(e) => setPayoutDate(e.target.value)} style={{ maxWidth: 200 }} />
          </div>
          <div
            className="finops-dropzone"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f); }}
          >
            {uploading ? (
              <><span className="spinner" style={{ width: 28, height: 28 }} /><span>Parsing...</span></>
            ) : (
              <>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span>Drop CSI Excel here or <strong>click to browse</strong></span>
                <span className="finops-dropzone-sub">.xlsx files only</span>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) handleFileUpload(f); e.target.value = ''; }} />
          {uploadError && <div className="error-msg" style={{ marginTop: 12 }}>{uploadError}</div>}
        </div>
      )}

      {/* ── Step 2: PIR Check ── */}
      {step === 'pir' && pirData && (
        <div className="fade-in">
          <div className="finops-pir-header card">
            <div>
              <div className="finops-pir-title">{pirData.title}</div>
              <div className="finops-pir-sub">{pirData.subtitle}</div>
            </div>
            <div className="finops-pir-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => downloadCSV(pirData)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download CSV
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Print / PDF
              </button>
            </div>
          </div>

          <div className="finops-table-wrap card pir-print-area">
            <table className="finops-table">
              <thead>
                <tr>
                  <th>Date</th><th>Nature</th><th>Type</th><th>Beneficiary</th>
                  <th>Description</th><th style={{ textAlign: 'right' }}>Requested (RM)</th>
                  <th style={{ textAlign: 'right' }}>PIR (RM)</th><th style={{ textAlign: 'right' }}>Diff</th>
                  <th>Compliance</th>
                </tr>
              </thead>
              <tbody>
                {pirData.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.payoutDate}</td><td>{r.payoutNature}</td>
                    <td><span className="badge badge-info">{r.type}</span></td>
                    <td>{r.beneficiary}</td><td className="finops-desc">{r.description}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.amountRequested)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.amountPIR)}</td>
                    <td style={{ textAlign: 'right', color: r.difference !== 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{fmt(r.difference)}</td>
                    <td><span className="badge badge-success" style={{ fontSize: 11 }}>{r.complianceCheck}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="finops-subtotal">
                  <td colSpan={5} style={{ textAlign: 'right', fontWeight: 600 }}>Total CSI</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(pirData.totalCSI)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(pirData.totalCSI)}</td>
                  <td style={{ textAlign: 'right' }}>0.00</td><td />
                </tr>
                <tr className="finops-grandtotal">
                  <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700 }}>Grand Total</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(pirData.grandTotal)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(pirData.grandTotal)}</td>
                  <td style={{ textAlign: 'right' }}>0.00</td><td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="screen-actions">
            <div className="page-actions-left">
              <button className="btn btn-secondary" onClick={() => setStep('upload')}>Back</button>
            </div>
            <div className="page-actions-right">
              <button className="btn btn-primary" onClick={handleProceedToApproval}>Continue to Approval</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Approval ── */}
      {step === 'approval' && (
        <div className="finops-card card fade-in">
          <h2 className="finops-section-title">Review &amp; Approval</h2>
          <div className="finops-summary-row">
            <span>Payout Date</span><strong>{pirData?.displayDate}</strong>
            <span>Total</span><strong>RM {fmt(pirData?.grandTotal)}</strong>
            <span>Consultants</span><strong>{pirData?.rows?.length}</strong>
          </div>

          <div className="finops-divider" />

          <div className="finops-field">
            <label className="label">Reviewer Email</label>
            <input type="email" value={reviewerEmail} onChange={(e) => setReviewerEmail(e.target.value)} placeholder="reviewer@hexamatics.com" style={{ maxWidth: 320 }} />
          </div>
          <div className="finops-field">
            <label className="label">Approver Email</label>
            <input type="email" value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} placeholder="approver@hexamatics.com" style={{ maxWidth: 320 }} />
          </div>

          {approvalError && <div className="error-msg">{approvalError}</div>}

          {emailSent ? (
            <div className="success-msg" style={{ marginBottom: 16 }}>
              Approval email sent to {[reviewerEmail, approverEmail].filter(Boolean).join(' and ')}.
            </div>
          ) : (
            <button
              className="btn btn-secondary"
              onClick={handleSendEmail}
              disabled={sendingEmail || !pirId || (!reviewerEmail && !approverEmail)}
              style={{ marginBottom: 16 }}
            >
              {sendingEmail ? <><span className="spinner" style={{ width: 14, height: 14 }} />Sending...</> : 'Send Approval Email'}
            </button>
          )}

          <div className="finops-divider" />
          <div className="finops-status-row">
            <span className="label" style={{ margin: 0 }}>Approval Status</span>
            <span className={`badge ${approvalStatus === 'approved' ? 'badge-success' : approvalStatus === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>
              {approvalStatus.charAt(0).toUpperCase() + approvalStatus.slice(1)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => handleSetStatus('approved')}
              disabled={settingStatus || approvalStatus === 'approved'}
            >
              {settingStatus ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null}
              Mark Approved
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleSetStatus('rejected')}
              disabled={settingStatus || approvalStatus === 'rejected'}
            >
              Mark Rejected
            </button>
          </div>

          <div className="screen-actions" style={{ marginTop: 28 }}>
            <div className="page-actions-left">
              <button className="btn btn-secondary" onClick={() => setStep('pir')}>Back</button>
            </div>
            <div className="page-actions-right">
              {approvalStatus === 'approved' && (
                <button className="btn btn-primary" onClick={() => setStep('bank')}>Continue to Bank Upload</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Step 4: Bank Upload ── */}
      {step === 'bank' && (
        <div className="fade-in">
          <div className="finops-card card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <h2 className="finops-section-title" style={{ margin: 0 }}>Bank Payment File</h2>
              <span className="badge badge-info" style={{ fontSize: 11 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4, verticalAlign: 'middle' }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                Auto-matched from Bank Beneficiary Registry
              </span>
            </div>
            <p className="finops-hint" style={{ marginTop: 6 }}>
              Banking details have been looked up automatically from the registered beneficiary list.
              {beneficiaries && beneficiaries.some((b) => !b.matched) && (
                <> Unmatched consultants are highlighted — add them to the <strong>Bank Beneficiaries</strong> registry first.</>
              )}
            </p>

            {!beneficiaries && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', padding: '20px 0' }}>
                <span className="spinner" style={{ width: 18, height: 18 }} />
                Matching against registry…
              </div>
            )}

            {beneficiaries && (
              <div>
                <div className="finops-match-summary">
                  <span className="badge badge-success">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}><polyline points="20 6 9 17 4 12"/></svg>
                    {beneficiaries.filter((b) => b.matched).length} matched
                  </span>
                  {beneficiaries.some((b) => !b.matched) && (
                    <span className="badge badge-warning">
                      {beneficiaries.filter((b) => !b.matched).length} not in registry
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>
                    from {REGISTERED_BENEFICIARIES.length} registered beneficiaries
                  </span>
                </div>

                <div className="finops-table-wrap" style={{ marginTop: 12 }}>
                  <table className="finops-table finops-table-sm">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Consultant</th>
                        <th style={{ textAlign: 'right' }}>Amount (RM)</th>
                        <th>Mode</th>
                        <th>Account No.</th>
                        <th>Bank</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {beneficiaries.map((b, i) => (
                        <tr key={i} className={b.matched ? '' : 'finops-row-unmatched'}>
                          <td>
                            {b.favBeneCode
                              ? <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: 'var(--accent,#3b82f6)', background: 'var(--bg-secondary,#f0f0f0)', borderRadius: 4, padding: '1px 5px' }}>{b.favBeneCode}</span>
                              : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td>{b.beneficiaryName}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(b.amount)}</td>
                          <td>
                            {b.paymentMode
                              ? <span className={`badge ${b.paymentMode === 'IT' ? 'badge-info' : 'badge-neutral'}`}>{b.paymentMode}</span>
                              : '—'}
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{b.accountNumber || '—'}</td>
                          <td style={{ fontSize: 12 }}>{b.bankCode || '—'}</td>
                          <td>
                            <span className={`badge ${b.matched ? 'badge-success' : 'badge-warning'}`}>
                              {b.matched ? 'Ready' : 'Not found'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {beneficiaries?.some((b) => b.matched) && (
            <div className="finops-card card" style={{ marginTop: 16 }}>
              <h2 className="finops-section-title">Generate &amp; Download</h2>
              {bankError && <div className="error-msg" style={{ marginBottom: 12 }}>{bankError}</div>}
              <div className="finops-generate-actions">
                <div className="finops-generate-item">
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>RCgen TXT — Bank Upload File</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      Maybank2E RCMS pipe-delimited format. Upload directly to the bank portal.
                    </div>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => handleDownload('txt')} disabled={generatingTxt}>
                    {generatingTxt ? <><span className="spinner" style={{ width: 14, height: 14 }} />Generating…</> : (
                      <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 5 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download TXT</>
                    )}
                  </button>
                </div>
                <div className="finops-generate-item">
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>Bank Report XLSX</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Structured payment data — import into RCGEN2 or keep as record.</div>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleDownload('xlsx')} disabled={generatingXlsx}>
                    {generatingXlsx ? <><span className="spinner" style={{ width: 14, height: 14 }} />Generating…</> : (
                      <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 5 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download XLSX</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Payment Completed */}
          {beneficiaries?.some((b) => b.matched) && (
            <div className="finops-card card" style={{ marginTop: 16 }}>
              <div className="finops-payment-header">
                <div>
                  <h2 className="finops-section-title" style={{ margin: 0 }}>Payment Completed</h2>
                  <p className="finops-hint" style={{ marginTop: 4, marginBottom: 0 }}>
                    Once the Director approves and executes the payment in the bank, click below to automatically book the reversal entry in Zoho Books
                    (<strong>Dr Consultant Salary Payable / Cr Bank</strong>).
                  </p>
                </div>
                {paymentResult && (
                  <span className="badge badge-success" style={{ flexShrink: 0 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}><polyline points="20 6 9 17 4 12"/></svg>
                    {paymentResult.booked} posted
                  </span>
                )}
              </div>

              {!paymentResult && (
                <>
                  <div className="finops-payment-row">
                    <div className="finops-field" style={{ flex: 1, minWidth: 180 }}>
                      <label className="label">Zoho Entity</label>
                      <select
                        value={paymentOrg}
                        onChange={(e) => { setPaymentOrg(e.target.value); setPaymentAccounts([]); setPayableAccountId(''); setBankAccountId(''); }}
                      >
                        {Object.entries(orgsConfig).map(([key, org]) => (
                          <option key={key} value={key}>{org.name}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ paddingTop: 26 }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => loadPaymentAccounts(paymentOrg)}
                        disabled={loadingPaymentAccounts}
                      >
                        {loadingPaymentAccounts
                          ? <><span className="spinner" style={{ width: 13, height: 13 }} />Loading…</>
                          : 'Load Accounts'}
                      </button>
                    </div>
                  </div>

                  {paymentAccountsError && <div className="error-msg" style={{ marginTop: 8 }}>{paymentAccountsError}</div>}

                  {paymentAccounts.length > 0 && (
                    <div className="finops-payment-row" style={{ marginTop: 12 }}>
                      <div className="finops-field" style={{ flex: 1, minWidth: 200 }}>
                        <label className="label">Consultant Salary Payable Account <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <select value={payableAccountId} onChange={(e) => setPayableAccountId(e.target.value)}>
                          <option value="">— select payable account —</option>
                          {paymentAccounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="finops-field" style={{ flex: 1, minWidth: 200 }}>
                        <label className="label">Bank Account <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                          <option value="">— select bank account —</option>
                          {paymentAccounts.filter((a) => a.type === 'bank' || a.type === 'cash' || /bank|cash/i.test(a.type)).map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                          {paymentAccounts.filter((a) => !/bank|cash/i.test(a.type)).length > 0 && (
                            <optgroup label="Other accounts">
                              {paymentAccounts.filter((a) => !/bank|cash/i.test(a.type)).map((a) => (
                                <option key={a.id + '_o'} value={a.id}>{a.name} ({a.type})</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                    </div>
                  )}

                  {paymentError && <div className="error-msg" style={{ marginTop: 12 }}>{paymentError}</div>}

                  <div style={{ marginTop: 16 }}>
                    <button
                      className="btn btn-primary"
                      onClick={handleBookPayment}
                      disabled={bookingPayment || !payableAccountId || !bankAccountId}
                    >
                      {bookingPayment
                        ? <><span className="spinner" style={{ width: 14, height: 14 }} />Posting to Zoho Books…</>
                        : (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><polyline points="20 6 9 17 4 12"/></svg>
                            Payment Completed — Post to Zoho Books
                          </>
                        )}
                    </button>
                  </div>
                </>
              )}

              {paymentResult && (
                <div className="finops-payment-success">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="20 6 9 17 4 12"/></svg>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {paymentResult.booked} expense {paymentResult.booked === 1 ? 'entry' : 'entries'} posted to Zoho Books
                      {paymentResult.failed > 0 && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>({paymentResult.failed} failed)</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      Dr Consultant Salary Payable / Cr Bank — {beneficiaries.filter((b) => b.matched).length} consultants · RM {fmt(beneficiaries.filter((b) => b.matched).reduce((s, b) => s + parseFloat(b.amount || 0), 0))}
                    </div>
                    {paymentResult.errors?.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        {paymentResult.errors.map((e, i) => (
                          <div key={i} className="error-msg" style={{ fontSize: 12, marginBottom: 4 }}>{e.name}: {e.error}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="screen-actions">
            <div className="page-actions-left">
              <button className="btn btn-secondary" onClick={() => setStep('approval')}>Back</button>
            </div>
            <div className="page-actions-right">
              <button className="btn btn-secondary" onClick={() => { clearState(); setStepRaw('upload'); setEntities([]); setPirData(null); setPirId(null); setApprovalStatus('pending'); setEmailSent(false); setBeneficiaries(null); }}>
                New PIR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
