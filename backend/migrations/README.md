# Backend D1 Migrations Runbook (Phase 1)

This runbook executes and validates Phase 1 schema foundation tasks.

## Prerequisites

- Wrangler CLI available.
- `backend/wrangler.toml` configured with correct `[[d1_databases]]` binding.
- Authenticated Cloudflare session (`wrangler login`).


## What is required from you (operator inputs/actions)

To complete Phase 1 validation, I need the following from you:

1. **Environment target**: tell me whether to validate against `local`, `staging`, or `production`.
2. **Worker URL**: confirm the base URL to validate (for example `https://p2p-tracker-api.taheito26.workers.dev`).
3. **Cloudflare session readiness**: ensure `wrangler whoami` works in your shell.
4. **Run and paste output** (Windows PowerShell):

```powershell
cd C:\TRACKER_CLOUDFLARE-\backend
.\run-phase1-oneshot.ps1 -D1Target "DB"
```

5. If one-shot fails at migration step, run and paste:

```powershell
cd C:\TRACKER_CLOUDFLARE-\backend
npx wrangler d1 execute DB --remote --file=./migrations/001_schema_migrations.sql --config .\wrangler.toml
```

## Apply migrations (remote)

```bash
cd backend
npx wrangler d1 execute DB --remote --file=./migrations/001_schema_migrations.sql
```

## Apply migrations (local)

```bash
cd backend
npx wrangler d1 execute DB --local --file=./migrations/001_schema_migrations.sql
```

## Phase 1 one-shot executor (time saver)

If you want to run multiple Phase 1 steps in one shot (deploy + migration + verify):

```powershell
cd C:\TRACKER_CLOUDFLARE-\backend
.\run-phase1-oneshot.ps1 -D1Target "DB"
```

Or from CMD:

```cmd
run-phase1-oneshot.cmd
```

The one-shot script now **fails fast**: if deploy, migration, or verify fails, it exits non-zero and stops subsequent success reporting.

If you are using Node directly, run the `.mjs` file (not the `.cmd` wrapper):

```powershell
node .\run-phase1-oneshot.mjs --d1-target DB
```


Optional flags:

```powershell
.\run-phase1-oneshot.ps1 -D1Target "DB" -SkipDeploy
.\run-phase1-oneshot.ps1 -D1Target "DB" -SkipMigration
.\run-phase1-oneshot.ps1 -D1Target "DB" -SkipVerify
.\run-phase1-oneshot.ps1 -D1Target "DB" -DbName "crypto-tracker" -BaseUrl "https://p2p-tracker-api.taheito26.workers.dev"
```

## Verify migration registry table

```bash
cd backend
npx wrangler d1 execute DB --remote --command "SELECT id, version, description, applied_at FROM schema_migrations ORDER BY id ASC;"
```

## D1 remote cleanup note (no explicit `BEGIN/COMMIT`)

Cloudflare D1 rejects explicit SQL transaction statements (`BEGIN`, `COMMIT`, `SAVEPOINT`) in `wrangler d1 execute ... --remote --command` with error code `7500`.

Use a single multi-statement command **without** `BEGIN/COMMIT`:

```bash
npx wrangler d1 execute p2p-merchant-db --remote --command "
DELETE FROM relationships
WHERE merchant_a_id IN ('MRC-ONPRLH5X','MRC-5XSD8NGS','MRC-DCTLSCPG','MRC-M4XQLEK9')
   OR merchant_b_id IN ('MRC-ONPRLH5X','MRC-5XSD8NGS','MRC-DCTLSCPG','MRC-M4XQLEK9');

DELETE FROM invites
WHERE from_merchant_id IN ('MRC-ONPRLH5X','MRC-5XSD8NGS','MRC-DCTLSCPG','MRC-M4XQLEK9')
   OR to_merchant_id   IN ('MRC-ONPRLH5X','MRC-5XSD8NGS','MRC-DCTLSCPG','MRC-M4XQLEK9');

DELETE FROM merchant_profiles
WHERE merchant_id IN ('MRC-ONPRLH5X','MRC-5XSD8NGS','MRC-DCTLSCPG','MRC-M4XQLEK9');
"
```

Then verify records are gone:

```bash
npx wrangler d1 execute p2p-merchant-db --remote --command "
SELECT 'relationships' AS table_name, COUNT(*) AS remaining
FROM relationships
WHERE merchant_a_id IN ('MRC-ONPRLH5X','MRC-5XSD8NGS','MRC-DCTLSCPG','MRC-M4XQLEK9')
   OR merchant_b_id IN ('MRC-ONPRLH5X','MRC-5XSD8NGS','MRC-DCTLSCPG','MRC-M4XQLEK9')
UNION ALL
SELECT 'invites' AS table_name, COUNT(*) AS remaining
FROM invites
WHERE from_merchant_id IN ('MRC-ONPRLH5X','MRC-5XSD8NGS','MRC-DCTLSCPG','MRC-M4XQLEK9')
   OR to_merchant_id   IN ('MRC-ONPRLH5X','MRC-5XSD8NGS','MRC-DCTLSCPG','MRC-M4XQLEK9')
UNION ALL
SELECT 'merchant_profiles' AS table_name, COUNT(*) AS remaining
FROM merchant_profiles
WHERE merchant_id IN ('MRC-ONPRLH5X','MRC-5XSD8NGS','MRC-DCTLSCPG','MRC-M4XQLEK9');
"
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
Test-NetConnection p2p-tracker-api.taheito26.workers.dev -Port 443
```

### One-command PowerShell validation script

From `backend/` run:

```powershell
.\scripts\verify-system-endpoints.ps1
# or with custom URL
.\scripts\verify-system-endpoints.ps1 -BaseUrl "https://p2p-tracker-api.taheito26.workers.dev"
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
node .\scripts\verify-system-endpoints.mjs --base-url "https://p2p-tracker-api.taheito26.workers.dev"
```

This avoids PowerShell aliasing/dot-sourcing issues entirely and returns a non-zero exit code on failure.

### Backend-root launcher (easiest)

If PowerShell says `scripts\verify-system-endpoints.cmd` is not recognized, use root launchers:

```powershell
cd C:\TRACKER_CLOUDFLARE-\backend
.\verify-system.cmd
# or
.\verify-system.ps1
```

These launchers call the Node verifier under `scripts/` and avoid path confusion.

If `.cmd` is still not recognized in PowerShell, run one of these explicit forms:

```powershell
& ".\verify-system.cmd"
cmd /c .\verify-system.cmd
.\verify-system.bat
```

If command discovery is still inconsistent, check resolution paths:

```powershell
Get-Location
Get-ChildItem .\
where verify-system.cmd
```

### Windows CMD/PowerShell wrapper (recommended)

From `backend/` run this wrapper to avoid shell syntax issues:

```powershell
.\scripts\verify-system-endpoints.cmd
# custom URL
.\scripts\verify-system-endpoints.cmd https://p2p-tracker-api.taheito26.workers.dev
```

Before running, ensure you have latest scripts from git (`git pull`) and confirm files exist with `Get-ChildItem .\scripts`.

If Node shows `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` on Windows, use the latest verifier (`v4`) from this repo; it now exits via `process.exitCode` and avoids abrupt process termination.

### Known-good PowerShell sequence (copy/paste)

> Run these commands exactly from a normal PowerShell prompt (no `. $args[0]` prefix):

```powershell
cd C:\TRACKER_CLOUDFLARE-\backend
npx wrangler deploy
.\scripts\verify-system-endpoints.ps1 -BaseUrl "https://p2p-tracker-api.taheito26.workers.dev"
```

If you are currently inside `backend/scripts`, first move to backend root:

```powershell
cd ..
.\scripts\verify-system-endpoints.ps1 -BaseUrl "https://p2p-tracker-api.taheito26.workers.dev"
```

If verifier output shows HTML bodies, you are likely hitting the wrong target (frontend/site route) instead of backend Worker API.

## Expected results

- Verifier banner should show: `verify-system-endpoints.mjs 2026-03-13-v4`.

- `/api/system/health` returns `ok: true` and `bindings.db: true`.
- `/api/system/migrations` includes version `001`.
- `/api/system/version` returns endpoint/version metadata.
- Running migration SQL repeatedly does not duplicate version `001`.
