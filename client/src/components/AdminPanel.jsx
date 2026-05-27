import React, { useState, useEffect } from 'react';
import './AdminPanel.css';

export default function AdminPanel({ onClose, adminToken }) {
  const [tab, setTab] = useState('zoho'); // 'zoho' | 'users'
  const [token, setToken] = useState(adminToken || '');
  const [step, setStep] = useState(adminToken ? 'credentials' : 'login');

  // Zoho tab state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [configured, setConfigured] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);

  // Users tab state
  const [users, setUsers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('user');
  const [inviting, setInviting] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [usersSuccess, setUsersSuccess] = useState('');

  useEffect(() => {
    fetch('/api/admin/status').then((r) => r.json()).then((d) => setConfigured(d.configured)).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'users' && step === 'credentials') loadUsers();
  }, [tab, step]);

  async function loadUsers() {
    if (!token) return;
    setUsersLoading(true);
    const res = await fetch('/api/users', { headers: { 'x-auth-token': token } });
    const data = await res.json();
    setUsersLoading(false);
    if (res.ok) setUsers(data.users || []);
    else setUsersError(data.error || 'Failed to load users.');
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed.');
      setToken(data.token);
      setStep('credentials');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!clientId.trim() || !clientSecret.trim() || !refreshToken.trim()) { setError('All three fields are required.'); return; }
    setLoading(true); setError(''); setSuccess('');
    try {
      const res = await fetch('/api/admin/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': token }, body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), refreshToken: refreshToken.trim() }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      setConfigured(true); setSuccess('Credentials saved. Run a connection test to verify.');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function handleExchange() {
    if (!clientId.trim() || !clientSecret.trim() || !authCode.trim()) { setError('Client ID, Client Secret and Auth Code are all required.'); return; }
    setExchanging(true); setError(''); setSuccess('');
    try {
      const res = await fetch('/api/admin/exchange-code', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': token }, body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), code: authCode.trim(), redirectUri: '' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Exchange failed.');
      setRefreshToken(data.refreshToken); setConfigured(true);
      setSuccess('Refresh token obtained and saved. Run a connection test to verify.'); setAuthCode('');
    } catch (err) { setError(err.message); }
    finally { setExchanging(false); }
  }

  async function handleTest() {
    setTesting(true); setError(''); setSuccess(''); setTestResults(null);
    try {
      const res = await fetch('/api/admin/test', { method: 'POST', headers: { 'x-admin-token': token } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test failed.');
      setTestResults(data);
    } catch (err) { setError(err.message); }
    finally { setTesting(false); }
  }

  async function handleInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true); setUsersError(''); setUsersSuccess('');
    try {
      const res = await fetch('/api/users/invite', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': token }, body: JSON.stringify({ email: inviteEmail.trim(), name: inviteName.trim(), role: inviteRole }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invite failed.');
      setUsersSuccess(`Invite sent to ${inviteEmail.trim()}.`);
      setInviteEmail(''); setInviteName('');
      loadUsers();
    } catch (err) { setUsersError(err.message); }
    finally { setInviting(false); }
  }

  async function handleDeleteUser(id) {
    if (!window.confirm('Remove this user?')) return;
    await fetch(`/api/users/${id}`, { method: 'DELETE', headers: { 'x-auth-token': token } });
    loadUsers();
  }

  function handleLogout() {
    fetch('/api/admin/logout', { method: 'POST', headers: { 'x-admin-token': token } }).catch(() => {});
    setToken(''); setStep('login'); setEmail(''); setPassword(''); setError(''); setSuccess('');
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
            {step === 'credentials' && <button className="btn btn-secondary btn-sm" onClick={handleLogout}>Sign out</button>}
            <button className="admin-close" onClick={onClose} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {step === 'credentials' && (
          <div className="admin-tabs">
            <button className={`admin-tab ${tab === 'zoho' ? 'admin-tab-active' : ''}`} onClick={() => setTab('zoho')}>Zoho API</button>
            <button className={`admin-tab ${tab === 'users' ? 'admin-tab-active' : ''}`} onClick={() => setTab('users')}>Users</button>
          </div>
        )}

        <div className="admin-modal-body">
          {step === 'login' && (
            <form onSubmit={handleLogin} className="admin-form fade-in">
              <div className="admin-section-label">Admin access only</div>
              <div className="admin-field"><label className="label">Email</label><input type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="praphulla@hexamatics.com" autoComplete="username" /></div>
              <div className="admin-field"><label className="label">Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" /></div>
              {error && <div className="error-msg">{error}</div>}
              <button className="btn btn-primary" type="submit" disabled={loading || !email || !password}>{loading ? <><span className="spinner" />Signing in...</> : 'Sign In'}</button>
            </form>
          )}

          {step === 'credentials' && tab === 'zoho' && (
            <form onSubmit={handleSave} className="admin-form fade-in">
              <div className="admin-status-bar">
                <span>Zoho API credentials</span>
                <span className={`badge ${configured ? 'badge-success' : 'badge-warning'}`}>{configured ? 'Configured' : 'Not configured'}</span>
              </div>
              <div className="admin-hint">Get these from <strong>api-console.zoho.com</strong> — see the setup guide below.</div>
              <div className="admin-field"><label className="label">Client ID</label><input type={showSecrets ? 'text' : 'password'} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1000.XXXXXX..." autoComplete="off" /></div>
              <div className="admin-field"><label className="label">Client Secret</label><input type={showSecrets ? 'text' : 'password'} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="xxxxxxxxxx" autoComplete="off" /></div>
              <div className="admin-field"><label className="label">Refresh Token</label><input type={showSecrets ? 'text' : 'password'} value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} placeholder="1000.XXXXXX..." autoComplete="off" /></div>
              <button type="button" className="show-toggle" onClick={() => setShowSecrets((s) => !s)}>{showSecrets ? 'Hide values' : 'Show values'}</button>
              {error && <div className="error-msg">{error}</div>}
              {success && <div className="success-msg">{success}</div>}
              {testResults && (
                <div style={{ marginBottom: 12, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Diagnostics</div>
                  <pre style={{ background: 'var(--bg-secondary,#f5f5f5)', borderRadius: 6, padding: '10px 12px', fontSize: 11, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)', maxHeight: 320, overflowY: 'auto' }}>{JSON.stringify(testResults, null, 2)}</pre>
                </div>
              )}
              <div className="admin-form-actions">
                <button className="btn btn-secondary" type="button" onClick={handleTest} disabled={testing || !configured}>{testing ? <><span className="spinner" />Testing...</> : 'Test Connection'}</button>
                <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? <><span className="spinner" />Saving...</> : 'Save Credentials'}</button>
              </div>
              <div className="admin-guide">
                <div className="admin-guide-title">Get a Zoho refresh token — step by step</div>
                <ol className="admin-guide-steps">
                  <li>Go to <strong>api-console.zoho.com</strong>, sign in as the Zoho Books owner. Click <strong>Add Client → Self Client</strong> if you don't have one.</li>
                  <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> into the fields above.</li>
                  <li>Open the <strong>Generate Code</strong> tab. Scope: <code>ZohoBooks.fullaccess.all</code>, duration 10 min → Create.</li>
                  <li>Paste the code into the <strong>Auth Code</strong> field below and click <strong>Exchange for Token</strong>.</li>
                </ol>
                <div className="admin-field" style={{ marginTop: 12 }}>
                  <label className="label">Auth Code (from Zoho)</label>
                  <input type="text" value={authCode} onChange={(e) => setAuthCode(e.target.value)} placeholder="1000.xxxxxx.xxxxxx" autoComplete="off" />
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleExchange} disabled={exchanging || !clientId.trim() || !clientSecret.trim() || !authCode.trim()} style={{ marginTop: 8 }}>
                  {exchanging ? <><span className="spinner" />Exchanging...</> : 'Exchange for Token'}
                </button>
              </div>
            </form>
          )}

          {step === 'credentials' && tab === 'users' && (
            <div className="admin-form fade-in">
              <div className="admin-section-label">Invite a new user</div>
              <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="admin-field"><label className="label">Email</label><input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="user@hexamatics.com" /></div>
                <div className="admin-field"><label className="label">Name (optional)</label><input type="text" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Full name" /></div>
                <div className="admin-field">
                  <label className="label">Role</label>
                  <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                {usersError && <div className="error-msg">{usersError}</div>}
                {usersSuccess && <div className="success-msg">{usersSuccess}</div>}
                <button className="btn btn-primary btn-sm" type="submit" disabled={inviting || !inviteEmail.trim()}>
                  {inviting ? <><span className="spinner" />Sending invite...</> : 'Send Invite Email'}
                </button>
              </form>

              <div style={{ marginTop: 24 }}>
                <div className="admin-section-label">Active users</div>
                {usersLoading ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {users.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No users yet.</div>}
                    {users.map((u) => (
                      <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{u.name || '—'}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{u.email}</div>
                        </div>
                        <span className={`badge ${u.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{u.status}</span>
                        <span className="badge badge-neutral">{u.role}</span>
                        <button onClick={() => handleDeleteUser(u.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }} title="Remove user">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
