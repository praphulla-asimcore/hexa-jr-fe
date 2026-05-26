import React, { useState, useEffect } from 'react';
import Logo from './components/Logo.jsx';
import StepIndicator from './components/StepIndicator.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import Upload from './screens/Upload.jsx';
import GlSelection from './screens/GlSelection.jsx';
import JeReview from './screens/JeReview.jsx';
import Summary from './screens/Summary.jsx';
import './App.css';
import './components/AdminPanel.css';

export default function App() {
  const [screen, setScreen] = useState('upload');
  const [entities, setEntities] = useState([]);
  const [summary, setSummary] = useState(null);
  const [paymentDate, setPaymentDate] = useState('');
  const [glSelections, setGlSelections] = useState({});
  const [jeData, setJeData] = useState([]);
  const [postResults, setPostResults] = useState({});
  const [adminOpen, setAdminOpen] = useState(false);
  const [zohoConfigured, setZohoConfigured] = useState(null);

  useEffect(() => {
    fetch('/api/admin/status')
      .then((r) => r.json())
      .then((d) => setZohoConfigured(d.configured))
      .catch(() => setZohoConfigured(false));
  }, [adminOpen]);

  function handleUploadDone({ entities, summary, paymentDate }) {
    setEntities(entities);
    setSummary(summary);
    setPaymentDate(paymentDate);
    setGlSelections({});
    setJeData([]);
    setPostResults({});
    setScreen('gl-selection');
  }

  function handleGlDone({ glSelections, jeData }) {
    setGlSelections(glSelections);
    setJeData(jeData);
    setScreen('review');
  }

  function handlePostDone(results) {
    setPostResults(results);
    setScreen('summary');
  }

  function handleReset() {
    setScreen('upload');
    setEntities([]);
    setSummary(null);
    setPaymentDate('');
    setGlSelections({});
    setJeData([]);
    setPostResults({});
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand">
            <Logo size={28} />
            <div className="app-brand-divider" />
            <span className="app-brand-name">CSI Journal Poster</span>
          </div>
          <StepIndicator current={screen} />
          <button
            className="admin-trigger"
            onClick={() => setAdminOpen(true)}
            title="Admin Settings — Zoho credentials"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {zohoConfigured !== null && (
              <span className={`admin-trigger-dot ${zohoConfigured ? 'admin-trigger-dot-green' : 'admin-trigger-dot-red'}`} />
            )}
          </button>
        </div>
      </header>

      <main className="app-main">
        {screen === 'upload' && <Upload onDone={handleUploadDone} />}
        {screen === 'gl-selection' && (
          <GlSelection
            entities={entities}
            paymentDate={paymentDate}
            onBack={() => setScreen('upload')}
            onDone={handleGlDone}
          />
        )}
        {screen === 'review' && (
          <JeReview
            jeData={jeData}
            paymentDate={paymentDate}
            onBack={() => setScreen('gl-selection')}
            onDone={handlePostDone}
          />
        )}
        {screen === 'summary' && (
          <Summary
            postResults={postResults}
            paymentDate={paymentDate}
            onReset={handleReset}
          />
        )}
      </main>

      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
    </div>
  );
}
