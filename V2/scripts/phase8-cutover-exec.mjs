#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const readinessScript = path.join(__dirname, 'phase8-readiness-check.mjs');

function usage() {
  console.log(`Usage:
  node V2/scripts/phase8-cutover-exec.mjs --base <url> --user-id <id> [--execute] [--cutover-cmd "<shell command>"] [--post-check-cmd "<shell command>"]

Behavior:
  1) Runs phase8 readiness gates first
  2) If gates fail -> exits with code 2 (no cutover command run)
  3) If gates pass and --execute supplied -> runs cutover command(s)
  4) Optional post-check command(s) run after successful cutover command(s)

Examples:
  node V2/scripts/phase8-cutover-exec.mjs \
    --base https://p2p-tracker.taheito26.workers.dev \
    --user-id compat:cutover

  node V2/scripts/phase8-cutover-exec.mjs \
    --base https://p2p-tracker.taheito26.workers.dev \
    --user-id compat:cutover \
    --execute \
    --cutover-cmd "npx wrangler deploy --config backend/wrangler.toml" \
    --post-check-cmd "node V2/scripts/phase8-readiness-check.mjs --base https://p2p-tracker.taheito26.workers.dev --user-id compat:cutover"
`);
}

function parseArgs(argv) {
  const out = { cutoverCmds: [], postCheckCmds: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = argv[++i];
    else if (a === '--user-id') out.userId = argv[++i];
    else if (a === '--execute') out.execute = true;
    else if (a === '--cutover-cmd') out.cutoverCmds.push(argv[++i]);
    else if (a === '--post-check-cmd') out.postCheckCmds.push(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

function runCommand(cmd, label) {
  console.log(`[cutover] ${label}: ${cmd}`);
  const res = spawnSync(cmd, { stdio: 'inherit', shell: true });
  if (res.error) throw res.error;
  if ((res.status ?? 1) !== 0) {
    throw new Error(`${label} failed with exit code ${res.status ?? 1}`);
  }
}

function runReadiness(base, userId) {
  const res = spawnSync(process.execPath, [
    readinessScript,
    '--base', base,
    '--user-id', userId,
  ], { encoding: 'utf8' });

  const stdout = String(res.stdout || '');
  const stderr = String(res.stderr || '');
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const overallMatch = stdout.match(/\[phase8\]\s+overall=(PASS|FAIL)/);
  const overall = overallMatch ? overallMatch[1] : 'UNKNOWN';

  return {
    code: res.status ?? 1,
    overall,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  if (!args.base || !args.userId) {
    usage();
    throw new Error('Missing required flags: --base and --user-id');
  }

  console.log(`[cutover] base=${args.base}`);
  console.log(`[cutover] userId=${args.userId}`);
  console.log(`[cutover] execute=${Boolean(args.execute)}`);

  const readiness = runReadiness(args.base, args.userId);
  if (readiness.overall !== 'PASS' || readiness.code !== 0) {
    console.log(`[cutover] blocked: readiness gates not passing (overall=${readiness.overall}, code=${readiness.code})`);
    process.exit(2);
  }

  if (!args.execute) {
    console.log('[cutover] readiness PASS. Re-run with --execute to run cutover commands.');
    process.exit(0);
  }

  if (!args.cutoverCmds.length) {
    throw new Error('No --cutover-cmd provided. Refusing to execute empty cutover plan.');
  }

  for (const cmd of args.cutoverCmds) runCommand(cmd, 'cutover-cmd');
  for (const cmd of args.postCheckCmds) runCommand(cmd, 'post-check-cmd');

  console.log('[cutover] completed successfully.');
}

main();
