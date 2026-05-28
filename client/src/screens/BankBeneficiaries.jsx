import React, { useState, useEffect, useMemo } from 'react';
import './BankBeneficiaries.css';

function contractStatus(endDate) {
  if (!endDate) return 'unknown';
  return new Date(endDate) >= new Date() ? 'active' : 'expired';
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatSalary(n) {
  if (n == null) return '—';
  return 'RM ' + Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BankBeneficiaries() {
  const [consultants, setConsultants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetch('/api/consultants')
      .then((r) => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json();
      })
      .then((d) => setConsultants(d.consultants || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => {
    const active = consultants.filter((c) => contractStatus(c.contractEnd) === 'active').length;
    const expired = consultants.filter((c) => contractStatus(c.contractEnd) === 'expired').length;
    return { active, expired, all: consultants.length };
  }, [consultants]);

  const filtered = useMemo(() => {
    let list = consultants;
    if (filter === 'active') list = list.filter((c) => contractStatus(c.contractEnd) === 'active');
    if (filter === 'expired') list = list.filter((c) => contractStatus(c.contractEnd) === 'expired');
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.employeeNumber.toLowerCase().includes(q) ||
          c.client.toLowerCase().includes(q) ||
          c.accountNo.includes(q)
      );
    }
    return list;
  }, [consultants, filter, search]);

  return (
    <div className="bene-screen fade-in">
      <div className="screen-header">
        <h1 className="screen-title">Consultant Database</h1>
        <p className="screen-subtitle">
          {loading ? (
            <span className="bene-stat">Loading from Airtable…</span>
          ) : error ? (
            <span className="bene-stat bene-stat-missing">Failed to load</span>
          ) : (
            <>
              <span className="bene-stat">{counts.all} consultants</span>
              <span className="bene-stat-sep" />
              <span className="bene-stat">{counts.active} active</span>
              <span className="bene-stat-sep" />
              <span className="bene-stat bene-stat-missing">{counts.expired} expired</span>
            </>
          )}
        </p>
      </div>

      {error && (
        <div className="bene-alert card" style={{ borderLeftColor: 'var(--danger)' }}>
          <div className="bene-alert-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="bene-alert-body">
            <strong>Could not load consultant data.</strong> {error}
          </div>
        </div>
      )}

      <div className="bene-toolbar card">
        <div className="bene-filters">
          {[
            { key: 'all', label: `All (${counts.all})` },
            { key: 'active', label: `Active (${counts.active})` },
            { key: 'expired', label: `Expired (${counts.expired})` },
          ].map((f) => (
            <button
              key={f.key}
              className={`bene-filter-btn ${filter === f.key ? 'bene-filter-active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className="bene-search"
          type="text"
          placeholder="Search name, employee no, client…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="bene-table-wrap card">
        {loading ? (
          <div className="bene-loading">
            <span className="spinner" />
            <span>Fetching from Airtable…</span>
          </div>
        ) : (
          <table className="bene-table">
            <thead>
              <tr>
                <th>Emp No.</th>
                <th>Name</th>
                <th>Client</th>
                <th>Bank</th>
                <th>Account No.</th>
                <th>Contract End</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>
                    No results
                  </td>
                </tr>
              )}
              {filtered.map((c) => {
                const status = contractStatus(c.contractEnd);
                return (
                  <tr
                    key={c.id}
                    className={`bene-row ${status === 'expired' ? 'bene-row-missing' : ''} ${selected?.id === c.id ? 'bene-row-selected' : ''}`}
                    onClick={() => setSelected(selected?.id === c.id ? null : c)}
                  >
                    <td><span className="bene-code">{c.employeeNumber}</span></td>
                    <td>{c.name}</td>
                    <td>{c.client}</td>
                    <td>{c.bankName}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.accountNo}</td>
                    <td>{formatDate(c.contractEnd)}</td>
                    <td>
                      <span className={`badge ${status === 'active' ? 'badge-success' : status === 'expired' ? 'badge-danger' : 'badge-neutral'}`}>
                        {status === 'active' ? 'Active' : status === 'expired' ? 'Expired' : 'Unknown'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="bene-detail-panel card fade-in">
          <div className="bene-detail-header">
            <div>
              <span className="bene-code" style={{ fontSize: 15 }}>{selected.employeeNumber}</span>
              <span
                className={`badge ${contractStatus(selected.contractEnd) === 'active' ? 'badge-success' : 'badge-danger'}`}
                style={{ marginLeft: 8 }}
              >
                {contractStatus(selected.contractEnd) === 'active' ? 'Active' : 'Expired'}
              </span>
            </div>
            <button className="bene-detail-close" onClick={() => setSelected(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="bene-detail-name">{selected.name}</div>
          <div className="bene-detail-grid">
            <div className="bene-detail-item"><span>Employee No.</span><strong>{selected.employeeNumber}</strong></div>
            <div className="bene-detail-item"><span>Employee ID</span><strong>{selected.employeeId}</strong></div>
            <div className="bene-detail-item"><span>ID Number</span><strong style={{ fontFamily: 'monospace' }}>{selected.idNumber}</strong></div>
            <div className="bene-detail-item"><span>Client</span><strong>{selected.client}</strong></div>
            <div className="bene-detail-item"><span>Contract Start</span><strong>{formatDate(selected.contractStart)}</strong></div>
            <div className="bene-detail-item"><span>Contract End</span><strong>{formatDate(selected.contractEnd)}</strong></div>
            <div className="bene-detail-item"><span>Monthly Salary</span><strong>{formatSalary(selected.salary)}</strong></div>
            <div className="bene-detail-item"><span>Bank</span><strong>{selected.bankName}</strong></div>
            <div className="bene-detail-item"><span>Account No.</span><strong style={{ fontFamily: 'monospace' }}>{selected.accountNo}</strong></div>
          </div>
          {contractStatus(selected.contractEnd) === 'expired' && (
            <div className="bene-detail-warning">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Contract ended on {formatDate(selected.contractEnd)}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
