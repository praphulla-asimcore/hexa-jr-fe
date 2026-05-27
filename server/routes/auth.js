const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../services/db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'hexa-jwt-secret-change-in-prod';

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: user, error } = await db
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error || !user) return res.status(401).json({ error: 'Invalid credentials.' });
  if (user.status !== 'active') return res.status(401).json({ error: 'Account not yet activated. Check your invite email.' });
  if (!user.password_hash) return res.status(401).json({ error: 'No password set. Check your invite email.' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

  await db.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

  res.json({ token: signToken(user), user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// POST /api/auth/accept-invite  { token, name, password }
router.post('/accept-invite', async (req, res) => {
  const { token, name, password } = req.body || {};
  if (!token || !name || !password) return res.status(400).json({ error: 'Token, name and password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const { data: user, error } = await db
    .from('users')
    .select('*')
    .eq('invite_token', token)
    .single();

  if (error || !user) return res.status(400).json({ error: 'Invalid or expired invite link.' });
  if (user.invite_expires && new Date(user.invite_expires) < new Date()) {
    return res.status(400).json({ error: 'Invite link has expired. Ask an admin to resend.' });
  }

  const hash = await bcrypt.hash(password, 12);
  await db.from('users').update({
    name: name.trim(),
    password_hash: hash,
    status: 'active',
    invite_token: null,
    invite_expires: null,
  }).eq('id', user.id);

  const updated = { ...user, name: name.trim(), status: 'active', role: user.role };
  res.json({ token: signToken(updated), user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role } });
});

// GET /api/auth/me  (requires x-auth-token)
router.get('/me', (req, res) => {
  const raw = req.headers['x-auth-token'];
  if (!raw) return res.status(401).json({ error: 'No token.' });
  try {
    const payload = jwt.verify(raw, JWT_SECRET);
    res.json({ user: { id: payload.id, email: payload.email, name: payload.name, role: payload.role } });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
});

module.exports = router;
module.exports.JWT_SECRET = JWT_SECRET;
