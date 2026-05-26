const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getAccessToken } = require('../services/zoho');

const router = express.Router();
const adminConfig = require('../config/admin.json');

const sessions = new Set();
const ENV_PATH = path.join(__dirname, '../.env');

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorised.' });
  }
  next();
}

function readEnv() {
  try { return fs.readFileSync(ENV_PATH, 'utf8'); } catch { return ''; }
}

function setEnvVar(content, key, value) {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const line = `${key}=${escaped}`;
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, line);
  }
  return content.trimEnd() + '\n' + line + '\n';
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  if (email.toLowerCase() !== adminConfig.email.toLowerCase()) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  const ok = await bcrypt.compare(password, adminConfig.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });
  const token = crypto.randomUUID();
  sessions.add(token);
  res.json({ token });
});

router.post('/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

router.get('/status', (req, res) => {
  res.json({
    configured: !!(
      process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN
    ),
  });
});

router.post('/credentials', requireAdmin, (req, res) => {
  const { clientId, clientSecret, refreshToken } = req.body || {};
  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(400).json({ error: 'All three Zoho credential fields are required.' });
  }

  let content = readEnv();
  content = setEnvVar(content, 'ZOHO_CLIENT_ID', clientId);
  content = setEnvVar(content, 'ZOHO_CLIENT_SECRET', clientSecret);
  content = setEnvVar(content, 'ZOHO_REFRESH_TOKEN', refreshToken);

  process.env.ZOHO_CLIENT_ID = clientId;
  process.env.ZOHO_CLIENT_SECRET = clientSecret;
  process.env.ZOHO_REFRESH_TOKEN = refreshToken;

  try {
    fs.writeFileSync(ENV_PATH, content, 'utf8');
  } catch {
    // read-only filesystem on Vercel — env vars must be set via Vercel dashboard
  }

  res.json({ ok: true });
});

router.post('/test', requireAdmin, async (req, res) => {
  try {
    await getAccessToken();
    res.json({ ok: true, message: 'Zoho connection successful.' });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/exchange-code', requireAdmin, async (req, res) => {
  const { clientId, clientSecret, code } = req.body || {};
  if (!clientId || !clientSecret || !code) {
    return res.status(400).json({ error: 'clientId, clientSecret and code are all required.' });
  }

  const tld = (process.env.ZOHO_DOMAIN || 'com').replace(/^\./, '');
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId.trim(),
    client_secret: clientSecret.trim(),
    redirect_uri: 'https://www.zoho.com',
    code: code.trim(),
  });

  try {
    const response = await axios.post(
      `https://accounts.zoho.${tld}/oauth/v2/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const data = response.data;
    if (!data.refresh_token) {
      return res.status(502).json({ error: `Token exchange failed: ${JSON.stringify(data)}` });
    }

    const refreshToken = data.refresh_token;

    let content = readEnv();
    content = setEnvVar(content, 'ZOHO_CLIENT_ID', clientId.trim());
    content = setEnvVar(content, 'ZOHO_CLIENT_SECRET', clientSecret.trim());
    content = setEnvVar(content, 'ZOHO_REFRESH_TOKEN', refreshToken);

    process.env.ZOHO_CLIENT_ID = clientId.trim();
    process.env.ZOHO_CLIENT_SECRET = clientSecret.trim();
    process.env.ZOHO_REFRESH_TOKEN = refreshToken;

    try { fs.writeFileSync(ENV_PATH, content, 'utf8'); } catch { /* read-only on Vercel */ }

    res.json({ ok: true, refreshToken });
  } catch (err) {
    const msg = err.response ? JSON.stringify(err.response.data) : err.message;
    res.status(502).json({ error: `Token exchange failed: ${msg}` });
  }
});

module.exports = router;
