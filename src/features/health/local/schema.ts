/**
 * Health V2 ledger registry — Stage He1.
 *
 * The single source of truth for *which* Health tables are device-authoritative,
 * how each row is keyed, and how rows bucket for windowed reads. Everything else
 * about the merge (LWW, tombstones, parking, conflict surfacing) is the shared
 * core in `@symply/local-first/projection` — Health supplies only this
 * descriptor, exactly as House and Budget do.
 *
 * See `documents/requirements/Health v2/health-local-first-implementation-plan.md`
 * §1.4 (tiering), §1.5 (the locked 8) and §1.5a (the unclassified register).
 *
 * Rules this file encodes, each of which `__tests__/registryGuard.test.ts`
 * proves rather than trusts:
 *
 *  - **Exactly 8 Wave A tables.** Notes stay in MMKV (`health.notes.v1`); they
 *    are already device-local and are NOT a ninth ledger key (plan §1.5).
 *  - **S3a — no natural keys.** Every value in `HEALTH_LEDGER_TABLE_KEYS` is
 *    `'id'`. A table keyed on a natural key diverges permanently the first time
 *    a row is deleted and recreated under the same key.
 *  - **S3b — deterministic ids ONLY where D1 carries a `unique()` constraint.**
 *    Health has exactly two: `habit_logs` (`unique(habit_id, date)`,
 *    `schema-health.ts:325`) and `health_goals`
 *    (`unique(user_id, effective_date)`, `:609`). This is a two-way rule — see
 *    the warning on `HEALTH_RANDOM_ID_TABLES` below.
 *  - **Tier disjointness.** A table that is server-authoritative (Tier B),
 *    reference (Tier C) or derived (Tier D) must never appear in Tier A.
 */

/** Ledger tables that participate in sync, mapped to their row-key field. */
export const HEALTH_LEDGER_TABLE_KEYS = {
  weightEntries: 'id',
  waterEntries: 'id',
  nutritionEntries: 'id',
  healthEntries: 'id',
  bodyMeasurements: 'id',
  userHabits: 'id',
  habitLogs: 'id',
  healthGoals: 'id',
} as const;

export type HealthLedgerTableName = keyof typeof HEALTH_LEDGER_TABLE_KEYS;

export const HEALTH_LEDGER_TABLE_NAMES = Object.keys(
  HEALTH_LEDGER_TABLE_KEYS,
) as HealthLedgerTableName[];

/**
 * Wave A is the "core logs" set — 8 tables (plan §1.5). `registryGuard` fails if
 * this and `HEALTH_LEDGER_TABLE_NAMES.length` disagree.
 *
 * NOT frozen forever: He11b extends the registry with the Wave C set and MUST
 * re-run the builder rule against it first — four Wave C tables carry `unique()`
 * (`period_entries`, `cycle_symptom_entries`, `mens_health_entries`, plus the
 * per-user singletons `cycle_settings` / `mens_health_settings`). Relaxing this
 * count without adding those builders is how `period_entries` silently loses its
 * merge key (plan §1.5).
 */
export const HEALTH_WAVE_A_TABLE_COUNT = 8;

/** Ledger name → physical D1 table. Health has no S1 collisions. */
export const HEALTH_LEDGER_PHYSICAL_TABLES: Record<HealthLedgerTableName, string> = {
  weightEntries: 'weight_entries',
  waterEntries: 'water_entries',
  nutritionEntries: 'nutrition_entries',
  healthEntries: 'health_entries',
  bodyMeasurements: 'body_measurements',
  userHabits: 'user_habits',
  habitLogs: 'habit_logs',
  healthGoals: 'health_goals',
};

/**
 * Windowed-read date fields, first match wins. Anything unparseable — and every
 * tombstone — degrades to the always-resident bucket, never to "invisible".
 *
 * Column names verified against `backend/src/db/schema-health.ts`: the five
 * dated log tables all carry a real `date` string.
 *
 * Two deliberate omissions, both always-resident:
 *  - `userHabits` — the habit definitions themselves. Small, and every Habits
 *    render needs all of them.
 *  - `healthGoals` — carries `effective_date`, but the *active* goal must load
 *    without a month probe. Decided in §1.5; do not relitigate.
 */
export const HEALTH_WINDOWED_DATE_FIELDS: Partial<
  Record<HealthLedgerTableName, readonly string[]>
> = {
  weightEntries: ['date', 'created_at'],
  waterEntries: ['date', 'created_at'],
  nutritionEntries: ['date'],
  healthEntries: ['date', 'created_at'],
  bodyMeasurements: ['date', 'created_at'],
  habitLogs: ['date', 'created_at'],
};

/**
 * How much history a cold open decrypts — the He10 §4 cold-open mitigation.
 *
 * ## Why a window at all
 *
 * 86% of first paint on the 10-year corpus is per-row AES-256-GCM in pure JS:
 * 66,067 opens at ~25 µs each. It is the COUNT of decrypts, not the bytes, so
 * the only lever that moves the number is decrypting fewer rows. Column pruning
 * was measured and rejected (deleting the entire watermark map still missed p50
 * by 5–25%); the LWW codec bought −10.8% and is already on (`projection.ts`).
 *
 * ## Why 420 days and not "about a year"
 *
 * This number is DERIVED, not chosen. The widest dated read in `windows.ts` is
 * 400 days (`loadWaterHistory`, and `loadHabits`' per-habit `habitLogs` cap), so
 * a window narrower than 400 days would make Home's own loaders miss on every
 * cold start — trading one bulk decrypt for a slower, chattier one. 420 gives
 * the 400-day readers a full three weeks of slack, which matters because
 * residency is bucketed by whole months and a window is only ever widened to a
 * month boundary. `residentWindow.test.ts` asserts this against the registry
 * rather than against a copy of the number, so a loader that widens its window
 * past 420 days fails the build instead of quietly falling off the end.
 *
 * ## What this is NOT
 *
 * It is not a retention policy and not a cap on what the user can see. Rows
 * outside it stay on disk, sealed and complete, and are hydrated on demand by
 * `ensureHealthRowsResident` — a read that reaches past the window widens it
 * rather than truncating its answer. A window that made older data unreadable
 * would be the §1.3 failure mode with a stopwatch attached, not a mitigation.
 */
export const HEALTH_RESIDENT_WINDOW_DAYS = 420;

/**
 * S3b — Tier-A tables whose D1 row carries a business `unique()`. Each maps to
 * the natural-key columns the deterministic id is derived from, so the guard can
 * prove every one of them has a registered builder in `ids.ts`.
 *
 * Source of truth: the `unique()` calls in `backend/src/db/schema-health.ts` and
 * the NATURAL-KEY MERGE contract in
 * `backend/src/services/health-sync-service.ts:66-72`.
 */
export const HEALTH_DETERMINISTIC_ID_TABLES: Partial<
  Record<HealthLedgerTableName, readonly string[]>
> = {
  /** `unique(habit_id, date)` — schema-health.ts:325. One log per habit per day. */
  habitLogs: ['habit_id', 'date'],
  /** `unique(user_id, effective_date)` — schema-health.ts:609. One goal row per day-slot. */
  healthGoals: ['user_id', 'effective_date'],
};

/**
 * The other half of the S3b rule, and the one that is easy to get wrong in the
 * *opposite* direction.
 *
 * These five tables carry NO `unique()` in D1 and MUST keep random ids. The
 * flagship case is `weight_entries`: a user who weighs in morning and evening
 * gets two rows, and a `weight_${date}` builder would LWW one of them away —
 * silent loss of a real reading. It is also deliberately absent from the
 * server's natural-key merge list, which is the same statement from the other
 * side of the wire.
 *
 * `registryGuard` asserts this set and `HEALTH_DETERMINISTIC_ID_TABLES` are
 * disjoint and together cover the whole registry.
 */
export const HEALTH_RANDOM_ID_TABLES: readonly HealthLedgerTableName[] = [
  'weightEntries',
  'waterEntries',
  'nutritionEntries',
  'healthEntries',
  'bodyMeasurements',
  'userHabits',
];

/**
 * Tier B — server-authoritative, never ledgered (plan §1.4). Physical names, so
 * the guard can assert disjointness with Tier A.
 *
 * `/health/ai/*` stays server-side until BYOK; FatSecret lookup stays a Worker
 * chokepoint (the accepted meal-string threat, §1.4).
 */
export const HEALTH_TIER_B_TABLES: readonly string[] = [
  'health_coach_operations',
  'health_coach_consent_receipts',
  'health_ai_usage',
  'food_category_mappings',
];

/** Tier C — reference catalogs: migration-authored, no `user_id`, never synced. */
export const HEALTH_TIER_C_TABLES: readonly string[] = ['exercise_library'];

/**
 * Tier D — derived on device (He7-lite) or invalidated by the Wave A delete.
 *
 * `health_weekly_weight_averages` is recomputed from `weightEntries`; it is also
 * deleted at He12(full) because leaving it behind is plaintext residue of
 * ledgered data (plan §14 step 11 / Appendix C.1).
 *
 * `food_challenge_progress` is computed from `nutrition_entries` and therefore
 * goes permanently stale at He12(full) — the He3a disposition in §1.5a decides
 * whether it is ported on-device or darkened.
 */
export const HEALTH_TIER_D_TABLES: readonly string[] = [
  'health_weekly_weight_averages',
  'food_challenges',
  'food_challenge_progress',
  'food_challenge_achievements',
  'food_usage_history',
];

/**
 * Tier Off — disabled surfaces (plan §1.4). Multi-user by design; the personal
 * ledger has no home for them and He5 refuses a second `user_id` outright.
 */
export const HEALTH_TIER_OFF_TABLES: readonly string[] = [
  'health_families',
  'health_family_members',
  'health_buddies',
  'health_group_challenges',
];
