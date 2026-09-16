import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireHealthApi } from '../middleware/brand-gate';
import {
  EXERCISE_CATEGORY_VALUES,
  EXERCISE_DIFFICULTY_LEVELS,
  HealthExerciseService,
} from '../services/health-exercise-service';
import type { Env } from '../types';

/**
 * Symply Health — WORKOUT LIBRARY: the exercise catalogue, its filters and a
 * user's favourites.
 *
 * Mounted at `/health` alongside `routes/health.ts`. Same contract:
 * `requireHealthApi()` 404s the whole surface on every non-Health Worker, and
 * every user-owned row is scoped to the authenticated USER — health data is
 * personal and has no household read path by design (BRD §7).
 *
 * Each Health router owns disjoint sub-paths, so mount ordering between them at
 * the shared `/health` prefix does not matter.
 *
 * THIN CLIENT, exactly like the other Health routers: filtering, relevance
 * scoring, JSON-column parsing and the INJURY GATE all live in
 * `HealthExerciseService`. Handlers validate the shape and pass through.
 *
 * TWO THINGS THIS ROUTER DELIBERATELY DOES NOT DO:
 *  - It never WRITES a catalogue row. The catalogue is global and authored in
 *    `migrations/0123_health_exercise_library.sql`; a client-writable endpoint
 *    would let one device edit what every other account sees.
 *  - It never logs a workout session. "Log this" posts to the EXISTING
 *    `/health/entries/workouts` route (`routes/health.ts`) using the
 *    `workout_type` + `default_minutes` each catalogue row carries. Duplicating
 *    session logging here would fork the activity history in two.
 */
const healthExercises = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

healthExercises.use('/*', requireHealthApi());
healthExercises.use('/*', authMiddleware());

function uid(c: { get: (k: 'userId') => string }): string {
  return c.get('userId');
}

function svc(c: { env: Env }): HealthExerciseService {
  return new HealthExerciseService(c.env.DB);
}

function isTrue(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

/* ============================== CATALOGUE ============================== */

/**
 * Browse the catalogue.
 *
 * Query params (all optional, all AND-ed):
 *   `search`         relevance-ranked over name + aliases + muscle + equipment
 *   `muscle_group`   matches PRIMARY or SECONDARY muscles
 *   `equipment`      one equipment token
 *   `difficulty`     level1..level5
 *   `category`       strength | cardio | yoga | stretching | mobility |
 *                    rehabilitation | recovery
 *   `favorites`      only this user's favourites
 *   `exclude_flagged` drop injury-flagged rows entirely (opt-in — the default is
 *                    to keep them, flagged and pushed to the bottom)
 *   `limit`          1..300
 *
 * `category` and `difficulty` are validated because they are closed sets: a
 * typo would silently return an EMPTY library and read as "there are no
 * exercises". `muscle_group` / `equipment` are open vocabularies, so an unknown
 * token legitimately matches nothing.
 */
healthExercises.get('/exercises', async (c) => {
  const {
    search,
    muscle_group,
    equipment,
    difficulty,
    category,
    favorites,
    exclude_flagged,
    limit,
  } = c.req.query();

  const categories: readonly string[] = EXERCISE_CATEGORY_VALUES;
  if (category !== undefined && !categories.includes(category)) {
    return c.json(
      {
        error: {
          code: 'bad_request',
          message: `category must be one of: ${categories.join(', ')}`,
        },
      },
      400
    );
  }
  const difficulties: readonly string[] = EXERCISE_DIFFICULTY_LEVELS;
  if (difficulty !== undefined && !difficulties.includes(difficulty)) {
    return c.json(
      {
        error: {
          code: 'bad_request',
          message: `difficulty must be one of: ${difficulties.join(', ')}`,
        },
      },
      400
    );
  }

  const parsedLimit = limit ? Number(limit) : undefined;
  // Bound into `LIMIT ?`, and D1 rejects a non-integer REAL there with
  // SQLITE_MISMATCH — so `?limit=1.5` used to 500 on an ordinary list.
  if (parsedLimit !== undefined && !Number.isInteger(parsedLimit)) {
    return c.json({ error: { code: 'bad_request', message: 'limit must be an integer' } }, 400);
  }

  const result = await svc(c).listExercises(uid(c), {
    search,
    muscle_group,
    equipment,
    difficulty,
    category,
    favorites: isTrue(favorites),
    exclude_flagged: isTrue(exclude_flagged),
    limit: parsedLimit,
  });
  return c.json(result);
});

healthExercises.get('/exercises/:id', async (c) => {
  const exercise = await svc(c).getExercise(uid(c), c.req.param('id'));
  if (!exercise) {
    return c.json({ error: { code: 'not_found', message: 'Exercise not found' } }, 404);
  }
  return c.json({ exercise });
});

/* ============================== FAVOURITES ============================= */

/**
 * Favourite / un-favourite. Idempotent in both directions, and the ONLY write
 * this router exposes.
 *
 * 404, never 403, on an unknown id — a 403 would confirm which ids exist.
 */
healthExercises.put(
  '/exercises/:id/favorite',
  zValidator('json', z.object({ is_favorite: z.boolean() })),
  async (c) => {
    const exercise = await svc(c).setFavorite(
      uid(c),
      c.req.param('id'),
      c.req.valid('json').is_favorite
    );
    if (!exercise) {
      return c.json({ error: { code: 'not_found', message: 'Exercise not found' } }, 404);
    }
    return c.json({ exercise });
  }
);

export default healthExercises;
