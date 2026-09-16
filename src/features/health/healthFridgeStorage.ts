import { type HealthScanImage } from '@api/healthAi';
import {
  healthFridgeApi,
  type HealthExternalFood,
  type HealthFridgeItem,
  type HealthFridgeMealPlan,
  type HealthFridgeReceiptItem,
  type HealthFridgeSource,
} from '@api/healthFridge';
import { storageHelpers } from '@services/storage';

import { todayDateKey } from './healthLocalStorage';
import { shiftDateKey } from './healthNutritionStorage';
import { healthSyncStateFor, readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — FRIDGE (the donor's "Smart Fridge" tab), parity phase P2.
 *
 * Record of truth: `/health/fridge` on the `symply-health-api` Worker. MMKV is
 * an offline read-through cache exactly as in every other Health store — never
 * the record (see `healthRepository`).
 *
 * ## The two deployed semantics this module refuses to hide
 *
 * `?expiring_within_days=N` on the deployed route selects rows where
 * `expiry_date IS NOT NULL AND expiry_date <= today + N`. That means:
 *
 *  1. **It includes the past.** Something that expired yesterday is the single
 *     most urgent thing in the fridge. `expiringWithin` reproduces the rule
 *     exactly for the offline path, and the screen shows expired stock FIRST
 *     rather than quietly dropping it.
 *  2. **It excludes undated items.** An item with no expiry can never be
 *     "expiring", so it is absent from that window by design and only appears
 *     on the unfiltered list. The screen says so in words instead of leaving
 *     the user to wonder where the row went.
 *
 * ## The three donor capabilities, and how each one fails (parity P5)
 *
 * Barcode lookup, receipt reading and meal ideas now have routes. Every one of
 * them can be switched off, unpaid for, rate-limited or simply unreachable, and
 * a health app that answered any of those with a spinner that never stops — or
 * with a provider's own error string — would be worse than one that never had
 * the feature. So each returns a STATUS plus copy, never a throw:
 *
 *  - **Barcode** (`lookupFridgeBarcode`) is a FatSecret database question, not a
 *    model one. `not_configured` is the state it ships in — no FatSecret
 *    credential is set on any Health deploy — so the honest default outcome is
 *    "this is not switched on", and `not_found` (a good code the database does
 *    not hold) is deliberately a DIFFERENT outcome from `unavailable` (we could
 *    not ask), because the person's next move differs.
 *  - **Receipt** (`scanFridgeReceipt`) is a vision call behind the platform's AI
 *    entitlement. `needs_ai` names the Unlock path, `unreadable` says the
 *    picture did not contain readable shopping, `unsupported` says the file
 *    could not be read at all.
 *  - **Meal ideas** (`loadFridgeMealIdeas`) is the same gate list, plus one
 *    non-failure worth keeping separate: an EMPTY answer with a note is a real
 *    reply about a fridge full of condiments, not an error.
 *
 * NOTHING FROM ANY OF THE THREE IS SAVED UNTIL THE PERSON SAYS SO. A barcode
 * gives a draft, a receipt gives a list of drafts, and meal ideas are read and
 * gone. That is the same review-before-write rule the label and meal-photo
 * scanners keep.
 */

export const HEALTH_FRIDGE_KEY = 'health.fridge.v1';

/* ==================================================================== */
/* Vocabulary — the donor's own lists, verbatim                          */
/* ==================================================================== */

export const FRIDGE_CATEGORIES = [
  'Dairy',
  'Meat',
  'Vegetables',
  'Fruits',
  'Grains',
  'Beverages',
  'Snacks',
  'Frozen',
  'Condiments',
  'Uncategorized',
] as const;
export type FridgeCategory = (typeof FRIDGE_CATEGORIES)[number];

export const FRIDGE_UNITS = ['pc', 'kg', 'g', 'L', 'ml', 'oz', 'lb', 'cup', 'tbsp', 'tsp'] as const;
export type FridgeUnit = (typeof FRIDGE_UNITS)[number];

export const DEFAULT_FRIDGE_CATEGORY: FridgeCategory = 'Uncategorized';
export const DEFAULT_FRIDGE_UNIT: FridgeUnit = 'pc';

/** The window the "expiring soon" summary asks the Worker for. */
export const EXPIRING_SOON_DAYS = 7;

/** Mirrors the D1 CHECK constraints of migration 0120 — see `health-assets.ts`. */
const MAX_NAME_LENGTH = 200;
const MAX_NOTES_LENGTH = 1000;
const MAX_UNIT_LENGTH = 20;
const MAX_CATEGORY_LENGTH = 50;
const MAX_QUANTITY = 1_000_000;

/* ==================================================================== */
/* Screen shapes                                                         */
/* ==================================================================== */

/**
 * Macros kept on a fridge row, in `nutrition_json`.
 *
 * Donor-compatible keys (`NutritionInfo { calories, protein, carbs, fats }`)
 * plus the PORTION they describe. The donor stored the four numbers with no
 * portion at all, which makes them unreadable: "120 kcal" of what? Carrying the
 * serving the provider quoted is what lets the row be shown honestly and, later,
 * re-portioned.
 */
/**
 * Declared as a TYPE ALIAS rather than an interface on purpose: the wire payload
 * types `nutrition_json` as `Record<string, unknown> | string | null`, and only a
 * type alias picks up the implicit index signature that makes it assignable
 * there. An interface would force a cast at the one place the value is sent.
 */
export type FridgeNutrition = {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  /** The amount the four figures above are FOR. */
  portion: number;
  unit: string;
  /** e.g. `fatsecret`. Absent for hand-typed figures. */
  source?: string;
  /** The code that produced them, when the row came from a barcode. */
  barcode?: string;
};

export interface FridgeItem {
  id: string;
  name: string;
  /** null when the user did not give one — NOT the same as zero. */
  quantity: number | null;
  unit: string | null;
  category: string;
  /** `YYYY-MM-DD` (the server normalises to a day) or null when undated. */
  expiryDate: string | null;
  isFavorite: boolean;
  notes: string;
  source: HealthFridgeSource | string;
  /** Parsed from `nutrition_json`; null when absent or unreadable. */
  nutrition: FridgeNutrition | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a write is given.
 *
 * `source` and `nutrition` are OPTIONAL and, when omitted, are NOT SENT. That is
 * load-bearing on the PUT, where an absent key means "leave alone": the edit
 * form spreads `EMPTY_FRIDGE_DRAFT`, so editing the name of an item that came
 * from a receipt must not quietly reset its source to `manual` or wipe the
 * macros a barcode put on it.
 */
export interface FridgeDraft {
  name: string;
  quantity: number | null;
  unit: string;
  category: string;
  expiryDate: string | null;
  notes: string;
  isFavorite: boolean;
  source?: HealthFridgeSource;
  nutrition?: FridgeNutrition | null;
}

export const EMPTY_FRIDGE_DRAFT: FridgeDraft = {
  name: '',
  quantity: null,
  unit: DEFAULT_FRIDGE_UNIT,
  category: DEFAULT_FRIDGE_CATEGORY,
  expiryDate: null,
  notes: '',
  isFavorite: false,
};

/* ==================================================================== */
/* Expiry urgency                                                        */
/* ==================================================================== */

/**
 * Urgency buckets, most urgent first.
 *
 * `undated` is last and named rather than hidden: an item with no date is not
 * "later", it is unknown, and the deployed expiring-soon filter never returns
 * it. Collapsing the two would make the fridge look tidier than it is.
 */
export const EXPIRY_BUCKETS = ['expired', 'today', 'week', 'later', 'undated'] as const;
export type ExpiryBucket = (typeof EXPIRY_BUCKETS)[number];

export const EXPIRY_BUCKET_LABELS: Record<ExpiryBucket, string> = {
  expired: 'Expired',
  today: 'Use today',
  week: 'This week',
  later: 'Later',
  undated: 'No expiry date',
};

/** One-line explanation under each group header — says what the bucket means. */
export const EXPIRY_BUCKET_HINTS: Record<ExpiryBucket, string> = {
  expired: 'Past its date. Check it before eating, or throw it out.',
  today: 'Dated today.',
  week: 'Dated within the next 7 days.',
  later: 'Dated more than 7 days out.',
  undated: 'No date recorded, so these never appear in the expiring-soon count.',
};

/** Whole days from `today` to `dateKey`; negative when the date has passed. */
export function daysUntil(dateKey: string, today = todayDateKey()): number | null {
  const from = Date.parse(`${today}T00:00:00Z`);
  const to = Date.parse(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

export function expiryBucketOf(expiryDate: string | null, today = todayDateKey()): ExpiryBucket {
  if (!expiryDate) return 'undated';
  const days = daysUntil(expiryDate, today);
  if (days === null) return 'undated';
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days <= EXPIRING_SOON_DAYS) return 'week';
  return 'later';
}

/**
 * Plain-language expiry line for a row.
 *
 * Beyond a week the absolute day key is shown rather than "in 23 days" — at
 * that distance the exact date is the useful fact, and `YYYY-MM-DD` is what
 * every other Health surface prints (cf. `formatDayKey`).
 */
export function formatExpiry(expiryDate: string | null, today = todayDateKey()): string {
  if (!expiryDate) return 'No expiry date';
  const days = daysUntil(expiryDate, today);
  if (days === null) return 'No expiry date';
  if (days === -1) return 'Expired yesterday';
  if (days < -1) return `Expired ${Math.abs(days)} days ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  if (days <= EXPIRING_SOON_DAYS) return `Expires in ${days} days`;
  return `Expires ${expiryDate}`;
}

/** `2 pc`, `2.5 kg`, `` when no quantity was recorded (donor formatting). */
export function formatQuantity(quantity: number | null, unit: string | null): string {
  if (quantity === null || !Number.isFinite(quantity)) return '';
  const value = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(1);
  return unit ? `${value} ${unit}` : value;
}

/* ==================================================================== */
/* Grouping, filtering, summary                                          */
/* ==================================================================== */

function byExpiryAsc(a: FridgeItem, b: FridgeItem): number {
  const left = a.expiryDate ?? '';
  const right = b.expiryDate ?? '';
  if (left !== right) return left.localeCompare(right);
  return a.name.localeCompare(b.name);
}

function byNewestFirst(a: FridgeItem, b: FridgeItem): number {
  if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
  return a.name.localeCompare(b.name);
}

export interface FridgeGroup {
  bucket: ExpiryBucket;
  label: string;
  hint: string;
  items: FridgeItem[];
}

/**
 * Group by urgency, most urgent first, dropping empty buckets.
 *
 * Dated buckets sort by date ascending (soonest first, which inside `expired`
 * means longest-expired first — the thing most likely to be a health risk);
 * undated sorts newest-added first, mirroring the Worker's own unfiltered order.
 */
export function groupByExpiry(items: FridgeItem[], today = todayDateKey()): FridgeGroup[] {
  const groups = new Map<ExpiryBucket, FridgeItem[]>();
  for (const item of items) {
    const bucket = expiryBucketOf(item.expiryDate, today);
    const list = groups.get(bucket);
    if (list) list.push(item);
    else groups.set(bucket, [item]);
  }
  // One lookup per bucket: the filter-then-map form looked the bucket up twice
  // and needed a `?? []` on the second read that could never fire.
  return EXPIRY_BUCKETS.flatMap((bucket) => {
    const bucketItems = groups.get(bucket);
    if (bucketItems === undefined || bucketItems.length === 0) return [];
    return [
      {
        bucket,
        label: EXPIRY_BUCKET_LABELS[bucket],
        hint: EXPIRY_BUCKET_HINTS[bucket],
        items: [...bucketItems].sort(bucket === 'undated' ? byNewestFirst : byExpiryAsc),
      },
    ];
  });
}

/**
 * The EXACT rule the deployed `?expiring_within_days=` runs, reproduced for the
 * offline path: dated items on or before `today + days`, **including the past**,
 * **excluding undated**, soonest first.
 */
export function expiringWithin(
  items: FridgeItem[],
  days = EXPIRING_SOON_DAYS,
  today = todayDateKey()
): FridgeItem[] {
  const cutoff = shiftDateKey(today, days);
  return items
    .filter((item) => item.expiryDate !== null && item.expiryDate <= cutoff)
    .sort(byExpiryAsc);
}

export interface FridgeSummary {
  total: number;
  expired: number;
  dueToday: number;
  dueThisWeek: number;
  undated: number;
  favorites: number;
  /** Count the deployed `expiring_within_days=7` window would return. */
  expiringSoon: number;
  /** Inclusive upper bound of that window, `YYYY-MM-DD`. */
  cutoff: string;
}

export function summarizeFridge(items: FridgeItem[], today = todayDateKey()): FridgeSummary {
  const counts: Record<ExpiryBucket, number> = {
    expired: 0,
    today: 0,
    week: 0,
    later: 0,
    undated: 0,
  };
  for (const item of items) counts[expiryBucketOf(item.expiryDate, today)] += 1;
  return {
    total: items.length,
    expired: counts.expired,
    dueToday: counts.today,
    dueThisWeek: counts.week,
    undated: counts.undated,
    favorites: items.filter((item) => item.isFavorite).length,
    expiringSoon: counts.expired + counts.today + counts.week,
    cutoff: shiftDateKey(today, EXPIRING_SOON_DAYS),
  };
}

export const FRIDGE_FILTERS = ['all', 'expiring', 'favorites'] as const;
export type FridgeFilter = (typeof FRIDGE_FILTERS)[number];

export const FRIDGE_FILTER_LABELS: Record<FridgeFilter, string> = {
  all: 'All',
  expiring: 'Expiring soon',
  favorites: 'Favourites',
};

/**
 * Apply the active filter + search needle. Search matches the name OR the
 * category (donor behaviour), case-insensitively, on a trimmed needle.
 */
export function viewFridge(
  items: FridgeItem[],
  options: { filter?: FridgeFilter; query?: string; today?: string } = {}
): FridgeItem[] {
  const today = options.today ?? todayDateKey();
  let out = items;
  if (options.filter === 'expiring') out = expiringWithin(out, EXPIRING_SOON_DAYS, today);
  if (options.filter === 'favorites') out = out.filter((item) => item.isFavorite);
  const needle = (options.query ?? '').trim().toLowerCase();
  if (needle.length > 0) {
    out = out.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) || item.category.toLowerCase().includes(needle)
    );
  }
  return out;
}

/* ==================================================================== */
/* Input parsing — a keyboardType is a hint, never a guarantee           */
/* ==================================================================== */

/** Digits and ONE decimal separator, as `sanitizeAmountInput` does for macros. */
export function sanitizeQuantityInput(raw: string): string {
  if (typeof raw !== 'string') return '';
  const digitsAndSeparators = raw.replace(/[^0-9.,]/g, '');
  const firstSeparator = digitsAndSeparators.search(/[.,]/);
  if (firstSeparator === -1) return digitsAndSeparators;
  const head = digitsAndSeparators.slice(0, firstSeparator + 1);
  const tail = digitsAndSeparators.slice(firstSeparator + 1).replace(/[.,]/g, '');
  return head + tail;
}

/** Digits and dashes only — the field takes a `YYYY-MM-DD` day key. */
export function sanitizeExpiryInput(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^0-9-]/g, '').slice(0, 10);
}

export type ParsedQuantity = { valid: true; quantity: number | null } | { valid: false };

/**
 * Blank is VALID and means "no quantity" (`null`), which is a different fact
 * from `0` — an item can exist without a count. Anything else must be a finite
 * number inside the column's CHECK range, or the write is refused here rather
 * than 400ing at the Worker.
 */
export function parseQuantityInput(raw: string): ParsedQuantity {
  if (typeof raw !== 'string') return { valid: false };
  const normalized = raw.trim().replace(',', '.');
  if (normalized.length === 0) return { valid: true, quantity: null };
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > MAX_QUANTITY) return { valid: false };
  return { valid: true, quantity: Math.round(value * 100) / 100 };
}

export type ParsedExpiry = { valid: true; date: string | null } | { valid: false };

/**
 * Parse the expiry field. Blank is VALID and clears the date.
 *
 * The round-trip check is load-bearing and mirrors the server's
 * `normalizeExpiryDate`: V8 ROLLS an out-of-range day OVER rather than failing,
 * so `2026-02-30` parses happily as 2 March. Storing it verbatim would sort
 * wrongly against the `<= cutoff` comparison the whole expiring-soon window
 * depends on.
 */
export function parseExpiryInput(raw: string): ParsedExpiry {
  if (typeof raw !== 'string') return { valid: false };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { valid: true, date: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { valid: false };
  const ts = Date.parse(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(ts)) return { valid: false };
  if (new Date(ts).toISOString().slice(0, 10) !== trimmed) return { valid: false };
  return { valid: true, date: trimmed };
}

/** Quick expiry choices offered beside the field, resolved against `today`. */
export interface ExpiryQuickPick {
  id: string;
  label: string;
  days: number | null;
}

export const EXPIRY_QUICK_PICKS: readonly ExpiryQuickPick[] = [
  { id: 'today', label: 'Today', days: 0 },
  { id: '3d', label: '3 days', days: 3 },
  { id: '7d', label: '7 days', days: 7 },
  { id: '14d', label: '2 weeks', days: 14 },
  { id: '30d', label: '30 days', days: 30 },
  { id: 'none', label: 'No date', days: null },
];

export function quickPickDate(days: number | null, today = todayDateKey()): string | null {
  return days === null ? null : shiftDateKey(today, days);
}

/* ==================================================================== */
/* Wire mapping                                                          */
/* ==================================================================== */

/**
 * Read `nutrition_json` without letting a bad blob take the screen down.
 *
 * The column is stored TEXT and returned VERBATIM (the P1 convention), so what
 * comes back is whatever any client ever wrote — including an older shape, a
 * truncated string, or a value some other tool put there. Anything that is not
 * a readable object with a finite calorie figure reads as "no macros", which is
 * how the row renders anyway.
 */
export function parseFridgeNutrition(raw: string | null | undefined): FridgeNutrition | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  const number = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (typeof row.calories !== 'number' || !Number.isFinite(row.calories)) return null;
  return {
    calories: row.calories,
    protein: number(row.protein),
    carbs: number(row.carbs),
    fats: number(row.fats),
    portion: typeof row.portion === 'number' && row.portion > 0 ? row.portion : 100,
    unit: typeof row.unit === 'string' && row.unit.length > 0 ? row.unit : 'g',
    source: typeof row.source === 'string' ? row.source : undefined,
    barcode: typeof row.barcode === 'string' ? row.barcode : undefined,
  };
}

export function fromWireFridgeItem(row: HealthFridgeItem): FridgeItem {
  return {
    id: row.id,
    name: row.name,
    quantity: typeof row.quantity === 'number' && Number.isFinite(row.quantity) ? row.quantity : null,
    unit: row.unit ?? null,
    category: row.category ?? DEFAULT_FRIDGE_CATEGORY,
    expiryDate: row.expiry_date ?? null,
    isFavorite: row.is_favorite === true,
    notes: row.notes ?? '',
    source: row.source ?? 'manual',
    nutrition: parseFridgeNutrition(row.nutrition_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A draft → the wire body.
 *
 * Every field the FORM owns is sent, including the nulls: on the PUT an omitted
 * key means "leave alone", so omitting a cleared expiry or a deleted note would
 * silently keep the value the user just removed.
 *
 * `source` and `nutrition` are the exception and are sent ONLY when the draft
 * actually carries them, for the mirror-image reason — see `FridgeDraft`.
 */
function toWireFridgePayload(draft: FridgeDraft) {
  const notes = draft.notes.trim().slice(0, MAX_NOTES_LENGTH);
  return {
    name: draft.name.trim().slice(0, MAX_NAME_LENGTH),
    quantity: draft.quantity,
    unit: draft.unit.trim().slice(0, MAX_UNIT_LENGTH) || null,
    category: draft.category.trim().slice(0, MAX_CATEGORY_LENGTH) || null,
    expiry_date: draft.expiryDate,
    is_favorite: draft.isFavorite,
    notes: notes.length > 0 ? notes : null,
    ...(draft.source === undefined ? {} : { source: draft.source }),
    ...(draft.nutrition === undefined ? {} : { nutrition_json: draft.nutrition }),
  };
}

function isValidItem(item: FridgeItem | null | undefined): item is FridgeItem {
  return (
    !!item &&
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.createdAt === 'string'
  );
}

/* ==================================================================== */
/* Failure copy — no raw error string ever reaches the UI                */
/* ==================================================================== */

export type FridgeWriteStatus = 'saved' | 'offline' | 'rejected';

export const FRIDGE_OFFLINE_MESSAGE =
  'Saved on this device — it will sync when you are back online.';
export const FRIDGE_MISSING_MESSAGE = 'That item is no longer in your fridge.';

/**
 * Friendly copy for a request the SERVER refused, or `null` when the failure
 * looks like a lost connection (which `writeThrough` already handles by keeping
 * the optimistic row). Only the HTTP status is inspected — the error's own
 * message is never read, so a raw string cannot leak into the UI.
 */
export function fridgeRejectionMessageFor(error: unknown): string | null {
  const status = httpStatusOf(error);
  if (status === undefined) return null; // no answer at all → treat as offline
  if (status === 404) return FRIDGE_MISSING_MESSAGE;
  if (status === 400 || status === 422) {
    return 'Those details do not fit. Check the name, quantity and expiry date.';
  }
  if (status === 401 || status === 403) return 'Please sign in again to save this.';
  if (status >= 500) return null; // a server wobble behaves like being offline
  return 'That could not be saved. Please check the details and try again.';
}

function httpStatusOf(error: unknown): number | undefined {
  const response = (error as { response?: { status?: unknown } } | null | undefined)?.response;
  const status = response?.status;
  return typeof status === 'number' ? status : undefined;
}

/* ==================================================================== */
/* Reads                                                                 */
/* ==================================================================== */

async function fetchFridge(): Promise<FridgeItem[]> {
  const payload = await healthFridgeApi.listFridge();
  return (payload?.items ?? []).map(fromWireFridgeItem);
}

/** The WHOLE fridge, newest-added first — mirrors the Worker's own ordering. */
export async function loadFridge(): Promise<FridgeItem[]> {
  const items = await readThrough(HEALTH_FRIDGE_KEY, fetchFridge, []);
  return items.filter(isValidItem).sort(byNewestFirst);
}

/**
 * Ask the Worker for the expiring window itself, so the screen shows the SAME
 * rows the deployed filter returns rather than a lookalike computed here.
 *
 * The response is deliberately NOT cached: it is a filtered view, and writing a
 * filtered list under the one snapshot key would leave an offline read showing
 * only the near-expiry items as if they were the whole fridge. Offline we fall
 * back to the identical rule applied to the cached full list.
 */
export async function loadExpiringSoon(
  days = EXPIRING_SOON_DAYS,
  today = todayDateKey()
): Promise<FridgeItem[]> {
  try {
    const payload = await healthFridgeApi.listFridge({ expiring_within_days: days, today });
    return (payload?.items ?? []).map(fromWireFridgeItem).filter(isValidItem).sort(byExpiryAsc);
  } catch {
    return expiringWithin(await loadFridge(), days, today);
  }
}

/* ==================================================================== */
/* Writes                                                                */
/* ==================================================================== */

export interface FridgeWriteResult {
  items: FridgeItem[];
  status: FridgeWriteStatus;
  message: string | null;
}

/**
 * One write against the cached fridge, with the three outcomes the UI has to
 * tell apart:
 *
 *  - `saved`    — the Worker took it;
 *  - `offline`  — the request never landed, so `writeThrough` keeps the
 *                 optimistic row and the user still sees what they just did;
 *  - `rejected` — the Worker refused it (already deleted, impossible date).
 *                 The optimistic row is ROLLED BACK, because it does not exist
 *                 server-side and a phantom row would outlive the session and
 *                 reappear on every cold start.
 *
 * Same shape as `healthFoodStorage.writeList` on purpose — the copy differs per
 * domain, the outcome contract does not.
 */
async function writeFridge(options: {
  before: FridgeItem[];
  optimistic: FridgeItem[];
  request: () => Promise<unknown>;
  detail: string;
}): Promise<FridgeWriteResult> {
  // A holder rather than a `let`: TypeScript does not track assignments made
  // inside the callback below.
  const outcome: { rejection: string | null } = { rejection: null };

  const items = await writeThrough(
    HEALTH_FRIDGE_KEY,
    async () => {
      try {
        await options.request();
      } catch (error) {
        outcome.rejection = fridgeRejectionMessageFor(error);
        throw error;
      }
    },
    fetchFridge,
    options.optimistic,
    options.detail
  );

  if (outcome.rejection !== null) {
    await storageHelpers.setObject(HEALTH_FRIDGE_KEY, options.before);
    return { items: sortFridge(options.before), status: 'rejected', message: outcome.rejection };
  }

  const offline = healthSyncStateFor(HEALTH_FRIDGE_KEY) === 'offline';
  return {
    items: sortFridge(items),
    status: offline ? 'offline' : 'saved',
    message: offline ? FRIDGE_OFFLINE_MESSAGE : null,
  };
}

export function sortFridge(items: FridgeItem[]): FridgeItem[] {
  return [...items].filter(isValidItem).sort(byNewestFirst);
}

export async function createFridgeItem(draft: FridgeDraft): Promise<FridgeWriteResult> {
  const before = await loadFridge();
  const now = new Date().toISOString();
  const optimistic: FridgeItem = {
    id: `pending-${now}`,
    name: draft.name.trim().slice(0, MAX_NAME_LENGTH),
    quantity: draft.quantity,
    unit: draft.unit || null,
    category: draft.category || DEFAULT_FRIDGE_CATEGORY,
    expiryDate: draft.expiryDate,
    isFavorite: draft.isFavorite,
    notes: draft.notes.trim().slice(0, MAX_NOTES_LENGTH),
    source: draft.source ?? 'manual',
    nutrition: draft.nutrition ?? null,
    createdAt: now,
    updatedAt: now,
  };
  return writeFridge({
    before,
    optimistic: [optimistic, ...before],
    request: () => healthFridgeApi.createFridgeItem(toWireFridgePayload(draft)),
    detail: `insert name=${optimistic.name}`,
  });
}

export async function updateFridgeItem(
  id: string,
  draft: FridgeDraft
): Promise<FridgeWriteResult> {
  const before = await loadFridge();
  const now = new Date().toISOString();
  const optimistic = before.map((item) =>
    item.id === id
      ? {
          ...item,
          name: draft.name.trim().slice(0, MAX_NAME_LENGTH),
          quantity: draft.quantity,
          unit: draft.unit || null,
          category: draft.category || DEFAULT_FRIDGE_CATEGORY,
          expiryDate: draft.expiryDate,
          isFavorite: draft.isFavorite,
          notes: draft.notes.trim().slice(0, MAX_NOTES_LENGTH),
          updatedAt: now,
        }
      : item
  );
  return writeFridge({
    before,
    optimistic,
    request: () => healthFridgeApi.updateFridgeItem(id, toWireFridgePayload(draft)),
    detail: `update id=${id}`,
  });
}

/** Star toggle — patches ONLY `is_favorite` so nothing else can be clobbered. */
export async function setFridgeFavorite(
  id: string,
  isFavorite: boolean
): Promise<FridgeWriteResult> {
  const before = await loadFridge();
  return writeFridge({
    before,
    optimistic: before.map((item) => (item.id === id ? { ...item, isFavorite } : item)),
    request: () => healthFridgeApi.updateFridgeItem(id, { is_favorite: isFavorite }),
    detail: `favorite id=${id} value=${isFavorite}`,
  });
}

/** Soft delete server-side; the row leaves the list either way. */
export async function deleteFridgeItem(id: string): Promise<FridgeWriteResult> {
  const before = await loadFridge();
  return writeFridge({
    before,
    optimistic: before.filter((item) => item.id !== id),
    request: () => healthFridgeApi.deleteFridgeItem(id),
    detail: `delete id=${id}`,
  });
}

/**
 * Save several drafts in one go (the receipt review's "Add these").
 *
 * SEQUENTIAL, not `Promise.all`. Each POST is a separate row and the Worker
 * gives each its own id; firing them in parallel would race the read-back that
 * `writeThrough` does after every write, and the last one home would decide what
 * the cache holds. Sequential also means a refusal halfway through leaves the
 * earlier rows saved, which is the honest outcome — they really were.
 *
 * Reports what happened per draft rather than collapsing to one verdict: "6 of 8
 * items added" is actionable, "something went wrong" is not.
 */
export interface FridgeBatchResult extends FridgeWriteResult {
  saved: number;
  attempted: number;
}

export async function addFridgeItems(drafts: readonly FridgeDraft[]): Promise<FridgeBatchResult> {
  if (drafts.length === 0) {
    const items = await loadFridge();
    return { items, status: 'saved', message: null, saved: 0, attempted: 0 };
  }

  let last: FridgeWriteResult | null = null;
  let saved = 0;
  let offline = 0;
  let rejected = 0;

  for (const draft of drafts) {
    last = await createFridgeItem(draft);
    if (last.status === 'saved') saved += 1;
    else if (last.status === 'offline') offline += 1;
    else rejected += 1;
  }

  const items = last?.items ?? (await loadFridge());
  const attempted = drafts.length;

  if (rejected === 0 && offline === 0) {
    return {
      items,
      status: 'saved',
      message: `${saved} ${saved === 1 ? 'item' : 'items'} added to your fridge.`,
      saved,
      attempted,
    };
  }
  if (rejected === 0) {
    // Everything landed in the cache; some of it has not reached the server yet.
    return {
      items,
      status: 'offline',
      message: FRIDGE_OFFLINE_MESSAGE,
      saved,
      attempted,
    };
  }
  return {
    items,
    status: 'rejected',
    message: `${saved} of ${attempted} ${attempted === 1 ? 'item was' : 'items were'} added. The rest could not be saved — check their details and try again.`,
    saved,
    attempted,
  };
}

/* ==================================================================== */
/* P5 — barcode                                                          */
/* ==================================================================== */

/**
 * What a barcode lookup can end in. Five outcomes rather than "worked / did
 * not", because the right next action differs for every one of them.
 */
export type FridgeBarcodeStatus =
  | 'found'
  | 'not_found'
  | 'invalid'
  | 'not_configured'
  | 'unavailable';

export interface FridgeBarcodeResult {
  status: FridgeBarcodeStatus;
  /** Ready to save, or to open in the add form for editing. Null unless `found`. */
  draft: FridgeDraft | null;
  /** The GTIN-13 the server actually looked up, so the screen can show it. */
  barcode: string;
  /** Always member-facing. Never a provider string. */
  message: string;
}

/** Digits only, and never longer than a GTIN-14. Mirrors the server's own rule. */
export function sanitizeBarcodeInput(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\D/g, '').slice(0, 14);
}

/**
 * A barcode is worth sending when it is at least 8 digits — the shortest real
 * retail symbology (EAN-8/UPC-E). Below that it is a half-typed code, and asking
 * spends a provider call to be told nothing.
 */
export function isSendableBarcode(code: string): boolean {
  const digits = sanitizeBarcodeInput(code);
  return digits.length >= 8 && digits.length <= 14;
}

/**
 * Turn a provider food into a fridge draft.
 *
 * The macros are kept for the SERVING the provider quoted, together with that
 * serving, rather than being folded into a per-100 basis here — deriving a basis
 * on the device is the recompute-on-device trap `src/api/healthFood.ts` names,
 * and a fridge row is a thing in a fridge, not a library food. Someone who wants
 * it in their food library imports it there, where the Worker does the maths.
 *
 * No expiry is set. A barcode identifies a PRODUCT; it says nothing about the
 * particular tin in this person's hand, and the donor's own barcode path left
 * expiry null too.
 */
export function barcodeDraft(food: HealthExternalFood, barcode: string): FridgeDraft {
  const name = [food.brand_name, food.name].filter((part) => !!part && part.length > 0).join(' ');
  return {
    ...EMPTY_FRIDGE_DRAFT,
    name: (name.length > 0 ? name : food.name).slice(0, MAX_NAME_LENGTH),
    quantity: 1,
    unit: DEFAULT_FRIDGE_UNIT,
    category: DEFAULT_FRIDGE_CATEGORY,
    // The donor stashed the code in `notes` and so does this — there is no
    // `barcode` column on `fridge_items`, and adding one for a string that is
    // already inside `nutrition_json` would be a migration for nothing.
    notes: `Barcode ${barcode}`,
    source: 'scan',
    nutrition: {
      calories: food.calories,
      protein: food.proteins,
      carbs: food.carbohydrates,
      fats: food.fats,
      portion: food.portion,
      unit: food.unit,
      source: food.provider,
      barcode,
    },
  };
}

export const BARCODE_COPY: Record<FridgeBarcodeStatus, string> = {
  found: '',
  not_found:
    'That code is not in the food database. Add the item by hand — the name and category are all the fridge needs.',
  invalid: 'That does not look like a barcode. Enter the digits printed under the bars.',
  // Names the state honestly: the feature is not switched on for this build, not
  // broken and not the person's fault.
  not_configured:
    'Barcode lookup is not switched on for this app yet. Add the item by hand in the meantime.',
  unavailable:
    'The food database could not be reached just now. Try again in a moment, or add the item by hand.',
};

/**
 * Look a barcode up and hand back a draft.
 *
 * Every provider outcome answers HTTP 200 carrying a status, so the only reason
 * this throws is a transport failure — which is caught and reported as
 * `unavailable`, the same thing a 503 would mean to the person.
 */
export async function lookupFridgeBarcode(code: string): Promise<FridgeBarcodeResult> {
  const digits = sanitizeBarcodeInput(code);
  if (!isSendableBarcode(digits)) {
    return { status: 'invalid', draft: null, barcode: digits, message: BARCODE_COPY.invalid };
  }

  let payload;
  try {
    payload = await healthFridgeApi.lookupBarcode(digits);
  } catch {
    return {
      status: 'unavailable',
      draft: null,
      barcode: digits,
      message: BARCODE_COPY.unavailable,
    };
  }

  const barcode = payload?.barcode || digits;
  const status = payload?.provider?.status;
  if (status === 'not_configured') {
    return {
      status: 'not_configured',
      draft: null,
      barcode,
      message: BARCODE_COPY.not_configured,
    };
  }
  if (status !== 'ok') {
    // `rate_limited` and `unavailable` are the same sentence to the person: we
    // could not ask, try again shortly.
    return { status: 'unavailable', draft: null, barcode, message: BARCODE_COPY.unavailable };
  }
  if (!payload.food) {
    return { status: 'not_found', draft: null, barcode, message: BARCODE_COPY.not_found };
  }
  return {
    status: 'found',
    draft: barcodeDraft(payload.food, barcode),
    barcode,
    message: '',
  };
}

/* ==================================================================== */
/* P5 — receipt                                                          */
/* ==================================================================== */

/**
 * Outcomes of an AI call on this surface, shared by the receipt reader and the
 * meal planner because the GATES are the same: entitlement, then credential,
 * then the model itself.
 */
export type FridgeAiStatus = 'ok' | 'needs_ai' | 'unsupported' | 'unreadable' | 'unavailable';

/** One reviewable row from a receipt, plus whether it is ticked. */
export interface ReceiptDraftRow {
  /** Stable within one scan, so a list can key on it before anything is saved. */
  key: string;
  name: string;
  category: string;
  /** Null when the receipt reader could not place it in a fridge category. */
  suggestedExpiryDays: number | null;
  /** What the suggested shelf life resolves to against today. Null when none. */
  suggestedExpiryDate: string | null;
  amountCents: number | null;
  looksLikeFood: boolean;
  /** Pre-ticked for food, unticked for everything else. */
  selected: boolean;
}

export interface FridgeReceiptResult {
  status: FridgeAiStatus;
  vendor: string | null;
  purchaseDate: string | null;
  rows: ReceiptDraftRow[];
  message: string | null;
}

export const FRIDGE_AI_COPY: Record<Exclude<FridgeAiStatus, 'ok'>, string> = {
  // Names the route to fixing it. "Not available" with no next step is where
  // members give up — same wording the Scan screen uses for the same gate.
  needs_ai:
    'AI is not switched on for this account. Open More → AI access to turn it on, or add the items by hand.',
  unsupported:
    'That image could not be read. Take the photo again as a JPEG or PNG, or pick a different one.',
  unreadable:
    'No shopping could be read from that. Try again in better light with the whole receipt in frame, or add the items by hand.',
  unavailable: 'The AI could not be reached just now. Please try again in a moment.',
};

/**
 * Map a failed AI call to a status.
 *
 * Reads the HTTP STATUS only — never the server's message and never the axios
 * error — so no raw string can reach the UI. 403 is the entitlement denial the
 * Worker raises from `assertCanUseAI`; 429 is the Health AI rate limiter, which
 * is a "slow down", not a broken feature.
 */
export function fridgeAiStatusFor(error: unknown): Exclude<FridgeAiStatus, 'ok'> {
  const status = (error as { response?: { status?: unknown } } | null | undefined)?.response
    ?.status;
  if (status === 403) return 'needs_ai';
  if (status === 415) return 'unsupported';
  if (status === 422) return 'unreadable';
  return 'unavailable';
}

/** Shelf-life suggestion resolved against a day, or null when we should not guess. */
export function suggestedExpiryDate(days: number | null, today = todayDateKey()): string | null {
  if (days === null || !Number.isFinite(days) || days < 0) return null;
  return shiftDateKey(today, Math.round(days));
}

export function receiptRow(
  item: HealthFridgeReceiptItem,
  index: number,
  today = todayDateKey()
): ReceiptDraftRow {
  const days = typeof item.suggested_expiry_days === 'number' ? item.suggested_expiry_days : null;
  return {
    key: `${index}-${item.name}`,
    name: item.name,
    category: item.category ?? DEFAULT_FRIDGE_CATEGORY,
    suggestedExpiryDays: days,
    suggestedExpiryDate: suggestedExpiryDate(days, today),
    amountCents:
      typeof item.amount_cents === 'number' && Number.isFinite(item.amount_cents)
        ? item.amount_cents
        : null,
    looksLikeFood: item.looks_like_food === true,
    // Ticked by default only for food. A receipt carries batteries and bag fees
    // too, and a fridge that filled itself with them would need cleaning out by
    // hand — but they are still SHOWN, so a wrongly-classified item can be
    // ticked rather than looking like a misread.
    selected: item.looks_like_food === true,
  };
}

/**
 * Read a photographed receipt into reviewable rows. NOTHING IS SAVED.
 *
 * `images` are consecutive sections of ONE receipt when there is more than one —
 * the reader is told so, and reads them in order without double-counting the
 * overlap.
 */
export async function scanFridgeReceipt(
  images: HealthScanImage[],
  today = todayDateKey()
): Promise<FridgeReceiptResult> {
  try {
    const { draft } = await healthFridgeApi.scanFridgeReceipt(images);
    const items = Array.isArray(draft?.items) ? draft.items : [];
    return {
      status: 'ok',
      vendor: draft?.vendor ?? null,
      purchaseDate: draft?.purchase_date ?? null,
      rows: items.map((item, index) => receiptRow(item, index, today)),
      message: null,
    };
  } catch (error) {
    const status = fridgeAiStatusFor(error);
    return {
      status,
      vendor: null,
      purchaseDate: null,
      rows: [],
      message: FRIDGE_AI_COPY[status],
    };
  }
}

/** A ticked review row → the draft that gets POSTed. */
export function receiptRowToDraft(row: ReceiptDraftRow, expiryDate: string | null): FridgeDraft {
  return {
    ...EMPTY_FRIDGE_DRAFT,
    name: row.name.slice(0, MAX_NAME_LENGTH),
    // A receipt does not print how many you bought in a form that survives the
    // reader's grouping (three tomato lines become one "Tomatoes"), so quantity
    // stays UNKNOWN rather than being invented as 1.
    quantity: null,
    unit: DEFAULT_FRIDGE_UNIT,
    category: row.category || DEFAULT_FRIDGE_CATEGORY,
    expiryDate,
    notes: 'Added from a receipt',
    source: 'receipt',
  };
}

/* ==================================================================== */
/* P5 — meal ideas                                                       */
/* ==================================================================== */

export interface FridgeMealResult {
  status: FridgeAiStatus;
  plan: HealthFridgeMealPlan | null;
  message: string | null;
}

/**
 * The donor's own default goal string (`userDietaryGoal` in `UserDefaults`,
 * falling back to "Healthy eating"). Kept verbatim so the prompt behaves the
 * same for someone who has never set one.
 */
export const DEFAULT_MEAL_GOAL = 'Healthy eating';

/**
 * Ask what could be cooked from the fridge.
 *
 * Deliberately NOT cached. A meal idea is a request, not a record: it is a
 * function of what is in the fridge and what is going off TODAY, so a cached
 * copy would be about a fridge that no longer exists — and caching it would put
 * a fourth food-related snapshot on a shared handset for no benefit.
 *
 * An empty `plan.meals` with a note is a SUCCESS, not a failure. A fridge
 * holding three condiments has no meal in it, and saying so is the right answer.
 */
export async function loadFridgeMealIdeas(options?: {
  goal?: string;
  restrictions?: string | null;
  today?: string;
}): Promise<FridgeMealResult> {
  const today = options?.today ?? todayDateKey();
  try {
    const { plan } = await healthFridgeApi.fridgeMealIdeas({
      today,
      goal: options?.goal?.trim() || DEFAULT_MEAL_GOAL,
      restrictions: options?.restrictions ?? null,
    });
    return {
      status: 'ok',
      plan: {
        meals: Array.isArray(plan?.meals) ? plan.meals : [],
        notes: plan?.notes ?? null,
        considered: Array.isArray(plan?.considered) ? plan.considered : [],
      },
      message: null,
    };
  } catch (error) {
    const status = fridgeAiStatusFor(error);
    return { status, plan: null, message: FRIDGE_AI_COPY[status] };
  }
}
