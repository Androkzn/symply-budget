import { apiClient } from './client';

/**
 * Symply Health INJURY LOG API client — the donor's pain/injury tracker
 * (parity P2), and the WRITE half of the workout-library safety gate.
 *
 * Base path: `/health` on the `symply-health-api` Worker, served by
 * `backend/src/routes/health-body-extras.ts`. Every row is scoped to the
 * authenticated USER — injuries are personal and have no household read path by
 * design (BRD §7) — and the whole surface 404s on any other brand's Worker via
 * `requireHealthApi()`.
 *
 * NOTE — envelope shape. These call `apiClient` DIRECTLY rather than the
 * `api.get/post` helpers in `client.ts`. Those helpers type the body as
 * `ApiResponse<T>` (`{ data: T }`), but this Worker returns the payload BARE —
 * `c.json({ injuries })` — with no wrapping middleware. Going through the helper
 * makes every read resolve `undefined` against the live server while unit tests
 * pass, because the fixtures wrap the same way the type claims.
 * `src/api/__tests__/healthEnvelope.test.ts` pins that at source level.
 *
 * THE ONE CONTRACT THAT MATTERS MOST HERE — `body_part` is free text on the
 * wire (`z.string().trim().min(1).max(60)`), but the workout gate only acts on
 * it after folding it through `canonicalBodyPart()` in
 * `backend/src/services/health-exercise-service.ts`. That folder splits on
 * NON-ALPHANUMERICS, so "Left Knee" → `left_knee` → `knee` (a joint the gate
 * knows) while a camelCase "leftKnee" → `leftknee` → matches nothing and the
 * safety flag silently never fires. The vocabulary the app is allowed to send
 * therefore lives in ONE place — `INJURY_BODY_PARTS` in
 * `src/features/health/healthInjuryStorage.ts` — and is proven against the
 * deployed folder by `healthInjuryStorage.test.ts`. Do not send an ad-hoc
 * string from a screen.
 *
 * RESOLVE IS NOT DELETE. `POST /injuries/:id/resolve` flips `is_active` to
 * false: the injury leaves the workout-suppression set but stays fully readable
 * as history. `DELETE` is the separate (soft, tombstoned) operation that removes
 * it from the log entirely.
 *
 * Envelopes mirror `backend/src/routes/health-body-extras.ts` EXACTLY — change
 * both together.
 */

/* ============================ Row shapes ============================ */

/**
 * Donor pain scale, 0–4 (`PainLevel` in the donor's `InjuryModels.swift`).
 *
 * The bound is load-bearing on both ends: the route validates
 * `z.number().int().min(0).max(4)` AND the column carries a DDL CHECK, so a
 * client bug that sent a 10-on-a-5-point-scale fails loudly instead of storing.
 */
export type HealthPainLevel = 0 | 1 | 2 | 3 | 4;

export interface HealthInjury {
  id: string;
  user_id: string;
  /** `YYYY-MM-DD` — the client's own LOCAL day, never a UTC stamp. */
  date: string;
  /** Exactly what the client sent; the gate folds it, the UI shows it verbatim. */
  body_part: string;
  pain_level: number;
  injury_type: string;
  cause: string | null;
  muscle_group: string | null;
  notes: string | null;
  /** `false` means HEALED — out of the gate, still in history. */
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Create body. `body_part` is the only required field — the same rule the donor's
 * Add sheet enforces by disabling Save until an area is picked.
 *
 * Server defaults for everything omitted: `date` = today, `pain_level` = 1,
 * `injury_type` = `'pain'`, `is_active` = true.
 */
export interface HealthInjuryPayload {
  date?: string;
  body_part: string;
  pain_level?: HealthPainLevel;
  injury_type?: string;
  cause?: string | null;
  muscle_group?: string | null;
  notes?: string | null;
}

/**
 * Update body. PARTIAL — an omitted key keeps its stored value (the service
 * drops undefined keys so a PATCH-shaped body cannot null a column).
 *
 * `is_active: true` is the RE-ACTIVATION path: an old injury can flare up again,
 * and the route allows it deliberately.
 */
export interface HealthInjuryPatch extends Partial<HealthInjuryPayload> {
  is_active?: boolean;
}

/**
 * One row of the workout-suppression set, as `/injuries/active-body-parts`
 * reports it. Derived server-side so the phone, the widget and any future coach
 * agree on one answer.
 */
export interface HealthActiveBodyPart {
  /** Exactly what the user typed. */
  body_part: string;
  /** Worst live pain on that part. */
  max_pain_level: number;
  injury_count: number;
  /** Distinct non-null muscle groups, for suggesters that gate by group. */
  muscle_groups: string[];
}

/** Server-side filters. All optional, all AND-ed. */
export interface HealthInjuryQuery {
  /** `true` = live only, `false` = resolved only, omitted = BOTH. */
  active?: boolean;
  body_part?: string;
  date?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/* ============================== Client =============================== */

const BASE = '/health';

export const healthInjuriesApi = {
  /**
   * The injury log. Called with no params it returns ACTIVE **and** RESOLVED
   * rows, newest date first — which is what the offline snapshot caches, so the
   * history tab still renders with no signal.
   */
  listInjuries: (params?: HealthInjuryQuery) =>
    apiClient.get<{ injuries: HealthInjury[] }>(`${BASE}/injuries`, { params }).then((r) => r.data),

  /**
   * The distinct body parts a workout suggester must avoid.
   *
   * The workout library does NOT call this — `/health/exercises` already returns
   * a server-computed verdict per row. It exists here so the injury screen can
   * state, from the server's own derivation rather than its own guess, which of
   * the user's injuries are currently steering the library.
   */
  listActiveBodyParts: () =>
    apiClient
      .get<{ body_parts: HealthActiveBodyPart[] }>(`${BASE}/injuries/active-body-parts`)
      .then((r) => r.data),

  createInjury: (body: HealthInjuryPayload) =>
    apiClient.post<{ injury: HealthInjury }>(`${BASE}/injuries`, body).then((r) => r.data),

  updateInjury: (id: string, body: HealthInjuryPatch) =>
    apiClient.put<{ injury: HealthInjury }>(`${BASE}/injuries/${id}`, body).then((r) => r.data),

  /** HEALED — leaves the workout gate, stays in history. Idempotent server-side. */
  resolveInjury: (id: string) =>
    apiClient
      .post<{ injury: HealthInjury }>(`${BASE}/injuries/${id}/resolve`, {})
      .then((r) => r.data),

  /** Soft delete — the tombstone is what makes the delete propagate on sync. */
  deleteInjury: (id: string) =>
    apiClient.delete<{ deleted: boolean }>(`${BASE}/injuries/${id}`).then((r) => r.data),
};

export default healthInjuriesApi;
