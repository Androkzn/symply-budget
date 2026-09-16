/**
 * **He3b airplane mode — `user_habits` + `habit_logs`** (plan §7, DoD He3b).
 *
 * `localHabitsApi` against a REAL in-memory session: the same engine, op
 * journal, per-row AEAD and projection the app ships. Under Jest the store falls
 * back to `MemoryLocalFirstStore`, so nothing here is stubbed — testing the
 * facade against a mocked ledger would certify a ledger nobody runs.
 *
 * **This is the highest-risk table in the cutover, and the middle block below is
 * why.** `habit_logs` carries `unique(habit_id, date)` (`schema-health.ts:325`),
 * so its id is DETERMINISTIC — one of only two in Health. The failure mode is
 * specific and permanent: untick a day (tombstone), re-tick it, and a facade
 * that looked for the existing log through `rowsOf` sees nothing, takes the
 * create branch, and mints the SAME id a second time. Two rows now share one id,
 * on this device and on the member's other one, and LWW can never separate them
 * again. `TOMBSTONE → RE-TICK` below is that regression, written down.
 *
 * **Airplane mode is asserted, not assumed.** `fetch` is a spy for the whole
 * suite and every test ends with it never having been called.
 *
 * Static imports only: `await import()` throws under this Jest config without
 * `--experimental-vm-modules`.
 */
import {
  closeLocalHealthSession,
  getLocalHealthLedger,
  mutateLocalHealthLedger,
  openLocalHealthSessionForTests,
} from '../engine';
import { healthDeterministicIds, localDateKey } from '../ids';
import { localHabitsApi } from '../localHabitsApi';
import { allRowsOf, rowsOf } from '../localWrite';
import type { LocalHabitLog, LocalUserHabit } from '../types';

const USER = 'user_health_habits';

const opCount = (): number => getLocalHealthLedger().ops.length;
const lastOp = () => getLocalHealthLedger().ops[getLocalHealthLedger().ops.length - 1];

const liveHabits = (): LocalUserHabit[] => rowsOf<LocalUserHabit>('userHabits');
const allHabits = (): LocalUserHabit[] => allRowsOf<LocalUserHabit>('userHabits');
const liveLogs = (): LocalHabitLog[] => rowsOf<LocalHabitLog>('habitLogs');
const allLogs = (): LocalHabitLog[] => allRowsOf<LocalHabitLog>('habitLogs');

/** `YYYY-MM-DD`, `daysAgo` days before the device's local today. */
function dayKey(daysAgo: number): string {
  return localDateKey(new Date(Date.now() - daysAgo * 86_400_000));
}

/** The radio, off. */
let fetchSpy: jest.Mock;

beforeEach(async () => {
  fetchSpy = jest.fn(() => Promise.reject(new Error('airplane mode: network is off')));
  (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;
  await openLocalHealthSessionForTests({ userId: USER });
});

afterEach(async () => {
  expect(fetchSpy).not.toHaveBeenCalled();
  await closeLocalHealthSession();
});

async function makeHabit(name = 'Drink water') {
  const { habit } = await localHabitsApi.createHabit({ name });
  return habit;
}

/* ------------------------------------------------------------------ */
/* user_habits                                                         */
/* ------------------------------------------------------------------ */

describe('habits — create', () => {
  it('round-trips a habit with the radio off, on the service defaults', async () => {
    const habit = await makeHabit();

    expect(habit.name).toBe('Drink water');
    // `createHabit`'s own coalesced defaults (`health-service.ts:1568-1585`).
    expect(habit.icon).toBe('goals');
    expect(habit.category).toBe('custom');
    expect(habit.time_of_day).toBe('anytime');
    expect(habit.frequency).toBe('daily');
    expect(habit.custom_days).toBeNull();
    expect(habit.reminder_enabled).toBe(false);
    expect(habit.is_archived).toBe(false);
    expect(habit.sort_order).toBe(0);
    // Derived, never stored.
    expect(habit.days).toEqual([]);
    expect(habit.streak).toBe(0);

    const { habits } = await localHabitsApi.listHabits();
    expect(habits).toHaveLength(1);
    expect(habits[0].id).toBe(habit.id);
  });

  it('mints a RANDOM id — two habits called the same thing are two habits', async () => {
    const first = await makeHabit('Water');
    const second = await makeHabit('Water');

    // `user_habits` carries no `unique()` in D1, so it is in
    // `HEALTH_RANDOM_ID_TABLES`. Only `habit_logs` is deterministic here.
    expect(second.id).not.toBe(first.id);
    expect(first.id).toMatch(/^habit_[0-9a-f]{16}$/);
  });

  it('numbers sort_order off every row, tombstones included', async () => {
    const first = await makeHabit('One');
    await makeHabit('Two');
    await localHabitsApi.deleteHabit(first.id);

    const third = await makeHabit('Three');

    // The service counts `user_habits` for the user with NO `deleted_at` filter
    // (`:1563-1567`), so a deleted habit still consumes an ordinal. Reproduced
    // rather than "fixed": changing it would give two devices different orders.
    expect(third.sort_order).toBe(2);
  });

  it('serializes custom_days only when the frequency is custom', async () => {
    const custom = await localHabitsApi.createHabit({
      name: 'Gym',
      frequency: 'custom',
      // Out of order and duplicated on purpose: the blob is de-duplicated and
      // sorted so two devices picking the same weekdays write the same bytes.
      custom_days: [5, 2, 2, 9, 5],
    });
    expect(custom.habit.custom_days).toEqual([2, 5]);

    const daily = await localHabitsApi.createHabit({
      name: 'Walk',
      frequency: 'daily',
      custom_days: [1, 2, 3],
    });
    // A day set on a non-custom habit must not be persisted, or switching back
    // to custom later resurrects a schedule the member never chose.
    expect(daily.habit.custom_days).toBeNull();
  });

  it('appends exactly one op, describing the row', async () => {
    const before = opCount();
    const habit = await makeHabit();

    expect(opCount()).toBe(before + 1);
    expect(lastOp().opType).toBe('HABIT_CREATE');
    expect(lastOp().entityType).toBe('user_habit');
    expect(lastOp().entityId).toBe(habit.id);
  });
});

describe('habits — read', () => {
  it('orders by sort_order and hides archived habits by default', async () => {
    const first = await makeHabit('One');
    const second = await makeHabit('Two');
    await localHabitsApi.updateHabit(second.id, { is_archived: true });

    const visible = await localHabitsApi.listHabits();
    expect(visible.habits.map((habit) => habit.id)).toEqual([first.id]);

    // Archiving is the donor's only "deactivate" verb, so an archived habit has
    // to stay reachable — a habit you can hide but never bring back is a delete
    // that lies about being reversible.
    const withArchived = await localHabitsApi.listHabits({ includeArchived: true });
    expect(withArchived.habits.map((habit) => habit.id)).toEqual([first.id, second.id]);
    expect(withArchived.habits[1].is_archived).toBe(true);
  });

  it('re-derives streaks from the completion days, never from a counter', async () => {
    const habit = await makeHabit();
    await localHabitsApi.toggleHabit(habit.id, dayKey(0));
    await localHabitsApi.toggleHabit(habit.id, dayKey(1));
    await localHabitsApi.toggleHabit(habit.id, dayKey(2));

    let listed = (await localHabitsApi.listHabits()).habits[0];
    expect(listed.days).toEqual([dayKey(0), dayKey(1), dayKey(2)]);
    expect(listed.streak).toBe(3);

    // Untick the middle day: a stored counter would keep saying 3.
    await localHabitsApi.toggleHabit(habit.id, dayKey(1));

    listed = (await localHabitsApi.listHabits()).habits[0];
    expect(listed.days).toEqual([dayKey(0), dayKey(2)]);
    expect(listed.streak).toBe(1);
  });
});

describe('habits — modify', () => {
  it('patches named fields and leaves the rest alone', async () => {
    const habit = await localHabitsApi.createHabit({
      name: 'Gym',
      icon: 'movement',
      notes: 'Legs',
      reminder_time: '07:30',
      reminder_enabled: true,
    });

    const { habit: patched } = await localHabitsApi.updateHabit(habit.habit.id, { name: 'Lift' });

    expect(patched.name).toBe('Lift');
    expect(patched.icon).toBe('movement');
    expect(patched.notes).toBe('Legs');
    expect(patched.reminder_time).toBe('07:30');
    expect(patched.reminder_enabled).toBe(true);
  });

  it('clears a column with an explicit null, and keeps it on an omitted key', async () => {
    const habit = await localHabitsApi.createHabit({
      name: 'Gym',
      reminder_time: '07:30',
      notes: 'Legs',
    });

    const cleared = await localHabitsApi.updateHabit(habit.habit.id, { reminder_time: null });

    // Absent = leave, null = clear. That distinction is what lets the app drop a
    // reminder time without re-sending every other field.
    expect(cleared.habit.reminder_time).toBeNull();
    expect(cleared.habit.notes).toBe('Legs');
  });

  it('moves the frequency and its day set together', async () => {
    const habit = await localHabitsApi.createHabit({
      name: 'Gym',
      frequency: 'custom',
      custom_days: [1, 3, 5],
    });

    // Switching away drops the day set …
    const daily = await localHabitsApi.updateHabit(habit.habit.id, { frequency: 'daily' });
    expect(daily.habit.custom_days).toBeNull();

    // … and switching back does not resurrect it.
    const backToCustom = await localHabitsApi.updateHabit(habit.habit.id, { frequency: 'custom' });
    expect(backToCustom.habit.custom_days).toBeNull();
  });

  it('keeps the stored day set when a custom habit is patched without one', async () => {
    const habit = await localHabitsApi.createHabit({
      name: 'Gym',
      frequency: 'custom',
      custom_days: [1, 3, 5],
    });

    const renamed = await localHabitsApi.updateHabit(habit.habit.id, { name: 'Lift' });

    expect(renamed.habit.custom_days).toEqual([1, 3, 5]);
  });

  it('answers with the habit AND the re-listed set, archived included', async () => {
    const first = await makeHabit('One');
    const second = await makeHabit('Two');

    const result = await localHabitsApi.updateHabit(second.id, { is_archived: true });

    expect(result.habit.id).toBe(second.id);
    // The route re-lists with `includeArchived: true` so the screen can repaint
    // the toggle it just flipped (`routes/health.ts:846`).
    expect(result.habits.map((habit) => habit.id)).toEqual([first.id, second.id]);
  });

  it('404s an unknown or tombstoned habit, and writes nothing', async () => {
    const habit = await makeHabit();
    await localHabitsApi.deleteHabit(habit.id);
    const before = opCount();

    await expect(localHabitsApi.updateHabit('habit_nope', { name: 'x' })).rejects.toMatchObject({
      response: { status: 404, data: { error: { code: 'not_found' } } },
    });
    // `updateHabit`'s ownership lookup DOES filter `deleted_at` (`:1615`),
    // unlike `toggleHabit`'s — see the toggle block below.
    await expect(localHabitsApi.updateHabit(habit.id, { name: 'x' })).rejects.toMatchObject({
      response: { status: 404 },
    });
    expect(opCount()).toBe(before);
  });

  it('appends exactly one op per patch', async () => {
    const habit = await makeHabit();
    const before = opCount();

    await localHabitsApi.updateHabit(habit.id, { name: 'Lift' });

    expect(opCount()).toBe(before + 1);
    expect(lastOp().opType).toBe('HABIT_UPDATE');
    expect(lastOp().entityId).toBe(habit.id);
  });
});

describe('habits — delete', () => {
  it('TOMBSTONES the habit rather than splicing it out', async () => {
    const habit = await makeHabit();

    await expect(localHabitsApi.deleteHabit(habit.id)).resolves.toEqual({ deleted: true });

    expect(liveHabits()).toHaveLength(0);
    expect(allHabits()).toHaveLength(1);
    expect(allHabits()[0].deleted_at).not.toBeNull();
    expect((await localHabitsApi.listHabits({ includeArchived: true })).habits).toHaveLength(0);
  });

  it('leaves the habit logs alone, exactly as the service does', async () => {
    const habit = await makeHabit();
    await localHabitsApi.toggleHabit(habit.id, dayKey(0));

    await localHabitsApi.deleteHabit(habit.id);

    // `deleteHabit` tombstones `user_habits` only (`:1655-1666`). The logs stay
    // and become unreachable because the list maps logs onto habits that exist.
    expect(liveLogs()).toHaveLength(1);
    expect((await localHabitsApi.listHabits()).habits).toHaveLength(0);
  });

  it('404s the second delete', async () => {
    const habit = await makeHabit();
    await localHabitsApi.deleteHabit(habit.id);

    await expect(localHabitsApi.deleteHabit(habit.id)).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  it('appends exactly one op, carrying the tombstone', async () => {
    const habit = await makeHabit();
    const before = opCount();

    await localHabitsApi.deleteHabit(habit.id);

    expect(opCount()).toBe(before + 1);
    expect(lastOp().opType).toBe('HABIT_DELETE');
    expect(lastOp().entityId).toBe(habit.id);
  });
});

/* ------------------------------------------------------------------ */
/* habit_logs — the deterministic-id table                             */
/* ------------------------------------------------------------------ */

describe('habit logs — the deterministic id', () => {
  it('mints the id through ids.ts, never by hand', async () => {
    const habit = await makeHabit();
    const date = dayKey(0);

    const result = await localHabitsApi.toggleHabit(habit.id, date);

    expect(result.done).toBe(true);
    expect(allLogs()).toHaveLength(1);
    // Both devices compute this from the same natural key, which is the entire
    // point: an offline double-tick merges under LWW instead of surviving as
    // two ticks. A hand-formatted `habitLog_${habitId}_${date}` would drift the
    // moment `ids.ts` changed its hashing.
    expect(allLogs()[0].id).toBe(healthDeterministicIds.habitLog(habit.id, date));
  });

  it('is idempotent per (habit, day): a second tap unticks, it does not stack', async () => {
    const habit = await makeHabit();
    const date = dayKey(0);

    const first = await localHabitsApi.toggleHabit(habit.id, date);
    const second = await localHabitsApi.toggleHabit(habit.id, date);

    expect(first.done).toBe(true);
    expect(second.done).toBe(false);
    expect(allLogs()).toHaveLength(1);
    expect(liveLogs()).toHaveLength(0);
    expect(second.habits[0].days).toEqual([]);
    expect(second.habits[0].streak).toBe(0);
  });

  /**
   * THE regression. Tombstone, then re-tick.
   *
   * A facade that resolved the existing log through `rowsOf` (live rows only)
   * would see nothing here, take the create branch, and push a second row
   * carrying the SAME deterministic id. That is unrecoverable: LWW keys on the
   * id, so the ledger holds two rows it can never tell apart, and the member's
   * other device inherits the fork on the next sync.
   */
  it('TOMBSTONE → RE-TICK revives the same row instead of minting a duplicate id', async () => {
    const habit = await makeHabit();
    const date = dayKey(0);
    const expectedId = healthDeterministicIds.habitLog(habit.id, date);

    await localHabitsApi.toggleHabit(habit.id, date);
    await localHabitsApi.toggleHabit(habit.id, date);
    const third = await localHabitsApi.toggleHabit(habit.id, date);

    expect(third.done).toBe(true);
    expect(allLogs()).toHaveLength(1);
    expect(allLogs()[0].id).toBe(expectedId);
    expect(allLogs()[0].deleted_at).toBeNull();
    // The revive re-stamps `completed_at`, matching the service (`:1712-1717`).
    expect(allLogs()[0].completed_at.length).toBeGreaterThan(0);
    expect(third.habits[0].days).toEqual([date]);
  });

  it('never lets two rows share an id, across many habits and days', async () => {
    const habits = [await makeHabit('A'), await makeHabit('B'), await makeHabit('C')];
    for (const habit of habits) {
      for (const daysAgo of [0, 1, 2]) {
        // Tick, untick, re-tick — three passes over the same natural keys.
        await localHabitsApi.toggleHabit(habit.id, dayKey(daysAgo));
        await localHabitsApi.toggleHabit(habit.id, dayKey(daysAgo));
        await localHabitsApi.toggleHabit(habit.id, dayKey(daysAgo));
      }
    }

    const ids = allLogs().map((log) => log.id);
    expect(ids).toHaveLength(9);
    expect(new Set(ids).size).toBe(9);
  });

  /**
   * The read window must never reach the write path.
   *
   * `habitLogs` is windowed at 400 days for rendering. If that window were also
   * applied to the toggle's own lookup, a tombstone older than it would be
   * invisible and the create branch would re-mint its id — the same permanent
   * fork, through the back door. A member back-filling last year's habit is an
   * ordinary act.
   */
  it('finds a tombstoned log far outside the 400-day read window', async () => {
    const habit = await makeHabit();
    const ancient = dayKey(900);
    const expectedId = healthDeterministicIds.habitLog(habit.id, ancient);

    await localHabitsApi.toggleHabit(habit.id, ancient);
    await localHabitsApi.toggleHabit(habit.id, ancient);
    await localHabitsApi.toggleHabit(habit.id, ancient);

    expect(allLogs()).toHaveLength(1);
    expect(allLogs()[0].id).toBe(expectedId);
    expect(allLogs()[0].deleted_at).toBeNull();
    // …and it is still outside the RENDER window, which is the correct answer
    // for the list even though the write found it.
    expect((await localHabitsApi.listHabits()).habits[0].days).toEqual([]);
  });

  it('reuses a server-minted id that arrived from D1, matching on the natural key', async () => {
    const habit = await makeHabit();
    const date = dayKey(0);
    const serverId = 'hl_server_minted_row';

    // What the cutover import looks like: a row authored by the Worker, whose
    // id predates the deterministic builder entirely.
    await mutateLocalHealthLedger(
      (ledger) => {
        ledger.habitLogs.push({
          id: serverId,
          user_id: USER,
          habit_id: habit.id,
          date,
          time_of_day: 'anytime',
          completed_at: '2026-08-14T09:00:00.000Z',
          duration: null,
          notes: null,
          created_at: '2026-08-14T09:00:00.000Z',
          updated_at: '2026-08-14T09:00:00.000Z',
          deleted_at: null,
        });
      },
      { opType: 'TEST_SEED', entityType: 'habit_log', entityId: serverId, payload: {} },
    );

    const result = await localHabitsApi.toggleHabit(habit.id, date);

    expect(result.done).toBe(false);
    // Matched on `(habit_id, date)` — matching on the id would have missed it
    // and created a second row for the same day.
    expect(allLogs()).toHaveLength(1);
    expect(allLogs()[0].id).toBe(serverId);
    expect(allLogs()[0].deleted_at).not.toBeNull();
  });
});

describe('habit logs — toggle behaviour', () => {
  it('404s a habit that never existed, and writes nothing', async () => {
    const before = opCount();

    await expect(localHabitsApi.toggleHabit('habit_nope', dayKey(0))).rejects.toMatchObject({
      response: { status: 404, data: { error: { code: 'not_found' } } },
    });
    expect(opCount()).toBe(before);
    expect(allLogs()).toHaveLength(0);
  });

  it('still ticks a TOMBSTONED habit — the ported server inconsistency', async () => {
    const habit = await makeHabit();
    await localHabitsApi.deleteHabit(habit.id);

    // The Worker's ownership lookup does not filter `deleted_at`
    // (`:1680-1685`), unlike its own `updateHabit` and `deleteHabit`. Ported
    // as-is so a flag-1 and a flag-0 device answer the same; `summaries.ts`
    // flags it as a server bug to fix on both sides at once, not here alone.
    const result = await localHabitsApi.toggleHabit(habit.id, dayKey(0));

    expect(result.done).toBe(true);
    expect(allLogs()).toHaveLength(1);
    // The habit itself is still gone from the list it answers with.
    expect(result.habits).toHaveLength(0);
  });

  it('answers with the re-derived list, using the DEFAULT archived filter', async () => {
    const kept = await makeHabit('One');
    const archived = await makeHabit('Two');
    await localHabitsApi.updateHabit(archived.id, { is_archived: true });

    const result = await localHabitsApi.toggleHabit(kept.id, dayKey(0));

    // `routes/health.ts:868` re-lists WITHOUT `includeArchived`, so the ring
    // updates without a second request and archived habits stay out of it.
    expect(result.habits.map((habit) => habit.id)).toEqual([kept.id]);
  });

  it('appends exactly one op per tap, naming the branch it took', async () => {
    const habit = await makeHabit();
    const date = dayKey(0);
    const logId = healthDeterministicIds.habitLog(habit.id, date);

    let before = opCount();
    await localHabitsApi.toggleHabit(habit.id, date);
    expect(opCount()).toBe(before + 1);
    expect(lastOp().opType).toBe('HABIT_LOG_CREATE');
    expect(lastOp().entityType).toBe('habit_log');
    expect(lastOp().entityId).toBe(logId);

    before = opCount();
    await localHabitsApi.toggleHabit(habit.id, date);
    expect(opCount()).toBe(before + 1);
    expect(lastOp().opType).toBe('HABIT_LOG_DELETE');
    expect(lastOp().entityId).toBe(logId);

    before = opCount();
    await localHabitsApi.toggleHabit(habit.id, date);
    expect(opCount()).toBe(before + 1);
    expect(lastOp().opType).toBe('HABIT_LOG_RESTORE');
    expect(lastOp().entityId).toBe(logId);
  });
});

describe('habits — the whole loop, offline', () => {
  it('creates, ticks, edits, archives and deletes without one network call', async () => {
    const habit = await localHabitsApi.createHabit({ name: 'Stretch', icon: 'stretch' });
    await localHabitsApi.toggleHabit(habit.habit.id, dayKey(1));
    await localHabitsApi.toggleHabit(habit.habit.id, dayKey(0));
    await localHabitsApi.updateHabit(habit.habit.id, { name: 'Mobility', target_duration: 600 });

    const listed = (await localHabitsApi.listHabits()).habits[0];
    expect(listed.name).toBe('Mobility');
    expect(listed.target_duration).toBe(600);
    expect(listed.days).toEqual([dayKey(0), dayKey(1)]);
    expect(listed.streak).toBe(2);

    await localHabitsApi.updateHabit(habit.habit.id, { is_archived: true });
    expect((await localHabitsApi.listHabits()).habits).toHaveLength(0);

    await localHabitsApi.deleteHabit(habit.habit.id);
    expect((await localHabitsApi.listHabits({ includeArchived: true })).habits).toHaveLength(0);

    // Six writes, six ops — one per write, each replayable when the radio comes
    // back. The outbox is gone; this journal is what replaces it.
    expect(opCount()).toBe(6);
  });
});
