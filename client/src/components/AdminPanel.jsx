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
  const [authCode, setAuthCode] = useState('');
  const [redirectUri, setRedirectUri] = useState('https://www.zoho.com');
  const [loading, setLoading] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState(null);
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

  function buildAuthUrl() {
    if (!clientId.trim()) return null;
    const scope = 'ZohoBooks.fullaccess.all';
    const uri = redirectUri.trim() || 'https://www.zoho.com';
    return `https://accounts.zoho.com/oauth/v2/auth?scope=${encodeURIComponent(scope)}&client_id=${encodeURIComponent(clientId.trim())}&response_type=code&access_type=offline&redirect_uri=${encodeURIComponent(uri)}`;
  }

  async function handleExchange() {
    if (!clientId.trim() || !clientSecret.trim() || !authCode.trim()) {
      setError('Client ID, Client Secret and Auth Code are all required.');
      return;
    }
    setExchanging(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/admin/exchange-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), code: authCode.trim(), redirectUri: redirectUri.trim() || 'https://www.zoho.com' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Exchange failed.');
      setRefreshToken(data.refreshToken);
      setConfigured(true);
      setSuccess('Refresh token obtained and saved automatically. Run a connection test to verify.');
      setAuthCode('');
    } catch (err) {
      setError(err.message);
    } finally {
      setExchanging(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setError('');
    setSuccess('');
    setTestResults(null);
    try {
      const res = await fetch('/api/admin/test', {
        method: 'POST',
        headers: { 'x-admin-token': token },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test failed.');
      setTestResults(data);
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
              {testResults && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Endpoint diagnostics (GET /manualjournals per org)
                  </div>
                  {Object.entries(testResults).map(([key, val]) => {
                    const ok = key === 'auth' ? val === 'ok' : (val.status === 200 && val.code === 0);
                    return (
                      <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4, fontSize: 12 }}>
                        <span className={`badge ${ok ? 'badge-success' : 'badge-warning'}`} style={{ minWidth: 28, textAlign: 'center' }}>
                          {ok ? '✓' : '✗'}
                        </span>
                        <span style={{ fontWeight: 600, minWidth: 60 }}>{key}</span>
                        <span style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                          {key === 'auth' ? val : `HTTP ${val.status} — ${val.body ? JSON.stringify(val.body) : val.error || 'ok'}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="admin-form-actions">
                <button className="btn btn-secondary" type="button" onClick={handleTest} disabled={testing || !configured}>
                  {testing ? <><span className="spinner" />Testing...</> : 'Test Connection'}
                </button>
                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading ? <><span className="spinner" />Saving...</> : 'Save Credentials'}
                </button>
              </div>

              <div className="admin-guide">
                <div className="admin-guide-title">Authorize with Zoho — step by step</div>
                <ol className="admin-guide-steps">
                  <li>Go to <strong>api-console.zoho.com</strong>, sign in as the Zoho Books owner, click <strong>Add Client</strong> and choose <strong>Self Client</strong>.</li>
                  <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> into the fields above, then click the button below to open the Zoho authorization page:</li>
                </ol>
                <div style={{ margin: '10px 0 14px' }}>
                  <a
                    href={buildAuthUrl() || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`btn btn-secondary btn-sm${!clientId.trim() ? ' disabled' : ''}`}
                    onClick={(e) => !clientId.trim() && e.preventDefault()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    Open Zoho Authorization Page
                  </a>
                  {!clientId.trim() && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>Enter Client ID first</span>}
                </div>
                <ol className="admin-guide-steps" start={3}>
                  <li>On the Zoho page, click the <strong>Generate Code</strong> tab. The scope <code>ZohoBooks.fullaccess.all</code> is pre-filled in the URL. Set duration to <strong>10 minutes</strong> and click <strong>Create</strong>.</li>
                  <li>Copy the code shown, paste it below, and click <strong>Exchange for Token</strong> — no curl needed.</li>
                </ol>
                <div className="admin-field" style={{ marginTop: 12 }}>
                  <label className="label">Redirect URI</label>
                  <input
                    type="text"
                    value={redirectUri}
                    onChange={(e) => setRedirectUri(e.target.value)}
                    placeholder="https://www.zoho.com"
                    autoComplete="off"
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Must match the redirect URI registered in your Zoho API Console Self Client. Check api-console.zoho.com → your client → Redirect URIs.
                  </div>
                </div>
                <div className="admin-field" style={{ marginTop: 12 }}>
                  <label className="label">Auth Code (from Zoho)</label>
                  <input
                    type="text"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    placeholder="1000.xxxxxx.xxxxxx"
                    autoComplete="off"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleExchange}
                  disabled={exchanging || !clientId.trim() || !clientSecret.trim() || !authCode.trim()}
                  style={{ marginTop: 8 }}
                >
                  {exchanging ? <><span className="spinner" />Exchanging...</> : 'Exchange for Token'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
