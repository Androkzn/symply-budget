/**
 * `localSettingsApi` — the S3b table (plan §1.5).
 *
 * The test that matters most here is convergence: `settings` carries a business
 * uniqueness constraint on `(user_id, household_id, key)` that the ledger cannot
 * express, so the id has to carry it instead. Everything else in this suite is
 * the ordinary facade contract plus the bulk-op budget.
 *
 * Static imports only — `await import()` throws under this Jest config without
 * `--experimental-vm-modules` (plan §6.2).
 */
import type { Setting } from '@api/settings';

import {
  getLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { houseDeterministicIds } from '../ids';
import { localSettingsApi, HOUSE_LOCAL_SETTINGS_REMOTE_METHODS } from '../localSettingsApi';
import { applyLedgerDelta } from '../projection';

import { stampAt } from './houseLedgerTestKit';

const USER = 'user-settings-1';

async function freshSession() {
  await resetLocalHouseSession();
  return openLocalHouseSession({ userId: USER, displayName: 'Settings home' });
}

function settingsRows(): Setting[] {
  return getLocalHouseLedger().settings;
}

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

describe('localSettingsApi — deterministic ids (S3b)', () => {
  afterEach(async () => {
    await resetLocalHouseSession();
  });

  it('mints the id from the natural key, not at random', async () => {
    const ledger = await freshSession();
    const { setting } = await localSettingsApi.update('theme', 'dark');

    expect(setting.id).toBe(houseDeterministicIds.setting(USER, ledger.household.id, 'theme'));
    expect(setting.user_id).toBe(USER);
    expect(setting.household_id).toBe(ledger.household.id);
  });

  it('collapses two devices that set the same key offline into ONE row', async () => {
    const ledger = await freshSession();
    await localSettingsApi.update('units', 'metric');

    // What the OTHER device wrote while offline: same natural key, so the same
    // id — computed here exactly as that device would compute it, with no
    // knowledge of this device's row.
    const peerId = houseDeterministicIds.setting(USER, ledger.household.id, 'units');
    const peerRow: Setting = {
      id: peerId,
      user_id: USER,
      household_id: ledger.household.id,
      key: 'units',
      value: 'imperial',
      created_at: '2026-08-13T00:00:00.000Z',
      updated_at: '2026-08-13T00:00:00.000Z',
    };

    // The merge path a delivered peer op takes. A later stamp, so LWW gives the
    // peer's value — the point being that there is one row to give it to.
    applyLedgerDelta(
      getLocalHouseLedger(),
      { v: 1, u: { settings: [{ k: peerId, f: peerRow as unknown as Record<string, unknown> }] } },
      stampAt(5_000),
    );

    const rows = settingsRows().filter((row) => row.key === 'units');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe('imperial');

    // And a member reading through the facade sees exactly one, not two.
    const { settings } = await localSettingsApi.fetchAll();
    expect(settings.filter((row) => row.key === 'units')).toHaveLength(1);
  });

  it('keeps the same key in two properties apart — household_id is in the key', async () => {
    const ledger = await freshSession();
    const here = houseDeterministicIds.setting(USER, ledger.household.id, 'theme');
    const elsewhere = houseDeterministicIds.setting(USER, 'hh_other_property', 'theme');
    expect(here).not.toBe(elsewhere);
  });
});

describe('localSettingsApi — read/write surface', () => {
  afterEach(async () => {
    await resetLocalHouseSession();
  });

  it('updates in place instead of appending a second row', async () => {
    await freshSession();
    const first = await localSettingsApi.update('theme', 'dark');
    const second = await localSettingsApi.update('theme', 'light');

    expect(second.setting.id).toBe(first.setting.id);
    expect(settingsRows()).toHaveLength(1);
    expect(second.setting.value).toBe('light');
    // `created_at` survives the second write; only `updated_at` moves.
    expect(second.setting.created_at).toBe(first.setting.created_at);
  });

  it('serializes like the Worker — strings raw, everything else JSON', async () => {
    await freshSession();
    const { setting: str } = await localSettingsApi.update('theme', 'dark');
    const { setting: obj } = await localSettingsApi.update('notifications', {
      push: true,
      digest: 'weekly',
    });
    const { setting: num } = await localSettingsApi.update('reminder_hour', 9);

    expect(str.value).toBe('dark');
    expect(obj.value).toBe('{"push":true,"digest":"weekly"}');
    expect(num.value).toBe('9');
  });

  it('hides another member’s settings from fetchAll', async () => {
    const ledger = await freshSession();
    await localSettingsApi.update('theme', 'dark');

    const housemateId = houseDeterministicIds.setting('user-settings-2', ledger.household.id, 'theme');
    applyLedgerDelta(
      getLocalHouseLedger(),
      {
        v: 1,
        u: {
          settings: [
            {
              k: housemateId,
              // `n: 1` marks a row the peer CREATED — without it the delta is a
              // patch and the projection parks it, having nothing to patch.
              n: 1,
              f: {
                id: housemateId,
                user_id: 'user-settings-2',
                household_id: ledger.household.id,
                key: 'theme',
                value: 'light',
                created_at: '2026-08-13T00:00:00.000Z',
                updated_at: '2026-08-13T00:00:00.000Z',
              },
            },
          ],
        },
      },
      stampAt(6_000),
    );

    expect(settingsRows()).toHaveLength(2);
    const { settings } = await localSettingsApi.fetchAll();
    expect(settings).toHaveLength(1);
    expect(settings[0]!.user_id).toBe(USER);
  });

  it('deletes one key and tolerates deleting one that is already gone', async () => {
    await freshSession();
    await localSettingsApi.update('theme', 'dark');
    await localSettingsApi.update('units', 'metric');

    await expect(localSettingsApi.delete('theme')).resolves.toEqual({ success: true });
    expect(settingsRows().map((row) => row.key)).toEqual(['units']);

    const before = opCount();
    await expect(localSettingsApi.delete('theme')).resolves.toEqual({ success: true });
    // A no-op delete must not burn an op — peers would replay a delta that
    // changes nothing.
    expect(opCount()).toBe(before);
  });

  it('resets every key of this member in ONE op', async () => {
    await freshSession();
    await localSettingsApi.bulkUpdate({ a: 1, b: 2, c: 3, d: 4 });

    const before = opCount();
    await expect(localSettingsApi.reset()).resolves.toEqual({ success: true });
    expect(opCount() - before).toBe(1);
    expect(settingsRows()).toHaveLength(0);
  });
});

describe('localSettingsApi — bulk paths stay one op per chunk', () => {
  afterEach(async () => {
    await resetLocalHouseSession();
  });

  it('writes 300 keys as 2 ops, not 300', async () => {
    await freshSession();
    const payload: Record<string, unknown> = {};
    for (let index = 0; index < 300; index += 1) payload[`key_${index}`] = index;

    const before = opCount();
    await expect(localSettingsApi.bulkUpdate(payload)).resolves.toEqual({ success: true });

    // 250 rows per chunk (`MAX_OP_DELTA_ROWS`) → 2 chunks → 2 ops.
    expect(opCount() - before).toBe(2);
    expect(settingsRows()).toHaveLength(300);
  });

  it('re-running bulkUpdate updates rows rather than duplicating them', async () => {
    await freshSession();
    await localSettingsApi.bulkUpdate({ theme: 'dark', units: 'metric' });
    await localSettingsApi.bulkUpdate({ theme: 'light', units: 'metric' });

    expect(settingsRows()).toHaveLength(2);
    const { settings } = await localSettingsApi.fetchAll();
    expect(settings.find((row) => row.key === 'theme')!.value).toBe('light');
  });

  it('sync upserts through the bulk path and reports no conflicts', async () => {
    await freshSession();
    await localSettingsApi.update('theme', 'dark');

    const before = opCount();
    const result = await localSettingsApi.sync({ theme: 'light', units: 'metric' }, null);

    expect(opCount() - before).toBe(1);
    expect(result.conflicts).toEqual([]);
    expect(result.last_synced_at).toEqual(expect.any(String));
    expect(result.updated.map((row) => row.key).sort()).toEqual(['theme', 'units']);
    expect(result.updated.find((row) => row.key === 'theme')!.value).toBe('light');
  });
});

describe('localSettingsApi — tier declaration', () => {
  it('declares no remote-by-design methods: settings is wholly Tier A', () => {
    expect(HOUSE_LOCAL_SETTINGS_REMOTE_METHODS).toEqual([]);
  });

  it('covers every method on the remote module', () => {
    // The remote surface, spelled out rather than imported: `src/api/settings.ts`
    // pulls the axios client and its env config into the suite, and the Proxy
    // parity diff (DoD H3) is the place that compares the live objects.
    const remoteMethods = ['fetchAll', 'update', 'bulkUpdate', 'sync', 'delete', 'reset'];
    for (const name of remoteMethods) {
      expect(typeof (localSettingsApi as Record<string, unknown>)[name]).toBe('function');
    }
    expect(Object.keys(localSettingsApi).sort()).toEqual([...remoteMethods].sort());
  });
});
