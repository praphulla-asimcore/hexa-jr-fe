import React, { useEffect, useState } from 'react';
import './Dashboard.css';

function fmt(n) {
  return Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  const d = new Date(+y, +m - 1, 1);
  return d.toLocaleDateString('en-MY', { month: 'short', year: 'numeric' });
}

const STATUS_META = {
  pending:  { label: 'Pending Approval', cls: 'badge-warning' },
  approved: { label: 'Approved',         cls: 'badge-success' },
  rejected: { label: 'Rejected',         cls: 'badge-danger'  },
};

export default function Dashboard({ authToken, onSection, onResumePir }) {
  const [stats, setStats] = useState(null);
  const [posts, setPosts] = useState([]);
  const [pirs, setPirs] = useState([]);
  const [loading, setLoading] = useState(true);

  const headers = authToken ? { 'x-auth-token': authToken } : {};

  useEffect(() => {
    const apiCalls = [
      fetch('/api/journal-history/stats').then((r) => r.json()),
      fetch('/api/journal-history').then((r) => r.json()),
    ];
    if (authToken) {
      apiCalls.push(fetch('/api/finops/history', { headers }).then((r) => r.json()));
    }
    Promise.all(apiCalls)
      .then(([s, p, finops]) => {
        setStats(s);
        setPosts(p.posts || []);
        if (finops) setPirs(finops.approvals || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="dash-loading"><span className="spinner" /> Loading dashboard...</div>;

  const totalPosts = stats?.totalPosts || 0;
  const totalAmount = stats?.totalAmount || 0;
  const byEntity = stats?.byEntity || [];
  const byModule = stats?.byModule || [];
  const recentMonths = stats?.recentMonths || [];
  const csiData = byModule.find((m) => m.module === 'csi') || { count: 0, total: 0 };
  const payrollData = byModule.find((m) => m.module === 'payroll') || { count: 0, total: 0 };

  return (
    <div className="dash fade-in">
      <div className="screen-header">
        <h1 className="screen-title">Dashboard</h1>
        <p className="screen-subtitle">Journal posting activity across all entities</p>
      </div>

      {/* KPI cards */}
      <div className="dash-kpis">
        <div className="dash-kpi card">
          <div className="dash-kpi-label">Total Journals Posted</div>
          <div className="dash-kpi-value">{totalPosts}</div>
        </div>
        <div className="dash-kpi card">
          <div className="dash-kpi-label">Total Amount Posted</div>
          <div className="dash-kpi-value">RM {fmt(totalAmount)}</div>
        </div>
        <div className="dash-kpi card">
          <div className="dash-kpi-label">CSI Journals</div>
          <div className="dash-kpi-value">{csiData.count}</div>
          <div className="dash-kpi-sub">RM {fmt(csiData.total)}</div>
        </div>
        <div className="dash-kpi card">
          <div className="dash-kpi-label">Payroll Journals</div>
          <div className="dash-kpi-value">{payrollData.count}</div>
          <div className="dash-kpi-sub">RM {fmt(payrollData.total)}</div>
        </div>
      </div>

      <div className="dash-grid">
        {/* By entity */}
        <div className="dash-panel card">
          <div className="dash-panel-title">Journals by Entity</div>
          {byEntity.length === 0 ? (
            <div className="dash-empty">No data yet</div>
          ) : (
            <table className="dash-table">
              <thead>
                <tr><th>Entity</th><th>Count</th><th style={{ textAlign: 'right' }}>Total (RM)</th></tr>
              </thead>
              <tbody>
                {byEntity.map((e) => (
                  <tr key={e.entity}>
                    <td><span className="entity-badge">{e.entity}</span></td>
                    <td>{e.count}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(e.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Monthly trend */}
        <div className="dash-panel card">
          <div className="dash-panel-title">Monthly Activity</div>
          {recentMonths.length === 0 ? (
            <div className="dash-empty">No data yet</div>
          ) : (
            <div className="dash-bars">
              {(() => {
                const max = Math.max(...recentMonths.map((m) => m.total), 1);
                return recentMonths.map((m) => (
                  <div key={m.month} className="dash-bar-row">
                    <div className="dash-bar-label">{fmtMonth(m.month)}</div>
                    <div className="dash-bar-track">
                      <div className="dash-bar-fill" style={{ width: `${(m.total / max) * 100}%` }} />
                    </div>
                    <div className="dash-bar-value">RM {fmt(m.total)}</div>
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Finance Ops activity */}
      {pirs.length > 0 && (
        <div className="dash-panel card" style={{ marginTop: 20 }}>
          <div className="dash-panel-title">Finance Ops — PIR Approvals</div>
          <div className="dash-activity">
            {pirs.slice(0, 10).map((p) => {
              const meta = STATUS_META[p.approval_status] || STATUS_META.pending;
              const isPending = p.approval_status === 'pending';
              return (
                <div key={p.id} className="dash-activity-row">
                  <div className="dash-activity-left">
                    <span className={`badge ${meta.cls}`}>{meta.label}</span>
                    <span className="dash-activity-ref">
                      {p.payout_date ? new Date(p.payout_date + 'T00:00:00').toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </span>
                    <span className="dash-activity-entity">{p.created_by_name || '—'}</span>
                  </div>
                  <div className="dash-activity-right">
                    <span className="dash-activity-amount">RM {fmt(p.total_amount)}</span>
                    {p.email_sent_at && (
                      <span className="dash-activity-date" title={`Email sent ${new Date(p.email_sent_at).toLocaleString('en-MY')}`}>
                        Email sent
                      </span>
                    )}
                    {isPending && onSection && (
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ fontSize: 11, padding: '3px 10px' }}
                        onClick={() => { onResumePir && onResumePir(p.id); onSection('finops'); }}
                      >
                        Resume
                      </button>
                    )}
                    {!isPending && p.approved_at && (
                      <span className="dash-activity-date">{new Date(p.approved_at).toLocaleDateString('en-MY')}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div className="dash-panel card" style={{ marginTop: 20 }}>
        <div className="dash-panel-title">Recent Journal Posts</div>
        {posts.length === 0 ? (
          <div className="dash-empty">No journals posted yet</div>
        ) : (
          <div className="dash-activity">
            {posts.slice(0, 20).map((p) => (
              <div key={p.id} className="dash-activity-row">
                <div className="dash-activity-left">
                  <span className={`badge ${p.module === 'payroll' ? 'badge-info' : 'badge-neutral'}`}>
                    {p.module === 'payroll' ? 'Payroll' : 'CSI'}
                  </span>
                  <span className="dash-activity-ref">{p.reference_number}</span>
                  <span className="dash-activity-entity">{p.entity}</span>
                </div>
                <div className="dash-activity-right">
                  <span className="dash-activity-amount">RM {fmt(p.total_amount)}</span>
                  <span className="dash-activity-by">{p.posted_by_name}</span>
                  <span className="dash-activity-date">{new Date(p.posted_at).toLocaleDateString('en-MY')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
