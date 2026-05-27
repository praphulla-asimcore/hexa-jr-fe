-- Run this in your Supabase SQL editor (supabase.com → project → SQL Editor)

CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
  status       TEXT NOT NULL DEFAULT 'invited', -- 'invited' | 'active'
  password_hash TEXT,
  invite_token  TEXT,
  invite_expires TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  last_login   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS journal_posts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module           TEXT NOT NULL DEFAULT 'csi',  -- 'csi' | 'payroll'
  entity           TEXT NOT NULL,
  org_id           TEXT NOT NULL,
  journal_id       TEXT,
  reference_number TEXT,
  journal_date     DATE NOT NULL,
  total_amount     NUMERIC,
  notes            TEXT,
  posted_by_email  TEXT NOT NULL,
  posted_by_name   TEXT NOT NULL,
  posted_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS journal_posts_entity_idx ON journal_posts (entity);
CREATE INDEX IF NOT EXISTS journal_posts_posted_at_idx ON journal_posts (posted_at DESC);
CREATE INDEX IF NOT EXISTS journal_posts_module_idx ON journal_posts (module);
