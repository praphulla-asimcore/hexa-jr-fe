require('dotenv').config();
const express = require('express');
const cors = require('cors');

const parseRoute = require('./routes/parse');
const accountsRoute = require('./routes/accounts');
const postJeRoute = require('./routes/postJe');
const adminRoute = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/parse', parseRoute);
app.use('/api/accounts', accountsRoute);
app.use('/api/post-je', postJeRoute);
app.use('/api/admin', adminRoute);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`CSI server running on http://localhost:${PORT}`);
});
