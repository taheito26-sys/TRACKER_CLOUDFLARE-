#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const cwd = process.cwd();
const repoConfig = path.join(cwd, 'wrangler.toml');
const nestedConfig = path.join(cwd, 'backend', 'wrangler.toml');
const configPath = fs.existsSync(repoConfig) ? repoConfig : (fs.existsSync(nestedConfig) ? nestedConfig : repoConfig);
const baseDir = path.dirname(configPath);
const args = process.argv.slice(2);

function arg(name, fallback = undefined) {
  const i = args.findIndex((a) => a === name);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
}

function flag(name) {
  return args.includes(name);
}

function parseFirstD1DatabaseConfigToml(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const d1Section = txt.match(/\[\[d1_databases\]\]([\s\S]*?)(?=\n\[\[|\n\[|$)/m);
  if (!d1Section) return { binding: null, databaseName: null };

  const section = d1Section[1];
  const binding = section.match(/\bbinding\s*=\s*"([^"]+)"/)?.[1] ?? null;
  const databaseName = section.match(/\bdatabase_name\s*=\s*"([^"]+)"/)?.[1] ?? null;
  return { binding, databaseName };
}

function runStep(name, cmd, cmdArgs) {
  console.log(`[phase1] ${name}`);
  const out = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
  const code = Number(out.status ?? out.signal ?? 1);
  if (code !== 0) {
    throw new Error(`[phase1] ${name} failed with exit code ${code}`);
  }
}

if (!fs.existsSync(configPath)) {
  console.error(`[phase1] Missing ${configPath}`);
  process.exit(2);
}

const d1 = parseFirstD1DatabaseConfigToml(configPath);
const dbBinding = arg('--db-binding', d1.binding || 'DB');
const dbName = arg('--db-name', d1.databaseName || 'crypto-tracker');
const d1Target = arg('--d1-target', dbBinding || dbName);
const baseUrl = arg('--base-url', 'https://p2p-tracker-api.taheito26.workers.dev');
const skipDeploy = flag('--skip-deploy');
const skipMigration = flag('--skip-migration');
const skipVerify = flag('--skip-verify');
const localD1 = flag('--local-d1');

console.log('[phase1] Starting one-shot execution');
console.log(`[phase1] config=${configPath}`);
console.log(`[phase1] d1Target=${d1Target} (binding=${dbBinding} name=${dbName}) baseUrl=${baseUrl}`);

try {
  if (!skipDeploy) {
    runStep('Step A: Deploy worker', 'npx', ['wrangler', 'deploy', '--config', configPath]);
  }

  if (!skipMigration) {
    const d1Args = [
      'wrangler',
      'd1',
      'execute',
      d1Target,
      '--config',
      configPath,
      '--file',
      path.join(baseDir, 'migrations', '001_schema_migrations.sql'),
    ];
    if (!localD1) d1Args.push('--remote');
    runStep(`Step B: Apply migration 001 (${localD1 ? 'local' : 'remote'})`, 'npx', d1Args);
  }

  if (!skipVerify) {
    runStep('Step C: Verify system endpoints', 'node', [path.join(baseDir, 'scripts', 'verify-system-endpoints.mjs'), '--base-url', baseUrl]);
  }

  console.log('[phase1] DONE');
} catch (err) {
  console.error(String(err?.message || err));
  console.error('[phase1] Hint: run with --d1-target <binding-or-db-name> (for this repo: --d1-target DB).');
  process.exit(1);
}
