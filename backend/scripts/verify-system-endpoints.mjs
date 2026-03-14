#!/usr/bin/env node

const args = process.argv.slice(2);
const SCRIPT_VERSION = '2026-03-13-v4';
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

function printResult(name, result) {
  if (result.ok) {
    console.log(`[result] ${name} status=${result.status}`);
    console.log(JSON.stringify(result.data ?? result.text, null, 2));
  } else {
    console.log(`[error] ${name} status=${result.status} url=${result.url}`);
    if (result.error) console.log(`[error-message] ${result.error}`);
    if (result.text) console.log(`[error-body] ${result.text}`);
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

console.log(`[summary] health.ok=${healthOk} version001=${hasVersion001}`);
if (!healthOk || !hasVersion001) {
  console.error('[verify] FAIL: expected health.ok=true and migration version 001 present');
  process.exitCode = 1;
  // Intentionally avoid abrupt process.exit() and timers on Windows to prevent async handle assertion crashes.
} else {
  console.log('[verify] PASS');
}
