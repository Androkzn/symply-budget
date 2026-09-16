/**
 * House V2 local-first CSV export (plan §10, stage H9).
 *
 * Reads the on-device ledger only — no network, no server round trip. Ported
 * from `budget/local/export/budgetLedgerExport.ts`, including the one thing in
 * that file that is a security control rather than formatting: `escapeCsvCell`'s
 * neutralization of cells beginning with `=`, `+`, `-` or `@`, which is what
 * stops a task title like `=cmd|'/c calc'!A1` from executing when the member
 * opens the export in Excel or Sheets.
 *
 * **Where this deliberately diverges from Budget's.** Budget hand-writes one
 * `buildXCsv` per table — 13 of them, each naming its columns. House has 21
 * Wave-A tables and its widest row has 58 columns, so hand-writing them would be
 * ~1,200 lines of column lists that drift silently the moment a Wave-B table
 * lands. Instead the section list is driven from `HOUSE_LEDGER_TABLE_NAMES` (the
 * registry that already exists to be the single source of truth for "which
 * tables are device-authoritative"), and columns are derived from the rows
 * themselves via a stable union of their keys.
 *
 * The trade that makes that safe: `houseLedgerExport.test.ts` asserts the
 * section list equals the registry exactly, so **a table added to the ledger and
 * not to the export fails the build** rather than quietly exporting nothing.
 * That is the property the hand-written version could not give.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import type { HouseLedger } from '../engine';
import { getLocalHouseLedger, isLocalHouseSessionOpen } from '../engine';
import { HouseLocalNotReadyError } from '../errors';
import { HOUSE_LEDGER_PHYSICAL_TABLES, HOUSE_LEDGER_TABLE_NAMES } from '../schema';
import type { HouseLedgerTableName } from '../schema';

export const HOUSE_EXPORT_FORMAT = 'symply-house-ledger-csv';
export const HOUSE_EXPORT_VERSION = 1;

export type HouseExportStatus = 'shared' | 'unsupported' | 'failed';

export interface HouseExportResult {
  status: HouseExportStatus;
  message: string;
  /** Data rows across all sections, excluding headers. */
  rows: number;
}

export interface HouseLedgerCsvFile {
  name: string;
  content: string;
  rowCount: number;
}

export interface HouseLedgerCsvBundle {
  format: typeof HOUSE_EXPORT_FORMAT;
  version: typeof HOUSE_EXPORT_VERSION;
  exportedAt: string;
  householdId: string;
  propertyName: string;
  files: HouseLedgerCsvFile[];
}

export const HOUSE_EXPORT_FAILED_MESSAGE =
  'We could not put your export together just now. Try again in a moment.';

/**
 * Neutralize spreadsheet formula injection.
 *
 * Not cosmetic: House rows carry free text a member typed (task titles, notes,
 * space names), and a leading `=`/`+`/`-`/`@` is executed as a formula by Excel,
 * Numbers and Google Sheets on open. Prefixing with `'` renders the literal text
 * and executes nothing.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'object') {
    // Nested shapes exist in the ledger (task photos, author refs). JSON keeps
    // them inspectable instead of exporting "[object Object]".
    try {
      text = JSON.stringify(value);
    } catch {
      text = '';
    }
  } else {
    text = String(value);
  }
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Stable column set for a table.
 *
 * Union across rows, not just the first row: local-first rows are sparse —
 * a column added in a later app version is absent from rows written by an older
 * one, and keying off row zero would drop it for every row in the file. Ordered
 * by first appearance so `id` leads and the file stays diffable between exports.
 */
export function columnsFor(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  const seen: string[] = [];
  const known = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!known.has(key)) {
        known.add(key);
        seen.push(key);
      }
    }
  }
  return seen;
}

function rowsOf(ledger: HouseLedger, table: HouseLedgerTableName): Record<string, unknown>[] {
  const value = (ledger as unknown as Record<string, unknown>)[table];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export function buildTableCsv(ledger: HouseLedger, table: HouseLedgerTableName): string {
  const rows = rowsOf(ledger, table);
  const columns = columnsFor(rows);
  if (columns.length === 0) {
    // An empty table still gets a section, with the key column as its header —
    // a missing section reads as "this feature has no export", which is a
    // different and wrong message.
    return toCsv(['id'], []);
  }
  return toCsv(
    columns,
    rows.map((row) => columns.map((c) => row[c])),
  );
}

function countDataRows(csv: string): number {
  const lines = csv.trimEnd().split('\n');
  return Math.max(0, lines.length - 1);
}

/**
 * Section file name — the PHYSICAL table name, so a reader can match a section
 * to D1 and to the schema docs.
 *
 * **Disambiguated when the physical name is not unique.** Physical-table
 * uniqueness holds across Wave A but stops being an invariant at Wave B: the S1
 * collision means `checklist_items` is claimed by both the recurring-checklist
 * pair and the labor-hub pair. Naming both sections `checklist_items.csv` would
 * silently produce two sections with one name — a consumer keying by file name
 * keeps whichever it read last, and a member opening the export sees one of
 * their two checklist tables simply missing. Falling back to the ledger name is
 * ugly and unambiguous, which is the right trade for an export.
 */
export function sectionFileName(table: HouseLedgerTableName): string {
  const physical = HOUSE_LEDGER_PHYSICAL_TABLES[table];
  const claimants = (Object.keys(HOUSE_LEDGER_PHYSICAL_TABLES) as HouseLedgerTableName[]).filter(
    (name) => HOUSE_LEDGER_PHYSICAL_TABLES[name] === physical,
  );
  if (claimants.length > 1) {
    return `${physical}__${table}.csv`;
  }
  return `${physical}.csv`;
}

export function buildHouseLedgerCsvBundle(
  ledger: HouseLedger,
  options: { exportedAt: string },
): HouseLedgerCsvBundle {
  const files = HOUSE_LEDGER_TABLE_NAMES.map((table) => {
    const content = buildTableCsv(ledger, table);
    return { name: sectionFileName(table), content, rowCount: countDataRows(content) };
  });

  return {
    format: HOUSE_EXPORT_FORMAT,
    version: HOUSE_EXPORT_VERSION,
    exportedAt: options.exportedAt,
    householdId: ledger.household.id,
    propertyName: ledger.household.name,
    files,
  };
}

/** One shareable text file with labeled CSV sections (no zip dependency). */
export function renderHouseLedgerExportText(bundle: HouseLedgerCsvBundle): string {
  const header = [
    `# ${HOUSE_EXPORT_FORMAT} v${HOUSE_EXPORT_VERSION}`,
    `# household_id=${bundle.householdId}`,
    `# property=${bundle.propertyName}`,
    `# exported_at=${bundle.exportedAt}`,
    `# One section per ledger table. Dates are ISO-8601.`,
    '',
  ].join('\n');

  const body = bundle.files
    .map((file) => `===== ${file.name} =====\n${file.content.trimEnd()}\n`)
    .join('\n');

  return `${header}${body}`;
}

export function totalExportedCsvRows(bundle: HouseLedgerCsvBundle): number {
  return bundle.files.reduce((sum, f) => sum + f.rowCount, 0);
}

/**
 * File name carries the property, because H5 means a member can hold 1–3 of
 * them and three files called `symply-house-2026-08-13.csv.txt` in a Files
 * folder are indistinguishable.
 */
export function houseExportFileName(
  propertyName: string,
  day: string = new Date().toISOString().slice(0, 10),
): string {
  const slug =
    propertyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'home';
  return `symply-house-${slug}-${day}.csv.txt`;
}

/**
 * Build CSV from the open local ledger and hand it to the OS share sheet.
 *
 * Exports the ACTIVE property only. Exporting all of them into one file would
 * merge rows from separate households whose ids only coincidentally differ, and
 * Q15 already settled the equivalent question for backups: one archive per
 * property.
 */
export async function exportHouseLedgerCsv(): Promise<HouseExportResult> {
  if (!isLocalHouseSessionOpen()) {
    throw new HouseLocalNotReadyError();
  }

  let text: string;
  let rows: number;
  let fileName: string;
  try {
    const ledger = getLocalHouseLedger();
    const bundle = buildHouseLedgerCsvBundle(ledger, { exportedAt: new Date().toISOString() });
    rows = totalExportedCsvRows(bundle);
    text = renderHouseLedgerExportText(bundle);
    fileName = houseExportFileName(bundle.propertyName);
  } catch {
    return { status: 'failed', message: HOUSE_EXPORT_FAILED_MESSAGE, rows: 0 };
  }

  const path = `${FileSystem.cacheDirectory ?? ''}${fileName}`;
  try {
    await FileSystem.writeAsStringAsync(path, text);
  } catch {
    return { status: 'failed', message: HOUSE_EXPORT_FAILED_MESSAGE, rows };
  }

  try {
    if (!(await Sharing.isAvailableAsync())) {
      return {
        status: 'unsupported',
        message: 'This device has no way to share files, so the export could not be handed over.',
        rows,
      };
    }
    await Sharing.shareAsync(path, {
      mimeType: 'text/plain',
      UTI: 'public.plain-text',
      dialogTitle: 'Export home data (CSV)',
    });
    return {
      status: 'shared',
      message:
        rows === 0
          ? 'Your export is ready. There is nothing in this home yet, so the file is mostly headers.'
          : `Your export is ready — ${rows} row${rows === 1 ? '' : 's'}.`,
      rows,
    };
  } catch {
    return { status: 'failed', message: HOUSE_EXPORT_FAILED_MESSAGE, rows };
  } finally {
    // The export is plaintext household data sitting in a cache dir — remove it
    // as soon as the share sheet is done with it, whatever the outcome.
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
  }
}
