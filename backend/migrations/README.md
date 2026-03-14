# Backend D1 Migrations Runbook (Phase 1)

This runbook executes and validates Phase 1 schema foundation tasks.

## Prerequisites

- Wrangler CLI available.
- `backend/wrangler.toml` configured with correct `[[d1_databases]]` binding.
- Authenticated Cloudflare session (`wrangler login`).


## What is required from you (operator inputs/actions)

To complete Phase 1 validation, I need the following from you:

1. **Environment target**: tell me whether to validate against `local`, `staging`, or `production`.
2. **Worker URL**: confirm the base URL to validate (for example `https://p2p-tracker.taheito26.workers.dev`).
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
.\run-phase1-oneshot.ps1 -D1Target "DB" -DbName "crypto-tracker" -BaseUrl "https://p2p-tracker.taheito26.workers.dev"
```


### How to confirm Cloudflare Access headers on production write requests

Use this flow to capture proof that the write guard sees Cloudflare Access identity headers and to produce one write-route sample outcome.

1) Start log tail in one terminal (from `backend/`):

```powershell
npx wrangler tail --format pretty --config .\wrangler.toml
```

2) In another terminal, send a write request to any mutation route (replace with a real write route in your app):

```powershell
# Example unauthenticated probe (should return 401 when guard is active)
curl.exe -i -X POST "https://p2p-tracker.taheito26.workers.dev/api/merchant/messages" -H "Content-Type: application/json" -d "{}"
```

3) Capture these two artifacts and paste in chat:
- The HTTP response snippet (status line + body) from step 2.
- One `mutation_audit` log line from `wrangler tail` showing fields like `auth_mode`, `auth_source`, `actor`, `status`, `outcome`.

Interpretation:
- `401` + `mutation_audit` with `outcome:"denied"` confirms fail-closed behavior.
- `2xx/4xx` with `auth_mode:"cloudflare-access"` and non-anonymous actor confirms Access headers were present and parsed.

### How to confirm staging migration `001_schema_migrations.sql` is complete

Use the staging account/environment context and run:

```powershell
cd C:\TRACKER_CLOUDFLARE-\backend
npx wrangler d1 execute DB --remote --command "SELECT id, version, description, applied_at FROM schema_migrations ORDER BY id ASC;" --config .\wrangler.toml
```

`001_schema_migrations.sql` is confirmed in staging when the output contains a row with:
- `version = 001`
- description similar to `bootstrap schema migration registry`

Then paste the command output in chat and explicitly state it was executed against **staging**.

## Verify migration registry table

```bash
cd backend
npx wrangler d1 execute DB --remote --command "SELECT id, version, description, applied_at FROM schema_migrations ORDER BY id ASC;"
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

### If Wrangler reports DNS/hostname resolution failure

If you see `Unable to resolve Cloudflare's API hostname`, this is a local network/DNS issue (not a migration script issue).

Run from PowerShell and paste output:

```powershell
Test-NetConnection api.cloudflare.com -Port 443
Test-NetConnection p2p-tracker.taheito26.workers.dev -Port 443
```

Then run (without `. $args[0]` prefix):

```powershell
cd C:\TRACKER_CLOUDFLARE-\backend
npx wrangler d1 execute DB --remote --command "SELECT version FROM schema_migrations ORDER BY id;" --config .\wrangler.toml
node .\scripts\verify-system-endpoints.mjs --base-url "https://p2p-tracker.taheito26.workers.dev"
```

### If verifier shows HTML/website content instead of JSON

If output contains large HTML (e.g., dashboard page markup), you are likely hitting frontend/site content instead of backend API worker.

Required from you (User):

```powershell
cd C:\TRACKER_CLOUDFLARE-\backend
npx wrangler deploy --config .\wrangler.toml
node .\scripts\verify-system-endpoints.mjs --base-url "https://p2p-tracker.taheito26.workers.dev"
```

If it still fails, paste output of:

```powershell
npx wrangler d1 execute DB --remote --command "SELECT version FROM schema_migrations ORDER BY id;" --config .\wrangler.toml
```

### If verifier reports `health.ok=false version001=false`

Run these two commands and paste outputs:

```powershell
cd C:\TRACKER_CLOUDFLARE-\backend
npx wrangler d1 execute DB --remote --command "SELECT version FROM schema_migrations ORDER BY id;" --config .\wrangler.toml
node .\scripts\verify-system-endpoints.mjs --base-url "https://p2p-tracker.taheito26.workers.dev"
```

If `001` is missing, re-apply migration:

```powershell
npx wrangler d1 execute DB --remote --file=./migrations/001_schema_migrations.sql --config .\wrangler.toml
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
.\scripts\verify-system-endpoints.cmd https://p2p-tracker.taheito26.workers.dev
```

Before running, ensure you have latest scripts from git (`git pull`) and confirm files exist with `Get-ChildItem .\scripts`.

If Node shows `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` on Windows, use the latest verifier (`v7`) from this repo; it now exits via `process.exitCode` and avoids abrupt process termination.

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

If verifier output shows HTML bodies, you are likely hitting the wrong target (frontend/site route) instead of backend Worker API.

## Expected results

- Verifier banner should show `verify-system-endpoints.mjs 2026-03-14-v5` or newer.

- `/api/system/health` returns `ok: true` and `bindings.db: true`.
- `/api/system/migrations` includes version `001`.
- `/api/system/version` returns endpoint/version metadata.
- Running migration SQL repeatedly does not duplicate version `001`.
