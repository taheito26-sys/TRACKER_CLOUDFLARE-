#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const TASKS_FILE = path.join(repoRoot, 'V2', 'MIGRATION_TASKS.md');
const STATUS_FILE = path.join(repoRoot, 'V2', 'MIGRATION_EXECUTION_STATUS.md');

function writeFileWithRetryAtomic(targetFile, content, { attempts = 4 } = {}) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const tempFile = `${targetFile}.tmp-${process.pid}-${Date.now()}-${i}`;
      fs.writeFileSync(tempFile, content, 'utf8');
      fs.renameSync(tempFile, targetFile);
      return;
    } catch (err) {
      lastErr = err;
      const code = err?.code || 'UNKNOWN';
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(code)) throw err;
    }
  }

  const fallback = `${targetFile}.pending.md`;
  fs.writeFileSync(fallback, content, 'utf8');
  throw new Error(
    `Could not update ${path.relative(repoRoot, targetFile)} after ${attempts} attempts (${lastErr?.code || 'UNKNOWN'}). ` +
    `Fallback written to ${path.relative(repoRoot, fallback)}.`
  );
}

function progressBar(percent, width = 24) {
  const filled = Math.round((percent / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

function parseTasksByPhase(md) {
  const lines = md.split(/\r?\n/);
  const phases = [];
  let current = null;

  for (const line of lines) {
    const phaseMatch = line.match(/^##\s+(Phase\s+\d+\s*(?:—|-|:)\s*.+)$/i);
    if (phaseMatch) {
      if (current) phases.push(current);
      current = { name: phaseMatch[1], total: 0, done: 0 };
      continue;
    }

    const taskMatch = line.match(/^-\s+\[([ xX])\]\s+/);
    if (taskMatch && current) {
      current.total += 1;
      if (taskMatch[1].toLowerCase() === 'x') current.done += 1;
    }
  }

  if (current) phases.push(current);

  const total = phases.reduce((sum, p) => sum + p.total, 0);
  const done = phases.reduce((sum, p) => sum + p.done, 0);
  const percent = total ? Math.round((done / total) * 100) : 0;

  const phaseStats = phases.map((p) => {
    const pPercent = p.total ? Math.round((p.done / p.total) * 100) : 0;
    return { ...p, percent: pPercent, bar: progressBar(pPercent, 16) };
  });

  return { total, done, percent, phaseStats };
}

function renderPerPhase(stats) {
  return stats.phaseStats
    .map((p) => `- **${p.name}:** ${p.done}/${p.total} (${p.percent}%)  \`${p.bar}\``)
    .join('\n');
}

function updateStatusFile(content, overallLine, perPhaseBlock) {
  const start = '<!-- PROGRESS_BAR_START -->';
  const end = '<!-- PROGRESS_BAR_END -->';
  const block = `${start}\n${overallLine}\n\n${perPhaseBlock}\n${end}`;
  if (content.includes(start) && content.includes(end)) {
    return content.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
  }
  return content.replace(/^# V2 Migration Execution Status\n\n/m, `# V2 Migration Execution Status\n\n${block}\n\n`);
}

const tasks = fs.readFileSync(TASKS_FILE, 'utf8');
const stats = parseTasksByPhase(tasks);
const overallLine = `**Overall Progress:** ${stats.done}/${stats.total} tasks (${stats.percent}%)  \`${progressBar(stats.percent)}\``;
const perPhaseBlock = `**Per-Phase Progress**\n${renderPerPhase(stats)}`;

const status = fs.readFileSync(STATUS_FILE, 'utf8');
const updatedStatus = updateStatusFile(status, overallLine, perPhaseBlock);
writeFileWithRetryAtomic(STATUS_FILE, updatedStatus);

console.log(`[progress] overall ${stats.done}/${stats.total} (${stats.percent}%)`);
for (const p of stats.phaseStats) {
  console.log(`[progress] ${p.name}: ${p.done}/${p.total} (${p.percent}%)`);
}
console.log('[progress] wrote V2/MIGRATION_EXECUTION_STATUS.md');
