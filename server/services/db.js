const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getDb() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key);
  return _client;
}

module.exports = { getDb };
