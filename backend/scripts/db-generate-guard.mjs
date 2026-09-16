#!/usr/bin/env node
/**
 * Fail if drizzle.config.ts schema glob is incomplete vs src/db/schema*.ts files.
 * Prevents catastrophic wrong diffs from `drizzle-kit generate` (DATA-7 / B8).
 *
 * `--advisory` prints the same report but exits 0.
 *
 * The glob is incomplete on purpose and has been for a long time: there are 156
 * migrations and ONE journal entry, because everything after 0000 was written
 * as hand SQL and never registered with drizzle-kit. Widen the glob and the
 * next `generate` diffs all 35 schema files against migration 0000's snapshot
 * and emits one migration that recreates the whole database over live data —
 * the exact catastrophe this guard is named for. So the incompleteness is the
 * safe state, not a bug to be cleared.
 *
 * Which makes an unconditional CI failure the wrong shape. It fired on every
 * backend PR whether or not one went near drizzle, and a check that is always
 * red teaches people to merge past red — including past this one, on the day it
 * finally means something. Run it advisory by default in CI and enforcing only
 * where it can actually bite: a PR that adds a drizzle-GENERATED migration.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const advisory = process.argv.includes('--advisory');

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..');
const dbDir = join(backendRoot, 'src/db');
const configPath = join(backendRoot, 'drizzle.config.ts');

const configSource = readFileSync(configPath, 'utf8');
const schemaMatch = configSource.match(/schema:\s*([^,]+),/);
if (!schemaMatch) {
  console.error('error: could not parse schema entry in drizzle.config.ts');
  process.exit(1);
}

const schemaEntry = schemaMatch[1].trim();
const schemaFiles = readdirSync(dbDir)
  .filter((name) => name.startsWith('schema') && name.endsWith('.ts'))
  .sort();

const covered = new Set();

if (schemaEntry.includes('schema*.ts') || schemaEntry.includes('schema-*.ts')) {
  for (const file of schemaFiles) covered.add(file);
} else {
  const quoted = [...schemaEntry.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const pattern of quoted) {
    const normalized = pattern.replace(/^\.\//, '');
    if (normalized.endsWith('*.ts') || normalized.includes('*')) {
      const prefix = normalized.replace(/\*.*$/, '');
      for (const file of schemaFiles) {
        if (`src/db/${file}`.startsWith(prefix) || file.startsWith(prefix.replace('src/db/', ''))) {
          covered.add(file);
        }
      }
    } else {
      const base = normalized.split('/').pop();
      if (base && schemaFiles.includes(base)) covered.add(base);
    }
  }
}

const missing = schemaFiles.filter((file) => !covered.has(file));
if (missing.length === 0) {
  console.log(`db:generate:guard OK — ${schemaFiles.length} schema file(s) covered`);
  process.exit(0);
}

const say = advisory ? console.warn : console.error;
say(`${advisory ? 'warning' : 'error'}: drizzle.config.ts schema glob is incomplete.`);
say(`  config: ${schemaEntry}`);
say(`  missing (${missing.length}):`);
for (const file of missing) {
  say(`    - src/db/${file}`);
}
say('');
say('Do NOT "fix" this by widening the glob unless the journal has been rebuilt');
say('first: migrations/meta holds one entry against 156 migrations, so a generate');
say('under a full glob would emit a single migration recreating the database.');
say('Add migrations as hand-written SQL under backend/migrations/ instead.');
if (advisory) {
  say('');
  say('Advisory run — not failing. This PR adds no drizzle-generated migration.');
  process.exit(0);
}
process.exit(1);
