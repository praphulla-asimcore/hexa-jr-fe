import React, { useState } from 'react';
import './JeReview.css';

function fmt(n) {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '0.00';
  return num.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function EntitySection({ je, posterName, onPostResult, module: mod, authToken }) {
  const [lines, setLines] = useState(je.lineItems);
  const [collapsed, setCollapsed] = useState(false);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const totalDebit = lines.filter((l) => l.debit_or_credit === 'debit').reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const totalCredit = lines.filter((l) => l.debit_or_credit === 'credit').reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  function updateLine(id, field, value) {
    setLines((prev) => prev.map((l) => l.id === id ? { ...l, [field]: field === 'amount' ? value : value } : l));
  }

  async function handlePost() {
    if (!je.hasOrgId) { setError('No org ID configured for this entity.'); return; }
    if (!balanced) { setError('Debits and credits are not balanced. Fix before posting.'); return; }
    setPosting(true);
    setError('');
    try {
      const payload = {
        sheetName: je.sheetName,
        journalDate: je.journalDate,
        referenceNumber: je.referenceNumber,
        notes: posterName ? `${je.notes} | Prepared by: ${posterName}` : je.notes,
        module: mod || 'csi',
        lineItems: lines.map((l) => ({
          account_id: l.account_id,
          debit_or_credit: l.debit_or_credit,
          amount: parseFloat(l.amount) || 0,
          description: l.description,
        })),
      };
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) headers['x-auth-token'] = authToken;
      const res = await fetch('/api/post-je', { method: 'POST', headers, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Posting failed.');
      setResult(data);
      onPostResult(je.sheetName, { status: 'posted', referenceNumber: data.referenceNumber, journalId: data.journalId });
    } catch (err) {
      setError(err.message);
      onPostResult(je.sheetName, { status: 'error', error: err.message });
    } finally {
      setPosting(false);
    }
  }

  const posted = result !== null;

  return (
    <div className={`je-section card ${posted ? 'je-section-posted' : ''}`}>
      <div className="je-section-header" onClick={() => setCollapsed((c) => !c)}>
        <div className="je-section-title">
          <div className="je-collapse-icon" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
          <span className="entity-name">{je.sheetName}</span>
          <span className="entity-meta">{je.employeeCount} consultants</span>
          {!je.hasOrgId && <span className="badge badge-warning">No org ID</span>}
        </div>
        <div className="je-section-meta" onClick={(e) => e.stopPropagation()}>
          <div className={`balance-indicator ${balanced ? 'balanced' : 'unbalanced'}`}>
            {balanced ? (
              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg> Balanced</>
            ) : (
              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> Off by RM {fmt(Math.abs(totalDebit - totalCredit))}</>
            )}
          </div>
          <span className="amount">RM {fmt(totalDebit)}</span>
          {posted ? (
            <span className="badge badge-success">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              Posted — {result.referenceNumber}
            </span>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              onClick={handlePost}
              disabled={posting || !balanced || !je.hasOrgId}
            >
              {posting ? <><span className="spinner" style={{ width: 14, height: 14 }} />Posting...</> : 'Post to Zoho'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: '0 24px 12px' }}>
          <div className="error-msg">{error}</div>
        </div>
      )}

      {!collapsed && (
        <div className="je-table-wrap">
          <table className="je-table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Type</th>
                <th>Account</th>
                <th style={{ width: 120, textAlign: 'right' }}>Amount (MYR)</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className={`je-row je-row-${line.debit_or_credit}`}>
                  <td>
                    <span className={`badge ${line.debit_or_credit === 'debit' ? 'badge-info' : 'badge-neutral'}`}>
                      {line.debit_or_credit === 'debit' ? 'Dr' : 'Cr'}
                    </span>
                  </td>
                  <td>
                    <input
                      type="text"
                      value={line.account_name || ''}
                      onChange={(e) => updateLine(line.id, 'account_name', e.target.value)}
                      disabled={posted}
                      className="je-cell-input"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={line.amount}
                      onChange={(e) => updateLine(line.id, 'amount', e.target.value)}
                      disabled={posted}
                      step="0.01"
                      min="0"
                      className="je-cell-input je-cell-amount"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={line.description || ''}
                      onChange={(e) => updateLine(line.id, 'description', e.target.value)}
                      disabled={posted}
                      className="je-cell-input"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="je-totals-row">
                <td colSpan={2} style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-secondary)' }}>Totals</td>
                <td style={{ textAlign: 'right' }}>
                  <div className="je-totals">
                    <span>Dr: <strong>RM {fmt(totalDebit)}</strong></span>
                    <span>Cr: <strong>RM {fmt(totalCredit)}</strong></span>
                  </div>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export default function JeReview({ jeData, paymentDate, onBack, onDone, module, authToken, user }) {
  const [posterName, setPosterName] = useState('');
  const [postResults, setPostResults] = useState({});
  const [postingAll, setPostingAll] = useState(false);

  const enriched = jeData.map((je) => ({ ...je, journalDate: paymentDate }));

  function handlePostResult(sheetName, result) {
    setPostResults((p) => ({ ...p, [sheetName]: result }));
  }

  const allPosted = enriched.every((je) => !je.hasOrgId || postResults[je.sheetName]?.status === 'posted');
  const anyPosted = Object.values(postResults).some((r) => r.status === 'posted');

  return (
    <div className="review-screen fade-in">
      <div className="screen-header">
        <h1 className="screen-title">Review & Post Journal Entries</h1>
        <p className="screen-subtitle">Verify each entry, edit if needed, then post to Zoho Books.</p>
      </div>

      <div className="review-toolbar card">
        <div className="review-toolbar-inner">
          <div className="poster-field">
            <label className="label">Prepared by</label>
            <input
              type="text"
              placeholder="e.g. Asim Subedi"
              value={posterName}
              onChange={(e) => setPosterName(e.target.value)}
              style={{ maxWidth: 280 }}
            />
          </div>
          <div className="review-toolbar-actions">
            <span className="review-progress">
              {Object.values(postResults).filter((r) => r.status === 'posted').length} / {enriched.filter((j) => j.hasOrgId).length} posted
            </span>
          </div>
        </div>
      </div>

      <div className="je-list">
        {enriched.map((je) => (
          <EntitySection
            key={je.sheetName}
            je={je}
            posterName={posterName}
            onPostResult={handlePostResult}
            module={module}
            authToken={authToken}
          />
        ))}
      </div>

      <div className="screen-actions">
        <div className="page-actions-left">
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
        </div>
        <div className="page-actions-right">
          {anyPosted && (
            <button className="btn btn-secondary" onClick={() => onDone(postResults)}>
              View Summary
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
