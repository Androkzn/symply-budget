import { healthApi, type HealthGoal, type HealthWaterEntry, type HealthWaterUnit } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  CUP_ML,
  DEFAULT_WATER_TARGET,
  HEALTH_WATER_KEY,
  clampTarget,
  todayDateKey,
} from './healthLocalStorage';
import { readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — water intake (donor `WaterIntakeView` / `WaterIntakeViewModel`).
 *
 * The ±1-cup counter on Home and Nutrition stays in `healthLocalStorage.ts`;
 * this module owns the DEDICATED surface — presets, a custom amount, today's
 * per-entry log with delete, the goal, and the ml/oz display choice.
 *
 * WHY TWO MODULES AND NOT A FORK: both talk to the SAME server rows
 * (`/health/water/entries`) and both refresh the SAME cache key
 * (`health.water.v1`), so a cup added on Home shows up in this log and a drink
 * deleted here moves Home's counter. What differs is only the vocabulary: Home
 * counts cups because that is all a ±1 control can mean; this screen counts
 * millilitres because a 500 ml bottle is not two cups.
 *
 * UNITS. Millilitres are canonical everywhere — on the wire, in the cache and in
 * every stored figure. `ml` / `oz` / `L` / `cups` are DISPLAY choices only,
 * applied at the edge by {@link formatVolume} / {@link parseVolume}. The donor
 * has no oz at all (its `WaterEntry.amount` is ml and no setting exists);
 * storing a converted figure would mean two sources of truth for one glass of
 * water and a rounding error every time the member switched.
 *
 * THE UNIT ITSELF, unlike the amount, IS synced server-side (0140,
 * `health_goals.water_unit`) — a choice made once during onboarding should not
 * have to be repeated on a second device. Same optional-vs-null contract
 * `healthWeightStorage`'s biometrics fields already established: the KEY
 * absent from `GET /goals` means this Worker predates 0140 (keep whatever this
 * handset last knew), an explicit `null` means the member has not chosen one
 * yet (fall back to 'ml').
 */

/** US fluid ounce. The donor's own constant, from `UnitConversion.swift:111`. */
export const FL_OZ_ML = 29.5735;

export type { HealthWaterUnit };
export type WaterUnit = HealthWaterUnit;

const WATER_UNITS: readonly WaterUnit[] = ['ml', 'oz', 'L', 'cups'];

function isWaterUnit(value: unknown): value is WaterUnit {
  return typeof value === 'string' && (WATER_UNITS as readonly string[]).includes(value);
}

/** Display preference — device-cached, but the SOURCE of truth is `health_goals.water_unit` (0140). */
export const HEALTH_WATER_PREFS_KEY = 'health.waterPrefs.v1';

export interface WaterPrefs {
  unit: WaterUnit;
}

const DEFAULT_WATER_PREFS: WaterPrefs = { unit: 'ml' };

/** Donor `WaterIntakeView` quick-add buttons — exact amounts and labels. */
export interface WaterPreset {
  /** Stable key; also the `container` written on the entry. */
  id: string;
  label: string;
  ml: number;
  icon: string;
}

export const WATER_PRESETS: readonly WaterPreset[] = [
  { id: 'Glass', label: 'Glass', ml: 250, icon: 'water' },
  { id: 'Mug', label: 'Mug', ml: 350, icon: 'hydration' },
  { id: 'Bottle', label: 'Bottle', ml: 500, icon: 'water' },
];

/** Donor `WaterGoalEditor` quick presets, in millilitres. */
export const WATER_GOAL_PRESETS_ML = [1500, 2000, 2500, 3000, 3500] as const;

/** Donor `@AppStorage("dailyWaterGoal")`. 2,000 ml = the ring's denominator. */
export const DEFAULT_WATER_GOAL_ML = DEFAULT_WATER_TARGET * CUP_ML;

/** The donor's glasses row divides the day's total by a 250 ml glass. */
export const GLASS_ML = 250;

/** A single drink is capped by the route (`amount_ml` max 10,000). */
const MAX_ENTRY_ML = 10_000;
const MIN_ENTRY_ML = 1;
/** The goal slider's donor range is 1,000–5,000 ml. */
const MIN_GOAL_ML = 250;
const MAX_GOAL_ML = 10_000;
const MAX_LOG_ENTRIES = 60;

export interface WaterLogEntry {
  id: string;
  date: string;
  amountMl: number;
  /** Which preset poured it, when the entry recorded one. */
  container: string | null;
  beverageType: string;
  /** ISO stamp — the log row prints the time of day from this. */
  createdAt: string;
}

export interface WaterDayDetail {
  date: string;
  totalMl: number;
  goalMl: number;
  entries: WaterLogEntry[];
}

/* ------------------------------------------------------------------ */
/* Unit conversion + formatting                                        */
/* ------------------------------------------------------------------ */

export function mlToOz(ml: number): number {
  return ml / FL_OZ_ML;
}

export function ozToMl(oz: number): number {
  return oz * FL_OZ_ML;
}

/** Clamp a single drink to what the route will accept; 0 means "reject". */
export function clampEntryMl(ml: number): number {
  if (!Number.isFinite(ml)) return 0;
  const rounded = Math.round(ml);
  if (rounded < MIN_ENTRY_ML) return 0;
  return Math.min(MAX_ENTRY_ML, rounded);
}

export function clampGoalMl(ml: number): number {
  if (!Number.isFinite(ml) || ml <= 0) return DEFAULT_WATER_GOAL_ML;
  return Math.max(MIN_GOAL_ML, Math.min(MAX_GOAL_ML, Math.round(ml)));
}

/**
 * Render a millilitre figure in the member's chosen unit.
 *
 * `ml` switches to litres above 1,000 — the donor's own rule
 * (`WaterEntry.displayAmount`). `oz` never switches unit because there is no
 * customary larger one — 68 fl oz is how a US label states it. `L` and `cups`
 * are explicit choices, so they stay in that unit regardless of magnitude —
 * a member who picked litres did not ask for the app to switch them back.
 */
export function formatVolume(ml: number, unit: WaterUnit): string {
  const safe = Number.isFinite(ml) ? ml : 0;
  switch (unit) {
    case 'oz': {
      const oz = mlToOz(safe);
      // Whole ounces past 10 — a decimal on "67.6 oz" reads as false
      // precision on a figure that came from counting glasses.
      return oz >= 10 ? `${Math.round(oz)} oz` : `${oz.toFixed(1)} oz`;
    }
    case 'L':
      return `${(safe / 1000).toFixed(1)} L`;
    case 'cups':
      return `${(safe / CUP_ML).toFixed(1)} cups`;
    default:
      return safe >= 1000 ? `${(safe / 1000).toFixed(1)} L` : `${Math.round(safe)} ml`;
  }
}

/** Short unit label for a field's suffix. */
export function unitLabel(unit: WaterUnit): string {
  switch (unit) {
    case 'oz':
      return 'oz';
    case 'L':
      return 'L';
    case 'cups':
      return 'cups';
    default:
      return 'ml';
  }
}

/** A typed figure in `unit`, converted to millilitres. Never clamped or rounded — see `parseVolume`. */
function toMl(value: number, unit: WaterUnit): number {
  switch (unit) {
    case 'oz':
      return ozToMl(value);
    case 'L':
      return value * 1000;
    case 'cups':
      return value * CUP_ML;
    default:
      return value;
  }
}

/**
 * Read a typed amount in the DISPLAY unit back into millilitres.
 *
 * Returns 0 for anything unusable, which every caller treats as "the Add button
 * stays disabled" — a raw parse error must never reach the UI.
 */
export function parseVolume(raw: string, unit: WaterUnit): number {
  const cleaned = (raw ?? '').replace(/[^0-9.]/g, '');
  if (cleaned.length === 0) return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return clampEntryMl(toMl(value, unit));
}

/** The step a ± button moves by, in ml, sized for the display unit. */
export function stepMl(unit: WaterUnit): number {
  switch (unit) {
    // ~2 oz is the donor wheel's 50 ml stride's nearest customary sibling.
    case 'oz':
      return Math.round(2 * FL_OZ_ML);
    // A tenth of a litre — the same granularity `formatVolume` prints.
    case 'L':
      return 100;
    // A whole cup — anything finer is false precision on a poured drink.
    case 'cups':
      return CUP_ML;
    default:
      return 50;
  }
}

/**
 * A millilitre figure as the bare number to seed a TEXT FIELD with, in the
 * display unit — no suffix, so what comes back out of the field parses again.
 * Returns '' for zero so a field shows its placeholder rather than "0".
 */
export function toUnitInput(ml: number, unit: WaterUnit): string {
  if (!Number.isFinite(ml) || ml <= 0) return '';
  switch (unit) {
    case 'oz':
      return String(Math.round(mlToOz(ml)));
    case 'L':
      return (ml / 1000).toFixed(1);
    case 'cups':
      return (ml / CUP_ML).toFixed(1);
    default:
      return String(Math.round(ml));
  }
}

/* ------------------------------------------------------------------ */
/* Unit preference (0140 — server-synced)                              */
/* ------------------------------------------------------------------ */

/**
 * True once the answer came from a Worker that has migration 0140.
 *
 * Presence of the KEY is the signal, not its value — same reasoning
 * `hasServerWeightGoalSupport` documents in `healthWeightStorage.ts`.
 */
export function hasServerWaterUnitSupport(goal: HealthGoal | null | undefined): boolean {
  return goal !== null && goal !== undefined && 'water_unit' in goal;
}

async function fetchWaterPrefs(): Promise<WaterPrefs> {
  const { goal } = await healthApi.getGoal();
  const cached = await storageHelpers.getObject<WaterPrefs>(HEALTH_WATER_PREFS_KEY);
  // Validated the same way the server figure is below — a corrupt or
  // older-shaped cache blob must fall back to the default, not be believed.
  const cachedUnit = isWaterUnit(cached?.unit) ? cached.unit : null;

  // A Worker without 0140 cannot answer the question, so its silence must not
  // be read as "reset to ml" — keep whatever this handset last knew.
  if (!hasServerWaterUnitSupport(goal)) {
    return cachedUnit ? { unit: cachedUnit } : DEFAULT_WATER_PREFS;
  }
  const unit = goal?.water_unit;
  return isWaterUnit(unit) ? { unit } : DEFAULT_WATER_PREFS;
}

export async function loadWaterPrefs(): Promise<WaterPrefs> {
  return readThrough(HEALTH_WATER_PREFS_KEY, fetchWaterPrefs, DEFAULT_WATER_PREFS);
}

/**
 * Save the display-unit choice.
 *
 * Written to the shared, effective-dated `health_goals` row — see
 * `saveWeightGoal`'s own header comment for why a queued offline write MERGES
 * with whatever else is already queued at the same `(collection,
 * effective_date)` handle rather than clobbering a sibling feature's edit.
 */
export async function saveWaterUnit(unit: WaterUnit): Promise<WaterPrefs> {
  const next: WaterPrefs = { unit: isWaterUnit(unit) ? unit : 'ml' };
  return writeThrough(
    HEALTH_WATER_PREFS_KEY,
    () => healthApi.saveGoal({ water_unit: next.unit }),
    // Re-read so a server that silently dropped the key (pre-0140) is caught
    // on the next read rather than believed — same "trust the read-back, not
    // the request" pattern `saveWeightGoal` uses for its own biometrics.
    async () => {
      const { goal } = await healthApi.getGoal();
      const freshUnit = goal?.water_unit;
      if (hasServerWaterUnitSupport(goal) && isWaterUnit(freshUnit)) {
        return { unit: freshUnit };
      }
      return next;
    },
    next,
    `water_unit=${next.unit}`,
    {
      queue: {
        collection: 'health_goals',
        row: { water_unit: next.unit, effective_date: todayDateKey() },
      },
    }
  );
}

/* ------------------------------------------------------------------ */
/* Today's log                                                         */
/* ------------------------------------------------------------------ */

/** Cache for the per-entry day log; the ±cup counter keeps its own key. */
export const HEALTH_WATER_LOG_KEY = 'health.waterLog.v1';

function toLogEntry(row: HealthWaterEntry): WaterLogEntry {
  return {
    id: row.id,
    date: row.date,
    amountMl: Math.max(0, Math.round(row.amount_ml ?? 0)),
    container: row.container ?? null,
    beverageType: row.beverage_type ?? 'water',
    createdAt: row.created_at,
  };
}

async function fetchWaterDay(date: string): Promise<WaterDayDetail> {
  // Two calls, deliberately: the summary carries the server's own total AND the
  // effective-dated goal, so the ring never disagrees with the log because the
  // device re-added the rows itself.
  const [summaryRes, entriesRes] = await Promise.all([
    healthApi.waterSummary(date),
    healthApi.listWater({ from: date, to: date }),
  ]);
  const entries = (entriesRes.entries ?? [])
    .map(toLogEntry)
    .filter((e) => e.amountMl > 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_LOG_ENTRIES);
  return {
    date,
    totalMl: Math.max(0, Math.round(summaryRes.summary?.total_ml ?? 0)),
    goalMl: clampGoalMl(summaryRes.summary?.goal_ml ?? DEFAULT_WATER_GOAL_ML),
    entries,
  };
}

function emptyWaterDay(date: string): WaterDayDetail {
  return { date, totalMl: 0, goalMl: DEFAULT_WATER_GOAL_ML, entries: [] };
}

/**
 * Today's total, goal and every drink that made it up.
 *
 * Offline this falls back to the cached snapshot; a cached snapshot from a
 * PREVIOUS day is replaced with an empty one that keeps the goal, rather than
 * showing yesterday's drinks as if they were today's.
 */
export async function loadWaterDay(date = todayDateKey()): Promise<WaterDayDetail> {
  const day = await readThrough(
    HEALTH_WATER_LOG_KEY,
    () => fetchWaterDay(date),
    emptyWaterDay(date)
  );
  // `readThrough<WaterDayDetail>` always resolves a (possibly stale-shaped)
  // object — never null/undefined — so `day` itself needs no null guard here;
  // `day.goalMl` still can be, from a cache blob written by an older schema.
  if (day.date !== date) {
    return { ...emptyWaterDay(date), goalMl: clampGoalMl(day.goalMl ?? DEFAULT_WATER_GOAL_ML) };
  }
  return {
    date: day.date,
    totalMl: Math.max(0, Math.round(day.totalMl ?? 0)),
    goalMl: clampGoalMl(day.goalMl ?? DEFAULT_WATER_GOAL_ML),
    entries: Array.isArray(day.entries) ? day.entries.slice(0, MAX_LOG_ENTRIES) : [],
  };
}

/**
 * Keep the ±cup counter's cache in step after a write here.
 *
 * Home reads `health.water.v1` and would otherwise show a stale cup count until
 * its own next fetch — the two surfaces describe the same day, so they must
 * never disagree on screen. Cups are DERIVED from the authoritative millilitre
 * total, never accumulated separately.
 */
async function mirrorCupCounter(day: WaterDayDetail): Promise<void> {
  await storageHelpers.setObject(HEALTH_WATER_KEY, {
    date: day.date,
    cups: Math.max(0, Math.round(day.totalMl / CUP_ML)),
    target: clampTarget(Math.round(day.goalMl / CUP_ML)),
  });
}

/**
 * Log a drink. `amountMl` is already in millilitres — callers convert at the
 * edge so no unit ever reaches the wire.
 */
export async function addWaterAmount(
  amountMl: number,
  options: { date?: string; container?: string | null } = {}
): Promise<WaterDayDetail> {
  const date = options.date ?? todayDateKey();
  const amount = clampEntryMl(amountMl);
  const current = await loadWaterDay(date);
  if (amount <= 0) return current;

  // Random suffix, not just the timestamp: two logs inside the same
  // millisecond must still mint DISTINCT rows, or the second would be read as
  // an EDIT of the first and one drink would be lost from the outbox.
  const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const optimistic: WaterDayDetail = {
    ...current,
    totalMl: current.totalMl + amount,
    entries: [
      {
        // Placeholder id: the read-through below replaces the whole list with
        // the server's, so this is never used to address a row on the online
        // path — only the offline queue (below) reuses it.
        id: pendingId,
        date,
        amountMl: amount,
        container: options.container ?? null,
        beverageType: 'water',
        createdAt: new Date().toISOString(),
      },
      ...current.entries,
    ].slice(0, MAX_LOG_ENTRIES),
  };

  const next = await writeThrough(
    HEALTH_WATER_LOG_KEY,
    () =>
      healthApi.addWater({
        date,
        amount_ml: amount,
        ...(options.container ? { container: options.container } : {}),
      }),
    () => fetchWaterDay(date),
    optimistic,
    `water date=${date} +${amount}ml`,
    {
      queue: {
        collection: 'water_entries',
        row: {
          id: pendingId,
          date,
          amount_ml: amount,
          ...(options.container ? { container: options.container } : {}),
        },
      },
    }
  );
  await mirrorCupCounter(next);
  return next;
}

/**
 * Remove ONE logged drink.
 *
 * This is a real per-entry delete (`DELETE /water/entries/:id`), not the ±cup
 * control's "undo the last sip" — the member is pointing at a specific row.
 */
export async function deleteWaterEntry(
  id: string,
  date = todayDateKey()
): Promise<WaterDayDetail> {
  const current = await loadWaterDay(date);
  const target = current.entries.find((e) => e.id === id);
  const optimistic: WaterDayDetail = {
    ...current,
    totalMl: Math.max(0, current.totalMl - (target?.amountMl ?? 0)),
    entries: current.entries.filter((e) => e.id !== id),
  };
  const next = await writeThrough(
    HEALTH_WATER_LOG_KEY,
    () => healthApi.deleteWater(id),
    () => fetchWaterDay(date),
    optimistic,
    `water delete=${id}`,
    target
      ? {
          queue: {
            collection: 'water_entries',
            row: {
              id,
              date,
              amount_ml: target.amountMl,
              deleted_at: new Date().toISOString(),
            },
          },
        }
      : undefined
  );
  await mirrorCupCounter(next);
  return next;
}

/**
 * Set the daily goal, in millilitres.
 *
 * Written to the effective-dated goal row (`daily_water_ml`) — the same field
 * Home's cup target reads, so the two surfaces cannot drift apart.
 */
export async function setWaterGoalMl(goalMl: number): Promise<WaterDayDetail> {
  const date = todayDateKey();
  const goal = clampGoalMl(goalMl);
  const current = await loadWaterDay(date);
  const next: WaterDayDetail = { ...current, goalMl: goal };
  const saved = await writeThrough(
    HEALTH_WATER_LOG_KEY,
    () => healthApi.saveGoal({ daily_water_ml: goal }),
    async () => next,
    next,
    `water goal=${goal}ml`,
    // Shared `health_goals` row — see `enqueueHealthChange`'s merge-at-handle.
    { queue: { collection: 'health_goals', row: { effective_date: date, daily_water_ml: goal } } }
  );
  await mirrorCupCounter(saved);
  return saved;
}

/* ------------------------------------------------------------------ */
/* Derived figures for the hero                                        */
/* ------------------------------------------------------------------ */

/** Progress in [0, 1]; the ring clamps, the caption does not. */
export function waterProgress(day: WaterDayDetail): number {
  if (!day.goalMl) return 0;
  return Math.max(0, Math.min(1, day.totalMl / day.goalMl));
}

/** Millilitres still to drink; 0 once the goal is met. */
export function waterRemainingMl(day: WaterDayDetail): number {
  return Math.max(0, day.goalMl - day.totalMl);
}

/** Filled / total 250 ml glasses — the donor's glasses row. */
export function waterGlasses(day: WaterDayDetail): { filled: number; total: number } {
  const total = Math.max(1, Math.min(20, Math.round(day.goalMl / GLASS_ML)));
  const filled = Math.max(0, Math.min(total, Math.floor(day.totalMl / GLASS_ML)));
  return { filled, total };
}

/** "2:15 PM" for a log row, from the entry's own stamp. */
export function formatEntryTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
