import React from 'react';
import './Summary.css';

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-MY', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export default function Summary({ postResults, paymentDate, onReset }) {
  const rows = Object.entries(postResults).map(([sheetName, r]) => ({
    sheetName,
    status: r.status,
    referenceNumber: r.referenceNumber || '—',
    journalId: r.journalId || '—',
    error: r.error || '',
  }));

  function downloadCSV() {
    const header = ['Entity', 'JE Reference', 'Journal ID', 'Date Posted', 'Status', 'Error'].join(',');
    const csvRows = rows.map((r) =>
      [r.sheetName, r.referenceNumber, r.journalId, fmtDate(paymentDate), r.status, r.error]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [header, ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CSI-JE-Summary-${paymentDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const postedCount = rows.filter((r) => r.status === 'posted').length;
  const errorCount = rows.filter((r) => r.status === 'error').length;

  return (
    <div className="summary-screen fade-in">
      <div className="screen-header">
        <h1 className="screen-title">Posting Summary</h1>
        <p className="screen-subtitle">Journal entries posted for {fmtDate(paymentDate)}.</p>
      </div>

      <div className="summary-stats-row">
        <div className="summary-stat card card-3d">
          <div className="summary-stat-value" style={{ color: 'var(--success)' }}>{postedCount}</div>
          <div className="summary-stat-label">Posted</div>
        </div>
        <div className="summary-stat card card-3d">
          <div className="summary-stat-value" style={{ color: postedCount + errorCount < rows.length ? 'var(--warning)' : 'var(--text-muted)' }}>
            {rows.length - postedCount - errorCount}
          </div>
          <div className="summary-stat-label">Skipped</div>
        </div>
        {errorCount > 0 && (
          <div className="summary-stat card card-3d">
            <div className="summary-stat-value" style={{ color: 'var(--danger)' }}>{errorCount}</div>
            <div className="summary-stat-label">Errors</div>
          </div>
        )}
      </div>

      {rows.length > 0 ? (
        <div className="summary-table-wrap card">
          <table className="summary-table">
            <thead>
              <tr>
                <th>Entity</th>
                <th>JE Reference</th>
                <th>Journal ID</th>
                <th>Date Posted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sheetName}>
                  <td><strong>{row.sheetName}</strong></td>
                  <td className="mono">{row.referenceNumber}</td>
                  <td className="mono">{row.journalId}</td>
                  <td>{fmtDate(paymentDate)}</td>
                  <td>
                    {row.status === 'posted' && <span className="badge badge-success">Posted</span>}
                    {row.status === 'error' && (
                      <span className="badge badge-danger" title={row.error}>Error</span>
                    )}
                    {row.status !== 'posted' && row.status !== 'error' && (
                      <span className="badge badge-neutral">Skipped</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="summary-empty card">
          <p>No posting results to display.</p>
        </div>
      )}

      <div className="summary-actions">
        {rows.length > 0 && (
          <button className="btn btn-secondary" onClick={downloadCSV}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download CSV
          </button>
        )}
        <button className="btn btn-primary" onClick={onReset}>
          Start Over
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 .49-4.95" />
          </svg>
        </button>
      </div>
    </div>
  );
}
