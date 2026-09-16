import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireHealthApi } from '../middleware/brand-gate';
import {
  HealthBodyExtrasService,
  MAX_PAIN_LEVEL,
  MIN_PAIN_LEVEL,
} from '../services/health-body-extras-service';
import type { Env } from '../types';

/**
 * Symply Health — parity phase P2, `body-extras` group: body insights, injuries and activity preferences.
 *
 * Mounted at `/health` alongside `routes/health.ts`. Same contract:
 * `requireHealthApi()` 404s the whole surface on every non-Health Worker, and
 * every row is scoped to the authenticated USER — health data is personal and
 * has no household read path by design (BRD §7).
 *
 * Each P2 router owns disjoint sub-paths, so mount ordering between them at the
 * shared `/health` prefix does not matter.
 *
 * THIN CLIENT: every derived figure comes from `HealthBodyExtrasService`.
 *
 * Body insights are READ-ONLY over HTTP. They are AI-produced (the producer
 * lands in P3 and calls the service in-process); a client-writable endpoint
 * would let a device fabricate an "AI" body-composition assessment.
 */
const healthBodyExtras = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

healthBodyExtras.use('/*', requireHealthApi());
healthBodyExtras.use('/*', authMiddleware());

function uid(c: { get: (k: 'userId') => string }): string {
  return c.get('userId');
}

function svc(c: { env: Env }): HealthBodyExtrasService {
  return new HealthBodyExtrasService(c.env.DB);
}

/** YYYY-MM-DD — the client always sends its own LOCAL day, never a UTC stamp. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

function notFound(what: string) {
  return { error: { code: 'not_found' as const, message: `${what} not found` } };
}

/* =============================== INJURIES =============================== */

/**
 * Donor pain scale, 0–4. The bound is load-bearing: `pain_level` drives how
 * hard the workout gate suppresses a body part, so a 10-on-a-5-point-scale
 * client bug must fail loudly instead of being stored.
 */
const painLevel = z.number().int().min(MIN_PAIN_LEVEL).max(MAX_PAIN_LEVEL);

/** Whitespace is not a body part — `.trim()` before `.min(1)` rejects "   ". */
const bodyPart = z.string().trim().min(1).max(60);

/**
 * MUST stay above `/injuries/:id`-shaped routes: Hono matches in registration
 * order, so a later static path would lose to an earlier parameterised one.
 */
healthBodyExtras.get('/injuries/active-body-parts', async (c) => {
  return c.json({ body_parts: await svc(c).activeBodyParts(uid(c)) });
});

healthBodyExtras.get('/injuries', async (c) => {
  const { active, body_part, date, from, to, limit } = c.req.query();
  if (active !== undefined && !['true', 'false', '1', '0'].includes(active)) {
    return c.json(
      { error: { code: 'bad_request', message: 'active must be true or false' } },
      400
    );
  }
  const parsedLimit = limit ? Number(limit) : undefined;
  // Bound into `LIMIT ?`, and D1 rejects a non-integer REAL there with
  // SQLITE_MISMATCH — so `?limit=1.5` used to 500 on an ordinary list.
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }
  const injuries = await svc(c).listInjuries(uid(c), {
    active: active === undefined ? undefined : active === 'true' || active === '1',
    body_part,
    date,
    from,
    to,
    limit: parsedLimit,
  });
  return c.json({ injuries });
});

healthBodyExtras.post(
  '/injuries',
  zValidator(
    'json',
    z.object({
      date: dateSchema.optional(),
      body_part: bodyPart,
      pain_level: painLevel.optional(),
      injury_type: z.string().max(40).optional(),
      cause: z.string().max(200).nullable().optional(),
      muscle_group: z.string().max(60).nullable().optional(),
      notes: z.string().max(1000).nullable().optional(),
    })
  ),
  async (c) => {
    const injury = await svc(c).createInjury(uid(c), c.req.valid('json'));
    return c.json({ injury }, 201);
  }
);

healthBodyExtras.put(
  '/injuries/:id',
  zValidator(
    'json',
    z.object({
      date: dateSchema.optional(),
      body_part: bodyPart.optional(),
      pain_level: painLevel.optional(),
      injury_type: z.string().max(40).optional(),
      cause: z.string().max(200).nullable().optional(),
      muscle_group: z.string().max(60).nullable().optional(),
      notes: z.string().max(1000).nullable().optional(),
      // Re-activation is legitimate — an old injury can flare up again.
      is_active: z.boolean().optional(),
    })
  ),
  async (c) => {
    const injury = await svc(c).updateInjury(uid(c), c.req.param('id'), c.req.valid('json'));
    if (!injury) return c.json(notFound('Injury'), 404);
    return c.json({ injury });
  }
);

/**
 * The injury HEALED — `is_active` flips to false.
 *
 * This is NOT a delete: the row stays readable in history (and in
 * `GET /injuries?active=false`), it only leaves the workout-suppression set.
 */
healthBodyExtras.post('/injuries/:id/resolve', async (c) => {
  const injury = await svc(c).resolveInjury(uid(c), c.req.param('id'));
  if (!injury) return c.json(notFound('Injury'), 404);
  return c.json({ injury });
});

/** Soft delete — the tombstone is what makes the delete propagate on sync. */
healthBodyExtras.delete('/injuries/:id', async (c) => {
  const ok = await svc(c).deleteInjury(uid(c), c.req.param('id'));
  if (!ok) return c.json(notFound('Injury'), 404);
  return c.json({ deleted: true });
});

/* ========================= ACTIVITY PREFERENCES ========================= */

/**
 * A workout-type slug (`WorkoutType` client-side). Not hard-validated against
 * that exact 61-entry enum — this Worker does not share the RN-only type — so
 * an older Worker reading a newer client's slug simply carries it through.
 * Bounded to a plausible slug shape so a malformed client cannot wedge junk in.
 */
const workoutTypeSlug = z.string().trim().min(1).max(60);

const preferenceFlags = {
  notify_recipe_created: z.boolean().optional(),
  notify_recipe_updated: z.boolean().optional(),
  notify_custom_food_created: z.boolean().optional(),
  notify_workout_video_shared: z.boolean().optional(),
  notify_photo_shared: z.boolean().optional(),
  notify_milestone_achieved: z.boolean().optional(),
  notify_community_recipe_created: z.boolean().optional(),
  notify_community_achievement: z.boolean().optional(),
  receive_push_notifications: z.boolean().optional(),
  receive_inapp_notifications: z.boolean().optional(),
  // Capped at 61 — the whole `WorkoutType` vocabulary — so a malformed client
  // cannot wedge an unbounded blob into the row.
  favourite_workout_types: z.array(workoutTypeSlug).max(61).optional(),
};

/** Never null: an unsaved user reads the donor defaults (service header). */
healthBodyExtras.get('/activity-preferences', async (c) => {
  return c.json({ preferences: await svc(c).getActivityPreferences(uid(c)) });
});

/**
 * Upsert keyed on `user_id` (the table's PRIMARY KEY — there is no `id`).
 * PARTIAL: omitted flags keep their stored value.
 */
healthBodyExtras.put(
  '/activity-preferences',
  zValidator('json', z.object(preferenceFlags)),
  async (c) => {
    const preferences = await svc(c).saveActivityPreferences(uid(c), c.req.valid('json'));
    return c.json({ preferences });
  }
);

/* ============================= BODY INSIGHTS ============================ */

/** Newest first, so the Body tab renders history without re-sorting. */
healthBodyExtras.get('/body-insights', async (c) => {
  const { from, to, limit } = c.req.query();
  const parsedLimit = limit ? Number(limit) : undefined;
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }
  const insights = await svc(c).listComprehensiveInsights(uid(c), {
    from,
    to,
    limit: parsedLimit,
  });
  return c.json({ insights });
});

/** MUST stay above any future `/body-insights/:id`. */
healthBodyExtras.get('/body-insights/latest', async (c) => {
  return c.json({ insight: await svc(c).latestComprehensiveInsight(uid(c)) });
});

/** Per-photo analyses (`body_photo_insights`); `?photo_id=` narrows to one. */
healthBodyExtras.get('/body-insights/photo', async (c) => {
  const { photo_id, date, limit } = c.req.query();
  const parsedLimit = limit ? Number(limit) : undefined;
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }
  const insights = await svc(c).listPhotoInsights(uid(c), {
    photo_id,
    date,
    limit: parsedLimit,
  });
  return c.json({ insights });
});

export default healthBodyExtras;
