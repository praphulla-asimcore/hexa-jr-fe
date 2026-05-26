const express = require('express');
const { fetchAccounts } = require('../services/zoho');

const router = express.Router();

router.get('/:orgId', async (req, res) => {
  const { orgId } = req.params;
  if (!orgId || orgId === 'ZOHO_ORG_ID_HERE') {
    return res.status(400).json({ error: 'Valid Zoho organisation ID required. Update server/config/orgs.json.' });
  }

  try {
    const accounts = await fetchAccounts(orgId);
    res.json({ accounts });
  } catch (err) {
    console.error('Accounts fetch error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
