/**
 * **He3b airplane mode — `body_measurements`** (plan §7, DoD He3b: *"the other
 * seven Wave A tables airplane-mode"*).
 *
 * `localBodyApi` against a REAL in-memory session: the same engine, op journal,
 * per-row AEAD and projection the app ships. Under Jest the store falls back to
 * `MemoryLocalFirstStore` and no native module is involved, so nothing here is
 * stubbed. Testing a facade against a mocked ledger would certify a ledger
 * nobody runs.
 *
 * **Airplane mode is asserted, not assumed.** `fetch` is replaced by a spy for
 * the whole suite and every test ends with it never having been called: the
 * point of He3 is that a create, an edit, a delete and a read all complete with
 * the radio off, and the only way to prove that is to make a network call fail
 * loudly rather than quietly succeed against a staging Worker.
 *
 * The four verbs, in the order a member performs them:
 *   CREATE  → a taping session, up to forty-one sites in one row
 *   READ    → newest-first, tombstones excluded
 *   MODIFY  → correct a site, or CLEAR one with an explicit `null` (0131)
 *   DELETE  → a tombstone, never a splice
 *
 * Static imports only: `await import()` throws under this Jest config without
 * `--experimental-vm-modules`.
 */
import {
  closeLocalHealthSession,
  getLocalHealthLedger,
  openLocalHealthSessionForTests,
} from '../engine';
import { localBodyApi } from '../localBodyApi';
import { allRowsOf, rowsOf } from '../localWrite';
import type { LocalBodyMeasurement } from '../types';

const USER = 'user_health_body';

/** Every write appends exactly one op — the sync queue, now that the outbox is gone. */
const opCount = (): number => getLocalHealthLedger().ops.length;
const lastOp = () => getLocalHealthLedger().ops[getLocalHealthLedger().ops.length - 1];

const liveRows = (): LocalBodyMeasurement[] => rowsOf<LocalBodyMeasurement>('bodyMeasurements');
const allRows = (): LocalBodyMeasurement[] => allRowsOf<LocalBodyMeasurement>('bodyMeasurements');

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

async function session(overrides: Record<string, unknown> = {}) {
  const { measurement } = await localBodyApi.createMeasurement({
    date: '2026-08-14',
    unit: 'cm',
    waist: 82,
    chest: 100,
    ...overrides,
  });
  return measurement;
}

describe('body measurements — create', () => {
  it('round-trips a taping session with the radio off', async () => {
    const created = await session();

    expect(created.date).toBe('2026-08-14');
    expect(created.unit).toBe('cm');
    expect(created.waist).toBe(82);
    expect(created.chest).toBe(100);

    const { measurements } = await localBodyApi.listMeasurements();
    expect(measurements).toHaveLength(1);
    expect(measurements[0]).toEqual(created);
  });

  it('answers every site, `null` where the member measured nothing', async () => {
    const created = (await session()) as unknown as Record<string, unknown>;

    // The 0131 comprehensive sites are typed OPTIONAL on the wire only because
    // a pre-migration Worker omitted them. A current one answers the whole row,
    // and so must the ledger — `healthBodyStorage.fromWireMeasurement` reads a
    // missing key and a null key identically, but a narrower local answer is
    // still the "same signature" break He3 forbids.
    expect(created.hips).toBeNull();
    expect(created.left_ankle).toBeNull();
    expect(created.torso_length).toBeNull();
    expect(created.body_fat_percentage).toBeNull();
    expect(created.deleted_at).toBeNull();
    expect(created.user_id).toBe(USER);
  });

  it('strips a key the route would have stripped', async () => {
    // `POST /measurements` is a `z.object` over `measurementFields`: it drops
    // what it does not name and answers 200. A local facade that spread the
    // caller's body would persist a column the server has never accepted, and
    // the two devices then disagree the moment one of them is online.
    const created = (await localBodyApi.createMeasurement({
      date: '2026-08-14',
      unit: 'cm',
      waist: 82,
      left_gill: 12,
      id: 'attacker-chosen-id',
      user_id: 'someone-else',
      deleted_at: '2020-01-01T00:00:00.000Z',
    })) as unknown as { measurement: Record<string, unknown> };

    expect(created.measurement.left_gill).toBeUndefined();
    expect(created.measurement.id).not.toBe('attacker-chosen-id');
    expect(created.measurement.user_id).toBe(USER);
    expect(created.measurement.deleted_at).toBeNull();
  });

  it('mints a RANDOM id — two tapings on one day are two sessions', async () => {
    const first = await session();
    const second = await session({ waist: 81 });

    // `body_measurements` carries no `unique()` in D1, so it is in
    // `HEALTH_RANDOM_ID_TABLES`. A `bm_${date}` id would LWW one of these away
    // — and for this table that is up to forty-one real readings lost.
    expect(second.id).not.toBe(first.id);
    expect(first.id).toMatch(/^bm_[0-9a-f]{16}$/);
    expect(liveRows()).toHaveLength(2);
    expect((await localBodyApi.listMeasurements()).measurements).toHaveLength(2);
  });

  it('appends exactly one op, describing the row', async () => {
    const before = opCount();
    const created = await session();

    expect(opCount()).toBe(before + 1);
    expect(lastOp().opType).toBe('BODY_MEASUREMENT_CREATE');
    expect(lastOp().entityType).toBe('body_measurement');
    expect(lastOp().entityId).toBe(created.id);
  });
});

describe('body measurements — read', () => {
  it('orders newest first, and breaks a same-day tie deterministically', async () => {
    await localBodyApi.createMeasurement({ date: '2026-08-10', unit: 'cm', waist: 84 });
    const sameDayA = await localBodyApi.createMeasurement({
      date: '2026-08-14',
      unit: 'cm',
      waist: 83,
    });
    const sameDayB = await localBodyApi.createMeasurement({
      date: '2026-08-14',
      unit: 'cm',
      waist: 82,
    });

    const { measurements } = await localBodyApi.listMeasurements();
    expect(measurements.map((row) => row.date)).toEqual(['2026-08-14', '2026-08-14', '2026-08-10']);

    // SQLite leaves two rows sharing a `date` unordered and `latestMeasurement`
    // reads row zero, so an unspecified tie is a different "current waist" on
    // two devices holding identical rows.
    const tie = [sameDayA.measurement.id, sameDayB.measurement.id];
    expect(tie).toContain(measurements[0].id);
    const repeat = await localBodyApi.listMeasurements();
    expect(repeat.measurements.map((row) => row.id)).toEqual(measurements.map((row) => row.id));
  });

  it('latestMeasurement is the newest row, or null on an empty ledger', async () => {
    expect((await localBodyApi.latestMeasurement()).measurement).toBeNull();

    await localBodyApi.createMeasurement({ date: '2026-08-01', unit: 'cm', waist: 84 });
    const newest = await localBodyApi.createMeasurement({
      date: '2026-08-14',
      unit: 'cm',
      waist: 82,
    });

    expect((await localBodyApi.latestMeasurement()).measurement?.id).toBe(
      newest.measurement.id,
    );
  });
});

describe('body measurements — modify', () => {
  it('patches one site and leaves the rest of the session alone', async () => {
    const created = await session();

    const { measurement } = await localBodyApi.updateMeasurement(created.id, { waist: 80.5 });

    expect(measurement.waist).toBe(80.5);
    // An omitted key keeps its stored value: a correction never has to resend
    // the other forty sites of the session.
    expect(measurement.chest).toBe(100);
    expect(measurement.date).toBe('2026-08-14');
    expect(measurement.updated_at >= created.updated_at).toBe(true);
  });

  it('CLEARS a site with an explicit null (0131), without deleting the session', async () => {
    const created = await session();

    const { measurement } = await localBodyApi.updateMeasurement(created.id, { waist: null });

    // This is the whole point of the patch verb: before it existed, removing one
    // bad reading meant DELETE, which tombstones every site taped that day.
    expect(measurement.waist).toBeNull();
    expect(measurement.chest).toBe(100);
    expect(liveRows()).toHaveLength(1);
  });

  it('treats an explicitly-undefined key as absent, not as a clear', async () => {
    const created = await session();

    const { measurement } = await localBodyApi.updateMeasurement(created.id, { waist: undefined });

    // `undefined` is dropped, `null` is kept — assigning the whole object would
    // write `undefined` over stored values as SQL NULL.
    expect(measurement.waist).toBe(82);
  });

  it('can re-type the session in the other unit, and does not default it away', async () => {
    const created = await session();

    const patched = await localBodyApi.updateMeasurement(created.id, { unit: 'in', waist: 32 });
    expect(patched.measurement.unit).toBe('in');

    const untouched = await localBodyApi.updateMeasurement(created.id, { chest: 39 });
    // `unit` is accepted but never DEFAULTED: omitting it keeps the row's own
    // scale rather than silently restating 32 in centimetres.
    expect(untouched.measurement.unit).toBe('in');
  });

  it('strips an unknown key from a patch too', async () => {
    const created = await session();

    const patched = (await localBodyApi.updateMeasurement(created.id, {
      left_gill: 12,
      user_id: 'someone-else',
    })) as unknown as { measurement: Record<string, unknown> };

    expect(patched.measurement.left_gill).toBeUndefined();
    expect(patched.measurement.user_id).toBe(USER);
  });

  it('rejects an unknown id with the 404 shape the Worker answers', async () => {
    const before = opCount();

    await expect(localBodyApi.updateMeasurement('bm_nope', { waist: 80 })).rejects.toMatchObject({
      // `writeThrough` reads `error.response.status` to decide whether a failed
      // write earns a retry; a bare Error has none, reads as a lost connection,
      // and re-queues forever.
      response: { status: 404, data: { error: { code: 'not_found' } } },
    });
    // Validated BEFORE the mutator, so nothing half-applied and no op.
    expect(opCount()).toBe(before);
  });

  it('appends exactly one op per patch', async () => {
    const created = await session();
    const before = opCount();

    await localBodyApi.updateMeasurement(created.id, { waist: 80 });

    expect(opCount()).toBe(before + 1);
    expect(lastOp().opType).toBe('BODY_MEASUREMENT_UPDATE');
    expect(lastOp().entityId).toBe(created.id);
  });
});

describe('body measurements — delete', () => {
  it('TOMBSTONES the row rather than splicing it out', async () => {
    const created = await session();

    await expect(localBodyApi.deleteMeasurement(created.id)).resolves.toEqual({ deleted: true });

    // Removing the row outright would let a peer device's older copy resurrect
    // it on the next merge: LWW has nothing to compare a missing row against.
    expect(liveRows()).toHaveLength(0);
    expect(allRows()).toHaveLength(1);
    expect(allRows()[0].deleted_at).not.toBeNull();
  });

  it('hides a deleted session from every read', async () => {
    const kept = await localBodyApi.createMeasurement({
      date: '2026-08-01',
      unit: 'cm',
      waist: 84,
    });
    const doomed = await session();

    await localBodyApi.deleteMeasurement(doomed.id);

    const { measurements } = await localBodyApi.listMeasurements();
    expect(measurements.map((row) => row.id)).toEqual([kept.measurement.id]);
    // A tombstoned row must not become "the latest" — the remote's own
    // `isNull(deleted_at)` is what this reproduces.
    expect((await localBodyApi.latestMeasurement()).measurement?.id).toBe(kept.measurement.id);
  });

  it('404s the second delete, and a patch of a tombstoned row', async () => {
    const created = await session();
    await localBodyApi.deleteMeasurement(created.id);

    await expect(localBodyApi.deleteMeasurement(created.id)).rejects.toMatchObject({
      response: { status: 404 },
    });
    await expect(localBodyApi.updateMeasurement(created.id, { waist: 1 })).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  it('appends exactly one op, carrying the tombstone', async () => {
    const created = await session();
    const before = opCount();

    await localBodyApi.deleteMeasurement(created.id);

    expect(opCount()).toBe(before + 1);
    expect(lastOp().opType).toBe('BODY_MEASUREMENT_DELETE');
    expect(lastOp().entityId).toBe(created.id);
  });
});

describe('body measurements — the whole loop, offline', () => {
  it('creates, edits, clears a site and deletes without one network call', async () => {
    const first = await session();
    await localBodyApi.updateMeasurement(first.id, { waist: 81, hips: 95 });
    await localBodyApi.updateMeasurement(first.id, { hips: null });
    const second = await localBodyApi.createMeasurement({
      date: '2026-08-20',
      unit: 'cm',
      waist: 80,
    });
    await localBodyApi.deleteMeasurement(first.id);

    const { measurements } = await localBodyApi.listMeasurements();
    expect(measurements).toHaveLength(1);
    expect(measurements[0].id).toBe(second.measurement.id);

    // Five writes, five ops — one per write, each replayable when the radio
    // comes back. The outbox is gone; this journal is what replaces it.
    expect(opCount()).toBe(5);
  });
});
