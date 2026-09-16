/**
 * Local counterpart of `src/api/settings.ts` (6 methods) — Stage H3.
 *
 * `settings` is Tier A (plan §1.2) and it is the one Wave-A table whose id is
 * NOT random. D1 puts a business `uniqueIndex` on `(user_id, household_id,
 * key)`; the ledger has no unique index at all, so with `newLocalId` two devices
 * that both flip "notifications off" while offline would each mint a row, both
 * would survive the merge, and the member would see the same setting twice with
 * two different values and no way to tell which one the app is reading. That is
 * plan hazard S3b, and the fix is `houseDeterministicIds.setting` in `ids.ts`:
 * both devices derive the SAME id from the same natural key, so the two writes
 * collapse into one row and per-field LWW picks the later value.
 *
 * `bulkUpdate` and `sync` are bulk paths and go through `writeLocalBulk` — one
 * op per chunk, never one op per row (see `localWrite.ts`).
 *
 * Nothing here is remote by design: every method is fully local.
 */
// Polyfill before the engine / @symply/local-first graph loads (@noble captures
// globalThis.crypto at module load) — plan §6.1.
import './cryptoPolyfill';

import type { Setting } from '@api/settings';

import { houseDeterministicIds } from './ids';
import { activeHouseholdId, ledger, nowIso, rowsOf, writeLocal, writeLocalBulk } from './localWrite';

/**
 * Nothing on this module goes to the server — declared explicitly so the Proxy
 * wiring has one place to read the split from, exactly as the Tier-C methods on
 * `localGarbageApi` are declared.
 */
export const HOUSE_LOCAL_SETTINGS_REMOTE_METHODS: readonly string[] = [];

/**
 * SQLite stores one text column, so the value is serialized on the way in.
 * Byte-identical to `settingsService.upsertSetting` and to the client's own
 * `serializeSettings` helper: a string is stored raw (so `parseSettings`'
 * JSON.parse fallback still returns it) and everything else is JSON.
 */
function serializeValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Every local setting is scoped to the active property and this member. */
function settingScope(): { userId: string; householdId: string } {
  return { userId: ledger().memberId, householdId: activeHouseholdId() };
}

function allSettings(): Setting[] {
  const { userId } = settingScope();
  // The generic is narrowed because `Setting.household_id` is nullable in D1
  // (the server supports user-scoped settings with no household) while every
  // LOCAL row carries one: the ledger is per property, and `rowsOf` drops a
  // null `household_id` as belonging to some other scope. Writing the invariant
  // into the type is what lets the shared helper do the scoping.
  //
  // `user_id` is filtered here and not only through the deterministic id: a
  // member's ledger holds every member's settings once sync runs, and a screen
  // asking for "my settings" must not read a housemate's.
  return rowsOf<Setting & { household_id: string }>('settings').filter(
    (row) => row.user_id === userId,
  );
}

/**
 * The row a write produces, upsert-shaped.
 *
 * `created_at` is preserved from the existing row so a second device's later
 * edit does not rewrite the creation time and churn the LWW map for a field
 * nobody reads.
 */
function buildSettingRow(key: string, value: unknown, existing: Setting | undefined): Setting {
  const { userId, householdId } = settingScope();
  const now = nowIso();
  return {
    id: houseDeterministicIds.setting(userId, householdId, key),
    user_id: userId,
    household_id: householdId,
    key,
    value: serializeValue(value),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}

/** Replace-or-append in place. Shared so the single and bulk paths agree. */
function upsertRows(rows: Setting[], next: readonly Setting[]): Setting[] {
  const byId = new Map(next.map((row) => [row.id, row]));
  const merged = rows.map((row) => byId.get(row.id) ?? row);
  for (const row of next) {
    if (!rows.some((existing) => existing.id === row.id)) merged.push(row);
  }
  return merged;
}

export const localSettingsApi = {
  /** GET /api/settings */
  fetchAll: async (): Promise<{ settings: Setting[] }> => ({ settings: allSettings() }),

  /** PUT /api/settings/:key — upsert on the deterministic id. */
  update: async (key: string, value: unknown): Promise<{ setting: Setting }> => {
    const existing = allSettings().find((row) => row.key === key);
    const setting = buildSettingRow(key, value, existing);
    await writeLocal(
      (draft) => {
        draft.settings = upsertRows(draft.settings, [setting]);
      },
      {
        opType: existing ? 'SETTING_UPDATE' : 'SETTING_CREATE',
        entityType: 'setting',
        entityId: setting.id,
        payload: { key, household_id: setting.household_id },
      },
    );
    return { setting };
  },

  /**
   * PUT /api/settings/bulk.
   *
   * The Worker loops `updateSetting` per key; doing that here would be one full
   * capture → diff → seal → persist cycle of the WHOLE ledger per key, and the
   * settings migration path (`src/services/settings-migration.ts`) pushes the
   * member's entire preferences map through this in one gesture.
   */
  bulkUpdate: async (settings: Record<string, unknown>): Promise<{ success: boolean }> => {
    const existingByKey = new Map(allSettings().map((row) => [row.key, row]));
    const rows = Object.entries(settings).map(([key, value]) =>
      buildSettingRow(key, value, existingByKey.get(key)),
    );
    await writeLocalBulk(
      rows,
      (draft, chunk) => {
        draft.settings = upsertRows(draft.settings, chunk);
      },
      (chunk) => ({
        opType: 'SETTING_UPSERT_BULK',
        entityType: 'setting',
        entityId: chunk[0]!.id,
        // Intent only — the rows already travel in the delta, and duplicating
        // them into the payload doubles the sealed op for nothing.
        payload: { count: chunk.length, household_id: chunk[0]!.household_id },
      }),
    );
    return { success: true };
  },

  /**
   * POST /api/settings/sync.
   *
   * Two-way sync against a server is meaningless for a local-first household:
   * the ledger IS the authority and convergence between devices is the P2P op
   * log's job, not this call's. What survives is the useful half — upsert the
   * caller's map — and `conflicts` is always empty because per-field LWW in
   * `projection.ts` already resolved anything two devices touched.
   *
   * Shape note: the client declares `{ updated, conflicts, last_synced_at }`
   * while the Worker actually returns `{ settings, conflicts, synced_at }`
   * (`backend/src/controllers/settingsController.ts`). The DTO the app is typed
   * against is the client's, so that is what a ledger read returns.
   */
  sync: async (
    clientSettings: Record<string, unknown>,
    _lastSyncedAt?: string | null,
  ): Promise<{ updated: Setting[]; conflicts: Setting[]; last_synced_at: string }> => {
    await localSettingsApi.bulkUpdate(clientSettings);
    return { updated: allSettings(), conflicts: [], last_synced_at: nowIso() };
  },

  /** DELETE /api/settings/:key */
  delete: async (key: string): Promise<{ success: boolean }> => {
    const existing = allSettings().find((row) => row.key === key);
    if (!existing) return { success: true };
    await writeLocal(
      (draft) => {
        draft.settings = draft.settings.filter((row) => row.id !== existing.id);
      },
      {
        opType: 'SETTING_DELETE',
        entityType: 'setting',
        entityId: existing.id,
        payload: { key },
      },
    );
    return { success: true };
  },

  /**
   * POST /api/settings/reset.
   *
   * One op, not one per key: the Worker loops `deleteSetting` because it has a
   * row-at-a-time data layer, but a ledger delete of N rows is a single delta.
   */
  reset: async (): Promise<{ success: boolean }> => {
    const doomed = new Set(allSettings().map((row) => row.id));
    if (doomed.size === 0) return { success: true };
    await writeLocal(
      (draft) => {
        draft.settings = draft.settings.filter((row) => !doomed.has(row.id));
      },
      {
        opType: 'SETTING_RESET',
        entityType: 'setting',
        entityId: activeHouseholdId(),
        payload: { count: doomed.size },
      },
    );
    return { success: true };
  },
};
