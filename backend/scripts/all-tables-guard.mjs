#!/usr/bin/env node
/**
 * Fail if `src/db/all-tables.ts` has fallen behind the schema files on disk,
 * or if drizzle-kit has been pointed at it.
 *
 * ## Why this is a script and not a vitest test
 *
 * Backend tests run inside workerd, whose fs proxy cannot read this repo's
 * spaced path — spaces become `%20` and every read is ENOENT (the same note
 * appears at the top of `vitest.config.ts`). Structural checks that must read
 * the source tree therefore live here, in Node, exactly as
 * `db-generate-guard.mjs` does. The runtime invariants that CAN run in-worker
 * are in `src/db/__tests__/all-tables.guard.test.ts`.
 *
 * ## Check 1 — every schema file is registered
 *
 * `all-tables.ts` lists its modules by hand, because seven symbols collide
 * across the schema files and namespace imports are the only way past that. A
 * hand list rots silently: add `schema-foo.ts`, forget this file, and every
 * table in it becomes invisible to account deletion, which then reports success
 * while retaining the data. Not hypothetical — the first version of
 * `all-tables.ts` missed six files on the pass that wrote it.
 *
 * ## Check 2 — drizzle-kit still reads the PARTIAL barrel
 *
 * `drizzle.config.ts` must keep `schema: './src/db/schema.ts'`. That barrel is
 * incomplete on purpose: 156 migrations, one journal entry, so widening what
 * drizzle-kit sees makes the next `generate` diff everything against migration
 * 0000 and emit one migration that recreates the database. Having two schema
 * entry points invites a tidy-up, and the tidy-up is that catastrophe. See
 * `db-generate-guard.mjs`, which this deliberately mirrors.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = join(backendRoot, 'src/db');

const failures = [];

// ── 1. every schema-*.ts is imported by all-tables.ts ──────────────────────
const registry = readFileSync(join(dbDir, 'all-tables.ts'), 'utf8');
const onDisk = readdirSync(dbDir)
  .filter((f) => /^schema-.+\.ts$/.test(f))
  .map((f) => f.replace(/\.ts$/, ''))
  .sort();

const unregistered = onDisk.filter((name) => !registry.includes(`'./${name}'`));
if (unregistered.length > 0) {
  failures.push(
    `src/db/all-tables.ts does not import ${unregistered.length} schema file(s):\n` +
      unregistered.map((n) => `    ./${n}`).join('\n') +
      `\n  Account deletion cannot see those tables, and will report success while retaining their data.` +
      `\n  Add an \`import * as x from './<file>'\` and put \`x\` in MODULES.`
  );
}

// ── 2. drizzle-kit still points at the partial barrel ──────────────────────
const config = readFileSync(join(backendRoot, 'drizzle.config.ts'), 'utf8');
if (!config.includes("schema: './src/db/schema.ts'")) {
  failures.push(
    `drizzle.config.ts no longer points at './src/db/schema.ts'.\n` +
      `  The partial barrel is the SAFE state for migration diffing — see scripts/db-generate-guard.mjs.`
  );
}
if (config.includes('all-tables')) {
  failures.push(
    `drizzle.config.ts references all-tables.ts.\n` +
      `  That widens what drizzle-kit sees and makes the next \`generate\` emit a migration\n` +
      `  that recreates the whole database. all-tables.ts is for RUNTIME code only.`
  );
}

if (failures.length > 0) {
  console.error('[all-tables-guard] FAILED\n');
  for (const failure of failures) console.error(`  ${failure}\n`);
  process.exit(1);
}

console.log(
  `[all-tables-guard] ok — ${onDisk.length} schema files all registered; drizzle-kit still reads the partial barrel.`
);
