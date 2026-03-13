-- ================================================================
-- TAHEITO PRO X — Cloudflare D1 Schema
-- Based on full audit of 14,226-line index.html
-- Run: wrangler d1 execute taheito-pro-db --file=schema.sql
-- ================================================================

-- AUTH
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT UNIQUE,
    display_name    TEXT,
    google_id       TEXT UNIQUE,
    role            TEXT DEFAULT 'owner',
    settings        TEXT DEFAULT '{}',
    prefs           TEXT DEFAULT '{}',
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token           TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    expires_at      TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- MERCHANTS
CREATE TABLE IF NOT EXISTS merchants (
    id              TEXT PRIMARY KEY,
    user_id         TEXT REFERENCES users(id),
    display_name    TEXT NOT NULL,
    nickname        TEXT,
    merchant_type   TEXT DEFAULT 'general',
    phone           TEXT DEFAULT '',
    email           TEXT DEFAULT '',
    region          TEXT DEFAULT '',
    bio             TEXT DEFAULT '',
    risk_level      TEXT DEFAULT 'low',
    discoverability TEXT DEFAULT 'public',
    default_profit_ratio REAL DEFAULT 60,
    status          TEXT DEFAULT 'active' CHECK(status IN ('active','restricted','suspended','terminated','archived')),
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- INVITES
CREATE TABLE IF NOT EXISTS invites (
    id              TEXT PRIMARY KEY,
    from_merchant   TEXT NOT NULL REFERENCES merchants(id),
    to_merchant     TEXT,
    to_identifier   TEXT,
    from_display_name TEXT DEFAULT '',
    from_nickname   TEXT DEFAULT '',
    purpose         TEXT DEFAULT '',
    message         TEXT DEFAULT '',
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','withdrawn','expired')),
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    expires_at      TEXT
);

-- RELATIONSHIPS
CREATE TABLE IF NOT EXISTS relationships (
    id              TEXT PRIMARY KEY,
    merchant_a      TEXT NOT NULL REFERENCES merchants(id),
    merchant_b      TEXT NOT NULL REFERENCES merchants(id),
    status          TEXT DEFAULT 'active' CHECK(status IN ('active','suspended','closed')),
    credit_limit    REAL DEFAULT 0,
    terms           TEXT DEFAULT '{}',
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(merchant_a, merchant_b)
);

-- TRADING: BATCHES (currently state.batches in localStorage)
CREATE TABLE IF NOT EXISTS batches (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    supplier_id     TEXT,
    source          TEXT DEFAULT '',
    initial_usdt    REAL NOT NULL CHECK(initial_usdt > 0),
    buy_price_qar   REAL NOT NULL CHECK(buy_price_qar > 0),
    fee_qar         REAL DEFAULT 0,
    notes           TEXT DEFAULT '',
    status          TEXT DEFAULT 'open' CHECK(status IN ('open','closed')),
    created_at      TEXT DEFAULT (datetime('now'))
);

-- TRADING: TRADES (currently state.trades in localStorage)
CREATE TABLE IF NOT EXISTS trades (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    customer_id     TEXT,
    customer_name   TEXT DEFAULT '',
    amount_usdt     REAL NOT NULL CHECK(amount_usdt > 0),
    sell_price_qar  REAL NOT NULL CHECK(sell_price_qar > 0),
    fee_qar         REAL DEFAULT 0,
    uses_stock      INTEGER DEFAULT 1,
    voided          INTEGER DEFAULT 0,
    notes           TEXT DEFAULT '',
    created_at      TEXT DEFAULT (datetime('now'))
);

-- FIFO ALLOCATIONS (computed server-side, replaces recomputeFor())
CREATE TABLE IF NOT EXISTS trade_allocations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id        TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    batch_id        TEXT NOT NULL REFERENCES batches(id),
    qty_usdt        REAL NOT NULL,
    cost_qar        REAL NOT NULL
);

-- CRM: CUSTOMERS (currently state.customers in localStorage)
CREATE TABLE IF NOT EXISTS customers (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    name            TEXT NOT NULL,
    phone           TEXT DEFAULT '',
    tier            TEXT DEFAULT 'C' CHECK(tier IN ('A','B','C','D')),
    location        TEXT DEFAULT '',
    daily_limit     REAL DEFAULT 0,
    notes           TEXT DEFAULT '',
    status          TEXT DEFAULT 'active' CHECK(status IN ('active','blocked')),
    created_at      TEXT DEFAULT (datetime('now'))
);

-- CRM: SUPPLIERS (currently state.suppliers in localStorage)
CREATE TABLE IF NOT EXISTS suppliers (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    name            TEXT NOT NULL,
    phone           TEXT DEFAULT '',
    typical_price   REAL DEFAULT 0,
    location        TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    status          TEXT DEFAULT 'active' CHECK(status IN ('active','blocked','archived')),
    created_at      TEXT DEFAULT (datetime('now'))
);

-- DEALS: 4 TYPES (currently MS.advances/purchases/profitShares/pools)
CREATE TABLE IF NOT EXISTS deals (
    id              TEXT PRIMARY KEY,
    relationship_id TEXT NOT NULL REFERENCES relationships(id),
    creator_id      TEXT NOT NULL REFERENCES merchants(id),
    deal_type       TEXT NOT NULL CHECK(deal_type IN ('advance','purchase','profit_share','pool')),
    deal_ref        TEXT UNIQUE,

    -- Common
    currency        TEXT DEFAULT 'USDT',
    principal       REAL DEFAULT 0,
    usdt_qty        REAL DEFAULT 0,
    rate_qar        REAL DEFAULT 0,
    service_fee     REAL DEFAULT 0,
    sent_date       TEXT,
    due_date        TEXT,
    status          TEXT DEFAULT 'sent' CHECK(status IN (
        'draft','sent','acknowledged','active','due','overdue',
        'partially_returned','returned','settled','closed',
        'cancelled','written_off','paid','unpaid','disputed'
    )),
    notes           TEXT DEFAULT '',

    -- Purchase-specific
    sale_rate       REAL DEFAULT 0,
    cost_basis      REAL DEFAULT 0,
    sale_margin     REAL DEFAULT 0,
    total_sale_value REAL DEFAULT 0,
    payment_method  TEXT DEFAULT '',

    -- Profit-share specific
    owner_ratio     REAL DEFAULT 0,
    operator_ratio  REAL DEFAULT 0,
    loss_policy     TEXT DEFAULT '',
    principal_guarantee INTEGER DEFAULT 0,
    final_proceeds  REAL DEFAULT 0,
    final_fees      REAL DEFAULT 0,

    -- Pool-specific
    initial_capital REAL DEFAULT 0,
    monthly_target  REAL DEFAULT 0,
    top_ups         REAL DEFAULT 0,
    withdrawals     REAL DEFAULT 0,

    -- Return tracking
    returned_amount REAL DEFAULT 0,
    paid_amount     REAL DEFAULT 0,
    approved_offsets REAL DEFAULT 0,
    transfer_proof  TEXT DEFAULT '',

    settled_at      TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- POOL PERIODS
CREATE TABLE IF NOT EXISTS pool_periods (
    id              TEXT PRIMARY KEY,
    deal_id         TEXT NOT NULL REFERENCES deals(id),
    period_label    TEXT NOT NULL,
    opening_balance REAL DEFAULT 0,
    closing_balance REAL DEFAULT 0,
    gross_profit    REAL DEFAULT 0,
    fees            REAL DEFAULT 0,
    net_profit      REAL DEFAULT 0,
    owner_share     REAL DEFAULT 0,
    operator_share  REAL DEFAULT 0,
    payout_amount   REAL DEFAULT 0,
    payout_status   TEXT DEFAULT 'unpaid',
    created_at      TEXT DEFAULT (datetime('now'))
);

-- DOUBLE-ENTRY JOURNAL (currently MS.journal in localStorage)
CREATE TABLE IF NOT EXISTS journal (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    dr_account      TEXT NOT NULL,
    cr_account      TEXT NOT NULL,
    amount          REAL NOT NULL CHECK(amount > 0),
    currency        TEXT DEFAULT 'USDT',
    ref_type        TEXT DEFAULT '',
    ref_id          TEXT DEFAULT '',
    memo            TEXT DEFAULT '',
    created_at      TEXT DEFAULT (datetime('now'))
);

-- SETTLEMENTS
CREATE TABLE IF NOT EXISTS settlements (
    id              TEXT PRIMARY KEY,
    relationship_id TEXT NOT NULL REFERENCES relationships(id),
    deal_ids        TEXT NOT NULL DEFAULT '[]',
    gross_amount    REAL NOT NULL,
    fees            REAL DEFAULT 0,
    net_amount      REAL NOT NULL,
    currency        TEXT DEFAULT 'USDT',
    method          TEXT DEFAULT '',
    reference       TEXT DEFAULT '',
    status          TEXT DEFAULT 'draft' CHECK(status IN ('draft','pending','confirmed','settled','disputed')),
    settled_at      TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- MESSAGES
CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    relationship_id TEXT NOT NULL REFERENCES relationships(id),
    sender_id       TEXT NOT NULL REFERENCES merchants(id),
    sender_name     TEXT DEFAULT '',
    body            TEXT NOT NULL,
    msg_type        TEXT DEFAULT 'text' CHECK(msg_type IN (
        'text','deal_proposal','deal_accepted','deal_rejected',
        'payment_notice','settlement_notice','system'
    )),
    ref_deal_id     TEXT,
    ref_tx_id       TEXT,
    read_at         TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- APPROVALS
CREATE TABLE IF NOT EXISTS approvals (
    id              TEXT PRIMARY KEY,
    submitted_by    TEXT NOT NULL REFERENCES merchants(id),
    reviewer_id     TEXT NOT NULL REFERENCES merchants(id),
    approval_type   TEXT NOT NULL,
    ref_type        TEXT DEFAULT '',
    ref_id          TEXT DEFAULT '',
    data            TEXT DEFAULT '{}',
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    reviewed_at     TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- CORRECTIONS
CREATE TABLE IF NOT EXISTS corrections (
    id              TEXT PRIMARY KEY,
    deal_id         TEXT NOT NULL REFERENCES deals(id),
    requested_by    TEXT NOT NULL REFERENCES merchants(id),
    field           TEXT NOT NULL,
    old_value       TEXT,
    proposed_value  TEXT,
    reason          TEXT DEFAULT '',
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    created_at      TEXT DEFAULT (datetime('now'))
);

-- AUDIT LOG
CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT,
    action          TEXT NOT NULL,
    detail          TEXT DEFAULT '',
    ip_address      TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
    id              TEXT PRIMARY KEY,
    merchant_id     TEXT NOT NULL REFERENCES merchants(id),
    category        TEXT DEFAULT 'system',
    title           TEXT NOT NULL,
    body            TEXT DEFAULT '',
    relationship_id TEXT,
    read_at         TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ================================================================
-- INDEXES
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_merchants_user ON merchants(user_id);
CREATE INDEX IF NOT EXISTS idx_invites_from ON invites(from_merchant);
CREATE INDEX IF NOT EXISTS idx_invites_to ON invites(to_merchant);
CREATE INDEX IF NOT EXISTS idx_invites_status ON invites(status);
CREATE INDEX IF NOT EXISTS idx_rels_a ON relationships(merchant_a);
CREATE INDEX IF NOT EXISTS idx_rels_b ON relationships(merchant_b);
CREATE INDEX IF NOT EXISTS idx_batches_user ON batches(user_id);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_customer ON trades(customer_id);
CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(created_at);
CREATE INDEX IF NOT EXISTS idx_alloc_trade ON trade_allocations(trade_id);
CREATE INDEX IF NOT EXISTS idx_alloc_batch ON trade_allocations(batch_id);
CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_user ON suppliers(user_id);
CREATE INDEX IF NOT EXISTS idx_deals_rel ON deals(relationship_id);
CREATE INDEX IF NOT EXISTS idx_deals_creator ON deals(creator_id);
CREATE INDEX IF NOT EXISTS idx_deals_type ON deals(deal_type);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_due ON deals(due_date);
CREATE INDEX IF NOT EXISTS idx_journal_user ON journal(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_ref ON journal(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_settlements_rel ON settlements(relationship_id);
CREATE INDEX IF NOT EXISTS idx_messages_rel ON messages(relationship_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_approvals_reviewer ON approvals(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_corrections_deal ON corrections(deal_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notif_merchant ON notifications(merchant_id);
CREATE INDEX IF NOT EXISTS idx_pool_periods_deal ON pool_periods(deal_id);
