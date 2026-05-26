import React, { useState, useEffect } from 'react';
import './AdminPanel.css';

export default function AdminPanel({ onClose }) {
  const [step, setStep] = useState('login'); // 'login' | 'credentials'
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [configured, setConfigured] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);

  useEffect(() => {
    fetch('/api/admin/status')
      .then((r) => r.json())
      .then((d) => setConfigured(d.configured))
      .catch(() => {});
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed.');
      setToken(data.token);
      setStep('credentials');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!clientId.trim() || !clientSecret.trim() || !refreshToken.trim()) {
      setError('All three fields are required.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/admin/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), refreshToken: refreshToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      setConfigured(true);
      setSuccess('Credentials saved. Run a connection test to verify.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/admin/test', {
        method: 'POST',
        headers: { 'x-admin-token': token },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test failed.');
      setSuccess('Zoho connection verified successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  }

  function handleLogout() {
    fetch('/api/admin/logout', { method: 'POST', headers: { 'x-admin-token': token } }).catch(() => {});
    setToken('');
    setStep('login');
    setEmail('');
    setPassword('');
    setError('');
    setSuccess('');
  }

  return (
    <div className="admin-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="admin-modal card">
        <div className="admin-modal-header">
          <div className="admin-modal-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
            </svg>
            Admin Settings
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {step === 'credentials' && (
              <button className="btn btn-secondary btn-sm" onClick={handleLogout}>Sign out</button>
            )}
            <button className="admin-close" onClick={onClose} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="admin-modal-body">
          {step === 'login' && (
            <form onSubmit={handleLogin} className="admin-form fade-in">
              <div className="admin-section-label">Admin access only</div>
              <div className="admin-field">
                <label className="label">Email</label>
                <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="praphulla@hexamatics.com" autoComplete="username" />
              </div>
              <div className="admin-field">
                <label className="label">Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
              </div>
              {error && <div className="error-msg">{error}</div>}
              <button className="btn btn-primary" type="submit" disabled={loading || !email || !password}>
                {loading ? <><span className="spinner" />Signing in...</> : 'Sign In'}
              </button>
            </form>
          )}

          {step === 'credentials' && (
            <form onSubmit={handleSave} className="admin-form fade-in">
              <div className="admin-status-bar">
                <span>Zoho API credentials</span>
                <span className={`badge ${configured ? 'badge-success' : 'badge-warning'}`}>
                  {configured ? 'Configured' : 'Not configured'}
                </span>
              </div>

              <div className="admin-hint">
                Get these from <strong>api-console.zoho.com</strong> — see the setup guide below.
              </div>

              <div className="admin-field">
                <label className="label">Client ID</label>
                <input
                  type={showSecrets ? 'text' : 'password'}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="1000.XXXXXX..."
                  autoComplete="off"
                />
              </div>
              <div className="admin-field">
                <label className="label">Client Secret</label>
                <input
                  type={showSecrets ? 'text' : 'password'}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxx"
                  autoComplete="off"
                />
              </div>
              <div className="admin-field">
                <label className="label">Refresh Token</label>
                <input
                  type={showSecrets ? 'text' : 'password'}
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  placeholder="1000.XXXXXX..."
                  autoComplete="off"
                />
              </div>

              <button
                type="button"
                className="show-toggle"
                onClick={() => setShowSecrets((s) => !s)}
              >
                {showSecrets ? 'Hide values' : 'Show values'}
              </button>

              {error && <div className="error-msg">{error}</div>}
              {success && <div className="success-msg">{success}</div>}

              <div className="admin-form-actions">
                <button className="btn btn-secondary" type="button" onClick={handleTest} disabled={testing || !configured}>
                  {testing ? <><span className="spinner" />Testing...</> : 'Test Connection'}
                </button>
                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading ? <><span className="spinner" />Saving...</> : 'Save Credentials'}
                </button>
              </div>

              <div className="admin-guide">
                <div className="admin-guide-title">How to get Zoho credentials</div>
                <ol className="admin-guide-steps">
                  <li>Go to <strong>api-console.zoho.com</strong> and sign in as the Zoho Books owner.</li>
                  <li>Click <strong>Add Client</strong> and choose <strong>Self Client</strong>.</li>
                  <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> shown.</li>
                  <li>Click the <strong>Generate Code</strong> tab. Enter scope:<br />
                    <code>ZohoBooks.accountants.READ,ZohoBooks.journals.CREATE</code>
                  </li>
                  <li>Set Time Duration to <strong>10 minutes</strong>, click <strong>Create</strong>. Copy the code.</li>
                  <li>Open Terminal and run this command (replace placeholders):<br />
                    <code>
                      curl -X POST "https://accounts.zoho.com/oauth/v2/token" \<br />
                      &nbsp;-d "grant_type=authorization_code" \<br />
                      &nbsp;-d "client_id=YOUR_CLIENT_ID" \<br />
                      &nbsp;-d "client_secret=YOUR_CLIENT_SECRET" \<br />
                      &nbsp;-d "redirect_uri=https://www.zoho.com/books" \<br />
                      &nbsp;-d "code=YOUR_CODE"
                    </code>
                  </li>
                  <li>The response will contain <strong>refresh_token</strong> — copy that value here.</li>
                </ol>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
