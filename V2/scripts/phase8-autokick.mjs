#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const base = process.env.PHASE8_BASE || 'https://p2p-tracker.taheito26.workers.dev';
const userId = process.env.PHASE8_USER_ID || 'compat:phase8-autokick';
const outFile = process.env.PHASE8_OUT || 'V2/PHASE8_READINESS_REPORT.md';

console.log(`[phase8-autokick] base=${base}`);
console.log(`[phase8-autokick] userId=${userId}`);
console.log(`[phase8-autokick] out=${outFile}`);

const res = spawnSync(process.execPath, [
  'V2/scripts/phase8-readiness-check.mjs',
  '--base', base,
  '--user-id', userId,
  '--out', outFile,
], { stdio: 'inherit' });

if (res.error) {
  console.error('[phase8-autokick] failed:', res.error.message || res.error);
  process.exit(1);
}

if (res.status === 0) {
  console.log('[phase8-autokick] readiness PASS. Next step: execute Phase 8 staging reconciliation sign-off.');
} else if (res.status === 2) {
  console.log('[phase8-autokick] readiness gates not fully passed. Next step: review generated report and fix failing gates.');
} else {
  console.log('[phase8-autokick] readiness script error. Next step: verify endpoint reachability/auth headers and retry.');
}

process.exit(res.status ?? 1);
