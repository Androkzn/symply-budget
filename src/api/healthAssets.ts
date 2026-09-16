import { ENV } from '@config/env';
import { useAuthStore } from '@stores/authStore';

import { apiClient } from './client';

/**
 * Symply Health ASSETS API client — user files (R2) and widget preferences.
 *
 * Base path: `/health` on the `symply-health-api` Worker, served by
 * `backend/src/routes/health-assets.ts`. The fridge half of that router already
 * had a client (`src/api/healthFridge.ts`); the FILE and WIDGET halves had none
 * at all, so six deployed handlers and three widget routes had zero callers.
 *
 * NOTE — envelope shape. These call `apiClient` DIRECTLY rather than the
 * `api.get/post` helpers in `client.ts`. Those helpers type the body as
 * `ApiResponse<T>` (`{ data: T }`), but this Worker returns the payload BARE —
 * `c.json({ files })` — with no wrapping middleware. Going through the helper
 * makes every read resolve `undefined` against the live server while unit tests
 * pass, because the fixtures wrap the same way the type claims. The body IS the
 * payload; `src/api/__tests__/healthEnvelope.test.ts` pins that at source level.
 *
 * ## THE UPLOAD CONTRACT (the part that is easy to get wrong)
 *
 * `POST /health/files` RESERVES a row and hands back `upload.path` — a RELATIVE
 * Worker path (`/health/files/<id>/content`), and `upload_url: null`. R2
 * bindings have no S3-style presigned PUT, so there is no public URL to push to:
 * the bytes go to OUR OWN authenticated route.
 *
 * That is exactly why {@link healthAssetsApi.uploadFileBytes} goes through
 * `apiClient` and not a bare `XMLHttpRequest`. A raw XHR against a relative path
 * has no `baseURL` and no bearer token, so it never reaches the Worker and the
 * upload fails silently — the same defect that shipped once in the chat image
 * uploader (`src/features/chat/createChatApi.ts` carries the same warning).
 *
 * ## PRIVACY
 *
 * The service never publishes `storage_key`, and there is no public URL for a
 * file. `content_path` is a PROXIED path that re-checks ownership on every
 * request, so reading bytes always needs the session token — see
 * {@link healthFileContentSource} for the `<Image>` form of that.
 *
 * Envelopes mirror `backend/src/routes/health-assets.ts` EXACTLY — change both
 * together.
 */

/* ============================ Files ============================ */

/** `body_photo` is the sensitive class — it never reaches a glance surface. */
export type HealthFileType = 'photo' | 'document' | 'body_photo';

/** Donor cap, mirrored from `MAX_FILE_BYTES` in `health-assets-service.ts`. */
export const HEALTH_FILE_MAX_BYTES = 50 * 1024 * 1024;

/**
 * The server's allow-list, per file type (`ALLOWED_MIME_TYPES`). A `POST` with
 * anything else is a 400, so the picker filters against this rather than letting
 * the member choose a file that can only be refused.
 */
export const HEALTH_FILE_MIME_TYPES: Record<HealthFileType, readonly string[]> = {
  photo: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  document: ['application/pdf', 'text/plain', 'application/json'],
  body_photo: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
};

export interface HealthFile {
  id: string;
  file_name: string;
  file_type: HealthFileType | string;
  mime_type: string;
  file_size: number;
  category: string | null;
  /** Stored JSON TEXT, returned verbatim (P1 convention — cf. `health_entries.data`). */
  metadata: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Proxied, ownership-checked byte path (`/health/files/<id>/content`).
   * NOT a public URL and NOT the R2 key — it needs the session bearer token.
   */
  content_path: string;
}

export interface HealthFileReservation {
  file: HealthFile;
  upload: {
    /** Always null — R2 bindings cannot presign, so the bytes come to us. */
    upload_url: string | null;
    method: 'PUT';
    /** Relative Worker path to PUT to. Feed it to `uploadFileBytes`. */
    path: string;
    max_size_bytes: number;
  };
}

export interface CreateHealthFileInput {
  file_name: string;
  file_type: HealthFileType;
  mime_type: string;
  /** DECLARED size; the Worker corrects it to the true byte length on upload. */
  file_size: number;
  category?: string;
  metadata?: Record<string, unknown>;
}

/* ========================= Widget ========================== */

export const HEALTH_SMALL_WIDGET_METRICS = ['steps', 'calories', 'water'] as const;
export type HealthSmallWidgetMetric = (typeof HEALTH_SMALL_WIDGET_METRICS)[number];

export const HEALTH_WIDGET_CHART_TYPES = ['bar', 'line'] as const;
export type HealthWidgetChartType = (typeof HEALTH_WIDGET_CHART_TYPES)[number];

export const HEALTH_WIDGET_CHART_METRICS = ['weight', 'nutrition', 'both'] as const;
export type HealthWidgetChartMetric = (typeof HEALTH_WIDGET_CHART_METRICS)[number];

/** Small-widget layout — added by migration 0144. */
export const HEALTH_SMALL_WIDGET_STYLES = ['standard', 'compact', 'minimal'] as const;
export type HealthSmallWidgetStyle = (typeof HEALTH_SMALL_WIDGET_STYLES)[number];

/** Medium-widget layout — added by migration 0144. */
export const HEALTH_MEDIUM_WIDGET_LAYOUTS = ['standard', 'dual', 'grid'] as const;
export type HealthMediumWidgetLayout = (typeof HEALTH_MEDIUM_WIDGET_LAYOUTS)[number];

/** Which of the four Medium-widget metrics a `dual`/`grid` slot can show. */
export const HEALTH_MEDIUM_WIDGET_METRICS = ['steps', 'calories', 'water', 'workout'] as const;
export type HealthMediumWidgetMetric = (typeof HEALTH_MEDIUM_WIDGET_METRICS)[number];

/** Mirrors `WidgetPreferenceValues` / the column defaults of migrations 0120 + 0144. */
export interface HealthWidgetPreferences {
  small_widget_metric: HealthSmallWidgetMetric;
  chart_type: HealthWidgetChartType;
  chart_metric: HealthWidgetChartMetric;
  show_weight: boolean;
  show_nutrition: boolean;
  show_workouts: boolean;
  small_widget_style: HealthSmallWidgetStyle;
  medium_widget_layout: HealthMediumWidgetLayout;
  medium_primary_metric: HealthMediumWidgetMetric;
  medium_secondary_metric: HealthMediumWidgetMetric;
  medium_show_all_metrics: boolean;
}

/**
 * The compact glance payload. Derived server-side from the SAME P1 tracking
 * rows the app reads, so phone / widget / watch can never disagree on a figure.
 *
 * `weight`/`weight_trend`, `nutrition`/`nutrition_trend` and `workouts` are
 * null when their `show_*` toggle is off — that is the preference doing its
 * job, not a missing read. There is still no file, cycle or vitality data
 * here BY DESIGN: a widget renders on a LOCKED screen.
 */
export interface HealthWidgetSnapshot {
  date: string;
  generated_at: string;
  preferences: HealthWidgetPreferences;
  small: { metric: HealthSmallWidgetMetric; value: number; goal: number | null };
  steps: { value: number; goal: number | null };
  water: { total_ml: number; goal_ml: number | null };
  weight: { value: number; unit: string; date: string } | null;
  weight_trend: {
    unit: string;
    /** This week, LOGGED days only — a week is rarely weighed in daily. */
    entries: Array<{ date: string; weight: number }>;
    avg_this_week: number | null;
    avg_last_week: number | null;
    starting_weight_kg: number | null;
    starting_weight_date: string | null;
    progress_from_start: number | null;
    progress_percentage: number | null;
  } | null;
  nutrition: {
    calories: number;
    proteins: number;
    carbohydrates: number;
    fats: number;
    goal_calories: number | null;
    protein_target: number | null;
    carbs_target: number | null;
    fats_target: number | null;
  } | null;
  nutrition_trend: {
    /** This week, all 7 days (zero-filled — unlike `weight_trend.entries`). */
    entries: Array<{ date: string; calories: number }>;
    avg_this_week: number;
    avg_last_week: number;
  } | null;
  workouts: {
    count: number;
    minutes: number;
    calories: number;
    goal_minutes: number | null;
  } | null;
}

/* ============================== Client =============================== */

const BASE = '/health';

export const healthAssetsApi = {
  /* ------------------------------ Files ------------------------------ */

  /** Newest first. `limit` is capped at 500 server-side; default 200. */
  listFiles: (params?: { file_type?: HealthFileType; limit?: number }) =>
    apiClient.get<{ files: HealthFile[] }>(`${BASE}/files`, { params }).then((r) => r.data),

  getFile: (id: string) =>
    apiClient.get<{ file: HealthFile }>(`${BASE}/files/${id}`).then((r) => r.data),

  /** Step 1 of 2 — reserve the row and learn where to PUT. */
  createFile: (body: CreateHealthFileInput) =>
    apiClient.post<HealthFileReservation>(`${BASE}/files`, body).then((r) => r.data),

  /**
   * Step 2 of 2 — PUT the raw bytes to the RELATIVE `upload.path`.
   *
   * Through `apiClient` so the brand's API base URL and the bearer token are
   * attached: the target is an authenticated Worker route, not a presigned R2
   * URL, so a bare XHR to a relative path never arrives (see the file header).
   *
   * `transformRequest` is the identity function because axios would otherwise
   * try to JSON-encode the Blob and send `{}`.
   */
  uploadFileBytes: (path: string, body: ArrayBuffer | Blob, contentType: string) =>
    apiClient
      .put<{ file: HealthFile }>(path, body, {
        headers: { 'Content-Type': contentType },
        transformRequest: [(data) => data],
      })
      .then((r) => r.data),

  // NOTE — there is deliberately no `downloadFileBytes` here. `GET
  // /health/files/:id/content` can return up to 50MB, and pulling that through
  // axios materialises the whole object in JS memory before anything can be
  // done with it. The read path is `healthFileContentSource()` + a streaming
  // `FileSystem.downloadAsync(uri, target, { headers })`, which writes straight
  // to disk. It is the same authenticated request either way.

  /** Soft delete — the R2 object really is removed; the row keeps a tombstone. */
  deleteFile: (id: string) =>
    apiClient.delete<{ deleted: boolean }>(`${BASE}/files/${id}`).then((r) => r.data),

  /* ------------------------------ Widget ----------------------------- */

  getWidgetPreferences: () =>
    apiClient
      .get<{ preferences: HealthWidgetPreferences }>(`${BASE}/widget/preferences`)
      .then((r) => r.data),

  /** PATCH-merge upsert — an omitted key KEEPS its stored value. */
  saveWidgetPreferences: (patch: Partial<HealthWidgetPreferences>) =>
    apiClient
      .put<{ preferences: HealthWidgetPreferences }>(`${BASE}/widget/preferences`, patch)
      .then((r) => r.data),

  /** `date` is the CLIENT's own local day — the Worker has no user timezone. */
  getWidgetSnapshot: (date?: string) =>
    apiClient
      .get<{ snapshot: HealthWidgetSnapshot }>(`${BASE}/widget/snapshot`, {
        params: date ? { date } : undefined,
      })
      .then((r) => r.data),
};

/**
 * `<Image source={...}>` for a stored photo.
 *
 * There is no public URL for a health file, so the bearer token has to ride on
 * the request. React Native's image loader accepts per-source headers, which is
 * the only way to render an authenticated byte path without first copying it to
 * disk. Returns null when there is no session — the caller shows a placeholder
 * rather than firing a request that can only 401.
 */
export function healthFileContentSource(
  contentPath: string
): { uri: string; headers: Record<string, string> } | null {
  const token = useAuthStore.getState().token;
  if (!token || !contentPath) return null;
  return {
    uri: `${ENV.API_BASE_URL}${contentPath}`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

export default healthAssetsApi;
