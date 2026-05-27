const express = require('express');
const { getDb } = require('../services/db');

const router = express.Router();

// GET /api/journal-history — public (all logged-in users can view)
router.get('/', async (req, res) => {
  const db = getDb();
  if (!db) return res.json({ posts: [] });

  const { data, error } = await db
    .from('journal_posts')
    .select('*')
    .order('posted_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ posts: data || [] });
});

// GET /api/journal-history/stats
router.get('/stats', async (req, res) => {
  const db = getDb();
  if (!db) return res.json({ byEntity: [], byModule: [], recentMonths: [] });

  const { data: posts } = await db.from('journal_posts').select('entity, module, total_amount, posted_at, journal_date');

  if (!posts) return res.json({ byEntity: [], byModule: [], recentMonths: [] });

  const byEntity = {};
  const byModule = { csi: { count: 0, total: 0 }, payroll: { count: 0, total: 0 } };
  const byMonth = {};

  for (const p of posts) {
    // by entity
    if (!byEntity[p.entity]) byEntity[p.entity] = { count: 0, total: 0 };
    byEntity[p.entity].count++;
    byEntity[p.entity].total += parseFloat(p.total_amount || 0);

    // by module
    const mod = p.module || 'csi';
    byModule[mod] = byModule[mod] || { count: 0, total: 0 };
    byModule[mod].count++;
    byModule[mod].total += parseFloat(p.total_amount || 0);

    // by month
    const ym = (p.journal_date || p.posted_at || '').slice(0, 7);
    if (ym) {
      if (!byMonth[ym]) byMonth[ym] = { count: 0, total: 0 };
      byMonth[ym].count++;
      byMonth[ym].total += parseFloat(p.total_amount || 0);
    }
  }

  const recentMonths = Object.entries(byMonth)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 12)
    .map(([month, v]) => ({ month, ...v }));

  res.json({
    byEntity: Object.entries(byEntity).map(([entity, v]) => ({ entity, ...v })).sort((a, b) => b.total - a.total),
    byModule: Object.entries(byModule).map(([mod, v]) => ({ module: mod, ...v })),
    recentMonths,
    totalPosts: posts.length,
    totalAmount: posts.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0),
  });
});

module.exports = router;
