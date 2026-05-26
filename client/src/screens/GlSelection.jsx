import React, { useState, useEffect } from 'react';
import orgsConfig from '../orgsConfig.js';
import './GlSelection.css';

function creditLabelForDate(dateStr) {
  if (!dateStr) return 'Salary Payable';
  const day = new Date(dateStr + 'T00:00:00').getDate();
  if (day === 5) return 'Accrued Salaries Payable';
  return 'Salary Payable';
}

function fmtMonYear(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
}

function shortMonYear(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const mon = d.toLocaleDateString('en-MY', { month: 'short' });
  const yr = d.getFullYear().toString().slice(2);
  return `${mon}'${yr}`;
}

export default function GlSelection({ entities, paymentDate, onBack, onDone }) {
  const [accountsMap, setAccountsMap] = useState({});
  const [loadingMap, setLoadingMap] = useState({});
  const [errorMap, setErrorMap] = useState({});
  const [selections, setSelections] = useState({});
  const creditLabel = creditLabelForDate(paymentDate);

  useEffect(() => {
    const initial = {};
    entities.forEach((e) => {
      initial[e.sheetName] = { debitAccountId: '', creditAccountId: '' };
    });
    setSelections(initial);
  }, [entities]);

  async function loadAccounts(sheetName) {
    const orgId = orgsConfig[sheetName];
    if (!orgId || orgId === 'ZOHO_ORG_ID_HERE') {
      setErrorMap((p) => ({ ...p, [sheetName]: 'No Zoho org ID configured for this entity. Update orgsConfig.js.' }));
      return;
    }
    setLoadingMap((p) => ({ ...p, [sheetName]: true }));
    setErrorMap((p) => ({ ...p, [sheetName]: '' }));
    try {
      const res = await fetch(`/api/accounts/${orgId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load accounts.');
      setAccountsMap((p) => ({ ...p, [sheetName]: data.accounts }));
    } catch (err) {
      setErrorMap((p) => ({ ...p, [sheetName]: err.message }));
    } finally {
      setLoadingMap((p) => ({ ...p, [sheetName]: false }));
    }
  }

  function setSelection(sheetName, field, value) {
    setSelections((p) => ({ ...p, [sheetName]: { ...p[sheetName], [field]: value } }));
  }

  function allSelected() {
    return entities.every((e) => {
      const orgId = orgsConfig[e.sheetName];
      if (!orgId || orgId === 'ZOHO_ORG_ID_HERE') return true;
      const sel = selections[e.sheetName] || {};
      return sel.debitAccountId && sel.creditAccountId;
    });
  }

  function buildJeData() {
    const mon = fmtMonYear(paymentDate);
    const monShort = shortMonYear(paymentDate);
    return entities.map((entity) => {
      const sel = selections[entity.sheetName] || {};
      const accounts = accountsMap[entity.sheetName] || [];
      const debitAccount = accounts.find((a) => a.id === sel.debitAccountId) || { id: sel.debitAccountId, name: 'Consultant Salaries' };
      const creditAccount = accounts.find((a) => a.id === sel.creditAccountId) || { id: sel.creditAccountId, name: creditLabel };
      const orgId = orgsConfig[entity.sheetName];

      const lineItems = [
        {
          id: `debit-${entity.sheetName}`,
          account_id: debitAccount.id,
          account_name: debitAccount.name,
          debit_or_credit: 'debit',
          amount: entity.totalCTC,
          description: `Consultant Salaries — ${mon}`,
        },
        ...entity.employees.map((emp) => ({
          id: `credit-${emp.employeeId}`,
          account_id: creditAccount.id,
          account_name: creditAccount.name,
          debit_or_credit: 'credit',
          amount: emp.ctcHexa,
          description: `${emp.name}_${emp.costCentre}_${monShort}`,
        })),
      ];

      return {
        sheetName: entity.sheetName,
        orgId: orgId || '',
        referenceNumber: `HJFE-${entity.sheetName}-${monShort.replace("'", '')}`,
        notes: `Consultant Salaries ${mon} — ${entity.sheetName}`,
        lineItems,
        totalCTC: entity.totalCTC,
        employeeCount: entity.employees.length,
        hasOrgId: !!(orgId && orgId !== 'ZOHO_ORG_ID_HERE'),
      };
    });
  }

  function handleProceed() {
    const jeData = buildJeData();
    onDone({ glSelections: selections, jeData });
  }

  return (
    <div className="gl-screen fade-in">
      <div className="screen-header">
        <h1 className="screen-title">GL Account Selection</h1>
        <p className="screen-subtitle">
          Select debit and credit GL accounts for each entity. Credit accounts are pre-labelled as <strong>{creditLabel}</strong> based on payment date day.
        </p>
      </div>

      <div className="gl-list">
        {entities.map((entity) => {
          const orgId = orgsConfig[entity.sheetName];
          const noOrg = !orgId || orgId === 'ZOHO_ORG_ID_HERE';
          const accounts = accountsMap[entity.sheetName] || [];
          const loading = loadingMap[entity.sheetName] || false;
          const err = errorMap[entity.sheetName] || '';
          const sel = selections[entity.sheetName] || {};

          return (
            <div key={entity.sheetName} className={`gl-card card card-3d ${noOrg ? 'gl-card-warn' : ''}`}>
              <div className="gl-card-header">
                <div className="gl-card-title">
                  <span className="entity-name">{entity.sheetName}</span>
                  <span className="entity-meta">{entity.employees.length} consultants — RM {entity.totalCTC.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="gl-card-badges">
                  {noOrg && <span className="badge badge-warning">No org ID — will skip posting</span>}
                  {!noOrg && accounts.length === 0 && !loading && (
                    <button className="btn btn-secondary btn-sm" onClick={() => loadAccounts(entity.sheetName)}>
                      Load Accounts
                    </button>
                  )}
                  {loading && <><span className="spinner" /><span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading...</span></>}
                  {!noOrg && accounts.length > 0 && (
                    <span className="badge badge-success">{accounts.length} accounts loaded</span>
                  )}
                </div>
              </div>

              {err && <div style={{ padding: '0 24px 16px' }}><div className="error-msg">{err}</div></div>}

              {noOrg && (
                <div style={{ padding: '0 24px 20px' }}>
                  <div className="warn-msg">Entity <strong>{entity.sheetName}</strong> is not mapped in orgs.json. This entity will be skipped during posting.</div>
                </div>
              )}

              {!noOrg && (
                <div className="gl-fields">
                  <div className="gl-field">
                    <label className="label">Debit Account</label>
                    <select
                      value={sel.debitAccountId || ''}
                      onChange={(e) => setSelection(entity.sheetName, 'debitAccountId', e.target.value)}
                      disabled={accounts.length === 0}
                    >
                      <option value="">
                        {accounts.length === 0 ? '— load accounts first —' : '— select debit account —'}
                      </option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="gl-field">
                    <label className="label">Credit Account — {creditLabel}</label>
                    <select
                      value={sel.creditAccountId || ''}
                      onChange={(e) => setSelection(entity.sheetName, 'creditAccountId', e.target.value)}
                      disabled={accounts.length === 0}
                    >
                      <option value="">
                        {accounts.length === 0 ? '— load accounts first —' : '— select credit account —'}
                      </option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="screen-actions">
        <div className="page-actions-left">
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
        </div>
        <div className="page-actions-right">
          <button className="btn btn-primary btn-lg" onClick={handleProceed} disabled={!allSelected()}>
            Review Journal Entries
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
