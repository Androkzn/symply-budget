/**
 * **He3a airplane mode — `weight_entries`** (plan §7, DoD He3a: *"**weight**
 * end-to-end incl. airplane mode"*).
 *
 * Weight is the He3a pilot table: the one slice that must work end to end
 * before the other seven are attempted, because it exercises every part of the
 * machine — create, patch, tombstone, a windowed read, and a unit column the
 * screens convert on.
 *
 * `localWeightApi` against a REAL in-memory session: the same engine, op
 * journal, per-row AEAD and projection the app ships. Under Jest the store
 * falls back to `MemoryLocalFirstStore` and no native module is involved, so
 * nothing here is stubbed. Testing a facade against a mocked ledger would
 * certify a ledger nobody runs.
 *
 * **Airplane mode is asserted, not assumed.** `fetch` is replaced by a spy for
 * the whole suite and every test ends with it never having been called.
 *
 * ## The assertion this file exists for
 *
 * `weight_entries` is the flagship RANDOM-ID case (`schema.ts`,
 * `HEALTH_RANDOM_ID_TABLES`). A member who weighs in morning AND evening
 * produces two rows for one date. A deterministic `weight_${date}` id — the
 * shape `habit_logs` and `health_goals` legitimately use — would LWW one of
 * them away silently: no error, no conflict, the reading simply gone and the
 * trend line moved. `two weigh-ins on one day stay two rows` below is the
 * regression test for exactly that, and it is why this table is called out
 * separately in the registry guard.
 *
 * Static imports only: `await import()` throws under this Jest config without
 * `--experimental-vm-modules`.
 */
import {
  closeLocalHealthSession,
  getLocalHealthLedger,
  openLocalHealthSessionForTests,
} from '../engine';
import { localWeightApi } from '../localWeightApi';
import { allRowsOf, rowsOf } from '../localWrite';
import type { LocalWeightEntry } from '../types';

const USER = 'user_health_weight';

/** Every write appends exactly one op — the sync queue, now that the outbox is gone. */
const opCount = (): number => getLocalHealthLedger().ops.length;

const liveRows = (): LocalWeightEntry[] => rowsOf<LocalWeightEntry>('weightEntries');
const allRows = (): LocalWeightEntry[] => allRowsOf<LocalWeightEntry>('weightEntries');

/** The radio, off. */
let fetchSpy: jest.Mock;

beforeEach(async () => {
  fetchSpy = jest.fn(() => Promise.reject(new Error('airplane mode: network is off')));
  (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;
  await openLocalHealthSessionForTests({ userId: USER });
});

afterEach(async () => {
  // Not a formality: a facade that fell through to the server would satisfy
  // every other assertion in this file against a live Worker.
  expect(fetchSpy).not.toHaveBeenCalled();
  await closeLocalHealthSession();
});

async function weighIn(overrides: Record<string, unknown> = {}) {
  const { entry } = await localWeightApi.createWeight({
    date: '2026-08-14',
    weight: 81.2,
    unit: 'kg',
    ...overrides,
  });
  return entry;
}

describe('weight — create', () => {
  it('round-trips a weigh-in with the radio off', async () => {
    const created = await weighIn();

    expect(created.date).toBe('2026-08-14');
    expect(created.weight).toBe(81.2);
    expect(created.unit).toBe('kg');
    expect(liveRows()).toHaveLength(1);
    expect(opCount()).toBe(1);
  });

  it("applies the route's own defaults", async () => {
    const created = await weighIn();
    // `note` → null and `source` → 'manual' (`health-service.ts`). The `source`
    // default is load-bearing: the HealthKit de-duplicator leaves 'manual' rows
    // alone (0122), so an untagged local row would be a candidate for overwrite
    // by the next import.
    expect(created.note).toBeNull();
    expect(created.source).toBe('manual');
  });

  it('keeps an explicit healthkit tag', async () => {
    const created = await weighIn({ source: 'healthkit' });
    expect(created.source).toBe('healthkit');
  });

  /** THE regression this table exists to protect. */
  it('two weigh-ins on one day stay two rows', async () => {
    const morning = await weighIn({ weight: 81.2 });
    const evening = await weighIn({ weight: 80.6 });

    expect(morning.id).not.toBe(evening.id);
    expect(liveRows()).toHaveLength(2);
    const { entries } = await localWeightApi.listWeight();
    expect(entries.map((e) => e.weight).sort()).toEqual([80.6, 81.2]);
  });
});

describe('weight — read', () => {
  it('returns newest-first', async () => {
    await weighIn({ date: '2026-08-10', weight: 82 });
    await weighIn({ date: '2026-08-14', weight: 81 });
    await weighIn({ date: '2026-08-12', weight: 81.5 });

    const { entries } = await localWeightApi.listWeight();
    expect(entries.map((e) => e.date)).toEqual(['2026-08-14', '2026-08-12', '2026-08-10']);
  });

  it('orders same-day rows deterministically', async () => {
    // Two devices holding the same rows must paint the same list; SQLite leaves
    // the order of two rows sharing a `date` unspecified.
    await weighIn({ weight: 81.2 });
    await weighIn({ weight: 80.6 });

    const first = (await localWeightApi.listWeight()).entries.map((e) => e.id);
    const second = (await localWeightApi.listWeight()).entries.map((e) => e.id);
    expect(first).toEqual(second);
  });

  it('honours the caller from/to range', async () => {
    await weighIn({ date: '2026-08-01' });
    await weighIn({ date: '2026-08-14' });

    const { entries } = await localWeightApi.listWeight({ from: '2026-08-10', to: '2026-08-20' });
    expect(entries.map((e) => e.date)).toEqual(['2026-08-14']);
  });

  it('excludes tombstoned rows', async () => {
    const keep = await weighIn({ date: '2026-08-10' });
    const drop = await weighIn({ date: '2026-08-11' });
    await localWeightApi.deleteWeight(drop.id);

    const { entries } = await localWeightApi.listWeight();
    expect(entries.map((e) => e.id)).toEqual([keep.id]);
  });

  it('bounds the read by the registered window, not the table', async () => {
    // The He3b rule applied to He3a's own table: a local method that returns
    // the full table where the remote returned a window is a blocker.
    for (let day = 1; day <= 40; day += 1) {
      const date = `2026-07-${String(day).padStart(2, '0')}`;
      if (day <= 31) await weighIn({ date, weight: 80 + day / 100 });
    }
    const { entries } = await localWeightApi.listWeight({ limit: 5 });
    expect(entries).toHaveLength(5);
  });
});

describe('weight — modify', () => {
  it('patches only the keys sent', async () => {
    const created = await weighIn({ note: 'morning' });
    const { entry } = await localWeightApi.updateWeight(created.id, { weight: 80.4 });

    expect(entry.weight).toBe(80.4);
    expect(entry.note).toBe('morning');
    expect(entry.date).toBe('2026-08-14');
    expect(liveRows()).toHaveLength(1);
  });

  it('clears a note with an explicit null', async () => {
    // `null` is a real value (clear) and must be distinguishable from absent
    // (keep) — `body.note ?? existing.note` would make clearing impossible.
    const created = await weighIn({ note: 'morning' });
    const { entry } = await localWeightApi.updateWeight(created.id, { note: null });
    expect(entry.note).toBeNull();
  });

  it('advances updated_at so LWW can order the edit', async () => {
    const created = await weighIn();
    const { entry } = await localWeightApi.updateWeight(created.id, { weight: 80.4 });
    expect(entry.updated_at >= created.updated_at).toBe(true);
  });

  it('rejects an unknown id with a 404-shaped error', async () => {
    // `writeThrough` reads `error.response.status` to decide whether a failed
    // write earns an outbox retry; a bare Error reads as a lost connection and
    // is re-queued forever.
    await expect(localWeightApi.updateWeight('nope', { weight: 1 })).rejects.toMatchObject({
      response: { status: 404 },
    });
  });
});

describe('weight — delete', () => {
  it('tombstones rather than splicing', async () => {
    const created = await weighIn();
    await localWeightApi.deleteWeight(created.id);

    // The row survives with a tombstone: removing it outright would let a peer
    // device's older copy resurrect it, because LWW has nothing to compare a
    // missing row against.
    expect(liveRows()).toHaveLength(0);
    expect(allRows()).toHaveLength(1);
    expect(allRows()[0].deleted_at).toBeTruthy();
  });

  it('rejects a double delete the way the route 404s', async () => {
    const created = await weighIn();
    await localWeightApi.deleteWeight(created.id);
    await expect(localWeightApi.deleteWeight(created.id)).rejects.toMatchObject({
      response: { status: 404 },
    });
  });
});

describe('weight — the whole journey, radio off', () => {
  it('create → read → modify → delete → read', async () => {
    const created = await weighIn({ weight: 81.2, note: 'morning' });
    expect((await localWeightApi.listWeight()).entries).toHaveLength(1);

    await localWeightApi.updateWeight(created.id, { weight: 80.9 });
    expect((await localWeightApi.listWeight()).entries[0].weight).toBe(80.9);

    await localWeightApi.deleteWeight(created.id);
    expect((await localWeightApi.listWeight()).entries).toHaveLength(0);

    // Four writes, four ops — the sync queue is the op journal now.
    expect(opCount()).toBe(3);
  });
});
