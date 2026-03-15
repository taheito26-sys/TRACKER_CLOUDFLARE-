#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const TASKS_FILE = path.join(repoRoot, 'V2', 'MIGRATION_TASKS.md');
const OUT_FILE = path.join(repoRoot, 'V2', 'GO_LIVE_READINESS.md');

function parseChecklist(md) {
  const lines = md.split(/\r?\n/);
  const phases = [];
  let current = null;

  for (const line of lines) {
    const phaseMatch = line.match(/^##\s+(Phase\s+(\d+)\s*(?:—|-|:)\s*.+)$/i);
    if (phaseMatch) {
      if (current) phases.push(current);
      current = { name: phaseMatch[1], number: Number(phaseMatch[2]), items: [] };
      continue;
    }

    const taskMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch && current) {
      current.items.push({
        done: taskMatch[1].toLowerCase() === 'x',
        text: taskMatch[2].trim(),
      });
    }
  }

  if (current) phases.push(current);
  return phases;
}

function line(items) {
  if (!items.length) return '- None';
  return items.map((it) => `- [ ] ${it.phase}: ${it.text}`).join('\n');
}

function run() {
  const md = fs.readFileSync(TASKS_FILE, 'utf8');
  const phases = parseChecklist(md);
  const all = phases.flatMap((p) => p.items.map((i) => ({ phase: p.name, number: p.number, ...i })));

  const preCutoverBlockers = all.filter((i) => !i.done && i.number <= 8);
  const postCutoverFollowups = all.filter((i) => !i.done && i.number >= 9);

  const report = `# Go-Live Readiness Gap Report\n\n` +
    `Generated: ${new Date().toISOString()}\n\n` +
    `## Summary\n` +
    `- Pre-cutover blockers (Phase 0-8): **${preCutoverBlockers.length}**\n` +
    `- Post-cutover follow-ups (Phase 9+): **${postCutoverFollowups.length}**\n\n` +
    `## Pre-cutover blockers (must be resolved before production go-live)\n${line(preCutoverBlockers)}\n\n` +
    `## Post-cutover follow-ups\n${line(postCutoverFollowups)}\n\n` +
    `## Execution commands\n` +
    `\`node V2/scripts/update-migration-progress.mjs\`\n\n` +
    `\`PHASE8_BASE=\"https://p2p-tracker.taheito26.workers.dev\" PHASE8_USER_ID=\"compat:phase8-autokick\" node V2/scripts/phase8-autokick.mjs\`\n`;

  fs.writeFileSync(OUT_FILE, report);

  console.log(`[go-live-gap] pre-cutover blockers=${preCutoverBlockers.length}`);
  console.log(`[go-live-gap] post-cutover follow-ups=${postCutoverFollowups.length}`);
  console.log(`[go-live-gap] report written: ${path.relative(repoRoot, OUT_FILE)}`);

  process.exitCode = preCutoverBlockers.length === 0 ? 0 : 2;
}

run();
