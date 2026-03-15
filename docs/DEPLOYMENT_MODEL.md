# Deployment model and route ownership

## Canonical production workers
- Frontend worker name: `p2p-tracker`
- Frontend URL: `https://p2p-tracker.<account>.workers.dev`
- Frontend config source: root `wrangler.jsonc`
- Frontend deploy workflow: `.github/workflows/deploy-frontend.yml`

- Backend API worker name: `p2p-tracker-api`
- Backend URL: `https://p2p-tracker-api.<account>.workers.dev`
- Backend config source: `backend/wrangler.toml`
- Backend deploy workflow: `.github/workflows/deploy-backend.yml`

## Ownership guardrails
1. **Never set backend worker name to `p2p-tracker`**.
2. Frontend workflow must deploy from root `wrangler.jsonc`.
3. Backend workflow must deploy from `backend/wrangler.toml`.
4. Frontend app API base must point to `p2p-tracker-api`.
5. `ALLOWED_ORIGINS` in backend must include the live frontend origin(s).

## Smoke test checklist
- `GET https://p2p-tracker.<account>.workers.dev/` returns `text/html`.
- JS/CSS assets return HTTP 200.
- API calls target `https://p2p-tracker-api.<account>.workers.dev`.
- `GET /api/system/health` on API worker returns JSON with CORS headers for frontend origin.
