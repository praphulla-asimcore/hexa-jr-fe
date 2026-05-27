const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getDb } = require('../services/db');
const { sendInvite } = require('../services/email');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'hexa-jwt-secret-change-in-prod';

function requireAuth(req, res, next) {
  const raw = req.headers['x-auth-token'];
  if (!raw) return res.status(401).json({ error: 'Authentication required.' });
  try {
    req.user = jwt.verify(raw, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    next();
  });
}

// GET /api/users — admin only
router.get('/', requireAdmin, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });
  const { data, error } = await db
    .from('users')
    .select('id, email, name, role, status, created_at, last_login')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data });
});

// POST /api/users/invite — admin only  { email, name, role }
router.post('/invite', requireAdmin, async (req, res) => {
  const { email, name, role = 'user' } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  // Upsert: re-invite if already exists
  const { data: existing } = await db.from('users').select('id').eq('email', email.toLowerCase().trim()).single();

  let userId;
  if (existing) {
    await db.from('users').update({ name: name || existing.name, role, status: 'invited', invite_token: token, invite_expires: expires }).eq('id', existing.id);
    userId = existing.id;
  } else {
    const { data, error } = await db.from('users').insert({ email: email.toLowerCase().trim(), name: name || '', role, invite_token: token, invite_expires: expires }).select('id').single();
    if (error) return res.status(500).json({ error: error.message });
    userId = data.id;
  }

  const appUrl = process.env.APP_URL || 'https://hexajrfe.hexamatics.finance';
  const inviteUrl = `${appUrl}/accept-invite?token=${token}`;
  await sendInvite({ to: email.toLowerCase().trim(), name, inviteUrl });

  res.json({ ok: true, userId, inviteUrl });
});

// DELETE /api/users/:id — admin only
router.delete('/:id', requireAdmin, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: 'Database not configured.' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself.' });
  await db.from('users').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// GET /api/users/active-emails — internal use for notifications
router.get('/active-emails', requireAuth, async (req, res) => {
  const db = getDb();
  if (!db) return res.json({ emails: [] });
  const { data } = await db.from('users').select('email').eq('status', 'active');
  res.json({ emails: (data || []).map((u) => u.email) });
});

module.exports = router;
