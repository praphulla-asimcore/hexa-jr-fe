const axios = require('axios');

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = process.env;

  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error('Zoho credentials not configured in .env');
  }

  const params = new URLSearchParams({
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });

  const response = await axios.post(
    'https://accounts.zoho.com/oauth/v2/token',
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

async function fetchAccounts(orgId) {
  const token = await getAccessToken();
  const response = await axios.get(
    `https://www.zohoapis.com/books/v3/chartofaccounts?organization_id=${orgId}`,
    {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { filter_by: 'AccountType.All', per_page: 200 },
    }
  );

  const data = response.data;
  if (data.code !== 0) {
    throw new Error(`Zoho accounts error: ${data.message}`);
  }

  return (data.chartofaccounts || []).map((a) => ({
    id: a.account_id,
    name: a.account_name,
    type: a.account_type,
  }));
}

async function postJournalEntry(orgId, payload) {
  const token = await getAccessToken();
  const response = await axios.post(
    `https://www.zohoapis.com/books/v3/journalentries?organization_id=${orgId}`,
    payload,
    { headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' } }
  );

  const data = response.data;
  if (data.code !== 0) {
    throw new Error(`Zoho JE error: ${data.message}`);
  }

  return data.journal;
}

module.exports = { getAccessToken, fetchAccounts, postJournalEntry };
