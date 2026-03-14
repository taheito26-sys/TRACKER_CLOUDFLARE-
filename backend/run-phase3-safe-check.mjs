#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function arg(name, fallback = undefined) {
  const i = args.findIndex((a) => a === name);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
}
function flag(name) { return args.includes(name); }

const baseUrl = arg('--base-url', 'https://p2p-tracker.taheito26.workers.dev').replace(/\/$/, '');
const skipDeploy = flag('--skip-deploy');
const userId = arg('--user-id', 'phase3-safe-user');
const idemKey = arg('--idempotency-key', `phase3-${Date.now()}`);

function quote(argValue) {
  const v = String(argValue);
  if (!/[\s"']/g.test(v)) return v;
  return `"${v.replace(/"/g, '\\"')}"`;
}

function runStep(name, cmd, cmdArgs) {
  console.log(`[phase3-safe] ${name}`);
  const parts = [cmd, ...cmdArgs].map(quote);
  const command = parts.join(' ');
  const out = spawnSync(command, {
    stdio: 'inherit',
    shell: true,
  });
  const code = Number(out.status ?? out.signal ?? 1);
  if (code !== 0) throw new Error(`[phase3-safe] ${name} failed with exit code ${code}`);
}


async function verifySystemEndpointsInline() {
  console.log('[phase3-safe] Step B: Verify system endpoints (inline)');
  const endpoints = ['/api/system/health', '/api/system/migrations', '/api/system/version'];
  const results = {};
  for (const ep of endpoints) {
    const url = `${baseUrl}${ep}`;
    const res = await fetch(url, { method: 'GET' });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    results[ep] = { status: res.status, ok: res.ok, data, text };
    console.log(`[phase3-safe] ${ep} status=${res.status}`);
  }

  const healthOk = results['/api/system/health']?.ok && results['/api/system/health']?.data?.ok === true;
  const mig = results['/api/system/migrations'];
  const versionOk = results['/api/system/version']?.ok;
  const has001 = !!(mig?.ok && Array.isArray(mig?.data?.migrations) && mig.data.migrations.some((m) => String(m?.version) === '001'));

  if (!healthOk || !has001 || !versionOk) {
    throw new Error(`[phase3-safe] Inline verify failed: health.ok=${healthOk} version001=${has001} versionEndpoint=${versionOk}`);
  }
  console.log('[phase3-safe] Step B PASS: system endpoints validated');
}

async function postImport() {
  const payload = {
    idempotency_key: idemKey,
    deals: [{ id: 'deal_1', title: 'Sample Deal', amount: 1000, currency: 'USDT' }],
    trades: [{ id: 'tr_1', symbol: 'BTCUSDT', qty: 0.01 }],
  };
  const res = await fetch(`${baseUrl}/api/import/json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  console.log(`[phase3-safe] import POST status=${res.status}`);
  if (body) console.log(`[phase3-safe] import POST body=${body}`);
  if (res.status !== 202 && res.status !== 200) throw new Error(`[phase3-safe] import POST unexpected status ${res.status}`);
  const json = body ? JSON.parse(body) : {};
  return json?.import_job?.id;
}

async function getImport(importId) {
  const res = await fetch(`${baseUrl}/api/import/json/${importId}`, {
    headers: { 'X-User-Id': userId },
  });
  const body = await res.text();
  console.log(`[phase3-safe] import GET status=${res.status}`);
  if (body) console.log(`[phase3-safe] import GET body=${body}`);
  if (res.status !== 200) throw new Error(`[phase3-safe] import GET unexpected status ${res.status}`);
}

(async () => {
  try {
    console.log('[phase3-safe] Starting consolidated phase3 check');
    console.log(`[phase3-safe] baseUrl=${baseUrl} userId=${userId}`);

    if (!skipDeploy) {
      runStep('Step A: Deploy worker', 'npx', ['wrangler', 'deploy', '--config', path.join(scriptDir, 'wrangler.toml')]);
    }

    await verifySystemEndpointsInline();

    console.log('[phase3-safe] Step C: POST /api/import/json');
    const importId = await postImport();
    if (!importId) throw new Error('[phase3-safe] import id not returned');

    console.log('[phase3-safe] Step D: GET /api/import/json/:id');
    await getImport(importId);

    console.log('[phase3-safe] PASS: import bridge baseline endpoints verified');
  } catch (err) {
    console.error(String(err?.message || err));
    console.error('[phase3-safe] Hint: if Step A fails on Windows, run `npx wrangler deploy --config ./wrangler.toml` and rerun with --skip-deploy.');
    console.error('[phase3-safe] Required from you (User): paste full output of this command.');
    process.exit(1);
  }
})();
