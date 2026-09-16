/**
 * Symply Health — the habit SCHEDULE, PRESET and STATISTICS helpers.
 *
 * These landed with the donor-parity port on 2026-07-26 and are the arithmetic
 * the whole tab now rests on. Every one of them fails SILENTLY: a weekday
 * numbering that is off by one does not crash, it just marks a member absent on
 * the wrong day; a completion rate that expects days before the habit existed
 * does not throw, it just tells a diligent member they are at 40%.
 *
 * The Apple weekday numbering (1 = Sunday … 7 = Saturday) is the single most
 * dangerous constant here: it is shared with the Worker, with `custom_days` in
 * D1, and with the donor's stored rows, and JavaScript's own `getUTCDay()` is
 * 0-based. Half the cases below exist to pin it.
 *
 * Everything is asserted against the shipped implementation. Nothing here needs
 * a network, a screen or a clock beyond the pinned one.
 */

import { healthApi, type HealthHabit } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  addHabitFromTemplate,
  categoryIcon,
  categoryLabel,
  completionCounts,
  completionRate,
  completionSeries,
  HABIT_ICON_CHOICES,
  HABIT_TEMPLATES,
  habitCompletionRate,
  habitHistory,
  habitTemplateCategories,
  isDoneOn,
  isScheduledOn,
  lastDaysStatus,
  loadHabit,
  loadHabits,
  longestStreakOf,
  normalizeReminderTime,
  scheduleSummary,
  searchHabitTemplates,
  setHabitArchived,
  streakLeaderboard,
  streakOf,
  timeOfDayLabel,
  updateHabit,
  weekdayOf,
  type Habit,
} from '../../healthHabitsStorage';
import { __setHealthOfflineForTests, clearHealthCache } from '../../healthRepository';
import {
  habitRow,
  installHealthApiDefaults,
  ok,
  type MockedHealthApi,
} from '../../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

/** Monday. Sunday is 2026-07-12 and Saturday is 2026-07-11. */
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';
const SUNDAY = '2026-07-12';
const SATURDAY = '2026-07-11';

/** A whole habit — spread LAST so a newly added column fails here, not silently. */
function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'sleep',
    name: 'Sleep 7+ hours',
    icon: 'sleep-habit',
    category: 'custom',
    templateId: null,
    timeOfDay: 'anytime',
    frequency: 'daily',
    customDays: null,
    reminderTime: null,
    reminderEnabled: false,
    targetDuration: null,
    notes: null,
    archived: false,
    sortOrder: 0,
    days: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

function fakeHabitServer(seed: HealthHabit[] = []): { habits: HealthHabit[] } {
  const state = { habits: [...seed] };
  api.listHabits.mockImplementation(() => Promise.resolve(ok({ habits: [...state.habits] })));
  api.createHabit.mockImplementation((body) => {
    const created = habitRow({
      id: `srv-${state.habits.length + 1}`,
      name: body.name,
      icon: body.icon ?? 'goals',
      sort_order: state.habits.length,
    });
    state.habits.push(created);
    return Promise.resolve(ok({ habit: created }));
  });
  return state;
}

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]);
  __setHealthOfflineForTests(false);
  jest.resetAllMocks();
  installHealthApiDefaults(api);
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Weekday numbering + schedules                                       */
/* ------------------------------------------------------------------ */

describe('habit schedules — the Apple weekday numbering', () => {
  it('HEALTH-HABIT-201: weekdayOf is 1-based from SUNDAY, and parses the key as UTC', () => {
    // 1 = Sunday, matching `custom_days` in D1, the Worker's own rule and the
    // donor's stored rows. JavaScript's getUTCDay() is 0-based from Sunday, so
    // the +1 is load-bearing: dropping it shifts every custom schedule by a day.
    expect(weekdayOf(SUNDAY)).toBe(1);
    expect(weekdayOf(TODAY)).toBe(2); // Monday
    expect(weekdayOf(SATURDAY)).toBe(7);

    // Parsed as UTC on purpose — a date KEY has no time zone, and local parsing
    // would move the weekday across midnight for anyone east or west of it.
    expect(weekdayOf('2026-01-01')).toBe(5); // a Thursday
    // A malformed key answers Sunday rather than NaN: the callers index arrays
    // and compare numbers with it, and NaN would silently hide every habit.
    expect(weekdayOf('not-a-date')).toBe(1);
  });

  it('HEALTH-HABIT-202: daily, weekdays and weekends resolve against the real calendar', () => {
    expect(isScheduledOn(habit({ frequency: 'daily' }), SUNDAY)).toBe(true);

    expect(isScheduledOn(habit({ frequency: 'weekdays' }), TODAY)).toBe(true); // Monday
    expect(isScheduledOn(habit({ frequency: 'weekdays' }), SATURDAY)).toBe(false);
    expect(isScheduledOn(habit({ frequency: 'weekdays' }), SUNDAY)).toBe(false);

    expect(isScheduledOn(habit({ frequency: 'weekends' }), SATURDAY)).toBe(true);
    expect(isScheduledOn(habit({ frequency: 'weekends' }), SUNDAY)).toBe(true);
    expect(isScheduledOn(habit({ frequency: 'weekends' }), TODAY)).toBe(false);
  });

  it('HEALTH-HABIT-203: a custom schedule with no days falls back to "every day", never to none', () => {
    const monWedFri = habit({ frequency: 'custom', customDays: [2, 4, 6] });
    expect(isScheduledOn(monWedFri, TODAY)).toBe(true); // Monday = 2
    expect(isScheduledOn(monWedFri, SUNDAY)).toBe(false);

    // The dangerous corner: `custom` with an empty or absent day set. Treating
    // it as "no days" would make the habit vanish from EVERY day — invisible,
    // untickable, and impossible to fix from a list it is not in.
    expect(isScheduledOn(habit({ frequency: 'custom', customDays: [] }), TODAY)).toBe(true);
    expect(isScheduledOn(habit({ frequency: 'custom', customDays: null }), SUNDAY)).toBe(true);
  });

  it('HEALTH-HABIT-204: the schedule summary is plain language, and custom days are named', () => {
    expect(scheduleSummary(habit({ frequency: 'daily' }))).toBe('Every day');
    expect(scheduleSummary(habit({ frequency: 'weekdays' }))).toBe('Monday to Friday');
    expect(scheduleSummary(habit({ frequency: 'weekends' }))).toBe('Saturday and Sunday');

    // Sorted, so the caption reads in week order however the picker filed them.
    expect(scheduleSummary(habit({ frequency: 'custom', customDays: [6, 2, 4] }))).toBe(
      'Mon, Wed, Fri',
    );
    // Custom with nothing chosen matches what `isScheduledOn` actually does.
    expect(scheduleSummary(habit({ frequency: 'custom', customDays: null }))).toBe(
      'On the days you pick',
    );
  });

  it('HEALTH-HABIT-205: an unrecognised frequency from a stale/future server row degrades to "Every day"', () => {
    // `fromRow` passes `row.frequency` through with no server-side validation
    // — a value this build does not know about (added server-side later, or a
    // hand-edited row) must not throw building the caption; it degrades to
    // the same wording a genuinely daily habit gets.
    const unknown = habit({ frequency: 'fortnightly' as unknown as Habit['frequency'] });
    expect(scheduleSummary(unknown)).toBe('Every day');
  });
});

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

describe('habit statistics', () => {
  it('HEALTH-HABIT-205: the longest streak is the best run EVER, not the live one', () => {
    // A member whose current run is 1 has still earned their record of 3. The
    // live `streakOf` anchors on today; this one does not anchor at all.
    expect(longestStreakOf(['2026-07-13', '2026-07-05', '2026-07-04', '2026-07-03'])).toBe(3);
    expect(longestStreakOf([])).toBe(0);
    expect(longestStreakOf(['2026-07-13'])).toBe(1);
    // Unsorted and duplicated input is normal (an offline merge can produce
    // both); the run must not be double-counted or broken by ordering.
    expect(longestStreakOf(['2026-07-04', '2026-07-03', '2026-07-04', '2026-07-05'])).toBe(3);
    // A month boundary is a real day boundary, not a reset.
    expect(longestStreakOf(['2026-06-30', '2026-07-01', '2026-07-02'])).toBe(3);
  });

  it('HEALTH-HABIT-206: today’s counts exclude archived and unscheduled habits', () => {
    const habits = [
      habit({ id: 'daily-done', days: [TODAY] }),
      habit({ id: 'daily-todo' }),
      habit({ id: 'weekend', frequency: 'weekends' }), // not due on a Monday
      habit({ id: 'archived', archived: true, days: [TODAY] }), // out of the picture
    ];

    // 1 of 2, not 1 of 4 and not 2 of 4: an archived habit is neither a win nor
    // a miss, and a habit that is not due today cannot be missed today.
    expect(completionCounts(habits, TODAY)).toEqual({ done: 1, total: 2 });
    // No habits due at all is 0/0 rather than a divide — see the rate below.
    expect(completionCounts([habit({ frequency: 'weekends' })], TODAY)).toEqual({
      done: 0,
      total: 0,
    });
  });

  it('HEALTH-HABIT-207: a habit is not marked down for days before it existed', () => {
    // Created three days ago, ticked on both days it has existed for.
    const fresh = habit({
      createdAt: '2026-07-11T09:00:00.000Z',
      days: [TODAY, '2026-07-12'],
    });

    const stats = habitCompletionRate(fresh, 30, TODAY);

    // 30-day window, but only 3 days of existence — expecting 30 would tell a
    // member who has never missed that they are at 10%.
    expect(stats.expected).toBe(3);
    expect(stats.completed).toBe(2);
    expect(stats.rate).toBeCloseTo(2 / 3, 10);
  });

  it('HEALTH-HABIT-208: an unscheduled day is not expected, and no expected days is 0 not NaN', () => {
    const weekendsOnly = habit({
      frequency: 'weekends',
      createdAt: '2026-06-01T00:00:00.000Z',
      days: [SUNDAY, SATURDAY],
    });

    // Seven days back from Monday contains exactly one Saturday and one Sunday.
    const week = habitCompletionRate(weekendsOnly, 7, TODAY);
    expect(week).toEqual({ rate: 1, completed: 2, expected: 2 });

    // A window with nothing due divides by zero unless it is guarded — the
    // detail screen prints this straight into a percentage.
    const noneDue = habitCompletionRate(habit({ frequency: 'weekends' }), 1, TODAY);
    expect(noneDue).toEqual({ rate: 0, completed: 0, expected: 0 });
    expect(Number.isNaN(noneDue.rate)).toBe(false);
  });

  it('HEALTH-HABIT-209b: with no createdAt at all (a legacy cache row) the whole window is "always existed", and the 30-day/today defaults hold', () => {
    // `Habit.createdAt` is typed as `string`, but nothing at runtime enforces
    // that on an offline-cached row written before this field existed — the
    // `?? ''` here is what stands between that and every day in the window
    // being silently dropped as "before the habit existed".
    const noCreatedAt = { ...habit(), createdAt: undefined as unknown as string };
    // Called with ONLY the habit — exercises the 30-day window and "today"
    // defaults together, which every other call site pins explicitly. Daily
    // + no createdAt ⇒ every one of the 30 days is expected, none completed
    // (the default `habit()` has no ticked days).
    expect(habitCompletionRate(noCreatedAt)).toEqual({ rate: 0, completed: 0, expected: 30 });
  });

  it('HEALTH-HABIT-209: the completion series is one point per day, oldest-first', () => {
    const habits = [habit({ id: 'a', days: [TODAY] }), habit({ id: 'b' })];

    const series = completionSeries(habits, 3, TODAY);

    // The chart plots it left-to-right, so the order IS the contract: reversed,
    // every member's trend line would read backwards and look like a collapse.
    expect(series.map((p) => p.date)).toEqual([SATURDAY, SUNDAY, TODAY]);
    expect(series.map((p) => p.rate)).toEqual([0, 0, 0.5]);
  });

  it('HEALTH-HABIT-210: the leaderboard ranks by best-ever streak and drops the empty ones', () => {
    const rows = streakLeaderboard(
      [
        habit({ id: 'one', name: 'One', days: ['2026-07-13'] }),
        habit({ id: 'three', name: 'Three', days: ['2026-07-13', '2026-07-12', '2026-07-11'] }),
        habit({ id: 'never', name: 'Never' }), // no history at all
        habit({ id: 'archived', name: 'Archived', archived: true, days: ['2026-07-13'] }),
      ],
      2,
    );

    // Highest first, capped at the limit, and a habit with no run at all is
    // absent rather than listed at 0 — a leaderboard of zeroes is noise.
    expect(rows.map((r) => [r.habit.id, r.streak])).toEqual([
      ['three', 3],
      ['one', 1],
    ]);
    expect(streakLeaderboard([habit({ id: 'never' })])).toEqual([]);
  });

  it('HEALTH-HABIT-211: the history strip marks unscheduled days as unscheduled, not missed', () => {
    const weekdays = habit({ frequency: 'weekdays', days: [TODAY] });

    const history = habitHistory(weekdays, 3, TODAY);

    // Sat + Sun are not misses for a weekdays habit. Rendering them as empty
    // dots with no distinction is how a member reads a perfect week as 5/7.
    expect(history).toEqual([
      { date: SATURDAY, done: false, scheduled: false },
      { date: SUNDAY, done: false, scheduled: false },
      { date: TODAY, done: true, scheduled: true },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* The preset library                                                  */
/* ------------------------------------------------------------------ */

describe('the habit preset library', () => {
  it('HEALTH-HABIT-212: every preset is complete, uniquely identified and drawable', () => {
    expect(HABIT_TEMPLATES).toHaveLength(19);
    expect(new Set(HABIT_TEMPLATES.map((t) => t.id)).size).toBe(19);

    // Collected rather than asserted one at a time so a failure NAMES the
    // offending preset instead of stopping at the first bad row.
    const offered = habitTemplateCategories().map((c) => c.value);
    const unnamed = HABIT_TEMPLATES.filter((t) => t.name.length === 0 || t.description.length === 0);
    // An icon that is not a kit key renders as a flat Ionicons glyph in the
    // middle of a brushed list.
    const undrawable = HABIT_TEMPLATES.filter((t) => !HABIT_ICON_CHOICES.includes(t.icon));
    // A preset in a category the browser does not offer is reachable by search
    // only — invisible to anyone who browses.
    const unreachable = HABIT_TEMPLATES.filter((t) => !offered.includes(t.category));

    expect(unnamed.map((t) => t.id)).toEqual([]);
    expect(undrawable.map((t) => `${t.id}:${t.icon}`)).toEqual([]);
    expect(unreachable.map((t) => `${t.id}:${t.category}`)).toEqual([]);
  });

  it('HEALTH-HABIT-213: only categories that HAVE a preset are offered as filters', () => {
    const values = habitTemplateCategories().map((c) => c.value);

    // The donor lists all nine and its `nutrition` chip yields an empty list. A
    // filter that can only ever answer "nothing" is a defect, not a feature.
    expect(values).not.toContain('nutrition');
    expect(values).not.toContain('custom');
    // Order is HABIT_CATEGORIES' order, not the presets' — the chip row must be
    // stable between renders rather than following whatever the member added.
    expect(values).toEqual([
      'dental',
      'skincare',
      'hygiene',
      'wellness',
      'fitness',
      'sleep',
      'mindfulness',
    ]);
  });

  it('HEALTH-HABIT-214: search matches name, description and category label, case-insensitively', () => {
    // Name.
    expect(searchHabitTemplates('FLOSS').map((t) => t.id)).toEqual(['floss']);
    // Description — "grateful" appears only in the gratitude preset's copy.
    expect(searchHabitTemplates('grateful').map((t) => t.id)).toEqual(['gratitude']);
    // Category LABEL, not the raw value, so a member typing what they see finds it.
    expect(searchHabitTemplates('dental').map((t) => t.id)).toEqual([
      'brush_teeth_morning',
      'brush_teeth_evening',
      'floss',
      'mouthwash',
    ]);
    // A blank query is "show everything", not "match nothing".
    expect(searchHabitTemplates('  ')).toHaveLength(19);
    expect(searchHabitTemplates('zzzz')).toEqual([]);
  });

  it('HEALTH-HABIT-215: the category facet and the query narrow TOGETHER', () => {
    expect(searchHabitTemplates('', 'sleep').map((t) => t.id)).toEqual([
      'no_screens',
      'sleep_schedule',
    ]);
    // Both filters apply: "wash" matches three presets, but only one is hygiene.
    expect(searchHabitTemplates('wash', 'hygiene').map((t) => t.id)).toEqual(['wash_hands']);
    expect(searchHabitTemplates('floss', 'sleep')).toEqual([]);
  });

  it('HEALTH-HABIT-216: adding from a preset carries its whole shape, and overrides win', async () => {
    fakeHabitServer([habitRow({ id: 'existing' })]);
    const meditate = HABIT_TEMPLATES.find((t) => t.id === 'meditate')!;

    await addHabitFromTemplate(meditate);

    // The preset IS the value: its category drives the icon fallback, its time
    // of day drives the filter, and `template_id` is what stops the member
    // adding the same preset twice.
    expect(api.createHabit).toHaveBeenCalledWith({
      name: 'Meditate',
      icon: 'mindfulness',
      category: 'mindfulness',
      template_id: 'meditate',
      time_of_day: 'morning',
      frequency: 'daily',
      target_duration: 600,
    });

    api.createHabit.mockClear();
    await addHabitFromTemplate(meditate, { name: 'Evening sit', timeOfDay: 'evening' });
    expect(api.createHabit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Evening sit', time_of_day: 'evening', template_id: 'meditate' }),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Reminder time + the write mapper                                    */
/* ------------------------------------------------------------------ */

describe('habit reminders and the write mapper', () => {
  it('HEALTH-HABIT-217: a reminder time is normalised to HH:MM, or dropped entirely', () => {
    expect(normalizeReminderTime('7:05')).toBe('07:05');
    expect(normalizeReminderTime('  21:30  ')).toBe('21:30');
    expect(normalizeReminderTime('00:00')).toBe('00:00');
    expect(normalizeReminderTime('23:59')).toBe('23:59');

    // Out of range and malformed both become null rather than reaching the
    // Worker: the reminder rows are materialised from this string, so "25:00"
    // would either throw in the scheduler or silently never fire.
    expect(normalizeReminderTime('24:00')).toBeNull();
    expect(normalizeReminderTime('12:60')).toBeNull();
    expect(normalizeReminderTime('7am')).toBeNull();
    expect(normalizeReminderTime('')).toBeNull();
    expect(normalizeReminderTime(null)).toBeNull();
    expect(normalizeReminderTime(undefined)).toBeNull();
  });

  it('HEALTH-HABIT-218: a patch sends only the fields it names, cleaned', async () => {
    fakeHabitServer([habitRow({ id: 'h1', name: 'Stretch' })]);

    await updateHabit('h1', {
      name: '   Evening stretch   ',
      customDays: [6, 2, 2, 9, 4],
      reminderTime: '7:5',
      notes: '   ',
    });

    const [id, body] = api.updateHabit.mock.calls[0];
    expect(id).toBe('h1');
    // Absent = leave. Sending the untouched columns back would let a stale
    // cached copy overwrite an edit made on another device.
    expect(body).toEqual({
      name: 'Evening stretch',
      // Deduped, sorted and bounded to 1…7 — `9` is not a weekday and would
      // match nothing, hiding the habit from every day.
      custom_days: [2, 4, 6],
      // '7:5' has a one-digit minute and is refused rather than guessed at.
      reminder_time: null,
      // Whitespace-only notes collapse to null, so the detail screen shows the
      // placeholder rather than a blank block that looks like a rendering bug.
      notes: null,
    });
  });

  it('HEALTH-HABIT-219: clearing a schedule is expressible — null is sent, not dropped', async () => {
    fakeHabitServer([habitRow({ id: 'h1' })]);

    await updateHabit('h1', { customDays: null, reminderEnabled: false, targetDuration: null });

    // `undefined` means "leave" and `null` means "clear", so the two must not
    // collapse: a member turning a custom schedule back to daily has to be able
    // to erase the day set, not merely stop sending it.
    expect(api.updateHabit.mock.calls[0][1]).toEqual({
      custom_days: null,
      reminder_enabled: false,
      target_duration: null,
    });
  });

  it('HEALTH-HABIT-219b: notes explicitly cleared with null are sent as null, not blanked to a stale string', async () => {
    fakeHabitServer([habitRow({ id: 'h1' })]);

    await updateHabit('h1', { notes: null });

    // `notes` present-but-null is the "clear it" form (distinct from the
    // whitespace-collapses-to-null path in HEALTH-HABIT-218): both must land
    // on the wire as `null`, never as the literal string "null".
    expect(api.updateHabit.mock.calls[0][1]).toEqual({ notes: null });
  });

  it('HEALTH-HABIT-220: a habit row with a broken custom_days column reads as "every day"', async () => {
    api.listHabits.mockResolvedValue(
      ok({
        habits: [
          habitRow({ id: 'bad-json', frequency: 'custom', custom_days: '{oops' }),
          habitRow({ id: 'not-array', frequency: 'custom', custom_days: '"2,4"' }),
          habitRow({ id: 'empty', frequency: 'custom', custom_days: '[]' }),
          habitRow({ id: 'out-of-range', frequency: 'custom', custom_days: '[0, 9, 3, 3]' }),
          habitRow({ id: 'unsorted', frequency: 'custom', custom_days: '[6, 2, 4]' }),
        ],
      }),
    );

    const habits = await loadHabits();
    const byId = Object.fromEntries(habits.map((h) => [h.id, h]));

    // `custom_days` is a JSON STRING in D1, so anything can be in it — a failed
    // parse must not throw on the very first read of the tab, and must not
    // leave the habit scheduled on no day at all.
    expect(byId['bad-json'].customDays).toBeNull();
    expect(byId['not-array'].customDays).toBeNull();
    expect(byId.empty.customDays).toBeNull();
    // Out-of-range values are dropped and the rest deduped and sorted. `0` and
    // `9` are not weekdays; keeping them would leave a day set that matches
    // nothing on some rows.
    expect(byId['out-of-range'].customDays).toEqual([3]);
    // A genuinely valid, multi-day column still comes back in WEEK order, not
    // column order — the picker and the summary caption both assume it.
    expect(byId.unsorted.customDays).toEqual([2, 4, 6]);

    // The three that degraded to null are due TODAY: a habit nobody can see is
    // worse than one shown on a day it was not asked for.
    for (const id of ['bad-json', 'not-array', 'empty']) {
      expect(isScheduledOn(byId[id], TODAY)).toBe(true);
    }
    // The salvaged one keeps the day it could actually parse — Tuesday (3) —
    // rather than being widened to every day.
    expect(isScheduledOn(byId['out-of-range'], TODAY)).toBe(false); // Monday
    expect(isScheduledOn(byId['out-of-range'], '2026-07-14')).toBe(true); // Tuesday
  });

  it('HEALTH-HABIT-222: one habit reads from the same cached list every screen reads', async () => {
    fakeHabitServer([habitRow({ id: 'h1', name: 'Stretch' }), habitRow({ id: 'h2', name: 'Walk' })]);

    // The detail screen resolves its habit through `loadHabit`, so it must be
    // the SAME snapshot the list rendered — a second, independently fetched row
    // is how a detail sheet ends up showing a stale tick.
    expect((await loadHabit('h2'))?.name).toBe('Walk');
    // A habit deleted on another device answers null rather than throwing on
    // the caller's `.name` — the detail is opened from an id, not an object.
    expect(await loadHabit('gone')).toBeNull();
  });

  it('HEALTH-HABIT-223: archiving is a patch of one flag, and unarchiving is the same call', async () => {
    fakeHabitServer([habitRow({ id: 'h1', name: 'Stretch' })]);

    await setHabitArchived('h1', true);
    expect(api.updateHabit.mock.calls[0][1]).toEqual({ is_archived: true });

    await setHabitArchived('h1', false);
    // Reversible by construction: the same route, the same column, the other
    // value. Archive is the donor's only "deactivate" verb and must not be a
    // one-way door dressed up as one.
    expect(api.updateHabit.mock.calls[1][1]).toEqual({ is_archived: false });
  });

  it('HEALTH-HABIT-224: every helper defaults to TODAY when no day is passed', () => {
    // The screens pass an explicit day (they have a date selector); the widget,
    // the Home tab and the detail sheet do not. The defaulted call is therefore
    // a real caller, and a default computed once at module load — rather than
    // per call — would freeze the whole tab on the day the app was launched.
    const daily = habit({ days: [TODAY] });

    expect(streakOf([TODAY])).toBe(1);
    expect(isDoneOn(daily)).toBe(true);
    expect(isScheduledOn(habit({ frequency: 'weekends' }))).toBe(false); // today is Monday
    expect(lastDaysStatus(daily, 2)).toEqual([false, true]);
    expect(habitHistory(daily, 1)).toEqual([{ date: TODAY, done: true, scheduled: true }]);
    expect(completionRate([daily])).toBe(1);
    expect(completionCounts([daily])).toEqual({ done: 1, total: 1 });
    expect(habitCompletionRate(daily, 1).expected).toBe(1);
    expect(completionSeries([daily], 1)).toEqual([{ date: TODAY, rate: 1 }]);
  });

  it('HEALTH-HABIT-225: a habit with blank columns still renders something drawable', async () => {
    api.listHabits.mockResolvedValue(
      ok({ habits: [habitRow({ id: 'blank', icon: '', category: '', created_at: '' })] }),
    );

    const [loaded] = await loadHabits();

    // An empty string is not the same as a missing column, and `??` would let
    // it through: the row would render with no icon and an unlabelled category
    // chip. `||` is what makes a blank fall back.
    expect(loaded.icon).toBe('goals');
    expect(loaded.category).toBe('custom');
    // A missing createdAt must not make the window maths expect zero days —
    // it means "we do not know", which is treated as "always existed".
    expect(habitCompletionRate(loaded, 3, TODAY).expected).toBe(3);
    // A schedule summary must never render an empty caption, whatever the row
    // carries — including a day number no picker can produce.
    expect(scheduleSummary({ ...loaded, frequency: 'custom', customDays: [99] })).toBe('');
    expect(searchHabitTemplates(undefined as unknown as string)).toHaveLength(19);
  });

  it('HEALTH-HABIT-226: an offline edit still shows the member what they just changed', async () => {
    // A SECOND habit in the cache, deliberately untouched by this edit: the
    // optimistic patch maps over the whole list, and the id-mismatch arm of
    // that map is what keeps every other habit exactly as it was.
    const other = habit({ id: 'other', name: 'Drink water' });
    await storageHelpers.setObject('health.habits.v1', [
      habit({ id: 'h1', name: 'Stretch' }),
      other,
    ]);
    __setHealthOfflineForTests(true);

    const [edited, untouched] = await updateHabit('h1', {
      icon: 'walk',
      category: 'fitness',
      timeOfDay: 'evening',
      frequency: 'weekdays',
      targetDuration: 300,
      notes: '  after the school run  ',
      archived: true,
      reminderEnabled: true,
      reminderTime: '7:05',
    });

    // Editing a habit on a train has to LOOK like it worked; the cache keeps
    // the optimistic row until a successful read replaces it. Every column the
    // form can set is mirrored, or the edit half-appears and reads as a bug.
    expect(edited).toMatchObject({
      icon: 'walk',
      category: 'fitness',
      timeOfDay: 'evening',
      frequency: 'weekdays',
      targetDuration: 300,
      notes: '  after the school run  ',
      archived: true,
      reminderEnabled: true,
      reminderTime: '07:05', // normalised on the way in, even offline
    });
    expect(api.updateHabit).not.toHaveBeenCalled();
    // The other habit rode through the same `.map()` and came out identical.
    expect(untouched).toEqual(other);
  });

  it('HEALTH-HABIT-227: notes are trimmed but kept when they say something', async () => {
    fakeHabitServer([habitRow({ id: 'h1' })]);

    await updateHabit('h1', { notes: '  after the school run  ', reminderTime: '07:05' });

    expect(api.updateHabit.mock.calls[0][1]).toEqual({
      notes: 'after the school run',
      reminder_time: '07:05',
    });
  });

  it('HEALTH-HABIT-221: the category and time-of-day labels fall back rather than blank out', () => {
    expect(categoryLabel('dental')).toBe('Dental');
    expect(categoryIcon('fitness')).toBe('workouts');
    expect(timeOfDayLabel('morning')).toBe('Morning');

    // A row written by an older client (or the donor's own vocabulary) must not
    // render an empty chip or an Ionicons question mark.
    expect(categoryLabel('not-a-category')).toBe('Custom');
    expect(categoryIcon('not-a-category')).toBe('goals');
    expect(timeOfDayLabel('midnight' as never)).toBe('Anytime');
  });
});
