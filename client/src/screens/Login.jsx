import React, { useState } from 'react';
import Logo from '../components/Logo.jsx';
import './Login.css';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed.');
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
        <h1 className="login-title">Sign in</h1>
        <p className="login-subtitle">Access the Hexa Finance portal</p>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label className="label">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@hexamatics.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="login-field">
            <label className="label">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn btn-primary login-btn" type="submit" disabled={loading || !email || !password}>
            {loading ? <><span className="spinner" />Signing in...</> : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
