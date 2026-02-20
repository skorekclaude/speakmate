-- ============================================================
-- SpeakMate — Initial Schema Migration
-- Dedicated Supabase project: zpgwcnxqqzmnnimqxnzd
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- sm_users — User profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS sm_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  native_language TEXT NOT NULL DEFAULT 'pl',
  target_language TEXT NOT NULL DEFAULT 'en',
  level TEXT NOT NULL DEFAULT 'intermediate',
  allma_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sm_users_email ON sm_users(email);

-- ============================================================
-- sm_messages — Chat history
-- ============================================================
CREATE TABLE IF NOT EXISTS sm_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES sm_users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL DEFAULT 'general',
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  correction JSONB,
  vocab JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sm_messages_user_agent ON sm_messages(user_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_sm_messages_created ON sm_messages(created_at DESC);

-- ============================================================
-- sm_vocabulary — Tracked words
-- ============================================================
CREATE TABLE IF NOT EXISTS sm_vocabulary (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES sm_users(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  translation TEXT NOT NULL DEFAULT '',
  times_seen INTEGER NOT NULL DEFAULT 1,
  mastered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, word)
);

CREATE INDEX IF NOT EXISTS idx_sm_vocabulary_user ON sm_vocabulary(user_id);

-- ============================================================
-- sm_progress — Daily progress tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS sm_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES sm_users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  corrections_received INTEGER NOT NULL DEFAULT 0,
  new_words INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sm_progress_user_date ON sm_progress(user_id, date);

-- ============================================================
-- RLS Policies — Block anon, allow service_role only
-- ============================================================

ALTER TABLE sm_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_progress ENABLE ROW LEVEL SECURITY;

-- Block all anon access (service_role bypasses RLS)
CREATE POLICY "Deny anon sm_users" ON sm_users FOR ALL USING (false);
CREATE POLICY "Deny anon sm_messages" ON sm_messages FOR ALL USING (false);
CREATE POLICY "Deny anon sm_vocabulary" ON sm_vocabulary FOR ALL USING (false);
CREATE POLICY "Deny anon sm_progress" ON sm_progress FOR ALL USING (false);

-- ============================================================
-- Done!
-- ============================================================
