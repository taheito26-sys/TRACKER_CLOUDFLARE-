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

function bin(name) {
  if (process.platform === 'win32') return `${name}.cmd`;
  return name;
}

function runStep(name, cmd, cmdArgs) {
  console.log(`[phase3-safe] ${name}`);
  const out = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: false });
  const code = Number(out.status ?? out.signal ?? 1);
  if (code !== 0) throw new Error(`[phase3-safe] ${name} failed with exit code ${code}`);
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
      runStep('Step A: Deploy worker', bin('npx'), ['wrangler', 'deploy', '--config', path.join(scriptDir, 'wrangler.toml')]);
    }

    runStep('Step B: Verify system endpoints', bin('node'), [path.join(scriptDir, 'scripts', 'verify-system-endpoints.mjs'), '--base-url', baseUrl]);

    console.log('[phase3-safe] Step C: POST /api/import/json');
    const importId = await postImport();
    if (!importId) throw new Error('[phase3-safe] import id not returned');

    console.log('[phase3-safe] Step D: GET /api/import/json/:id');
    await getImport(importId);

    console.log('[phase3-safe] PASS: import bridge baseline endpoints verified');
  } catch (err) {
    console.error(String(err?.message || err));
    if (String(err?.message || '').includes('exit code')) {
      console.error('[phase3-safe] Hint: on Windows this runner now uses npx.cmd/node.cmd; if it still fails, run `npx wrangler deploy --config ./wrangler.toml` manually and re-run with --skip-deploy.');
    }
    console.error('[phase3-safe] Required from you (User): paste full output of this command.');
    process.exit(1);
  }
})();
