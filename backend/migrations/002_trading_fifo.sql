-- Phase 4 foundation: trading domain + FIFO allocation persistence

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  asset_symbol TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_batches_user_asset_time
  ON batches (user_id, asset_symbol, acquired_at, id);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  asset_symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  traded_at TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  fee REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
  source_batch_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_batch_id) REFERENCES batches(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_user_asset_time
  ON trades (user_id, asset_symbol, traded_at, id);

CREATE INDEX IF NOT EXISTS idx_trades_user_status
  ON trades (user_id, status);

CREATE TABLE IF NOT EXISTS trade_allocations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  trade_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  allocated_qty REAL NOT NULL CHECK (allocated_qty > 0),
  batch_unit_cost REAL NOT NULL CHECK (batch_unit_cost >= 0),
  allocated_cost REAL NOT NULL CHECK (allocated_cost >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(trade_id, batch_id),
  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trade_allocations_user_trade
  ON trade_allocations (user_id, trade_id);

CREATE INDEX IF NOT EXISTS idx_trade_allocations_user_batch
  ON trade_allocations (user_id, batch_id);

INSERT OR IGNORE INTO schema_migrations (version, description)
VALUES ('002', 'phase4 trading domain tables: batches, trades, trade_allocations');
