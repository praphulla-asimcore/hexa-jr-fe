const express = require('express');

const router = express.Router();

function getConfig() {
  return {
    apiKey: process.env.AIRTABLE_API_KEY,
    baseId: process.env.AIRTABLE_BASE_ID,
    tableName: process.env.AIRTABLE_TABLE_NAME,
    viewId: process.env.AIRTABLE_VIEW_ID,
  };
}

function mapRecord(record) {
  const f = record.fields;
  return {
    id: record.id,
    name: f['Full Legal Name'] || '—',
    employeeNumber: f['Employee Number'] || '—',
    employeeId: f['Employee ID'] || '—',
    idNumber: f['ID Number'] || '—',
    client: f['Client Name'] || '—',
    contractStart: f['Contract Start Date'] || null,
    contractEnd: f['Contract End Date'] || null,
    salary: f['Current Monthly Salary'] || null,
    bankName: f['Bank Name'] || '—',
    accountNo: f['Bank Account Number'] || '—',
  };
}

async function fetchAllRecords({ apiKey, baseId, tableName, viewId }) {
  const records = [];
  let offset = null;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`
    );
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(new Error(`Airtable ${res.status}`), { status: res.status, body });
    }

    const data = await res.json();
    records.push(...data.records);
    offset = data.offset || null;
  } while (offset);

  return records;
}

router.get('/', async (req, res) => {
  const cfg = getConfig();
  if (!cfg.apiKey || !cfg.baseId || !cfg.tableName) {
    return res.status(503).json({ error: 'Airtable not configured' });
  }

  try {
    const raw = await fetchAllRecords(cfg);
    const consultants = raw.map(mapRecord);
    res.json({ consultants, total: consultants.length });
  } catch (err) {
    console.error('Airtable fetch error:', err.status, err.body || err.message);
    res.status(502).json({
      error: 'Failed to fetch consultant data from Airtable',
      detail: err.body || err.message,
    });
  }
});

module.exports = router;
