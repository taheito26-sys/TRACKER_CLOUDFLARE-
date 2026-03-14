# Phase 8 — Cutover & Reconciliation Runbook

This runbook is used to execute Phase 8 safely with explicit pass/fail evidence.

## 1) Preconditions

- Phase 6 complete (`KPI` + parity endpoint available).
- Phase 7 complete (`API-only` mode available in frontend).
- Backend deployed to target environment.

## 2) Readiness checks (must pass)

Run against target backend base URL.

```bash
curl -sS "$BASE/api/system/version"
curl -sS "$BASE/api/system/health"
curl -sS "$BASE/api/system/migrations"
curl -sS -H "X-User-Id: <user>" "$BASE/api/system/kpi-parity"
curl -sS -H "X-User-Id: <user>" "$BASE/api/system/cutover-readiness"
curl -sS -H "X-User-Id: <user>" "$BASE/api/system/reconciliation-summary"
```

Expected:

- `health.ok = true`
- migrations include `001` and `002`
- `kpi-parity.ok = true`
- `cutover-readiness.ok = true`
- `reconciliation-summary.ok = true`


## 2.1) One-command readiness report

You can generate a markdown evidence bundle:

```bash
node V2/scripts/phase8-readiness-check.mjs \
  --base "$BASE" \
  --user-id "<user>" \
  --out V2/PHASE8_READINESS_REPORT.md
```

- Exit code `0` = all gates pass.
- Exit code `2` = one or more gates failed.
- Exit code `1` = script/runtime error.


## 2.2) Auto-kick next step

To automatically kick the next Phase 8 step after each commit/deploy, run:

```bash
PHASE8_BASE="$BASE" PHASE8_USER_ID="<user>" node V2/scripts/phase8-autokick.mjs
```

This wrapper executes `phase8-readiness-check.mjs`, writes `V2/PHASE8_READINESS_REPORT.md`, and prints the immediate next action based on result.

## 3) Reconciliation checklist (staging)

1. Import representative data subset via `/api/import/json`.
2. Verify trade and batch totals:
   - `GET /api/batches`
   - `GET /api/trades`
3. Verify financial totals:
   - `GET /api/deals`
   - `GET /api/settlements`
   - `GET /api/journal`
4. Verify KPI totals:
   - `GET /api/dashboard/kpis`
   - `GET /api/deals/kpis`
5. Verify parity:
   - `GET /api/system/kpi-parity`
6. Verify readiness:
   - `GET /api/system/cutover-readiness`
7. Capture reconciliation summary:
   - `GET /api/system/reconciliation-summary`

## 4) Cutover execution (production)

1. Enable frontend API-only mode in release config.
2. Deploy backend + frontend.
3. Re-run readiness checks in production.
4. Monitor error rates and mutation logs for 1 hour.
5. Keep rollback window open until KPI + reconciliation checks remain stable.

## 5) Sign-off template

- Environment: `staging | production`
- Date/time:
- Operator:
- Readiness result: `PASS | FAIL`
- KPI parity result: `PASS | FAIL`
- Reconciliation notes:
- Decision: `PROCEED | HOLD | ROLLBACK`
