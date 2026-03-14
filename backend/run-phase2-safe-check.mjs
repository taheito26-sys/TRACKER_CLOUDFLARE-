#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = undefined) {
  const i = args.findIndex((a) => a === name);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
}
function flag(name) {
  return args.includes(name);
}

function parseIntArg(name, fallback, { min = Number.NEGATIVE_INFINITY } = {}) {
  const value = Number(arg(name, String(fallback)));
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`[phase2-safe] Invalid ${name}: expected integer >= ${min}`);
  }
  return value;
}

const baseUrl = arg('--base-url', 'https://p2p-tracker.taheito26.workers.dev').replace(/\/$/, '');
const skipDeploy = flag('--skip-deploy');
const expectStatus = parseIntArg('--expect-status', 401, { min: 100 });
const verifyRetries = parseIntArg('--verify-retries', 3, { min: 1 });
const verifyRetryDelayMs = parseIntArg('--verify-retry-delay-ms', 1500, { min: 0 });

function runStep(name, cmd, cmdArgs) {
  console.log(`[phase2-safe] ${name}`);
  const out = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: false });
  const code = Number(out.status ?? out.signal ?? 1);
  if (code !== 0) throw new Error(`[phase2-safe] ${name} failed with exit code ${code}`);
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runVerifyOnce() {
  runStep('Step B: Verify system endpoints', 'node', [path.join(scriptDir, 'scripts', 'verify-system-endpoints.mjs'), '--base-url', baseUrl]);
}

async function runVerifyWithRetries() {
  let lastErr = new Error('[phase2-safe] Step B failed without an explicit error');
  for (let attempt = 1; attempt <= verifyRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[phase2-safe] Step B retry ${attempt}/${verifyRetries} after ${verifyRetryDelayMs}ms`);
      }
      runVerifyOnce();
      return;
    } catch (err) {
      lastErr = err;
      if (attempt >= verifyRetries) break;
      await sleep(verifyRetryDelayMs);
    }
  }
  throw lastErr;
}

async function probeWriteGuard() {
  const url = `${baseUrl}/api/merchant/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const text = await res.text();
  console.log(`[phase2-safe] Probe URL: ${url}`);
  console.log(`[phase2-safe] Probe status=${res.status}`);
  if (text) console.log(`[phase2-safe] Probe body=${text}`);

  if (res.status !== expectStatus) {
    throw new Error(`[phase2-safe] Expected write probe status ${expectStatus} but got ${res.status}`);
  }

  return { status: res.status, body: text };
}

(async () => {
  try {
    console.log('[phase2-safe] Starting consolidated safe check');
    console.log(`[phase2-safe] baseUrl=${baseUrl} expectStatus=${expectStatus} verifyRetries=${verifyRetries} verifyRetryDelayMs=${verifyRetryDelayMs}`);

    if (!skipDeploy) {
      runStep('Step A: Deploy worker', 'npx', ['wrangler', 'deploy', '--config', path.join(scriptDir, 'wrangler.toml')]);
    }

    await runVerifyWithRetries();

    console.log('[phase2-safe] Step C: Probe unauth write guard');
    const probe = await probeWriteGuard();

    console.log(`[phase2-safe] PASS: system verified and write guard returned ${probe.status}`);
  } catch (err) {
    console.error(String(err?.message || err));
    console.error('[phase2-safe] Required from you (User): paste full output of this command and one mutation_audit line from `npx wrangler tail --format pretty`.');
    process.exit(1);
  }
})();
