/**
 * Symply Health — Nutrition (donor "Meals" tab).
 *
 * Same three-layer approach as healthLocalStorage.test.ts: pure helpers run with
 * no I/O, the WIRE layer asserts the exact `/health/nutrition/*` payloads and
 * the `fromWireMeal` mapping (including the donor's `snack` ↔ app `snacks`
 * alias), and the OFFLINE layer proves the cached MMKV snapshot still renders a
 * diary when the request fails.
 *
 * `fakeNutritionServer` keeps a tiny row list because every writer re-reads the
 * diary after writing — a static list mock would report every add as lost.
 */

import { healthApi, type HealthNutritionEntry } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  addMealEntry,
  BULK_DELETE_FAILED_MESSAGE,
  copiedMessage,
  COPY_FAILED_MESSAGE,
  COPY_TOO_MANY_MESSAGE,
  copyMealEntriesTo,
  copyMealsFromDay,
  DEFAULT_NUTRITION_GOALS,
  deleteMealEntries,
  deleteMealEntry,
  formatDayKey,
  fromWireMealType,
  groupBySlot,
  HEALTH_MEALS_KEY,
  HEALTH_NUTRITION_GOALS_KEY,
  isMealSlot,
  loadMeals,
  loadMealsForDate,
  loadNutritionGoals,
  logScannedFoodsToDiary,
  MAX_BULK_ENTRIES,
  MEAL_SLOT_ICONS,
  MEAL_SLOT_LABELS,
  MEAL_SLOTS,
  NO_BASIS_MESSAGE,
  nothingToCopyMessage,
  parseAmountInput,
  parseCaloriesInput,
  parseMacroInput,
  partialDeleteMessage,
  reportionMealEntry,
  sanitizeAmountInput,
  saveNutritionGoals,
  SCAN_LOG_FAILED_MESSAGE,
  SCAN_NOTHING_TO_LOG_MESSAGE,
  SCAN_TOO_MANY_MESSAGE,
  scanLoggedMessage,
  shiftDateKey,
  sumNutrition,
  toWireMealType,
  updateMealEntry,
  type MealEntry,
  type ScannedFoodEntry,
} from '../healthNutritionStorage';
import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../healthRepository';
import {
  fakeGoalServer,
  goalRow,
  installHealthApiDefaults,
  NETWORK_ERROR,
  nutritionRow,
  ok,
  type MockedHealthApi,
} from '../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

// Fixed local noon: `todayDateKey()` === '2026-07-13' in every timezone.
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

function meal(over: Partial<MealEntry> = {}): MealEntry {
  return {
    id: over.id ?? 'm1',
    date: over.date ?? TODAY,
    slot: over.slot ?? 'lunch',
    name: over.name ?? 'Soup',
    calories: over.calories ?? 300,
    protein: over.protein ?? 10,
    carbs: over.carbs ?? 40,
    fat: over.fat ?? 5,
    loggedAt: over.loggedAt ?? '2026-07-13T10:00:00.000Z',
  };
}

/** Minimal stand-in for `/health/nutrition/entries` — create, delete, list. */
function fakeNutritionServer(): { rows: HealthNutritionEntry[] } {
  const state = { rows: [] as HealthNutritionEntry[] };
  api.createNutrition.mockImplementation((body) => {
    const row = nutritionRow({
      id: `srv-${state.rows.length + 1}`,
      date: body.date,
      food_name: body.food_name,
      meal_type: body.meal_type,
      calories: body.calories,
      proteins: body.proteins ?? 0,
      carbohydrates: body.carbohydrates ?? 0,
      fats: body.fats ?? 0,
      // Echoed with the route's own defaults (`health-service.ts` stores
      // `portion ?? 1`, `unit ?? 'serving'`, `food_id ?? null`). A fixture that
      // dropped these would make a copy of a library row look hand-typed.
      portion: body.portion ?? 1,
      unit: body.unit ?? 'serving',
      food_id: body.food_id ?? null,
      created_at: new Date().toISOString(),
    });
    state.rows.push(row);
    return Promise.resolve(ok({ entry: row }));
  });
  api.deleteNutrition.mockImplementation((id) => {
    const before = state.rows.length;
    state.rows = state.rows.filter((r) => r.id !== id);
    // The real route 404s an id it does not hold; the client must not count a
    // miss as a success.
    if (state.rows.length === before) return Promise.reject(httpError(404));
    return Promise.resolve(ok({ deleted: true }));
  });
  api.listNutrition.mockImplementation(() => Promise.resolve(ok({ entries: [...state.rows] })));

  // `created_at` has to be monotonic: the diary sorts on it, and rows written
  // inside one frozen-clock tick would order arbitrarily.
  api.bulkCreateNutrition.mockImplementation((body) => {
    const created = body.entries.map((entry, index) =>
      nutritionRow({
        id: `bulk-${state.rows.length + index + 1}`,
        date: entry.date,
        food_name: entry.food_name,
        meal_type: entry.meal_type,
        calories: entry.calories,
        proteins: entry.proteins ?? 0,
        carbohydrates: entry.carbohydrates ?? 0,
        fats: entry.fats ?? 0,
        portion: entry.portion ?? 1,
        unit: entry.unit ?? 'serving',
        food_id: entry.food_id ?? null,
        created_at: new Date(Date.now() + (state.rows.length + index) * 1000).toISOString(),
      })
    );
    state.rows.push(...created);
    return Promise.resolve(ok({ entries: created }));
  });

  /** Mirrors `copyNutritionDay` in health-service.ts: read, filter, re-file, APPEND. */
  api.copyNutritionDay.mockImplementation((body) => {
    const source = state.rows.filter(
      (r) => r.date === body.from_date && (!body.from_slot || r.meal_type === body.from_slot)
    );
    const base = state.rows.length;
    const created = source.map((row, index) =>
      nutritionRow({
        ...row,
        id: `copy-${base + index + 1}`,
        date: body.to_date,
        meal_type: body.to_slot ?? row.meal_type,
        created_at: new Date(Date.now() + (base + index) * 1000).toISOString(),
      })
    );
    state.rows.push(...created);
    return Promise.resolve(ok({ entries: created }));
  });

  return state;
}

/** A refusal from the Worker, carrying only an HTTP status (never a message). */
function httpError(status: number): Error & { response: { status: number } } {
  return Object.assign(new Error('Request failed'), { response: { status } });
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

describe('healthNutritionStorage — slot contract', () => {
  it('HEALTH-NUTR-001: exposes the four donor meal slots with a label and a kit icon each', () => {
    expect(MEAL_SLOTS).toEqual(['breakfast', 'lunch', 'dinner', 'snacks']);
    for (const slot of MEAL_SLOTS) {
      expect(MEAL_SLOT_LABELS[slot]).toBeTruthy();
      expect(MEAL_SLOT_ICONS[slot]).toBeTruthy();
    }
  });

  it('HEALTH-NUTR-002: isMealSlot only accepts the known slots', () => {
    expect(isMealSlot('breakfast')).toBe(true);
    expect(isMealSlot('supper')).toBe(false);
    expect(isMealSlot('')).toBe(false);
  });

  it('HEALTH-NUTR-024: translates the app\'s "snacks" to the donor\'s "snack" both ways', () => {
    // The donor schema's CHECK constraint is singular; the app has always shown
    // the plural. Sending 'snacks' would be rejected by D1 with a constraint
    // error, and receiving 'snack' unmapped would drop the row out of every
    // `groupBySlot` section.
    expect(toWireMealType('snacks')).toBe('snack');
    expect(fromWireMealType('snack')).toBe('snacks');

    // The other three slots are identical on both sides.
    for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
      expect(toWireMealType(slot)).toBe(slot);
      expect(fromWireMealType(slot)).toBe(slot);
    }
  });
});

describe('healthNutritionStorage — numeric input handling', () => {
  it('HEALTH-NUTR-003: sanitizeAmountInput keeps digits and one separator', () => {
    expect(sanitizeAmountInput('300')).toBe('300');
    expect(sanitizeAmountInput('3a0b0')).toBe('300');
    expect(sanitizeAmountInput('30.5.7')).toBe('30.57');
    expect(sanitizeAmountInput('30,5')).toBe('30,5');
    expect(sanitizeAmountInput(null as unknown as string)).toBe('');
  });

  it('HEALTH-NUTR-004: a blank optional amount is 0, not a rejection', () => {
    expect(parseAmountInput('', 100)).toBe(0);
    expect(parseMacroInput('   ')).toBe(0);
  });

  it('HEALTH-NUTR-005: rejects negative, non-numeric and out-of-range amounts', () => {
    expect(parseCaloriesInput('-1')).toBeNull();
    expect(parseCaloriesInput('abc')).toBeNull();
    expect(parseCaloriesInput('10001')).toBeNull(); // past the calorie bound
    expect(parseMacroInput('2001')).toBeNull(); // past the macro bound
    expect(parseAmountInput(null as unknown as string, 100)).toBeNull();
  });

  it('HEALTH-NUTR-006: rounds to whole units — grams and kcal are not fractional here', () => {
    expect(parseCaloriesInput('300,4')).toBe(300);
    expect(parseMacroInput('10.6')).toBe(11);
  });
});

describe('healthNutritionStorage — day math', () => {
  it('HEALTH-NUTR-007: shiftDateKey moves whole days across a month boundary', () => {
    expect(shiftDateKey('2026-07-13', -1)).toBe('2026-07-12');
    expect(shiftDateKey('2026-07-01', -1)).toBe('2026-06-30');
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDateKey('2026-07-13', 0)).toBe('2026-07-13');
  });

  it('HEALTH-NUTR-008: formatDayKey reads Today / Yesterday / the raw key', () => {
    expect(formatDayKey(TODAY)).toBe('Today');
    expect(formatDayKey('2026-07-12')).toBe('Yesterday');
    expect(formatDayKey('2026-07-01')).toBe('2026-07-01');
  });

  it('HEALTH-NUTR-157: a half-written day key still shifts to a real date', () => {
    // A key that lost its day (or its month) reaches this from a cached row or a
    // deep link. `new Date(2026, NaN, NaN)` is Invalid, and the day header would
    // then render the literal 'NaN-NaN-NaN' with no way back; falling back to the
    // 1st keeps the ◀ ▶ navigation on a real calendar.
    expect(shiftDateKey('2026-07', 0)).toBe('2026-07-01');
    expect(shiftDateKey('2026', 1)).toBe('2026-01-02');
  });
});

describe('healthNutritionStorage — totals + grouping', () => {
  it('HEALTH-NUTR-009: sums calories and macros across entries', () => {
    const totals = sumNutrition([
      meal({ calories: 300, protein: 10, carbs: 40, fat: 5 }),
      meal({ id: 'm2', calories: 200, protein: 20, carbs: 10, fat: 8 }),
    ]);
    expect(totals).toEqual({ calories: 500, protein: 30, carbs: 50, fat: 13 });
  });

  it('HEALTH-NUTR-010: treats a corrupt numeric field as zero rather than NaN', () => {
    const totals = sumNutrition([meal({ calories: NaN as unknown as number })]);
    expect(totals.calories).toBe(0);
  });

  it('HEALTH-NUTR-011: an empty day sums to zero, not to null', () => {
    expect(sumNutrition([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('HEALTH-NUTR-156: a corrupt MACRO is zero too, so one bad row cannot blank the day', () => {
    // Every ring on the Nutrition tab divides by these totals. A single NaN
    // propagates through the whole reduce, so the guard has to hold on all four
    // fields and not just on calories (HEALTH-NUTR-010).
    const totals = sumNutrition([
      meal({
        protein: NaN as unknown as number,
        carbs: NaN as unknown as number,
        fat: NaN as unknown as number,
      }),
      meal({ id: 'm2', calories: 200, protein: 20, carbs: 10, fat: 8 }),
    ]);
    expect(totals).toEqual({ calories: 500, protein: 20, carbs: 10, fat: 8 });
  });

  it('HEALTH-NUTR-012: groups into all four slots in canonical order, empty ones included', () => {
    const grouped = groupBySlot([meal({ slot: 'dinner' })]);
    expect(grouped.map((g) => g.slot)).toEqual(['breakfast', 'lunch', 'dinner', 'snacks']);
    expect(grouped.find((g) => g.slot === 'dinner')?.entries).toHaveLength(1);
    expect(grouped.find((g) => g.slot === 'breakfast')?.entries).toHaveLength(0);
  });
});

describe('healthNutritionStorage — wire contract', () => {
  it('HEALTH-NUTR-013: an empty account reads as an empty diary', async () => {
    expect(await loadMeals()).toEqual([]);
    expect(await loadMealsForDate()).toEqual([]);
  });

  it('HEALTH-NUTR-025: pulls a ~120-day window ending today, so Trends needs no second call', async () => {
    await loadMeals();

    const params = api.listNutrition.mock.calls[0][0];
    expect(params.to).toBe(TODAY);
    expect(params.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A DST transition can shave an hour off the window, so allow 119 or 120
    // whole days — what matters is that the 90-day Trends range fits inside it.
    const spanDays = Math.round(
      (Date.parse(`${params.to as string}T00:00:00Z`) -
        Date.parse(`${params.from as string}T00:00:00Z`)) /
        86_400_000
    );
    expect(spanDays).toBeGreaterThanOrEqual(119);
    expect(spanDays).toBeLessThanOrEqual(120);
  });

  it('HEALTH-NUTR-026: maps a wire row onto the diary shape and rounds fractional macros', async () => {
    api.listNutrition.mockResolvedValue(
      ok({
        entries: [
          nutritionRow({
            id: 'srv-1',
            meal_type: 'snack',
            food_name: 'Trail mix',
            calories: 300.6,
            proteins: 10.4,
            carbohydrates: 40.5,
            fats: 5.5,
            created_at: '2026-07-13T10:00:00.000Z',
          }),
        ],
      })
    );

    // Grams and kcal are whole numbers on every Health surface; a fractional
    // value from the server would render as "10.4 g" against a whole-number goal.
    expect(await loadMeals()).toEqual<MealEntry[]>([
      {
        id: 'srv-1',
        date: TODAY,
        slot: 'snacks', // 'snack' → 'snacks'
        name: 'Trail mix',
        calories: 301,
        protein: 10,
        carbs: 41,
        fat: 6,
        loggedAt: '2026-07-13T10:00:00.000Z',
        // 0124: the portion the macros describe, plus where they came from.
        portion: 1,
        unit: 'serving',
        foodId: null,
        // The fixture has no `base_calories_per_100`, which is exactly what a
        // hand-typed row and every pre-0124 row look like.
        canReportion: false,
      },
    ]);
  });

  it('HEALTH-NUTR-126: carries the 0124 provenance through and flags a re-portionable row', async () => {
    api.listNutrition.mockResolvedValue(
      ok({
        entries: [
          nutritionRow({
            id: 'srv-basis',
            food_name: 'Rice',
            portion: 150,
            unit: 'g',
            food_id: 'cf_rice',
            base_calories_per_100: 200,
            base_proteins_per_100: 10,
            base_carbs_per_100: 30,
            base_fats_per_100: 5,
          }),
        ],
      })
    );

    const [row] = await loadMeals();
    expect(row.foodId).toBe('cf_rice');
    expect(row.portion).toBe(150);
    expect(row.unit).toBe('g');
    // A FLAG, never the basis itself: the numbers stay server-side so nothing
    // here can be tempted to do the portion arithmetic locally.
    expect(row.canReportion).toBe(true);
    expect(row).not.toHaveProperty('base_calories_per_100');
  });

  it('HEALTH-NUTR-158: a row logged before 0124 has no portion, and says it cannot be rescaled', async () => {
    api.listNutrition.mockResolvedValue(
      ok({ entries: [nutritionRow({ portion: undefined, unit: undefined })] })
    );

    // The detail sheet shows a portion control only when the SERVER can re-derive
    // the row. A pre-0124 row has neither a portion nor a basis, so it gets the
    // typed editor instead of a control whose first use would 400.
    const [row] = await loadMeals();
    expect(row.portion).toBeUndefined();
    expect(row.unit).toBeUndefined();
    expect(row.canReportion).toBe(false);
  });

  it('HEALTH-NUTR-159: a nutrition body with no `entries` key reads as an empty diary', async () => {
    // The Health Worker answers BARE, so a renamed key or a 204-shaped body
    // arrives as `{}` — and `.map` on that throws straight into the day view.
    api.listNutrition.mockResolvedValue(ok({} as never));

    expect(await loadMeals()).toEqual([]);
    expect(await loadMealsForDate()).toEqual([]);
  });

  it('HEALTH-NUTR-160: a slot reads in the order it was eaten, while the diary reads newest-first', async () => {
    api.listNutrition.mockResolvedValue(
      ok({
        entries: [
          nutritionRow({ id: 'late', food_name: 'Apple', created_at: '2026-07-13T13:00:00.000Z' }),
          nutritionRow({ id: 'early', food_name: 'Wrap', created_at: '2026-07-13T09:00:00.000Z' }),
        ],
      })
    );

    // Two different orders on purpose: the day view lists a meal in the order it
    // happened, and `loadMeals` is newest-first because Trends and the "recent"
    // surfaces read from the top.
    expect((await loadMealsForDate()).map((e) => e.name)).toEqual(['Wrap', 'Apple']);
    expect((await loadMeals()).map((e) => e.name)).toEqual(['Apple', 'Wrap']);
  });

  it('HEALTH-NUTR-014: adds an entry and returns only that day, oldest-first', async () => {
    fakeNutritionServer();

    await addMealEntry({ name: 'Oats', slot: 'breakfast', calories: 350, protein: 12 });
    jest.setSystemTime(new Date(2026, 6, 13, 13, 0, 0));
    const day = await addMealEntry({ name: 'Salad', slot: 'lunch', calories: 420 });

    expect(day.map((e) => e.name)).toEqual(['Oats', 'Salad']);
    expect(day[0].date).toBe(TODAY);
    expect(day[0].protein).toBe(12);
    // Unsupplied macros default to 0 rather than undefined.
    expect(day[1]).toMatchObject({ protein: 0, carbs: 0, fat: 0 });
  });

  it('HEALTH-NUTR-027: addMealEntry posts the donor column names and wire meal type', async () => {
    fakeNutritionServer();

    await addMealEntry({
      name: 'Trail mix',
      slot: 'snacks',
      calories: 210,
      protein: 6,
      carbs: 20,
      fat: 9,
    });

    expect(api.createNutrition).toHaveBeenCalledWith({
      date: TODAY,
      food_name: 'Trail mix',
      meal_type: 'snack', // singular on the wire
      calories: 210,
      proteins: 6, // donor columns are plural / spelled out
      carbohydrates: 20,
      fats: 9,
    });
  });

  it('HEALTH-NUTR-015: falls back to the slot label when the name is blank', async () => {
    fakeNutritionServer();
    const day = await addMealEntry({ name: '   ', slot: 'snacks', calories: 100 });
    expect(day[0].name).toBe('Snacks');
    expect(api.createNutrition).toHaveBeenCalledWith(
      expect.objectContaining({ food_name: 'Snacks' })
    );
  });

  it('HEALTH-NUTR-028: trims and caps the food name before it reaches the wire', async () => {
    fakeNutritionServer();
    const long = 'x'.repeat(90);

    await addMealEntry({ name: `  ${long}  `, slot: 'lunch', calories: 100 });

    // 60 chars is the column's practical bound; sending more would either be
    // truncated server-side or blow up the diary row's layout.
    const sent = api.createNutrition.mock.calls[0][0].food_name;
    expect(sent).toHaveLength(60);
    expect(sent).toBe('x'.repeat(60));
  });

  it('HEALTH-NUTR-016: clamps a negative calorie value instead of storing it', async () => {
    fakeNutritionServer();
    const day = await addMealEntry({ name: 'Bad', slot: 'lunch', calories: -50 });
    expect(day[0].calories).toBe(0);
    expect(api.createNutrition).toHaveBeenCalledWith(expect.objectContaining({ calories: 0 }));
  });

  it('HEALTH-NUTR-017: keeps days separate — yesterday never leaks into today', async () => {
    fakeNutritionServer();
    await addMealEntry({ name: 'Yesterday soup', slot: 'lunch', calories: 200, date: '2026-07-12' });
    await addMealEntry({ name: 'Today soup', slot: 'lunch', calories: 300 });

    expect((await loadMealsForDate()).map((e) => e.name)).toEqual(['Today soup']);
    expect((await loadMealsForDate('2026-07-12')).map((e) => e.name)).toEqual(['Yesterday soup']);
    expect(await loadMeals()).toHaveLength(2);
  });

  it('HEALTH-NUTR-018: deletes by id and leaves the other day untouched', async () => {
    fakeNutritionServer();
    await addMealEntry({ name: 'Keep', slot: 'lunch', calories: 200, date: '2026-07-12' });
    const day = await addMealEntry({ name: 'Drop', slot: 'lunch', calories: 300 });

    const after = await deleteMealEntry(day[0].id);
    expect(after).toEqual([]);
    expect(await loadMeals()).toHaveLength(1);
  });

  it('HEALTH-NUTR-029: deleteMealEntry sends the SERVER row id, not a local one', async () => {
    fakeNutritionServer();
    const day = await addMealEntry({ name: 'Drop', slot: 'lunch', calories: 300 });

    // The optimistic entry carries a locally minted `${date}-${iso}` id; only the
    // refreshed server row has an id the DELETE route can resolve.
    expect(day[0].id).toBe('srv-1');
    await deleteMealEntry(day[0].id);
    expect(api.deleteNutrition).toHaveBeenCalledWith('srv-1');
  });

  it('HEALTH-NUTR-030: server rows are mirrored into MMKV for the next cold start', async () => {
    api.listNutrition.mockResolvedValue(
      ok({ entries: [nutritionRow({ id: 'srv-1', created_at: '2026-07-13T10:00:00.000Z' })] })
    );

    await loadMeals();

    expect(await storageHelpers.getObject<MealEntry[]>(HEALTH_MEALS_KEY)).toHaveLength(1);
    expect(healthSyncStateFor(HEALTH_MEALS_KEY)).toBe('synced');
  });
});

/* ==================================================================== */
/* 0124 — provenance on the way in, re-portioning afterwards             */
/* ==================================================================== */

describe('healthNutritionStorage — portion + provenance (0124)', () => {
  it('HEALTH-NUTR-130: sends food_id, portion and unit when the row comes from the library', async () => {
    fakeNutritionServer();

    await addMealEntry({
      name: 'Rice',
      slot: 'lunch',
      calories: 300,
      protein: 15,
      carbs: 45,
      fat: 8,
      portion: 150,
      unit: 'g',
      foodId: 'cf_rice',
    });

    // The Worker resolves that food's stored `base_*_per_100` onto the diary
    // row — which is the only reason the portion can be changed later.
    expect(api.createNutrition).toHaveBeenCalledWith(
      expect.objectContaining({ portion: 150, unit: 'g', food_id: 'cf_rice' })
    );
  });

  it('HEALTH-NUTR-131: a hand-typed add still sends the payload it always has', async () => {
    fakeNutritionServer();

    await addMealEntry({ name: 'Soup', slot: 'lunch', calories: 300 });

    // Adding keys the manual path never had would change a contract that has
    // been stable since P1 — and there is no portion to declare anyway.
    const sent = api.createNutrition.mock.calls[0][0];
    expect(sent).not.toHaveProperty('portion');
    expect(sent).not.toHaveProperty('unit');
    expect(sent).not.toHaveProperty('food_id');
  });

  it('HEALTH-NUTR-132: rescaling asks the SERVER and renders what it answers', async () => {
    const server = fakeNutritionServer();
    server.rows.push(
      nutritionRow({
        id: 'srv-1',
        food_name: 'Rice',
        portion: 100,
        unit: 'g',
        calories: 200,
        base_calories_per_100: 200,
      })
    );
    api.reportionNutrition.mockImplementation((id, body) => {
      const row = server.rows.find((r) => r.id === id);
      // 250 g of a 200 kcal/100 g basis — the Worker's arithmetic, not ours.
      const next = { ...row, portion: body.portion, calories: 500 } as HealthNutritionEntry;
      server.rows = server.rows.map((r) => (r.id === id ? next : r));
      return Promise.resolve(ok({ entry: next }));
    });

    const result = await reportionMealEntry('srv-1', 250);

    expect(api.reportionNutrition).toHaveBeenCalledWith('srv-1', { portion: 250 });
    expect(result.status).toBe('saved');
    expect(result.entries[0]).toMatchObject({ portion: 250, calories: 500 });
  });

  it('HEALTH-NUTR-133: a refused rescale rolls back and reports no-basis', async () => {
    const server = fakeNutritionServer();
    server.rows.push(
      nutritionRow({ id: 'srv-1', food_name: 'Soup', portion: 1, unit: 'serving', calories: 300 })
    );
    // The shape axios gives a 400 from this route.
    api.reportionNutrition.mockRejectedValue({
      response: { status: 400, data: { error: { code: 'no_basis', message: 'nope' } } },
    });

    const result = await reportionMealEntry('srv-1', 2);

    expect(result.status).toBe('no-basis');
    // The optimistic portion must NOT survive: the server will never agree, so
    // leaving it would outlive the session and reappear on every cold start.
    expect(result.entries[0].portion).toBe(1);
    expect((await storageHelpers.getObject<MealEntry[]>(HEALTH_MEALS_KEY))?.[0].portion).toBe(1);
    // Copy, never the server's own message.
    expect(NO_BASIS_MESSAGE).toContain('no per-portion basis');
  });

  it('HEALTH-NUTR-165: rescaling one row leaves every other row exactly as it was', async () => {
    const server = fakeNutritionServer();
    server.rows.push(
      nutritionRow({
        id: 'srv-1',
        food_name: 'Rice',
        portion: 100,
        unit: 'g',
        calories: 200,
        base_calories_per_100: 200,
        created_at: '2026-07-13T09:00:00.000Z',
      }),
      nutritionRow({
        id: 'srv-2',
        food_name: 'Chicken',
        portion: 120,
        unit: 'g',
        calories: 250,
        base_calories_per_100: 208,
        created_at: '2026-07-13T10:00:00.000Z',
      })
    );
    api.reportionNutrition.mockImplementation((id, body) => {
      server.rows = server.rows.map((r) =>
        r.id === id ? ({ ...r, portion: body.portion, calories: 500 } as HealthNutritionEntry) : r
      );
      return Promise.resolve(ok({ entry: server.rows.find((r) => r.id === id)! }));
    });

    const result = await reportionMealEntry('srv-1', 250);

    // The optimistic pass rewrites the whole diary array, so a slip in the "not
    // this one" arm would re-portion the member's entire day.
    expect(result.status).toBe('saved');
    expect(result.entries.find((e) => e.id === 'srv-1')).toMatchObject({
      portion: 250,
      calories: 500,
    });
    expect(result.entries.find((e) => e.id === 'srv-2')).toMatchObject({
      portion: 120,
      calories: 250,
    });
  });

  it('HEALTH-NUTR-134: a lost connection keeps the optimistic portion and says so', async () => {
    const server = fakeNutritionServer();
    server.rows.push(
      nutritionRow({
        id: 'srv-1',
        food_name: 'Rice',
        portion: 100,
        unit: 'g',
        base_calories_per_100: 200,
      })
    );
    api.reportionNutrition.mockRejectedValue(NETWORK_ERROR);

    const result = await reportionMealEntry('srv-1', 250);

    // Different outcome from a refusal on purpose: the write may still land, so
    // the user keeps seeing what they just did (every Health writer's rule).
    expect(result.status).toBe('failed');
    expect(result.entries[0].portion).toBe(250);
    expect(healthSyncStateFor(HEALTH_MEALS_KEY)).toBe('offline');
  });
});

/* ==================================================================== */
/* Editing a logged row in place                                         */
/* ==================================================================== */

/** Give the fake server a working PUT — every writer re-reads the day after it. */
function withUpdate(server: { rows: HealthNutritionEntry[] }): void {
  api.updateNutrition.mockImplementation((id, body) => {
    server.rows = server.rows.map((row) =>
      row.id === id ? ({ ...row, ...body } as HealthNutritionEntry) : row
    );
    return Promise.resolve(
      ok({ entry: server.rows.find((r) => r.id === id) as HealthNutritionEntry })
    );
  });
}

describe('healthNutritionStorage — updateMealEntry', () => {
  it('HEALTH-NUTR-161: a full edit PUTs the donor column names and keeps the row in place', async () => {
    const server = fakeNutritionServer();
    withUpdate(server);
    const first = await addMealEntry({
      name: 'Wrap',
      slot: 'lunch',
      calories: 400,
      protein: 20,
      carbs: 40,
      fat: 12,
    });
    jest.setSystemTime(new Date(2026, 6, 13, 13, 0, 0));
    await addMealEntry({ name: 'Apple', slot: 'snacks', calories: 90 });

    const next = await updateMealEntry(first[0].id, {
      name: 'Chicken wrap',
      slot: 'snacks',
      calories: 420,
      protein: 22,
      carbs: 41,
      fat: 13,
    });

    expect(api.updateNutrition).toHaveBeenCalledWith('srv-1', {
      food_name: 'Chicken wrap',
      meal_type: 'snack', // singular on the wire, on this route too
      calories: 420,
      proteins: 22,
      carbohydrates: 41,
      fats: 13,
    });
    // A real PUT is what this replaced the add-then-delete dance for: two round
    // trips, a new row id, and a reset `loggedAt` that threw the edited item to
    // the end of its slot.
    expect(api.createNutrition).toHaveBeenCalledTimes(2); // the two adds, and no more
    expect(api.deleteNutrition).not.toHaveBeenCalled();
    expect(next.map((e) => e.id)).toEqual(['srv-1', 'srv-2']); // position unchanged
    expect(next[0]).toMatchObject({
      id: first[0].id,
      loggedAt: first[0].loggedAt,
      name: 'Chicken wrap',
      slot: 'snacks',
      calories: 420,
    });
  });

  it('HEALTH-NUTR-162: a one-field edit sends ONLY that field', async () => {
    const server = fakeNutritionServer();
    withUpdate(server);
    const day = await addMealEntry({ name: 'Wrap', slot: 'lunch', calories: 400, protein: 20 });

    const next = await updateMealEntry(day[0].id, { calories: 500 });

    // The route spreads the patch straight onto the row, so a column the member
    // did not touch must not be restated — least of all `meal_type`, which would
    // silently re-file the row into whichever slot the caller happened to hold.
    expect(api.updateNutrition).toHaveBeenCalledWith('srv-1', { calories: 500 });
    expect(next[0]).toMatchObject({ name: 'Wrap', slot: 'lunch', calories: 500, protein: 20 });
  });

  it('HEALTH-NUTR-168: moving a row to another meal sends the slot and nothing else', async () => {
    const server = fakeNutritionServer();
    withUpdate(server);
    const day = await addMealEntry({ name: 'Apple', slot: 'lunch', calories: 90 });

    const next = await updateMealEntry(day[0].id, { slot: 'snacks' });

    // The donor's "move to…" is a re-file, not a re-entry: the figures travel
    // with the row untouched, so a move must not restate a single macro column.
    expect(api.updateNutrition).toHaveBeenCalledWith('srv-1', { meal_type: 'snack' });
    expect(next[0]).toMatchObject({ id: 'srv-1', slot: 'snacks', name: 'Apple', calories: 90 });
  });

  it('HEALTH-NUTR-163: an offline edit merges into the cached day and survives the next read', async () => {
    await storageHelpers.setObject(HEALTH_MEALS_KEY, [
      meal({ id: 'a', name: 'Wrap', loggedAt: '2026-07-13T09:00:00.000Z' }),
      meal({ id: 'b', name: 'Apple', loggedAt: '2026-07-13T10:00:00.000Z' }),
    ]);
    __setHealthOfflineForTests(true);

    // No `date` argument: the day defaults to today, which is what the screen
    // relies on for the common case.
    const next = await updateMealEntry('a', { calories: 500 });

    expect(api.updateNutrition).not.toHaveBeenCalled();
    expect(next.map((e) => `${e.name}:${e.calories}`)).toEqual(['Wrap:500', 'Apple:300']);
    expect((await loadMealsForDate()).find((e) => e.id === 'a')?.calories).toBe(500);
    expect(healthSyncStateFor(HEALTH_MEALS_KEY)).toBe('offline');
  });

  it('HEALTH-NUTR-164: editing a library row’s macros leaves the server’s per-portion basis stale', async () => {
    const server = fakeNutritionServer();
    withUpdate(server);
    server.rows.push(
      nutritionRow({
        id: 'srv-basis',
        food_name: 'Rice',
        portion: 150,
        unit: 'g',
        calories: 300,
        base_calories_per_100: 200,
      })
    );

    const next = await updateMealEntry('srv-basis', { calories: 420 });

    // DEFECT (HEALTH-NUTR-164): the edit carries no basis, and
    // `updateNutrition` on the Worker spreads the patch without re-deriving one —
    // so the row goes on claiming it can be rescaled FROM THE FIGURE THE MEMBER
    // JUST CORRECTED AWAY. Change the portion afterwards and
    // `/nutrition/entries/:id/portion` re-derives 200 kcal/100 g and the
    // correction disappears. The fix belongs on the route (recompute the basis on
    // a macro edit, or drop it and let the row become a typed one).
    expect(api.updateNutrition).toHaveBeenCalledWith('srv-basis', { calories: 420 });
    expect(next[0]).toMatchObject({ calories: 420, canReportion: true });
    expect(server.rows[0].base_calories_per_100).toBe(200);
  });
});

/* ==================================================================== */
/* Copy + batch delete — the donor's copy sheets and multi-select bar     */
/* ==================================================================== */

const YESTERDAY = '2026-07-12';

describe('healthNutritionStorage — copy (copy-day + bulk)', () => {
  it('HEALTH-NUTR-140: copy-day sends the exact wire body, with the snack alias on BOTH slots', async () => {
    fakeNutritionServer();

    await copyMealsFromDay({
      fromDate: YESTERDAY,
      toDate: TODAY,
      fromSlot: 'snacks',
      toSlot: 'snacks',
    });

    // 'snacks' is the app's word; D1's CHECK constraint says 'snack'. Sending
    // the plural on either end would be rejected by the route's zod enum.
    expect(api.copyNutritionDay).toHaveBeenCalledWith({
      from_date: YESTERDAY,
      to_date: TODAY,
      from_slot: 'snack',
      to_slot: 'snack',
    });
  });

  it("HEALTH-NUTR-141: copies yesterday's dinner into today and APPENDS, never replaces", async () => {
    fakeNutritionServer();
    await addMealEntry({ name: 'Steak', slot: 'dinner', calories: 600, date: YESTERDAY });
    jest.setSystemTime(new Date(2026, 6, 13, 13, 0, 0));
    await addMealEntry({ name: 'Toast', slot: 'dinner', calories: 200, date: TODAY });

    const result = await copyMealsFromDay({
      fromDate: YESTERDAY,
      toDate: TODAY,
      fromSlot: 'dinner',
      toSlot: 'dinner',
    });

    expect(result.status).toBe('copied');
    expect(result.copied).toBe(1);
    // The donor's copy sheets never delete at the target, and neither does this:
    // a copy that silently wiped a slot would be unrecoverable.
    expect(result.entries.map((e) => e.name).sort()).toEqual(['Steak', 'Toast']);
    // Yesterday is untouched — a copy is not a move.
    expect((await loadMealsForDate(YESTERDAY)).map((e) => e.name)).toEqual(['Steak']);
  });

  it('HEALTH-NUTR-142: an empty source is "nothing to copy", not a silent success', async () => {
    fakeNutritionServer();

    const result = await copyMealsFromDay({
      fromDate: YESTERDAY,
      toDate: TODAY,
      fromSlot: 'lunch',
      toSlot: 'lunch',
    });

    // The route happily copies zero rows and answers 201, so a client that only
    // checked for an error would show a confirmation for nothing.
    expect(result.status).toBe('nothing-to-copy');
    expect(result.copied).toBe(0);
    expect(result.message).toBe(nothingToCopyMessage(YESTERDAY, 'lunch'));
    expect(result.message).toContain('Yesterday');
  });

  it('HEALTH-NUTR-143: a same-day slot→slot copy is ONE request, not a read plus N writes', async () => {
    fakeNutritionServer();
    await addMealEntry({ name: 'Wrap', slot: 'lunch', calories: 400 });
    await addMealEntry({ name: 'Apple', slot: 'lunch', calories: 90 });

    const result = await copyMealsFromDay({
      fromDate: TODAY,
      toDate: TODAY,
      fromSlot: 'lunch',
      toSlot: 'dinner',
    });

    // The donor needed a whole extra sheet (`CopyMealToMealSheet`) for this;
    // `copy-day` expresses it with from_date === to_date.
    expect(api.copyNutritionDay).toHaveBeenCalledTimes(1);
    expect(api.bulkCreateNutrition).not.toHaveBeenCalled();
    expect(result.copied).toBe(2);
    expect(result.entries.filter((e) => e.slot === 'dinner').map((e) => e.name).sort()).toEqual([
      'Apple',
      'Wrap',
    ]);
  });

  it('HEALTH-NUTR-144: a whole-day copy sends neither slot, so every row keeps its own', async () => {
    fakeNutritionServer();
    await addMealEntry({ name: 'Oats', slot: 'breakfast', calories: 350, date: YESTERDAY });
    await addMealEntry({ name: 'Curry', slot: 'dinner', calories: 700, date: YESTERDAY });

    const result = await copyMealsFromDay({ fromDate: YESTERDAY, toDate: TODAY });

    const sent = api.copyNutritionDay.mock.calls[0][0];
    expect(sent).not.toHaveProperty('from_slot');
    expect(sent).not.toHaveProperty('to_slot');
    expect(result.copied).toBe(2);
    // Re-filing a whole day into one slot would put curry in the breakfast card.
    expect(
      result.entries.map((e) => `${e.slot}:${e.name}`).sort()
    ).toEqual(['breakfast:Oats', 'dinner:Curry']);
  });

  it('HEALTH-NUTR-145: a failed copy changes nothing at all and never leaks a raw error', async () => {
    fakeNutritionServer();
    await addMealEntry({ name: 'Toast', slot: 'breakfast', calories: 200 });
    api.copyNutritionDay.mockRejectedValue(NETWORK_ERROR);

    const result = await copyMealsFromDay({ fromDate: YESTERDAY, toDate: TODAY, toSlot: 'dinner' });

    // Unlike a single add, a copy is NOT optimistic: the source rows are read
    // server-side, so fabricating them here would put a whole phantom meal on
    // screen that the next successful read deletes.
    expect(result.status).toBe('failed');
    expect(result.copied).toBe(0);
    expect(result.message).toBe(COPY_FAILED_MESSAGE);
    expect(result.entries.map((e) => e.name)).toEqual(['Toast']);
    expect(
      (await storageHelpers.getObject<MealEntry[]>(HEALTH_MEALS_KEY))?.map((e) => e.name)
    ).toEqual(['Toast']);
    expect(result.message).not.toContain('Network');
  });

  it('HEALTH-NUTR-146: copying a SELECTION posts the bulk route with the donor column names', async () => {
    fakeNutritionServer();
    const day = await addMealEntry({
      name: 'Rice',
      slot: 'lunch',
      calories: 300,
      protein: 15,
      carbs: 45,
      fat: 8,
      portion: 150,
      unit: 'g',
      foodId: 'cf_rice',
    });

    const result = await copyMealEntriesTo({ entries: day, toDate: TODAY, toSlot: 'dinner' });

    expect(api.bulkCreateNutrition).toHaveBeenCalledWith({
      entries: [
        {
          date: TODAY,
          food_name: 'Rice',
          meal_type: 'dinner',
          calories: 300,
          proteins: 15,
          carbohydrates: 45,
          fats: 8,
          // Provenance travels with the copy so the new row is still
          // re-portionable; the per-100 basis does NOT, because this device
          // never holds it — the Worker re-resolves it from `food_id`.
          portion: 150,
          unit: 'g',
          food_id: 'cf_rice',
        },
      ],
    });
    expect(result.status).toBe('copied');
    expect(result.copied).toBe(1);
  });

  it('HEALTH-NUTR-147: refuses more than the route accepts instead of collecting a 400', async () => {
    fakeNutritionServer();
    const many = Array.from({ length: MAX_BULK_ENTRIES + 1 }, (_, i) =>
      meal({ id: `m${i}`, name: `Item ${i}` })
    );

    const result = await copyMealEntriesTo({ entries: many, toDate: TODAY, toSlot: 'dinner' });

    // `z.array(...).max(100)` rejects the WHOLE request, so a client that sent
    // 101 would copy nothing and be told nothing useful.
    expect(result.status).toBe('too-many');
    expect(result.message).toBe(COPY_TOO_MANY_MESSAGE);
    expect(api.bulkCreateNutrition).not.toHaveBeenCalled();
  });

  it('HEALTH-NUTR-148: an empty selection never reaches the wire', async () => {
    fakeNutritionServer();

    const result = await copyMealEntriesTo({ entries: [], toDate: TODAY, toSlot: 'dinner' });

    // `.min(1)` on the route — an empty array is a 400, not a no-op.
    expect(result.status).toBe('nothing-to-copy');
    expect(api.bulkCreateNutrition).not.toHaveBeenCalled();
  });

  it('HEALTH-NUTR-166: a copy answer with no `entries` key counts as nothing copied', async () => {
    fakeNutritionServer();
    // The count is read off the SERVER's answer, never assumed from what was
    // sent — and the Worker answers bare, so a renamed key arrives as `{}`.
    // Falling back to "1 item copied" would confirm a meal that is not there.
    api.copyNutritionDay.mockResolvedValue(ok({} as never));

    const result = await copyMealsFromDay({ fromDate: YESTERDAY, toDate: TODAY });

    expect(result.status).toBe('nothing-to-copy');
    expect(result.copied).toBe(0);
    expect(result.message).toBe(nothingToCopyMessage(YESTERDAY));
  });

  it('HEALTH-NUTR-167: a selection copied with no target slot keeps each row’s own slot', async () => {
    fakeNutritionServer();
    // Rows as the CACHE holds them for a hand-typed day: no portion, no unit, no
    // source food. The donor's plain "copy to day" is exactly this case.
    const rows = [
      meal({ id: 'a', name: 'Oats', slot: 'breakfast', calories: 350 }),
      meal({ id: 'b', name: 'Curry', slot: 'dinner', calories: 700 }),
    ];

    const result = await copyMealEntriesTo({ entries: rows, toDate: TODAY });

    expect(api.bulkCreateNutrition).toHaveBeenCalledWith({
      entries: [
        {
          date: TODAY,
          food_name: 'Oats',
          meal_type: 'breakfast',
          calories: 350,
          proteins: 10,
          carbohydrates: 40,
          fats: 5,
        },
        {
          date: TODAY,
          food_name: 'Curry',
          meal_type: 'dinner',
          calories: 700,
          proteins: 10,
          carbohydrates: 40,
          fats: 5,
        },
      ],
    });
    // Nothing is invented: a row with no portion must not declare `portion: 1`,
    // or the Worker would derive a per-100 basis for a serving nobody measured.
    const sent = api.bulkCreateNutrition.mock.calls[0][0].entries[0];
    expect(sent).not.toHaveProperty('portion');
    expect(sent).not.toHaveProperty('unit');
    expect(sent).not.toHaveProperty('food_id');
    expect(result.copied).toBe(2);
  });

  it('HEALTH-NUTR-149: copy confirmations singularise, unlike the donor', async () => {
    expect(copiedMessage(1, 'dinner')).toBe('Copied 1 item into Dinner.');
    expect(copiedMessage(3, 'dinner')).toBe('Copied 3 items into Dinner.');
    expect(copiedMessage(2)).toBe('Copied 2 items.');
  });
});

describe('healthNutritionStorage — scan review (logScannedFoodsToDiary)', () => {
  function scannedFood(over: Partial<ScannedFoodEntry> = {}): ScannedFoodEntry {
    return {
      name: 'Chicken breast',
      slot: 'lunch',
      calories: 248,
      protein: 46,
      carbs: 0,
      fat: 5,
      portion: 150,
      unit: 'g',
      ...over,
    };
  }

  it('HEALTH-SCANLOG-001: files every kept row in ONE bulk request', async () => {
    fakeNutritionServer();

    const result = await logScannedFoodsToDiary([
      scannedFood({ name: 'Chicken breast' }),
      scannedFood({ name: 'Rice', calories: 200, protein: 4, carbs: 45, fat: 0, portion: 180 }),
    ]);

    expect(api.bulkCreateNutrition).toHaveBeenCalledWith({
      entries: [
        {
          date: TODAY,
          food_name: 'Chicken breast',
          meal_type: 'lunch',
          calories: 248,
          proteins: 46,
          carbohydrates: 0,
          fats: 5,
          portion: 150,
          unit: 'g',
        },
        {
          date: TODAY,
          food_name: 'Rice',
          meal_type: 'lunch',
          calories: 200,
          proteins: 4,
          carbohydrates: 45,
          fats: 0,
          portion: 180,
          unit: 'g',
        },
      ],
    });
    // `logged` is the SERVER's answer length, never assumed from what was sent.
    expect(result.status).toBe('logged');
    expect(result.logged).toBe(2);
    expect(result.message).toBeNull();
  });

  it('HEALTH-SCANLOG-002: a row with no portion is sent with neither portion nor unit', async () => {
    fakeNutritionServer();

    await logScannedFoodsToDiary([scannedFood({ portion: undefined, unit: undefined })]);

    const sent = api.bulkCreateNutrition.mock.calls[0][0].entries[0];
    expect(sent).not.toHaveProperty('portion');
    expect(sent).not.toHaveProperty('unit');
  });

  it('HEALTH-SCANLOG-003: a row with no usable calorie figure is dropped, never sent as 0', async () => {
    fakeNutritionServer();

    const result = await logScannedFoodsToDiary([
      scannedFood({ name: 'Unread item', calories: NaN }),
      scannedFood({ name: 'Rice', calories: 200 }),
    ]);

    expect(api.bulkCreateNutrition).toHaveBeenCalledWith({
      entries: [expect.objectContaining({ food_name: 'Rice', calories: 200 })],
    });
    expect(result.logged).toBe(1);
  });

  it('HEALTH-SCANLOG-004: nothing usable at all refuses without a round trip', async () => {
    fakeNutritionServer();

    const result = await logScannedFoodsToDiary([
      scannedFood({ calories: 0 }),
      scannedFood({ name: '  ' }),
    ]);

    expect(api.bulkCreateNutrition).not.toHaveBeenCalled();
    expect(result.status).toBe('nothing-to-log');
    expect(result.logged).toBe(0);
    expect(result.message).toBe(SCAN_NOTHING_TO_LOG_MESSAGE);
  });

  it('HEALTH-SCANLOG-005: more than the bulk route can take refuses up front', async () => {
    fakeNutritionServer();
    const many = Array.from({ length: MAX_BULK_ENTRIES + 1 }, (_, i) => scannedFood({ name: `Food ${i}` }));

    const result = await logScannedFoodsToDiary(many);

    expect(api.bulkCreateNutrition).not.toHaveBeenCalled();
    expect(result.status).toBe('too-many');
    expect(result.message).toBe(SCAN_TOO_MANY_MESSAGE);
  });

  it('HEALTH-SCANLOG-006: a lost connection reports failure without inventing a diary row', async () => {
    api.bulkCreateNutrition.mockRejectedValue(NETWORK_ERROR);

    const result = await logScannedFoodsToDiary([scannedFood()]);

    expect(result.status).toBe('failed');
    expect(result.logged).toBe(0);
    expect(result.message).toBe(SCAN_LOG_FAILED_MESSAGE);
  });

  it('HEALTH-SCANLOG-007: confirmation copy names the meal and singularises one food', () => {
    expect(scanLoggedMessage(1, 'lunch')).toBe('Added 1 food to Lunch.');
    expect(scanLoggedMessage(3, 'dinner')).toBe('Added 3 foods to Dinner.');
  });
});

describe('healthNutritionStorage — batch delete (multi-select)', () => {
  it('HEALTH-NUTR-150: removes every selected id and re-reads the day', async () => {
    fakeNutritionServer();
    await addMealEntry({ name: 'A', slot: 'lunch', calories: 100 });
    await addMealEntry({ name: 'B', slot: 'lunch', calories: 200 });
    const day = await addMealEntry({ name: 'C', slot: 'lunch', calories: 300 });

    const result = await deleteMealEntries(day.slice(0, 2).map((e) => e.id));

    expect(result.status).toBe('deleted');
    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.message).toBeNull();
    expect(result.entries.map((e) => e.name)).toEqual(['C']);
  });

  it('HEALTH-NUTR-151: a PARTIAL batch attempts every id and reports the split honestly', async () => {
    fakeNutritionServer();
    await addMealEntry({ name: 'A', slot: 'lunch', calories: 100 });
    const day = await addMealEntry({ name: 'B', slot: 'lunch', calories: 200 });

    // 'gone' is an id the server no longer holds — it 404s. The donor's loop
    // aborted at the first throw AND skipped its reload, so the rows it HAD
    // deleted stayed on screen with one generic alert. Every id is attempted
    // here, and the day is re-read because something did land.
    const ids = [day[0].id, 'gone', day[1].id];
    const result = await deleteMealEntries(ids);

    expect(api.deleteNutrition).toHaveBeenCalledTimes(3);
    expect(result.status).toBe('partial');
    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.message).toBe(partialDeleteMessage(2, 3));
    expect(result.message).toContain('Removed 2 of 3');
    expect(result.entries).toEqual([]);
  });

  it('HEALTH-NUTR-152: an all-failed batch changes nothing and says so', async () => {
    fakeNutritionServer();
    const day = await addMealEntry({ name: 'A', slot: 'lunch', calories: 100 });
    api.deleteNutrition.mockRejectedValue(NETWORK_ERROR);

    const result = await deleteMealEntries([day[0].id]);

    // Nothing landed, so the optimistic value is the list UNCHANGED — a lost
    // connection must never blank a slot the server still holds.
    expect(result.status).toBe('failed');
    expect(result.deleted).toBe(0);
    expect(result.message).toBe(BULK_DELETE_FAILED_MESSAGE);
    expect(result.entries.map((e) => e.name)).toEqual(['A']);
    expect(
      (await storageHelpers.getObject<MealEntry[]>(HEALTH_MEALS_KEY))?.map((e) => e.name)
    ).toEqual(['A']);
  });

  it('HEALTH-NUTR-153: duplicate and blank ids are collapsed before the wire', async () => {
    fakeNutritionServer();
    const day = await addMealEntry({ name: 'A', slot: 'lunch', calories: 100 });

    const result = await deleteMealEntries([day[0].id, day[0].id, '', day[0].id]);

    // A double tap on the same tick box would otherwise send the id twice, and
    // the second call 404s — turning a clean delete into a bogus "partial".
    expect(api.deleteNutrition).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('deleted');
    expect(result.deleted).toBe(1);
  });

  it('HEALTH-NUTR-154: an empty selection is a no-op, not a request', async () => {
    fakeNutritionServer();

    const result = await deleteMealEntries([]);

    expect(result.status).toBe('empty');
    expect(result.message).toBeNull();
    expect(api.deleteNutrition).not.toHaveBeenCalled();
  });

  it('HEALTH-NUTR-155: the partial message names both halves and singularises', () => {
    expect(partialDeleteMessage(2, 3)).toBe('Removed 2 of 3. 1 item is still there — try again.');
    expect(partialDeleteMessage(1, 3)).toBe('Removed 1 of 3. 2 items are still there — try again.');
  });
});

describe('healthNutritionStorage — offline contract', () => {
  it('HEALTH-NUTR-031: a failed read falls back to the cached diary', async () => {
    await storageHelpers.setObject(HEALTH_MEALS_KEY, [meal({ id: 'cached', name: 'Soup' })]);
    api.listNutrition.mockRejectedValue(NETWORK_ERROR);

    expect((await loadMeals()).map((e) => e.name)).toEqual(['Soup']);
    expect(healthSyncStateFor(HEALTH_MEALS_KEY)).toBe('offline');
  });

  it('HEALTH-NUTR-032: an offline add returns and caches the optimistic day', async () => {
    __setHealthOfflineForTests(true);

    const day = await addMealEntry({ name: 'Oats', slot: 'breakfast', calories: 350 });

    expect(day.map((e) => e.name)).toEqual(['Oats']);
    expect(api.createNutrition).not.toHaveBeenCalled();
    // The locally minted id is `${date}-${iso}` — good enough to render and to
    // remove optimistically, but it can never satisfy the DELETE route.
    expect(day[0].id.startsWith(`${TODAY}-`)).toBe(true);
    expect((await loadMealsForDate()).map((e) => e.name)).toEqual(['Oats']);
  });

  it('HEALTH-NUTR-033: an offline delete drops the row from the optimistic day', async () => {
    await storageHelpers.setObject(HEALTH_MEALS_KEY, [
      meal({ id: 'a', name: 'Keep', loggedAt: '2026-07-13T08:00:00.000Z' }),
      meal({ id: 'b', name: 'Drop', loggedAt: '2026-07-13T09:00:00.000Z' }),
    ]);
    __setHealthOfflineForTests(true);

    expect((await deleteMealEntry('b')).map((e) => e.name)).toEqual(['Keep']);
  });

  it('HEALTH-NUTR-019: drops corrupt cached rows instead of rendering them', async () => {
    await storageHelpers.setObject(HEALTH_MEALS_KEY, [
      meal({ id: 'ok' }),
      { id: 'no-slot', date: TODAY, slot: 'brunch', calories: 10, loggedAt: 'x' },
      null,
    ]);
    __setHealthOfflineForTests(true);

    expect((await loadMeals()).map((e) => e.id)).toEqual(['ok']);
  });

  it('HEALTH-NUTR-034: a non-array cached snapshot degrades to empty, not a crash', async () => {
    await storageHelpers.setObject(HEALTH_MEALS_KEY, { nope: true });
    __setHealthOfflineForTests(true);

    // Fixed 2026-07-25: `readThrough` now rejects a cached snapshot whose
    // shape does not match the caller's fallback, so a corrupt or
    // schema-drifted blob degrades to the empty state instead of throwing a
    // TypeError into the screen — on exactly the offline path the cache
    // exists to protect.
    expect(await loadMeals()).toEqual([]);
  });
});

describe('healthNutritionStorage — goals', () => {
  it('HEALTH-NUTR-021: defaults are returned when the account has no goal row', async () => {
    api.getGoal.mockResolvedValue(ok({ goal: null }));
    expect(await loadNutritionGoals()).toEqual(DEFAULT_NUTRITION_GOALS);
  });

  it('HEALTH-NUTR-035: reads the effective-dated goal row, defaulting unset macros', async () => {
    fakeGoalServer(api, { daily_calories: 1800, daily_protein_grams: 150 });

    // Only the columns the user has actually set come back; the rest are NULL
    // and must fall back to the donor defaults rather than to zero (a zero goal
    // would divide by zero in every progress bar).
    expect(await loadNutritionGoals()).toEqual({
      calories: 1800,
      protein: 150,
      carbs: DEFAULT_NUTRITION_GOALS.carbs,
      fat: DEFAULT_NUTRITION_GOALS.fat,
    });
  });

  it('HEALTH-NUTR-022: saves a partial goal and keeps the rest', async () => {
    fakeGoalServer(api);

    const saved = await saveNutritionGoals({ calories: 1800 });
    expect(saved.calories).toBe(1800);
    expect(saved.protein).toBe(DEFAULT_NUTRITION_GOALS.protein);
    expect(await loadNutritionGoals()).toEqual(saved);
  });

  it('HEALTH-NUTR-036: saveNutritionGoals writes all four macro columns at once', async () => {
    fakeGoalServer(api);

    await saveNutritionGoals({ calories: 1800 });

    // The goal row is effective-dated: a PATCH that omitted the untouched
    // macros would create a new row with three NULL columns and silently reset
    // the user's protein/carb/fat targets.
    expect(api.saveGoal).toHaveBeenCalledWith({
      daily_calories: 1800,
      daily_protein_grams: DEFAULT_NUTRITION_GOALS.protein,
      daily_carbs_grams: DEFAULT_NUTRITION_GOALS.carbs,
      daily_fats_grams: DEFAULT_NUTRITION_GOALS.fat,
    });
  });

  it('HEALTH-NUTR-023: a zero / negative / absurd goal falls back rather than dividing by zero', async () => {
    api.getGoal.mockResolvedValue(
      ok({
        goal: goalRow({
          daily_calories: 0,
          daily_protein_grams: -5,
          daily_carbs_grams: 999999,
          daily_fats_grams: 65,
        }),
      })
    );

    const goals = await loadNutritionGoals();
    expect(goals.calories).toBe(DEFAULT_NUTRITION_GOALS.calories);
    expect(goals.protein).toBe(DEFAULT_NUTRITION_GOALS.protein);
    expect(goals.carbs).toBe(2000); // clamped to the macro bound
    expect(goals.fat).toBe(65);
  });

  it('HEALTH-NUTR-037: offline goals fall back to the cached targets', async () => {
    await storageHelpers.setObject(HEALTH_NUTRITION_GOALS_KEY, { calories: 1600, protein: 140 });
    __setHealthOfflineForTests(true);

    // A goal that vanished offline would make every ring read against 2000 kcal
    // and quietly misreport the day.
    expect(await loadNutritionGoals()).toEqual({
      calories: 1600,
      protein: 140,
      carbs: DEFAULT_NUTRITION_GOALS.carbs,
      fat: DEFAULT_NUTRITION_GOALS.fat,
    });
    expect(healthSyncStateFor(HEALTH_NUTRITION_GOALS_KEY)).toBe('offline');
  });
});
