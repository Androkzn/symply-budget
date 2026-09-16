import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireHealthApi } from '../middleware/brand-gate';
import {
  cancelHabitReminders,
  syncHabitReminders,
} from '../services/health/habit-reminder';
import { HealthChallengeService } from '../services/health-challenge-service';
import {
  HABIT_FREQUENCIES,
  HABIT_TIMES_OF_DAY,
  HealthService,
  WORKOUT_INTENSITIES,
} from '../services/health-service';
import { HealthSyncService, MAX_PUSH_ROWS } from '../services/health-sync-service';
import type { Env } from '../types';

/**
 * Symply Health tracking routes — the ported donor health domain (parity P1).
 *
 * Mounted at `/health` on the `symply-health-api` Worker; `requireHealthApi()`
 * 404s the whole surface on House/Budget/Kaizen so a shared deploy can never
 * expose health data on the wrong brand.
 *
 * THIN CLIENT: every derived figure comes from `HealthService`. Handlers only
 * validate input and pass it through — response envelopes MUST match
 * `src/api/health.ts` on the app EXACTLY.
 *
 * Scoping: health data is PERSONAL, so every row is keyed by the authenticated
 * `userId`, never by household. There is no cross-user read path here by design
 * (BRD §7 — no sharing until a privacy review approves an explicit scope).
 */

const health = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

health.use('/*', requireHealthApi());
health.use('/*', authMiddleware());

function uid(c: { get: (k: 'userId') => string }): string {
  return c.get('userId');
}

function svc(c: { env: Env }): HealthService {
  return new HealthService(c.env.DB);
}

function challengeSvc(c: { env: Env }): HealthChallengeService {
  return new HealthChallengeService(c.env.DB);
}

/** YYYY-MM-DD — the client always sends its own LOCAL day, never a UTC stamp. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

/* ================================ WEIGHT ================================ */

const weightUnit = z.enum(['kg', 'lb', 'lbs']);

health.get('/weight/entries', async (c) => {
  const { from, to, limit } = c.req.query();
  const parsedLimit = limit ? Number(limit) : undefined;
  // Bound into `LIMIT ?`, and D1 rejects a non-integer REAL there with
  // SQLITE_MISMATCH — so `?limit=1.5` used to 500 on an ordinary list.
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }
  const entries = await svc(c).listWeight(uid(c), {
    from,
    to,
    limit: parsedLimit,
  });
  return c.json({ entries });
});

health.post(
  '/weight/entries',
  zValidator(
    'json',
    z.object({
      date: dateSchema,
      weight: z.number().positive().max(1000),
      unit: weightUnit,
      note: z.string().max(500).optional(),
      // 0122. Absent ⇒ 'manual'; the HealthKit importer sets 'healthkit' so the
      // de-duplicator can apply "manual always wins".
      source: z.enum(['manual', 'healthkit']).optional(),
    })
  ),
  async (c) => {
    const entry = await svc(c).createWeight(uid(c), c.req.valid('json'));
    return c.json({ entry }, 201);
  }
);

health.put(
  '/weight/entries/:id',
  zValidator(
    'json',
    z.object({
      date: dateSchema.optional(),
      weight: z.number().positive().max(1000).optional(),
      unit: weightUnit.optional(),
      note: z.string().max(500).nullable().optional(),
      // A CORRECTION changes who owns the reading. Without this the origin was
      // frozen at create time, so a member who fixed a figure Apple Health had
      // imported left the row flagged `healthkit` — and the import planner only
      // protects rows whose origin is NOT healthkit, so the next sync saw "an
      // imported row whose figure changed" and overwrote the correction. That
      // breaks the rule the importer is built around: a day the member typed is
      // never overwritten.
      source: z.enum(['manual', 'healthkit']).optional(),
    })
  ),
  async (c) => {
    const entry = await svc(c).updateWeight(uid(c), c.req.param('id'), c.req.valid('json'));
    if (!entry) return c.json({ error: { code: 'not_found', message: 'Entry not found' } }, 404);
    return c.json({ entry });
  }
);

health.delete('/weight/entries/:id', async (c) => {
  const ok = await svc(c).deleteWeight(uid(c), c.req.param('id'));
  if (!ok) return c.json({ error: { code: 'not_found', message: 'Entry not found' } }, 404);
  return c.json({ deleted: true });
});

health.get('/weight/statistics', async (c) => {
  const statistics = await svc(c).weightStatistics(uid(c), c.req.query('from'));
  return c.json({ statistics });
});

health.get('/weight/weekly-averages', async (c) => {
  const limit = c.req.query('limit');
  const parsedLimit = limit ? Number(limit) : undefined;
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }
  const weeks = await svc(c).weeklyAverages(uid(c), parsedLimit);
  return c.json({ weeks });
});

/* ================================ WATER ================================= */

health.get('/water/entries', async (c) => {
  const { from, to } = c.req.query();
  const entries = await svc(c).listWater(uid(c), { from, to });
  return c.json({ entries });
});

health.post(
  '/water/entries',
  zValidator(
    'json',
    z.object({
      date: dateSchema,
      amount_ml: z.number().positive().max(10000),
      beverage_type: z.string().max(40).optional(),
      container: z.string().max(40).optional(),
    })
  ),
  async (c) => {
    const entry = await svc(c).createWater(uid(c), c.req.valid('json'));
    return c.json({ entry }, 201);
  }
);

health.delete('/water/entries/:id', async (c) => {
  const ok = await svc(c).deleteWater(uid(c), c.req.param('id'));
  if (!ok) return c.json({ error: { code: 'not_found', message: 'Entry not found' } }, 404);
  return c.json({ deleted: true });
});

/**
 * Undo the last sip of a day — the app's water control is ±1 cup and never
 * holds the id of the entry it is removing.
 */
health.post(
  '/water/undo',
  zValidator('json', z.object({ date: dateSchema })),
  async (c) => {
    const ok = await svc(c).removeLastWater(uid(c), c.req.valid('json').date);
    return c.json({ removed: ok });
  }
);

health.get('/water/summary/daily', async (c) => {
  const date = c.req.query('date');
  if (!date) return c.json({ error: { code: 'bad_request', message: 'date is required' } }, 400);
  return c.json({ summary: await svc(c).waterDailySummary(uid(c), date) });
});

/* ============================== NUTRITION =============================== */

const mealType = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);

/**
 * The per-100 basis a portion change is re-derived from (0124, donor 018).
 *
 * Optional on every write: a hand-typed row has no measured basis, and the
 * service derives one from (macros, portion) instead of the caller guessing.
 */
const nutritionBasisFields = {
  food_id: z.string().min(1).max(80).optional(),
  base_calories_per_100: z.number().min(0).max(10000).optional(),
  base_proteins_per_100: z.number().min(0).max(2000).optional(),
  base_carbs_per_100: z.number().min(0).max(2000).optional(),
  base_fats_per_100: z.number().min(0).max(2000).optional(),
};

const nutritionEntryFields = {
  food_name: z.string().min(1).max(120),
  meal_type: mealType,
  calories: z.number().min(0).max(10000),
  proteins: z.number().min(0).max(2000).optional(),
  carbohydrates: z.number().min(0).max(2000).optional(),
  fats: z.number().min(0).max(2000).optional(),
  portion: z.number().positive().max(1000).optional(),
  unit: z.string().max(40).optional(),
  // 0143. Absent ⇒ 'manual'; the HealthKit importer sets 'healthkit' so the
  // de-duplicator (`planNutritionImport`) can recognise its own day-total row.
  source: z.enum(['manual', 'healthkit']).optional(),
  ...nutritionBasisFields,
};

health.get('/nutrition/entries', async (c) => {
  const { date, from, to } = c.req.query();
  const entries = await svc(c).listNutrition(uid(c), { date, from, to });
  return c.json({ entries });
});

health.post(
  '/nutrition/entries',
  zValidator('json', z.object({ date: dateSchema, ...nutritionEntryFields })),
  async (c) => {
    const entry = await svc(c).createNutrition(uid(c), c.req.valid('json'));
    // null ⇒ `food_id` named a food this user does not own. 404, not 403: a
    // "forbidden" would confirm the id exists on somebody else's account.
    if (!entry) return c.json({ error: { code: 'not_found', message: 'Food not found' } }, 404);
    return c.json({ entry }, 201);
  }
);

health.put(
  '/nutrition/entries/:id',
  zValidator(
    'json',
    z.object({
      food_name: z.string().min(1).max(120).optional(),
      meal_type: mealType.optional(),
      calories: z.number().min(0).max(10000).optional(),
      proteins: z.number().min(0).max(2000).optional(),
      carbohydrates: z.number().min(0).max(2000).optional(),
      fats: z.number().min(0).max(2000).optional(),
      portion: z.number().positive().max(1000).optional(),
      unit: z.string().max(40).optional(),
      // Donor `PUT /entries/:id` accepted the basis too, with a COALESCE so an
      // omitted key keeps the stored one. Same semantics here: zod leaves the
      // key out of the patch, so the service's spread never overwrites it.
      base_calories_per_100: z.number().min(0).max(10000).optional(),
      base_proteins_per_100: z.number().min(0).max(2000).optional(),
      base_carbs_per_100: z.number().min(0).max(2000).optional(),
      base_fats_per_100: z.number().min(0).max(2000).optional(),
    })
  ),
  async (c) => {
    const entry = await svc(c).updateNutrition(uid(c), c.req.param('id'), c.req.valid('json'));
    if (!entry) return c.json({ error: { code: 'not_found', message: 'Entry not found' } }, 404);
    return c.json({ entry });
  }
);

/**
 * Re-derive a logged entry's macros for a NEW portion (0124).
 *
 * This is the write `base_*_per_100` exists for: the row keeps its identity, its
 * day and its slot, and only the four macro columns move — derived from the
 * stored basis, never by scaling the figures already on the row.
 *
 * 400 `no_basis` (not a silent no-op) when the entry has no stored basis, so the
 * client can say "this one was typed in, edit the numbers instead".
 */
health.post(
  '/nutrition/entries/:id/portion',
  zValidator(
    'json',
    z.object({
      portion: z.number().positive().max(1000),
      unit: z.string().max(40).optional(),
    })
  ),
  async (c) => {
    const { portion, unit } = c.req.valid('json');
    const result = await svc(c).reportionNutrition(uid(c), c.req.param('id'), portion, unit);
    if (result.ok) return c.json({ entry: result.entry });
    if (result.reason === 'no_basis') {
      return c.json(
        {
          error: {
            code: 'no_basis',
            message: 'This entry has no per-100 basis, so its portion cannot be rescaled.',
          },
        },
        400
      );
    }
    return c.json({ error: { code: 'not_found', message: 'Entry not found' } }, 404);
  }
);

/** Bulk create — backs the donor's copy-food / copy-meal / copy-day sheets. */
health.post(
  '/nutrition/entries/bulk',
  zValidator(
    'json',
    z.object({
      entries: z
        .array(z.object({ date: dateSchema, ...nutritionEntryFields }))
        // Capped so one request cannot be used to bulk-write the table.
        .min(1)
        .max(100),
    })
  ),
  async (c) => {
    const entries = await svc(c).createNutritionBulk(uid(c), c.req.valid('json').entries);
    return c.json({ entries }, 201);
  }
);

/** Copy a day (optionally one slot) onto another date. */
health.post(
  '/nutrition/copy-day',
  zValidator(
    'json',
    z.object({
      from_date: dateSchema,
      to_date: dateSchema,
      from_slot: mealType.optional(),
      to_slot: mealType.optional(),
    })
  ),
  async (c) => {
    const body = c.req.valid('json');
    const entries = await svc(c).copyNutritionDay(uid(c), body.from_date, body.to_date, {
      fromSlot: body.from_slot,
      toSlot: body.to_slot,
    });
    return c.json({ entries }, 201);
  }
);

health.delete('/nutrition/entries/:id', async (c) => {
  const ok = await svc(c).deleteNutrition(uid(c), c.req.param('id'));
  if (!ok) return c.json({ error: { code: 'not_found', message: 'Entry not found' } }, 404);
  return c.json({ deleted: true });
});

health.get('/nutrition/summary', async (c) => {
  const date = c.req.query('date');
  if (!date) return c.json({ error: { code: 'bad_request', message: 'date is required' } }, 400);
  return c.json({ summary: await svc(c).nutritionSummary(uid(c), date) });
});

/* ============================ MEASUREMENTS ============================== */

/**
 * Every measurable site on `body_measurements`.
 *
 * This object is the ONLY gate: the schemas below are `z.object`s, which strip
 * unknown keys and answer 200, so a site the client sends that is missing from
 * here is silently discarded rather than rejected. The client's `METRIC_COLUMN`
 * map (`src/features/health/healthBodyStorage.ts`) and this list widen together
 * or not at all.
 *
 * The 0131 block is the donor's comprehensive site list; the block above it is
 * the donor's legacy one, and each legacy column already IS the comprehensive
 * point of the same name (`waist` = `waistNarrowest`, `chest` = `chestFull`,
 * `left_arm` = `leftArmUpper`, …), which is why those four are not restated.
 * See `backend/migrations/0131_health_body_comprehensive.sql` for the full donor
 * mapping and for the fields deliberately not ported.
 */
const site = () => z.number().positive().max(400).nullable().optional();

const measurementFields = {
  chest: site(),
  waist: site(),
  hips: site(),
  left_arm: site(),
  right_arm: site(),
  left_thigh: site(),
  right_thigh: site(),
  neck: site(),
  shoulders: site(),
  left_calf: site(),
  right_calf: site(),
  left_forearm: site(),
  right_forearm: site(),
  body_fat_percentage: z.number().min(0).max(100).nullable().optional(),
  // ---- 0131: the donor's comprehensive sites ----
  left_arm_mid: site(),
  right_arm_mid: site(),
  left_forearm_mid: site(),
  right_forearm_mid: site(),
  left_wrist: site(),
  right_wrist: site(),
  left_thigh_mid: site(),
  right_thigh_mid: site(),
  left_thigh_lower: site(),
  right_thigh_lower: site(),
  left_knee: site(),
  right_knee: site(),
  left_calf_mid: site(),
  right_calf_mid: site(),
  left_calf_lower: site(),
  right_calf_lower: site(),
  left_ankle: site(),
  right_ankle: site(),
  waist_navel: site(),
  waist_upper: site(),
  waist_lower: site(),
  iliac: site(),
  chest_upper: site(),
  chest_under: site(),
  back_width: site(),
  torso_length: site(),
  inseam: site(),
};

health.get('/measurements', async (c) => {
  const measurements = await svc(c).listMeasurements(uid(c));
  return c.json({ measurements });
});

health.get('/measurements/latest', async (c) => {
  return c.json({ measurement: await svc(c).latestMeasurement(uid(c)) });
});

health.post(
  '/measurements',
  zValidator(
    'json',
    z.object({
      date: dateSchema,
      unit: z.enum(['cm', 'in', 'inches']),
      ...measurementFields,
    })
  ),
  async (c) => {
    const measurement = await svc(c).createMeasurement(uid(c), c.req.valid('json'));
    return c.json({ measurement }, 201);
  }
);

/**
 * Correct or CLEAR individual sites on an existing row (0131).
 *
 * One row holds a whole session — the donor's entry sheet writes up to forty
 * sites at once — so "remove this reading" could not be expressed before: the
 * only verb was DELETE, which tombstones every site measured that day along
 * with the one the member wanted gone. An explicit `null` clears one site;
 * omitted keys keep their stored value, so a correction never has to resend the
 * rest of the session.
 *
 * `unit` is accepted because a session re-typed in the other unit is a real
 * correction, but it is NOT defaulted: omitting it keeps the row's own unit
 * rather than silently restating 82 in the other scale.
 */
health.patch(
  '/measurements/:id',
  zValidator(
    'json',
    z.object({
      date: dateSchema.optional(),
      unit: z.enum(['cm', 'in', 'inches']).optional(),
      ...measurementFields,
    })
  ),
  async (c) => {
    const measurement = await svc(c).updateMeasurement(
      uid(c),
      c.req.param('id'),
      c.req.valid('json')
    );
    if (!measurement) {
      return c.json({ error: { code: 'not_found', message: 'Measurement not found' } }, 404);
    }
    return c.json({ measurement });
  }
);

health.delete('/measurements/:id', async (c) => {
  const ok = await svc(c).deleteMeasurement(uid(c), c.req.param('id'));
  if (!ok) return c.json({ error: { code: 'not_found', message: 'Measurement not found' } }, 404);
  return c.json({ deleted: true });
});

/* ========================== GENERIC ENTRIES ============================= */

const entryType = z.enum(['steps', 'workout', 'sleep', 'heart_rate', 'active_energy']);

/**
 * How hard the session felt (0124). Nullable on every UPDATE so the picker can
 * be moved BACK to its default — omitting the key would keep the old value and
 * there would be no way to un-record an intensity.
 */
const workoutIntensity = z.enum(WORKOUT_INTENSITIES);

health.get('/entries', async (c) => {
  const { type, from, to, limit } = c.req.query();
  const parsed = type ? entryType.safeParse(type) : null;
  if (parsed && !parsed.success) {
    return c.json({ error: { code: 'bad_request', message: 'invalid entry type' } }, 400);
  }
  const parsedLimit = limit ? Number(limit) : undefined;
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }
  const entries = await svc(c).listHealthEntries(uid(c), {
    type: parsed?.data,
    from,
    to,
    limit: parsedLimit,
  });
  return c.json({ entries });
});

health.post(
  '/entries',
  zValidator(
    'json',
    z.object({
      date: dateSchema,
      entry_type: entryType,
      data: z.record(z.unknown()),
      source: z.enum(['healthkit', 'manual']).optional(),
      intensity: workoutIntensity.nullable().optional(),
    })
  ),
  async (c) => {
    const entry = await svc(c).createHealthEntry(uid(c), c.req.valid('json'));
    return c.json({ entry }, 201);
  }
);

/**
 * Update an entry in place — the donor's `PUT /entries/:id`, restored (0124).
 *
 * Without it the app had to edit by re-recording (write the replacement, then
 * tombstone the original), which kept the data safe but moved the logged time
 * and minted a new id. `data` is REPLACED, matching the donor; the merging
 * variant for workouts is `PUT /entries/workouts/:id` below.
 */
health.put(
  '/entries/:id',
  zValidator(
    'json',
    z.object({
      date: dateSchema.optional(),
      data: z.record(z.unknown()).optional(),
      source: z.enum(['healthkit', 'manual']).optional(),
      intensity: workoutIntensity.nullable().optional(),
    })
  ),
  async (c) => {
    const entry = await svc(c).updateHealthEntry(uid(c), c.req.param('id'), c.req.valid('json'));
    if (!entry) return c.json({ error: { code: 'not_found', message: 'Entry not found' } }, 404);
    return c.json({ entry });
  }
);

/** Steps are one value per day — upsert, so a re-entry never stacks. */
health.post(
  '/entries/steps',
  zValidator('json', z.object({ date: dateSchema, steps: z.number().int().min(0).max(200000) })),
  async (c) => {
    const { date, steps } = c.req.valid('json');
    const entry = await svc(c).setSteps(uid(c), date, steps);
    return c.json({ entry });
  }
);

/**
 * How far the session went, in METRES — the donor's own unit
 * (`WorkoutEntry.distance`). 500 km is comfortably above an ultra and far below
 * anything a slipped decimal point produces.
 *
 * It rides the `data` blob alongside `minutes` and `calories` rather than
 * becoming a column: those two are its peers, `health_entries.data` is
 * schemaless by design (the donor kept it that way), and every consumer —
 * `widgetSnapshot` included — already reads the payload in JS rather than SQL.
 * `intensity` earned a column in 0124 because it is NOT part of the donor's
 * payload and is filtered on; this is.
 *
 * The one thing that DID have to change is this schema. Anything zod does not
 * name is stripped, which is exactly how intensity ended up smuggled into the
 * note before 0124 — so the field is declared here rather than passed through.
 */
const workoutDistanceM = z.number().min(0).max(500_000);

/** When the session HAPPENED, as opposed to `created_at`, which is when the row was written. */
const workoutStartedAt = z.string().datetime({ offset: true });

/** Workout sessions ride the generic entry table with a typed payload. */
health.post(
  '/entries/workouts',
  zValidator(
    'json',
    z.object({
      date: dateSchema,
      workout_type: z.string().min(1).max(40),
      minutes: z.number().int().positive().max(1440),
      calories: z.number().int().min(0).max(5000).optional(),
      note: z.string().max(200).optional(),
      // 0124. Before this column, intensity was smuggled into `note` as a
      // leading `[hard]` tag because zod stripped everything it did not name.
      intensity: workoutIntensity.optional(),
      distance_m: workoutDistanceM.optional(),
      started_at: workoutStartedAt.optional(),
    })
  ),
  async (c) => {
    const body = c.req.valid('json');
    const entry = await svc(c).createHealthEntry(uid(c), {
      date: body.date,
      entry_type: 'workout',
      data: {
        workout_type: body.workout_type,
        minutes: body.minutes,
        calories: body.calories ?? 0,
        note: body.note ?? '',
        // Spread rather than defaulted: an unmeasured distance must stay ABSENT
        // from the payload. Writing `0` would make "I did not measure it"
        // indistinguishable from "I covered no ground", and every weekly total
        // and chart built on it would then average a measurement nobody took.
        ...(body.distance_m !== undefined && body.distance_m > 0
          ? { distance_m: body.distance_m }
          : {}),
        ...(body.started_at !== undefined ? { started_at: body.started_at } : {}),
      },
      intensity: body.intensity ?? null,
    });
    return c.json({ entry }, 201);
  }
);

/**
 * Edit a logged session (0124). MERGES the typed payload, so changing only the
 * duration does not require resending the note.
 *
 * 404s an entry that is not a workout as well as one that is not the caller's:
 * this path promises the `{ workout_type, minutes, calories, note }` shape and
 * must not rewrite a `sleep` blob into it.
 */
health.put(
  '/entries/workouts/:id',
  zValidator(
    'json',
    z.object({
      date: dateSchema.optional(),
      workout_type: z.string().min(1).max(40).optional(),
      minutes: z.number().int().positive().max(1440).optional(),
      calories: z.number().int().min(0).max(5000).optional(),
      note: z.string().max(200).optional(),
      intensity: workoutIntensity.nullable().optional(),
      // NULLABLE on the update, unlike the create: clearing the distance field
      // has to REMOVE the key from the stored payload, and a merge has no other
      // way to say "delete this". Omitting it keeps whatever is stored.
      distance_m: workoutDistanceM.nullable().optional(),
      started_at: workoutStartedAt.nullable().optional(),
    })
  ),
  async (c) => {
    const entry = await svc(c).updateWorkoutEntry(uid(c), c.req.param('id'), c.req.valid('json'));
    if (!entry) return c.json({ error: { code: 'not_found', message: 'Entry not found' } }, 404);
    return c.json({ entry });
  }
);

health.delete('/entries/:id', async (c) => {
  const ok = await svc(c).deleteHealthEntry(uid(c), c.req.param('id'));
  if (!ok) return c.json({ error: { code: 'not_found', message: 'Entry not found' } }, 404);
  return c.json({ deleted: true });
});

/* ================================ GOALS ================================= */

health.get('/goals', async (c) => {
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  return c.json({ goal: await svc(c).goalFor(uid(c), date) });
});

health.put(
  '/goals',
  zValidator(
    'json',
    z.object({
      effective_date: dateSchema.optional(),
      daily_calories: z.number().int().min(500).max(10000).optional(),
      // Donor parity: `goal_history` supports a DIFFERENT calorie target per
      // weekday. Without these keys zod strips them and the per-day targets are
      // silently dropped with a 200 — the service already reads them.
      use_per_day_calories: z.boolean().optional(),
      monday_calories: z.number().int().min(500).max(10000).nullable().optional(),
      tuesday_calories: z.number().int().min(500).max(10000).nullable().optional(),
      wednesday_calories: z.number().int().min(500).max(10000).nullable().optional(),
      thursday_calories: z.number().int().min(500).max(10000).nullable().optional(),
      friday_calories: z.number().int().min(500).max(10000).nullable().optional(),
      saturday_calories: z.number().int().min(500).max(10000).nullable().optional(),
      sunday_calories: z.number().int().min(500).max(10000).nullable().optional(),
      daily_protein_grams: z.number().min(0).max(2000).nullable().optional(),
      daily_carbs_grams: z.number().min(0).max(2000).nullable().optional(),
      daily_fats_grams: z.number().min(0).max(2000).nullable().optional(),
      // 0139 — per-weekday macro overrides, the same "without these keys zod
      // strips them and the service's per-day resolver never sees them" gap
      // the per-day calorie comment above already covers.
      use_per_day_macros: z.boolean().optional(),
      monday_protein_grams: z.number().min(0).max(2000).nullable().optional(),
      monday_carbs_grams: z.number().min(0).max(2000).nullable().optional(),
      monday_fats_grams: z.number().min(0).max(2000).nullable().optional(),
      tuesday_protein_grams: z.number().min(0).max(2000).nullable().optional(),
      tuesday_carbs_grams: z.number().min(0).max(2000).nullable().optional(),
      tuesday_fats_grams: z.number().min(0).max(2000).nullable().optional(),
      wednesday_protein_grams: z.number().min(0).max(2000).nullable().optional(),
      wednesday_carbs_grams: z.number().min(0).max(2000).nullable().optional(),
      wednesday_fats_grams: z.number().min(0).max(2000).nullable().optional(),
      thursday_protein_grams: z.number().min(0).max(2000).nullable().optional(),
      thursday_carbs_grams: z.number().min(0).max(2000).nullable().optional(),
      thursday_fats_grams: z.number().min(0).max(2000).nullable().optional(),
      friday_protein_grams: z.number().min(0).max(2000).nullable().optional(),
      friday_carbs_grams: z.number().min(0).max(2000).nullable().optional(),
      friday_fats_grams: z.number().min(0).max(2000).nullable().optional(),
      saturday_protein_grams: z.number().min(0).max(2000).nullable().optional(),
      saturday_carbs_grams: z.number().min(0).max(2000).nullable().optional(),
      saturday_fats_grams: z.number().min(0).max(2000).nullable().optional(),
      sunday_protein_grams: z.number().min(0).max(2000).nullable().optional(),
      sunday_carbs_grams: z.number().min(0).max(2000).nullable().optional(),
      sunday_fats_grams: z.number().min(0).max(2000).nullable().optional(),
      daily_water_ml: z.number().int().min(0).max(20000).nullable().optional(),
      daily_steps: z.number().int().min(0).max(200000).nullable().optional(),
      daily_workout_minutes: z.number().int().min(0).max(1440).nullable().optional(),
      daily_sleep_hours: z.number().min(0).max(24).nullable().optional(),
      // 0125 — the WEIGHT target, its baseline, and the biometrics BMI/BMR are
      // derived from. Without these keys zod strips them and a target sent by
      // the client is silently discarded with a 200, which is exactly the
      // failure mode that left `goalWeight` at zero hits across the RN app.
      //
      // Kilograms are canonical here even though an ENTRY keeps the unit it was
      // typed in; see `backend/migrations/0125_health_weight_goal.sql`.
      // `.nullable()` on every one is load-bearing: it is how a member CLEARS a
      // goal, and it is what lets the client tell "cleared" apart from "this
      // Worker predates 0125" (key absent).
      target_weight_kg: z.number().positive().max(1000).nullable().optional(),
      weight_goal_type: z.enum(['lose', 'maintain', 'gain']).nullable().optional(),
      starting_weight_kg: z.number().positive().max(1000).nullable().optional(),
      starting_weight_date: dateSchema.nullable().optional(),
      height_cm: z.number().positive().max(300).nullable().optional(),
      gender: z.enum(['male', 'female', 'other']).nullable().optional(),
      // Bounded to a plausible living human so a typo cannot produce a negative
      // age and a nonsense BMR. The upper bound is open-ended on purpose (the
      // Worker has no reliable "today"), so the client refuses a future year.
      birth_year: z.number().int().min(1900).max(2200).nullable().optional(),
      activity_level: z
        .enum(['sedentary', 'lightlyActive', 'moderatelyActive', 'veryActive', 'extraActive'])
        .nullable()
        .optional(),
      // 0140 — the water-goal DISPLAY unit. Same "key absent vs explicit
      // null" contract as the 0125 biometrics above: absent means this
      // Worker predates 0140, null means the member has not chosen one yet.
      water_unit: z.enum(['ml', 'oz', 'L', 'cups']).nullable().optional(),
      // 0141 — the ONE global weight/height/distance display-unit switch.
      // Same absent-vs-null contract; independent of `water_unit` above.
      unit_system: z.enum(['metric', 'imperial']).nullable().optional(),
    })
  ),
  async (c) => {
    const { effective_date, ...patch } = c.req.valid('json');
    const date = effective_date ?? new Date().toISOString().slice(0, 10);
    return c.json({ goal: await svc(c).saveGoal(uid(c), date, patch) });
  }
);

/* ================================ HABITS ================================ */

/**
 * Habit schedule fields (donor `UserHabit`). Every column here has existed
 * since `0119_health_core.sql`; only the writes were missing, which is why the
 * app could store nothing but a name and a tick.
 *
 * `reminder_time` is a LOCAL wall-clock 'HH:MM'. The scheduler resolves it
 * against the member's own IANA zone, so storing a UTC instant here would be
 * wrong the moment they travel or DST shifts.
 */
const habitScheduleFields = {
  icon: z.string().max(40).optional(),
  category: z.string().max(40).optional(),
  template_id: z.string().max(60).nullable().optional(),
  time_of_day: z.enum(HABIT_TIMES_OF_DAY).optional(),
  frequency: z.enum(HABIT_FREQUENCIES).optional(),
  custom_days: z.array(z.number().int().min(1).max(7)).max(7).nullable().optional(),
  reminder_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'reminder_time must be HH:MM')
    .nullable()
    .optional(),
  reminder_enabled: z.boolean().optional(),
  target_duration: z.number().int().min(0).max(86_400).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
};

health.get('/habits', async (c) => {
  const includeArchived = c.req.query('include_archived') === 'true';
  return c.json({ habits: await svc(c).listHabits(uid(c), { includeArchived }) });
});

health.post(
  '/habits',
  zValidator('json', z.object({ name: z.string().min(1).max(60), ...habitScheduleFields })),
  async (c) => {
    const habit = await svc(c).createHabit(uid(c), c.req.valid('json'));
    // Best-effort and awaited: the row must exist before the scheduler reads it,
    // and `syncHabitReminders` never throws (a failed nudge can't fail a create).
    await syncHabitReminders(c.env, c.env.DB, habit.id);
    return c.json({ habit }, 201);
  }
);

health.put(
  '/habits/:id',
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(60).optional(),
      is_archived: z.boolean().optional(),
      sort_order: z.number().int().min(0).max(999).optional(),
      ...habitScheduleFields,
    })
  ),
  async (c) => {
    const habit = await svc(c).updateHabit(uid(c), c.req.param('id'), c.req.valid('json'));
    // Unknown id and someone else's id answer identically — see toggleHabit.
    if (!habit) return c.json({ error: { code: 'not_found', message: 'Habit not found' } }, 404);
    // Re-materialise: a changed time, frequency, day set or archive flag all
    // move the schedule, and sync cancels the stale rows before re-inserting.
    await syncHabitReminders(c.env, c.env.DB, habit.id);
    return c.json({ habit, habits: await svc(c).listHabits(uid(c), { includeArchived: true }) });
  }
);

health.delete('/habits/:id', async (c) => {
  const ok = await svc(c).deleteHabit(uid(c), c.req.param('id'));
  if (!ok) return c.json({ error: { code: 'not_found', message: 'Habit not found' } }, 404);
  // Drop the unsent nudges too, or a deleted habit keeps pinging for two weeks.
  await cancelHabitReminders(c.env.DB, c.req.param('id'));
  return c.json({ deleted: true });
});

health.post(
  '/habits/:id/toggle',
  zValidator('json', z.object({ date: dateSchema })),
  async (c) => {
    const result = await svc(c).toggleHabit(uid(c), c.req.param('id'), c.req.valid('json').date);
    // null = unknown habit, or one owned by a different user. Both answer 404 —
    // an "unauthorised" would confirm the id exists on another account.
    if (!result) {
      return c.json({ error: { code: 'not_found', message: 'Habit not found' } }, 404);
    }
    return c.json({ ...result, habits: await svc(c).listHabits(uid(c)) });
  }
);

/* =========================== WOMEN'S HEALTH ============================= */

health.get('/cycle/settings', async (c) => {
  return c.json({ settings: await svc(c).getCycleSettings(uid(c)) });
});

health.put(
  '/cycle/settings',
  zValidator(
    'json',
    z.object({
      cycle_length: z.number().int().min(20).max(45).optional(),
      period_length: z.number().int().min(1).max(14).optional(),
      last_period_start: dateSchema.nullable().optional(),
    })
  ),
  async (c) => {
    return c.json({ settings: await svc(c).saveCycleSettings(uid(c), c.req.valid('json')) });
  }
);

health.get('/cycle/periods', async (c) => {
  return c.json({ periods: await svc(c).listPeriods(uid(c)) });
});

health.post(
  '/cycle/periods',
  zValidator(
    'json',
    z.object({
      date: dateSchema,
      // Donor scale: 1=spotting … 5=very heavy.
      flow_level: z.number().int().min(1).max(5),
      notes: z.string().max(500).optional(),
    })
  ),
  async (c) => {
    const { date, flow_level, notes } = c.req.valid('json');
    const periods = await svc(c).logPeriodDay(uid(c), date, flow_level, notes);
    return c.json({ periods, settings: await svc(c).getCycleSettings(uid(c)) });
  }
);

health.delete('/cycle/periods/:date', async (c) => {
  const ok = await svc(c).removePeriodDay(uid(c), c.req.param('date'));
  if (!ok) return c.json({ error: { code: 'not_found', message: 'Period day not found' } }, 404);
  return c.json({ deleted: true, periods: await svc(c).listPeriods(uid(c)) });
});

health.get('/cycle/symptoms', async (c) => {
  return c.json({ symptoms: await svc(c).listCycleSymptoms(uid(c)) });
});

const severity = z.number().int().min(0).max(3).nullable().optional();

health.put(
  '/cycle/symptoms',
  zValidator(
    'json',
    z.object({
      date: dateSchema,
      mood: z.number().int().min(1).max(5).nullable().optional(),
      energy: z.number().int().min(1).max(5).nullable().optional(),
      cramps: severity,
      headache: severity,
      bloating: severity,
      breast_tenderness: severity,
      back_pain: severity,
      acne: severity,
      nausea: severity,
      anxiety: severity,
      irritability: severity,
      sadness: severity,
      cravings: z.enum(['none', 'sweet', 'salty', 'chocolate', 'carbs', 'spicy']).optional(),
      sleep_quality: z.number().int().min(1).max(5).nullable().optional(),
      libido: z.number().int().min(1).max(5).nullable().optional(),
      notes: z.string().max(500).optional(),
    })
  ),
  async (c) => {
    const { date, ...patch } = c.req.valid('json');
    return c.json({ entry: await svc(c).saveCycleSymptoms(uid(c), date, patch) });
  }
);

/* ============================ MEN'S HEALTH ============================== */

const scale10 = z.number().int().min(1).max(10).nullable().optional();
const flag = z.boolean().optional();

health.get('/mens-health/entries', async (c) => {
  return c.json({ entries: await svc(c).listMensHealth(uid(c)) });
});

health.put(
  '/mens-health/entries',
  zValidator(
    'json',
    z.object({
      date: dateSchema,
      libido: scale10,
      had_partner_sex: flag,
      had_masturbation: flag,
      had_orgasm: flag,
      overall_satisfaction: scale10,
      had_morning_erection: flag,
      morning_erection_quality: scale10,
      erection_quality: scale10,
      had_erotic_dream: flag,
      sexual_desire_level: scale10,
      had_erection_difficulty: flag,
      had_maintenance_difficulty: flag,
      had_premature_ejaculation: flag,
      had_delayed_ejaculation: flag,
      had_performance_anxiety: flag,
      had_low_desire: flag,
      had_pain_or_discomfort: flag,
      energy_level: scale10,
      mental_clarity: scale10,
      mood: scale10,
      sleep_quality: scale10,
      stress_level: scale10,
      exercised: flag,
      kegel_sets: z.number().int().min(0).max(50).nullable().optional(),
      notes: z.string().max(500).optional(),
    })
  ),
  async (c) => {
    const { date, ...patch } = c.req.valid('json');
    return c.json({ entry: await svc(c).saveMensHealth(uid(c), date, patch) });
  }
);

health.get('/mens-health/settings', async (c) => {
  return c.json({ settings: await svc(c).getMensHealthSettings(uid(c)) });
});

health.put(
  '/mens-health/settings',
  zValidator('json', z.record(z.union([z.boolean(), z.string(), z.null()]))),
  async (c) => {
    return c.json({ settings: await svc(c).saveMensHealthSettings(uid(c), c.req.valid('json')) });
  }
);

/* =========================== FOOD CHALLENGES ============================= */

/**
 * Personal food-gram targets for the Dashboard tab — "Eat 1000g vegetables
 * this week". Ported from the donor `backend/src/routes/challenges.ts`;
 * see `migrations/0136_food_challenges.sql` and `HealthChallengeService` for
 * the full donor mapping, matching rules and deliberately deferred pieces
 * (streaks/achievements, the AI-callback progress route, recalculate).
 *
 * NOT the same feature as the pre-existing `/health-social` "challenges"
 * (multi-user, joinable family-accountability challenges,
 * `schema-health-social.ts`) — these are per-user and never shared.
 */

const challengeCategory = z.enum([
  'vegetables',
  'fruits',
  'fish',
  'seafood',
  'meat',
  'dairy',
  'grains',
  'legumes',
  'nuts',
  'custom_ingredient',
]);
const challengeFrequency = z.enum(['daily', 'weekly']);

health.get('/challenges', async (c) => {
  const activeOnly = c.req.query('active') === 'true';
  const challenges = await challengeSvc(c).list(uid(c), { activeOnly });
  return c.json({ challenges });
});

health.post(
  '/challenges',
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(200),
      target_category: challengeCategory.optional(),
      target_food_name: z.string().min(1).max(120).optional(),
      target_amount_grams: z.number().min(1).max(10000),
      frequency: challengeFrequency,
      start_date: dateSchema.optional(),
      end_date: dateSchema.nullable().optional(),
      custom_icon: z.string().max(32).optional(),
    })
  ),
  async (c) => {
    const challenge = await challengeSvc(c).create(uid(c), c.req.valid('json'));
    return c.json({ challenge }, 201);
  }
);

/**
 * Partial patch. `end_date` and `custom_icon` follow the donor's
 * sentinel-flag contract: an explicit `null` clears the field, an OMITTED key
 * leaves it untouched (zod does not add a key for an absent optional field, so
 * the service can tell the two apart with a plain `hasOwnProperty`).
 */
health.put(
  '/challenges/:id',
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).max(200).optional(),
      target_category: challengeCategory.optional(),
      target_food_name: z.string().min(1).max(120).optional(),
      target_amount_grams: z.number().min(1).max(10000).optional(),
      frequency: challengeFrequency.optional(),
      start_date: dateSchema.optional(),
      end_date: dateSchema.nullable().optional(),
      is_active: z.boolean().optional(),
      custom_icon: z.string().max(32).nullable().optional(),
    })
  ),
  async (c) => {
    const challenge = await challengeSvc(c).update(uid(c), c.req.param('id'), c.req.valid('json'));
    if (!challenge) {
      return c.json({ error: { code: 'not_found', message: 'Challenge not found' } }, 404);
    }
    return c.json({ challenge });
  }
);

health.delete('/challenges/:id', async (c) => {
  const ok = await challengeSvc(c).delete(uid(c), c.req.param('id'));
  if (!ok) return c.json({ error: { code: 'not_found', message: 'Challenge not found' } }, 404);
  return c.json({ deleted: true });
});

/** The Dashboard widget's core read — see `HealthChallengeService.progressToday`. */
health.get('/challenges/progress/today', async (c) => {
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  return c.json(await challengeSvc(c).progressToday(uid(c), date));
});

health.get('/challenges/:id/progress/weekly', async (c) => {
  const weekly = await challengeSvc(c).weeklyProgress(uid(c), c.req.param('id'));
  if (!weekly) return c.json({ error: { code: 'not_found', message: 'Challenge not found' } }, 404);
  return c.json(weekly);
});

/* =========================== SUMMARY + SYNC ============================= */

health.get('/summary', async (c) => {
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  return c.json({ summary: await svc(c).dailySummary(uid(c), date) });
});

/**
 * Server-computed weekly Calories-vs-Weight trend for the Dashboard tab. No
 * donor server equivalent (the donor builds this on-device); see
 * `HealthService.weeklyTrend` for the shape and the Monday-start-of-week math.
 */
health.get('/summary/weekly-trend', async (c) => {
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  return c.json(await svc(c).weeklyTrend(uid(c), date));
});

/** Delta pull for multi-device sync; tombstones included so deletes propagate. */
health.get('/sync', async (c) => {
  const since = c.req.query('since') ?? '1970-01-01T00:00:00.000Z';
  return c.json(await svc(c).sync(uid(c), since));
});

/**
 * Rows are validated per COLUMN inside the service (against the real table
 * metadata) rather than re-declared as ~12 zod schemas here — a schema copy
 * would drift from `db/schema-health.ts` the first time a column is added, and
 * the whole point of the result map is that a bad row is REPORTED, not fatal.
 * The envelope check is therefore only "an object of arrays of objects", plus
 * the batch cap that keeps one push inside D1's per-request query budget.
 */
const syncPushSchema = z
  .object({
    changes: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).optional(),
  })
  .superRefine((body, ctx) => {
    const total = Object.values(body.changes ?? {}).reduce((sum, rows) => sum + rows.length, 0);
    if (total > MAX_PUSH_ROWS) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: MAX_PUSH_ROWS,
        type: 'array',
        inclusive: true,
        path: ['changes'],
        message: `A push may carry at most ${MAX_PUSH_ROWS} rows (got ${total})`,
      });
    }
  });

/**
 * Delta PUSH — the write half of the sync contract.
 *
 * Last-write-wins per ROW by `updated_at`, tombstones win ties, natural-key
 * tables merge on (user, date) rather than on a client id, and every row comes
 * back with its own verdict so the client can reconcile. See
 * `services/health-sync-service.ts` for the full strategy.
 */
health.post('/sync/push', zValidator('json', syncPushSchema), async (c) => {
  const { changes } = c.req.valid('json');
  const result = await new HealthSyncService(c.env.DB).push(uid(c), changes ?? {});
  return c.json(result);
});

export default health;
