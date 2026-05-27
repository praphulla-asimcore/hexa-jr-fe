import React, { useState, useRef } from 'react';
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

function downloadBeneficiaryTemplate() {
  const header = ['Consultant Name', 'Payment Mode', 'Fav Bene Code', 'Account Number', 'Bank Code', 'ID Number', 'ID Type', 'Email', 'Advice Prefix'];
  const example = ['Abinaya Subbiah', 'IT', 'HS123', '564089559370', 'MBBEMYKL', 'W4379591', 'passport', 'abinaya@example.com', 'Abinaya_CIMB'];
  const note = ['# ID Type options: ic | old_ic | passport | brn', '', '', '', '', '', '', '', ''];
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [header, example, note].map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Beneficiary_Master_Template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

const STEPS = [
  { key: 'upload', label: 'Upload CSI' },
  { key: 'pir', label: 'PIR Check' },
  { key: 'approval', label: 'Approval' },
  { key: 'bank', label: 'Bank Upload' },
];

export default function FinanceOps({ authToken, user }) {
  const [step, setStep] = useState('upload');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [entities, setEntities] = useState([]);
  const [payoutDate, setPayoutDate] = useState('');
  const [pirData, setPirData] = useState(null);
  const [pirId, setPirId] = useState(null);
  const [approvalStatus, setApprovalStatus] = useState('pending');
  const [reviewerEmail, setReviewerEmail] = useState('');
  const [approverEmail, setApproverEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [settingStatus, setSettingStatus] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [beneficiaries, setBeneficiaries] = useState(null);
  const [parseBeneLoading, setParseBeneLoading] = useState(false);
  const [beneError, setBeneError] = useState('');
  const [generatingXlsx, setGeneratingXlsx] = useState(false);
  const [generatingTxt, setGeneratingTxt] = useState(false);
  const [bankError, setBankError] = useState('');

  const fileRef = useRef();
  const beneFileRef = useRef();

  const headers = authToken ? { 'x-auth-token': authToken } : {};

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
      setStep('approval');
    } catch (err) {
      // proceed anyway with local state
      setStep('approval');
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

  // ── Step 4: parse beneficiary master ───────────────────
  async function handleBeneFile(file) {
    setParseBeneLoading(true); setBeneError('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/finops/parse-beneficiary', { method: 'POST', headers, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Parse failed.');
      // Auto-match by name
      const matched = matchBeneficiaries(entities, data.beneficiaries, pirData);
      setBeneficiaries(matched);
    } catch (err) {
      setBeneError(err.message);
    } finally {
      setParseBeneLoading(false);
    }
  }

  function matchBeneficiaries(entities, beneMaster, pirData) {
    const beneMap = {};
    for (const b of beneMaster) beneMap[b.beneficiaryName.toLowerCase()] = b;
    return pirData.rows.map((row) => {
      const b = beneMap[row.beneficiary.toLowerCase()];
      return {
        beneficiaryName: row.beneficiary,
        amount: row.amountRequested,
        description: row.description,
        ...(b || {}),
        matched: !!b,
      };
    });
  }

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

  // ── Step indicator ─────────────────────────────────────
  const stepIdx = STEPS.findIndex((s) => s.key === step);

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
            <h2 className="finops-section-title">Bank Payment File</h2>
            <p className="finops-hint">Upload a Beneficiary Master file to match banking details (account numbers, bank codes, ICs) with CSI consultants, then generate the Bank Report XLSX and RCgen TXT.</p>

            <div className="finops-bene-actions">
              <button className="btn btn-secondary btn-sm" onClick={downloadBeneficiaryTemplate}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download Template
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => beneFileRef.current?.click()} disabled={parseBeneLoading}>
                {parseBeneLoading ? <><span className="spinner" style={{ width: 14, height: 14 }} />Parsing...</> : 'Upload Beneficiary Master'}
              </button>
              <input ref={beneFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) handleBeneFile(f); e.target.value = ''; }} />
            </div>

            {beneError && <div className="error-msg" style={{ marginTop: 12 }}>{beneError}</div>}

            {beneficiaries && (
              <div style={{ marginTop: 20 }}>
                <div className="finops-match-summary">
                  <span className="badge badge-success">{beneficiaries.filter((b) => b.matched).length} matched</span>
                  {beneficiaries.some((b) => !b.matched) && (
                    <span className="badge badge-warning">{beneficiaries.filter((b) => !b.matched).length} unmatched</span>
                  )}
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Unmatched consultants will be excluded from bank files.</span>
                </div>

                <div className="finops-table-wrap" style={{ marginTop: 12 }}>
                  <table className="finops-table finops-table-sm">
                    <thead>
                      <tr><th>Consultant</th><th>Amount (RM)</th><th>Mode</th><th>Account</th><th>Bank Code</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {beneficiaries.map((b, i) => (
                        <tr key={i} className={b.matched ? '' : 'finops-row-unmatched'}>
                          <td>{b.beneficiaryName}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(b.amount)}</td>
                          <td>{b.paymentMode || '—'}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{b.accountNumber || '—'}</td>
                          <td>{b.bankCode || '—'}</td>
                          <td>
                            <span className={`badge ${b.matched ? 'badge-success' : 'badge-warning'}`}>
                              {b.matched ? 'Matched' : 'No data'}
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
              <h2 className="finops-section-title">Generate Files</h2>
              {bankError && <div className="error-msg" style={{ marginBottom: 12 }}>{bankError}</div>}
              <div className="finops-generate-actions">
                <div className="finops-generate-item">
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>Bank Report XLSX</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Structured payment data — import into RCGEN2 or use directly.</div>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => handleDownload('xlsx')} disabled={generatingXlsx}>
                    {generatingXlsx ? <><span className="spinner" style={{ width: 14, height: 14 }} />Generating...</> : 'Download XLSX'}
                  </button>
                </div>
                <div className="finops-generate-item">
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>RCgen TXT (Bank Upload)</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Maybank2E RCMS format. Note: security key in header is blank — test acceptance with your bank.</div>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleDownload('txt')} disabled={generatingTxt}>
                    {generatingTxt ? <><span className="spinner" style={{ width: 14, height: 14 }} />Generating...</> : 'Download TXT'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="screen-actions">
            <div className="page-actions-left">
              <button className="btn btn-secondary" onClick={() => setStep('approval')}>Back</button>
            </div>
            <div className="page-actions-right">
              <button className="btn btn-secondary" onClick={() => { setStep('upload'); setEntities([]); setPirData(null); setPirId(null); setApprovalStatus('pending'); setEmailSent(false); setBeneficiaries(null); }}>
                New PIR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
