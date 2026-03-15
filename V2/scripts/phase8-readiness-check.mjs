#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUEST_TIMEOUT_MS = Number(process.env.PHASE8_TIMEOUT_MS || 15000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationProgressPath = path.resolve(__dirname, '..', 'MIGRATION_PROGRESS.md');

function usage() {
  console.log(`Usage:
  node V2/scripts/phase8-readiness-check.mjs --base <url> --user-id <id> [--out <file>]

Example:
  node V2/scripts/phase8-readiness-check.mjs \\
    --base https://p2p-tracker.taheito26.workers.dev \\
    --user-id compat:ops@example.com \\
    --out V2/PHASE8_READINESS_REPORT.md
`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = argv[++i];
    else if (a === '--user-id') out.userId = argv[++i];
    else if (a === '--out') out.outFile = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

function validateBaseUrl(raw) {
  const base = String(raw || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('Missing --base value. Example: --base https://p2p-tracker.taheito26.workers.dev');
  if (base.includes('<') || base.includes('>')) {
    throw new Error(`Invalid --base URL: ${base}. Replace placeholder text (for example, use https://p2p-tracker.taheito26.workers.dev).`);
  }
  let parsed;
  try { parsed = new URL(base); } catch {
    throw new Error(`Invalid --base URL: ${base}. Expected an absolute URL like https://example.workers.dev`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`Invalid --base URL protocol: ${parsed.protocol}. Expected http or https.`);
  }
  return parsed.origin;
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

function passFail(v) {
  return v ? 'PASS' : 'FAIL';
}

function readOverallProgress() {
  try {
    const content = fs.readFileSync(migrationProgressPath, 'utf8');
    const match = content.match(/\*\*Overall Progress:\*\*\s*([^\n]+)/);
    if (!match) return null;
    return String(match[1]).trim();
  } catch {
    return null;
  }
}

function toBlock(value) {
  return `\n\n\
\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.base || !args.userId) {
    usage();
    throw new Error('Missing required flags: --base and --user-id');
  }

  const base = validateBaseUrl(args.base);
  const headers = { 'X-User-Id': String(args.userId) };
  const overallProgress = readOverallProgress();

  const checks = {
    version: await fetchJson(`${base}/api/system/version`),
    health: await fetchJson(`${base}/api/system/health`),
    migrations: await fetchJson(`${base}/api/system/migrations`),
    kpiParity: await fetchJson(`${base}/api/system/kpi-parity`, headers),
    cutoverReadiness: await fetchJson(`${base}/api/system/cutover-readiness`, headers),
    reconciliationSummary: await fetchJson(`${base}/api/system/reconciliation-summary`, headers),
  };

  const migrationVersions = Array.isArray(checks.migrations?.json?.migrations)
    ? checks.migrations.json.migrations.map((m) => String(m.version || ''))
    : [];

  const advertisedEndpoints = Array.isArray(checks.version?.json?.endpoints)
    ? checks.version.json.endpoints.map((e) => String(e))
    : [];

  const gates = {
    health_ok: checks.health.ok && checks.health.json?.ok === true,
    migration_001: migrationVersions.includes('001'),
    migration_002: migrationVersions.includes('002'),
    endpoint_reconciliation_advertised: advertisedEndpoints.includes('/api/system/reconciliation-summary'),
    kpi_parity_ok: checks.kpiParity.ok && checks.kpiParity.json?.ok === true,
    cutover_readiness_ok: checks.cutoverReadiness.ok && checks.cutoverReadiness.json?.ok === true,
    reconciliation_summary_ok: checks.reconciliationSummary.ok && checks.reconciliationSummary.json?.ok === true,
  };

  const allPass = Object.values(gates).every(Boolean);

  const report = `# Phase 8 Readiness Report\n\n` +
    `- Base URL: \`${base}\`\n` +
    `- User ID header: \`${args.userId}\`\n` +
    `- Request timeout (ms): \`${REQUEST_TIMEOUT_MS}\`\n` +
    `- Overall migration progress: \`${overallProgress || 'unknown'}\`\n` +
    `- Generated: ${new Date().toISOString()}\n\n` +
    `## Gate Results\n` +
    `- health_ok: **${passFail(gates.health_ok)}**\n` +
    `- migration_001: **${passFail(gates.migration_001)}**\n` +
    `- migration_002: **${passFail(gates.migration_002)}**\n` +
    `- endpoint_reconciliation_advertised: **${passFail(gates.endpoint_reconciliation_advertised)}**\n` +
    `- kpi_parity_ok: **${passFail(gates.kpi_parity_ok)}**\n` +
    `- cutover_readiness_ok: **${passFail(gates.cutover_readiness_ok)}**\n` +
    `- reconciliation_summary_ok: **${passFail(gates.reconciliation_summary_ok)}**\n\n` +
    `## Overall\n` +
    `**${allPass ? 'PASS' : 'FAIL'}**\n\n` +
    `## Endpoint Evidence\n` +
    `### /api/system/version (HTTP ${checks.version.status})` + toBlock(checks.version.json) + `\n` +
    `### /api/system/health (HTTP ${checks.health.status})` + toBlock(checks.health.json) + `\n` +
    `### /api/system/migrations (HTTP ${checks.migrations.status})` + toBlock(checks.migrations.json) + `\n` +
    `### /api/system/kpi-parity (HTTP ${checks.kpiParity.status})` + toBlock(checks.kpiParity.json) + `\n` +
    `### /api/system/cutover-readiness (HTTP ${checks.cutoverReadiness.status})` + toBlock(checks.cutoverReadiness.json) + `\n` +
    `### /api/system/reconciliation-summary (HTTP ${checks.reconciliationSummary.status})` + toBlock(checks.reconciliationSummary.json) + `\n`;

  if (args.outFile) {
    fs.writeFileSync(args.outFile, report);
    console.log(`[phase8] report written: ${args.outFile}`);
  } else {
    console.log(report);
  }

  console.log(`[phase8] overall=${allPass ? 'PASS' : 'FAIL'}`);
  if (overallProgress) {
    console.log(`[phase8] migration-progress=${overallProgress}`);
  }
  process.exitCode = allPass ? 0 : 2;
}

run().catch((err) => {
  console.error('[phase8] error:', err.message || err);
  process.exit(1);
});
