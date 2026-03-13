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

## Expected results

- `/api/system/health` returns `ok: true` and `bindings.db: true`.
- `/api/system/migrations` includes version `001`.
- Running migration SQL repeatedly does not duplicate version `001`.
