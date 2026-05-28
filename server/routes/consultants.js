const express = require('express');
const axios = require('axios');

const router = express.Router();

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
const AIRTABLE_VIEW_ID = process.env.AIRTABLE_VIEW_ID;

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

// Fetch all pages from Airtable (100 records per page)
async function fetchAllRecords() {
  const records = [];
  let offset = null;

  do {
    const params = {
      view: AIRTABLE_VIEW_ID,
      pageSize: 100,
    };
    if (offset) params.offset = offset;

    const res = await axios.get(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`,
      {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
        params,
      }
    );

    records.push(...res.data.records);
    offset = res.data.offset || null;
  } while (offset);

  return records;
}

router.get('/', async (req, res) => {
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME) {
    return res.status(503).json({ error: 'Airtable not configured' });
  }

  try {
    const raw = await fetchAllRecords();
    const consultants = raw.map(mapRecord);
    res.json({ consultants, total: consultants.length });
  } catch (err) {
    console.error('Airtable fetch error:', err.response?.data || err.message);
    res.status(502).json({ error: 'Failed to fetch consultant data from Airtable' });
  }
});

module.exports = router;
