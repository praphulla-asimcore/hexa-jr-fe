import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import Login from './screens/Login.jsx';
import AcceptInvite from './screens/AcceptInvite.jsx';
import Dashboard from './screens/Dashboard.jsx';
import FinanceOps from './screens/FinanceOps.jsx';
import BankBeneficiaries from './screens/BankBeneficiaries.jsx';
import PayrollFlow from './screens/PayrollFlow.jsx';
import './App.css';
import './components/AdminPanel.css';
import './components/Sidebar.css';


export default function App() {
  const [user, setUser] = useState(null);
  const [authToken, setAuthToken] = useState('');
  const [authChecking, setAuthChecking] = useState(true);
  const [section, setSection] = useState('dashboard');
  const [adminOpen, setAdminOpen] = useState(false);
  const [zohoConfigured, setZohoConfigured] = useState(null);
  const [resumePirId, setResumePirId] = useState(null);

  // Check if this is an invite acceptance URL
  const isInvitePage = window.location.pathname === '/accept-invite' || window.location.search.includes('token=');

  useEffect(() => {
    const stored = localStorage.getItem('hx_token');
    if (!stored) { setAuthChecking(false); return; }
    fetch('/api/auth/me', { headers: { 'x-auth-token': stored } })
      .then((r) => r.json())
      .then((d) => {
        if (d.user) { setUser(d.user); setAuthToken(stored); }
        else localStorage.removeItem('hx_token');
      })
      .catch(() => {})
      .finally(() => setAuthChecking(false));
  }, []);

  useEffect(() => {
    fetch('/api/admin/status').then((r) => r.json()).then((d) => setZohoConfigured(d.configured)).catch(() => {});
  }, [adminOpen]);

  function handleLogin(u) { setUser(u); setAuthToken(localStorage.getItem('hx_token') || ''); }
  function handleLogout() { localStorage.removeItem('hx_token'); setUser(null); setAuthToken(''); }

  if (authChecking) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="spinner" /></div>;

  if (isInvitePage && !user) return <AcceptInvite onLogin={handleLogin} />;
  if (!user) return <Login onLogin={handleLogin} />;

  return (
    <div className="app-shell">
      <Sidebar
        section={section}
        onSection={setSection}
        user={user}
        onLogout={handleLogout}
        onAdminOpen={() => setAdminOpen(true)}
        zohoConfigured={zohoConfigured}
      />
      <main className="app-content">
        {section === 'dashboard' && (
          <Dashboard
            authToken={authToken}
            onSection={setSection}
            onResumePir={(id) => { setResumePirId(id); }}
          />
        )}
        {section === 'csi' && <PayrollFlow module="csi" user={user} authToken={authToken} key="csi" />}
        {section === 'payroll' && <PayrollFlow module="payroll" user={user} authToken={authToken} key="payroll" />}
        {section === 'finops' && (
          <FinanceOps
            authToken={authToken}
            user={user}
            resumePirId={resumePirId}
            key={resumePirId || 'finops'}
          />
        )}
        {section === 'beneficiaries' && <BankBeneficiaries />}
      </main>
      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} adminToken={authToken} />}
    </div>
  );
}
