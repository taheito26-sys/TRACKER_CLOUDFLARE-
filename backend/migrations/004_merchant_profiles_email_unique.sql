CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_profiles_email 
ON merchant_profiles(lower(email)) 
WHERE email IS NOT NULL AND email != '';

INSERT OR IGNORE INTO schema_migrations (version, description)
VALUES ('004', 'Merchant profiles email uniqueness constraint');
