#!/usr/bin/env node

const args = process.argv.slice(2);
const SCRIPT_VERSION = '2026-03-14-v7';
let baseUrl = 'https://p2p-tracker.taheito26.workers.dev';
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--base-url' || args[i] === '-b') && args[i + 1]) {
    baseUrl = args[i + 1];
    i++;
  }
}

function normalizeBase(url) {
  return String(url || '').replace(/\/$/, '');
}

async function getJson(endpoint) {
  const url = `${normalizeBase(baseUrl)}${endpoint}`;
  try {
    const res = await fetch(url, { method: 'GET' });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    return { ok: res.ok, status: res.status, url, text, data };
  } catch (err) {
    return { ok: false, status: 0, url, text: '', data: null, error: err?.message || String(err) };
  }
}


function looksLikeHtml(text) {
  const t = String(text || '').trim().toLowerCase();
  return t.startsWith('<!doctype html') || t.startsWith('<html') || t.includes('<body');
}

function printResult(name, result) {
  if (result.ok) {
    console.log(`[result] ${name} status=${result.status}`);
    console.log(JSON.stringify(result.data ?? result.text, null, 2));
  } else {
    console.log(`[error] ${name} status=${result.status} url=${result.url}`);
    if (result.error) console.log(`[error-message] ${result.error}`);
    if (result.text) console.log(`[error-body] ${result.text}`);
    if (looksLikeHtml(result.text)) console.log('[diag] Response body looks like HTML (likely frontend/site deployment, not backend API worker).');
  }
}

console.log(`[verify] Script: verify-system-endpoints.mjs ${SCRIPT_VERSION}`);
console.log('[verify] Tip: run directly (no `. $args[0]` wrapper).');
console.log(`[verify] Base URL: ${normalizeBase(baseUrl)}`);

const health = await getJson('/api/system/health');
const migrations = await getJson('/api/system/migrations');
const version = await getJson('/api/system/version');

printResult('/api/system/health', health);
printResult('/api/system/migrations', migrations);
printResult('/api/system/version', version);

let healthOk = false;
let hasVersion001 = false;

if (health.ok && health.data?.ok === true) healthOk = true;
if (migrations.ok && Array.isArray(migrations.data?.migrations)) {
  hasVersion001 = migrations.data.migrations.some((m) => String(m?.version) === '001');
}

if (!health.ok || !migrations.ok || !version.ok) {
  console.log('[diag] /api/system routes not fully reachable; checking /api/status fallback...');
  const status = await getJson('/api/status');
  printResult('/api/status', status);

  if (status.ok && (health.status === 404 || migrations.status === 404 || version.status === 404)) {
    console.log('[diag] /api/status works while /api/system returns 404 -> likely older deployed worker code. Redeploy latest backend.');
  }

  if ((health.status === 404 && migrations.status === 404 && version.status === 404) && status.status === 404) {
    console.log('[diag] All API probes returned 404. Checking site root to fingerprint deployment target...');
    const root = await getJson('/');
    if (root.ok) {
      printResult('/', root);
    } else {
      console.log(`[diag] Root probe status=${root.status} url=${root.url}`);
      if (root.error) console.log(`[diag-error] ${root.error}`);
      if (root.text) console.log(`[diag-body] ${String(root.text).slice(0, 400)}`);
    }
    console.log('[diag] If this is not the backend worker, confirm you deployed backend/src/index.js to p2p-tracker and re-run verification.');
  }
}


const allFetchFailed = [health, migrations, version].every((r) => r.status === 0 && String(r.error || '').toLowerCase().includes('fetch failed'));
if (allFetchFailed) {
  console.log('[diag] Network/DNS issue detected (all endpoint probes failed before HTTP response).');
  console.log("[diag] If Wrangler shows 'Unable to resolve Cloudflare's API hostname', fix DNS/network/VPN/firewall first.");
}

const anyHtml = [health, migrations, version].some((r) => looksLikeHtml(r.text));
if (anyHtml) {
  console.log('[diag] Target may be wrong: API URL appears to return HTML instead of backend JSON.');
  const root = await getJson('/');
  if (root.text && looksLikeHtml(root.text)) {
    console.log('[diag] Root `/` also returns HTML -> this URL is likely frontend/site content, not backend worker API.');
  }
}

console.log(`[summary] health.ok=${healthOk} version001=${hasVersion001}`);
if (!healthOk || !hasVersion001) {
  console.error('[verify] FAIL: expected health.ok=true and migration version 001 present');
  console.error('[verify] Required from you (User):');
  if (allFetchFailed) {
    console.error('[verify]   1) Fix connectivity first (DNS/VPN/firewall). In PowerShell run:');
    console.error('[verify]      Test-NetConnection api.cloudflare.com -Port 443');
    console.error('[verify]      Test-NetConnection p2p-tracker.taheito26.workers.dev -Port 443');
    console.error('[verify]   2) After network is healthy, rerun:');
    console.error('[verify]      npx wrangler d1 execute DB --remote --command "SELECT version FROM schema_migrations ORDER BY id;" --config ./wrangler.toml');
    console.error(`[verify]      node ./scripts/verify-system-endpoints.mjs --base-url "${normalizeBase(baseUrl)}"`);
  } else if (anyHtml) {
    console.error('[verify]   1) Deploy backend worker from backend/ (not frontend/static site):');
    console.error('[verify]      npx wrangler deploy --config ./wrangler.toml');
    console.error('[verify]   2) Verify you are probing backend domain, then rerun:');
    console.error(`[verify]      node ./scripts/verify-system-endpoints.mjs --base-url "${normalizeBase(baseUrl)}"`);
    console.error('[verify]   3) If still failing, run migration check:');
    console.error('[verify]      npx wrangler d1 execute DB --remote --command "SELECT version FROM schema_migrations ORDER BY id;" --config ./wrangler.toml');
  } else {
    console.error(`[verify]   1) Re-run migration: npx wrangler d1 execute DB --remote --file=./migrations/001_schema_migrations.sql --config ./wrangler.toml`);
    console.error(`[verify]   2) Re-check migration versions: npx wrangler d1 execute DB --remote --command "SELECT version FROM schema_migrations ORDER BY id;" --config ./wrangler.toml`);
    console.error(`[verify]   3) Re-run verifier from backend/: node ./scripts/verify-system-endpoints.mjs --base-url "${normalizeBase(baseUrl)}"`);
  }
  process.exitCode = 1;
  // Intentionally avoid abrupt process.exit() and timers on Windows to prevent async handle assertion crashes.
} else {
  console.log('[verify] PASS');
}
