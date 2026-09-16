import { isTimestampBackfillEnabled } from '../services/config-flags';
import type { Env } from '../types';
import { now as nowIso } from '../utils/id';

/**
 * B10: chunked ISO timestamp backfill for legacy `datetime('now')` rows.
 *
 * Wired into `scheduled()` behind CONFIG_KV `timestamp_backfill_enabled` (**default off**).
 * Enable: `wrangler kv key put --binding CONFIG_KV --env <env> timestamp_backfill_enabled true`
 * Checkpoints live in `timestamp_backfill_checkpoints` (migration 0101).
 */
export type TimestampBackfillResult =
  | { skipped: true; reason: string }
  | { skipped: false; rowsUpdated: number; tableName: string };

export type BackfillTableConfig = {
  tableName: string;
  timestampColumns: readonly string[];
};

/** Approved scope — must match rows seeded in migration 0101. */
export const APPROVED_BACKFILL_TABLES: readonly BackfillTableConfig[] = [
  {
    tableName: 'household_spaces',
    timestampColumns: ['created_at', 'updated_at', 'deleted_at'],
  },
  {
    tableName: 'budget_items',
    timestampColumns: ['created_at', 'updated_at'],
  },
] as const;

export const DEFAULT_BACKFILL_BATCH_SIZE = 100;

/** Legacy SQLite `datetime('now')` shape — space separator, no `T`/`Z`. */
const LEGACY_SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function isLegacySqliteDatetime(value: string | null | undefined): boolean {
  if (value == null || value === '') return false;
  return LEGACY_SQLITE_DATETIME.test(value);
}

/** Rewrite `YYYY-MM-DD HH:MM:SS` → `YYYY-MM-DDTHH:MM:SS.000Z`. */
export function legacyDatetimeToIso(value: string): string {
  const [datePart, timePart] = value.split(' ');
  return `${datePart}T${timePart}.000Z`;
}

type CheckpointRow = {
  table_name: string;
  last_row_id: string | null;
  rows_updated: number;
  completed_at: string | null;
};

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function loadCheckpoint(env: Env, tableName: string): Promise<CheckpointRow | null> {
  return env.DB.prepare(
    `SELECT table_name, last_row_id, rows_updated, completed_at
     FROM timestamp_backfill_checkpoints
     WHERE table_name = ?`
  )
    .bind(tableName)
    .first<CheckpointRow>();
}

async function saveCheckpoint(
  env: Env,
  tableName: string,
  patch: {
    lastRowId: string | null;
    rowsUpdatedDelta: number;
    completedAt?: string | null;
  }
): Promise<void> {
  const ts = nowIso();
  if (patch.completedAt !== undefined) {
    await env.DB.prepare(
      `UPDATE timestamp_backfill_checkpoints
       SET last_row_id = ?, rows_updated = rows_updated + ?, completed_at = ?, updated_at = ?
       WHERE table_name = ?`
    )
      .bind(patch.lastRowId, patch.rowsUpdatedDelta, patch.completedAt, ts, tableName)
      .run();
    return;
  }

  await env.DB.prepare(
    `UPDATE timestamp_backfill_checkpoints
     SET last_row_id = ?, rows_updated = rows_updated + ?, updated_at = ?
     WHERE table_name = ?`
  )
    .bind(patch.lastRowId, patch.rowsUpdatedDelta, ts, tableName)
    .run();
}

async function pickNextTable(env: Env): Promise<BackfillTableConfig | null> {
  for (const config of APPROVED_BACKFILL_TABLES) {
    const checkpoint = await loadCheckpoint(env, config.tableName);
    if (checkpoint?.completed_at) continue;
    return config;
  }
  return null;
}

export async function runTimestampBackfillChunk(
  env: Env,
  options?: { tableName?: string; batchSize?: number }
): Promise<TimestampBackfillResult> {
  if (!(await isTimestampBackfillEnabled(env))) {
    return {
      skipped: true,
      reason: 'timestamp_backfill_enabled CONFIG_KV flag is off (default)',
    };
  }

  const batchSize = options?.batchSize ?? DEFAULT_BACKFILL_BATCH_SIZE;
  const config = options?.tableName
    ? APPROVED_BACKFILL_TABLES.find((t) => t.tableName === options.tableName)
    : await pickNextTable(env);

  if (!config) {
    return {
      skipped: true,
      reason: options?.tableName
        ? `table not in approved backfill list: ${options.tableName}`
        : 'all approved backfill tables completed',
    };
  }

  const checkpoint = await loadCheckpoint(env, config.tableName);
  if (checkpoint?.completed_at) {
    return {
      skipped: true,
      reason: `${config.tableName} backfill already completed`,
    };
  }

  const lastRowId = checkpoint?.last_row_id ?? '';
  const tableIdent = quoteIdent(config.tableName);
  const selectCols = ['id', ...config.timestampColumns].map(quoteIdent).join(', ');

  const { results: rows } = await env.DB.prepare(
    `SELECT ${selectCols}
     FROM ${tableIdent}
     WHERE id > ?
     ORDER BY id ASC
     LIMIT ?`
  )
    .bind(lastRowId, batchSize)
    .all<Record<string, string | null>>();

  if (!rows || rows.length === 0) {
    await saveCheckpoint(env, config.tableName, {
      lastRowId: checkpoint?.last_row_id ?? null,
      rowsUpdatedDelta: 0,
      completedAt: nowIso(),
    });
    return { skipped: false, rowsUpdated: 0, tableName: config.tableName };
  }

  let rowsUpdated = 0;
  let maxId = lastRowId;

  for (const row of rows) {
    const id = row.id as string;
    maxId = id;

    const assignments: string[] = [];
    const values: string[] = [];

    for (const col of config.timestampColumns) {
      const raw = row[col];
      if (!isLegacySqliteDatetime(raw)) continue;
      assignments.push(`${quoteIdent(col)} = ?`);
      values.push(legacyDatetimeToIso(raw as string));
    }

    if (assignments.length === 0) continue;

    await env.DB.prepare(
      `UPDATE ${tableIdent} SET ${assignments.join(', ')} WHERE id = ?`
    )
      .bind(...values, id)
      .run();
    rowsUpdated += 1;
  }

  const completedAt = rows.length < batchSize ? nowIso() : null;
  await saveCheckpoint(env, config.tableName, {
    lastRowId: maxId,
    rowsUpdatedDelta: rowsUpdated,
    completedAt,
  });

  return { skipped: false, rowsUpdated, tableName: config.tableName };
}
