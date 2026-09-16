import { and, asc, desc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import { fridgeItems, userFiles, widgetPreferences } from '../db/schema-health-p2';
import type { Env } from '../types';

import { HealthService } from './health-service';

/**
 * Symply Health parity phase P2 — the `assets` domain service: user files (R2),
 * widget preferences, and the smart fridge.
 *
 * Same contract as `HealthService` (the P1 port):
 *  - every row is scoped to the authenticated USER; there is no household read
 *    path and no cross-user path at all (BRD §7),
 *  - delete is always SOFT so the delta-sync cursor can carry the tombstone,
 *  - every derived figure is computed HERE, so phone / widget / watch agree.
 *
 * PRIVACY — the two rules this file exists to enforce:
 *
 *  1. `user_files.storage_key` is an R2 object key and NEVER leaves this
 *     service. It is not returned, and it is never turned into a public URL.
 *     Reads go through the proxied `content_path` below, which re-checks
 *     ownership on every request. That is why every file read here goes through
 *     `FILE_COLUMNS` — an explicit projection that omits `storage_key` and
 *     `thumbnail_key` — rather than `select()`. A leaked key on a `body_photo`
 *     is a privacy incident, not a cosmetic bug.
 *
 *  2. `body_photo` is the sensitive file class. It never appears on a glance /
 *     summary surface: `widgetSnapshot()` carries NO file data whatsoever, and
 *     no cycle or vitality data either (see the doc comment on that method).
 */

/* ------------------------------------------------------------------ */
/* Shared constants                                                    */
/* ------------------------------------------------------------------ */

export type HealthFileType = 'photo' | 'document' | 'body_photo';

/** Donor's cap (`routes/files.ts`): 50MB per object. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Donor's MIME allow-list, minus `avatar` — the platform owns avatars, and
 * `user_files.file_type` only admits these three (migration 0120 CHECK).
 */
export const ALLOWED_MIME_TYPES: Record<HealthFileType, readonly string[]> = {
  photo: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  document: ['application/pdf', 'text/plain', 'application/json'],
  body_photo: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
};

/** R2 prefix for this domain — disjoint from `household-photos/`, `space-images/`, … */
export const FILE_KEY_PREFIX = 'health-files';

export const FRIDGE_SOURCES = ['manual', 'scan', 'receipt', 'photo'] as const;
export type FridgeSource = (typeof FRIDGE_SOURCES)[number];

export const SMALL_WIDGET_METRICS = ['steps', 'calories', 'water'] as const;
export type SmallWidgetMetric = (typeof SMALL_WIDGET_METRICS)[number];
export const WIDGET_CHART_TYPES = ['bar', 'line'] as const;
export const WIDGET_CHART_METRICS = ['weight', 'nutrition', 'both'] as const;

/** Small-widget layout — added by migration 0144. */
export const SMALL_WIDGET_STYLES = ['standard', 'compact', 'minimal'] as const;
export type SmallWidgetStyle = (typeof SMALL_WIDGET_STYLES)[number];

/** Medium-widget layout — added by migration 0144. */
export const MEDIUM_WIDGET_LAYOUTS = ['standard', 'dual', 'grid'] as const;
export type MediumWidgetLayout = (typeof MEDIUM_WIDGET_LAYOUTS)[number];

/** Which of the four Medium-widget metrics a `dual`/`grid` slot can show. */
export const MEDIUM_WIDGET_METRICS = ['steps', 'calories', 'water', 'workout'] as const;
export type MediumWidgetMetric = (typeof MEDIUM_WIDGET_METRICS)[number];

export interface WidgetPreferenceValues {
  small_widget_metric: SmallWidgetMetric;
  chart_type: (typeof WIDGET_CHART_TYPES)[number];
  chart_metric: (typeof WIDGET_CHART_METRICS)[number];
  show_weight: boolean;
  show_nutrition: boolean;
  show_workouts: boolean;
  small_widget_style: SmallWidgetStyle;
  medium_widget_layout: MediumWidgetLayout;
  medium_primary_metric: MediumWidgetMetric;
  medium_secondary_metric: MediumWidgetMetric;
  medium_show_all_metrics: boolean;
}

/** Matches the column defaults of migrations 0120 + 0144 exactly. */
export const WIDGET_PREFERENCE_DEFAULTS: WidgetPreferenceValues = {
  small_widget_metric: 'steps',
  chart_type: 'bar',
  chart_metric: 'weight',
  show_weight: true,
  show_nutrition: true,
  show_workouts: true,
  small_widget_style: 'standard',
  medium_widget_layout: 'standard',
  medium_primary_metric: 'steps',
  medium_secondary_metric: 'calories',
  medium_show_all_metrics: true,
};

/* ------------------------------------------------------------------ */
/* Pure helpers — exported for unit tests                              */
/* ------------------------------------------------------------------ */

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strip a file name down to something safe to echo back in a
 * `Content-Disposition` header and to embed in an R2 key.
 *
 * Load-bearing: the name is client-supplied and is rendered into a response
 * header by the content proxy — a raw `"` or newline would be header injection.
 * Mirrors `AihousekeeperAttachmentService.createUploadRecord`.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\-() ]+/g, '_').slice(0, 255);
  return cleaned.trim() === '' ? 'file' : cleaned;
}

/** `health-files/<user>/<file>.<ext>` — an R2 key, never a URL. */
export function storageKeyFor(userId: string, fileId: string, fileName: string): string {
  const parts = fileName.split('.');
  const ext = parts.length > 1 ? parts.pop() ?? '' : '';
  const safeExt = ext.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toLowerCase();
  return `${FILE_KEY_PREFIX}/${userId}/${fileId}${safeExt ? `.${safeExt}` : ''}`;
}

/** The proxied, ownership-checked read/write path for a file's bytes. */
export function contentPathFor(fileId: string): string {
  return `/health/files/${fileId}/content`;
}

/**
 * Normalise an expiry to a DATE-ONLY `YYYY-MM-DD`, or null when unparseable.
 *
 * The donor stored `expiry_date` as a unix epoch INTEGER; migration 0120
 * normalised the column to ISO TEXT so ONE sync cursor can span the domain.
 * We narrow one step further and keep only the day: expiry is a day-grained
 * fact, and `?expiring_within_days=` compares TEXT lexicographically — mixing
 * `2026-06-01` with `2026-06-01T09:00:00Z` in the same column would put the
 * timestamped row on the WRONG side of a `<= '2026-06-01'` cutoff.
 */
export function normalizeExpiryDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (DATE_ONLY.test(trimmed)) {
    const ts = Date.parse(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(ts)) return null;
    // V8 ROLLS an out-of-range day OVER rather than failing — `2026-02-30`
    // parses happily as 2 March. Only a round-trip catches that, and without it
    // an impossible date would be stored verbatim and then sort wrongly.
    return new Date(ts).toISOString().slice(0, 10) === trimmed ? trimmed : null;
  }
  const ts = Date.parse(trimmed);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

/** Inclusive upper bound for `?expiring_within_days=` — `today + days`. */
export function expiryCutoff(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Which metric the small widget shows.
 *
 * `small_widget_metric` is an explicit choice, but the `show_*` toggles say
 * what the widget may display at all — so a hidden domain must not sneak back
 * in through the small slot. `steps` is the fallback because it has no toggle.
 */
export function resolveSmallMetric(prefs: WidgetPreferenceValues): SmallWidgetMetric {
  if (prefs.small_widget_metric === 'calories' && !prefs.show_nutrition) return 'steps';
  return prefs.small_widget_metric;
}

function safeJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Row shapes                                                          */
/* ------------------------------------------------------------------ */

/**
 * The ONLY columns of `user_files` that ever reach a response body.
 *
 * `storage_key` and `thumbnail_key` are deliberately absent — see the privacy
 * note at the top of this file. Adding either here is a privacy regression and
 * `health-assets.test.ts` fails on it.
 */
const FILE_COLUMNS = {
  id: userFiles.id,
  file_name: userFiles.file_name,
  file_type: userFiles.file_type,
  mime_type: userFiles.mime_type,
  file_size: userFiles.file_size,
  category: userFiles.category,
  metadata: userFiles.metadata,
  created_at: userFiles.created_at,
  updated_at: userFiles.updated_at,
} as const;

export interface HealthFileMetadata {
  id: string;
  file_name: string;
  file_type: string;
  mime_type: string;
  file_size: number;
  category: string | null;
  /** Stored JSON TEXT, returned verbatim (P1 convention — cf. `health_entries.data`). */
  metadata: string | null;
  created_at: string;
  updated_at: string;
  /** Proxied, auth-checked byte path. NOT a public URL and NOT the R2 key. */
  content_path: string;
}

/**
 * Project ANY row shape down to the public file metadata.
 *
 * Field-by-field on purpose — NOT `{ ...row }`. TypeScript's structural typing
 * happily accepts a wider object than the parameter type when it arrives in a
 * variable, so a spread would silently republish `storage_key` for callers that
 * pass the full insert row. That exact leak shipped once and is pinned by
 * "omits storage_key from every file-shaped response" in health-assets.test.ts.
 */
function toFileMetadata(row: {
  id: string;
  file_name: string;
  file_type: string;
  mime_type: string;
  file_size: number;
  category: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}): HealthFileMetadata {
  return {
    id: row.id,
    file_name: row.file_name,
    file_type: row.file_type,
    mime_type: row.mime_type,
    file_size: row.file_size,
    category: row.category,
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
    content_path: contentPathFor(row.id),
  };
}

export interface CreateFileInput {
  file_name: string;
  file_type: HealthFileType;
  mime_type: string;
  file_size: number;
  category?: string;
  metadata?: Record<string, unknown>;
}

export interface FridgeItemInput {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  category?: string | null;
  expiry_date?: string | null;
  is_favorite?: boolean;
  nutrition_json?: Record<string, unknown> | string | null;
  source?: FridgeSource;
  image_url?: string | null;
  notes?: string | null;
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export class HealthAssetsService {
  private db: DrizzleD1Database;
  private d1: D1Database;
  private env: Env;

  constructor(env: Env, d1: D1Database) {
    this.env = env;
    this.d1 = d1;
    this.db = drizzle(d1);
  }

  /* ---------------------------------------------------------------- */
  /* Files                                                             */
  /* ---------------------------------------------------------------- */

  async listFiles(
    userId: string,
    opts: { file_type?: HealthFileType; limit?: number } = {}
  ): Promise<HealthFileMetadata[]> {
    const conds = [eq(userFiles.user_id, userId), isNull(userFiles.deleted_at)];
    if (opts.file_type) conds.push(eq(userFiles.file_type, opts.file_type));
    const rows = await this.db
      .select(FILE_COLUMNS)
      .from(userFiles)
      .where(and(...conds))
      .orderBy(desc(userFiles.created_at))
      .limit(opts.limit ?? 200)
      .all();
    return rows.map(toFileMetadata);
  }

  async getFile(userId: string, id: string): Promise<HealthFileMetadata | null> {
    const row = await this.db
      .select(FILE_COLUMNS)
      .from(userFiles)
      .where(and(eq(userFiles.id, id), eq(userFiles.user_id, userId), isNull(userFiles.deleted_at)))
      .get();
    return row ? toFileMetadata(row) : null;
  }

  /**
   * Reserve a file and hand back where to PUT the bytes.
   *
   * R2 bindings have no S3-style presigned PUT, so — exactly like the household
   * photo contract (`POST /households/:id/photo/upload-url`) — `upload_url` is
   * null and the client PUTs to the returned Worker path with its own bearer
   * token. That keeps the R2 key server-side, which is the whole point.
   *
   * `user_files` has no `status` column (schema is fixed), so the row IS the
   * reservation: `file_size` starts as the client's DECLARED size and is
   * corrected to the true byte length when the upload lands.
   */
  async createFileUpload(userId: string, input: CreateFileInput) {
    const id = newId('f');
    const safeName = sanitizeFileName(input.file_name);
    const ts = nowIso();
    const row = {
      id,
      user_id: userId,
      file_name: safeName,
      file_type: input.file_type,
      mime_type: input.mime_type,
      file_size: input.file_size,
      storage_key: storageKeyFor(userId, id, safeName),
      thumbnail_key: null,
      category: input.category ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(userFiles).values(row).run();

    return {
      file: toFileMetadata(row),
      upload: {
        upload_url: null as null,
        method: 'PUT' as const,
        path: contentPathFor(id),
        max_size_bytes: MAX_FILE_BYTES,
      },
    };
  }

  /**
   * Internal ONLY — the single place `storage_key` is read. Callers must not
   * put the returned key into a response body.
   */
  private async getFileRow(userId: string, id: string) {
    return (
      (await this.db
        .select()
        .from(userFiles)
        .where(
          and(eq(userFiles.id, id), eq(userFiles.user_id, userId), isNull(userFiles.deleted_at))
        )
        .get()) ?? null
    );
  }

  /**
   * Store the bytes for a reserved file and correct the recorded size.
   *
   * The R2 object's content type comes from the row's VALIDATED `mime_type`,
   * never from the request header: a client could otherwise declare
   * `image/png` at reservation time and push `text/html` here, which the
   * content proxy would then serve back on our origin.
   *
   * Idempotent — re-PUTting the same id overwrites, so a retry after a dropped
   * connection is safe.
   */
  async putFileContent(
    userId: string,
    id: string,
    body: ArrayBuffer
  ): Promise<HealthFileMetadata | null> {
    const row = await this.getFileRow(userId, id);
    if (!row) return null;
    await this.env.REPORTS_BUCKET.put(row.storage_key, body, {
      httpMetadata: { contentType: row.mime_type },
      customMetadata: { userId, fileId: id, fileType: row.file_type },
    });
    const ts = nowIso();
    await this.db
      .update(userFiles)
      .set({ file_size: body.byteLength, updated_at: ts })
      .where(eq(userFiles.id, id))
      .run();
    return toFileMetadata({
      id: row.id,
      file_name: row.file_name,
      file_type: row.file_type,
      mime_type: row.mime_type,
      file_size: body.byteLength,
      category: row.category,
      metadata: row.metadata,
      created_at: row.created_at,
      updated_at: ts,
    });
  }

  /**
   * Read the bytes back. Returns null when the file is unknown, soft-deleted or
   * owned by somebody else — the caller must not distinguish those cases.
   */
  async getFileContent(
    userId: string,
    id: string
  ): Promise<{ object: R2ObjectBody; file: { file_name: string; file_type: string; mime_type: string } } | null> {
    const row = await this.getFileRow(userId, id);
    if (!row) return null;
    const object = await this.env.REPORTS_BUCKET.get(row.storage_key);
    if (!object) return null;
    return {
      object,
      file: { file_name: row.file_name, file_type: row.file_type, mime_type: row.mime_type },
    };
  }

  /**
   * Soft-delete the metadata row AND drop the R2 object.
   *
   * The row is a tombstone (sync cursor), but the BYTES really go: "delete this
   * body photo" has to mean the pixels are gone, not merely unlinked. Nothing
   * can reach the object afterwards anyway — the key only ever existed here.
   */
  async deleteFile(userId: string, id: string): Promise<boolean> {
    const row = await this.getFileRow(userId, id);
    if (!row) return false;
    try {
      await this.env.REPORTS_BUCKET.delete(row.storage_key);
      if (row.thumbnail_key) await this.env.REPORTS_BUCKET.delete(row.thumbnail_key);
    } catch (err) {
      // A missing object must not block the tombstone.
      console.warn('[health-assets] R2 delete failed', { id, error: (err as Error).message });
    }
    const ts = nowIso();
    await this.db
      .update(userFiles)
      .set({ deleted_at: ts, updated_at: ts })
      .where(eq(userFiles.id, id))
      .run();
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Widget preferences                                                */
  /* ---------------------------------------------------------------- */

  /** Never 404s — an account with no row reads the column defaults. */
  async getWidgetPreferences(userId: string): Promise<WidgetPreferenceValues> {
    const row = await this.db
      .select()
      .from(widgetPreferences)
      .where(eq(widgetPreferences.user_id, userId))
      .get();
    if (!row) return { ...WIDGET_PREFERENCE_DEFAULTS };
    return {
      small_widget_metric: row.small_widget_metric as SmallWidgetMetric,
      chart_type: row.chart_type as WidgetPreferenceValues['chart_type'],
      chart_metric: row.chart_metric as WidgetPreferenceValues['chart_metric'],
      show_weight: row.show_weight,
      show_nutrition: row.show_nutrition,
      show_workouts: row.show_workouts,
      small_widget_style: row.small_widget_style as SmallWidgetStyle,
      medium_widget_layout: row.medium_widget_layout as MediumWidgetLayout,
      medium_primary_metric: row.medium_primary_metric as MediumWidgetMetric,
      medium_secondary_metric: row.medium_secondary_metric as MediumWidgetMetric,
      medium_show_all_metrics: row.medium_show_all_metrics,
    };
  }

  /**
   * PATCH-merge upsert keyed on the UNIQUE `user_id`.
   *
   * Merge rather than replace: the donor's PUT reset every omitted field to its
   * default, so an older client that only knew three keys silently wiped the
   * rest. Absent keys keep their stored value here.
   */
  async saveWidgetPreferences(
    userId: string,
    patch: Partial<WidgetPreferenceValues>
  ): Promise<WidgetPreferenceValues> {
    const current = await this.getWidgetPreferences(userId);
    const next: WidgetPreferenceValues = { ...current, ...patch };
    const ts = nowIso();
    await this.db
      .insert(widgetPreferences)
      .values({ id: newId('wp'), user_id: userId, ...next, created_at: ts, updated_at: ts })
      .onConflictDoUpdate({
        target: widgetPreferences.user_id,
        set: { ...next, updated_at: ts },
      })
      .run();
    return next;
  }

  /**
   * The compact payload the iOS Widget and the Watch read.
   *
   * It is a SUMMARY derived from the P1 tracking data through `HealthService`,
   * so the phone, the widget and the watch can never disagree about a figure.
   *
   * WHAT IS NOT IN IT, and must never be:
   *  - files of any kind, and `body_photo` above all — a widget renders on a
   *    LOCKED screen, so anything here is visible without unlocking the device,
   *  - cycle / period / symptom data,
   *  - men's-health (vitality) data.
   *
   * Steps, water, weight (+ its weekly trend), nutrition (+ its weekly trend)
   * and workout counts appear, and the last three obey their `show_*` toggle —
   * `weight_trend` follows `show_weight`, `nutrition_trend` follows
   * `show_nutrition`, same as their non-trend siblings. `health-assets-widget.
   * test.ts` pins each field's shape so a future addition can't quietly widen
   * what a hidden toggle still leaks.
   */
  async widgetSnapshot(userId: string, date: string) {
    const health = new HealthService(this.d1);
    const [prefs, summary, workoutRows, goal, trend] = await Promise.all([
      this.getWidgetPreferences(userId),
      health.dailySummary(userId, date),
      health.listHealthEntries(userId, { type: 'workout', from: date, to: date, limit: 100 }),
      health.goalFor(userId, date),
      health.weeklyTrend(userId, date),
    ]);

    let workoutMinutes = 0;
    let workoutCalories = 0;
    for (const row of workoutRows) {
      const data = safeJsonObject(row.data);
      if (typeof data?.minutes === 'number') workoutMinutes += data.minutes;
      if (typeof data?.calories === 'number') workoutCalories += data.calories;
    }

    const metric = resolveSmallMetric(prefs);
    const small =
      metric === 'water'
        ? { metric, value: summary.water.total_ml, goal: summary.water.goal_ml }
        : metric === 'calories'
          ? {
              metric,
              value: summary.nutrition.totals.calories,
              goal: summary.nutrition.goal?.calories ?? null,
            }
          : { metric, value: summary.steps.value, goal: summary.steps.goal };

    // Current weight vs the stored starting point (`healthGoals.starting_weight_kg`
    // / `starting_weight_date`, set from the Weight tab's own "starting weight"
    // field) — same figure the donor's widget calls "From Start".
    const currentWeight = summary.weight?.value ?? null;
    const startingWeightKg = goal?.starting_weight_kg ?? null;
    const progressFromStart =
      currentWeight !== null && startingWeightKg !== null && startingWeightKg > 0
        ? Math.round((currentWeight - startingWeightKg) * 10) / 10
        : null;

    return {
      date,
      generated_at: nowIso(),
      preferences: prefs,
      // Steps and water have no toggle — they are the always-on glance metrics.
      small,
      steps: summary.steps,
      water: { total_ml: summary.water.total_ml, goal_ml: summary.water.goal_ml },
      weight: prefs.show_weight ? summary.weight : null,
      weight_trend: prefs.show_weight
        ? {
            unit: summary.weight?.unit ?? 'kg',
            // Logged days only — a week is rarely weighed in daily, and
            // zero-filling would drag a line chart toward 0.
            entries: trend.this_week.daily_weight.filter(
              (d): d is { date: string; weight: number } => d.weight !== null
            ),
            avg_this_week: trend.this_week.avg_weight,
            avg_last_week: trend.last_week.avg_weight,
            starting_weight_kg: startingWeightKg,
            starting_weight_date: goal?.starting_weight_date ?? null,
            progress_from_start: progressFromStart,
            progress_percentage:
              progressFromStart !== null && startingWeightKg !== null && startingWeightKg > 0
                ? Math.round((progressFromStart / startingWeightKg) * 1000) / 10
                : null,
          }
        : null,
      nutrition: prefs.show_nutrition
        ? {
            calories: summary.nutrition.totals.calories,
            proteins: summary.nutrition.totals.proteins,
            carbohydrates: summary.nutrition.totals.carbohydrates,
            fats: summary.nutrition.totals.fats,
            goal_calories: summary.nutrition.goal?.calories ?? null,
            protein_target: summary.nutrition.goal?.proteins ?? null,
            carbs_target: summary.nutrition.goal?.carbohydrates ?? null,
            fats_target: summary.nutrition.goal?.fats ?? null,
          }
        : null,
      // Calorie days are zero-filled (unlike weight) — a nutrition week without
      // a fast day genuinely had a 0-calorie day, and the donor's bar chart
      // expects all 7 days present.
      nutrition_trend: prefs.show_nutrition
        ? {
            entries: trend.this_week.days.map((d) => ({ date: d.date, calories: d.calories })),
            avg_this_week: trend.this_week.avg_calories,
            avg_last_week: trend.last_week.avg_calories,
          }
        : null,
      workouts: prefs.show_workouts
        ? {
            count: workoutRows.length,
            minutes: workoutMinutes,
            calories: workoutCalories,
            goal_minutes: goal?.daily_workout_minutes ?? null,
          }
        : null,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Fridge                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * `expiring_within_days = N` → everything dated on or before `today + N`.
   *
   * Deliberately INCLUSIVE of the past: an item that expired yesterday is the
   * most urgent thing in the fridge, so a "what needs eating" surface that hid
   * it would be worse than useless. Items with NO expiry are excluded — an
   * undated item can never be "expiring" — and they still come back on the
   * unfiltered list.
   */
  async listFridge(
    userId: string,
    opts: { expiring_within_days?: number; today?: string } = {}
  ) {
    const conds = [eq(fridgeItems.user_id, userId), isNull(fridgeItems.deleted_at)];
    if (opts.expiring_within_days !== undefined) {
      const today = opts.today ?? nowIso().slice(0, 10);
      conds.push(isNotNull(fridgeItems.expiry_date));
      conds.push(lte(fridgeItems.expiry_date, expiryCutoff(today, opts.expiring_within_days)));
      return this.db
        .select()
        .from(fridgeItems)
        .where(and(...conds))
        .orderBy(asc(fridgeItems.expiry_date))
        .all();
    }
    return this.db
      .select()
      .from(fridgeItems)
      .where(and(...conds))
      .orderBy(desc(fridgeItems.created_at))
      .all();
  }

  async createFridgeItem(userId: string, input: FridgeItemInput) {
    const ts = nowIso();
    const row = {
      id: newId('fr'),
      user_id: userId,
      name: input.name.trim(),
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
      category: input.category ?? null,
      expiry_date: normalizeExpiryDate(input.expiry_date),
      is_favorite: input.is_favorite ?? false,
      nutrition_json: serializeNutrition(input.nutrition_json),
      source: input.source ?? 'manual',
      image_url: input.image_url ?? null,
      notes: input.notes ?? null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(fridgeItems).values(row).run();
    return row;
  }

  async updateFridgeItem(userId: string, id: string, patch: Partial<FridgeItemInput>) {
    const existing = await this.db
      .select()
      .from(fridgeItems)
      .where(
        and(eq(fridgeItems.id, id), eq(fridgeItems.user_id, userId), isNull(fridgeItems.deleted_at))
      )
      .get();
    if (!existing) return null;

    // Only keys the caller actually sent are applied — `undefined` means "leave
    // alone", `null` means "clear" (both reach here as distinct values).
    const next = { ...existing, updated_at: nowIso() };
    if (patch.name !== undefined) next.name = patch.name.trim();
    if (patch.quantity !== undefined) next.quantity = patch.quantity;
    if (patch.unit !== undefined) next.unit = patch.unit;
    if (patch.category !== undefined) next.category = patch.category;
    if (patch.expiry_date !== undefined) next.expiry_date = normalizeExpiryDate(patch.expiry_date);
    if (patch.is_favorite !== undefined) next.is_favorite = patch.is_favorite;
    if (patch.nutrition_json !== undefined) {
      next.nutrition_json = serializeNutrition(patch.nutrition_json);
    }
    if (patch.source !== undefined) next.source = patch.source;
    if (patch.image_url !== undefined) next.image_url = patch.image_url;
    if (patch.notes !== undefined) next.notes = patch.notes;

    await this.db.update(fridgeItems).set(next).where(eq(fridgeItems.id, id)).run();
    return next;
  }

  async deleteFridgeItem(userId: string, id: string): Promise<boolean> {
    const ts = nowIso();
    const res = await this.db
      .update(fridgeItems)
      .set({ deleted_at: ts, updated_at: ts })
      .where(
        and(eq(fridgeItems.id, id), eq(fridgeItems.user_id, userId), isNull(fridgeItems.deleted_at))
      )
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }
}

/** Nutrition rides the row as JSON TEXT (P1 convention — cf. `health_entries.data`). */
function serializeNutrition(value: FridgeItemInput['nutrition_json']): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}
