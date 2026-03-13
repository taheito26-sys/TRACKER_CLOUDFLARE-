# Taheito Pro X — Full Code Audit & Server-Side Architecture

## What I Found in Your 14,226-Line index.html

After reviewing all 518 functions, here's the real picture.

---

## Current Architecture (The Problem)

Your app has **three separate data worlds** that don't talk to each other:

### Data World 1: Core Trading State (`localStorage` key: `usdt_pro_v15`)
This is the `state` object — your batches, trades, customers, suppliers, settings, FIFO engine. It lives entirely in `localStorage`. The `save()` function on line 2809 is simply:
```
localStorage.setItem(SK, JSON.stringify(state))
```
Every operation calls `saveRecompute()` which runs `save() → recompute() → render()`. The FIFO engine (`recomputeFor`) runs client-side on every state change.

**Risk:** If a user clears browser data, everything is gone. No multi-device access. No sharing between users.

### Data World 2: Legacy Merchant Module (`localStorage` key: `mch_platform_v3`)
The merchant platform starting at line ~10930 maintains its own separate `MS` object with:
- `MS.profile`, `MS.invites`, `MS.relationships`, `MS.messages`
- `MS.advances`, `MS.purchases`, `MS.profitShares`, `MS.pools`
- `MS.journal`, `MS.settlements`, `MS.corrections`, `MS.approvals`

This has its own `mSave()`/`mLoad()` cycle. It ALSO talks to your Cloudflare Worker at `https://p2p-merchant-api.taheito26.workers.dev` for profile search, invites, and messaging — but **only for discovery and chat**. All financial data stays in localStorage.

**Risk:** The merchant API only handles profiles, invites, and messages. The 4 deal types (advances, purchases, profit-shares, pools), the journal entries, settlements, and all KPI calculations happen client-side and are stored in localStorage.

### Data World 3: Legacy Merchants Array (`state.merchants`)
The older merchant module (line ~5549, `_renderMerchants_legacy_v1`) stores merchants inside the main `state` object with inline lending, arbitrage, partnership, and capital placement arrays. This is the code that builds modals like `addLendingModal()`, `addArbitrageModal()`, etc.

**Risk:** This data overlaps with Data World 2 but uses a completely different schema. Some render paths reference one, some reference the other.

### The Disconnect
Your Cloudflare Worker (`p2p-merchant-api`) only has these API endpoints:
```
POST /api/profiles          → publish profile
GET  /api/profiles/search   → search merchants
POST /api/invites           → send invite
POST /api/invites/:id/accept
POST /api/invites/:id/reject
POST /api/invites/:id/withdraw
POST /api/messages          → send message
GET  /api/poll/:mid         → poll for new invites/messages
```

That's a **communication layer**. There are no endpoints for:
- Creating/updating advances, purchases, profit-shares, or pools
- Recording repayments or settlements
- Computing dashboard KPIs
- Managing the trading ledger (batches/trades)
- Journal entries or audit logs

Everything financial is computed by the `_mchKpis()` function (line ~11259) reading from `MS.advances`, `MS.purchases`, `MS.profitShares`, `MS.pools` — all localStorage.

---

## What Needs to Move Server-Side

### Tier 1: Financial Data (Critical — data loss = business loss)
| What | Currently | Lines | Move To |
|------|-----------|-------|---------|
| Batches (USDT inventory) | `state.batches` in localStorage | ~3117 | D1 `batches` table |
| Trades (FIFO sales) | `state.trades` + `recomputeFor()` | ~2828-2860 | D1 `trades` table + server-side FIFO |
| Advances | `MS.advances` in localStorage | ~12132 | D1 `deals` table (type='advance') |
| Purchases/Sales | `MS.purchases` in localStorage | ~12190 | D1 `deals` table (type='purchase') |
| Profit-Shares | `MS.profitShares` in localStorage | ~12250 | D1 `deals` table (type='profit_share') |
| Pools | `MS.pools` in localStorage | ~12300 | D1 `deals` table (type='pool') |
| Journal entries | `MS.journal` in localStorage | ~11216 | D1 `journal` table |
| Settlements | `MS.settlements` in localStorage | — | D1 `settlements` table |
| Customers | `state.customers` in localStorage | ~2430 | D1 `customers` table |
| Suppliers | `state.suppliers` in localStorage | ~2441 | D1 `suppliers` table |

### Tier 2: Communication (Already partially server-side)
| What | Currently | Move To |
|------|-----------|---------|
| Merchant profiles | Worker + localStorage cache | Worker + D1 (already there) |
| Invites | Worker + localStorage cache | Worker + D1 (already there) |
| Messages | Worker + localStorage cache | Worker + D1 (already there) |
| Approvals | localStorage only | D1 `approvals` table |

### Tier 3: Computation (Must not run in browser)
| What | Currently | Move To |
|------|-----------|---------|
| FIFO engine | `recomputeFor()` client-side | Server endpoint: `GET /api/trades/fifo` |
| KPI calculations | `kpiFor()`, `_mchKpis()` client-side | Server endpoint: `GET /api/dashboard/kpis` |
| WACOP | `getWACOP()` client-side | Computed server-side in batch queries |
| Stock metrics | `totalStock()`, `stockCostQAR()` | Server endpoint in batch summary |
| Deal KPIs | `_mchKpis()` line ~11259 | Server endpoint: `GET /api/merchants/:id/summary` |

---

## Target: Unified D1 Schema

One database. One source of truth. No localStorage for business data.

```sql
-- ================================================================
-- AUTHENTICATION
-- ================================================================
CREATE TABLE users (
    id              TEXT PRIMARY KEY,
    email           TEXT UNIQUE,
    display_name    TEXT,
    google_id       TEXT UNIQUE,
    role            TEXT DEFAULT 'owner',
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
    token           TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    expires_at      TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ================================================================
-- MERCHANT PROFILES (exists in your worker, formalize it)
-- ================================================================
CREATE TABLE merchants (
    id              TEXT PRIMARY KEY,
    user_id         TEXT REFERENCES users(id),
    display_name    TEXT NOT NULL,
    nickname        TEXT,
    merchant_type   TEXT DEFAULT 'general',
    phone           TEXT,
    email           TEXT,
    region          TEXT DEFAULT '',
    bio             TEXT DEFAULT '',
    risk_level      TEXT DEFAULT 'low',
    discoverability TEXT DEFAULT 'public',
    status          TEXT DEFAULT 'active',
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- ================================================================
-- RELATIONSHIPS & INVITES (exists in your worker)
-- ================================================================
CREATE TABLE invites (
    id              TEXT PRIMARY KEY,
    from_merchant   TEXT NOT NULL REFERENCES merchants(id),
    to_merchant     TEXT,
    to_identifier   TEXT,
    purpose         TEXT DEFAULT '',
    message         TEXT DEFAULT '',
    status          TEXT DEFAULT 'pending',
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    expires_at      TEXT
);

CREATE TABLE relationships (
    id              TEXT PRIMARY KEY,
    merchant_a      TEXT NOT NULL REFERENCES merchants(id),
    merchant_b      TEXT NOT NULL REFERENCES merchants(id),
    status          TEXT DEFAULT 'active',
    credit_limit    REAL DEFAULT 0,
    terms           TEXT DEFAULT '{}',
    created_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(merchant_a, merchant_b)
);

-- ================================================================
-- TRADING: BATCHES & TRADES (currently state.batches/state.trades)
-- ================================================================
CREATE TABLE batches (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    supplier_id     TEXT REFERENCES suppliers(id),
    source          TEXT DEFAULT '',
    initial_usdt    REAL NOT NULL,
    buy_price_qar   REAL NOT NULL,
    fee_qar         REAL DEFAULT 0,
    notes           TEXT DEFAULT '',
    status          TEXT DEFAULT 'open',
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE trades (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    customer_id     TEXT REFERENCES customers(id),
    amount_usdt     REAL NOT NULL,
    sell_price_qar  REAL NOT NULL,
    fee_qar         REAL DEFAULT 0,
    uses_stock      INTEGER DEFAULT 1,
    voided          INTEGER DEFAULT 0,
    notes           TEXT DEFAULT '',
    created_at      TEXT DEFAULT (datetime('now'))
);

-- FIFO allocations (computed server-side, stored for performance)
CREATE TABLE trade_allocations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id        TEXT NOT NULL REFERENCES trades(id),
    batch_id        TEXT NOT NULL REFERENCES batches(id),
    qty_usdt        REAL NOT NULL,
    cost_qar        REAL NOT NULL
);

-- ================================================================
-- CRM: CUSTOMERS & SUPPLIERS (currently state.customers/suppliers)
-- ================================================================
CREATE TABLE customers (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    name            TEXT NOT NULL,
    phone           TEXT DEFAULT '',
    tier            TEXT DEFAULT 'C',
    location        TEXT DEFAULT '',
    daily_limit     REAL DEFAULT 0,
    notes           TEXT DEFAULT '',
    status          TEXT DEFAULT 'active',
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE suppliers (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    name            TEXT NOT NULL,
    phone           TEXT DEFAULT '',
    typical_price   REAL DEFAULT 0,
    location        TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    status          TEXT DEFAULT 'active',
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ================================================================
-- MERCHANT DEALS: 4 TYPES (currently MS.advances/purchases/etc.)
-- ================================================================
CREATE TABLE deals (
    id              TEXT PRIMARY KEY,
    relationship_id TEXT NOT NULL REFERENCES relationships(id),
    creator_id      TEXT NOT NULL REFERENCES merchants(id),
    deal_type       TEXT NOT NULL CHECK(deal_type IN (
                        'advance',       -- principal-only return
                        'purchase',      -- sale of USDT
                        'profit_share',  -- capital + agreed profit split
                        'pool'           -- managed monthly capital pool
                    )),
    deal_ref        TEXT,               -- e.g. ADV-XXXXXX, SALE-XXXXXX

    -- Common fields
    currency        TEXT DEFAULT 'USDT',
    principal       REAL DEFAULT 0,
    usdt_qty        REAL DEFAULT 0,
    rate_qar        REAL DEFAULT 0,
    service_fee     REAL DEFAULT 0,
    sent_date       TEXT,
    due_date        TEXT,
    status          TEXT DEFAULT 'sent',
    notes           TEXT DEFAULT '',

    -- Purchase-specific
    sale_rate       REAL DEFAULT 0,
    cost_basis      REAL DEFAULT 0,
    sale_margin     REAL DEFAULT 0,
    payment_method  TEXT DEFAULT '',

    -- Profit-share specific
    owner_ratio     REAL DEFAULT 0,
    operator_ratio  REAL DEFAULT 0,
    loss_policy     TEXT DEFAULT '',
    principal_guarantee INTEGER DEFAULT 0,

    -- Pool-specific
    initial_capital REAL DEFAULT 0,
    monthly_target  REAL DEFAULT 0,
    top_ups         REAL DEFAULT 0,
    withdrawals     REAL DEFAULT 0,

    -- Settlement tracking
    returned_amount REAL DEFAULT 0,
    paid_amount     REAL DEFAULT 0,
    approved_offsets REAL DEFAULT 0,

    settled_at      TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- ================================================================
-- DOUBLE-ENTRY JOURNAL (currently MS.journal in localStorage)
-- ================================================================
CREATE TABLE journal (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    dr_account      TEXT NOT NULL,
    cr_account      TEXT NOT NULL,
    amount          REAL NOT NULL,
    currency        TEXT DEFAULT 'USDT',
    ref_type        TEXT DEFAULT '',
    ref_id          TEXT DEFAULT '',
    memo            TEXT DEFAULT '',
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ================================================================
-- SETTLEMENTS
-- ================================================================
CREATE TABLE settlements (
    id              TEXT PRIMARY KEY,
    relationship_id TEXT NOT NULL REFERENCES relationships(id),
    deal_ids        TEXT NOT NULL,       -- JSON array of deal IDs included
    gross_amount    REAL NOT NULL,
    fees            REAL DEFAULT 0,
    net_amount      REAL NOT NULL,
    currency        TEXT DEFAULT 'USDT',
    method          TEXT DEFAULT '',
    status          TEXT DEFAULT 'draft',
    settled_at      TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ================================================================
-- MESSAGES (already in worker, formalize schema)
-- ================================================================
CREATE TABLE messages (
    id              TEXT PRIMARY KEY,
    relationship_id TEXT NOT NULL REFERENCES relationships(id),
    sender_id       TEXT NOT NULL REFERENCES merchants(id),
    body            TEXT NOT NULL,
    msg_type        TEXT DEFAULT 'text',
    ref_deal_id     TEXT,
    read_at         TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ================================================================
-- APPROVALS & CORRECTIONS
-- ================================================================
CREATE TABLE approvals (
    id              TEXT PRIMARY KEY,
    submitted_by    TEXT NOT NULL REFERENCES merchants(id),
    reviewer_id     TEXT NOT NULL REFERENCES merchants(id),
    approval_type   TEXT NOT NULL,
    ref_type        TEXT,
    ref_id          TEXT,
    data            TEXT DEFAULT '{}',
    status          TEXT DEFAULT 'pending',
    reviewed_at     TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ================================================================
-- AUDIT LOG
-- ================================================================
CREATE TABLE audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT,
    action          TEXT NOT NULL,
    detail          TEXT DEFAULT '',
    ip_address      TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ================================================================
-- INDEXES
-- ================================================================
CREATE INDEX idx_batches_user ON batches(user_id);
CREATE INDEX idx_trades_user ON trades(user_id);
CREATE INDEX idx_trades_customer ON trades(customer_id);
CREATE INDEX idx_allocations_trade ON trade_allocations(trade_id);
CREATE INDEX idx_allocations_batch ON trade_allocations(batch_id);
CREATE INDEX idx_deals_relationship ON deals(relationship_id);
CREATE INDEX idx_deals_creator ON deals(creator_id);
CREATE INDEX idx_deals_type ON deals(deal_type);
CREATE INDEX idx_deals_status ON deals(status);
CREATE INDEX idx_journal_user ON journal(user_id);
CREATE INDEX idx_journal_ref ON journal(ref_type, ref_id);
CREATE INDEX idx_messages_rel ON messages(relationship_id);
CREATE INDEX idx_approvals_reviewer ON approvals(reviewer_id);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_customers_user ON customers(user_id);
CREATE INDEX idx_suppliers_user ON suppliers(user_id);
```

---

## Unified API Worker — Complete Route Map

One Worker. Every route requires auth (except login + P2P rates).

```
── AUTH ──────────────────────────────────────────────────────
POST   /api/auth/google          Google OAuth token exchange
POST   /api/auth/logout          Invalidate session
GET    /api/auth/me              Current user + merchant profile

── TRADING (currently state.batches + state.trades) ─────────
GET    /api/batches              List batches (with remaining USDT computed)
POST   /api/batches              Create batch
PUT    /api/batches/:id          Edit batch
DELETE /api/batches/:id          Delete batch
GET    /api/batches/summary      Total stock, WACOP, cost

GET    /api/trades               List trades (with FIFO allocation)
POST   /api/trades               Create trade → server runs FIFO
PUT    /api/trades/:id           Edit trade → server re-runs FIFO
PUT    /api/trades/:id/void      Toggle void
DELETE /api/trades/:id           Delete trade

GET    /api/dashboard/kpis       Revenue, net, qty, fee, margin (by range)
GET    /api/dashboard/calendar   Trade counts by day for calendar view

── CRM ──────────────────────────────────────────────────────
GET    /api/customers            List with metrics
POST   /api/customers            Create
PUT    /api/customers/:id        Update
DELETE /api/customers/:id        Delete

GET    /api/suppliers            List with metrics
POST   /api/suppliers            Create
PUT    /api/suppliers/:id        Update
DELETE /api/suppliers/:id        Delete

── MERCHANTS (expand existing worker) ───────────────────────
GET    /api/merchants/me         Own profile
POST   /api/merchants            Create/update profile
GET    /api/merchants/search     Search directory

GET    /api/invites              List sent + received
POST   /api/invites              Send invite
PUT    /api/invites/:id/accept
PUT    /api/invites/:id/reject
PUT    /api/invites/:id/withdraw

GET    /api/relationships        List relationships
GET    /api/relationships/:id    Relationship detail + ledger

── DEALS (the 4 deal types — currently all localStorage) ────
GET    /api/deals                List all deals (filterable by type, status)
POST   /api/deals                Create deal (advance/purchase/profit_share/pool)
GET    /api/deals/:id            Deal detail
PUT    /api/deals/:id            Update deal
PUT    /api/deals/:id/repay      Record repayment → creates journal entry
PUT    /api/deals/:id/settle     Settle deal → creates settlement record
PUT    /api/deals/:id/cancel     Cancel deal

GET    /api/deals/kpis           Merchant KPIs (principal out, receivable, etc.)

── SETTLEMENTS ──────────────────────────────────────────────
GET    /api/settlements          List settlements
POST   /api/settlements          Create settlement (bundles multiple deals)
PUT    /api/settlements/:id      Update status

── JOURNAL ──────────────────────────────────────────────────
GET    /api/journal              Ledger entries (paginated)
GET    /api/journal/balances     Account balances (trial balance)

── MESSAGES ─────────────────────────────────────────────────
GET    /api/messages/:rel_id     Messages for a relationship
POST   /api/messages             Send message

── APPROVALS ────────────────────────────────────────────────
GET    /api/approvals            Pending approvals
POST   /api/approvals            Submit approval request
PUT    /api/approvals/:id/approve
PUT    /api/approvals/:id/reject

── SYSTEM ───────────────────────────────────────────────────
GET    /api/p2p/rates            Cached Binance P2P data
GET    /api/export/json          Full data export
POST   /api/import/json          Full data import (migration)
GET    /api/audit                Audit log (paginated)
```

---

## Server-Side FIFO Engine

This is the most critical computation to move. Currently `recomputeFor()` (line ~2828) runs in the browser on every render. On the server:

```javascript
// services/fifo.js — runs on Cloudflare Worker
export async function computeFIFO(db, userId) {
    // 1. Get all non-voided trades sorted by date
    const trades = await db.prepare(`
        SELECT * FROM trades
        WHERE user_id = ? AND voided = 0
        ORDER BY created_at ASC
    `).bind(userId).all();

    // 2. Get all batches sorted by date
    const batches = await db.prepare(`
        SELECT *, initial_usdt AS remaining FROM batches
        WHERE user_id = ?
        ORDER BY created_at ASC
    `).bind(userId).all();

    // 3. Clear old allocations
    await db.prepare(
        'DELETE FROM trade_allocations WHERE trade_id IN (SELECT id FROM trades WHERE user_id = ?)'
    ).bind(userId).run();

    // 4. Run FIFO allocation
    const batchRemaining = new Map();
    batches.results.forEach(b => batchRemaining.set(b.id, b.initial_usdt));

    const insertions = [];
    const tradeResults = new Map();

    for (const trade of trades.results) {
        if (!trade.uses_stock) {
            const rev = trade.amount_usdt * trade.sell_price_qar;
            tradeResults.set(trade.id, {
                ok: true, revenue: rev, cost: 0,
                net: rev - trade.fee_qar, margin: 0
            });
            continue;
        }

        let need = trade.amount_usdt;
        let cost = 0;
        const slices = [];

        for (const batch of batches.results) {
            if (need <= 0) break;
            const remaining = batchRemaining.get(batch.id) || 0;
            if (remaining <= 0 || batch.created_at > trade.created_at) continue;

            const take = Math.min(remaining, need);
            batchRemaining.set(batch.id, remaining - take);
            need -= take;
            cost += take * batch.buy_price_qar;
            slices.push({ batch_id: batch.id, qty: take, cost: take * batch.buy_price_qar });
        }

        if (need > 0.001) {
            // Insufficient stock — rollback slices
            slices.forEach(s => {
                batchRemaining.set(s.batch_id,
                    (batchRemaining.get(s.batch_id) || 0) + s.qty);
            });
            tradeResults.set(trade.id, { ok: false, reason: 'Insufficient stock' });
        } else {
            const rev = trade.amount_usdt * trade.sell_price_qar;
            const net = rev - cost - trade.fee_qar;
            tradeResults.set(trade.id, {
                ok: true, revenue: rev, cost, net,
                margin: cost > 0 ? (net / cost) * 100 : 0
            });
            slices.forEach(s => insertions.push(
                db.prepare(
                    'INSERT INTO trade_allocations (trade_id, batch_id, qty_usdt, cost_qar) VALUES (?,?,?,?)'
                ).bind(trade.id, s.batch_id, s.qty, s.cost)
            ));
        }
    }

    // 5. Batch insert all allocations
    if (insertions.length) await db.batch(insertions);

    return { batches: batchRemaining, trades: tradeResults };
}
```

---

## Server-Side Dashboard KPIs

Currently `kpiFor()` and `_mchKpis()` run client-side. On the server:

```javascript
// routes/dashboard.js
export async function getDashboardKPIs(db, userId, range) {
    const rangeFilter = range === 'all' ? ''
        : range === 'today' ? `AND created_at >= date('now', 'start of day')`
        : range === '7d' ? `AND created_at >= date('now', '-7 days')`
        : `AND created_at >= date('now', '-30 days')`;

    // Trading KPIs
    const tradingKPIs = await db.prepare(`
        SELECT
            COUNT(*) as trade_count,
            COALESCE(SUM(amount_usdt), 0) as total_qty,
            COALESCE(SUM(amount_usdt * sell_price_qar), 0) as revenue,
            COALESCE(SUM(fee_qar), 0) as total_fees
        FROM trades
        WHERE user_id = ? AND voided = 0 ${rangeFilter}
    `).bind(userId).first();

    // Net profit from FIFO allocations
    const netProfit = await db.prepare(`
        SELECT COALESCE(SUM(
            t.amount_usdt * t.sell_price_qar - ta.total_cost - t.fee_qar
        ), 0) as net
        FROM trades t
        LEFT JOIN (
            SELECT trade_id, SUM(cost_qar) as total_cost
            FROM trade_allocations GROUP BY trade_id
        ) ta ON ta.trade_id = t.id
        WHERE t.user_id = ? AND t.voided = 0 AND t.uses_stock = 1 ${rangeFilter}
    `).bind(userId).first();

    // Stock metrics
    const stock = await db.prepare(`
        SELECT
            COALESCE(SUM(b.initial_usdt - COALESCE(a.allocated, 0)), 0) as remaining_usdt,
            COALESCE(SUM(
                (b.initial_usdt - COALESCE(a.allocated, 0)) * b.buy_price_qar
            ), 0) as stock_cost
        FROM batches b
        LEFT JOIN (
            SELECT batch_id, SUM(qty_usdt) as allocated
            FROM trade_allocations GROUP BY batch_id
        ) a ON a.batch_id = b.id
        WHERE b.user_id = ?
    `).bind(userId).first();

    const wacop = stock.remaining_usdt > 0
        ? stock.stock_cost / stock.remaining_usdt
        : null;

    return {
        trade_count: tradingKPIs.trade_count,
        total_qty: tradingKPIs.total_qty,
        revenue: tradingKPIs.revenue,
        total_fees: tradingKPIs.total_fees,
        net_profit: netProfit.net,
        remaining_usdt: stock.remaining_usdt,
        stock_cost: stock.stock_cost,
        wacop
    };
}
```

---

## Migration Strategy

### Phase 1: Add D1 to your existing Worker (Day 1)
```bash
wrangler d1 create taheito-pro-db
wrangler d1 execute taheito-pro-db --file=schema.sql
```
Update `wrangler.toml` to bind D1 alongside your existing KV.

### Phase 2: Build the /api/import endpoint (Day 1)
This endpoint accepts the current localStorage JSON and inserts it into D1. This is your data migration bridge:
```
POST /api/import/json
Body: { state: {...}, merchantState: {...} }
```
The server parses both `state` (batches, trades, customers, suppliers) and `MS` (advances, purchases, etc.) and inserts rows into the correct D1 tables.

### Phase 3: Build core read APIs (Days 2-3)
Start with the endpoints the dashboard needs:
- `GET /api/dashboard/kpis` (replaces client-side `kpiFor()`)
- `GET /api/batches/summary` (replaces `totalStock()`, `getWACOP()`)
- `GET /api/deals/kpis` (replaces `_mchKpis()`)

### Phase 4: Build write APIs (Days 3-5)
- `POST /api/batches` + `POST /api/trades` (with server-side FIFO)
- `POST /api/deals` (all 4 types)
- `PUT /api/deals/:id/repay` and `/settle`

### Phase 5: Rewire frontend (Days 5-7)
Replace each `save() + localStorage` pattern with an API call:
```javascript
// BEFORE
state.batches.push(newBatch);
saveRecompute("Batch added", "good");

// AFTER
const batch = await api.post('/batches', newBatch);
if (batch) { renderStock(); toast("Batch added", "good"); }
```

### Phase 6: Remove localStorage (Day 8)
Once all read/write goes through the API, remove all 70 `localStorage` references. The only thing that stays client-side is the auth token (in a cookie or memory variable).

---

## What This Eliminates

| Problem | Root Cause in Code | Fix |
|---------|-------------------|-----|
| Dashboard zeros | `_mchKpis()` reads from empty `MS` arrays in localStorage | KPIs computed via SQL from D1 `deals`/`transactions` tables |
| Data loss on cache clear | `save()` writes to localStorage only | All data in D1, browser holds nothing |
| No multi-device | localStorage is per-browser | D1 is shared, auth-gated |
| FIFO breaks silently | `recomputeFor()` re-runs on every render with no persistence | FIFO results stored in `trade_allocations` table |
| renderMerchants crash kills page | Missing function → JS error → blank page | API errors don't crash the renderer; each section fetches independently |
| 3 conflicting data stores | `state.merchants` vs `MS.*` vs Worker | One D1 database, one schema |
| Encoding corruption (mojibake) | File encoding mismatch in HTML | Server returns JSON with `Content-Type: application/json; charset=utf-8` |
| 14,226-line single file | Everything in one index.html | Frontend becomes ~2000 lines of rendering + API calls; logic lives in Worker |
