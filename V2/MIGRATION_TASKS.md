# V2 Migration Task Checklist (Source of Truth)

Mark tasks complete (`[x]`) as work finishes. Then run:

```bash
node V2/scripts/update-migration-progress.mjs
```

## Phase 0 — Program Setup
- [x] Publish full migration execution plan
- [x] Publish execution update format
- [x] Publish Phase 0 governance artifacts
- [ ] Finalize named owner matrix
- [ ] Approve release checklist
- [ ] Approve rollback checklist
- [ ] Confirm migration window + freeze dates

## Phase 1 — Platform & Schema Foundation
- [x] Add `001_schema_migrations.sql` migration file
- [x] Implement `/api/system/health` route
- [x] Implement `/api/system/migrations` route
- [x] Implement `/api/system/version` route
- [x] Publish migration runbook and verifier scripts
- [x] Add script wrappers/banners for reliable field verification
- [x] Add backend-root launcher scripts for field verification
- [x] Add .bat fallback launcher for PowerShell/CMD edge cases
- [x] Harden verifier to avoid Windows Node assertion crash
- [x] Fix Windows explicit cmd invocation docs (`cmd /c .\verify-system.cmd`)
- [ ] Apply `001_schema_migrations.sql` in staging
- [ ] Apply `001_schema_migrations.sql` in production
- [ ] Validate `/api/system/health`
- [ ] Validate `/api/system/migrations` includes `001`

## Phase 2 — Auth & Security Baseline
- [ ] Enforce auth/session middleware on all write routes
- [ ] Add payload validation layer for migration-sensitive endpoints
- [ ] Add audit logging on mutation endpoints

## Phase 3 — Import Bridge
- [ ] Implement `/api/import/json`
- [ ] Add idempotency protection for repeated imports
- [ ] Generate reconciliation report (pre/post totals)

## Phase 4 — Trading + FIFO
- [ ] Implement server-side batches CRUD
- [ ] Implement server-side trades CRUD with FIFO recompute
- [ ] Persist allocations to `trade_allocations`

## Phase 5 — Deals + Settlement + Journal
- [ ] Implement deals lifecycle endpoints
- [ ] Implement settlement write/read endpoints
- [ ] Implement journal write-through for financial events

## Phase 6 — KPI Read Models
- [ ] Implement `/api/dashboard/kpis`
- [ ] Implement `/api/deals/kpis`
- [ ] Validate KPI parity against baseline

## Phase 7 — Frontend Rewire
- [ ] Replace critical localStorage mutation paths with API calls
- [ ] Enable API-only mode behind feature flag

## Phase 8 — Cutover & Reconciliation
- [ ] Complete staging reconciliation sign-off
- [ ] Execute production cutover

## Phase 9 — LocalStorage Decommission
- [ ] Remove remaining financial localStorage writes
- [ ] Close 7-day post-cutover stability window
