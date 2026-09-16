import { bytesToHex, deterministicRowId, randomBytes } from '@symply/local-first';

import type { HealthLedgerTableName } from './schema';

/**
 * Random row id — the default, and correct for six of the eight Wave A tables.
 *
 * Two weigh-ins in one day are two readings, three meals are three meals. Only
 * the two tables carrying a D1 `unique()` get a deterministic id (plan §1.5).
 */
export function newLocalId(prefix: string): string {
  return `${prefix}_${bytesToHex(randomBytes(8))}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

/** `YYYY-MM-DD` in local time — the form every Health `date` column stores. */
export function localDateKey(when: Date = new Date()): string {
  const y = when.getFullYear();
  const m = `${when.getMonth() + 1}`.padStart(2, '0');
  const d = `${when.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * S3b deterministic-id builders (plan §1.5).
 *
 * One entry per Tier-A table that carries a business `unique()` in D1. Both
 * devices compute the same id from the same natural key, so an offline
 * double-create merges under LWW instead of surviving as two rows.
 *
 * There are exactly TWO. Adding a third without a matching entry in
 * `HEALTH_DETERMINISTIC_ID_TABLES` — or adding one for a table in
 * `HEALTH_RANDOM_ID_TABLES` — fails `registryGuard.test.ts` in both directions.
 */
export const healthDeterministicIds = {
  /**
   * `unique(habit_id, date)` — schema-health.ts:325.
   *
   * Two devices ticking the same habit for the same day offline must converge on
   * one row, not two ticks.
   */
  habitLog: (habitId: string, date: string): string => deterministicRowId('hl', [habitId, date]),

  /**
   * `unique(user_id, effective_date)` — schema-health.ts:609.
   *
   * The goal row is a day-slot: setting a calorie target twice on the same day
   * is an edit, not a second goal. `user_id` is part of the D1 key but constant
   * within a personal ledger (§1.2, one user), so it is not part of the local id
   * — including it would make ids differ across a re-login for the same person.
   */
  healthGoal: (effectiveDate: string): string => deterministicRowId('hg', [effectiveDate]),
} as const;

/**
 * Registry lookup used by the guard: ledger table → builder. Declarative so an
 * S3b table cannot be registered without a builder, and a random-id table cannot
 * quietly acquire one.
 */
export const HEALTH_DETERMINISTIC_ID_BUILDERS: Partial<
  Record<HealthLedgerTableName, (...parts: never[]) => string>
> = {
  habitLogs: healthDeterministicIds.habitLog as (...parts: never[]) => string,
  healthGoals: healthDeterministicIds.healthGoal as (...parts: never[]) => string,
};
