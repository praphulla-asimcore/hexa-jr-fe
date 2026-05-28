import React, { useState, useEffect, useCallback } from 'react';
import orgsConfig from '../orgsConfig.js';
import './PayrollFlow.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRM(n) {
  if (n == null) return '—';
  return 'RM ' + Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function autoEntityCode(name) {
  if (!name) return '';
  return name.split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 10);
}

function creditLabelForDate(dateStr) {
  if (!dateStr) return 'Salary Payable';
  return new Date(dateStr + 'T00:00:00').getDate() === 5 ? 'Accrued Salaries Payable' : 'Salary Payable';
}

function fmtMonYear(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
}

function shortMonYear(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.toLocaleDateString('en-MY', { month: 'short' })}'${d.getFullYear().toString().slice(2)}`;
}

// Status → active step number
function getActiveStep(status) {
  const map = {
    uploaded: 2, check_generated: 3, check_approval_sent: 3,
    check_reviewer_approved: 3, check_rejected: 3, check_approved: 4,
    bank_file_generated: 5, bank_uploaded: 5,
    payment_approval_sent: 6, payment_rejected: 6,
    payment_approved: 7, zoho_posted: 9,
  };
  return map[status] || 1;
}

// Per-step visual state
function stepState(stepNum, kase) {
  const s = kase.status;
  const DONE_AFTER = {
    1: true,
    2: ['check_generated','check_approval_sent','check_reviewer_approved','check_approved','check_rejected','bank_file_generated','bank_uploaded','payment_approval_sent','payment_approved','payment_rejected','zoho_posted'],
    3: ['check_approved','bank_file_generated','bank_uploaded','payment_approval_sent','payment_approved','payment_rejected','zoho_posted'],
    4: ['bank_file_generated','bank_uploaded','payment_approval_sent','payment_approved','payment_rejected','zoho_posted'],
    5: ['payment_approval_sent','payment_approved','payment_rejected','zoho_posted'],
    6: ['payment_approved','zoho_posted'],
    7: ['zoho_posted'],
    8: ['zoho_posted'],
    9: [],
  };
  if (stepNum === 1) return 'done';
  const doneList = DONE_AFTER[stepNum];
  if (!doneList) return 'pending';
  if (doneList === true || doneList.includes(s)) return 'done';
  if (stepNum === 3 && s === 'check_rejected') return 'rejected';
  if (stepNum === 6 && s === 'payment_rejected') return 'rejected';
  const active = getActiveStep(s);
  if (active === stepNum) return 'active';
  return 'pending';
}

const STEP_DEFS = [
  { num: 1, title: 'Upload & Intake Stamp', short: 'Upload' },
  { num: 2, title: 'AI Check File Generation', short: 'Check File' },
  { num: 3, title: 'Approval Gate (Check)', short: 'Check Approval' },
  { num: 4, title: 'Bank Upload File', short: 'Bank File' },
  { num: 5, title: 'FE Bank Upload', short: 'Bank Upload' },
  { num: 6, title: 'Payment Approval (Director)', short: 'Payment Approval' },
  { num: 7, title: 'Zoho Books Posting', short: 'Zoho Post' },
  { num: 8, title: 'FP&A Sub-Ledger', short: 'FP&A Ledger' },
  { num: 9, title: 'Audit Package Assembly', short: 'Audit Package' },
  { num: 10, title: 'Compliance Controls', short: 'Compliance' },
];

const STATUS_BADGE = {
  uploaded: ['Uploaded', 'neutral'],
  check_generated: ['Check Generated', 'info'],
  check_approval_sent: ['Pending Reviewer', 'warning'],
  check_reviewer_approved: ['Pending Final Approver', 'warning'],
  check_approved: ['Check Approved', 'success'],
  check_rejected: ['Check Rejected', 'danger'],
  bank_file_generated: ['Bank File Ready', 'info'],
  bank_uploaded: ['Bank Uploaded', 'info'],
  payment_approval_sent: ['Awaiting Director', 'warning'],
  payment_approved: ['Payment Approved', 'success'],
  payment_rejected: ['Payment Rejected', 'danger'],
  zoho_posted: ['Posted to Zoho', 'success'],
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PayrollFlow({ module, authToken, user }) {
  const type = module === 'csi' ? 'CSI' : 'PAYROLL';
  const [view, setView] = useState('list'); // list | new | detail
  const [cases, setCases] = useState([]);
  const [activeCase, setActiveCase] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);

  const headers = { 'x-auth-token': authToken };

  const loadCases = useCallback(async () => {
    setListLoading(true);
    try {
      const r = await fetch(`/api/payroll-cases?type=${type}`, { headers });
      const d = await r.json();
      setCases(d.cases || []);
    } finally {
      setListLoading(false);
    }
  }, [type, authToken]);

  useEffect(() => { if (view === 'list') loadCases(); }, [view, loadCases]);

  async function openCase(id) {
    setLoading(true);
    try {
      const r = await fetch(`/api/payroll-cases/${id}`, { headers });
      const d = await r.json();
      if (d.case) { setActiveCase(d); setView('detail'); }
    } finally { setLoading(false); }
  }

  async function refreshCase() {
    if (!activeCase?.case?.id) return;
    const r = await fetch(`/api/payroll-cases/${activeCase.case.id}`, { headers });
    const d = await r.json();
    if (d.case) setActiveCase(d);
  }

  if (view === 'list') return (
    <CaseList type={type} cases={cases} loading={listLoading}
      onNew={() => setView('new')} onOpen={openCase} module={module} />
  );
  if (view === 'new') return (
    <NewCaseForm type={type} authToken={authToken} user={user}
      onDone={(kase) => { setActiveCase({ case: kase, auditLog: [] }); setView('detail'); loadCases(); }}
      onBack={() => setView('list')} />
  );
  if (view === 'detail' && activeCase) return (
    <CaseDetail caseData={activeCase} authToken={authToken} user={user}
      onRefresh={refreshCase} onBack={() => setView('list')} />
  );
  return null;
}

// ─── Case List ────────────────────────────────────────────────────────────────

function CaseList({ type, cases, loading, onNew, onOpen, module }) {
  const label = module === 'csi' ? 'CSI' : 'Payroll';
  return (
    <div className="pf-screen fade-in">
      <div className="pf-list-header">
        <div>
          <h1 className="screen-title">{label} Cases</h1>
          <p className="screen-subtitle">{type} payroll workflow — 10-step audit trail</p>
        </div>
        <button className="btn btn-primary" onClick={onNew}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New {label} Run
        </button>
      </div>

      {loading ? (
        <div className="pf-loading"><span className="spinner"/><span>Loading cases…</span></div>
      ) : cases.length === 0 ? (
        <div className="pf-empty card">
          <div className="pf-empty-icon">📋</div>
          <div className="pf-empty-title">No {label} cases yet</div>
          <div className="pf-empty-sub">Start a new run to begin the 10-step workflow.</div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onNew}>New {label} Run</button>
        </div>
      ) : (
        <div className="pf-case-list">
          {cases.map(c => {
            const [statusLabel, statusColor] = STATUS_BADGE[c.status] || [c.status, 'neutral'];
            return (
              <div key={c.id} className="pf-case-row card" onClick={() => onOpen(c.id)}>
                <div className="pf-case-ref">
                  <span className="pf-ref-tag">{c.reference}</span>
                  <span className={`badge badge-${statusColor}`}>{statusLabel}</span>
                </div>
                <div className="pf-case-meta">
                  <span>{c.entity_name || c.entity}</span>
                  <span className="pf-dot"/>
                  <span>{c.period}</span>
                  <span className="pf-dot"/>
                  <span>{c.check_data?.consultantCount ?? '—'} consultants</span>
                  {c.check_data?.ctcTotal && <><span className="pf-dot"/><span>{fmtRM(c.check_data.ctcTotal)}</span></>}
                </div>
                <div className="pf-case-by">
                  Uploaded by {c.uploaded_by_name} · {fmtDate(c.uploaded_at)}
                  {c.zoho_posted_at && <span className="pf-zoho-tag"> · Posted {fmtDate(c.zoho_posted_at)}</span>}
                </div>
                <StepProgress kase={c} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StepProgress({ kase }) {
  return (
    <div className="pf-step-progress">
      {STEP_DEFS.slice(0, 9).map(s => {
        const state = stepState(s.num, kase);
        return <div key={s.num} className={`pf-prog-dot pf-prog-${state}`} title={`Step ${s.num}: ${s.short}`}/>;
      })}
    </div>
  );
}

// ─── New Case Form ────────────────────────────────────────────────────────────

const ORGS_LIST = Object.entries(orgsConfig).map(([code, cfg]) => ({ code, name: cfg.name, id: cfg.id }));

function detectPeriodFromFilename(name) {
  // Try YYYYMM directly (e.g. 202506)
  const m1 = name.match(/\b(20\d{2})(0[1-9]|1[0-2])\b/);
  if (m1) return m1[1] + m1[2];
  // Try YYYY-MM or YYYY_MM
  const m2 = name.match(/\b(20\d{2})[-_](0[1-9]|1[0-2])\b/);
  if (m2) return m2[1] + m2[2];
  // Try MM-YYYY or MM_YYYY
  const m3 = name.match(/\b(0[1-9]|1[0-2])[-_](20\d{2})\b/);
  if (m3) return m3[2] + m3[1];
  return null;
}

function detectEntityFromFilename(name) {
  const upper = name.toUpperCase();
  return ORGS_LIST.find(o => upper.includes(o.code)) || null;
}

function NewCaseForm({ type, authToken, user, onDone, onBack }) {
  const [file, setFile] = useState(null);
  const [entityCode, setEntityCode] = useState('');
  const [period, setPeriod] = useState(currentPeriod());
  const [paymentDate, setPaymentDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedOrg = ORGS_LIST.find(o => o.code === entityCode) || null;

  function handleFile(f) {
    setFile(f);
    if (!f) return;
    // Auto-detect entity from filename
    const detectedEntity = detectEntityFromFilename(f.name);
    if (detectedEntity && !entityCode) setEntityCode(detectedEntity.code);
    // Auto-detect period from filename
    const detectedPeriod = detectPeriodFromFilename(f.name);
    if (detectedPeriod) setPeriod(detectedPeriod);
  }

  async function handleSubmit() {
    if (!file) return setError('Please select a file.');
    if (!entityCode) return setError('Please select an entity.');
    if (!/^\d{6}$/.test(period)) return setError('Period must be YYYYMM (e.g. 202506).');

    setLoading(true); setError('');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', type);
    fd.append('entity', entityCode);
    fd.append('entityName', selectedOrg?.name || entityCode);
    fd.append('period', period);
    if (paymentDate) fd.append('paymentDate', paymentDate);

    try {
      const r = await fetch('/api/payroll-cases/upload', { method: 'POST', headers: { 'x-auth-token': authToken }, body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `Upload failed (${r.status})`);
      onDone(d.case);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pf-screen fade-in">
      <div className="screen-header">
        <button className="pf-back-btn" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <h1 className="screen-title">New {type} Run</h1>
        <p className="screen-subtitle">Upload the {type === 'CSI' ? 'consultant salary' : 'payroll'} file to begin the 10-step workflow</p>
      </div>

      <div className="pf-new-form card">
        <div className="pf-form-section">
          <label className="label">Payroll File <span className="req">*</span></label>
          <div className={`pf-drop-zone ${file ? 'pf-drop-zone-filled' : ''}`}
            onClick={() => document.getElementById('pf-file-input').click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
            <input id="pf-file-input" type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])} />
            {file ? (
              <div className="pf-drop-filled">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                <span>{file.name}</span>
                <span className="pf-drop-size">({(file.size / 1024).toFixed(0)} KB)</span>
              </div>
            ) : (
              <div className="pf-drop-placeholder">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span>Drop Excel file here or click to browse</span>
                <span className="pf-drop-hint">.xlsx / .xls · max 20 MB</span>
              </div>
            )}
          </div>
        </div>

        <div className="pf-form-row">
          <div className="pf-form-section" style={{ gridColumn: 'span 2' }}>
            <label className="label">Entity <span className="req">*</span></label>
            <select className="input" value={entityCode} onChange={e => setEntityCode(e.target.value)}>
              <option value="">— select entity —</option>
              {ORGS_LIST.map(o => (
                <option key={o.code} value={o.code}>{o.code} — {o.name}</option>
              ))}
            </select>
            {selectedOrg && (
              <span className="pf-hint">
                Code: <strong>{selectedOrg.code}</strong> · Zoho Org ID: <strong>{selectedOrg.id}</strong>
              </span>
            )}
          </div>
          <div className="pf-form-section">
            <label className="label">Period (YYYYMM) <span className="req">*</span></label>
            <input className="input" value={period} onChange={e => setPeriod(e.target.value)} placeholder="202506" maxLength={6} />
            <span className="pf-hint">Auto-detected from filename if possible</span>
          </div>
          <div className="pf-form-section">
            <label className="label">Payment Date</label>
            <input type="date" className="input" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
            <span className="pf-hint">Used for GL credit account labelling in Zoho</span>
          </div>
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div className="pf-form-actions">
          <button className="btn btn-secondary" onClick={onBack} disabled={loading}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || !file || !entityCode}>
            {loading ? <><span className="spinner"/>&nbsp;Uploading…</> : 'Upload & Create Case'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Case Detail ──────────────────────────────────────────────────────────────

function CaseDetail({ caseData, authToken, user, onRefresh, onBack }) {
  const kase = caseData.case;
  const logs = caseData.auditLog || [];
  const activeStep = getActiveStep(kase.status);
  const [selectedStep, setSelectedStep] = useState(activeStep);
  const [statusLabel, statusColor] = STATUS_BADGE[kase.status] || [kase.status, 'neutral'];

  useEffect(() => { setSelectedStep(getActiveStep(kase.status)); }, [kase.status]);

  return (
    <div className="pf-screen fade-in">
      <div className="pf-detail-header">
        <button className="pf-back-btn" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Cases
        </button>
        <div className="pf-detail-title">
          <span className="pf-ref-tag pf-ref-large">{kase.reference}</span>
          <span className={`badge badge-${statusColor}`}>{statusLabel}</span>
        </div>
        <div className="pf-detail-meta">
          {kase.entity_name || kase.entity} · {kase.period} · {kase.check_data?.consultantCount ?? '?'} consultants · {fmtRM(kase.check_data?.ctcTotal)}
        </div>
      </div>

      <div className="pf-layout">
        {/* Step tracker sidebar */}
        <div className="pf-tracker">
          {STEP_DEFS.map(s => {
            const state = stepState(s.num, kase);
            const isSelected = selectedStep === s.num;
            return (
              <button key={s.num}
                className={`pf-tracker-step pf-state-${state} ${isSelected ? 'pf-step-selected' : ''}`}
                onClick={() => setSelectedStep(s.num)}>
                <div className={`pf-step-circle pf-circle-${state}`}>
                  {state === 'done' ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    : state === 'rejected' ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    : <span>{s.num}</span>}
                </div>
                <div className="pf-step-info">
                  <div className="pf-step-num-label">Step {s.num}</div>
                  <div className="pf-step-title-label">{s.short}</div>
                </div>
                {s.num < 10 && <div className={`pf-step-connector pf-conn-${state}`}/>}
              </button>
            );
          })}
        </div>

        {/* Step detail panel */}
        <div className="pf-panel">
          <StepPanel step={selectedStep} kase={kase} logs={logs} authToken={authToken} user={user} onRefresh={onRefresh} />
        </div>
      </div>
    </div>
  );
}

// ─── Step Panels ──────────────────────────────────────────────────────────────

function StepPanel({ step, kase, logs, authToken, user, onRefresh }) {
  switch (step) {
    case 1: return <Step1Panel kase={kase} />;
    case 2: return <Step2Panel kase={kase} authToken={authToken} onRefresh={onRefresh} />;
    case 3: return <Step3Panel kase={kase} authToken={authToken} onRefresh={onRefresh} />;
    case 4: return <Step4Panel kase={kase} authToken={authToken} onRefresh={onRefresh} />;
    case 5: return <Step5Panel kase={kase} authToken={authToken} user={user} onRefresh={onRefresh} />;
    case 6: return <Step6Panel kase={kase} authToken={authToken} onRefresh={onRefresh} />;
    case 7: return <Step7Panel kase={kase} authToken={authToken} user={user} onRefresh={onRefresh} />;
    case 8: return <Step8Panel kase={kase} />;
    case 9: return <Step9Panel kase={kase} logs={logs} />;
    case 10: return <Step10Panel />;
    default: return null;
  }
}

function PanelHeader({ step, title, subtitle }) {
  return (
    <div className="pf-panel-header">
      <span className="pf-panel-step">Step {step}</span>
      <h2 className="pf-panel-title">{title}</h2>
      {subtitle && <p className="pf-panel-sub">{subtitle}</p>}
    </div>
  );
}

function StampBox({ label, value }) {
  return (
    <div className="pf-stamp-box">
      <span className="pf-stamp-label">{label}</span>
      <span className="pf-stamp-value">{value}</span>
    </div>
  );
}

// Step 1 — Upload & Intake
function Step1Panel({ kase }) {
  return (
    <div className="pf-panel-body">
      <PanelHeader step={1} title="Upload & Intake Stamp" subtitle="File received and locked in system." />
      <div className="pf-info-grid">
        <StampBox label="Uploaded by" value={kase.uploaded_by_name} />
        <StampBox label="Date-Time" value={fmtDate(kase.uploaded_at)} />
        <StampBox label="IP Address" value={kase.upload_ip || '—'} />
        <StampBox label="File" value={kase.original_file_name || '—'} />
        <StampBox label="SHA-256 Hash" value={kase.original_file_hash ? kase.original_file_hash.slice(0, 24) + '…' : '—'} />
        <StampBox label="Payment Date" value={kase.payment_date || '—'} />
        <StampBox label="Reference" value={kase.reference} />
      </div>
      {kase.parsed_data?.entities && (
        <div className="pf-detail-card">
          <div className="pf-detail-card-title">Parsed Entities</div>
          {kase.parsed_data.entities.map(e => (
            <div key={e.sheetName} className="pf-entity-row">
              <span className="pf-entity-name">{e.sheetName}</span>
              <span>{e.employees.length} employees</span>
              <span>{fmtRM(e.totalCTC)}</span>
              {e.missingColumns?.length > 0 && <span className="badge badge-warning">missing cols</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Step 2 — Check File
function Step2Panel({ kase, authToken, onRefresh }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isDone = ['check_generated','check_approval_sent','check_reviewer_approved','check_approved','check_rejected','bank_file_generated','bank_uploaded','payment_approval_sent','payment_approved','payment_rejected','zoho_posted'].includes(kase.status);

  async function generate() {
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/payroll-cases/${kase.id}/gen-check`, { method: 'POST', headers: { 'x-auth-token': authToken } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await onRefresh();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const check = kase.check_data;
  return (
    <div className="pf-panel-body">
      <PanelHeader step={2} title="AI Check File Generation" subtitle="Rule-based validation against the uploaded file." />
      {!isDone && kase.status === 'uploaded' && (
        <div className="pf-action-zone">
          <p className="pf-action-desc">Generate the check file to validate consultant counts, payroll totals, and statutory breakdown.</p>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn btn-primary" onClick={generate} disabled={loading}>
            {loading ? <><span className="spinner"/>&nbsp;Generating…</> : 'Generate Check File'}
          </button>
        </div>
      )}
      {check && (
        <div className="pf-check-summary">
          <StampBox label="Generated by" value={`${check.generatedBy} · ${fmtDate(check.generatedAt)}`} />
          <StampBox label="Reference" value={kase.reference} />
          <div className="pf-check-grid">
            <div className="pf-check-stat"><div className="pf-check-val">{check.consultantCount}</div><div className="pf-check-key">Consultants</div></div>
            <div className="pf-check-stat"><div className="pf-check-val">{fmtRM(check.grossPayrollTotal)}</div><div className="pf-check-key">Gross Payroll</div></div>
            <div className="pf-check-stat"><div className="pf-check-val">{fmtRM(check.ctcTotal)}</div><div className="pf-check-key">Total CTC</div></div>
            <div className="pf-check-stat"><div className="pf-check-val">{fmtRM(check.netSalaryTotal)}</div><div className="pf-check-key">Net Salary</div></div>
          </div>
          <div className="pf-detail-card">
            <div className="pf-detail-card-title">Statutory Breakdown</div>
            {Object.entries(check.statutory || {}).map(([k, v]) => (
              <div key={k} className="pf-stat-row"><span className="pf-stat-key">{k.toUpperCase()}</span><span>{fmtRM(v)}</span></div>
            ))}
          </div>
          {check.flagCount > 0 ? (
            <div className="pf-flags-card pf-flags-warn">
              <div className="pf-flags-header">{check.flagCount} Exception(s) Flagged</div>
              {check.flags.slice(0, 10).map((f, i) => (
                <div key={i} className="pf-flag-row">
                  <span className="pf-flag-code">{f.code}</span>
                  <span>{f.employee || f.entity || ''}</span>
                  {f.diff && <span className="pf-flag-diff">Δ {fmtRM(f.diff)}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="pf-flags-card pf-flags-ok">No exceptions — all checks passed.</div>
          )}
        </div>
      )}
    </div>
  );
}

// Step 3 — Check Approval
function Step3Panel({ kase, authToken, onRefresh }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canSend = kase.status === 'check_generated';
  const isApproved = ['check_approved','bank_file_generated','bank_uploaded','payment_approval_sent','payment_approved','payment_rejected','zoho_posted'].includes(kase.status);
  const isRejected = kase.status === 'check_rejected';

  async function sendApproval() {
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/payroll-cases/${kase.id}/send-check-approval`, { method: 'POST', headers: { 'x-auth-token': authToken } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await onRefresh();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="pf-panel-body">
      <PanelHeader step={3} title="Approval Gate (Check)" subtitle="Sequential approval: First Reviewer → Final Approver." />

      <div className="pf-approver-chain">
        <ApproverBox name="Asim Subedi" role="First Reviewer"
          status={['check_reviewer_approved','check_approved','bank_file_generated','bank_uploaded','payment_approval_sent','payment_approved','payment_rejected','zoho_posted'].includes(kase.status) ? 'approved' : isRejected && kase.check_rejection_reason?.includes('Asim') ? 'rejected' : kase.status === 'check_approval_sent' ? 'pending' : 'waiting'}
          timestamp={kase.check_reviewer_approved_at} />
        <div className="pf-chain-arrow">→</div>
        <ApproverBox name="Praphulla Subedi" role="Final Approver"
          status={isApproved ? 'approved' : isRejected && !kase.check_rejection_reason?.includes('Ikhram') ? 'rejected' : kase.status === 'check_reviewer_approved' ? 'pending' : 'waiting'}
          timestamp={kase.check_approved_at} />
      </div>

      {canSend && (
        <div className="pf-action-zone">
          <p className="pf-action-desc">Send the check file to Ikhram Merican for first review. Approval email will be sent automatically.</p>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn btn-primary" onClick={sendApproval} disabled={loading}>
            {loading ? <><span className="spinner"/>&nbsp;Sending…</> : 'Send for Approval'}
          </button>
        </div>
      )}

      {['check_approval_sent','check_reviewer_approved'].includes(kase.status) && (
        <div className="pf-info-banner pf-banner-waiting">
          Approval email sent {fmtDate(kase.check_approval_sent_at)}. Waiting for approver response.
          <button className="btn btn-secondary btn-sm" style={{ marginLeft: 12 }} onClick={onRefresh}>Refresh</button>
        </div>
      )}

      {isRejected && (
        <div className="pf-info-banner pf-banner-danger">
          Check rejected: {kase.check_rejection_reason}
        </div>
      )}

      {isApproved && kase.check_approval_cert && (
        <div className="pf-cert-box">
          <div className="pf-cert-title">Approval Certificate Issued</div>
          <StampBox label="Approved by" value={kase.check_approval_cert.approvedBy} />
          <StampBox label="Reviewed by" value={kase.check_approval_cert.reviewedBy} />
          <StampBox label="Date-Time" value={fmtDate(kase.check_approval_cert.timestamp)} />
          <StampBox label="Ref" value={kase.reference} />
        </div>
      )}
    </div>
  );
}

function ApproverBox({ name, role, status, timestamp }) {
  const colors = { approved: 'success', rejected: 'danger', pending: 'warning', waiting: 'neutral' };
  const labels = { approved: 'Approved', rejected: 'Rejected', pending: 'Awaiting', waiting: 'Not yet sent' };
  return (
    <div className="pf-approver-box">
      <div className="pf-approver-name">{name}</div>
      <div className="pf-approver-role">{role}</div>
      <span className={`badge badge-${colors[status]}`}>{labels[status]}</span>
      {timestamp && <div className="pf-approver-time">{fmtDate(timestamp)}</div>}
    </div>
  );
}

// Step 4 — Bank File
function Step4Panel({ kase, authToken, onRefresh }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canGenerate = kase.status === 'check_approved';
  const isDone = ['bank_file_generated','bank_uploaded','payment_approval_sent','payment_approved','payment_rejected','zoho_posted'].includes(kase.status);

  async function generate() {
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/payroll-cases/${kase.id}/gen-bank-file`, { method: 'POST', headers: { 'x-auth-token': authToken } });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `BANKFILE-${kase.reference}.xlsx`; a.click();
      URL.revokeObjectURL(url);
      await onRefresh();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function redownload() {
    if (!kase.bank_file_data) return;
    const bin = atob(kase.bank_file_data);
    const arr = new Uint8Array(bin.length).map((_, i) => bin.charCodeAt(i));
    const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = kase.bank_file_name || `BANKFILE-${kase.reference}.xlsx`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="pf-panel-body">
      <PanelHeader step={4} title="Bulk Bank Upload File Generation" subtitle="Generated only after Approval Certificate. File is locked after generation." />
      {canGenerate && (
        <div className="pf-action-zone">
          <p className="pf-action-desc">Generate the bank upload file. File hash (SHA-256) will be recorded — any tampering before bank upload is detectable.</p>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn btn-primary" onClick={generate} disabled={loading}>
            {loading ? <><span className="spinner"/>&nbsp;Generating…</> : 'Generate & Download Bank File'}
          </button>
        </div>
      )}
      {isDone && (
        <>
          <div className="pf-info-banner pf-banner-ok">Bank file generated and locked.</div>
          <div className="pf-info-grid">
            <StampBox label="File name" value={kase.bank_file_name || '—'} />
            <StampBox label="SHA-256" value={kase.bank_file_hash ? kase.bank_file_hash.slice(0, 24) + '…' : '—'} />
            <StampBox label="Generated at" value={fmtDate(kase.bank_file_generated_at)} />
            <StampBox label="Triggered by" value={kase.bank_file_triggered_by || '—'} />
          </div>
          {kase.bank_file_data && (
            <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={redownload}>Re-download Bank File</button>
          )}
        </>
      )}
    </div>
  );
}

// Step 5 — FE Bank Upload
function Step5Panel({ kase, authToken, onRefresh }) {
  const [ref, setRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canLog = kase.status === 'bank_file_generated';

  async function logUpload() {
    if (!ref.trim()) return setError('Bank portal reference number is required.');
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/payroll-cases/${kase.id}/log-bank-upload`, {
        method: 'POST', headers: { 'x-auth-token': authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankPortalRef: ref.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await onRefresh();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="pf-panel-body">
      <PanelHeader step={5} title="FE Manual Bank Upload" subtitle="Log the bank portal reference after uploading the file to the bank." />

      {canLog && (
        <div className="pf-action-zone">
          <label className="label">Bank Portal Reference Number</label>
          <input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. TXN-2026050001" style={{ marginBottom: 10 }} />
          {error && <div className="error-msg">{error}</div>}
          <button className="btn btn-primary" onClick={logUpload} disabled={loading}>
            {loading ? <><span className="spinner"/>&nbsp;Logging…</> : 'Log Bank Upload'}
          </button>
        </div>
      )}

      {kase.bank_upload_at && (
        <div className="pf-info-banner pf-banner-ok" style={{ marginBottom: 16 }}>Bank upload logged.</div>
      )}

      {kase.bank_upload_at && (
        <div className="pf-info-grid">
          <StampBox label="Uploaded by" value={kase.bank_upload_by} />
          <StampBox label="Bank Portal Ref" value={kase.bank_portal_ref} />
          <StampBox label="Date-Time" value={fmtDate(kase.bank_upload_at)} />
        </div>
      )}
    </div>
  );
}

// Step 6 — Director Payment Approval
function Step6Panel({ kase, authToken, onRefresh }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canSend = kase.status === 'bank_uploaded' && !!kase.bank_receipt_attached_at;
  const isApproved = ['payment_approved','zoho_posted'].includes(kase.status);
  const isRejected = kase.status === 'payment_rejected';
  const isPending = kase.status === 'payment_approval_sent';

  async function sendApproval() {
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/payroll-cases/${kase.id}/send-payment-approval`, { method: 'POST', headers: { 'x-auth-token': authToken } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await onRefresh();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="pf-panel-body">
      <PanelHeader step={6} title="Payment Approval (Director)" subtitle="Director approval required before Zoho posting." />
      <div className="pf-approver-chain">
        <ApproverBox name="Dato Thiruchelvapalan" role="Director"
          status={isApproved ? 'approved' : isRejected ? 'rejected' : isPending ? 'pending' : 'waiting'}
          timestamp={kase.payment_approved_at} />
      </div>

      {canSend && (
        <div className="pf-action-zone">
          <p className="pf-action-desc">Send payment approval request to the Director with payroll summary, consultant count, gross amount, and bank reference.</p>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn btn-primary" onClick={sendApproval} disabled={loading}>
            {loading ? <><span className="spinner"/>&nbsp;Sending…</> : 'Send Payment Approval to Director'}
          </button>
        </div>
      )}

      {isPending && (
        <div className="pf-info-banner pf-banner-waiting">
          Payment approval email sent to Dato Thiruchelvapalan {fmtDate(kase.payment_approval_sent_at)}.
          <button className="btn btn-secondary btn-sm" style={{ marginLeft: 12 }} onClick={onRefresh}>Refresh</button>
        </div>
      )}

      {isRejected && <div className="pf-info-banner pf-banner-danger">Payment rejected: {kase.payment_rejection_reason}</div>}

      {isApproved && kase.payment_approval_cert && (
        <div className="pf-cert-box">
          <div className="pf-cert-title">Payment Approval Certificate Issued</div>
          <StampBox label="Approved by" value={kase.payment_approval_cert.approvedBy} />
          <StampBox label="Amount" value={kase.payment_approval_cert.amount} />
          <StampBox label="Bank Portal Ref" value={kase.payment_approval_cert.bankPortalRef} />
          <StampBox label="Date-Time" value={fmtDate(kase.payment_approval_cert.timestamp)} />
        </div>
      )}
    </div>
  );
}

// Step 7 — Zoho Posting (with GL selection)
function Step7Panel({ kase, authToken, user, onRefresh }) {
  const [orgId, setOrgId] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [debitAccount, setDebitAccount] = useState('');
  const [creditAccount, setCreditAccount] = useState('');
  const [journalDate, setJournalDate] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const isDone = kase.status === 'zoho_posted';
  const canPost = kase.status === 'payment_approved';

  const entities = kase.parsed_data?.entities || [];
  const check = kase.check_data || {};

  // Detect org from entity name
  useEffect(() => {
    if (!orgId && entities.length) {
      const ent = entities[0];
      const org = orgsConfig[ent.sheetName];
      if (org?.id) setOrgId(org.id);
    }
    if (!journalDate) {
      // Use stored payment date if available, otherwise default to end of period
      if (kase.payment_date) {
        setJournalDate(kase.payment_date);
      } else {
        const p = kase.period;
        if (p?.length === 6) setJournalDate(`${p.slice(0, 4)}-${p.slice(4, 6)}-28`);
      }
    }
  }, []);

  async function loadAccounts() {
    if (!orgId) return setError('Select an org first.');
    setAccountsLoading(true); setError('');
    try {
      const r = await fetch(`/api/accounts/${orgId}`, { headers: { 'x-auth-token': authToken } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setAccounts(d.accounts || []);
    } catch (e) { setError(e.message); }
    finally { setAccountsLoading(false); }
  }

  async function postToZoho() {
    if (!orgId || !debitAccount || !creditAccount || !journalDate) return setError('All fields required.');
    setPosting(true); setError('');

    const creditLabel = creditLabelForDate(journalDate);
    const monLabel = fmtMonYear(journalDate);
    const monShort = shortMonYear(journalDate);
    const entity = entities[0];
    const sheetName = entity?.sheetName || kase.entity_name || kase.entity;

    const debitAcc = accounts.find(a => a.id === debitAccount) || { id: debitAccount, name: 'Consultant Salaries' };
    const creditAcc = accounts.find(a => a.id === creditAccount) || { id: creditAccount, name: creditLabel };

    const lineItems = [
      { account_id: debitAcc.id, debit_or_credit: 'debit', amount: check.ctcTotal || 0, description: `${kase.type} Salaries — ${monLabel}` },
      ...(entity?.employees || []).map(emp => ({
        account_id: creditAcc.id, debit_or_credit: 'credit', amount: emp.ctcHexa,
        description: `${emp.name}_${emp.costCentre}_${monShort}`,
      })),
    ];

    try {
      const r = await fetch(`/api/payroll-cases/${kase.id}/post-zoho`, {
        method: 'POST',
        headers: { 'x-auth-token': authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, journalDate, sheetName, lineItems }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await onRefresh();
    } catch (e) { setError(e.message); }
    finally { setPosting(false); }
  }

  if (isDone) return (
    <div className="pf-panel-body">
      <PanelHeader step={7} title="Zoho Books Posting" subtitle="Journal entry posted and linked to case." />
      <div className="pf-info-banner pf-banner-ok">Posted to Zoho Books successfully.</div>
      <div className="pf-info-grid">
        <StampBox label="Zoho Journal ID" value={(kase.zoho_journal_ids || [])[0] || '—'} />
        <StampBox label="Posted by" value={kase.zoho_posted_by} />
        <StampBox label="Date-Time" value={fmtDate(kase.zoho_posted_at)} />
        <StampBox label="Reference" value={kase.reference} />
      </div>
    </div>
  );

  const orgs = Object.entries(orgsConfig).map(([name, cfg]) => ({ name, id: cfg.id, label: cfg.name || name }));

  return (
    <div className="pf-panel-body">
      <PanelHeader step={7} title="Zoho Books Posting" subtitle="Requires both approval certificates. Select GL accounts and post." />
      {!canPost && <div className="pf-info-banner pf-banner-warning">Payment approval (Step 6) required before posting.</div>}
      {canPost && (
        <>
          <div className="pf-gl-form">
            <div className="pf-form-section">
              <label className="label">Organisation</label>
              <select className="input" value={orgId} onChange={e => { setOrgId(e.target.value); setAccounts([]); setDebitAccount(''); setCreditAccount(''); }}>
                <option value="">— select org —</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.label} ({o.name})</option>)}
              </select>
            </div>
            <div className="pf-form-section">
              <label className="label">Journal Date</label>
              <input type="date" className="input" value={journalDate} onChange={e => setJournalDate(e.target.value)} />
            </div>
          </div>

          {orgId && accounts.length === 0 && (
            <button className="btn btn-secondary" onClick={loadAccounts} disabled={accountsLoading}>
              {accountsLoading ? <><span className="spinner"/>&nbsp;Loading…</> : 'Load GL Accounts'}
            </button>
          )}

          {accounts.length > 0 && (
            <div className="pf-gl-form" style={{ marginTop: 16 }}>
              <div className="pf-form-section">
                <label className="label">Debit Account (Salary Expense)</label>
                <select className="input" value={debitAccount} onChange={e => setDebitAccount(e.target.value)}>
                  <option value="">— select —</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.type} — {a.name}</option>)}
                </select>
              </div>
              <div className="pf-form-section">
                <label className="label">Credit Account ({creditLabelForDate(journalDate)})</label>
                <select className="input" value={creditAccount} onChange={e => setCreditAccount(e.target.value)}>
                  <option value="">— select —</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.type} — {a.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="pf-je-preview">
            <div className="pf-detail-card-title">Journal Entry Preview</div>
            <div className="pf-je-row"><span>DR {debitAccount ? accounts.find(a=>a.id===debitAccount)?.name || '…' : '—'}</span><span>{fmtRM(check.ctcTotal)}</span></div>
            <div className="pf-je-row pf-je-credit"><span>CR {creditAccount ? accounts.find(a=>a.id===creditAccount)?.name || '…' : `${creditLabelForDate(journalDate)} (×${entities[0]?.employees?.length || 0} lines)`}</span><span>{fmtRM(check.ctcTotal)}</span></div>
            <div className="pf-je-narration">Narration: {kase.type} Payroll – {kase.period} – {kase.entity_name || kase.entity} – Ref: {kase.reference}</div>
          </div>

          {error && <div className="error-msg">{error}</div>}
          <button className="btn btn-primary btn-lg" onClick={postToZoho}
            disabled={posting || !orgId || !debitAccount || !creditAccount || !journalDate}>
            {posting ? <><span className="spinner"/>&nbsp;Posting…</> : 'Post to Zoho Books'}
          </button>
        </>
      )}
    </div>
  );
}

// Step 8 — FP&A (placeholder)
function Step8Panel({ kase }) {
  const isDone = kase.status === 'zoho_posted';
  return (
    <div className="pf-panel-body">
      <PanelHeader step={8} title="FP&A Sub-Ledger" subtitle="Auto-generated upon Zoho posting." />
      {isDone ? (
        <div className="pf-info-banner pf-banner-ok">FP&A ledger auto-assembled with {kase.check_data?.consultantCount} rows.</div>
      ) : (
        <div className="pf-pending-step">Auto-generated after Zoho posting.</div>
      )}
    </div>
  );
}

// Step 9 — Audit Package
function buildAuditPackageHtml(kase, logs) {
  const docs = [
    { num: 1, name: 'Original CSI/Payroll File', detail: kase.original_file_name, stamp: kase.original_file_hash ? `SHA-256: ${kase.original_file_hash}` : null, done: true },
    { num: 2, name: 'AI-Generated Check File', detail: `Generated: ${fmtDate(kase.check_generated_at)}`, stamp: kase.check_data ? `Consultants: ${kase.check_data.consultantCount} · CTC: ${fmtRM(kase.check_data.ctcTotal)} · Flags: ${kase.check_data.flagCount}` : null, done: !!kase.check_generated_at },
    { num: 3, name: 'CSI Check Approval Certificate', detail: kase.check_approval_cert ? `Approved by: ${kase.check_approval_cert.approvedBy} · Reviewed by: ${kase.check_approval_cert.reviewedBy}` : null, stamp: kase.check_approval_cert ? kase.check_approval_cert.stamp : null, done: !!kase.check_approval_cert },
    { num: 4, name: 'Bank Upload File', detail: kase.bank_file_name, stamp: kase.bank_file_hash ? `SHA-256: ${kase.bank_file_hash}` : null, done: !!kase.bank_file_generated_at },
    { num: 5, name: 'Bank Upload Log', detail: kase.bank_upload_at ? `Uploaded by: ${kase.bank_upload_by} · Bank Ref: ${kase.bank_portal_ref}` : null, stamp: kase.bank_upload_at ? `Date-Time: ${fmtDate(kase.bank_upload_at)}` : null, done: !!kase.bank_upload_at },
    { num: 6, name: 'Payment Approval Certificate', detail: kase.payment_approval_cert ? `Approved by: ${kase.payment_approval_cert.approvedBy} · Amount: ${kase.payment_approval_cert.amount}` : null, stamp: kase.payment_approval_cert ? kase.payment_approval_cert.stamp : null, done: !!kase.payment_approval_cert },
    { num: 7, name: 'Zoho Journal Confirmation', detail: (kase.zoho_journal_ids || [])[0] ? `Zoho JV: ${kase.zoho_journal_ids[0]}` : null, stamp: kase.zoho_posted_at ? `Posted by: ${kase.zoho_posted_by} · Date-Time: ${fmtDate(kase.zoho_posted_at)}` : null, done: !!kase.zoho_posted_at },
    { num: 8, name: 'Immutable Audit Log', detail: `${logs.length} system events recorded`, done: logs.length > 0 },
  ];

  const docRows = docs.map(d => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:${d.done ? '#166534' : '#94a3b8'}">${d.done ? '✓' : d.num}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#111">${d.name}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151">${d.detail || '—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;font-family:monospace">${d.stamp || ''}</td>
    </tr>`).join('');

  const logRows = logs.map(l => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-size:11px;color:#6366f1;white-space:nowrap">${l.event_type}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px">${l.performed_by || 'System'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;white-space:nowrap">${fmtDate(l.created_at)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#94a3b8">${l.ip_address || ''}</td>
    </tr>`).join('');

  const check = kase.check_data || {};

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>AUDIT-PKG-${kase.reference}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; padding: 32px 40px; }
    @media print {
      body { padding: 16px 24px; }
      .no-print { display: none !important; }
      @page { margin: 1.5cm; size: A4; }
    }
    h1 { font-size: 22px; font-weight: 800; color: #6366f1; }
    h2 { font-size: 14px; font-weight: 700; color: #374151; margin: 24px 0 10px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th { background: #f8fafc; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border-bottom: 2px solid #e2e8f0; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 3px solid #6366f1; }
    .header-left h1 { margin-bottom: 4px; }
    .header-left p { color: #64748b; font-size: 12px; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .badge-green { background: #dcfce7; color: #166534; }
    .badge-yellow { background: #fef9c3; color: #854d0e; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .meta-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
    .meta-key { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 3px; }
    .meta-val { font-size: 14px; font-weight: 700; color: #111; }
    .print-btn { position: fixed; top: 20px; right: 20px; background: #6366f1; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 8px rgba(99,102,241,0.3); }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <button class="no-print print-btn" onclick="window.print()">⬇ Save as PDF</button>

  <div class="header">
    <div class="header-left">
      <h1>AUDIT-PKG-${kase.reference}</h1>
      <p>Hexa Finance · Payroll Audit Package · Generated: ${new Date().toLocaleString('en-MY')}</p>
      <p style="margin-top:4px">Retention policy: 7 years · Read-only · Append-only storage</p>
    </div>
    <div>
      <span class="badge ${kase.status === 'zoho_posted' ? 'badge-green' : 'badge-yellow'}">${kase.status.replace(/_/g,' ').toUpperCase()}</span>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><div class="meta-key">Reference</div><div class="meta-val" style="color:#6366f1">${kase.reference}</div></div>
    <div class="meta-item"><div class="meta-key">Type</div><div class="meta-val">${kase.type}</div></div>
    <div class="meta-item"><div class="meta-key">Entity</div><div class="meta-val">${kase.entity_name || kase.entity}</div></div>
    <div class="meta-item"><div class="meta-key">Period</div><div class="meta-val">${kase.period}</div></div>
    <div class="meta-item"><div class="meta-key">Consultants</div><div class="meta-val">${check.consultantCount ?? '—'}</div></div>
    <div class="meta-item"><div class="meta-key">Gross Payroll</div><div class="meta-val">${fmtRM(check.grossPayrollTotal)}</div></div>
    <div class="meta-item"><div class="meta-key">Total CTC</div><div class="meta-val">${fmtRM(check.ctcTotal)}</div></div>
    <div class="meta-item"><div class="meta-key">Payment Date</div><div class="meta-val">${kase.payment_date || '—'}</div></div>
  </div>

  <h2>Document Registry</h2>
  <table>
    <thead><tr><th style="width:40px">#</th><th>Document</th><th>Detail</th><th>Stamp / Hash</th></tr></thead>
    <tbody>${docRows}</tbody>
  </table>

  ${kase.check_approval_cert ? `
  <h2>Check Approval Certificate</h2>
  <table>
    <tbody>
      <tr><td style="padding:6px 10px;width:200px;color:#64748b">Reference</td><td style="padding:6px 10px;font-weight:600">${kase.reference}</td></tr>
      <tr><td style="padding:6px 10px;color:#64748b">First Reviewer</td><td style="padding:6px 10px">${kase.check_approval_cert.reviewedBy || '—'} · ${fmtDate(kase.check_reviewer_approved_at)}</td></tr>
      <tr><td style="padding:6px 10px;color:#64748b">Final Approver</td><td style="padding:6px 10px">${kase.check_approval_cert.approvedBy} · ${fmtDate(kase.check_approved_at)}</td></tr>
      <tr><td style="padding:6px 10px;color:#64748b">Stamp</td><td style="padding:6px 10px;font-family:monospace;font-size:11px">${kase.check_approval_cert.stamp || '—'}</td></tr>
    </tbody>
  </table>` : ''}

  ${kase.payment_approval_cert ? `
  <h2>Payment Approval Certificate</h2>
  <table>
    <tbody>
      <tr><td style="padding:6px 10px;width:200px;color:#64748b">Reference</td><td style="padding:6px 10px;font-weight:600">${kase.reference}</td></tr>
      <tr><td style="padding:6px 10px;color:#64748b">Approved by (Director)</td><td style="padding:6px 10px">${kase.payment_approval_cert.approvedBy} · ${fmtDate(kase.payment_approved_at)}</td></tr>
      <tr><td style="padding:6px 10px;color:#64748b">Amount Approved</td><td style="padding:6px 10px;font-weight:700">${kase.payment_approval_cert.amount}</td></tr>
      <tr><td style="padding:6px 10px;color:#64748b">Bank Portal Ref</td><td style="padding:6px 10px">${kase.payment_approval_cert.bankPortalRef || '—'}</td></tr>
      <tr><td style="padding:6px 10px;color:#64748b">Stamp</td><td style="padding:6px 10px;font-family:monospace;font-size:11px">${kase.payment_approval_cert.stamp || '—'}</td></tr>
    </tbody>
  </table>` : ''}

  ${check.statutory ? `
  <h2>Statutory Breakdown</h2>
  <table>
    <thead><tr><th>Component</th><th>Amount (RM)</th></tr></thead>
    <tbody>
      <tr><td style="padding:6px 10px">EPF (Employer)</td><td style="padding:6px 10px">${fmtRM(check.statutory.epf)}</td></tr>
      <tr><td style="padding:6px 10px">EIS (Employer)</td><td style="padding:6px 10px">${fmtRM(check.statutory.eis)}</td></tr>
      <tr><td style="padding:6px 10px">SOCSO (Employer)</td><td style="padding:6px 10px">${fmtRM(check.statutory.socso)}</td></tr>
      <tr><td style="padding:6px 10px">HRDF</td><td style="padding:6px 10px">${fmtRM(check.statutory.hrdf)}</td></tr>
      <tr><td style="padding:6px 10px">MTD (PCB)</td><td style="padding:6px 10px">${fmtRM(check.statutory.mtd)}</td></tr>
    </tbody>
  </table>` : ''}

  <h2>Immutable Audit Log (${logs.length} Events)</h2>
  <table>
    <thead><tr><th>Event</th><th>Performed By</th><th>Date-Time</th><th>IP Address</th></tr></thead>
    <tbody>${logRows}</tbody>
  </table>

  <div class="footer">
    AUDIT-PKG-${kase.reference} · Hexa Finance · hexamatics.finance · Generated ${new Date().toISOString()} · Retain until ${new Date(new Date().setFullYear(new Date().getFullYear() + 7)).getFullYear()}
  </div>
</body>
</html>`;
}

function Step9Panel({ kase, logs }) {
  const docs = [
    { num: 1, name: 'Original file', detail: kase.original_file_name, stamp: kase.original_file_hash ? `SHA-256: ${kase.original_file_hash.slice(0,16)}…` : null, done: true },
    { num: 2, name: 'AI Check file', detail: fmtDate(kase.check_generated_at), done: !!kase.check_generated_at },
    { num: 3, name: 'Check Approval Certificate', detail: kase.check_approved_at ? `Approved: ${fmtDate(kase.check_approved_at)}` : null, done: !!kase.check_approval_cert },
    { num: 4, name: 'Bank upload file', detail: kase.bank_file_name, stamp: kase.bank_file_hash ? `SHA-256: ${kase.bank_file_hash.slice(0,16)}…` : null, done: !!kase.bank_file_generated_at },
    { num: 5, name: 'Bank upload log', detail: kase.bank_upload_at ? `Ref: ${kase.bank_portal_ref}` : null, done: !!kase.bank_upload_at },
    { num: 6, name: 'Payment Approval Certificate', detail: kase.payment_approved_at ? `Approved: ${fmtDate(kase.payment_approved_at)}` : null, done: !!kase.payment_approval_cert },
    { num: 7, name: 'Zoho journal confirmation', detail: (kase.zoho_journal_ids || [])[0] ? `JV: ${kase.zoho_journal_ids[0]}` : null, done: !!kase.zoho_posted_at },
    { num: 8, name: 'Audit log (full event trail)', detail: `${logs.length} events`, done: logs.length > 0 },
  ];

  function downloadPdf() {
    const html = buildAuditPackageHtml(kase, logs);
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 800);
  }

  return (
    <div className="pf-panel-body">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <PanelHeader step={9} title="Audit Package Assembly" subtitle={`AUDIT-PKG-${kase.reference} — retained 7 years`} />
        </div>
        <button className="btn btn-primary" onClick={downloadPdf} style={{ marginTop: 4, flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download PDF
        </button>
      </div>

      <div className="pf-audit-docs">
        {docs.map(doc => (
          <div key={doc.num} className={`pf-audit-doc ${doc.done ? 'pf-audit-doc-done' : 'pf-audit-doc-pending'}`}>
            <div className="pf-audit-doc-num">{doc.done ? '✓' : doc.num}</div>
            <div className="pf-audit-doc-info">
              <div className="pf-audit-doc-name">{doc.name}</div>
              {doc.detail && <div className="pf-audit-doc-detail">{doc.detail}</div>}
              {doc.stamp && <div className="pf-audit-doc-stamp">{doc.stamp}</div>}
            </div>
          </div>
        ))}
      </div>

      {logs.length > 0 && (
        <div className="pf-detail-card" style={{ marginTop: 20 }}>
          <div className="pf-detail-card-title">Immutable Audit Log ({logs.length} events)</div>
          {logs.map(l => (
            <div key={l.id} className="pf-log-row">
              <span className="pf-log-event">{l.event_type}</span>
              <span className="pf-log-by">{l.performed_by || 'System'}</span>
              <span className="pf-log-time">{fmtDate(l.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Step 10 — Compliance
function Step10Panel() {
  const controls = [
    'No step can be skipped — each step is a system prerequisite for the next',
    'No document can be deleted or overwritten — append-only storage',
    'All user actions carry: User ID, Role, Timestamp, IP address',
    'Rejection loops back with mandatory reason field — reason stored',
    'Immutable audit log satisfies IAS 19, IFRS 15, IAS 1, IAS 24',
    'GIA can access any package by reference number without contacting FE',
    'File hashes (SHA-256) detect any tampering before bank upload',
    'Director approval captured via secure link — not WhatsApp',
    '24-hour auto-escalation logged if approver does not respond',
    'Retained 7 years per internal policy and regulatory requirement',
  ];
  return (
    <div className="pf-panel-body">
      <PanelHeader step={10} title="Compliance Controls" subtitle="Built-in controls satisfying audit and regulatory requirements." />
      <div className="pf-compliance-list">
        {controls.map((c, i) => (
          <div key={i} className="pf-compliance-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <span>{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
