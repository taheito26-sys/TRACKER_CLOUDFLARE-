# Merchant Platform — Complete Build Guide

> Purpose: Recreate the Merchant Platform from scratch using Cloudflare Workers (Hono), D1, and a React + TypeScript frontend.

## 1) Architecture Overview

```text
React frontend (session identity)
        |
        v
Cloudflare Worker (Hono)  -> /api/merchant/*
        |
        v
D1 (SQLite)
```

- Frontend: React 18 + Vite + TypeScript.
- Backend: Hono on Cloudflare Workers.
- Database: Cloudflare D1 (SQLite).
- Auth: Same as P2P Tracker compatibility auth (`X-User-Id` / `X-User-Email` headers), with optional bearer-token verification only when configured.
- Sync: Polling-based unread counts.

## 2) Tech Stack

- Frontend: `react`, `react-router-dom`
- Backend: `hono`, `wrangler`, `typescript`, `@cloudflare/workers-types`
- Data: D1 + KV (`PRICE_KV`)

## 3) Database Schema (D1)

Apply schema:

```bash
wrangler d1 execute <db-name> --file=seed/merchant-schema.sql
```

This platform uses 12 core tables:

- `merchant_profiles`
- `merchant_invites`
- `merchant_relationships`
- `merchant_roles`
- `merchant_deals`
- `merchant_settlements`
- `merchant_profit_records`
- `merchant_approvals`
- `merchant_messages`
- `merchant_audit_logs`
- `merchant_notifications`

Key conventions:

- IDs use random hex/UUID-compatible text fields.
- Timestamps are ISO-8601 text (`datetime('now')` / `toISOString()`).
- JSON fields are stored as text.
- `merchant_profiles.owner_user_id` is unique (one profile per user).

## 4) Authentication (P2P Tracker-Compatible)

Use the same request identity pattern as the existing P2P Tracker worker:

- Primary compatibility mode:
  - `X-User-Id` (preferred)
  - fallback `X-Compat-User`
  - fallback `X-User-Email` (normalized to lowercase, then mapped to `compat:<email>` user id)
- Optional bearer-token mode may be supported if backend configuration enables it, but it is not required for merchant flows.
- Merchant routes should resolve identity from request headers and operate on that `userId` (same architecture as current P2P routes).

## 5) CORS Middleware

- Parse `ALLOWED_ORIGINS` from env (comma-separated).
- Support OPTIONS preflight.
- Set `Access-Control-Allow-*` headers.
- Allow localhost and trusted lovable domains.

## 6) Worker Bindings Type

```ts
export interface Env {
  DB: D1Database;
  PRICE_KV: KVNamespace;
  ALLOWED_ORIGINS?: string;
}
```

## 7) Backend Route Modules

All route files:

1. Create Hono app with typed bindings.
2. Resolve request identity using P2P compatibility headers.
3. Resolve merchant profile for current user.

Modules and mount points:

- `/api/merchant` → profiles
- `/api/merchant/invites` → invites lifecycle
- `/api/merchant/relationships` → relationship management
- `/api/merchant/deals` → deals + settlement/profit/close request flows
- `/api/merchant/messages` → chat + read receipts
- `/api/merchant/approvals` → approve/reject mutation pipeline
- `/api/merchant/audit` → relationship and personal audit streams
- `/api/merchant/notifications` → notifications + unread counters

### Critical approval behavior

Approving a pending request applies domain mutation by type:

- `settlement_submit` → approve settlement + settle deal + add realized pnl
- `profit_record_submit` → approve profit row + add net distributable to deal pnl
- `deal_close` → close deal and finalize pnl
- `relationship_suspend` / `relationship_terminate` → update relationship status
- `capital_adjustment` → adjust deal amount

## 8) Route Wiring

`backend/src/index.ts` should:

- apply CORS middleware globally
- mount all merchant route modules
- return 404 JSON for unknown routes
- return 500 JSON from global error handler

## 9) Frontend API Client

`src/lib/merchantApi.ts` expectations:

- Send the same compatibility identity headers used by P2P Tracker (`X-User-Id` and/or `X-User-Email`).
- Prefix requests with `VITE_WORKER_API_URL`.
- Set JSON headers (and optional auth header only if your deployment enables bearer mode).
- Throw errors from non-2xx responses.
- Expose typed helper functions for profiles, invites, relationships, deals, messages, approvals, audit, notifications.

## 10) Frontend Merchant Page

`src/pages/MerchantPage.tsx` structure:

- onboarding
- overview
- directory + invite modal
- invites inbox/sent
- relationships list + workspace
- approvals
- notifications
- settings
- audit

State is local (`useState`), and unread notifications are polled every 15 seconds.

## 11) Wrangler Configuration

`backend/wrangler.toml` baseline:

```toml
name = "cryptotracker-api"
main = "src/index.ts"
compatibility_date = "2025-03-01"
compatibility_flags = ["nodejs_compat"]

[vars]
ALLOWED_ORIGINS = "http://localhost:3000,https://your-frontend.pages.dev"

[[d1_databases]]
binding = "DB"
database_name = "crypto-tracker"
database_id = "<your-d1-database-id>"

[[kv_namespaces]]
binding = "PRICE_KV"
id = "<your-kv-namespace-id>"
```

## 12) Deployment

Backend:

```bash
cd backend
npm install
wrangler d1 execute crypto-tracker --remote --file=../seed/merchant-schema.sql
wrangler deploy
```

Frontend:

```bash
npm install
npm run build
```

## 13) End-to-End Flows

- Onboarding profile creation with nickname validation.
- Discovery → invite → acceptance → relationship + roles + system artifacts.
- Deal lifecycle with settlement/profit/close requests gated by approvals.
- Relationship suspend/terminate with audit logs.

## Suggested project file map

```text
backend/
  src/
    index.ts
    types.ts
    middleware/
      cors.ts
    routes/
      merchant-profiles.ts
      merchant-invites.ts
      merchant-relationships.ts
      merchant-deals.ts
      merchant-messages.ts
      merchant-approvals.ts
      merchant-audit.ts
      merchant-notifications.ts
  wrangler.toml
seed/
  merchant-schema.sql
src/
  lib/merchantApi.ts
  pages/MerchantPage.tsx
```
