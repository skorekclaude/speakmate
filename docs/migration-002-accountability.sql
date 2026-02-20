-- ============================================================
-- Migration 002: source_agent column + accountability loop
-- ============================================================
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add source_agent column to allma_memory
ALTER TABLE allma_memory ADD COLUMN IF NOT EXISTS source_agent TEXT;

-- 2. Migrate existing metadata.source_agent to column
UPDATE allma_memory
SET source_agent = metadata->>'source_agent'
WHERE metadata->>'source_agent' IS NOT NULL
  AND source_agent IS NULL;

-- 3. Add deadline column for commitments
ALTER TABLE allma_memory ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ;

-- 4. Add done_at column for completed commitments
ALTER TABLE allma_memory ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;

-- 5. Index for accountability queries (find overdue commitments)
CREATE INDEX IF NOT EXISTS idx_allma_memory_commitments
  ON allma_memory(user_id, type, deadline)
  WHERE type = 'commitment';

-- 6. Index for cross-agent insights
CREATE INDEX IF NOT EXISTS idx_allma_memory_source_agent
  ON allma_memory(user_id, source_agent);

-- 7. Helper function: get overdue commitments for a user
CREATE OR REPLACE FUNCTION get_overdue_commitments(
  p_user_id TEXT,
  p_days_overdue INT DEFAULT 2
) RETURNS SETOF allma_memory
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT *
  FROM allma_memory
  WHERE user_id = p_user_id
    AND type = 'commitment'
    AND done_at IS NULL
    AND (
      -- Has explicit deadline that's passed
      (deadline IS NOT NULL AND deadline < NOW())
      OR
      -- No deadline but created more than p_days_overdue days ago
      (deadline IS NULL AND created_at < NOW() - (p_days_overdue || ' days')::INTERVAL)
    )
  ORDER BY
    CASE WHEN deadline IS NOT NULL THEN deadline ELSE created_at END ASC
  LIMIT 10;
$$;

-- 8. Helper function: get cross-agent insights (what different agents know)
CREATE OR REPLACE FUNCTION get_cross_agent_insights(
  p_user_id TEXT,
  p_limit INT DEFAULT 20
) RETURNS TABLE(
  source_agent TEXT,
  type TEXT,
  content TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT source_agent, type, content, created_at
  FROM allma_memory
  WHERE user_id = p_user_id
    AND source_agent IS NOT NULL
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;
