import React, { useState, useEffect } from 'react';
import Logo from '../components/Logo.jsx';
import './Login.css';

export default function AcceptInvite({ onLogin }) {
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token') || '');
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to accept invite.');
      localStorage.setItem('hx_token', data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card card">
        <div className="login-brand">
          <Logo size={28} />
        </div>
        <h1 className="login-title">Accept Invitation</h1>
        <p className="login-subtitle">Set your name and password to activate your account</p>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label className="label">Your Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required />
          </div>
          <div className="login-field">
            <label className="label">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 characters" autoComplete="new-password" required />
          </div>
          <div className="login-field">
            <label className="label">Confirm Password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat password" autoComplete="new-password" required />
          </div>
          {error && <div className="error-msg">{error}</div>}
          {!token && <div className="error-msg">No invite token found in URL. Use the link from your invite email.</div>}
          <button className="btn btn-primary login-btn" type="submit" disabled={loading || !token || !name || !password || !confirm}>
            {loading ? <><span className="spinner" />Activating...</> : 'Activate Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
