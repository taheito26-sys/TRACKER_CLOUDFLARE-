CREATE TABLE IF NOT EXISTS merchant_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  email TEXT,
  merchant_id TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  merchant_type TEXT NOT NULL,
  region TEXT,
  discoverability TEXT NOT NULL DEFAULT 'public',
  default_currency TEXT NOT NULL DEFAULT 'USDT',
  bio TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_merchant_profiles_display_name
  ON merchant_profiles(display_name);

CREATE INDEX IF NOT EXISTS idx_merchant_profiles_region
  ON merchant_profiles(region);

CREATE INDEX IF NOT EXISTS idx_merchant_profiles_status
  ON merchant_profiles(status);

INSERT OR IGNORE INTO schema_migrations (version, description)
VALUES ('003', 'merchant profile compatibility schema on backend DB');
