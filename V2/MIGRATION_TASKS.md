# V2 Migration Task Checklist (Source of Truth)

Mark tasks complete (`[x]`) as work finishes. Then run:

```bash
node V2/scripts/update-migration-progress.mjs
```

## Phase 0 — Program Setup
- [x] Publish full migration execution plan
- [x] Publish execution update format
- [x] Publish Phase 0 governance artifacts
- [x] Finalize named owner matrix
- [x] Approve release checklist
- [x] Approve rollback checklist
- [x] Confirm migration window + freeze dates

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
- [x] Remove timer-based exit path from verifier to prevent UV_HANDLE_CLOSING crash
- [x] Fix Windows explicit cmd invocation docs (`cmd /c .\verify-system.cmd`)
- [x] Add one-shot Phase 1 executor (deploy + migrate + verify)
- [x] Make one-shot executor fail-fast on sub-step errors
- [x] Detect HTML responses in verifier to flag wrong deployment target
- [x] Apply `001_schema_migrations.sql` in staging
- [x] Apply `001_schema_migrations.sql` in production
- [x] Validate `/api/system/health`
- [x] Validate `/api/system/migrations` includes `001`

## Phase 2 — Auth & Security Baseline
- [x] Enforce auth/session middleware on all write routes
- [x] Add payload validation layer for migration-sensitive endpoints
- [x] Add audit logging on mutation endpoints

## Phase 3 — Import Bridge
- [x] Implement `/api/import/json`
- [x] Add idempotency protection for repeated imports
- [x] Generate reconciliation report (pre/post totals)

## Phase 4 — Trading + FIFO
- [x] Implement server-side batches CRUD
- [x] Implement server-side trades CRUD with FIFO recompute
- [x] Persist allocations to `trade_allocations`

## Phase 5 — Deals + Settlement + Journal
- [x] Implement deals lifecycle endpoints
- [x] Implement settlement write/read endpoints
- [x] Implement journal write-through for financial events

## Phase 6 — KPI Read Models
- [x] Implement `/api/dashboard/kpis`
- [x] Implement `/api/deals/kpis`
- [x] Validate KPI parity against baseline

## Phase 7 — Frontend Rewire
- [x] Replace critical localStorage mutation paths with API calls
- [x] Enable API-only mode behind feature flag

## Phase 8 — Cutover & Reconciliation
- [x] Complete staging reconciliation sign-off
- [x] Execute production cutover

## Phase 9 — LocalStorage Decommission
- [x] Remove remaining financial localStorage writes
- [x] Close 7-day post-cutover stability window
