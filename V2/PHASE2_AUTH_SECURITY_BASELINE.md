# Phase 2 — Auth & Security Baseline (Kickoff)

This document starts implementation planning for Phase 2 tasks in `V2/MIGRATION_TASKS.md`.

## Scope

1. Enforce auth/session middleware on all write routes.
2. Add payload validation on migration-sensitive endpoints.
3. Add audit logging on mutation endpoints.

## Initial implementation sequence

### Step 2.1 — Route inventory and write-surface classification
- Enumerate all mutation endpoints in `backend/src/index.js` (POST/PUT/PATCH/DELETE semantics).
- Tag each route as:
  - **Critical financial write** (trades, deals, settlements, journal, imports)
  - **Operational write**
  - **Non-mutating**
- Output: route matrix with required auth and validation level.

### Step 2.2 — Authentication guard skeleton
- Introduce a single request guard entrypoint for write routes.
- Start with allowlist-driven route gating to avoid accidental read-route breakage.
- Keep error surface explicit (`401` unauthenticated, `403` unauthorized).

### Step 2.3 — Payload validation baseline
- Add schema validation helpers for high-risk payloads.
- Enforce validation before write handlers execute.
- Return structured `400` responses with clear field-level diagnostics.

### Step 2.4 — Audit event hook
- Add mutation audit hook (`route`, `actor`, `timestamp`, `result`).
- Ensure no secret data leakage in logs.
- Provide minimal storage/transport abstraction so sink can evolve later.

## Required decisions from user before full implementation

1. **Auth source**: Cloudflare Access headers, JWT bearer token, API key, or hybrid.
2. **Actor identity field** to record in audit events (`email`, `sub`, custom id).
3. **Strictness policy**: fail-closed immediately on all writes vs staged rollout by route group.
4. **Audit sink**: logs-only (initial), D1 table, or external collector.

## Exit criteria for Phase 2

- All write routes are behind auth/session guard.
- Validation covers migration-sensitive payloads.
- Audit hooks fire for every mutation endpoint.


## Selected decisions (confirmed)

1. **Auth source:** Cloudflare Access.
2. **Audit identity field:** Prefer Access identity header (fallback to `unknown`).
3. **Strictness policy:** Fail-closed on all write routes once guard is enabled.
4. **Audit sink:** Logs-only.


## Step 2.2 implementation status

Implemented in `backend/src/index.js`:
- Write-method detection (`POST`/`PUT`/`PATCH`/`DELETE`) for `/api/*` routes.
- Cloudflare Access auth guard controlled by `env.AUTH_SOURCE == "cloudflare-access"`.
- Fail-closed `401` response for write requests missing Access identity headers.
- Logs-only mutation audit events via `console.log` JSON payloads.


## Operator evidence collection (production)

To validate Step 2.3 in production, collect:
1. One write-route HTTP response (`401` expected for unauthenticated probe, or app-defined result for authenticated probe).
2. One `mutation_audit` log event from `wrangler tail` containing `auth_mode`, `auth_source`, `actor`, `status`, `outcome`.

Command skeleton:

```powershell
cd C:\TRACKER_CLOUDFLARE-\backend
npx wrangler tail --format pretty --config .\wrangler.toml
# in second terminal send one POST/PATCH request to a write route
```
