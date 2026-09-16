/**
 * Two ways the complete table registry silently breaks, both guarded here.
 *
 * ## 1. A new `schema-*.ts` nobody imports
 *
 * `all-tables.ts` lists its modules by hand, because namespace imports are the
 * only way past the seven symbol collisions between these files. A hand list
 * rots: someone adds `schema-foo.ts`, never touches `all-tables.ts`, and every
 * table in it becomes invisible to account deletion — which then reports
 * success while retaining the data. That is not hypothetical. The first version
 * of `all-tables.ts` missed six files (`home-projects`, `household-notes`,
 * `neighbours`, `queue-ops`, `settings`, `wishes`) on the pass that wrote it.
 *
 * A sweep cannot fail on a table it cannot see, so the only place this can be
 * caught is here.
 *
 * ## 2. Somebody points drizzle-kit at the complete file
 *
 * `drizzle.config.ts` must keep `schema: './src/db/schema.ts'`. That barrel is
 * incomplete ON PURPOSE — see `scripts/db-generate-guard.mjs`: 156 migrations,
 * one journal entry, so widening what drizzle-kit sees makes the next
 * `generate` diff everything against migration 0000 and emit a single migration
 * that recreates the database. Two schema entry points is exactly the shape
 * that invites a tidy-up, and the tidy-up is the catastrophe.
 */
import { getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';

import { allTables } from '../all-tables';
import * as schema from '../schema';

describe('all-tables registry', () => {
  // The "is every schema file imported" check reads the filesystem, which
  // workerd's fs proxy cannot do for this repo's spaced path (see the note in
  // vitest.config.ts). It lives in `scripts/all-tables-guard.mjs` instead, run
  // in Node where the path resolves — the same split `db-generate-guard.mjs`
  // already uses.
  it('holds the whole fleet, not a subset', () => {
    // 244 today. A floor rather than an exact number so adding tables does not
    // fail the suite, while a regression to the 94-table barrel does.
    expect(allTables().length).toBeGreaterThanOrEqual(240);
  });

  it('sees materially more tables than the partial barrel', () => {
    // The barrel exposed 94 tables; the registry exposes 244. If these ever
    // converge, either the barrel was widened (dangerous — see above) or the
    // registry regressed to reading it.
    const barrel = Object.values(schema).filter((v) => is(v, SQLiteTable)).length;
    const complete = allTables().length;
    expect(complete).toBeGreaterThan(barrel);
  });

  it('returns each table once, so a sweep cannot double-count', () => {
    // Most tables are reachable through BOTH `schema.ts` and their own file.
    // Without de-duplication the sweep would delete from each twice and report
    // double the rows it actually removed.
    const names = allTables().map((table) => getTableName(table));
    expect(new Set(names).size).toBe(names.length);
  });
});

