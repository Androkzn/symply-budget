import { apiClient } from './client';

/**
 * Symply Health AI API client — parity phase P3.
 *
 * Base path: `/health/ai` on the `symply-health-api` Worker, served by
 * `backend/src/routes/health-ai.ts`. Three donor surfaces live here: the AI
 * coach (`healthCoach.ts`), the nutrition-label and meal scanners
 * (`/ai/scan-nutrition-label`, `/ai/analyze-food`, `/ai/analyze-food-scale`),
 * and the body-insight producer that `/health/body-insights` has been waiting
 * for since P2.
 *
 * NOTE — envelope shape. These call `apiClient` DIRECTLY rather than the
 * `api.get/post` helpers in `client.ts`. Those helpers type the body as
 * `ApiResponse<T>` (`{ data: T }`), but this Worker returns the payload BARE —
 * `c.json({ turn })` — with no wrapping middleware. Going through the helper
 * makes every read resolve `undefined` against the live server while unit tests
 * pass, because the fixtures wrap the same way the type claims.
 * `src/api/__tests__/healthEnvelope.test.ts` pins that at source level, and this
 * module is on its list.
 *
 * ── TIMEOUTS ────────────────────────────────────────────────────────────────
 *
 * The default axios timeout is far too short for a vision call. The scanner and
 * the coach both pass `timeout: AI_TIMEOUT_MS` (120 s), the same figure
 * `src/api/savings.ts`, `src/api/mortgage.ts` and the Kaizen import path use for
 * their extract calls. A 30-second default surfaces to the member as a failed
 * scan on a photo the model was still reading.
 *
 * ── WHAT THIS CLIENT DELIBERATELY DOES NOT DO ───────────────────────────────
 *
 * There is no "save this scan" call here, and no coach-only write route. A scan
 * returns a DRAFT the member reviews, and it is saved through the routes the app
 * already uses — `healthFoodApi.createCustomFood` (`source_type: 'scanned'`) and
 * the ordinary nutrition entry path. A coach proposal is committed through
 * `commitProposal`, which is the ledger, not a new write surface: the row it
 * produces is created by the same `HealthService` methods a typed entry uses, so
 * it is editable and deletable on the normal screens.
 */

/** 2 minutes — a vision call routinely outruns the 30 s axios default. */
export const AI_TIMEOUT_MS = 120000;

const BASE = '/health/ai';

/* ============================ Coach — consent ============================ */

/**
 * Deny-by-default. `granted` is false for an account that never answered AND
 * for one whose stored receipt predates `required_version` — a consent is only
 * meaningful against the words it was given for, so changing the disclosure
 * re-asks.
 */
export interface HealthCoachConsent {
  granted: boolean;
  version: string | null;
  granted_at: string | null;
  revoked_at: string | null;
  /** The disclosure version the app must currently ask against. */
  required_version: string;
}

/* ============================== Coach — turn ============================= */

/** The deterministic emergency layer. Matched before any model call. */
export interface HealthCoachEscalation {
  category: string;
  message: string;
  /** ALWAYS false. The app has not contacted anyone and must never imply it has. */
  claims_help_contacted: boolean;
  collect_location: boolean;
}

export interface HealthInsightFact {
  label: string;
  value: number;
  unit?: string;
}

/**
 * One grounded insight. `speakable` is guaranteed to contain no number that is
 * not in `facts` — the server refuses to emit one.
 */
export interface HealthGroundedInsight {
  id: string;
  priority: number;
  kind: 'calories' | 'protein' | 'water' | 'unknown_data' | 'suppressed';
  title: string;
  facts: HealthInsightFact[];
  caveats: string[];
  data_window: { start: string; end: string };
  speakable: string;
}

export interface HealthProposalMealItem {
  food_name: string;
  grams: number | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

/** The 0124 effort enum. NULL = the member did not say, which is not "easy". */
export type HealthProposalWorkoutIntensity = 'easy' | 'steady' | 'hard' | 'max';

export type HealthProposalPayload =
  | { kind: 'water'; amount_ml: number }
  | { kind: 'weight'; weight: number; unit: 'kg' | 'lb' }
  | {
      kind: 'nutrition';
      meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
      items: HealthProposalMealItem[];
    }
  | {
      kind: 'workout';
      workout_type: string;
      minutes: number;
      calories: number | null;
      note: string | null;
      intensity: HealthProposalWorkoutIntensity | null;
    }
  | { kind: 'period'; flow_level: number; notes: string | null }
  | {
      kind: 'habit';
      habit_id: string;
      /**
       * What the confirm card must print. The Worker re-checks this against the
       * stored habit and refuses the pair if the id and the name disagree, so
       * the card cannot show one habit while another gets ticked.
       */
      habit_name: string;
    };

/** The donor's flow scale, 1 = spotting … 5 = very heavy. */
export const HEALTH_FLOW_LEVEL_LABELS: Record<number, string> = {
  1: 'Spotting',
  2: 'Light',
  3: 'Medium',
  4: 'Heavy',
  5: 'Very heavy',
};

/**
 * A suggested log. NOTHING has been written. `payload_hash` is what the commit
 * route checks the client echoes back, so the numbers that land are the numbers
 * the member read.
 */
/** Mirrors `ProposalTargetType` on the Worker; also `health_coach_operations.target_type`. */
export type HealthProposalTargetType =
  | 'water'
  | 'weight'
  | 'nutrition'
  | 'workout'
  | 'period'
  | 'habit';

export interface HealthCoachProposal {
  operation_id: string;
  operation_type: 'create';
  target_type: HealthProposalTargetType;
  original_text: string;
  normalized_payload: HealthProposalPayload;
  payload_hash: string;
  /** ISO, 15 minutes out. A stale suggestion about "today" must not land tomorrow. */
  expires_at: string;
  commit_status: 'proposed';
}

export interface HealthCoachTurn {
  kind: 'reply' | 'proposal' | 'escalation' | 'unavailable';
  /** Null whenever the model did not produce a usable turn. Never invented. */
  reply: string | null;
  proposal: HealthCoachProposal | null;
  escalation: HealthCoachEscalation | null;
  insights: HealthGroundedInsight[];
  ai_status: 'ok' | 'unavailable' | 'skipped';
  /** Plain-words explanation when `ai_status` is not `ok`. Never a provider string. */
  notice: string | null;
  model: string | null;
}

export interface HealthCoachHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface HealthCoachTurnPayload {
  message: string;
  /** The device's OWN local day (YYYY-MM-DD), never a UTC stamp. */
  today: string;
  history?: HealthCoachHistoryTurn[];
}

/**
 * One row of the commit ledger — the receipt for something the member confirmed.
 *
 * `commit_status` is `'committed'` for a finished write and `'pending'` for one
 * that was claimed and did not land (the ledger is written BEFORE the diary, so
 * a pending row is the recoverable state a retry finishes, not a lost write).
 * `target_id` is empty on a pending row because there is no target yet.
 */
export interface HealthCoachOperation {
  operation_id: string;
  user_id: string;
  target_type: HealthProposalTargetType | string;
  target_id: string;
  payload_hash: string;
  commit_status: 'committed' | 'pending' | string;
  result_json: string | null;
  created_at: string;
  updated_at: string;
}

/* ============================== Scanners ================================ */

/** Advisory only on the wire — the Worker sniffs the real type from the bytes. */
export interface HealthScanImage {
  /** Raw base64, NO `data:` prefix. */
  data: string;
  media_type?: string;
}

/** Where the per-100 basis came from. `derived` means the server divided. */
export type HealthPer100Source = 'label' | 'derived' | 'none';

export interface HealthNutritionLabelDraft {
  product_name: string | null;
  brand: string | null;
  serving_size: string | null;
  serving_size_g: number | null;
  serving_size_unit: 'g' | 'ml' | null;
  servings_per_container: number | null;
  calories: number | null;
  proteins: number | null;
  carbohydrates: number | null;
  fats: number | null;
  saturated_fat: number | null;
  trans_fat: number | null;
  cholesterol: number | null;
  sodium: number | null;
  dietary_fiber: number | null;
  total_sugars: number | null;
  added_sugars: number | null;
  vitamin_d: number | null;
  calcium: number | null;
  iron: number | null;
  potassium: number | null;
  ingredients: string | null;
  /** The basis `custom_foods` re-derives every portion from. */
  base_calories_per_100: number | null;
  base_proteins_per_100: number | null;
  base_carbs_per_100: number | null;
  base_fats_per_100: number | null;
  per_100_source: HealthPer100Source;
  confidence: number | null;
  notes: string | null;
}

/** The donor's provenance ladder — rendered as a chip on every row. */
export type HealthMealDataSource =
  | 'nutrition_label'
  | 'package_description'
  | 'product_database'
  | 'brand_lookup'
  | 'estimation';

export interface HealthMealPhotoFood {
  food_name: string;
  brand: string | null;
  cooking_state: string | null;
  portion: number | null;
  unit: string | null;
  calories: number | null;
  proteins: number | null;
  carbohydrates: number | null;
  fats: number | null;
  fiber: number | null;
  sugar: number | null;
  calories_per_100g: number | null;
  proteins_per_100g: number | null;
  carbs_per_100g: number | null;
  fats_per_100g: number | null;
  confidence: number | null;
  data_source: HealthMealDataSource | null;
}

export interface HealthMealPhotoDraft {
  foods: HealthMealPhotoFood[];
  scale_reading: { value: number | null; unit: string | null; detected: boolean } | null;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
  total_calories: number | null;
  image_quality: string | null;
  notes: string | null;
}

/* =========================== Body insight ============================== */

export interface HealthSiteChange {
  site: string;
  first: number;
  latest: number;
  /** latest − first. The sign is meaning and is never absolute. */
  delta: number;
  unit: string;
  from_date: string;
  to_date: string;
  readings: number;
}

export interface HealthMeasurementFacts {
  window_from: string | null;
  window_to: string | null;
  dates_logged: number;
  sites_logged: number;
  changes: HealthSiteChange[];
  single_reading_sites: string[];
  /** True → no delta is reported at all; a cm/inch diff means nothing. */
  mixed_units: boolean;
}

export interface HealthBodyInsightResult {
  insight: Record<string, unknown>;
  facts: HealthMeasurementFacts;
  ai_status: 'ok' | 'unavailable';
  /** Model sentences discarded for containing a number the data does not hold. */
  dropped_ungrounded: number;
}

/* ================================ Client ================================ */

export const healthAiApi = {
  /* -- coach -- */

  getCoachConsent: () =>
    apiClient.get<{ consent: HealthCoachConsent }>(`${BASE}/coach/consent`).then((r) => r.data),

  setCoachConsent: (granted: boolean) =>
    apiClient
      .put<{ consent: HealthCoachConsent }>(`${BASE}/coach/consent`, { granted })
      .then((r) => r.data),

  /**
   * One coach turn.
   *
   * The server reads the member's own logged figures itself — nothing about
   * them is sent from here — so `history` is the only context the device
   * supplies, and the Worker caps it at six turns.
   */
  coachTurn: (payload: HealthCoachTurnPayload) =>
    apiClient
      .post<{ turn: HealthCoachTurn }>(`${BASE}/coach/turn`, payload, { timeout: AI_TIMEOUT_MS })
      .then((r) => r.data),

  /**
   * Commit a proposal the member confirmed. `confirmed_payload_hash` MUST be the
   * hash carried on the proposal they were shown — the route refuses anything
   * else, which is what makes the confirmation mean something.
   */
  commitProposal: (args: {
    proposal: HealthCoachProposal;
    today: string;
  }) =>
    apiClient
      .post<{ status: 'committed' | 'idempotent_replay'; target_type: string; target_id: string }>(
        `${BASE}/coach/commit`,
        {
          proposal: args.proposal,
          confirmed_payload_hash: args.proposal.payload_hash,
          today: args.today,
        }
      )
      .then((r) => r.data),

  listCoachOperations: (limit?: number) =>
    apiClient
      .get<{ operations: HealthCoachOperation[] }>(`${BASE}/coach/operations`, {
        params: limit ? { limit } : undefined,
      })
      .then((r) => r.data),

  /**
   * ONE receipt, by operation id — what the coach did on the member's behalf.
   *
   * 404s rather than 403s for an id belonging to someone else: confirming that
   * an id exists on another account is the leak the whole Health domain avoids,
   * so the caller must treat "not found" as the only negative answer and never
   * report it as a permission problem.
   */
  getCoachOperation: (operationId: string) =>
    apiClient
      .get<{ operation: HealthCoachOperation }>(
        `${BASE}/coach/operations/${encodeURIComponent(operationId)}`
      )
      .then((r) => r.data),

  /* -- scanners -- */

  /** Nutrition label → reviewable draft. Persists nothing. */
  scanNutritionLabel: (images: HealthScanImage[]) =>
    apiClient
      .post<{ draft: HealthNutritionLabelDraft }>(
        `${BASE}/nutrition-label`,
        { images },
        { timeout: AI_TIMEOUT_MS }
      )
      .then((r) => r.data),

  /** Meal photo (or a kitchen-scale shot) → reviewable draft. Persists nothing. */
  analyzeMealPhoto: (images: HealthScanImage[]) =>
    apiClient
      .post<{ draft: HealthMealPhotoDraft }>(
        `${BASE}/meal-photo`,
        { images },
        { timeout: AI_TIMEOUT_MS }
      )
      .then((r) => r.data),

  /* -- body insight -- */

  /**
   * Produce and store one body insight from LOGGED MEASUREMENTS.
   *
   * Photos are out of scope by product decision, so every score and estimate on
   * the stored row is null and `facts` carries the deltas the summary is built
   * from — which is what the screen renders rather than the prose alone.
   */
  generateBodyInsight: (date: string) =>
    apiClient
      .post<HealthBodyInsightResult>(
        `${BASE}/body-insights/generate`,
        { date },
        { timeout: AI_TIMEOUT_MS }
      )
      .then((r) => r.data),
};

export default healthAiApi;
