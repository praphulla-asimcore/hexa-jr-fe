const axios = require('axios');

let cachedToken = null;
let tokenExpiry = 0;

function getZohoDomain() {
  const tld = (process.env.ZOHO_DOMAIN || 'com').replace(/^\./, '');
  return tld;
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = process.env;

  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error('Zoho credentials not configured in .env');
  }

  const tld = getZohoDomain();

  const params = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });

  const response = await axios.post(
    `https://accounts.zoho.${tld}/oauth/v2/token`,
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  if (!response.data.access_token) {
    throw new Error(`Zoho token error: ${JSON.stringify(response.data)}`);
  }

  cachedToken = response.data.access_token;
  tokenExpiry = Date.now() + (response.data.expires_in || 3600) * 1000;
  return cachedToken;
}

function zohoError(context, err) {
  if (err.response) {
    const body = err.response.data;
    const msg = typeof body === 'object' ? JSON.stringify(body) : String(body);
    return new Error(`Zoho ${context} [${err.response.status}]: ${msg || err.message}`);
  }
  return err;
}

async function fetchAccounts(orgId) {
  const token = await getAccessToken();
  const tld = getZohoDomain();
  try {
    const response = await axios.get(
      `https://www.zohoapis.${tld}/books/v3/chartofaccounts?organization_id=${orgId}`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { per_page: 200 },
      }
    );

    const data = response.data;
    if (data.code !== 0) {
      throw new Error(`Zoho accounts error [${data.code}]: ${data.message}`);
    }

    return (data.chartofaccounts || []).map((a) => ({
      id: a.account_id,
      name: a.account_name,
      type: a.account_type,
    }));
  } catch (err) {
    throw zohoError('accounts', err);
  }
}

async function postJournalEntry(orgId, payload) {
  const token = await getAccessToken();
  const tld = getZohoDomain();
  const url = `https://www.zohoapis.${tld}/books/v3/manualjournals`;
  console.log('[Zoho POST]', url, 'org:', orgId);
  console.log('[Zoho payload]', JSON.stringify(payload));
  try {
    const response = await axios.post(
      url,
      payload,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          'Content-Type': 'application/json',
        },
        params: { organization_id: String(orgId).trim() },
      }
    );

    const data = response.data;
    console.log('[Zoho response]', JSON.stringify(data));
    if (data.code !== 0) {
      throw new Error(`Zoho JE error [${data.code}]: ${data.message}`);
    }

    return data.journal;
  } catch (err) {
    if (err.response) {
      console.error('[Zoho error]', err.response.status, JSON.stringify(err.response.data));
    }
    throw zohoError('journal entry', err);
  }
}

module.exports = { getAccessToken, fetchAccounts, postJournalEntry };
