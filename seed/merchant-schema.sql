-- Merchant platform schema for TRACKER_CLOUDFLARE-
-- Core 12 tables used by the merchant collaboration worker.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS merchant_profiles (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL UNIQUE,
  merchant_id TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  merchant_type TEXT NOT NULL DEFAULT 'independent',
  region TEXT,
  default_currency TEXT NOT NULL DEFAULT 'USDT',
  discoverability TEXT NOT NULL DEFAULT 'public',
  bio TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merchant_profiles_nickname ON merchant_profiles(nickname);
CREATE INDEX IF NOT EXISTS idx_merchant_profiles_status ON merchant_profiles(status);

CREATE TABLE IF NOT EXISTS merchant_invites (
  id TEXT PRIMARY KEY,
  from_merchant_id TEXT NOT NULL REFERENCES merchant_profiles(id),
  to_merchant_id TEXT NOT NULL REFERENCES merchant_profiles(id),
  status TEXT NOT NULL DEFAULT 'pending',
  purpose TEXT,
  requested_role TEXT NOT NULL DEFAULT 'operator',
  message TEXT,
  requested_scope TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merchant_invites_to_status ON merchant_invites(to_merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_merchant_invites_from_status ON merchant_invites(from_merchant_id, status);

CREATE TABLE IF NOT EXISTS merchant_relationships (
  id TEXT PRIMARY KEY,
  merchant_a_id TEXT NOT NULL REFERENCES merchant_profiles(id),
  merchant_b_id TEXT NOT NULL REFERENCES merchant_profiles(id),
  invite_id TEXT REFERENCES merchant_invites(id),
  relationship_type TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'active',
  shared_fields TEXT,
  approval_policy TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merchant_relationships_a ON merchant_relationships(merchant_a_id);
CREATE INDEX IF NOT EXISTS idx_merchant_relationships_b ON merchant_relationships(merchant_b_id);
CREATE INDEX IF NOT EXISTS idx_merchant_relationships_status ON merchant_relationships(status);

CREATE TABLE IF NOT EXISTS merchant_roles (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES merchant_relationships(id),
  merchant_id TEXT NOT NULL REFERENCES merchant_profiles(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_roles_unique ON merchant_roles(relationship_id, merchant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_merchant_roles_user ON merchant_roles(user_id);

CREATE TABLE IF NOT EXISTS merchant_deals (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES merchant_relationships(id),
  deal_type TEXT NOT NULL,
  title TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USDT',
  status TEXT NOT NULL DEFAULT 'draft',
  metadata TEXT,
  issue_date TEXT,
  due_date TEXT,
  close_date TEXT,
  expected_return REAL,
  realized_pnl REAL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merchant_deals_rel ON merchant_deals(relationship_id);
CREATE INDEX IF NOT EXISTS idx_merchant_deals_status ON merchant_deals(status);

CREATE TABLE IF NOT EXISTS merchant_settlements (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES merchant_relationships(id),
  deal_id TEXT NOT NULL REFERENCES merchant_deals(id),
  submitted_by_user_id TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDT',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merchant_settlements_deal ON merchant_settlements(deal_id);
CREATE INDEX IF NOT EXISTS idx_merchant_settlements_status ON merchant_settlements(status);

CREATE TABLE IF NOT EXISTS merchant_profit_records (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES merchant_relationships(id),
  deal_id TEXT NOT NULL REFERENCES merchant_deals(id),
  period_key TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDT',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_by_user_id TEXT NOT NULL,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merchant_profit_records_deal ON merchant_profit_records(deal_id);
CREATE INDEX IF NOT EXISTS idx_merchant_profit_records_status ON merchant_profit_records(status);

CREATE TABLE IF NOT EXISTS merchant_approvals (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES merchant_relationships(id),
  type TEXT NOT NULL,
  target_entity_type TEXT,
  target_entity_id TEXT,
  proposed_payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_by_user_id TEXT NOT NULL,
  submitted_by_merchant_id TEXT NOT NULL REFERENCES merchant_profiles(id),
  reviewer_user_id TEXT NOT NULL,
  resolution_note TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merchant_approvals_reviewer_status ON merchant_approvals(reviewer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_merchant_approvals_submitter ON merchant_approvals(submitted_by_user_id);

CREATE TABLE IF NOT EXISTS merchant_messages (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL REFERENCES merchant_relationships(id),
  sender_user_id TEXT NOT NULL,
  sender_merchant_id TEXT REFERENCES merchant_profiles(id),
  body TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merchant_messages_rel ON merchant_messages(relationship_id, created_at);

CREATE TABLE IF NOT EXISTS merchant_message_reads (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES merchant_messages(id),
  user_id TEXT NOT NULL,
  read_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_message_reads_unique ON merchant_message_reads(message_id, user_id);
CREATE INDEX IF NOT EXISTS idx_merchant_message_reads_user ON merchant_message_reads(user_id);

CREATE TABLE IF NOT EXISTS merchant_audit_logs (
  id TEXT PRIMARY KEY,
  relationship_id TEXT REFERENCES merchant_relationships(id),
  actor_user_id TEXT,
  actor_merchant_id TEXT REFERENCES merchant_profiles(id),
  entity_type TEXT,
  entity_id TEXT,
  action TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merchant_audit_logs_rel ON merchant_audit_logs(relationship_id, created_at);
CREATE INDEX IF NOT EXISTS idx_merchant_audit_logs_actor ON merchant_audit_logs(actor_user_id, created_at);

CREATE TABLE IF NOT EXISTS merchant_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  relationship_id TEXT REFERENCES merchant_relationships(id),
  category TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  body TEXT,
  data_json TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merchant_notifications_user_created ON merchant_notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_merchant_notifications_unread ON merchant_notifications(user_id, read_at);
