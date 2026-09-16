import { healthApi, type HealthMealType } from '@api/health';
import { storageHelpers } from '@services/storage';

import { dateKeyOf, todayDateKey } from './healthLocalStorage';
import { readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — Nutrition (donor "Meals" tab), local-only.
 *
 * Donor parity: the Swift app logged food per meal slot with calories + macros
 * and compared the day against a target. Parity phase P1 restores the donor's
 * backend (`/health/nutrition/*` on the Health Worker) — MMKV is now an offline
 * read-through cache, not the record.
 *
 * Still deliberately absent: food database, barcode lookup and AI estimation.
 * Those are donor routes (`/foods`, `/custom-foods`, `/recipes`) scheduled for
 * parity phase P2; manual entry is the always-available path.
 */

export const HEALTH_MEALS_KEY = 'health.meals.v1';
export const HEALTH_NUTRITION_GOALS_KEY = 'health.nutritionGoals.v1';

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snacks'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

/** Brand icon-kit name per slot — the kit ships one glyph for each. */
export const MEAL_SLOT_ICONS: Record<MealSlot, string> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  snacks: 'snacks',
};

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
};

/** One food item inside a meal slot. */
export interface MealEntry {
  id: string;
  date: string; // YYYY-MM-DD (local)
  slot: MealSlot;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  loggedAt: string; // ISO timestamp
  /**
   * How much the macros describe, and in what (0124). Optional because a cache
   * written before 0124 has neither.
   */
  portion?: number;
  unit?: string;
  /** The library food this came from, when it came from one. */
  foodId?: string | null;
  /**
   * True when the SERVER holds a per-100 basis for this row, so the portion can
   * be re-derived (`reportionMealEntry`). False for a hand-typed row from before
   * 0124 — the screen offers the typed editor for those instead of a portion
   * control that would 400.
   *
   * Deliberately a FLAG, not the basis itself: the basis stays server-side so
   * nothing on the device can be tempted to do the arithmetic (rule 1 in
   * healthFoodStorage.ts).
   */
  canReportion?: boolean;
}

export interface NutritionGoals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const DEFAULT_NUTRITION_GOALS: NutritionGoals = {
  calories: 2000,
  protein: 120,
  carbs: 220,
  fat: 65,
};

export interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

const MAX_CALORIES = 10000;
const MAX_MACRO_GRAMS = 2000;
const MAX_NAME_LENGTH = 60;

export function isMealSlot(value: string): value is MealSlot {
  return (MEAL_SLOTS as readonly string[]).includes(value);
}

/** The app says "snacks"; the donor schema's CHECK constraint says "snack". */
export function toWireMealType(slot: MealSlot): HealthMealType {
  return slot === 'snacks' ? 'snack' : slot;
}

export function fromWireMealType(meal: string): MealSlot {
  return meal === 'snack' ? 'snacks' : (meal as MealSlot);
}

/**
 * Keep a numeric nutrition field numeric as it is typed. `keyboardType` only
 * picks the on-screen keyboard — paste, hardware keyboards and UI automation
 * still deliver letters (same reasoning as `sanitizeWeightInput`).
 */
export function sanitizeAmountInput(raw: string): string {
  if (typeof raw !== 'string') return '';
  const digitsAndSeparators = raw.replace(/[^0-9.,]/g, '');
  const firstSeparator = digitsAndSeparators.search(/[.,]/);
  if (firstSeparator === -1) return digitsAndSeparators;
  const head = digitsAndSeparators.slice(0, firstSeparator + 1);
  const tail = digitsAndSeparators.slice(firstSeparator + 1).replace(/[.,]/g, '');
  return head + tail;
}

/** Parse an optional amount field: blank → 0, invalid/out-of-range → null. */
export function parseAmountInput(raw: string, max: number): number | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().replace(',', '.');
  if (normalized.length === 0) return 0;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > max) return null;
  return Math.round(value);
}

export function parseCaloriesInput(raw: string): number | null {
  return parseAmountInput(raw, MAX_CALORIES);
}

export function parseMacroInput(raw: string): number | null {
  return parseAmountInput(raw, MAX_MACRO_GRAMS);
}

/** Sum a set of entries into day totals. */
export function sumNutrition(entries: MealEntry[]): NutritionTotals {
  return entries.reduce<NutritionTotals>(
    (acc, entry) => ({
      calories: acc.calories + (Number.isFinite(entry.calories) ? entry.calories : 0),
      protein: acc.protein + (Number.isFinite(entry.protein) ? entry.protein : 0),
      carbs: acc.carbs + (Number.isFinite(entry.carbs) ? entry.carbs : 0),
      fat: acc.fat + (Number.isFinite(entry.fat) ? entry.fat : 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/** Group a day's entries by slot, in the canonical slot order. */
export function groupBySlot(entries: MealEntry[]): Array<{ slot: MealSlot; entries: MealEntry[] }> {
  return MEAL_SLOTS.map((slot) => ({
    slot,
    entries: entries.filter((e) => e.slot === slot),
  }));
}

/** Shift a YYYY-MM-DD key by whole days, staying in local time. */
export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const d = new Date(year, (month ?? 1) - 1, day ?? 1);
  d.setDate(d.getDate() + days);
  return dateKeyOf(d.toISOString());
}

/** Today / Yesterday / YYYY-MM-DD for a day key (mirrors `formatLoggedAt`). */
export function formatDayKey(dateKey: string): string {
  if (dateKey === todayDateKey()) return 'Today';
  if (dateKey === shiftDateKey(todayDateKey(), -1)) return 'Yesterday';
  return dateKey;
}

function isValidEntry(entry: MealEntry | null | undefined): entry is MealEntry {
  return (
    !!entry &&
    typeof entry.id === 'string' &&
    typeof entry.date === 'string' &&
    typeof entry.slot === 'string' &&
    isMealSlot(entry.slot) &&
    Number.isFinite(entry.calories)
  );
}

function fromWireMeal(row: {
  id: string;
  date: string;
  meal_type: string;
  food_name: string;
  calories: number;
  proteins: number;
  carbohydrates: number;
  fats: number;
  portion?: number;
  unit?: string;
  food_id?: string | null;
  base_calories_per_100?: number | null;
  created_at: string;
}): MealEntry {
  return {
    id: row.id,
    date: row.date,
    slot: fromWireMealType(row.meal_type),
    name: row.food_name,
    calories: Math.round(row.calories),
    protein: Math.round(row.proteins),
    carbs: Math.round(row.carbohydrates),
    fat: Math.round(row.fats),
    loggedAt: row.created_at,
    portion: typeof row.portion === 'number' ? row.portion : undefined,
    unit: row.unit,
    foodId: row.food_id ?? null,
    // A flag, not the number: whether the SERVER can re-derive this row. Only
    // `base_calories_per_100` is consulted because the Worker writes the four
    // basis columns together or not at all.
    canReportion: typeof row.base_calories_per_100 === 'number',
  };
}

async function fetchMeals(): Promise<MealEntry[]> {
  // Pull a generous window so Trends has data without a second call.
  const to = todayDateKey();
  const from = dateKeyOf(new Date(Date.now() - 120 * 86_400_000).toISOString());
  const res = await healthApi.listNutrition({ from, to });
  return (res.entries ?? [])
    .map(fromWireMeal)
    .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
}

export async function loadMeals(): Promise<MealEntry[]> {
  const meals = await readThrough(HEALTH_MEALS_KEY, fetchMeals, []);
  return meals.filter(isValidEntry).sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
}

export async function loadMealsForDate(date = todayDateKey()): Promise<MealEntry[]> {
  const all = await loadMeals();
  // Oldest-first inside a day so a slot reads in the order it was eaten.
  return all.filter((e) => e.date === date).sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
}

export interface AddMealInput {
  name: string;
  slot: MealSlot;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  date?: string;
  /**
   * Portion + unit + source food (0124), sent together when the row comes from
   * the library. The Worker resolves that food's stored `base_*_per_100` and
   * keeps it on the diary row, which is the whole reason the portion can be
   * changed afterwards. Omitted for a hand-typed entry, whose basis the Worker
   * derives from the macros and portion it was given.
   */
  portion?: number;
  unit?: string;
  foodId?: string;
}

function forDate(entries: MealEntry[], date: string): MealEntry[] {
  return entries.filter((e) => e.date === date).sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
}

export async function addMealEntry(input: AddMealInput): Promise<MealEntry[]> {
  const loggedAt = new Date().toISOString();
  const date = input.date ?? todayDateKey();
  const entry: MealEntry = {
    id: `${date}-${loggedAt}`,
    date,
    slot: input.slot,
    name: input.name.trim().slice(0, MAX_NAME_LENGTH) || MEAL_SLOT_LABELS[input.slot],
    calories: Math.max(0, Math.round(input.calories)),
    protein: Math.max(0, Math.round(input.protein ?? 0)),
    carbs: Math.max(0, Math.round(input.carbs ?? 0)),
    fat: Math.max(0, Math.round(input.fat ?? 0)),
    loggedAt,
    ...(input.portion !== undefined ? { portion: input.portion } : {}),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
    ...(input.foodId !== undefined ? { foodId: input.foodId } : {}),
    // Optimistic only: the server decides, and the refetch overwrites this.
    canReportion: input.foodId !== undefined || input.portion !== undefined,
  };
  const optimistic = [entry, ...(await loadMeals())].sort((a, b) =>
    b.loggedAt.localeCompare(a.loggedAt)
  );
  const next = await writeThrough(
    HEALTH_MEALS_KEY,
    () =>
      healthApi.createNutrition({
        date,
        food_name: entry.name,
        meal_type: toWireMealType(entry.slot),
        calories: entry.calories,
        proteins: entry.protein,
        carbohydrates: entry.carbs,
        fats: entry.fat,
        // Sent only when the caller has them, so the plain manual add keeps
        // writing exactly the payload it always has.
        ...(input.portion !== undefined ? { portion: input.portion } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.foodId !== undefined ? { food_id: input.foodId } : {}),
      }),
    fetchMeals,
    optimistic,
    `insert slot=${entry.slot} kcal=${entry.calories}`,
    {
      // `entry.id` is the locally-synthesized id, and stays the row's identity
      // until a successful sync replaces it with the server's — a later
      // offline edit or delete of this same not-yet-synced entry queues under
      // the SAME id and collapses onto this slot rather than duplicating it.
      queue: {
        collection: 'nutrition_entries',
        row: {
          id: entry.id,
          date,
          food_name: entry.name,
          meal_type: toWireMealType(entry.slot),
          calories: entry.calories,
          proteins: entry.protein,
          carbohydrates: entry.carbs,
          fats: entry.fat,
          ...(input.portion !== undefined ? { portion: input.portion } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.foodId !== undefined ? { food_id: input.foodId } : {}),
        },
      },
    }
  );
  return forDate(next, date);
}

/**
 * Patch a logged entry in place.
 *
 * Replaces the add-then-delete dance the meal editor had to use while the
 * client lacked an update method: that cost two round trips, minted a new row
 * id, and reset `loggedAt` so an edited item jumped to the end of its slot.
 * A real PUT keeps the row's identity and its position in the day.
 */
export async function updateMealEntry(
  id: string,
  patch: Partial<Pick<MealEntry, 'name' | 'slot' | 'calories' | 'protein' | 'carbs' | 'fat'>>,
  date = todayDateKey()
): Promise<MealEntry[]> {
  const before = await loadMeals();
  const found = before.find((e) => e.id === id);
  const optimistic = before.map((e) => (e.id === id ? { ...e, ...patch } : e));
  const next = await writeThrough(
    HEALTH_MEALS_KEY,
    () =>
      healthApi.updateNutrition(id, {
        ...(patch.name !== undefined ? { food_name: patch.name } : {}),
        ...(patch.slot !== undefined ? { meal_type: toWireMealType(patch.slot) } : {}),
        ...(patch.calories !== undefined ? { calories: patch.calories } : {}),
        ...(patch.protein !== undefined ? { proteins: patch.protein } : {}),
        ...(patch.carbs !== undefined ? { carbohydrates: patch.carbs } : {}),
        ...(patch.fat !== undefined ? { fats: patch.fat } : {}),
      }),
    fetchMeals,
    optimistic,
    `update id=${id}`,
    // The push writer has no PATCH semantics, so the queued row is built from
    // the WHOLE merged entry (`found` + `patch`), never the bare patch.
    found
      ? {
          queue: {
            collection: 'nutrition_entries',
            row: {
              id,
              date: found.date,
              food_name: patch.name ?? found.name,
              meal_type: toWireMealType(patch.slot ?? found.slot),
              calories: patch.calories ?? found.calories,
              proteins: patch.protein ?? found.protein,
              carbohydrates: patch.carbs ?? found.carbs,
              fats: patch.fat ?? found.fat,
            },
          },
        }
      : undefined
  );
  return forDate(next, date);
}

/** Outcome of a portion change — the screen has to tell these three apart. */
export type ReportionStatus = 'saved' | 'no-basis' | 'failed';

export interface ReportionResult {
  entries: MealEntry[];
  status: ReportionStatus;
}

/** Copy for a row the server cannot rescale. Never a raw error string. */
export const NO_BASIS_MESSAGE =
  'This one was typed in, so there is no per-portion basis to rescale. Edit the numbers instead.';

/**
 * Change a logged entry's PORTION and let the server re-derive its macros
 * (0124).
 *
 * The arithmetic is deliberately not here. `/nutrition/entries/:id/portion`
 * scales the stored `base_*_per_100`, so the phone, the widget and the watch
 * cannot disagree, and repeated edits cannot drift the way scaling an already
 * rounded figure would. Nothing on this device multiplies a macro.
 *
 * `no-basis` (HTTP 400) is a real answer, not a failure: the entry was typed in
 * before 0124 and has nothing to rescale from. The optimistic row is rolled
 * back by refetching, and the caller shows `NO_BASIS_MESSAGE`.
 */
export async function reportionMealEntry(
  id: string,
  portion: number,
  date = todayDateKey()
): Promise<ReportionResult> {
  const outcome: { status: ReportionStatus } = { status: 'saved' };
  const before = await loadMeals();
  // The portion moves optimistically; the MACROS wait for the answer. Only the
  // server knows what the new portion weighs, and putting a locally scaled
  // figure on screen that it is about to disagree with is exactly the bug the
  // per-100 basis exists to prevent.
  const optimistic = before.map((e) => (e.id === id ? { ...e, portion } : e));

  const next = await writeThrough(
    HEALTH_MEALS_KEY,
    async () => {
      try {
        await healthApi.reportionNutrition(id, { portion });
      } catch (error) {
        // A REFUSAL and a lost connection are different outcomes: the first has
        // to roll back (the server will never agree), the second keeps the
        // optimistic row like every other writer in this domain.
        outcome.status = isNoBasisError(error) ? 'no-basis' : 'failed';
        throw error;
      }
    },
    fetchMeals,
    optimistic,
    `reportion id=${id} portion=${portion}`
  );

  if (outcome.status !== 'no-basis') {
    return { entries: forDate(next, date), status: outcome.status };
  }
  await storageHelpers.setObject(HEALTH_MEALS_KEY, before);
  return { entries: forDate(before, date), status: 'no-basis' };
}

/**
 * A 400 whose code is `no_basis`. Only the STATUS and the machine code are ever
 * read — the server's own message never reaches the UI.
 */
function isNoBasisError(error: unknown): boolean {
  const response = (
    error as { response?: { status?: unknown; data?: { error?: { code?: unknown } } } } | null
  )?.response;
  if (response?.status !== 400) return false;
  return response?.data?.error?.code === 'no_basis';
}

export async function deleteMealEntry(id: string, date = todayDateKey()): Promise<MealEntry[]> {
  const before = await loadMeals();
  const found = before.find((e) => e.id === id);
  const optimistic = before.filter((e) => e.id !== id);
  const next = await writeThrough(
    HEALTH_MEALS_KEY,
    () => healthApi.deleteNutrition(id),
    fetchMeals,
    optimistic,
    `delete id=${id}`,
    found
      ? {
          queue: {
            collection: 'nutrition_entries',
            row: {
              id,
              date: found.date,
              food_name: found.name,
              meal_type: toWireMealType(found.slot),
              calories: found.calories,
              deleted_at: new Date().toISOString(),
            },
          },
        }
      : undefined
  );
  return forDate(next, date);
}

/* ==================================================================== */
/* Copy (donor CopyFood / CopyMeal / CopyMealFromDate sheets)            */
/* ==================================================================== */

/**
 * The route's own bound: `z.array(...).min(1).max(100)` on
 * `/nutrition/entries/bulk`. Sending more would 400 the WHOLE request, so the
 * client refuses up front and says how many it can take.
 */
export const MAX_BULK_ENTRIES = 100;

export type CopyStatus = 'copied' | 'nothing-to-copy' | 'too-many' | 'failed';

export interface CopyMealsResult {
  /** The VIEWED day after the copy — which may not be the day copied into. */
  entries: MealEntry[];
  /** Rows the SERVER reports it created. Never assumed from what was sent. */
  copied: number;
  status: CopyStatus;
  message: string | null;
}

/**
 * Copy failures are reported as one honest sentence rather than three.
 *
 * A 4xx and a lost connection land here identically on purpose: the user-facing
 * fact is the same in both cases — nothing was written — and telling them apart
 * would mean reading the server's own error text, which the no-raw-error-leaks
 * rule forbids.
 */
export const COPY_FAILED_MESSAGE =
  'That copy did not go through, so nothing was added. Check your connection and try again.';

export const COPY_TOO_MANY_MESSAGE = `You can copy up to ${MAX_BULK_ENTRIES} items at once.`;

/** Donor `CopyMealFromDateSheet` shows this when the source meal is empty. */
export function nothingToCopyMessage(fromDate: string, slot?: MealSlot): string {
  const what = slot ? MEAL_SLOT_LABELS[slot].toLowerCase() : 'anything';
  return `Nothing logged for ${what} on ${formatDayKey(fromDate)}.`;
}

/**
 * Confirmation copy for a copy that landed. Singularised properly, unlike the
 * donor's "Delete 1 Items" — a count is the one string a user re-reads.
 */
export function copiedMessage(count: number, slot?: MealSlot): string {
  const items = `${count} ${count === 1 ? 'item' : 'items'}`;
  return slot ? `Copied ${items} into ${MEAL_SLOT_LABELS[slot]}.` : `Copied ${items}.`;
}

/**
 * Why a copy is NOT optimistic, unlike every other writer in this module.
 *
 * `addMealEntry` can keep an offline row on screen because it knows exactly what
 * that row says — the user just typed it. A copy does not: the source rows are
 * read SERVER-side (`copyNutritionDay` re-reads the source day so a tombstoned
 * entry is never copied forward), and the per-100 basis and `food_id` that
 * travel with each copy are columns this device never holds. Fabricating N rows
 * from a possibly-stale cache would put a whole meal on screen that the next
 * successful read silently deletes — and unlike one mistyped snack, a whole
 * phantom dinner is the kind of thing a user plans a day around.
 *
 * So a copy that cannot reach the server changes nothing and says so.
 */
async function runCopy(
  request: () => Promise<{ entries: unknown[] } | undefined>,
  viewDate: string,
  detail: string
): Promise<CopyMealsResult> {
  const before = await loadMeals();
  const outcome: { copied: number; ok: boolean } = { copied: 0, ok: false };

  const next = await writeThrough(
    HEALTH_MEALS_KEY,
    async () => {
      const payload = await request();
      outcome.copied = payload?.entries?.length ?? 0;
      outcome.ok = true;
    },
    fetchMeals,
    // The optimistic value is the list UNCHANGED, so a failed copy leaves the
    // cache exactly as it found it instead of seeding phantom rows.
    before,
    detail
  );

  if (!outcome.ok) {
    return { entries: forDate(before, viewDate), copied: 0, status: 'failed', message: COPY_FAILED_MESSAGE };
  }
  return { entries: forDate(next, viewDate), copied: outcome.copied, status: 'copied', message: null };
}

export interface CopyDayInput {
  fromDate: string;
  toDate: string;
  /** Narrow the source to one meal. Omitted = the whole day. */
  fromSlot?: MealSlot;
  /** Re-file everything into one meal. Omitted = each row keeps its own slot. */
  toSlot?: MealSlot;
}

/**
 * Copy a day — or one meal of it — onto another day, in ONE request.
 *
 * This is the donor's `CopyMealFromDateSheet` ("same breakfast as yesterday"),
 * `CopyMealToMealSheet` (`fromDate === toDate`, two different slots) and
 * "copy the whole day" all at once, because `/nutrition/copy-day` takes both
 * slot arguments. Copying is an APPEND at the target, exactly as in the donor:
 * nothing at `toDate` is deleted or overwritten.
 *
 * An empty source is a real answer, not a failure — the server happily copies
 * zero rows, so the caller is told there was nothing there rather than being
 * shown a silent success.
 */
export async function copyMealsFromDay(
  input: CopyDayInput,
  viewDate = input.toDate
): Promise<CopyMealsResult> {
  const result = await runCopy(
    () =>
      healthApi.copyNutritionDay({
        from_date: input.fromDate,
        to_date: input.toDate,
        ...(input.fromSlot ? { from_slot: toWireMealType(input.fromSlot) } : {}),
        ...(input.toSlot ? { to_slot: toWireMealType(input.toSlot) } : {}),
      }),
    viewDate,
    `copy-day from=${input.fromDate} to=${input.toDate}`
  );

  if (result.status === 'copied' && result.copied === 0) {
    return { ...result, status: 'nothing-to-copy', message: nothingToCopyMessage(input.fromDate, input.fromSlot) };
  }
  return result;
}

export interface CopyEntriesInput {
  entries: MealEntry[];
  toDate: string;
  /** Omitted = each copy keeps the slot it came from (donor "copy to day"). */
  toSlot?: MealSlot;
}

/**
 * Copy a chosen SET of rows onto a day and slot — the donor's `CopyFoodSheet`
 * and `CopyFoodToMealSheet`, generalised to a multi-selection.
 *
 * Uses `/nutrition/entries/bulk` rather than N creates so a dropped connection
 * cannot leave the target day half-written.
 *
 * `food_id` and the portion travel with the copy so the new row is still
 * re-portionable; `base_*_per_100` deliberately does NOT, because the client
 * never holds it — the Worker re-resolves the basis from `food_id`, or derives
 * it from (macros, portion) exactly as it did for the original row.
 */
export async function copyMealEntriesTo(
  input: CopyEntriesInput,
  viewDate = input.toDate
): Promise<CopyMealsResult> {
  const source = input.entries.filter(isValidEntry);
  if (source.length === 0) {
    const entries = forDate(await loadMeals(), viewDate);
    return { entries, copied: 0, status: 'nothing-to-copy', message: nothingToCopyMessage(viewDate) };
  }
  if (source.length > MAX_BULK_ENTRIES) {
    const entries = forDate(await loadMeals(), viewDate);
    return { entries, copied: 0, status: 'too-many', message: COPY_TOO_MANY_MESSAGE };
  }

  return runCopy(
    () =>
      healthApi.bulkCreateNutrition({
        entries: source.map((entry) => ({
          date: input.toDate,
          food_name: entry.name,
          meal_type: toWireMealType(input.toSlot ?? entry.slot),
          calories: entry.calories,
          proteins: entry.protein,
          carbohydrates: entry.carbs,
          fats: entry.fat,
          ...(entry.portion !== undefined ? { portion: entry.portion } : {}),
          ...(entry.unit !== undefined ? { unit: entry.unit } : {}),
          ...(entry.foodId ? { food_id: entry.foodId } : {}),
        })),
      }),
    viewDate,
    `bulk-copy n=${source.length} to=${input.toDate}`
  );
}

/* ==================================================================== */
/* Scan → diary (AI meal-photo / scale review, HealthScanReview)         */
/* ==================================================================== */

/** One reviewed row from a meal-photo/scale scan, ready to file. */
export interface ScannedFoodEntry {
  name: string;
  slot: MealSlot;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  portion?: number;
  unit?: string;
}

export type ScanLogStatus = 'logged' | 'nothing-to-log' | 'too-many' | 'failed';

export interface ScanLogResult {
  entries: MealEntry[];
  /** Rows the SERVER reports it created. Never assumed from what was sent. */
  logged: number;
  status: ScanLogStatus;
  message: string | null;
}

export const SCAN_NOTHING_TO_LOG_MESSAGE =
  'Nothing to add — include at least one food with a calorie figure.';
export const SCAN_TOO_MANY_MESSAGE = `You can add up to ${MAX_BULK_ENTRIES} foods at once.`;
export const SCAN_LOG_FAILED_MESSAGE =
  'That did not save. Check your connection and try again.';

/** Confirmation copy for a scan review that landed. */
export function scanLoggedMessage(count: number, slot: MealSlot): string {
  const items = `${count} ${count === 1 ? 'food' : 'foods'}`;
  return `Added ${items} to ${MEAL_SLOT_LABELS[slot]}.`;
}

/**
 * File the foods a member kept on a scan-review card (`HealthScanReview`)
 * into the diary, in ONE request.
 *
 * This is what closes the "adding these to your diary is not built yet" gap
 * `HealthScanScreen`'s meal-photo review used to leave open: a scan draft was
 * a dead end, and the member had to retype every figure by hand on the
 * Nutrition tab. `/nutrition/entries/bulk` is the same route the diary's own
 * copy verbs use, so a dropped connection cannot leave the meal half-logged.
 *
 * Rows with no usable calorie figure are dropped rather than sent as a 0 —
 * a scan can read a portion with no calories at all (see
 * `HealthMealPhotoFood.calories`), and silently filing that as "0 kcal" would
 * make an unread item look like a real answer. `logged` is a real 0 only when
 * every row was like that; the caller distinguishes that from a genuine
 * write failure via `status`.
 */
export async function logScannedFoodsToDiary(
  foods: ScannedFoodEntry[],
  viewDate = todayDateKey()
): Promise<ScanLogResult> {
  const valid = foods.filter(
    (food) => food.name.trim().length > 0 && Number.isFinite(food.calories) && food.calories > 0
  );
  if (valid.length === 0) {
    return {
      entries: forDate(await loadMeals(), viewDate),
      logged: 0,
      status: 'nothing-to-log',
      message: SCAN_NOTHING_TO_LOG_MESSAGE,
    };
  }
  if (valid.length > MAX_BULK_ENTRIES) {
    return {
      entries: forDate(await loadMeals(), viewDate),
      logged: 0,
      status: 'too-many',
      message: SCAN_TOO_MANY_MESSAGE,
    };
  }

  const result = await runCopy(
    () =>
      healthApi.bulkCreateNutrition({
        entries: valid.map((food) => ({
          date: viewDate,
          food_name: food.name.trim().slice(0, MAX_NAME_LENGTH),
          meal_type: toWireMealType(food.slot),
          calories: Math.max(0, Math.round(food.calories)),
          proteins: Math.max(0, Math.round(food.protein ?? 0)),
          carbohydrates: Math.max(0, Math.round(food.carbs ?? 0)),
          fats: Math.max(0, Math.round(food.fat ?? 0)),
          ...(food.portion !== undefined ? { portion: food.portion } : {}),
          ...(food.unit !== undefined ? { unit: food.unit } : {}),
        })),
      }),
    viewDate,
    `bulk-scan n=${valid.length}`
  );

  if (result.status === 'failed') {
    return { entries: result.entries, logged: 0, status: 'failed', message: SCAN_LOG_FAILED_MESSAGE };
  }
  return { entries: result.entries, logged: result.copied, status: 'logged', message: null };
}

/* ==================================================================== */
/* Batch delete (donor multiSelectActionButtons)                         */
/* ==================================================================== */

export type BulkDeleteStatus = 'deleted' | 'partial' | 'failed' | 'empty';

export interface BulkDeleteResult {
  entries: MealEntry[];
  deleted: number;
  failed: number;
  status: BulkDeleteStatus;
  message: string | null;
}

export const BULK_DELETE_FAILED_MESSAGE =
  'Nothing was removed. Check your connection and try again.';

/** Says exactly how the batch split — never "something went wrong". */
export function partialDeleteMessage(deleted: number, total: number): string {
  const left = total - deleted;
  return `Removed ${deleted} of ${total}. ${left} ${
    left === 1 ? 'item is' : 'items are'
  } still there — try again.`;
}

/**
 * Remove several diary rows at once (donor multi-select → Delete).
 *
 * THERE IS NO BULK DELETE ROUTE, so this is a client-side batch over
 * `DELETE /nutrition/entries/:id`. Two deliberate differences from the donor,
 * whose `deleteEntries` looped inside one `do/catch`:
 *
 *  1. **Every id is attempted.** The donor abandoned the remaining rows at the
 *     first throw, so one stale id could strand eleven others.
 *  2. **A partial failure is reported as a partial failure.** The donor also
 *     skipped its own `loadData()` on the error path, so the rows it HAD
 *     deleted stayed on screen until something else reloaded the day — the
 *     screen and the database disagreed and nothing said so. Here the day is
 *     re-read whenever anything landed, and the caller is told the split.
 *
 * All-or-nothing failure keeps the rows: the optimistic value is the list
 * unchanged, so a lost connection never blanks a slot the server still holds.
 */
export async function deleteMealEntries(
  ids: string[],
  date = todayDateKey()
): Promise<BulkDeleteResult> {
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
  const before = await loadMeals();
  if (unique.length === 0) {
    return { entries: forDate(before, date), deleted: 0, failed: 0, status: 'empty', message: null };
  }

  const outcome = { deleted: 0, failed: unique.length };

  const next = await writeThrough(
    HEALTH_MEALS_KEY,
    async () => {
      const settled = await Promise.allSettled(unique.map((id) => healthApi.deleteNutrition(id)));
      outcome.deleted = settled.filter((r) => r.status === 'fulfilled').length;
      outcome.failed = settled.length - outcome.deleted;
      // Throw ONLY when nothing landed, so `writeThrough` skips the refetch and
      // restores the untouched list. A partial batch must still re-read the day:
      // the cache has to match what the server now actually holds.
      if (outcome.deleted === 0) throw new Error('bulk delete failed');
    },
    fetchMeals,
    before,
    `bulk-delete n=${unique.length}`
  );

  if (outcome.deleted === 0) {
    return {
      entries: forDate(before, date),
      deleted: 0,
      failed: unique.length,
      status: 'failed',
      message: BULK_DELETE_FAILED_MESSAGE,
    };
  }
  if (outcome.failed > 0) {
    return {
      entries: forDate(next, date),
      deleted: outcome.deleted,
      failed: outcome.failed,
      status: 'partial',
      message: partialDeleteMessage(outcome.deleted, unique.length),
    };
  }
  return {
    entries: forDate(next, date),
    deleted: outcome.deleted,
    failed: 0,
    status: 'deleted',
    message: null,
  };
}

async function fetchNutritionGoals(): Promise<Partial<NutritionGoals>> {
  const goal = (await healthApi.getGoal()).goal;
  if (!goal) return {};
  return {
    calories: goal.daily_calories,
    protein: goal.daily_protein_grams ?? undefined,
    carbs: goal.daily_carbs_grams ?? undefined,
    fat: goal.daily_fats_grams ?? undefined,
  };
}

export async function loadNutritionGoals(): Promise<NutritionGoals> {
  const stored = await readThrough<Partial<NutritionGoals>>(
    HEALTH_NUTRITION_GOALS_KEY,
    fetchNutritionGoals,
    {}
  );
  const merged = { ...DEFAULT_NUTRITION_GOALS, ...stored };
  return {
    calories: clampGoal(merged.calories, DEFAULT_NUTRITION_GOALS.calories, MAX_CALORIES),
    protein: clampGoal(merged.protein, DEFAULT_NUTRITION_GOALS.protein, MAX_MACRO_GRAMS),
    carbs: clampGoal(merged.carbs, DEFAULT_NUTRITION_GOALS.carbs, MAX_MACRO_GRAMS),
    fat: clampGoal(merged.fat, DEFAULT_NUTRITION_GOALS.fat, MAX_MACRO_GRAMS),
  };
}

function clampGoal(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.round(value));
}

export async function saveNutritionGoals(goals: Partial<NutritionGoals>): Promise<NutritionGoals> {
  const next = { ...(await loadNutritionGoals()), ...goals };
  const clean: NutritionGoals = {
    calories: clampGoal(next.calories, DEFAULT_NUTRITION_GOALS.calories, MAX_CALORIES),
    protein: clampGoal(next.protein, DEFAULT_NUTRITION_GOALS.protein, MAX_MACRO_GRAMS),
    carbs: clampGoal(next.carbs, DEFAULT_NUTRITION_GOALS.carbs, MAX_MACRO_GRAMS),
    fat: clampGoal(next.fat, DEFAULT_NUTRITION_GOALS.fat, MAX_MACRO_GRAMS),
  };
  await writeThrough(
    HEALTH_NUTRITION_GOALS_KEY,
    () =>
      healthApi.saveGoal({
        daily_calories: clean.calories,
        daily_protein_grams: clean.protein,
        daily_carbs_grams: clean.carbs,
        daily_fats_grams: clean.fat,
      }),
    async () => clean,
    clean,
    `kcal=${clean.calories}`
  );
  return clean;
}
