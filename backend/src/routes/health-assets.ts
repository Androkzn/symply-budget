import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireHealthApi } from '../middleware/brand-gate';
import { assertCanUseAI } from '../services/entitlement-service';
import { MAX_VISION_IMAGES, type VisionFailure } from '../services/health-ai/vision-service';
import {
  ALLOWED_MIME_TYPES,
  FRIDGE_SOURCES,
  HealthAssetsService,
  MAX_FILE_BYTES,
  MEDIUM_WIDGET_LAYOUTS,
  MEDIUM_WIDGET_METRICS,
  SMALL_WIDGET_METRICS,
  SMALL_WIDGET_STYLES,
  WIDGET_CHART_METRICS,
  WIDGET_CHART_TYPES,
  normalizeExpiryDate,
  type HealthFileType,
} from '../services/health-assets-service';
import {
  HealthFridgeAiService,
  providerForFridge,
  type MealPlannerItem,
} from '../services/health-fridge-ai-service';
import type { Env } from '../types';
import { AIAccessError } from '../utils/errors';

/**
 * Symply Health — parity phase P2, `assets` group: file uploads, widget preferences and fridge.
 *
 * Mounted at `/health` alongside `routes/health.ts`. Same contract:
 * `requireHealthApi()` 404s the whole surface on every non-Health Worker, and
 * every row is scoped to the authenticated USER — health data is personal and
 * has no household read path by design (BRD §7).
 *
 * Each P2 router owns disjoint sub-paths, so mount ordering between them at the
 * shared `/health` prefix does not matter.
 *
 * THIN CLIENT, as in `routes/health.ts`: handlers validate input and render
 * what `HealthAssetsService` returns. Two rules are enforced there and asserted
 * here in tests — `storage_key` never reaches a response body, and the widget
 * snapshot never carries a body photo (or any other sensitive domain).
 *
 * Validation mirrors the CHECK constraints of migration 0120 on purpose:
 * miniflare D1 (and the deployed D1) DO enforce CHECKs, so an unvalidated write
 * 500s on a constraint error instead of answering an honest 400.
 */
const healthAssets = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

healthAssets.use('/*', requireHealthApi());
healthAssets.use('/*', authMiddleware());

function uid(c: { get: (k: 'userId') => string }): string {
  return c.get('userId');
}

function svc(c: { env: Env }): HealthAssetsService {
  return new HealthAssetsService(c.env, c.env.DB);
}

function notFound(message: string) {
  return { error: { code: 'not_found' as const, message } };
}

function badRequest(message: string) {
  return { error: { code: 'bad_request' as const, message } };
}

/** YYYY-MM-DD — the client always sends its own LOCAL day, never a UTC stamp. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

/* ================================ FILES ================================= */

const fileTypeSchema = z.enum(['photo', 'document', 'body_photo']);

const createFileSchema = z
  .object({
    file_name: z.string().min(1).max(255),
    file_type: fileTypeSchema,
    mime_type: z.string().min(1).max(255),
    file_size: z.number().int().positive().max(MAX_FILE_BYTES),
    category: z.string().max(100).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  // The donor allow-listed MIME per file_type; keep it, so a `body_photo`
  // reservation can never smuggle in an executable content type that the
  // content proxy would later serve back on our own origin.
  .refine((v) => ALLOWED_MIME_TYPES[v.file_type].includes(v.mime_type), {
    message: 'mime_type is not allowed for this file_type',
    path: ['mime_type'],
  });

healthAssets.get('/files', async (c) => {
  const raw = c.req.query('file_type');
  const parsed = raw ? fileTypeSchema.safeParse(raw) : null;
  if (parsed && !parsed.success) return c.json(badRequest('invalid file_type'), 400);
  const limitRaw = c.req.query('limit');
  const limit = limitRaw ? Number(limitRaw) : undefined;
  // INTEGER, not merely finite: `limit` is bound straight into `LIMIT ?`, and
  // D1 rejects a REAL there with `SQLITE_MISMATCH` — so `?limit=1.5` used to
  // 500 on an authenticated list. Same rule as `?expiring_within_days=` below.
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0 || limit > 500)) {
    return c.json(badRequest('limit must be 1..500'), 400);
  }
  const files = await svc(c).listFiles(uid(c), { file_type: parsed?.data, limit });
  return c.json({ files });
});

/**
 * Reserve a file and get somewhere to PUT the bytes.
 *
 * `upload_url` is null: R2 bindings have no S3-style presigned PUT, so — as in
 * the household-photo contract — the client PUTs to the returned Worker path
 * with its own bearer token, and the R2 key stays server-side.
 */
healthAssets.post('/files', zValidator('json', createFileSchema), async (c) => {
  const input = c.req.valid('json') as {
    file_name: string;
    file_type: HealthFileType;
    mime_type: string;
    file_size: number;
    category?: string;
    metadata?: Record<string, unknown>;
  };
  return c.json(await svc(c).createFileUpload(uid(c), input), 201);
});

/** Metadata only — never the raw object, and never `storage_key`. */
healthAssets.get('/files/:id', async (c) => {
  const file = await svc(c).getFile(uid(c), c.req.param('id'));
  if (!file) return c.json(notFound('File not found'), 404);
  return c.json({ file });
});

healthAssets.put('/files/:id/content', async (c) => {
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json(badRequest('empty file'), 400);
  if (body.byteLength > MAX_FILE_BYTES) {
    return c.json(badRequest(`file too large (max ${MAX_FILE_BYTES} bytes)`), 400);
  }
  const file = await svc(c).putFileContent(uid(c), c.req.param('id'), body);
  if (!file) return c.json(notFound('File not found'), 404);
  return c.json({ file });
});

/**
 * The proxied read path. Ownership is re-checked on every request — this is the
 * ONLY way to reach the bytes, which is why the R2 key is never published.
 */
healthAssets.get('/files/:id/content', async (c) => {
  const found = await svc(c).getFileContent(uid(c), c.req.param('id'));
  if (!found) return c.json(notFound('File not found'), 404);
  const { object, file } = found;

  // Documents download; images render. `nosniff` stops a browser from
  // re-interpreting user bytes as something more dangerous than the declared
  // (and allow-listed) type, and the file name was sanitised on write so it
  // cannot break out of the header.
  const disposition = file.file_type === 'document' ? 'attachment' : 'inline';
  const headers = new Headers();
  headers.set('Content-Type', file.mime_type);
  headers.set('Content-Disposition', `${disposition}; filename="${file.file_name}"`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { status: 200, headers });
});

/** Soft delete (tombstone for sync) — the R2 object itself really is removed. */
healthAssets.delete('/files/:id', async (c) => {
  const ok = await svc(c).deleteFile(uid(c), c.req.param('id'));
  if (!ok) return c.json(notFound('File not found'), 404);
  return c.json({ deleted: true });
});

/* =============================== WIDGET ================================= */

const widgetPreferencesSchema = z.object({
  small_widget_metric: z.enum(SMALL_WIDGET_METRICS).optional(),
  chart_type: z.enum(WIDGET_CHART_TYPES).optional(),
  chart_metric: z.enum(WIDGET_CHART_METRICS).optional(),
  show_weight: z.boolean().optional(),
  show_nutrition: z.boolean().optional(),
  show_workouts: z.boolean().optional(),
  small_widget_style: z.enum(SMALL_WIDGET_STYLES).optional(),
  medium_widget_layout: z.enum(MEDIUM_WIDGET_LAYOUTS).optional(),
  medium_primary_metric: z.enum(MEDIUM_WIDGET_METRICS).optional(),
  medium_secondary_metric: z.enum(MEDIUM_WIDGET_METRICS).optional(),
  medium_show_all_metrics: z.boolean().optional(),
});

healthAssets.get('/widget/preferences', async (c) => {
  return c.json({ preferences: await svc(c).getWidgetPreferences(uid(c)) });
});

/** Upsert on the UNIQUE `user_id`; omitted keys keep their stored value. */
healthAssets.put('/widget/preferences', zValidator('json', widgetPreferencesSchema), async (c) => {
  const preferences = await svc(c).saveWidgetPreferences(uid(c), c.req.valid('json'));
  return c.json({ preferences });
});

healthAssets.get('/widget/snapshot', async (c) => {
  const date = c.req.query('date');
  if (date !== undefined && !dateSchema.safeParse(date).success) {
    return c.json(badRequest('date must be YYYY-MM-DD'), 400);
  }
  const snapshot = await svc(c).widgetSnapshot(
    uid(c),
    date ?? new Date().toISOString().slice(0, 10)
  );
  return c.json({ snapshot });
});

/* =============================== FRIDGE ================================= */

/**
 * Every field below mirrors a CHECK in migration 0120 (`length(name) <= 200`,
 * `quantity >= 0`, `length(unit) <= 20`, `length(category) <= 50`,
 * `length(notes) <= 1000`, `source IN (…)`). D1 enforces those, so without the
 * zod twin a bad write is a 500 constraint error instead of a 400.
 */
const expiryDateSchema = z
  .string()
  .max(40)
  .refine((v) => normalizeExpiryDate(v) !== null, {
    message: 'expiry_date must be YYYY-MM-DD or an ISO timestamp',
  });

const fridgeFields = {
  quantity: z.number().min(0).max(1_000_000).nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  expiry_date: expiryDateSchema.nullable().optional(),
  is_favorite: z.boolean().optional(),
  nutrition_json: z.union([z.string().max(4000), z.record(z.unknown())]).nullable().optional(),
  source: z.enum(FRIDGE_SOURCES).optional(),
  image_url: z.string().max(500).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
};

const createFridgeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  ...fridgeFields,
});

const updateFridgeSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  ...fridgeFields,
});

healthAssets.get('/fridge', async (c) => {
  const raw = c.req.query('expiring_within_days');
  let expiringWithinDays: number | undefined;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650) {
      return c.json(badRequest('expiring_within_days must be an integer 0..3650'), 400);
    }
    expiringWithinDays = parsed;
  }
  // `today` lets the CLIENT supply its own local day — the same reason every
  // other date on this surface is client-sent rather than derived from UTC.
  const today = c.req.query('today');
  if (today !== undefined && !dateSchema.safeParse(today).success) {
    return c.json(badRequest('today must be YYYY-MM-DD'), 400);
  }
  const items = await svc(c).listFridge(uid(c), {
    expiring_within_days: expiringWithinDays,
    today,
  });
  return c.json({ items });
});

healthAssets.post('/fridge', zValidator('json', createFridgeSchema), async (c) => {
  const item = await svc(c).createFridgeItem(uid(c), c.req.valid('json'));
  return c.json({ item }, 201);
});

healthAssets.put('/fridge/:id', zValidator('json', updateFridgeSchema), async (c) => {
  const item = await svc(c).updateFridgeItem(uid(c), c.req.param('id'), c.req.valid('json'));
  if (!item) return c.json(notFound('Item not found'), 404);
  return c.json({ item });
});

healthAssets.delete('/fridge/:id', async (c) => {
  const ok = await svc(c).deleteFridgeItem(uid(c), c.req.param('id'));
  if (!ok) return c.json(notFound('Item not found'), 404);
  return c.json({ deleted: true });
});

/* ============================= FRIDGE — AI ============================== */

/**
 * The Smart Fridge's two MODEL surfaces (parity P5): read a shopping receipt
 * into fridge drafts, and suggest meals from what is in there.
 *
 * ── WHY THESE PATHS BEGIN `/ai/` AND WHY THEY LIVE IN THIS FILE ─────────────
 *
 * THE `/ai/` PREFIX IS LOAD-BEARING. `src/index.ts` registers
 * `rateLimitDO('health:ai')` for `/health/ai/*` on the APP, above every `/health`
 * mount, precisely because a router-level declaration would be preceded by
 * `routes/health.ts`'s own `use('/*')`. Anything served under `/health/ai/` is
 * therefore rate-limited whichever router declares it — and a model call must
 * be. Renaming these to `/fridge/scan-receipt` would silently drop that.
 *
 * They are declared HERE, beside the fridge CRUD they feed, rather than in
 * `routes/health-ai.ts`, because the fridge vocabulary, the fridge service and
 * the fridge validation all already live in this file. Hono matches on the path,
 * not the file, so both facts can be true at once.
 *
 * ── GATE ORDER ─────────────────────────────────────────────────────────────
 *
 *   brand → auth → entitlement → credential → model
 *
 * Brand and auth come from this router's own `use('/*')` above. Entitlement is
 * the platform's canonical `assertCanUseAI` and is what produces the Unlock AI
 * path in the app; a missing credential is separate and answers 503 with plain
 * words, because "you have not connected a key" is not a payment problem.
 *
 * NOTHING IS PERSISTED BY EITHER ROUTE. A receipt returns a reviewable draft the
 * person saves through `POST /health/fridge` with `source: 'receipt'`; meal
 * ideas are read and then gone. Same review-before-write contract the label and
 * meal-photo scanners keep.
 */

/** Member-facing copy for every denial. No provider string, no status code. */
const AI_COPY = {
  unsupported_media:
    'That image could not be read. Take the photo again as a JPEG or PNG, or pick a different one.',
  receipt_unreadable:
    'No shopping could be read from that. Try again in better light with the whole receipt in frame, or add the items yourself.',
  meals_unreadable:
    'No meal ideas came back that time. Please try again in a moment.',
  provider_unavailable:
    'The AI could not be reached just now. Please try again in a moment.',
} as const;

function visionFailure(failure: VisionFailure, unreadableCopy: string) {
  switch (failure.reason) {
    case 'unsupported_media':
      return {
        status: 415 as const,
        body: { error: { code: failure.reason, message: AI_COPY.unsupported_media } },
      };
    case 'unreadable':
      return {
        status: 422 as const,
        body: { error: { code: failure.reason, message: unreadableCopy } },
      };
    case 'provider_unavailable':
      return {
        status: 503 as const,
        body: { error: { code: failure.reason, message: AI_COPY.provider_unavailable } },
      };
  }
}

/**
 * Map `AIAccessError` to the shared denial shape; null for anything else.
 *
 * Mapped INSIDE this router rather than left to `app.onError` for the same
 * reason `routes/health-ai.ts` does it: the Health suites mount routers
 * STANDALONE, where the app's error handler does not exist, so a denial has to
 * be identical composed or standalone.
 */
function aiDenial(err: unknown) {
  if (err instanceof AIAccessError || (err as Error)?.name === 'AIAccessError') {
    const e = err as AIAccessError & { statusCode?: number; code?: string; message: string };
    return {
      status: (e.statusCode ?? 403) as 403 | 409 | 422 | 503,
      body: { error: { code: e.code ?? 'ai_access_denied', message: e.message } },
    };
  }
  return null;
}

const fridgeImagesSchema = z.object({
  images: z
    .array(
      z.object({
        /** Raw base64, no data-URI prefix. */
        data: z.string().min(1),
        /** Advisory only — the bytes decide. See `resolveVisionImages`. */
        media_type: z.string().max(60).optional(),
      })
    )
    .min(1)
    .max(MAX_VISION_IMAGES),
});

/**
 * A photographed shopping receipt → reviewable fridge drafts.
 *
 * Several images are ONE long receipt read in order, exactly as the shared
 * receipt prompt defines it — not several receipts.
 */
healthAssets.post('/ai/fridge-receipt', zValidator('json', fridgeImagesSchema), async (c) => {
  const userId = uid(c);
  try {
    await assertCanUseAI(userId, c.env);
  } catch (err) {
    const mapped = aiDenial(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    throw err;
  }

  const provider = await providerForFridge(c.env, userId, 'health_fridge_receipt');
  if (!provider) {
    return c.json(
      { error: { code: 'provider_unavailable', message: AI_COPY.provider_unavailable } },
      503
    );
  }

  const result = await new HealthFridgeAiService().scanReceipt({
    provider,
    images: c.req.valid('json').images.map((i) => ({
      base64: i.data,
      declaredMediaType: i.media_type ?? '',
    })),
  });

  if (!result.ok) {
    const mapped = visionFailure(result, AI_COPY.receipt_unreadable);
    return c.json(mapped.body, mapped.status);
  }
  return c.json({ draft: result.draft });
});

/**
 * Meal ideas from what is in the fridge RIGHT NOW.
 *
 * The Worker reads the fridge itself — the client sends a goal, not an
 * inventory. Same rule the coach follows, and it is what makes the answer about
 * the person's real stock rather than about whatever a screen happened to have
 * cached.
 *
 * `today` is the CLIENT's own local day: "expires today" is a statement about
 * the person's calendar, and deriving it from UTC puts it a day out for anyone
 * east or west of Greenwich.
 */
healthAssets.post(
  '/ai/fridge-meals',
  zValidator(
    'json',
    z.object({
      today: dateSchema.optional(),
      goal: z.string().trim().max(120).optional(),
      restrictions: z.string().trim().max(200).nullable().optional(),
    })
  ),
  async (c) => {
    const userId = uid(c);
    try {
      await assertCanUseAI(userId, c.env);
    } catch (err) {
      const mapped = aiDenial(err);
      if (mapped) return c.json(mapped.body, mapped.status);
      throw err;
    }

    const provider = await providerForFridge(c.env, userId, 'health_fridge_meals');
    if (!provider) {
      return c.json(
        { error: { code: 'provider_unavailable', message: AI_COPY.provider_unavailable } },
        503
      );
    }

    const body = c.req.valid('json');
    const today = body.today ?? new Date().toISOString().slice(0, 10);
    const rows = await svc(c).listFridge(userId);
    const items: MealPlannerItem[] = rows.map((row) => ({
      name: row.name,
      quantity: typeof row.quantity === 'number' ? row.quantity : null,
      unit: row.unit ?? null,
      expiry_date: row.expiry_date ?? null,
    }));

    const result = await new HealthFridgeAiService().suggestMeals({
      provider,
      items,
      today,
      goal: body.goal && body.goal.length > 0 ? body.goal : 'Healthy eating',
      restrictions: body.restrictions ?? null,
    });

    if (!result.ok) {
      const mapped = visionFailure(result, AI_COPY.meals_unreadable);
      return c.json(mapped.body, mapped.status);
    }
    return c.json({ plan: result.plan });
  }
);

export default healthAssets;
