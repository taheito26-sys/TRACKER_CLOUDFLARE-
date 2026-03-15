# Option A cutover, single production API

## Canonical production shape
- Frontend deploy target: Cloudflare Pages
- Frontend assets config: root `wrangler.jsonc`
- Canonical API runtime: `backend/`
- Canonical database: D1 `crypto-tracker`
- Legacy surface: `merchant-api/`, reference only, not deployable

## Production gates
1. Frontend must not reference `merchant-api`, `p2p-merchant-api`, or `p2p-merchant-db`.
2. Backend must serve merchant, import, and system routes.
3. Backend migrations must be applied successfully.
4. Backend smoke tests must pass on the real workers.dev URL.
5. Legacy merchant-api must not be deployable.

## Required smoke tests
- GET `/api/system/health`
- GET `/api/system/version`
- GET `/api/system/migrations`
- Merchant read flow
- Merchant write flow
- Import flow
- Audit and write-guard behavior

## Final retirement
Delete `merchant-api/` only after data reconciliation and production verification are complete.
