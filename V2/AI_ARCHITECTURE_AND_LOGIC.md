# TRACKER_CLOUDFLARE Architecture & Logic Guide (for AI agents)

> Purpose: give any incoming AI enough context to safely reason about this repo without re-reading the whole codebase.

## 1) System architecture at a glance

```text
Frontend (browser app)
  -> calls Worker HTTP API (/api/*)
Cloudflare Worker (backend/src/index.js)
  -> D1 (binding: DB) for canonical state
  -> Binance public API (for /api/p2p market fetch)
  -> Cloudflare Access headers for write-route protection (when enabled)
Ops/Runbooks/Scripts
  -> backend/run-phase*-*.mjs + .ps1/.cmd wrappers
  -> backend/scripts/verify-system-endpoints.*
  -> backend/migrations/*.sql + README runbook
```

Primary runtime entrypoint is `backend/src/index.js` (single Worker handler). The Worker exposes:
- legacy/system endpoints (`/api/status`, `/api/system/*`, `/api/p2p`, `/api/history`)
- merchant domain endpoints under `/api/merchant/*`
- import bridge endpoint under `/api/import/*`

## 2) Request lifecycle (important mental model)

1. **CORS + OPTIONS handling** happens at the Worker boundary.
2. **Path dispatch** routes to one of:
   - system handlers
   - merchant handlers
   - import handlers
3. **Write-guard gate** runs for mutating methods (`POST/PUT/PATCH/DELETE`) when `AUTH_SOURCE=cloudflare-access`.
4. **Auth context resolution** for merchant/import routes:
   - JWT bearer (Clerk JWKS verification), or
   - compatibility headers (`X-User-Id`, `X-Compat-User`, `X-User-Email`).
5. **D1 reads/writes** via helper wrappers (`d1First`, `d1All`, `d1Run`).
6. **Structured error/json responses** emitted with consistent CORS headers.
7. **Mutation audit logs** emitted as JSON lines (`type: "mutation_audit"`) for security evidence.

## 3) Security and auth logic

### 3.1 Two auth layers

- **Layer A: Edge write-route guard** (`resolveWriteAuth`)
  - Controlled by `AUTH_SOURCE`.
  - If set to `cloudflare-access`, mutating API requests require one of Cloudflare Access identity headers.
  - Missing headers => fail-closed `401`.

- **Layer B: App user context** (`getUserContext`)
  - Accepts JWT bearer tokens (verified via RS256 + JWKS), or compatibility headers for transition period.
  - Produces normalized `userId/email/mode` used by domain handlers.

### 3.2 Why this matters

This design separates **network perimeter identity** (Cloudflare Access) from **application user identity** (JWT/compat), which allows controlled migration without immediately breaking old clients.

## 4) Worker modules / logic blocks

## 4.1 Utility + crypto/auth helpers
- JWT parsing, base64url decode, RS256 verify, JWKS cache.
- Common response helpers (`json`, `bad`), payload validators, timestamp/id helpers.

## 4.2 System endpoint block (`/api/system/*`)
- `/api/system/health`: runtime + binding health.
- `/api/system/migrations`: migration rows from `schema_migrations`.
- `/api/system/version`: endpoint/version metadata to detect stale deployment.

These are used by verifier scripts and phase runbooks.

## 4.3 Merchant domain block (`/api/merchant/*`)
Contains operational business logic for:
- merchant profiles and search
- invite/relationship lifecycle
- roles/permissions style checks around relationship access
- messages/deals/approvals/notifications/audit entities

Patterns used repeatedly:
- load caller profile/context
- validate request body fields
- enforce relationship ownership/access checks
- write business records + audit artifacts
- return typed JSON payloads

## 4.4 Import bridge block (`/api/import/*`)
Supports idempotent JSON imports from legacy/local snapshots.
Core properties:
- payload hash and idempotency key handling
- persisted import job row (`import_jobs`)
- replay-safe behavior for repeated keys
- import totals/status returned for tracking

## 5) Data architecture (D1)

Migration SQL files define and evolve schema:
- `001_schema_migrations.sql`: migration registry table bootstrap.
- `002_trading_fifo.sql`: trading/FIFO-related schema.

Runtime also has defensive `CREATE TABLE IF NOT EXISTS` helpers for critical metadata tables (`schema_migrations`, import jobs, etc.) where needed.

## 6) Operational architecture (how this is run safely)

## 6.1 One-shot and safe-check runners
- `run-phase1-oneshot.*`: deploy + migration + verify bootstrap flow.
- `run-phase2-safe-check.*`: deploy/verify + unauth write probe (expects deny).
- `run-phase3-safe-check.*`: extended checks for phase-3 conditions.

Cross-platform wrappers exist in `.mjs`, `.ps1`, `.cmd` to keep operator workflows consistent on Windows/Node shells.

## 6.2 Endpoint verifier

`backend/scripts/verify-system-endpoints.mjs` is the canonical smoke verifier:
- checks `/api/system/health`, `/api/system/migrations`, `/api/system/version`
- has fallback diagnostics via `/api/status` to detect stale deployments
- prints operator-focused remediation steps

## 6.3 Security evidence model

Phase-2 safe checks intentionally probe unauthorized mutation route(s) and expect `401` while collecting `mutation_audit` log lines from `wrangler tail` as evidence of fail-closed write protection.

## 7) Environment/config contracts

Common env/bindings expected by Worker:
- `DB` (D1 binding)
- `ALLOWED_ORIGINS`
- `AUTH_SOURCE` (`cloudflare-access` to enforce edge write guard)
- `CLERK_JWKS_URL` (when Bearer JWT verification is used)

`backend/wrangler.toml` currently sets `AUTH_SOURCE = "cloudflare-access"` in config.

## 8) Migration docs map (V2 folder)

The `V2/` directory is the process-control layer (not runtime code):
- full execution plan, phase setup docs, security baseline
- live task/progress/status tracking docs
- update format contract for reporting
- script to recompute progress/status

Use these files to understand *program state* and handoff expectations, not low-level runtime behavior.

## 9) How another AI should work in this repo

1. Start with this file + `backend/src/index.js` + `backend/migrations/README.md`.
2. Before changing auth/write behavior, check both:
   - Worker guard logic (`resolveWriteAuth` / `auditWrite`)
   - Phase safe-check scripts and runbook expectations.
3. Keep verifier scripts aligned with endpoint contracts.
4. Maintain cross-platform parity when changing `.mjs` runner args (also patch `.ps1`/`.cmd` wrappers).
5. Prefer additive, phase-safe changes and preserve operator diagnostics.

## 10) Fast orientation checklist

- Runtime entrypoint: `backend/src/index.js`
- System verification script: `backend/scripts/verify-system-endpoints.mjs`
- Safe-check runner: `backend/run-phase2-safe-check.mjs`
- D1 runbook: `backend/migrations/README.md`
- Program tracking docs: `V2/MIGRATION_EXECUTION_STATUS.md`, `V2/MIGRATION_TASKS.md`

---

If uncertain, treat **write-route security + migration verifiability** as the non-negotiable constraints.
