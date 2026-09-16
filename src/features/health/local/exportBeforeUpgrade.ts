/**
 * Export-before-upgrade — the artefact that makes He3's data discontinuity
 * survivable (plan §1.3a). A **He3a Exit**, shipped in the same merge as the
 * Proxy.
 *
 * ## The product fact this exists for
 *
 * > **V2 does not migrate Health D1 history onto devices. A device that takes
 * > the flag-1 build begins with an empty ledger** — weight, water, meals,
 * > workouts/sleep, body, habits and goals all start at zero.
 *
 * That is acceptable only because Q1 asserts zero real users. This file is the
 * compensating control if that assertion is ever wrong: the member's D1 history,
 * handed to them as a file, before the app stops reading D1.
 *
 * ## Why it does NOT go through `healthApi`
 *
 * The plan's ordering is normative and the failure it describes is the whole
 * reason this is a separate module:
 *
 * > it must read D1 **directly, bypassing the `src/api/health.ts` Proxy**, and
 * > must be offered and completed **before** the binary sends its first
 * > `X-Health-Local-First` header … The CSV ships in the **same merge** as the
 * > Proxy, so an engineer who wires it through the new `healthApi` gets an
 * > export of the **empty local ledger**: the one artefact that makes data loss
 * > survivable produces zero rows, and nobody notices because it "works".
 *
 * So: `remoteHealthApi`, never `healthApi`. And a hard refusal — not a warning —
 * when the header is already armed, because by then BOTH available answers are
 * wrong. Through the Proxy the export would be the empty ledger; around it, D1
 * answers 410 because the gate is armed. `assertExportWindowOpen()` turns that
 * pair of silent wrongs into one loud, early failure.
 *
 * ## Why CSV rather than the JSON `exportHealthData()` already produces
 *
 * Different artefact, different job. `healthExport.ts` is the standing "Export
 * my data" feature — a complete, machine-readable account dump. This is a
 * one-time rescue file a member may need to READ, in a spreadsheet, to re-enter
 * what mattered. It is sectioned per bucket with real header rows for that
 * reason. It also deliberately covers only what the upgrade drops: the eight
 * Wave A tables (plan §1.5). Wave B/C/D data stays server-authoritative across
 * the cutover and is not at risk, so including it would pad the file with rows
 * that are not going anywhere.
 */
import type { HealthSyncDelta } from '@api/health';
import { remoteHealthApi } from '@api/health';

import { isHealthLocalFirstHeaderArmed } from './sync/headers';

/* ==================================================================== */
/* Copy                                                                  */
/* ==================================================================== */

/**
 * First-launch data-continuity copy (plan §1.3a) — verbatim, and a He3a Exit.
 *
 * Kept as an exported constant rather than inlined in a screen so the wording
 * is greppable and testable. It states the loss plainly; softening it into
 * "some data may not appear" would be the kind of hedge that reads as a bug
 * report rather than an intended change.
 */
export const HEALTH_DATA_CONTINUITY_COPY =
  'Symply Health now stores your data on this device. ' +
  'Entries made before this update are not carried over.';

/** Offered alongside the copy, so the notice is actionable rather than final. */
export const HEALTH_EXPORT_BEFORE_UPGRADE_CTA = 'Download my previous data';

/* ==================================================================== */
/* Scope                                                                 */
/* ==================================================================== */

/**
 * The eight Wave A buckets, as the sync delta names them (plan §1.5).
 *
 * `habits` is the delta's key for `user_habits`. This list is intentionally NOT
 * derived from `HEALTH_LEDGER_TABLE_KEYS`: those are ledger names
 * (`nutritionEntries`), these are wire names (`nutrition_entries`), and a
 * mechanical mapping between them would be one more thing to get wrong in the
 * file whose entire purpose is not being wrong once.
 */
export const HEALTH_WAVE_A_EXPORT_BUCKETS = [
  'weight_entries',
  'water_entries',
  'nutrition_entries',
  'health_entries',
  'body_measurements',
  'habits',
  'habit_logs',
  'health_goals',
] as const;

export type HealthWaveAExportBucket = (typeof HEALTH_WAVE_A_EXPORT_BUCKETS)[number];

/* ==================================================================== */
/* Guard                                                                 */
/* ==================================================================== */

export class HealthExportWindowClosedError extends Error {
  constructor() {
    super(
      'The export window has closed: this device has already declared local-first ' +
        'authority, so D1 can no longer be read. Export before opening the ledger.',
    );
    this.name = 'HealthExportWindowClosedError';
  }
}

/**
 * The §1.3a ordering, enforced rather than documented.
 *
 * Call before any network read. Once `ensureHealthLocalSession()` has armed the
 * header, D1 answers 410 and the ledger is empty — there is no correct export
 * left to produce, and producing an empty one silently is the exact failure the
 * plan calls out.
 */
export function assertExportWindowOpen(): void {
  if (isHealthLocalFirstHeaderArmed()) throw new HealthExportWindowClosedError();
}

/* ==================================================================== */
/* CSV rendering                                                         */
/* ==================================================================== */

/** RFC 4180 — quote when the value holds a comma, quote, CR or LF. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Union of keys across the bucket's rows, first-seen order.
 *
 * A union rather than `Object.keys(rows[0])`: D1 rows are sparse — a Worker
 * older than a column omits it — so keying off the first row alone silently
 * truncates every later row that carries more.
 */
function columnsOf(rows: readonly Record<string, unknown>[]): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

function isTombstoned(row: unknown): boolean {
  return Boolean((row as { deleted_at?: string | null } | null)?.deleted_at);
}

/**
 * One CSV, one section per bucket.
 *
 * Tombstoned rows are dropped, matching `healthExport.ts`: they are in the delta
 * because that is how a delete propagates, but handing back records the member
 * believes they erased is not an export, it is a resurrection.
 *
 * An empty bucket still gets its header line, so "you had no body measurements"
 * and "body measurements were not exported" are distinguishable in the file
 * itself — the difference matters to someone reading this after losing data.
 */
export function buildWaveACsv(
  delta: Partial<HealthSyncDelta> | null | undefined,
  options: { exportedAt: string },
): { csv: string; rows: number } {
  const source = (delta ?? {}) as Record<string, unknown>;
  const lines: string[] = [
    `# Symply Health — your data before the on-device upgrade`,
    `# Exported ${options.exportedAt}`,
    `# ${HEALTH_DATA_CONTINUITY_COPY}`,
  ];
  let total = 0;

  for (const bucket of HEALTH_WAVE_A_EXPORT_BUCKETS) {
    const raw = source[bucket];
    const rows = (Array.isArray(raw) ? raw : []).filter(
      (row) => !isTombstoned(row),
    ) as Record<string, unknown>[];
    total += rows.length;

    lines.push('', `# ${bucket} (${rows.length} rows)`);
    const columns = columnsOf(rows);
    if (columns.length === 0) {
      lines.push('(no rows)');
      continue;
    }
    lines.push(columns.map(csvCell).join(','));
    for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(','));
  }

  return { csv: `${lines.join('\n')}\n`, rows: total };
}

/** `symply-health-before-upgrade-2026-08-14.csv` — dated, so repeats collide. */
export function exportBeforeUpgradeFileName(day: string): string {
  return `symply-health-before-upgrade-${day}.csv`;
}

/* ==================================================================== */
/* The verb                                                              */
/* ==================================================================== */

export interface ExportBeforeUpgradeResult {
  csv: string;
  rows: number;
  fileName: string;
}

/**
 * Read the whole account from D1 and render it as CSV.
 *
 * Returns the bytes rather than sharing them: the caller owns presentation, and
 * keeping this function I/O-free above the network makes the header-absent
 * assertion in `exportBeforeUpgrade.test.ts` a direct test of the export path
 * rather than of a mock file system.
 *
 * `HEALTH_EXPORT_SINCE`-equivalent epoch start: everything, from the first row
 * ever written.
 */
export async function exportHealthBeforeUpgrade(options?: {
  now?: Date;
}): Promise<ExportBeforeUpgradeResult> {
  assertExportWindowOpen();

  const now = options?.now ?? new Date();
  // `remoteHealthApi`, NEVER `healthApi` — see the file header.
  const delta = await remoteHealthApi.sync('1970-01-01T00:00:00.000Z');
  const { csv, rows } = buildWaveACsv(delta, { exportedAt: now.toISOString() });

  return { csv, rows, fileName: exportBeforeUpgradeFileName(now.toISOString().slice(0, 10)) };
}
