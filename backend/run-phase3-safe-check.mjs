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
const requestTimeoutMs = Number(arg('--request-timeout-ms', '15000'));
const cfAccessClientId = arg('--cf-access-client-id', process.env.CF_ACCESS_CLIENT_ID || '').trim();
const cfAccessClientSecret = arg('--cf-access-client-secret', process.env.CF_ACCESS_CLIENT_SECRET || '').trim();


function assertValidBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[phase3-safe] Invalid --base-url: ${value}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`[phase3-safe] Invalid --base-url protocol: ${parsed.protocol}`);
  }
}


function assertValidTimeoutMs(value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`[phase3-safe] Invalid --request-timeout-ms: ${value}`);
  }
}

function runStep(name, cmd, cmdArgs) {
  console.log(`[phase3-safe] ${name}`);
  const out = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const code = Number(out.status ?? 1);
  if (code !== 0) {
    const signal = out.signal ? ` signal=${out.signal}` : '';
    throw new Error(`[phase3-safe] ${name} failed with exit code ${code}${signal}`);
  }
}


async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  let res;
  try {
    res = await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`[phase3-safe] request timed out after ${requestTimeoutMs}ms for ${url}`);
    }
    throw new Error(`[phase3-safe] request failed for ${url}: ${err?.message || err}`);
  } finally {
    clearTimeout(timeout);
  }

  const text = await res.text();
  return { res, text };
}

function parseJsonIfPossible(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}


function accessHeaders() {
  const headers = {};
  if (cfAccessClientId) headers['CF-Access-Client-Id'] = cfAccessClientId;
  if (cfAccessClientSecret) headers['CF-Access-Client-Secret'] = cfAccessClientSecret;
  return headers;
}

async function verifySystemEndpointsInline() {
  console.log('[phase3-safe] Step B: Verify system endpoints (inline)');
  const endpoints = ['/api/system/health', '/api/system/migrations', '/api/system/version'];
  const results = {};
  for (const ep of endpoints) {
    const url = `${baseUrl}${ep}`;
    const { res, text } = await fetchText(url, { method: 'GET' });
    const data = parseJsonIfPossible(text);
    results[ep] = { status: res.status, ok: res.ok, data, text };
    console.log(`[phase3-safe] ${ep} status=${res.status}`);
  }

  const healthOk = results['/api/system/health']?.ok && results['/api/system/health']?.data?.ok === true;
  const mig = results['/api/system/migrations'];
  const versionOk = results['/api/system/version']?.ok;
  const has001 = !!(mig?.ok && Array.isArray(mig?.data?.migrations) && mig.data.migrations.some((m) => String(m?.version) === '001'));
  const all404 = endpoints.every((ep) => results[ep]?.status === 404);

  if (!healthOk || !has001 || !versionOk) {
    const staleDeployHint = all404
      ? ' all-system-endpoints-404=true (likely stale deployment or wrong --base-url)'
      : '';
    throw new Error(`[phase3-safe] Inline verify failed: health.ok=${healthOk} version001=${has001} versionEndpoint=${versionOk}${staleDeployHint}`);
  }
  console.log('[phase3-safe] Step B PASS: system endpoints validated');
}

async function postImport() {
  const payload = {
    idempotency_key: idemKey,
    deals: [{ id: 'deal_1', title: 'Sample Deal', amount: 1000, currency: 'USDT' }],
    trades: [{ id: 'tr_1', symbol: 'BTCUSDT', qty: 0.01 }],
  };
  const { res, text: body } = await fetchText(`${baseUrl}/api/import/json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      ...accessHeaders(),
    },
    body: JSON.stringify(payload),
  });
  console.log(`[phase3-safe] import POST status=${res.status}`);
  if (body) console.log(`[phase3-safe] import POST body=${body}`);
  if (res.status === 401) {
    throw new Error('[phase3-safe] import POST unauthorized (401). Provide Cloudflare Access service token via --cf-access-client-id/--cf-access-client-secret, or run from an allowed Access-authenticated context.');
  }
  if (res.status !== 202 && res.status !== 200) throw new Error(`[phase3-safe] import POST unexpected status ${res.status}`);
  const json = parseJsonIfPossible(body) || {};
  return json?.import_job?.id;
}

async function getImport(importId) {
  const { res, text: body } = await fetchText(`${baseUrl}/api/import/json/${importId}`, {
    headers: { 'X-User-Id': userId, ...accessHeaders() },
  });
  console.log(`[phase3-safe] import GET status=${res.status}`);
  if (body) console.log(`[phase3-safe] import GET body=${body}`);
  if (res.status !== 200) throw new Error(`[phase3-safe] import GET unexpected status ${res.status}`);
}

(async () => {
  let failed = false;
  try {
    assertValidBaseUrl(baseUrl);
    assertValidTimeoutMs(requestTimeoutMs);
    console.log('[phase3-safe] Starting consolidated phase3 check');
    console.log(`[phase3-safe] baseUrl=${baseUrl} userId=${userId} requestTimeoutMs=${requestTimeoutMs} cfAccessHeaders=${cfAccessClientId && cfAccessClientSecret ? 'present' : 'absent'}`);

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
    failed = true;
    const message = String(err?.message || err);
    console.error(message);
    if (message.includes('import POST unauthorized (401)')) {
      console.error('[phase3-safe] Next action: rerun with Access service token headers.');
      console.error('[phase3-safe] Example: node ./run-phase3-safe-check.mjs --skip-deploy --base-url ' + baseUrl + ' --user-id ' + userId + ' --request-timeout-ms ' + requestTimeoutMs + ' --cf-access-client-id <id> --cf-access-client-secret <secret>');
    }
    if (message.includes('all-system-endpoints-404=true')) {
      console.error('[phase3-safe] Next action: deploy this worker target and rerun phase3 check.');
      console.error('[phase3-safe] Deploy command: npx wrangler deploy --config ./wrangler.toml');
      console.error('[phase3-safe] Rerun command: node ./run-phase3-safe-check.mjs --skip-deploy --base-url ' + baseUrl + ' --user-id ' + userId + ' --request-timeout-ms ' + requestTimeoutMs);
    }
    console.error('[phase3-safe] Hint: if Step A fails on Windows, run `npx wrangler deploy --config ./wrangler.toml` and rerun with --skip-deploy.');
    console.error('[phase3-safe] Required from you (User): paste full output of this command.');
  } finally {
    if (failed) {
      process.exitCode = 1;
      // Let Node exit gracefully on Windows to avoid libuv async-handle assertion crashes.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
})();
