-- BYOK: Add settings JSONB column to sm_users
ALTER TABLE sm_users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';

-- Index for quick BYOK lookups
CREATE INDEX IF NOT EXISTS idx_sm_users_settings ON sm_users USING gin (settings);
