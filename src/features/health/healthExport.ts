import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { healthApi, type HealthSyncDelta } from '@api/health';

import { todayDateKey } from './healthLocalStorage';

/**
 * Symply Health — "Export my data".
 *
 * The donor shipped this row with an empty body (`// Export functionality` in
 * `MainTabView.swift`), so there is no donor behaviour to copy — only the
 * promise the row makes. This is the real thing: the member's OWN records,
 * every bucket the account holds, handed to the OS share sheet as one file.
 *
 * ## Why the sync delta is the source
 *
 * `GET /health/sync?since=<epoch>` is the only endpoint that returns the WHOLE
 * account in one round trip — twenty buckets, from weight and nutrition through
 * cycle, vitality, injuries, recipes and files. Every other route is a slice.
 * Walking twenty endpoints instead would be twenty chances to half-export, and
 * would drift the moment a bucket is added to the pull.
 *
 * It is also a READ of the caller's own rows and nothing else: `user_id` comes
 * from the token server-side, so there is no way to widen this to someone else's
 * data even by accident.
 *
 * ## What the file does NOT contain, and why the doc says so out loud
 *
 *  - **Tombstones.** Rows the member deleted are filtered out. They are in the
 *    delta (that is how a delete propagates between devices) but exporting them
 *    would hand back records the member believes they erased.
 *  - **The AI coach transcript.** It is deliberately never stored server-side
 *    (see `healthCoachStorage`), so it is not in the delta. Saying so in the
 *    file is the honest alternative to a silent gap.
 *  - **File BYTES.** `user_files` rows carry metadata; the objects themselves
 *    live in R2 behind an ownership-checked path. A JSON export cannot embed
 *    them, so the manifest is exported and the omission is stated.
 */

/* ==================================================================== */
/* Document shape                                                        */
/* ==================================================================== */

export const HEALTH_EXPORT_FORMAT = 'symply-health-export';
export const HEALTH_EXPORT_VERSION = 1;

/** Everything, from the first row ever written. */
export const HEALTH_EXPORT_SINCE = '1970-01-01T00:00:00.000Z';

/**
 * Bucket keys copied into the document, in the order they appear in the file.
 *
 * An explicit list rather than `Object.keys(delta)`: the delta also carries
 * `since` / `server_time`, and a future bucket must be a deliberate addition —
 * an export that silently grows is an export nobody has reviewed.
 */
export const HEALTH_EXPORT_BUCKETS = [
  'weight_entries',
  'water_entries',
  'nutrition_entries',
  'body_measurements',
  'health_entries',
  'habits',
  'habit_logs',
  'period_entries',
  'cycle_symptom_entries',
  'mens_health_entries',
  'cycle_settings',
  'health_goals',
  'mens_health_settings',
  'widget_preferences',
  'activity_notification_preferences',
  'custom_foods',
  'recipes',
  'injuries',
  'fridge_items',
  'user_files',
] as const;
export type HealthExportBucket = (typeof HEALTH_EXPORT_BUCKETS)[number];

export interface HealthExportDocument {
  format: typeof HEALTH_EXPORT_FORMAT;
  version: number;
  app: string;
  /** ISO stamp taken on the DEVICE at export time. */
  exported_at: string;
  /** The server's own clock at the moment of the read, when it sent one. */
  server_time: string | null;
  /** Plain-language statements about what is and is not in this file. */
  notes: string[];
  counts: Record<HealthExportBucket, number>;
  data: Record<HealthExportBucket, unknown[]>;
}

export const HEALTH_EXPORT_NOTES: readonly string[] = [
  'This file holds the health records stored in your Symply Health account.',
  'Records you deleted are not included.',
  'Your AI coach conversation is not included: it is kept only on your device and is never stored on the server.',
  'Uploaded files are listed by name and type. The images and documents themselves are not inside this file.',
];

/* ==================================================================== */
/* Pure builder                                                          */
/* ==================================================================== */

function isTombstoned(row: unknown): boolean {
  if (row === null || typeof row !== 'object') return false;
  const deletedAt = (row as { deleted_at?: unknown }).deleted_at;
  return typeof deletedAt === 'string' && deletedAt.length > 0;
}

/**
 * Delta → export document. Pure, so the shape can be reasoned about (and later
 * asserted) without a network, a file system or a share sheet.
 */
export function buildHealthExport(
  delta: Partial<HealthSyncDelta> | null | undefined,
  options: { exportedAt: string; appName?: string }
): HealthExportDocument {
  const source = (delta ?? {}) as Record<string, unknown>;
  const data = {} as Record<HealthExportBucket, unknown[]>;
  const counts = {} as Record<HealthExportBucket, number>;

  for (const bucket of HEALTH_EXPORT_BUCKETS) {
    const rows = source[bucket];
    // A Worker older than the bucket omits the key entirely; an empty array is
    // the honest rendering of "this account has none", and both read the same.
    const live = Array.isArray(rows) ? rows.filter((row) => !isTombstoned(row)) : [];
    data[bucket] = live;
    counts[bucket] = live.length;
  }

  return {
    format: HEALTH_EXPORT_FORMAT,
    version: HEALTH_EXPORT_VERSION,
    app: options.appName ?? 'Symply Health',
    exported_at: options.exportedAt,
    server_time: typeof source.server_time === 'string' ? source.server_time : null,
    notes: [...HEALTH_EXPORT_NOTES],
    counts,
    data,
  };
}

/** Total rows in a built document — what the confirmation message reports. */
export function totalExportedRows(doc: HealthExportDocument): number {
  return Object.values(doc.counts).reduce((sum, count) => sum + count, 0);
}

/** `symply-health-2026-07-26.json` — dated, so repeated exports do not collide. */
export function healthExportFileName(day: string = todayDateKey()): string {
  return `symply-health-${day}.json`;
}

/* ==================================================================== */
/* The verb                                                              */
/* ==================================================================== */

export type HealthExportStatus = 'shared' | 'unsupported' | 'failed';

export interface HealthExportResult {
  status: HealthExportStatus;
  /** Friendly copy for the UI. NEVER a system or network error string. */
  message: string;
  rows: number;
}

export const HEALTH_EXPORT_FAILED_MESSAGE =
  'We could not put your export together just now. Check your connection and try again.';

/**
 * Pull everything, write one JSON file, hand it to the share sheet.
 *
 * The file is written to the app's CACHE directory and deleted once the sheet
 * closes: a complete health record sitting in app storage forever is a leak
 * waiting for a shared handset, and by the time `shareAsync` resolves the
 * destination the member chose already has its own copy.
 */
export async function exportHealthData(): Promise<HealthExportResult> {
  let doc: HealthExportDocument;
  try {
    const delta = await healthApi.sync(HEALTH_EXPORT_SINCE);
    doc = buildHealthExport(delta, { exportedAt: new Date().toISOString() });
  } catch {
    return { status: 'failed', message: HEALTH_EXPORT_FAILED_MESSAGE, rows: 0 };
  }

  const rows = totalExportedRows(doc);
  const path = `${FileSystem.cacheDirectory ?? ''}${healthExportFileName()}`;

  try {
    await FileSystem.writeAsStringAsync(path, JSON.stringify(doc, null, 2));
  } catch {
    return { status: 'failed', message: HEALTH_EXPORT_FAILED_MESSAGE, rows };
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
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Export my health data',
    });
    return {
      status: 'shared',
      message:
        rows === 0
          ? 'Your export is ready. There are no health records in your account yet, so the file is empty.'
          : `Your export is ready — ${rows} record${rows === 1 ? '' : 's'}.`,
      rows,
    };
  } catch {
    return { status: 'failed', message: HEALTH_EXPORT_FAILED_MESSAGE, rows };
  } finally {
    // Best effort: a failure here leaves a file in the app's own cache, which
    // the OS reclaims — but never leave it on purpose.
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
  }
}
