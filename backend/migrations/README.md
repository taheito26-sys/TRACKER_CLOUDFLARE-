# Backend D1 Migrations Runbook (Phase 1)

This runbook executes and validates Phase 1 schema foundation tasks.

## Prerequisites

- Wrangler CLI available.
- `backend/wrangler.toml` configured with correct `[[d1_databases]]` binding.
- Authenticated Cloudflare session (`wrangler login`).

## Apply migrations (remote)

```bash
cd backend
npx wrangler d1 execute crypto-tracker --file=./migrations/001_schema_migrations.sql
```

## Apply migrations (local)

```bash
cd backend
npx wrangler d1 execute crypto-tracker --local --file=./migrations/001_schema_migrations.sql
```

## Verify migration registry table

```bash
cd backend
npx wrangler d1 execute crypto-tracker --command "SELECT id, version, description, applied_at FROM schema_migrations ORDER BY id ASC;"
```

## Verify Worker endpoints after deploy

```bash
curl -s https://<worker-domain>/api/system/health
curl -s https://<worker-domain>/api/system/migrations
curl -s https://<worker-domain>/api/system/version
```

### PowerShell (Windows) equivalents

PowerShell aliases `curl` to `Invoke-WebRequest`, so use one of these safe options:

```powershell
# Option A: use curl.exe explicitly
curl.exe -sS "https://<worker-domain>/api/system/health"
curl.exe -sS "https://<worker-domain>/api/system/migrations"

# Option B: native PowerShell JSON fetch
(Invoke-RestMethod "https://<worker-domain>/api/system/health") | ConvertTo-Json -Depth 10
(Invoke-RestMethod "https://<worker-domain>/api/system/migrations") | ConvertTo-Json -Depth 10
(Invoke-RestMethod "https://<worker-domain>/api/system/version") | ConvertTo-Json -Depth 10
```

### Common Windows pitfalls

- Do **not** run `. $args[0] curl ...` (that syntax invokes script arguments and will not execute the endpoint check as intended).
- If output is blank, run with verbose flags:

```powershell
curl.exe -v "https://<worker-domain>/api/system/health"
```

- For TLS/proxy issues, test with:

```powershell
Test-NetConnection p2p-tracker.taheito26.workers.dev -Port 443
```

### One-command PowerShell validation script

From `backend/` run:

```powershell
.\scripts\verify-system-endpoints.ps1
# or with custom URL
.\scripts\verify-system-endpoints.ps1 -BaseUrl "https://p2p-tracker.taheito26.workers.dev"
```

This script prints system JSON payloads and fails if:
- `health.ok != true`
- migration version `001` is not found
- `/api/system/version` is unavailable (helps detect stale deployments).

- If you receive `404 Not Found` on `/api/system/*`, run the verifier script. It now checks `/api/status` as a fallback and tells you whether the deployment likely runs older code.
- If fallback `/api/status` works but `/api/system/*` is 404, redeploy latest backend Worker from this repo and rerun verification.

### Shell-agnostic verifier (recommended)

If PowerShell wrappers/policies are interfering, run the Node verifier:

```powershell
cd C:\TRACKER_CLOUDFLARE-\backend
node .\scripts\verify-system-endpoints.mjs --base-url "https://p2p-tracker.taheito26.workers.dev"
```

This avoids PowerShell aliasing/dot-sourcing issues entirely and returns a non-zero exit code on failure.

### Windows CMD/PowerShell wrapper (recommended)

From `backend/` run this wrapper to avoid shell syntax issues:

```powershell
.\scripts\verify-system-endpoints.cmd
# custom URL
.\scripts\verify-system-endpoints.cmd https://p2p-tracker.taheito26.workers.dev
```

Before running, ensure you have latest scripts from git (`git pull`).

### Known-good PowerShell sequence (copy/paste)

> Run these commands exactly from a normal PowerShell prompt (no `. $args[0]` prefix):

```powershell
cd C:\TRACKER_CLOUDFLARE-\backend
npx wrangler deploy
.\scripts\verify-system-endpoints.ps1 -BaseUrl "https://p2p-tracker.taheito26.workers.dev"
```

If you are currently inside `backend/scripts`, first move to backend root:

```powershell
cd ..
.\scripts\verify-system-endpoints.ps1 -BaseUrl "https://p2p-tracker.taheito26.workers.dev"
```

## Expected results

- `/api/system/health` returns `ok: true` and `bindings.db: true`.
- `/api/system/migrations` includes version `001`.
- `/api/system/version` returns endpoint/version metadata.
- Running migration SQL repeatedly does not duplicate version `001`.
