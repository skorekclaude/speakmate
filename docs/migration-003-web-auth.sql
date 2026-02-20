-- ============================================================
-- ALLMA — Migration 003: Web Authentication
-- ============================================================
-- Adds email-based auth support for web users.
-- Run this in Supabase SQL editor.
-- ============================================================

-- Add email and auth_provider columns to allma_users
ALTER TABLE allma_users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE allma_users ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'telegram';
-- auth_provider: 'telegram' | 'web_email'

-- Add telegram_id column if not exists (already present in most setups, but just in case)
ALTER TABLE allma_users ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE;
ALTER TABLE allma_users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE allma_users ADD COLUMN IF NOT EXISTS username TEXT;

-- Index on email for fast lookups
CREATE INDEX IF NOT EXISTS idx_allma_users_email ON allma_users(email);

-- Done
SELECT 'Migration 003 complete: Web auth columns added' AS status;
