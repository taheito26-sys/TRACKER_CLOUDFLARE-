# Phase 8 Readiness Report

- Base URL: `https://p2p-tracker.taheito26.workers.dev`
- User ID header: `compat:you@example.com`
- Generated: 2026-03-14T10:30:05.118Z

## Gate Results
- health_ok: **PASS**
- migration_001: **PASS**
- migration_002: **PASS**
- kpi_parity_ok: **PASS**
- cutover_readiness_ok: **FAIL**
- reconciliation_summary_ok: **FAIL**

## Overall
**FAIL**

## Endpoint Evidence
### /api/system/version (HTTP 200)

```json
{
  "ok": true,
  "service": "p2p-tracker",
  "version": "unknown",
  "timestamp": "2026-03-14T10:30:00.923Z",
  "endpoints": [
    "/api/system/health",
    "/api/system/migrations",
    "/api/system/version",
    "/api/system/kpi-parity",
    "/api/system/cutover-readiness",
    "/api/system/reconciliation-summary"
  ]
}
```
### /api/system/health (HTTP 200)

```json
{
  "ok": true,
  "service": "p2p-tracker",
  "timestamp": "2026-03-14T10:30:00.961Z",
  "bindings": {
    "db": true,
    "kv": true,
    "dbCheck": true
  }
}
```
### /api/system/migrations (HTTP 200)

```json
{
  "migrations": [
    {
      "id": 1,
      "version": "001",
      "description": "bootstrap schema migration registry",
      "applied_at": "2026-03-14 01:01:34"
    },
    {
      "id": 3,
      "version": "002",
      "description": "phase4 trading domain tables: batches, trades, trade_allocations",
      "applied_at": "2026-03-14 07:57:28"
    }
  ],
  "count": 2
}
```
### /api/system/kpi-parity (HTTP 200)

```json
{
  "ok": true,
  "parity": {
    "ok": true,
    "checks": {
      "sell_revenue": true,
      "sell_fees": true,
      "total_deals": true,
      "deals_open_principal": true,
      "deals_settled_principal": true
    },
    "dashboard": {
      "sell_revenue": 0,
      "sell_fees": 0,
      "cogs": 0,
      "gross_profit": 0,
      "net_profit": 0,
      "total_deals": 0,
      "deals_open_principal": 0,
      "deals_settled_principal": 0,
      "settlement_count": 0,
      "settlement_amount": 0
    }
  },
  "timestamp": "2026-03-14T10:30:03.298Z"
}
```
### /api/system/cutover-readiness (HTTP 409)

```json
{
  "ok": false,
  "readiness": {
    "ok": false,
    "checks": {
      "migration_001_applied": true,
      "migration_002_applied": true,
      "trading_seeded": false,
      "financial_seeded": false,
      "kpi_parity_ok": true
    },
    "migrations": [
      "001",
      "002"
    ],
    "counts": {
      "batches": 0,
      "trades": 0,
      "trade_allocations": 0,
      "deals": 0,
      "settlements": 0,
      "journal_entries": 0
    },
    "parity": {
      "ok": true,
      "checks": {
        "sell_revenue": true,
        "sell_fees": true,
        "total_deals": true,
        "deals_open_principal": true,
        "deals_settled_principal": true
      },
      "dashboard": {
        "sell_revenue": 0,
        "sell_fees": 0,
        "cogs": 0,
        "gross_profit": 0,
        "net_profit": 0,
        "total_deals": 0,
        "deals_open_principal": 0,
        "deals_settled_principal": 0,
        "settlement_count": 0,
        "settlement_amount": 0
      }
    }
  },
  "timestamp": "2026-03-14T10:30:05.648Z"
}
```
### /api/system/reconciliation-summary (HTTP 404)

```json
{
  "error": "Not found"
}
```
