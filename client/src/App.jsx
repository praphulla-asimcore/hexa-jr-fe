import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import Login from './screens/Login.jsx';
import AcceptInvite from './screens/AcceptInvite.jsx';
import Dashboard from './screens/Dashboard.jsx';
import Upload from './screens/Upload.jsx';
import GlSelection from './screens/GlSelection.jsx';
import JeReview from './screens/JeReview.jsx';
import Summary from './screens/Summary.jsx';
import FinanceOps from './screens/FinanceOps.jsx';
import './App.css';
import './components/AdminPanel.css';
import './components/Sidebar.css';

function useFlowState() {
  const [screen, setScreen] = useState('upload');
  const [entities, setEntities] = useState([]);
  const [summary, setSummary] = useState(null);
  const [paymentDate, setPaymentDate] = useState('');
  const [jeData, setJeData] = useState([]);
  const [postResults, setPostResults] = useState({});

  function reset() {
    setScreen('upload'); setEntities([]); setSummary(null);
    setPaymentDate(''); setJeData([]); setPostResults({});
  }

  return { screen, setScreen, entities, setEntities, summary, setSummary, paymentDate, setPaymentDate, jeData, setJeData, postResults, setPostResults, reset };
}

function JournalFlow({ module, user, authToken }) {
  const flow = useFlowState();

  function handleUploadDone({ entities, summary, paymentDate }) {
    flow.setEntities(entities); flow.setSummary(summary); flow.setPaymentDate(paymentDate);
    flow.setJeData([]); flow.setPostResults({}); flow.setScreen('gl-selection');
  }
  function handleGlDone({ jeData }) { flow.setJeData(jeData); flow.setScreen('review'); }
  function handlePostDone(results) { flow.setPostResults(results); flow.setScreen('summary'); }

  const moduleLabel = module === 'payroll' ? 'Payroll' : 'CSI';

  return (
    <div className="flow-area">
      <div className="flow-header">
        <div className="flow-title">{moduleLabel}</div>
        <div className="flow-subtitle">
          {module === 'csi' ? 'Consultant salary journals' : 'Internal payroll journals'}
        </div>
      </div>
      <div className="flow-steps">
        {['upload', 'gl-selection', 'review', 'summary'].map((s, i) => {
          const labels = ['Upload', 'GL Accounts', 'Review & Post', 'Summary'];
          const idx = ['upload', 'gl-selection', 'review', 'summary'].indexOf(flow.screen);
          return (
            <div key={s} className={`flow-step ${flow.screen === s ? 'flow-step-active' : i < idx ? 'flow-step-done' : ''}`}>
              <span className="flow-step-num">{i + 1}</span>
              <span className="flow-step-label">{labels[i]}</span>
              {i < 3 && <span className="flow-step-sep" />}
            </div>
          );
        })}
      </div>

      {flow.screen === 'upload' && <Upload onDone={handleUploadDone} />}
      {flow.screen === 'gl-selection' && (
        <GlSelection entities={flow.entities} paymentDate={flow.paymentDate}
          onBack={() => flow.setScreen('upload')} onDone={handleGlDone} />
      )}
      {flow.screen === 'review' && (
        <JeReview jeData={flow.jeData} paymentDate={flow.paymentDate} module={module}
          authToken={authToken} user={user}
          onBack={() => flow.setScreen('gl-selection')} onDone={handlePostDone} />
      )}
      {flow.screen === 'summary' && (
        <Summary postResults={flow.postResults} paymentDate={flow.paymentDate} onReset={flow.reset} />
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authToken, setAuthToken] = useState('');
  const [authChecking, setAuthChecking] = useState(true);
  const [section, setSection] = useState('dashboard');
  const [adminOpen, setAdminOpen] = useState(false);
  const [zohoConfigured, setZohoConfigured] = useState(null);

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
        {section === 'dashboard' && <Dashboard />}
        {section === 'csi' && <JournalFlow module="csi" user={user} authToken={authToken} />}
        {section === 'payroll' && <JournalFlow module="payroll" user={user} authToken={authToken} />}
        {section === 'finops' && <FinanceOps authToken={authToken} user={user} />}
      </main>
      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} adminToken={authToken} />}
    </div>
  );
}
