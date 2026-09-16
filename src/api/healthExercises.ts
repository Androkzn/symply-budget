import { apiClient } from './client';

/**
 * Symply Health WORKOUT LIBRARY API client — the exercise catalogue, its
 * filters, favourites and the injury gate.
 *
 * Base path: `/health` on the `symply-health-api` Worker, mounted alongside the
 * other Health routers in `backend/src/routes/health-exercises.ts`. The
 * CATALOGUE is global; everything personal hanging off it (favourites, injury
 * flags) is scoped to the authenticated USER, and the whole surface 404s on any
 * other brand's Worker via `requireHealthApi()`.
 *
 * TWO RULES THIS MODULE EXISTS TO PROTECT:
 *
 *  1. **`apiClient` DIRECTLY, never the `api.*` helpers.** Those helpers type
 *     every body as `ApiResponse<T>` (`{ data }`); the Health Worker answers
 *     with the bare object. Going through them resolves `undefined` and silently
 *     falls back to the offline cache — an app that looks like it works and
 *     never shows server data. `src/api/__tests__/healthEnvelope.test.ts`
 *     enforces this.
 *
 *  2. **The injury flag is the SERVER's verdict.** `injury_flag` /
 *     `injury_body_parts` arrive computed from the user's active injuries. The
 *     device must render them, never re-derive them — a client that guessed
 *     would disagree with the Worker exactly when it matters most.
 *
 * There is deliberately NO "log this exercise" method here: a logged session
 * goes through the existing `healthApi.logWorkout` → `/health/entries/workouts`,
 * using the `workout_type` and `default_minutes` each catalogue row carries.
 *
 * Envelopes mirror `backend/src/routes/health-exercises.ts` EXACTLY — change
 * both together.
 */

/* ============================ Row shapes ============================ */

/** The donor 5-star scale (migration 008_difficulty_levels.sql). */
export type HealthExerciseDifficulty = 'level1' | 'level2' | 'level3' | 'level4' | 'level5';

export type HealthExerciseCategory =
  | 'strength'
  | 'cardio'
  | 'yoga'
  | 'stretching'
  | 'mobility'
  | 'rehabilitation'
  | 'recovery';

/** The gate's verdict. `null` means nothing about this movement is flagged. */
export type HealthInjuryFlag = 'caution' | 'avoid';

/**
 * A catalogue row as the Worker returns it — every JSON column already PARSED
 * into an array, so the device never sees a `'["chest","triceps"]'` blob.
 */
export interface HealthExercise {
  id: string;
  name: string;
  aliases: string[];
  category: HealthExerciseCategory | string;
  /** Muscles this movement loads FIRST. */
  muscle_groups: string[];
  secondary_muscles: string[];
  equipment: string[];
  /** Joints the movement loads — the injury gate's vocabulary. */
  body_parts: string[];
  difficulty: HealthExerciseDifficulty | string;
  /** 1–5, derived server-side so the client never parses "level3". */
  difficulty_level: number;
  instructions: string | null;
  /** Symply Health icon-kit key; a miss degrades to the Ionicons fallback. */
  illustration: string | null;
  /** P4 video/animation reference — null on every shipped row today. */
  media_url: string | null;
  default_minutes: number;
  /** A value `/health/entries/workouts` accepts, so "log this" just works. */
  workout_type: string;
  is_favorite: boolean;
  /** SERVER verdict — see rule 2. */
  injury_flag: HealthInjuryFlag | null;
  /** The user's OWN wording for each active injury this exercise loads. */
  injury_body_parts: string[];
  updated_at: string;
}

/** One currently-active injury, as the list response reports it. */
export interface HealthActiveInjuryPart {
  /** Exactly what the user typed. */
  body_part: string;
  /** The joint the gate folded it onto. */
  canonical: string;
  max_pain_level: number;
  injury_count: number;
}

export interface HealthExerciseList {
  exercises: HealthExercise[];
  /** Every active injury, so the screen can explain the flags it renders. */
  injury_body_parts: HealthActiveInjuryPart[];
}

/**
 * Browse filters. All optional, all AND-ed server-side.
 *
 * `category` and `difficulty` are CLOSED sets and 400 on anything else — a typo
 * would otherwise return an empty library that reads as "no exercises exist".
 * `muscle_group` / `equipment` are open vocabularies and simply match nothing.
 */
export interface HealthExerciseQuery {
  search?: string;
  muscle_group?: string;
  equipment?: string;
  difficulty?: HealthExerciseDifficulty;
  category?: HealthExerciseCategory;
  favorites?: boolean;
  /** Opt-in. The default keeps flagged work, ranked below everything safe. */
  exclude_flagged?: boolean;
  limit?: number;
}

/* ============================== Client =============================== */

const BASE = '/health';

export const healthExercisesApi = {
  /**
   * Browse / filter / search the catalogue.
   *
   * Called with no params it returns the WHOLE library plus the caller's
   * favourites and injury flags — which is what the offline snapshot caches.
   */
  listExercises: (params?: HealthExerciseQuery) =>
    apiClient.get<HealthExerciseList>(`${BASE}/exercises`, { params }).then((r) => r.data),

  /** One catalogue row, decorated exactly like its entry in the list. */
  getExercise: (id: string) =>
    apiClient
      .get<{ exercise: HealthExercise }>(`${BASE}/exercises/${id}`)
      .then((r) => r.data),

  /**
   * Favourite / un-favourite. Idempotent, and the only write this surface has.
   * Un-favouriting SOFT deletes server-side — the tombstone is what lets another
   * device drop its copy instead of resurrecting it.
   */
  setFavorite: (id: string, isFavorite: boolean) =>
    apiClient
      .put<{ exercise: HealthExercise }>(`${BASE}/exercises/${id}/favorite`, {
        is_favorite: isFavorite,
      })
      .then((r) => r.data),
};

export default healthExercisesApi;
