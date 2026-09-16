import { apiClient } from './client';
import { AI_TIMEOUT_MS, type HealthScanImage } from './healthAi';

/**
 * Symply Health FRIDGE API client — the donor's "Smart Fridge" (parity P2, P5).
 *
 * Base path: `/health/fridge` on the `symply-health-api` Worker, served by
 * `backend/src/routes/health-assets.ts`. Every row is scoped to the
 * authenticated USER (food stock is personal, never household-shared) and the
 * whole surface 404s on any other brand's Worker via `requireHealthApi()`.
 *
 * NOTE — envelope shape. These call `apiClient` DIRECTLY rather than the
 * `api.get/post` helpers in `client.ts`. Those helpers type the body as
 * `ApiResponse<T>` (`{ data: T }`), but this Worker returns the payload BARE —
 * `c.json({ items })` — with no wrapping middleware. Going through the helper
 * makes every read resolve `undefined` against the live server while unit tests
 * pass, because the fixtures wrap the same way the type claims. The body IS the
 * payload; `src/api/__tests__/healthEnvelope.test.ts` pins that at source level.
 *
 * TWO DEPLOYED SEMANTICS THE UI MUST NOT HIDE (see `HealthAssetsService.listFridge`):
 *
 *  1. `expiring_within_days=N` is **inclusive of the past**. It selects
 *     everything dated on or before `today + N`, so something that expired
 *     yesterday comes back as the MOST urgent row rather than being filtered
 *     out. A "what needs eating" surface that dropped expired stock would be
 *     worse than useless.
 *  2. It **excludes undated items** entirely (`expiry_date IS NOT NULL`). An
 *     item with no date can never be "expiring", so it only ever appears on the
 *     unfiltered list.
 *
 * Envelopes mirror `backend/src/routes/health-assets.ts` EXACTLY — change both
 * together.
 *
 * ── P5: THE THREE CAPABILITIES THE FRIDGE USED TO SAY IT DID NOT HAVE ───────
 *
 * Barcode lookup, receipt reading and meal ideas were the donor Fridge features
 * with no route on this Worker. All three now have one:
 *
 *  - `lookupBarcode` → `GET /health/foods/barcode` (the FatSecret chokepoint;
 *    NOT a model call, and it degrades to `not_configured` exactly like search
 *    does, because the FatSecret credentials are not set on any deploy yet).
 *  - `scanFridgeReceipt` → `POST /health/ai/fridge-receipt`
 *  - `fridgeMealIdeas`  → `POST /health/ai/fridge-meals`
 *
 * The two AI paths carry `timeout: AI_TIMEOUT_MS` (120 s). The axios default of
 * 30 s surfaces to the member as a failed scan on a photo the model was still
 * reading — the same reason `healthAi.ts` exports that constant, which is
 * imported here rather than redeclared.
 *
 * The `/ai/` in those paths is load-bearing on the SERVER, not decorative: it is
 * what puts them behind the Health AI rate limiter registered in
 * `backend/src/index.ts`. Do not "tidy" them to `/health/fridge/…`.
 */

/* ============================ Row shapes ============================ */

/** How the row got into the fridge. `scan`/`receipt`/`photo` are donor sources. */
export type HealthFridgeSource = 'manual' | 'scan' | 'receipt' | 'photo';

export interface HealthFridgeItem {
  id: string;
  user_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  /** DATE-ONLY `YYYY-MM-DD`, normalised server-side, or null when undated. */
  expiry_date: string | null;
  is_favorite: boolean;
  /** Stored JSON TEXT, returned verbatim (P1 convention — cf. `health_entries.data`). */
  nutrition_json: string | null;
  source: HealthFridgeSource | string;
  image_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Create/update body. Every optional key is tri-state on the PUT: absent =
 * "leave alone", `null` = "clear", a value = "set" — the service distinguishes
 * all three, so a partial edit must omit what it does not touch.
 */
export interface HealthFridgeItemPayload {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  category?: string | null;
  expiry_date?: string | null;
  is_favorite?: boolean;
  nutrition_json?: Record<string, unknown> | string | null;
  source?: HealthFridgeSource;
  image_url?: string | null;
  notes?: string | null;
}

/* ======================= Barcode (FatSecret) ========================= */

/**
 * Why this mirrors `/foods/search`'s vocabulary rather than inventing its own:
 * both are the SAME provider chokepoint, and a screen that has learned to render
 * `not_configured` once should not learn a second dialect for the same fact.
 *
 * `not_configured` is the state this ships in — no FatSecret credential is set
 * on any Health deploy — so the barcode surface has to read as switched off,
 * never as broken.
 */
export type HealthFoodProviderStatus =
  | 'ok'
  | 'not_configured'
  | 'rate_limited'
  | 'unavailable'
  | 'skipped';

/** One of the provider's declared servings. `is_metric` false ⇒ `unit: 'serving'`. */
export interface HealthExternalServing {
  serving_id: string;
  description: string;
  portion: number;
  unit: string;
  is_metric: boolean;
  calories: number;
  proteins: number;
  carbohydrates: number;
  fats: number;
  base_calories_per_100: number;
  base_proteins_per_100: number;
  base_carbs_per_100: number;
  base_fats_per_100: number;
}

/** A provider food. Top-level figures are the PREFERRED serving's. */
export interface HealthExternalFood {
  id: string;
  provider: string;
  provider_food_id: string;
  name: string;
  brand_name: string | null;
  portion: number;
  unit: string;
  serving_id: string | null;
  serving_description: string | null;
  calories: number;
  proteins: number;
  carbohydrates: number;
  fats: number;
  base_calories_per_100: number;
  base_proteins_per_100: number;
  base_carbs_per_100: number;
  base_fats_per_100: number;
  servings: HealthExternalServing[];
}

export interface HealthBarcodeLookup {
  /**
   * The GTIN-13 the Worker actually SENT — a 12-digit UPC-A is padded to 13
   * before the provider sees it. Echoed so a screen can explain the leading 0
   * rather than looking as though it mangled the code.
   */
  barcode: string;
  /** `null` with `status: 'ok'` means "the database does not know that code". */
  food: HealthExternalFood | null;
  provider: { id: string; configured: boolean; status: HealthFoodProviderStatus };
}

/* ==================== Receipt → fridge drafts (AI) ==================== */

export interface HealthFridgeReceiptItem {
  name: string;
  /** One of the ten fridge categories, or null when none fitted. */
  category: string | null;
  /**
   * TYPICAL shelf life for that category, in days — a published server-side
   * table, NOT something read off the receipt and NOT a model guess. A receipt
   * never prints an expiry date, so the review screen offers this as a one-tap
   * fill and labels it as typical.
   */
  suggested_expiry_days: number | null;
  /** Pre-tax price paid for the line, in cents, so the row can be checked. */
  amount_cents: number | null;
  /**
   * False when the line does not look like food. The receipt reader reads the
   * WHOLE receipt (it is Budget's); those lines come back FLAGGED rather than
   * dropped, so a missing item never looks like a misread.
   */
  looks_like_food: boolean;
}

export interface HealthFridgeReceiptDraft {
  vendor: string | null;
  /** Purchase date, `YYYY-MM-DD`. NOT an expiry date. */
  purchase_date: string | null;
  items: HealthFridgeReceiptItem[];
}

/* ========================= Meal ideas (AI) =========================== */

export interface HealthFridgeMeal {
  name: string;
  description: string | null;
  /** Guaranteed to be names that are actually in the fridge — server-filtered. */
  ingredients_used: string[];
  missing_ingredients: string[];
  /** Per-serving ESTIMATES. `null` means "could not judge", never zero. */
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  instructions: string[];
  /** The subset of `ingredients_used` that is expired or expiring within 3 days. */
  uses_expiring: string[];
  prep_minutes: number | null;
}

export interface HealthFridgeMealPlan {
  meals: HealthFridgeMeal[];
  /** Plain sentence when nothing could be built. Present on an empty `meals`. */
  notes: string | null;
  /** The fridge names actually offered to the model, so the screen can say so. */
  considered: string[];
}

/* ============================== Client =============================== */

const BASE = '/health';

export const healthFridgeApi = {
  /**
   * The whole fridge (newest first), or — with `expiring_within_days` — only
   * DATED items on or before `today + days`, oldest expiry first.
   *
   * `today` is the CLIENT's own local day. The Worker has no user timezone, so
   * letting it default to UTC would put the cutoff on the wrong day for anyone
   * east or west of Greenwich.
   */
  listFridge: (params?: { expiring_within_days?: number; today?: string }) =>
    apiClient
      .get<{ items: HealthFridgeItem[] }>(`${BASE}/fridge`, { params })
      .then((r) => r.data),

  createFridgeItem: (body: HealthFridgeItemPayload) =>
    apiClient.post<{ item: HealthFridgeItem }>(`${BASE}/fridge`, body).then((r) => r.data),

  updateFridgeItem: (id: string, body: Partial<HealthFridgeItemPayload>) =>
    apiClient.put<{ item: HealthFridgeItem }>(`${BASE}/fridge/${id}`, body).then((r) => r.data),

  /** Soft delete — the tombstone is what lets another device drop its copy. */
  deleteFridgeItem: (id: string) =>
    apiClient.delete<{ deleted: boolean }>(`${BASE}/fridge/${id}`).then((r) => r.data),

  /**
   * A packaged food, by the barcode printed on it.
   *
   * Answers 200 for every provider outcome — a missing credential, a rate limit
   * and an outage are all `provider.status`, not HTTP failures — so the ONLY
   * throw here is a 400 on a code with no digits in it. Callers read the status,
   * never a message.
   *
   * `code` is sent as typed; the Worker owns the GTIN-13 padding, so the device
   * never has to know that a 12-digit UPC needs a leading zero.
   */
  lookupBarcode: (code: string) =>
    apiClient
      .get<HealthBarcodeLookup>(`${BASE}/foods/barcode`, { params: { code } })
      .then((r) => r.data),

  /**
   * A photographed shopping receipt → reviewable fridge drafts. Persists nothing.
   *
   * Several images are ONE long receipt read in order, not several receipts —
   * the same contract the Budget scanner keeps, because it is the same reader.
   */
  scanFridgeReceipt: (images: HealthScanImage[]) =>
    apiClient
      .post<{ draft: HealthFridgeReceiptDraft }>(
        `${BASE}/ai/fridge-receipt`,
        { images },
        { timeout: AI_TIMEOUT_MS }
      )
      .then((r) => r.data),

  /**
   * Meal ideas from what is in the fridge right now.
   *
   * NO INVENTORY IS SENT. The Worker reads the fridge itself, so the answer is
   * about the person's real stock rather than about whatever this screen last
   * cached. `today` is the device's own local day — "expires today" is a
   * statement about the user's calendar, not about UTC.
   */
  fridgeMealIdeas: (body: { today: string; goal?: string; restrictions?: string | null }) =>
    apiClient
      .post<{ plan: HealthFridgeMealPlan }>(`${BASE}/ai/fridge-meals`, body, {
        timeout: AI_TIMEOUT_MS,
      })
      .then((r) => r.data),
};

export default healthFridgeApi;
