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

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/journal-history/stats').then((r) => r.json()),
      fetch('/api/journal-history').then((r) => r.json()),
    ]).then(([s, p]) => {
      setStats(s);
      setPosts(p.posts || []);
    }).catch(() => {}).finally(() => setLoading(false));
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
