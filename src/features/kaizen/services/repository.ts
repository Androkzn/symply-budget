/**
 * Symply Life (brand `symply-kaizen`) — local repository / CRUD + sync helpers.
 *
 * Ported 1:1 from the donor Kaizen app (`Simply Kaizen/kaizen/src/services/kaizen/repository.ts`).
 * Deterministic per-day action-log ids (`actionLogId`) keep completion idempotent and match the
 * iOS Swift origin. The `dirty` flag drives offline-first delta sync and is stripped before push.
 */
import type { KaizenActionEntry, KaizenProfileEntry, KaizenTableName } from '../types';
import { KAIZEN_TABLES } from '../types';

import {
  assertKaizenTable,
  getKaizenDatabase,
  getMeta,
  setMeta,
} from './database';
import { actionLogId } from './seedId';

type Row = Record<string, unknown>;
type Upsertable = object;

function stripDirty(row: Row): Row {
  const { dirty, ...rest } = row;
  void dirty;
  return rest;
}

export async function upsertLocal(
  table: KaizenTableName,
  row: Upsertable,
  options: { dirty?: boolean } = {},
): Promise<void> {
  assertKaizenTable(table);
  const db = await getKaizenDatabase();
  const dirty = options.dirty === false ? 0 : 1;
  const payload: Row = { ...(row as Row), dirty };
  const keys = Object.keys(payload);
  const placeholders = keys.map(() => '?').join(', ');
  const updates = keys
    .filter(k => k !== 'id')
    .map(k => `${k} = excluded.${k}`)
    .join(', ');
  await db.runAsync(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updates}`,
    keys.map(k => payload[k] as string | number | null),
  );
}

export async function listActive<T extends Upsertable>(
  table: KaizenTableName,
  userId: string,
): Promise<T[]> {
  assertKaizenTable(table);
  const db = await getKaizenDatabase();
  return db.getAllAsync<T>(
    `SELECT * FROM ${table} WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
    [userId],
  );
}

export async function getDirtyChanges(userId: string): Promise<Partial<Record<KaizenTableName, Row[]>>> {
  const db = await getKaizenDatabase();
  const changes: Partial<Record<KaizenTableName, Row[]>> = {};
  for (const table of KAIZEN_TABLES) {
    const rows = await db.getAllAsync<Row>(
      `SELECT * FROM ${table} WHERE user_id = ? AND dirty = 1`,
      [userId],
    );
    if (rows.length) {
      changes[table] = rows.map(stripDirty);
    }
  }
  return changes;
}

export async function applyServerChanges(
  changes: Record<string, Row[]>,
): Promise<void> {
  for (const table of KAIZEN_TABLES) {
    const rows = changes[table];
    if (!rows?.length) continue;
    for (const row of rows) {
      await upsertLocal(table, row, { dirty: false });
    }
  }
}

export async function clearDirtyFlags(userId: string): Promise<void> {
  const db = await getKaizenDatabase();
  for (const table of KAIZEN_TABLES) {
    await db.runAsync(`UPDATE ${table} SET dirty = 0 WHERE user_id = ? AND dirty = 1`, [userId]);
  }
}

export async function getProfile(userId: string): Promise<KaizenProfileEntry | null> {
  const rows = await listActive<KaizenProfileEntry>('kaizen_profiles', userId);
  return rows[0] ?? null;
}

/**
 * Systems the user has actually opted into: present in `enabled_systems` and not
 * currently paused (`system_activation_states`). Mirrors the SystemsHub `isEnabled`
 * predicate — a missing activation state defaults to enabled.
 */
export function getActiveSystems(profile: KaizenProfileEntry | null): Set<string> {
  if (!profile) return new Set();
  let enabled: string[] = [];
  try {
    const parsed: unknown = JSON.parse(profile.enabled_systems ?? '[]');
    if (Array.isArray(parsed)) enabled = parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    enabled = [];
  }
  let states: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(profile.system_activation_states ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      states = parsed as Record<string, string>;
    }
  } catch {
    states = {};
  }
  return new Set(enabled.filter(system => (states[system] ?? 'enabled') !== 'paused'));
}

/**
 * Daily-core actions for the Today screen, gated to the user's active life-systems.
 * Actions whose system the user has not enabled (or has paused) are hidden — this
 * keeps seeded/off-system habits (e.g. a Health "Weight before breakfast") off Today
 * until the user opts into that system via onboarding / the Systems hub.
 */
export async function getDailyCoreActions(userId: string): Promise<KaizenActionEntry[]> {
  const db = await getKaizenDatabase();
  const rows = await db.getAllAsync<KaizenActionEntry>(
    `SELECT * FROM kaizen_actions
     WHERE user_id = ? AND deleted_at IS NULL AND is_archived = 0 AND is_daily_core = 1
     ORDER BY sort_order ASC, title ASC`,
    [userId],
  );
  const activeSystems = getActiveSystems(await getProfile(userId));
  return rows.filter(action => activeSystems.has(action.system));
}

export async function completeActionToday(
  userId: string,
  actionId: string,
  source: 'manual' | 'health' | 'watch' | 'notification' = 'manual',
): Promise<void> {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString();
  await upsertLocal('kaizen_action_logs', {
    id: actionLogId(actionId, now),
    user_id: userId,
    action_id: actionId,
    date,
    completed_at: timestamp,
    skipped: 0,
    skip_reason: null,
    source,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  });
}

export async function skipActionToday(
  userId: string,
  actionId: string,
  source: 'manual' | 'notification' = 'manual',
): Promise<void> {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString();
  await upsertLocal('kaizen_action_logs', {
    id: actionLogId(actionId, now),
    user_id: userId,
    action_id: actionId,
    date,
    completed_at: null,
    skipped: 1,
    skip_reason: null,
    source,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  });
}

export async function getLastSyncAt(): Promise<string | null> {
  return getMeta('last_sync_at');
}

export async function setLastSyncAt(value: string): Promise<void> {
  await setMeta('last_sync_at', value);
}

export async function softDelete(
  table: KaizenTableName,
  id: string,
): Promise<void> {
  const db = await getKaizenDatabase();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE ${table} SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    [now, now, id],
  );
}
