/**
 * `healthApi`'s **habits** surface, served from the on-device ledger — He3b
 * (plan §7). One local method per remote method on `src/api/health.ts`'s
 * `// ---- habits ----` block; all five are present, because the Proxy does not
 * fall through to the server for a missing one — it rejects (`localApiProxy.ts`,
 * lesson 2).
 *
 * **This is the highest-risk slice of the whole cutover.** `habit_logs` is one
 * of only TWO tables in Health with a deterministic id (`healthGoals` is the
 * other), and it is the only one whose deterministic row is created by a
 * single-tap control that a member hits dozens of times a week, offline, on two
 * devices. Everything below is arranged around that.
 *
 * FIVE RULES THIS FILE IS BUILT ON
 * -------------------------------
 * 1. **The upsert path reads TOMBSTONES, and it is the reason `allRowsOf`
 *    exists.** `habit_logs` carries `unique(habit_id, date)`
 *    (`schema-health.ts:325`), so `ids.ts` mints
 *    `healthDeterministicIds.habitLog(habitId, date)`. If `toggleHabit` looked
 *    for the existing log through `rowsOf` (live rows only), an UNTICKED day
 *    would read as "no log", the create branch would mint the SAME deterministic
 *    id a second time, and the ledger would hold two rows sharing one id —
 *    which LWW can then never separate again, on either device, forever. The
 *    lookup therefore runs over `allRowsOf`, and it matches on the natural key
 *    `(habit_id, date)` rather than on the id, so it also catches a row that
 *    arrived from D1 at cutover carrying a server-minted `hl_*` id.
 * 2. **The toggle read is NEVER windowed.** The 400-day window below is a READ
 *    ceiling for rendering. Applying it to the toggle's own lookup would hide a
 *    tombstone older than the window and re-mint its id — rule 1's failure mode,
 *    reintroduced through the back door. A member back-filling last year's habit
 *    is an ordinary act, not an exotic one.
 * 3. **`userHabits` gets a random id.** No `unique()` in D1, so it is in
 *    `HEALTH_RANDOM_ID_TABLES` (`schema.ts`) and `newLocalId('habit')` mirrors
 *    the server's `newId('habit')`. Two habits called "Water" are two habits.
 * 4. **The window is the CLIENT's, because the route has none.** `listHabits`
 *    selects every `user_habits` row and EVERY `habit_logs` row for the user
 *    (`health-service.ts:1508-1526`) and derives streaks in memory — genuinely
 *    unbounded on both tables. The only window that has ever existed is the
 *    client's `.slice(0, MAX_HABITS)` (40) and `.slice(0, MAX_DAYS_PER_HABIT)`
 *    (400) in `healthHabitsStorage.ts:432-433`. Port it or a ten-year habit
 *    ledger arrives whole on every Home focus. Both numbers come from
 *    `HEALTH_READ_WINDOWS.loadHabits`; neither is restated here.
 * 5. **Streaks are DERIVED, never stored.** `summaries.ts` already owns the
 *    port — `computeHabitList` (which calls `computeHabitStreak`) and
 *    `resolveHabitToggle`. This file reads the ledger and applies the outcome;
 *    it does not re-derive a single day count. A stored counter is what makes an
 *    untick or a back-filled day wrong.
 *
 * TOMBSTONES, EVERYWHERE ELSE
 * ---------------------------
 * Every RENDER read goes through `rowsOf`: `listHabits` carries
 * `isNull(user_habits.deleted_at)` and `isNull(habit_logs.deleted_at)`
 * server-side. Two writes deliberately do not:
 *
 *  - the toggle's log lookup — rule 1;
 *  - the toggle's OWNERSHIP lookup, because the Worker's does not either
 *    (`health-service.ts:1680-1685`), unlike its own `updateHabit` (`:1615`) and
 *    `deleteHabit` (`:1660`). A tombstoned habit stays tickable. Ported as-is so
 *    a flag-1 and a flag-0 device answer identically; `summaries.ts` flags it as
 *    a server inconsistency to fix on both sides at once, not here, not alone.
 *  - `createHabit`'s `sort_order` default, which counts EVERY row for the user
 *    including tombstoned ones (`:1563-1567` has no `deleted_at` filter), so a
 *    deleted habit still consumes an ordinal exactly as it does today.
 */
// Bare side-effect, FIRST: @noble/* captures `globalThis.crypto` at module load
// and `ids`/`localWrite` reach @symply/local-first before the engine does. This
// module is a Proxy entry point, so it can be the first Health local module a
// screen pulls into the graph.
import './cryptoPolyfill';

import type { HealthHabit, HealthHabitWrite } from '@api/health';

import { healthDeterministicIds, localDateKey, newLocalId } from './ids';
import { activeUserId, allRowsOf, ensureResident, nowIso, rowsOf, writeLocal } from './localWrite';
import { computeHabitList, resolveHabitToggle, type HealthHabitWithStreak } from './summaries';
import type { LocalHabitLog, LocalUserHabit } from './types';
import {
  HEALTH_READ_WINDOWS,
  applyHealthReadWindow,
  maxDaysForWindow,
  maxRowsForWindow,
  type HealthLedgerRead,
} from './windows';

/* ------------------------------------------------------------------ */
/* Windows — taken from the registry, never restated                   */
/* ------------------------------------------------------------------ */

/** `userHabits`, ≤40 rows. The route has no limit; the client's slice is it. */
const HABITS_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadHabits.reads[0];

/** `habitLogs`, 400 days. Also the route's only absent limit. */
const HABIT_LOGS_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadHabits.reads[1];

/**
 * 40 — but applied by `sort_order`, not by date, and that is deliberate.
 *
 * `applyHealthReadWindow` orders newest-first, which is right for every dated
 * table and wrong for this one: `userHabits` is deliberately absent from
 * `HEALTH_WINDOWED_DATE_FIELDS` ("always-resident by design — do not
 * relitigate", `schema.ts`), and the forty the remote returned are the forty
 * LOWEST `sort_order` (`ORDER BY sort_order`, `health-service.ts:1518`, then
 * `.slice(0, MAX_HABITS)` at `healthHabitsStorage.ts:719`) — the top of the
 * member's own list, not the forty they happened to create most recently.
 *
 * So the CEILING comes from the registry through `maxRowsForWindow`, and only
 * the ordering is local: `computeHabitList` already sorts by `sort_order` with
 * `id` breaking the tie, so slicing its output reproduces the remote's forty
 * exactly while still honouring the registered window.
 */
const MAX_HABIT_ROWS: number | null = maxRowsForWindow(HABITS_READ.window);

/**
 * 400 — per HABIT, which is why it is applied to each habit's `days` and not
 * only to the table.
 *
 * The 400-day window on `habitLogs` caps the ledger scan; this caps what any one
 * habit carries into the DTO, reproducing `(row.days ?? []).slice(0,
 * MAX_DAYS_PER_HABIT)` (`healthHabitsStorage.ts:663`). Streaks are computed
 * BEFORE the slice, as on the server, where `streakOf` runs over the full day
 * set and the client truncates afterwards.
 */
const MAX_DAYS_PER_HABIT: number | null = maxDaysForWindow(HABIT_LOGS_READ.window);

/* ------------------------------------------------------------------ */
/* `custom_days` — the write half of the JSON blob                     */
/* ------------------------------------------------------------------ */

/**
 * `health-service.ts:151-157`, verbatim.
 *
 * `custom_days` is stored as a JSON TEXT blob and answered as an array, so the
 * two directions live in different modules: `summaries.ts` holds the read half
 * (`parseStoredCustomDays`, private to that pure module) and this file holds the
 * write half, because `summaries.ts` is read-only by contract — it takes rows
 * and returns envelopes, and exports no writer.
 *
 * De-duplicated and sorted, so two devices that pick the same weekdays in a
 * different order write the same blob and LWW has nothing to fight over.
 */
function serializeCustomDays(days: number[] | null | undefined): string | null {
  if (!days) return null;
  const clean = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort(
    (a, b) => a - b,
  );
  return clean.length > 0 ? JSON.stringify(clean) : null;
}

/** `health-service.ts:160-170`, verbatim — a corrupt blob reads as null. */
function parseStoredCustomDays(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const days = (parsed as unknown[])
      .map((value) => Number(value))
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
    return days.length > 0 ? days : null;
  } catch {
    return null;
  }
}

/**
 * The two `{ mode: 'boolean' }` columns on `user_habits`
 * (`schema-health.ts:288, 294`).
 *
 * D1 stores them as INTEGER and drizzle hands the Worker real booleans, so the
 * wire carries `true`/`false` while the ledger row carries 0/1 — the same split
 * `localGoalsApi` documents for its three. Converted here on write;
 * `computeHabitList` converts back on read.
 */
function toLedgerBoolean(value: boolean): number {
  return value ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* Row access + projection                                             */
/* ------------------------------------------------------------------ */

function habitRows(): LocalUserHabit[] {
  return rowsOf<LocalUserHabit>('userHabits');
}

function habitLogRows(): LocalHabitLog[] {
  return rowsOf<LocalHabitLog>('habitLogs');
}

/** The registered 400-day ceiling on the log table — every render read's input. */
function windowedHabitLogs(): LocalHabitLog[] {
  return applyHealthReadWindow(HABIT_LOGS_READ, habitLogRows());
}

/** `(row.days ?? []).slice(0, 400)` — `healthHabitsStorage.ts:663`. */
function capDays(habit: HealthHabitWithStreak): HealthHabitWithStreak {
  if (MAX_DAYS_PER_HABIT === null || habit.days.length <= MAX_DAYS_PER_HABIT) return habit;
  return { ...habit, days: habit.days.slice(0, MAX_DAYS_PER_HABIT) };
}

/**
 * `listHabits`' answer — the port lives in `summaries.computeHabitList`.
 *
 * Ordering, streaks, the `custom_days` parse and the archived filter are all
 * that function's business; this adds only the two registered caps.
 */
function habitList(includeArchived: boolean, today: string): HealthHabitWithStreak[] {
  const list = computeHabitList({
    habits: habitRows(),
    logs: windowedHabitLogs(),
    today,
    includeArchived,
  });
  const capped = MAX_HABIT_ROWS === null ? list : list.slice(0, MAX_HABIT_ROWS);
  return capped.map(capDays);
}

/**
 * One habit's DTO, built through the same projection rather than by hand.
 *
 * `createHabit` and `updateHabit` each answer with a single habit, and the
 * server builds it from its own uncapped list (`:1649`). Deriving it from the
 * row directly — instead of searching the CAPPED list — is what keeps a member
 * with more than forty habits from getting a 404 for a write that succeeded.
 */
function singleHabit(row: LocalUserHabit, today: string): HealthHabitWithStreak {
  const [habit] = computeHabitList({
    habits: [row],
    logs: windowedHabitLogs(),
    today,
    // Archiving is a patchable field, so the answer to "I just archived this"
    // must still be the habit.
    includeArchived: true,
  });
  return capDays(habit);
}

/**
 * The wire shape.
 *
 * ⚠️ `HealthHabit.custom_days` is declared `string | null`
 * (`api/health.ts:403`) but the Worker sends `number[] | null` — `listHabits`
 * parses the stored blob before answering (`health-service.ts:1543`). The
 * runtime shape wins, exactly as `summaries.ts` documents, so the cast is at
 * this boundary rather than a narrowing that would make the local answer differ
 * from the remote one.
 */
function toWire(habits: HealthHabitWithStreak[]): HealthHabit[] {
  return habits as unknown as HealthHabit[];
}

/**
 * A rejection shaped like the Worker's 404 (`routes/health.ts:843, 853, 866`).
 *
 * `writeThrough` reads `error.response.status` to decide whether a failed write
 * earns an outbox retry (`healthRepository.ts:434-438`); a bare `Error` has no
 * status, reads as a lost connection, and re-queues forever.
 */
function notFound(message: string): Error {
  const error = new Error(message) as Error & {
    response: { status: number; data: { error: { code: string; message: string } } };
  };
  error.response = { status: 404, data: { error: { code: 'not_found', message } } };
  return error;
}

/* ------------------------------------------------------------------ */
/* The facade                                                          */
/* ------------------------------------------------------------------ */

export const localHabitsApi = {
  /**
   * `GET /health/habits` — `listHabits` (`health-service.ts:1508`).
   *
   * `includeArchived` is what makes an archived habit unarchivable again:
   * archiving is the donor's only "deactivate" verb, so an archived habit has to
   * stay reachable without counting towards today's ring. The default stays
   * `false`, matching the route's `include_archived === 'true'` check.
   */
  listHabits: async (params?: {
    includeArchived?: boolean;
  }): Promise<{ habits: HealthHabit[] }> => ({
    habits: toWire(habitList(params?.includeArchived === true, localDateKey())),
  }),

  /**
   * `POST /health/habits` — `createHabit` (`:1560`).
   *
   * Every default is the service's own: `icon` → `'goals'`, `category` →
   * `'custom'`, `time_of_day` → `'anytime'`, `frequency` → `'daily'`,
   * `reminder_enabled` → false, `is_archived` → false. A habit created offline
   * must be indistinguishable from one created online, because the Habits screen
   * groups by `time_of_day` and filters on `frequency`.
   *
   * `custom_days` is persisted ONLY when the frequency is `custom`, so a habit
   * switched back to daily cannot leave a stale day set behind to be re-read if
   * it is switched to custom again.
   *
   * The reminder rows the route re-materialises (`syncHabitReminders`) are He3d's
   * business — a local scheduler, not a Worker call — and deliberately not
   * invoked from here.
   */
  createHabit: async (
    body: HealthHabitWrite & { name: string },
  ): Promise<{ habit: HealthHabit }> => {
    const timestamp = nowIso();
    const frequency = body.frequency ?? 'daily';
    const row: LocalUserHabit = {
      id: newLocalId('habit'),
      user_id: activeUserId(),
      template_id: body.template_id ?? null,
      name: body.name,
      icon: body.icon ?? 'goals',
      category: body.category ?? 'custom',
      time_of_day: body.time_of_day ?? 'anytime',
      frequency,
      custom_days: frequency === 'custom' ? serializeCustomDays(body.custom_days) : null,
      reminder_time: body.reminder_time ?? null,
      reminder_enabled: toLedgerBoolean(body.reminder_enabled ?? false),
      target_duration: body.target_duration ?? null,
      notes: body.notes ?? null,
      is_archived: 0,
      // `count(*)` over EVERY row for the user, tombstones included — the
      // service's own query carries no `deleted_at` filter (`:1563-1567`), so a
      // deleted habit still consumes an ordinal. Reproduced rather than
      // "fixed": changing it here would give the two devices different orders.
      sort_order: body.sort_order ?? allRowsOf<LocalUserHabit>('userHabits').length,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    };

    await writeLocal(
      (draft) => {
        draft.userHabits.push(row);
      },
      {
        opType: 'HABIT_CREATE',
        entityType: 'user_habit',
        entityId: row.id,
        payload: row,
      },
    );

    return { habit: toWire([singleHabit(row, localDateKey())])[0] };
  },

  /**
   * `PUT /health/habits/:id` — `updateHabit` (`:1615`).
   *
   * Absent keys are left alone; an explicit `null` clears the column. That
   * distinction is what lets the app clear a reminder time without re-sending
   * every other field.
   *
   * The frequency and its day set move TOGETHER, which is the one non-obvious
   * rule here: leaving `custom_days` behind after a switch to `daily` would
   * resurrect a schedule the member replaced the next time they switch back.
   *
   * 404s on an unknown or tombstoned id — the service's ownership lookup filters
   * `deleted_at` here (unlike `toggleHabit`'s, see the header).
   */
  updateHabit: async (
    id: string,
    body: HealthHabitWrite,
  ): Promise<{ habit: HealthHabit; habits: HealthHabit[] }> => {
    const owned = habitRows().find((row) => row.id === id);
    // Validated BEFORE the mutator: `mutateLocalHealthLedger` mutates the live
    // ledger in place (`engine.ts:930-932`), so a throw from inside the mutator
    // leaves a half-applied edit with no op to describe it.
    if (!owned) throw notFound('Habit not found');

    const timestamp = nowIso();
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.category !== undefined) patch.category = body.category;
    if (body.template_id !== undefined) patch.template_id = body.template_id;
    if (body.time_of_day !== undefined) patch.time_of_day = body.time_of_day;
    if (body.target_duration !== undefined) patch.target_duration = body.target_duration;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.is_archived !== undefined) patch.is_archived = toLedgerBoolean(body.is_archived);
    if (body.sort_order !== undefined) patch.sort_order = body.sort_order;
    if (body.reminder_time !== undefined) patch.reminder_time = body.reminder_time;
    if (body.reminder_enabled !== undefined) {
      patch.reminder_enabled = toLedgerBoolean(body.reminder_enabled);
    }

    const frequency = body.frequency ?? owned.frequency;
    if (body.frequency !== undefined) patch.frequency = body.frequency;
    if (body.frequency !== undefined || body.custom_days !== undefined) {
      patch.custom_days =
        frequency === 'custom'
          ? serializeCustomDays(body.custom_days ?? parseStoredCustomDays(owned.custom_days))
          : null;
    }

    await writeLocal(
      (draft) => {
        const row = draft.userHabits.find((candidate) => candidate.id === id);
        if (!row) return;
        Object.assign(row, patch);
        row.updated_at = timestamp;
      },
      {
        opType: 'HABIT_UPDATE',
        entityType: 'user_habit',
        entityId: id,
        payload: { id, ...patch },
      },
    );

    const updated = habitRows().find((row) => row.id === id);
    if (!updated) throw notFound('Habit not found');

    const today = localDateKey();
    return {
      habit: toWire([singleHabit(updated, today)])[0],
      // The route re-lists with `includeArchived: true` (`routes/health.ts:846`)
      // so the screen can repaint the archive toggle it just flipped.
      habits: toWire(habitList(true, today)),
    };
  },

  /**
   * `DELETE /health/habits/:id` — a TOMBSTONE, not a splice.
   *
   * The habit's LOGS are deliberately left alone, exactly as the service leaves
   * them (`:1655-1666` tombstones `user_habits` only). They become unreachable
   * because `computeHabitList` maps logs onto habits that exist, and reviving
   * the habit would revive its history — which is the behaviour shipping today.
   *
   * Removing the row outright would let a peer device's older copy resurrect it
   * on the next merge: LWW has nothing to compare a missing row against.
   */
  deleteHabit: async (id: string): Promise<{ deleted: boolean }> => {
    const existing = habitRows().find((row) => row.id === id);
    if (!existing) throw notFound('Habit not found');

    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.userHabits.find((candidate) => candidate.id === id);
        if (!row) return;
        row.deleted_at = timestamp;
        row.updated_at = timestamp;
      },
      {
        opType: 'HABIT_DELETE',
        entityType: 'user_habit',
        entityId: id,
        payload: { id, deleted_at: timestamp },
      },
    );

    return { deleted: true };
  },

  /**
   * `POST /health/habits/:id/toggle` — `toggleHabit` (`:1679`).
   *
   * **The deterministic-id write.** Three branches, decided by
   * `summaries.resolveHabitToggle` (pure, and deliberately not minting the id):
   *
   *  - a LIVE log for `(habit, date)` → tombstone it, `{ done: false }`;
   *  - a TOMBSTONED one → revive it and re-stamp `completed_at`,
   *    `{ done: true }`, **reusing its existing id**;
   *  - none → create, with `healthDeterministicIds.habitLog(habitId, date)`.
   *
   * Both lookups run over `allRowsOf` — tombstones INCLUDED, and unwindowed. See
   * rules 1 and 2 in the header: this is the single line in the file where using
   * `rowsOf` would mint a duplicate deterministic id that no later merge can
   * ever separate. It is also why the match is on `(habit_id, date)` and not on
   * the id — a log that arrived from D1 at cutover carries a server-minted
   * `hl_*` id and must still be found.
   *
   * The id is never hand-formatted. `ids.ts` owns the format and
   * `registryGuard.test.ts` proves the table has a registered builder.
   */
  toggleHabit: async (
    id: string,
    date: string,
  ): Promise<{ done: boolean; habits: HealthHabit[] }> => {
    // The one deterministic-id write in this file that can address an arbitrary
    // day — the Habits grid ticks back over a calendar. If that day's logs are
    // outside the resident window the lookup below finds nothing, takes the
    // `create` branch, and mints a row on an id that ALREADY EXISTS on disk:
    // an upsert whose fields all carry this op's stamp, so it silently
    // overwrites whatever the row held. Widening first is what makes the
    // revive-vs-create decision see the row it is deciding about.
    await ensureResident([{ table: 'habitLogs', from: date, to: date }]);

    const timestamp = nowIso();
    const outcome = resolveHabitToggle({
      // Tombstones included, on purpose and in both cases — see the header.
      habits: allRowsOf<LocalUserHabit>('userHabits'),
      logs: allRowsOf<LocalHabitLog>('habitLogs'),
      habitId: id,
      date,
      now: timestamp,
      userId: activeUserId(),
    });

    if (outcome.kind === 'not_found') throw notFound('Habit not found');

    if (outcome.kind === 'create') {
      const logId = healthDeterministicIds.habitLog(id, date);
      const row: LocalHabitLog = { ...outcome.row, id: logId };
      await writeLocal(
        (draft) => {
          draft.habitLogs.push(row);
        },
        {
          opType: 'HABIT_LOG_CREATE',
          entityType: 'habit_log',
          entityId: logId,
          payload: row,
        },
      );
    } else {
      const { logId, patch } = outcome;
      await writeLocal(
        (draft) => {
          const row = draft.habitLogs.find((candidate) => candidate.id === logId);
          if (!row) return;
          Object.assign(row, patch);
        },
        {
          opType: outcome.kind === 'untick' ? 'HABIT_LOG_DELETE' : 'HABIT_LOG_RESTORE',
          entityType: 'habit_log',
          entityId: logId,
          payload: { id: logId, habit_id: id, date, ...patch },
        },
      );
    }

    // The route answers with the freshly re-derived list so the ring updates
    // without a second request — and with the DEFAULT filter, not the archived
    // one (`routes/health.ts:868`).
    return { done: outcome.done, habits: toWire(habitList(false, localDateKey())) };
  },
};

export default localHabitsApi;
