CREATE TABLE IF NOT EXISTS user_preferences (
    user_key TEXT PRIMARY KEY,
    theme TEXT DEFAULT 't1',
    layout TEXT DEFAULT 'flux',
    last_page TEXT DEFAULT 'dashboard',
    settings_json TEXT DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
