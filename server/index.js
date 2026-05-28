require('dotenv').config();
const express = require('express');
const cors = require('cors');

const parseRoute = require('./routes/parse');
const accountsRoute = require('./routes/accounts');
const postJeRoute = require('./routes/postJe');
const adminRoute = require('./routes/admin');
const authRoute = require('./routes/auth');
const usersRoute = require('./routes/users');
const journalHistoryRoute = require('./routes/journalHistory');
const finopsRoute = require('./routes/finops');
const consultantsRoute = require('./routes/consultants');

const app = express();

const allowedOrigins = [
  'http://localhost:5173',
  /\.vercel\.app$/,
  'https://hexajrfe.hexamatics.finance',
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const ok = allowedOrigins.some((o) =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    cb(ok ? null : new Error('CORS'), ok);
  },
}));

app.use(express.json());

app.use('/api/parse', parseRoute);
app.use('/api/accounts', accountsRoute);
app.use('/api/post-je', postJeRoute);
app.use('/api/admin', adminRoute);
app.use('/api/auth', authRoute);
app.use('/api/users', usersRoute);
app.use('/api/journal-history', journalHistoryRoute);
app.use('/api/finops', finopsRoute);
app.use('/api/consultants', consultantsRoute);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

module.exports = app;
