import React from 'react';
import Logo from './Logo.jsx';
import './Sidebar.css';

const NAV = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    key: 'csi',
    label: 'CSI',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    sub: 'Consultant Salaries',
  },
  {
    key: 'payroll',
    label: 'Payroll',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
    sub: 'Internal Salaries',
  },
];

export default function Sidebar({ section, onSection, user, onLogout, onAdminOpen, zohoConfigured }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-logo">
          <Logo size={22} />
        </div>
        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <button
              key={item.key}
              className={`sidebar-item ${section === item.key ? 'sidebar-item-active' : ''}`}
              onClick={() => onSection(item.key)}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-label">
                {item.label}
                {item.sub && <span className="sidebar-sub">{item.sub}</span>}
              </span>
            </button>
          ))}
        </nav>
      </div>

      <div className="sidebar-bottom">
        <button
          className="sidebar-settings"
          onClick={onAdminOpen}
          title="Admin Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>Settings</span>
          {zohoConfigured !== null && (
            <span className={`sidebar-dot ${zohoConfigured ? 'sidebar-dot-green' : 'sidebar-dot-red'}`} />
          )}
        </button>
        <div className="sidebar-user">
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.name || user?.email}</div>
            <div className="sidebar-user-email">{user?.email}</div>
          </div>
          <button className="sidebar-logout" onClick={onLogout} title="Sign out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
