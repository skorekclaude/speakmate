-- ============================================================
-- ALLMA — Supabase Schema
-- ============================================================
-- Run this SQL in your Supabase SQL editor to set up the tables.
-- ============================================================

-- User profiles
CREATE TABLE IF NOT EXISTS allma_users (
  id TEXT PRIMARY KEY,
  name TEXT,
  timezone TEXT DEFAULT 'UTC',
  language TEXT DEFAULT 'en',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Persistent memory (facts, goals, insights)
CREATE TABLE IF NOT EXISTS allma_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES allma_users(id),
  category TEXT NOT NULL DEFAULT 'fact',  -- fact, goal, insight, psycho, contact
  content TEXT NOT NULL,
  embedding VECTOR(1536),                 -- Optional: for semantic search
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for text search
CREATE INDEX IF NOT EXISTS idx_allma_memory_fts
  ON allma_memory USING gin(to_tsvector('english', content));

-- Create index for category lookups
CREATE INDEX IF NOT EXISTS idx_allma_memory_category
  ON allma_memory(user_id, category);

-- Conversation history
CREATE TABLE IF NOT EXISTS allma_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES allma_users(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  agent_id TEXT,              -- Which agent responded (general, psycho, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for history lookups
CREATE INDEX IF NOT EXISTS idx_allma_messages_user
  ON allma_messages(user_id, created_at DESC);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
-- IMPORTANT: These policies block all access via anon key.
-- The bot uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
-- This means user data is protected from unauthorized access.

ALTER TABLE allma_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE allma_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE allma_messages ENABLE ROW LEVEL SECURITY;

-- Block all anon access (service role key bypasses these)
CREATE POLICY "No anon access" ON allma_users FOR ALL USING (false);
CREATE POLICY "No anon access" ON allma_memory FOR ALL USING (false);
CREATE POLICY "No anon access" ON allma_messages FOR ALL USING (false);

-- Subscription tracking (mirrors Stripe, for fast lookups)
CREATE TABLE IF NOT EXISTS allma_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES allma_users(id),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'essencial', 'premium')),
  status TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'none')),
  current_period_end TIMESTAMPTZ,
  sessions_used INT DEFAULT 0,
  sessions_reset_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_allma_subscriptions_user
  ON allma_subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_allma_subscriptions_stripe
  ON allma_subscriptions(stripe_customer_id);

ALTER TABLE allma_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No anon access" ON allma_subscriptions FOR ALL USING (false);

-- ============================================================
-- Optional: RPC functions for advanced queries
-- ============================================================

-- Search memory with full-text search
CREATE OR REPLACE FUNCTION search_allma_memory(
  p_user_id TEXT,
  p_query TEXT,
  p_limit INT DEFAULT 10
) RETURNS SETOF allma_memory
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT *
  FROM allma_memory
  WHERE user_id = p_user_id
    AND to_tsvector('english', content) @@ plainto_tsquery('english', p_query)
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;
