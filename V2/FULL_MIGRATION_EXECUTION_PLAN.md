# Tracker V2 Full Migration Plan & Execution Phases

## 1) Executive Summary

Based on the V2 audit and deployment notes, the migration objective is to move from a browser-centric architecture (multiple `localStorage` stores + partial Worker API) to a unified Cloudflare Worker + D1 system of record.

### Primary outcomes
- One source of truth in D1 for all financial, CRM, and merchant collaboration data.
- Server-side computation for FIFO and KPI logic.
- Zero business-critical dependency on browser `localStorage`.
- Controlled rollout with fallback and observability.

---

## 2) Current-State Findings (from V2 docs)

### Problem clusters
1. **Three disconnected data stores**
   - `state` (`usdt_pro_v15`) in localStorage.
   - `MS` (`mch_platform_v3`) in localStorage.
   - Legacy `state.merchants` model.
2. **Worker currently covers communication, not finance**
   - Profiles, invites, messaging exist.
   - Deals, settlements, journal, trading ledger still local-only.
3. **Critical computations run in browser**
   - FIFO (`recomputeFor`) and KPI functions (`kpiFor`, `_mchKpis`).

### Migration implications
- Back-end must implement write path before removing local state.
- Data migration must normalize two merchant schemas into one `deals` model.
- FIFO consistency must be guaranteed transactionally at API level.

---

## 3) Target Architecture

## 3.1 Principles
- **Server authoritative:** all create/update/delete flows go through Worker API.
- **Idempotent migration:** import can be retried safely.
- **Progressive deprecation:** localStorage shifts to cache-only, then removed.
- **Observability first:** audit and metrics in place before cutover.

## 3.2 Data domains and ownership
- **Trading domain:** `batches`, `trades`, `trade_allocations`.
- **CRM domain:** `customers`, `suppliers`.
- **Merchant domain:** `merchants`, `relationships`, `invites`, `messages`.
- **Deals & accounting domain:** `deals`, `settlements`, `journal`, `approvals`.
- **Control domain:** `users`, `sessions`, `audit_log`.

## 3.3 API target surface
Prioritize endpoints listed in V2 audit:
- Auth/session bootstrap.
- Trading CRUD + FIFO execution.
- Dashboard KPI endpoints.
- Deals lifecycle (create/repay/settle/cancel).
- Import/export and audit endpoints.

---

## 4) End-to-End Execution Phases

## Phase 0 — Program Setup (Day 0)
**Goal:** define migration controls and release protocol.

### Deliverables
- Branching strategy + release checklist.
- Data migration runbook.
- Rollback strategy (feature flags + snapshots).

### Tasks
- Define ownership by stream: API, data, frontend, QA, ops.
- Freeze non-critical feature work touching storage.
- Add environment matrix (local/staging/prod).

### Exit criteria
- Stakeholders approve scope and timeline.
- Rollback and success metrics documented.

---

## Phase 1 — Platform & Schema Foundation (Day 1)
**Goal:** create D1 + KV bindings and baseline schema.

### Deliverables
- D1 database provisioned and bound in Worker config.
- Initial schema deployed.
- Basic health endpoint and migration version table.

### Tasks
- Provision `taheito-pro-db` and KV namespace.
- Apply schema SQL from V2 design.
- Add migration metadata table (e.g., `schema_migrations`).
- Add indexes for trade/date/relationship lookups.

### Exit criteria
- `wrangler d1 execute ... --file=schema.sql` succeeds in staging.
- All tables queryable; indexes visible.

---

## Phase 2 — Auth & Security Baseline (Day 1-2)
**Goal:** ensure all write operations are user-scoped and auditable.

### Deliverables
- Auth middleware enforcing session/user identity.
- Standard API error contract.
- Audit log helper on mutation endpoints.

### Tasks
- Finalize `/api/auth/*` endpoints and session persistence.
- Implement request context (`user_id`, merchant profile binding).
- Add validation layer (schema validation for payloads).
- Add structured logging with request IDs.

### Exit criteria
- Unauthorized write attempts blocked.
- Mutation calls produce audit log records.

---

## Phase 3 — Import Bridge (Day 2)
**Goal:** migrate current browser data into D1 with deterministic mapping.

### Deliverables
- `POST /api/import/json` endpoint.
- Mapping specification (`state` + `MS` + legacy merchants → new schema).
- Idempotency strategy (upsert keys / import session IDs).

### Tasks
- Parse and validate payload snapshots.
- Transform local IDs and dates to canonical format.
- Map:
  - `state.batches` → `batches`
  - `state.trades` → `trades`
  - `state.customers`/`suppliers` → CRM tables
  - `MS.advances/purchases/profitShares/pools` → `deals`
  - `MS.journal`, `MS.settlements`, approvals/corrections
- Record import summary (inserted/updated/skipped/errors).

### Exit criteria
- Re-running same import does not duplicate data.
- Import report available for reconciliation.

---

## Phase 4 — Trading Domain APIs + FIFO (Day 3-4)
**Goal:** move inventory/trade logic server-side.

### Deliverables
- CRUD APIs for batches and trades.
- Server-side FIFO service wired to trade writes.
- Batch summary and stock/WACOP endpoint.

### Tasks
- Implement `POST/PUT/DELETE /api/batches`.
- Implement `POST/PUT/DELETE /api/trades`, `PUT /api/trades/:id/void`.
- On every trade mutation, recompute allocations for user scope.
- Persist allocations in `trade_allocations`.
- Return deterministic failure on insufficient stock.

### Exit criteria
- FIFO results stable across repeated reads.
- KPI and stock numbers match expected fixtures.

---

## Phase 5 — Deals, Settlements, Journal, Approvals (Day 4-5)
**Goal:** move merchant financial lifecycle off localStorage.

### Deliverables
- `deals` CRUD + repay/settle/cancel workflow.
- Settlement creation/update endpoints.
- Journal write-through for financial events.

### Tasks
- Implement deal-type-aware validation rules.
- Auto-journal entries on repayment/settlement.
- Implement `GET /api/deals/kpis` and relationship summaries.
- Implement approval queue endpoints.

### Exit criteria
- All four deal types supported end-to-end.
- Settlement totals reconcile with journal totals.

---

## Phase 6 — Dashboard/KPI Read Models (Day 5-6)
**Goal:** replace browser calculations with SQL-backed KPIs.

### Deliverables
- `/api/dashboard/kpis` and related summary endpoints.
- Merchant KPI endpoint replacing `_mchKpis`.

### Tasks
- Build time-range filters (`today`, `7d`, `30d`, `all`).
- Optimize aggregate queries and indexes.
- Add snapshot tests for KPI outputs.

### Exit criteria
- Dashboard loads with no client-side recompute dependencies.
- KPI variance vs legacy baseline within accepted tolerance.

---

## Phase 7 — Frontend Rewire (Day 6-8)
**Goal:** replace local writes with API operations.

### Deliverables
- API client integrated in frontend.
- Read/write flows migrated module-by-module.
- Feature flags for controlled cutover.

### Tasks
- Replace `save()/saveRecompute()` mutation paths with API calls.
- Keep temporary local cache read-only for fallback visualization.
- Migrate in slices:
  1. Trading screens
  2. CRM
  3. Merchant deals
  4. Messaging/invites alignment
- Add retry + toast error handling.

### Exit criteria
- No business mutation persists to localStorage.
- UI functional with API-only mode enabled.

---

## Phase 8 — Verification, Reconciliation, Cutover (Day 8-9)
**Goal:** validate parity and switch default to server data.

### Deliverables
- Reconciliation report (legacy vs D1 totals).
- UAT sign-off checklist.
- Production cutover plan.

### Tasks
- Run migration on staging with real anonymized snapshots.
- Compare totals: stock, P/L, deal principal, receivables, settlements.
- Fix mapping discrepancies and rerun import.
- Enable API-only flag in production.

### Exit criteria
- Reconciliation signed off.
- No critical P0/P1 defects open.

---

## Phase 9 — LocalStorage Decommission (Day 10)
**Goal:** remove obsolete storage logic safely.

### Deliverables
- Removed legacy storage calls and dead code paths.
- Data export endpoint retained for safety.
- Post-cutover monitoring dashboard.

### Tasks
- Remove remaining `localStorage` financial references.
- Keep only non-critical UI preferences if needed.
- Archive migration scripts and publish runbook.

### Exit criteria
- Local financial state no longer used anywhere.
- 7-day stability window completed.

---

## 5) Data Migration Mapping Plan (Detailed)

## 5.1 Identifier strategy
- Preserve original IDs where valid.
- Generate deterministic IDs when missing (prefix by entity + hash).
- Keep `legacy_id` in import metadata for traceability.

## 5.2 Temporal normalization
- Convert all timestamps to ISO UTC.
- If source lacks time, default to `00:00:00Z` and mark `import_inferred_time=1`.

## 5.3 Schema mappings
- **Advance/Purchase/ProfitShare/Pool** records map to `deals.deal_type`.
- Legacy merchant arrays map to either `deals` or `relationships` depending on semantics.
- Settlement bundles keep a JSON list of `deal_ids` with validation.

## 5.4 Reconciliation controls
- Pre-import totals snapshot from local payload.
- Post-import SQL aggregate snapshot.
- Variance report with tolerances and exception list.

---

## 6) Testing & Quality Gates

## 6.1 Automated checks by phase
- Unit tests: payload validation, mapper functions, FIFO allocator.
- Integration tests: endpoint workflows with seeded D1.
- Regression tests: KPI parity against known fixtures.

## 6.2 Non-functional tests
- Performance: dashboard and trade-write latency under load.
- Consistency: concurrent trade writes do not corrupt allocations.
- Resilience: partial import failure resumes safely.

## 6.3 Exit metrics
- Import success rate >= 99.5% rows.
- FIFO/KPI parity >= 99% vs accepted baseline.
- Error rate and p95 latency within SLO after cutover.

---

## 7) Risk Register & Mitigation

- **Risk:** Schema mismatch between `MS` and legacy merchants.
  - **Mitigation:** dual-pass mapper + manual exception queue.
- **Risk:** FIFO drift from legacy due to date ordering edge cases.
  - **Mitigation:** deterministic sorting and golden test fixtures.
- **Risk:** Frontend cutover introduces UX regressions.
  - **Mitigation:** feature flags + phased module rollout.
- **Risk:** Import duplicates.
  - **Mitigation:** idempotency keys and upsert strategy.

---

## 8) Suggested Timeline (10-Day Working Plan)

- **Day 0:** Program setup.
- **Day 1:** D1/KV/schema + auth baseline started.
- **Day 2:** Import bridge complete.
- **Day 3-4:** Trading APIs + FIFO.
- **Day 4-5:** Deals/settlements/journal/approvals.
- **Day 5-6:** KPI read models.
- **Day 6-8:** Frontend rewiring.
- **Day 8-9:** Staging reconciliation + production cutover.
- **Day 10:** LocalStorage decommission.

---

## 9) Definition of Done (Full Migration)

Migration is complete when:
1. All business-critical reads/writes run via Worker API.
2. D1 is the only source of truth for trading, deals, CRM, and settlements.
3. FIFO and KPI are server-computed and persisted/queried from D1.
4. localStorage no longer stores or drives financial state.
5. Reconciliation, UAT, and production monitoring are signed off.
