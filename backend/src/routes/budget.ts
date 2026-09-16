import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireBudgetApi } from '../middleware/brand-gate';
import { rejectFinancialWritesForLocalFirst } from '../middleware/budget-local-first-gate';
import {
  ReceiptScanService,
  type ReceiptScanMimeType,
} from '../services/budget-analysis';
import { BudgetEncouragementService } from '../services/budget-encouragement';
import { BudgetInsightsService } from '../services/budget-insights-service';
import { BudgetService } from '../services/budget-service';
import { BudgetSuggestionService } from '../services/budget-suggestion-service';
import { assertCanUseAI } from '../services/entitlement-service';
import { NotificationService } from '../services/notification-service';
import type { Env } from '../types';
import { budgetDebug } from '../utils/budget-debug';
import { ValidationError } from '../utils/errors';

const budget = new Hono<{ Bindings: Env }>();

// House Worker: BUDGET_API_ENABLED=false → 404 before auth (money product is Symply Budget).
budget.use(requireBudgetApi());
// Local-first clients must not use D1 financial CRUD (before auth so gate is reliable).
budget.use('/*', rejectFinancialWritesForLocalFirst());

// All routes require authentication
budget.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// Validation schemas
const createBudgetItemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category_id: z.string().uuid().optional(),
  // Planning horizon is the source of truth; when omitted the service derives
  // it from `target_date`. `timeframe` is legacy and now optional/derived.
  horizon: z.enum(['short_term', 'long_term', 'someday']).optional(),
  timeframe: z
    .enum([
      'immediate',
      '1_month',
      '3_months',
      '6_months',
      '1_year',
      '2_years',
      '5_years',
      '10_years',
    ])
    .optional(),
  year: z.number().int().min(2020).max(2100).optional(),
  quarter: z.number().int().min(1).max(4).optional(),
  estimated_cost_min: z.number().int().min(0).optional(),
  estimated_cost_max: z.number().int().min(0).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  target_date: z.string().optional(),
  is_recurring: z.boolean().optional(),
  recurrence_frequency: z.enum(['monthly', 'quarterly', 'yearly']).optional(),
});

const updateBudgetItemSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  category_id: z.string().uuid().optional(),
  horizon: z.enum(['short_term', 'long_term', 'someday']).optional(),
  timeframe: z
    .enum([
      'immediate',
      '1_month',
      '3_months',
      '6_months',
      '1_year',
      '2_years',
      '5_years',
      '10_years',
    ])
    .optional(),
  year: z.number().int().min(2020).max(2100).optional(),
  quarter: z.number().int().min(1).max(4).optional(),
  estimated_cost_min: z.number().int().min(0).optional(),
  estimated_cost_max: z.number().int().min(0).optional(),
  actual_cost: z.number().int().min(0).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  status: z.enum(['planned', 'in_progress', 'completed', 'deferred', 'cancelled']).optional(),
  // Nullable so the edit form can clear a date and turn a scheduled spending
  // into an undated ("Anytime") one.
  target_date: z.string().nullable().optional(),
});

const aiDetectItemsSchema = z.object({
  text: z.string().min(1).max(2000),
  // The month the user is currently viewing, so the AI can resolve relative
  // dates like "next month" against it. Optional — falls back to today.
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

const addExpenseSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  amount: z.number().int().min(1),
  expense_date: z.string(),
  category_id: z.string().uuid().optional(),
  budget_item_id: z.string().uuid().optional(),
  vendor: z.string().max(200).optional(),
  // Discount/sale savings for this expense, in cents (grocery receipt scanning).
  saved_amount: z.number().int().min(0).optional(),
  // Sales tax included in `amount`, in cents (receipt scanning). Informational.
  tax_amount: z.number().int().min(0).optional(),
  deposit_amount: z.number().int().min(0).optional(),
});

const bulkExpenseItemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  amount: z.number().int().min(1),
  expense_date: z.string(),
  category_id: z.string().uuid().optional(),
  vendor: z.string().max(200).optional(),
  saved_amount: z.number().int().min(0).optional(),
  tax_amount: z.number().int().min(0).optional(),
  deposit_amount: z.number().int().min(0).optional(),
});

const bulkExpensesSchema = z.object({
  expenses: z.array(bulkExpenseItemSchema).min(1).max(100),
});

const updateExpenseSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  amount: z.number().int().min(1).optional(),
  expense_date: z.string().optional(),
  category_id: z.string().uuid().optional().nullable(),
  saved_amount: z.number().int().min(0).optional(),
  tax_amount: z.number().int().min(0).optional(),
  deposit_amount: z.number().int().min(0).optional(),
  vendor: z.string().max(200).optional().nullable(),
});

const expenseFiltersSchema = z.object({
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  category_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const quickAddQuerySchema = z.object({
  kind: z.enum(['planned', 'spent']),
});

const monthParamsSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

const monthQuerySchema = monthParamsSchema;

const setMonthlyGoalSchema = z.object({
  planned_budget: z.number().int().min(0),
  category_budgets: z.record(z.string(), z.number().int().min(0)).optional(),
  notes: z.string().max(1000).optional(),
});

const insightsQuerySchema = monthQuerySchema.extend({
  force_refresh: z.coerce.boolean().optional().default(false),
});

const createTransferSchema = z.object({
  source_year: z.number().int().min(2020).max(2100),
  source_month: z.number().int().min(1).max(12),
  amount_cents: z.number().int().positive(),
  destination_type: z.enum(['next_month', 'savings_goal', 'registered_account']),
  // Required for savings_goal / registered_account; omitted for next_month.
  destination_id: z.string().nullish(),
  note: z.string().max(500).nullish(),
});

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  sort_order: z.number().int().min(0).optional(),
  // Show/hide a predefined category without deleting it.
  hidden: z.boolean().optional(),
});

const subBudgetsQuerySchema = monthQuerySchema;

const upsertSubBudgetSchema = z
  .object({
    category_id: z.string().uuid(),
    year: z.number().int().min(2020).max(2100),
    // null = recurring default for the year; 1-12 = single-month override.
    month: z.number().int().min(1).max(12).nullable(),
    limit_type: z.enum(['amount', 'percent']),
    amount_cents: z.number().int().min(0).nullish(),
    percent_bps: z.number().int().min(0).max(10000).nullish(),
  })
  .refine((v) => (v.limit_type === 'amount' ? v.amount_cents != null : v.percent_bps != null), {
    message: 'amount_cents is required for an amount cap, percent_bps for a percent cap',
  });

const deleteSubBudgetSchema = z.object({
  category_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12).nullable(),
});

/**
 * GET /households/:householdId/budget/categories
 * Get budget categories
 */
budget.get('/categories', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  // The management screen passes include_hidden=1 to also list toggled-off
  // defaults; pickers/dashboard omit it so hidden categories stay out of the way.
  const includeHidden = c.req.query('include_hidden') === '1';
  const budgetService = new BudgetService(c.env, c.env.DB);

  const categories = await budgetService.getCategories(householdId, userId, { includeHidden });

  return c.json({ categories });
});

const categoryProductsQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  // Rolling window of calendar months ending at (year, month).
  months: z.coerce.number().int().min(1).max(24).default(6),
});

/**
 * GET /households/:householdId/budget/categories/:id/products?year=&month=&months=
 * Product-level spending breakdown + month-over-month trends for one category
 * (e.g. what groceries were bought and how milk/yogurt trend). Use the literal
 * id 'uncategorized' for expenses that have no category.
 */
budget.get(
  '/categories/:id/products',
  zValidator('query', categoryProductsQuerySchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const categoryId = c.req.param('id');
    const { year, month, months } = c.req.valid('query');
    const budgetService = new BudgetService(c.env, c.env.DB);

    const trends = await budgetService.getCategoryProductTrends(
      householdId,
      userId,
      categoryId,
      year,
      month,
      months
    );

    return c.json(trends);
  }
);

/**
 * GET /households/:householdId/budget/timeline
 * Get budget timeline overview
 */
budget.get('/timeline', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const budgetService = new BudgetService(c.env, c.env.DB);

  const overview = await budgetService.getTimeline(householdId, userId);

  return c.json(overview);
});

/**
 * POST /households/:householdId/budget/items
 * Create a budget item
 */
budget.post('/items', zValidator('json', createBudgetItemSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const item = await budgetService.createBudgetItem(householdId, userId, {
    title: input.title,
    description: input.description,
    categoryId: input.category_id,
    horizon: input.horizon,
    timeframe: input.timeframe,
    year: input.year,
    quarter: input.quarter,
    estimatedCostMin: input.estimated_cost_min,
    estimatedCostMax: input.estimated_cost_max,
    priority: input.priority,
    targetDate: input.target_date,
    isRecurring: input.is_recurring,
    recurrenceFrequency: input.recurrence_frequency,
  });

  return c.json({ item }, 201);
});

/**
 * POST /households/:householdId/budget/items/ai-detect
 * Turn a free-text description into one or more draft spendings (NOT saved).
 * The client previews/edits the drafts, then creates them via POST /items.
 */
budget.post('/items/ai-detect', zValidator('json', aiDetectItemsSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await assertCanUseAI(userId, c.env);
  const input = c.req.valid('json');
  const suggestionService = new BudgetSuggestionService(c.env, c.env.DB);

  const suggestions = await suggestionService.suggestFromText(householdId, userId, {
    text: input.text,
    year: input.year,
    month: input.month,
  });

  return c.json({ suggestions });
});

/**
 * GET /households/:householdId/budget/quick-add
 * Recent and popular templates for fast re-adding planned or spent items.
 */
budget.get('/quick-add', zValidator('query', quickAddQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { kind } = c.req.valid('query');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const suggestions = await budgetService.getQuickAddSuggestions(householdId, userId, kind);
  return c.json(suggestions);
});

const BUDGET_DOCUMENT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/**
 * POST /households/:householdId/budget/items/ai-detect-upload
 * Turn free text and/or an attached receipt, invoice, or quote into draft spendings.
 */
budget.post('/items/ai-detect-upload', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await assertCanUseAI(userId, c.env);

  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    const textField = formData.get('text');
    const text = typeof textField === 'string' ? textField.trim() : '';
    const yearRaw = formData.get('year');
    const monthRaw = formData.get('month');

    if (!text && !file) {
      return c.json({ error: 'Text or a file attachment is required' }, 400);
    }

    let fileInput: { data: ArrayBuffer; mimeType: (typeof BUDGET_DOCUMENT_MIMES)[number]; name: string } | undefined;

    if (file) {
      const fileType = (file.type || 'application/pdf') as (typeof BUDGET_DOCUMENT_MIMES)[number];
      if (!BUDGET_DOCUMENT_MIMES.includes(fileType)) {
        return c.json(
          { error: `Unsupported file type: ${fileType}. Allowed: PDF, JPEG, PNG, WebP` },
          400
        );
      }

      const maxSize = 32 * 1024 * 1024;
      if (file.size > maxSize) {
        return c.json({ error: 'File size exceeds 32MB limit' }, 400);
      }

      fileInput = {
        data: await file.arrayBuffer(),
        mimeType: fileType,
        name: file.name || 'attachment',
      };
    }

    const year =
      typeof yearRaw === 'string' && yearRaw.length > 0 ? Number.parseInt(yearRaw, 10) : undefined;
    const month =
      typeof monthRaw === 'string' && monthRaw.length > 0 ? Number.parseInt(monthRaw, 10) : undefined;

    budgetDebug(c.env, 'ai-detect.route', {
      householdId,
      userId,
      hasText: !!text,
      textLength: text.length,
      hasFile: !!file,
      fileName: file?.name ?? null,
      fileType: file?.type ?? null,
      fileSize: file?.size ?? null,
      year: Number.isFinite(year) ? year : null,
      month: Number.isFinite(month) ? month : null,
    });

    const suggestionService = new BudgetSuggestionService(c.env, c.env.DB);
    const suggestions = await suggestionService.suggestFromTextAndFile(householdId, userId, {
      text: text || undefined,
      file: fileInput,
      year: Number.isFinite(year) ? year : undefined,
      month: Number.isFinite(month) ? month : undefined,
    });

    budgetDebug(c.env, 'ai-detect.route', {
      householdId,
      stage: 'response',
      suggestionCount: suggestions.length,
    });
    return c.json({ suggestions });
  } catch (error) {
    console.error('[BUDGET-AI-DETECT-UPLOAD] Error:', error);
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

const RECEIPT_SCAN_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

interface ReceiptScanForm {
  segments: { data: ArrayBuffer; mimeType: ReceiptScanMimeType }[];
  region?: { country: string | null; stateProvince: string | null };
  aliases?: Array<{ key: string; name: string; categoryId?: string | null }>;
}

/**
 * Parse + validate the receipt-scan multipart body, shared by the buffered and
 * streaming routes so their limits can never drift apart. Returns a 400 message
 * instead of throwing: the streaming route must decide the status BEFORE it
 * commits to a 200 stream.
 */
async function parseReceiptScanForm(
  formData: FormData
): Promise<{ ok: true; form: ReceiptScanForm } | { ok: false; error: string }> {
  const collected = ([
    ...formData.getAll('file'),
    ...formData.getAll('files'),
    ...formData.getAll('file[]'),
  ] as unknown[]).filter((f): f is File => f instanceof File);
  if (collected.length === 0) {
    return { ok: false, error: 'A receipt image is required' };
  }
  if (collected.length > 12) {
    return { ok: false, error: 'Too many files — up to 12 receipt images per scan' };
  }

  const maxSize = 32 * 1024 * 1024;
  const segments: { data: ArrayBuffer; mimeType: ReceiptScanMimeType }[] = [];
  for (const file of collected) {
    const fileType = (file.type || 'image/jpeg') as ReceiptScanMimeType;
    if (!RECEIPT_SCAN_MIMES.includes(fileType)) {
      return { ok: false, error: `Unsupported file type: ${fileType}. Allowed: PDF, JPEG, PNG, WebP` };
    }
    if (file.size > maxSize) {
      return { ok: false, error: 'File size exceeds 32MB limit' };
    }
    segments.push({ data: await file.arrayBuffer(), mimeType: fileType });
  }

  // Optional region override (user's Settings choice) for the tax fallback.
  const countryRaw = formData.get('country');
  const stateRaw = formData.get('state_province');
  const region =
    typeof countryRaw === 'string' || typeof stateRaw === 'string'
      ? {
          country: typeof countryRaw === 'string' ? countryRaw : null,
          stateProvince: typeof stateRaw === 'string' ? stateRaw : null,
        }
      : undefined;

  const aliasesRaw = formData.get('aliases');
  let aliases: Array<{ key: string; name: string; categoryId?: string | null }> | undefined;
  if (typeof aliasesRaw === 'string' && aliasesRaw.trim()) {
    try {
      const parsed = JSON.parse(aliasesRaw) as unknown;
      if (Array.isArray(parsed)) {
        aliases = parsed.filter(
          (row): row is { key: string; name: string; categoryId?: string | null } =>
            !!row &&
            typeof row === 'object' &&
            typeof (row as { key?: unknown }).key === 'string' &&
            typeof (row as { name?: unknown }).name === 'string'
        );
      }
    } catch {
      aliases = undefined;
    }
  }

  return { ok: true, form: { segments, region, aliases } };
}

/**
 * POST /households/:householdId/budget/receipts/scan
 * Read a receipt (photo/PDF) and return individual line items with TAX-INCLUSIVE
 * prices (each item's share of the receipt's sales tax folded in) plus the tax
 * summary, for the user to review before saving. Accepts MULTIPLE files under
 * `file`/`files` — a long receipt photographed in sections is read as ONE
 * receipt. Nothing is persisted here.
 */
budget.post('/receipts/scan', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await assertCanUseAI(userId, c.env);

  try {
    const parsed = await parseReceiptScanForm(await c.req.formData());
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const { segments, region, aliases } = parsed.form;

    budgetDebug(c.env, 'scan.route', {
      householdId,
      userId,
      fileCount: segments.length,
      fileTypes: segments.map((s) => s.mimeType),
      regionOverride: region ?? null,
      aliasCount: aliases?.length ?? 0,
    });

    const service = new ReceiptScanService(c.env, c.env.DB);
    const result = await service.scanReceipt(householdId, userId, { segments, region, aliases });

    budgetDebug(c.env, 'scan.route', {
      householdId,
      stage: 'response',
      vendor: result.vendor,
      purchaseDate: result.purchase_date,
      categoryResolved: !!result.category_id,
      itemCount: result.items.length,
      taxCents: result.tax_amount,
      taxSource: result.tax_source,
    });
    return c.json(result);
  } catch (error) {
    console.error('[BUDGET-RECEIPT-SCAN] Error:', error);
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

/**
 * POST /households/:householdId/budget/receipts/scan/stream
 *
 * Same scan, same result — but reported as NDJSON while it runs, so the app can
 * show real progress instead of an indeterminate spinner for the ~10-30s the
 * model spends reading. One JSON object per line:
 *
 *   {"type":"start","segments":3}          — upload received, extraction begins
 *   {"type":"items","count":12}            — 12 receipt lines written so far
 *   {"type":"result","result":{…}}         — the ReceiptScanResult, once
 *   {"type":"error","message":"…"}         — failed AFTER the stream opened
 *
 * Everything that can be validated up front (auth, AI entitlement, file count,
 * mime, size) still answers with a real HTTP status. Once the first byte ships
 * the status is locked at 200, so later failures can only arrive as an `error`
 * line — the client maps that to the same alert as a 4xx/5xx body.
 *
 * The buffered route above stays the source of truth for clients that cannot
 * read a stream (and for any proxy that buffers this one); it is not deprecated.
 */
budget.post('/receipts/scan/stream', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await assertCanUseAI(userId, c.env);

  let parsed: Awaited<ReturnType<typeof parseReceiptScanForm>>;
  try {
    parsed = await parseReceiptScanForm(await c.req.formData());
  } catch (error) {
    console.error('[BUDGET-RECEIPT-SCAN-STREAM] Bad upload:', error);
    return c.json({ error: 'Could not read the upload.' }, 400);
  }
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { segments, region, aliases } = parsed.form;

  budgetDebug(c.env, 'scan.route', {
    householdId,
    userId,
    stage: 'stream',
    fileCount: segments.length,
    fileTypes: segments.map((s) => s.mimeType),
    regionOverride: region ?? null,
    aliasCount: aliases?.length ?? 0,
  });

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let closed = false;
  const send = async (event: Record<string, unknown>): Promise<void> => {
    if (closed) return;
    try {
      await writer.write(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      // Client hung up mid-scan — stop writing, let the scan finish or die on
      // its own. Nothing is persisted by a scan, so an abandoned one is inert.
      closed = true;
    }
  };

  const pump = (async () => {
    try {
      await send({ type: 'start', segments: segments.length });
      const service = new ReceiptScanService(c.env, c.env.DB);
      const result = await service.scanReceipt(householdId, userId, {
        segments,
        region,
        aliases,
        // Fire-and-forget: a slow socket must not stall the model read, and
        // these frames are disposable — the next count supersedes any that
        // failed to write.
        onProgress: (progress) => {
          void send({ type: 'items', count: progress.items });
        },
      });
      budgetDebug(c.env, 'scan.route', {
        householdId,
        stage: 'stream.response',
        vendor: result.vendor,
        itemCount: result.items.length,
        taxSource: result.tax_source,
      });
      await send({ type: 'result', result });
    } catch (error) {
      console.error('[BUDGET-RECEIPT-SCAN-STREAM] Error:', error);
      await send({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      closed = true;
      await writer.close().catch(() => {});
    }
  })();
  // Workers may cancel a handler once it returns; this keeps the scan alive for
  // the life of the response stream. `executionCtx` THROWS when absent (the
  // test harness builds a context without one) — the stream still completes
  // there, because the returned Response holds the readable open.
  try {
    c.executionCtx.waitUntil(pump);
  } catch {
    void pump;
  }

  return new Response(readable, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-content-type-options': 'nosniff',
    },
  });
});

/**
 * GET /households/:householdId/budget/items/:id
 * Fetch a single budget item (powers the edit form, any month / undated).
 */
budget.get('/items/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const itemId = c.req.param('id');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const item = await budgetService.getBudgetItem(householdId, itemId, userId);

  return c.json({ item });
});

/**
 * PATCH /households/:householdId/budget/items/:id
 * Update a budget item
 */
budget.patch('/items/:id', zValidator('json', updateBudgetItemSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const itemId = c.req.param('id');
  const input = c.req.valid('json');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const item = await budgetService.updateBudgetItem(householdId, itemId, userId, {
    title: input.title,
    description: input.description,
    categoryId: input.category_id,
    horizon: input.horizon,
    timeframe: input.timeframe,
    year: input.year,
    quarter: input.quarter,
    estimatedCostMin: input.estimated_cost_min,
    estimatedCostMax: input.estimated_cost_max,
    actualCost: input.actual_cost,
    priority: input.priority,
    status: input.status,
    targetDate: input.target_date,
  });

  return c.json({ item });
});

const recordSpendingSchema = z.object({
  amount: z.number().int().min(1).optional(),
  expense_date: z.string().optional(),
});

/**
 * POST /households/:householdId/budget/items/:id/record-spending
 * Record a planned spending as an actual expense (mark as spent).
 */
budget.post('/items/:id/record-spending', zValidator('json', recordSpendingSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const itemId = c.req.param('id');
  const input = c.req.valid('json');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const result = await budgetService.recordPlannedSpending(householdId, itemId, userId, {
    amount: input.amount,
    expenseDate: input.expense_date,
  });

  return c.json(result);
});

/**
 * DELETE /households/:householdId/budget/items/:id
 * Delete a budget item
 */
budget.delete('/items/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const itemId = c.req.param('id');
  const budgetService = new BudgetService(c.env, c.env.DB);

  await budgetService.deleteBudgetItem(householdId, itemId, userId);

  return c.body(null, 204);
});

/**
 * POST /households/:householdId/budget/sync-action-items
 * Sync budget items from action items
 */
budget.post('/sync-action-items', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const budgetService = new BudgetService(c.env, c.env.DB);

  const created = await budgetService.syncFromTasks(householdId, userId);

  return c.json({ created, message: `Created ${created} budget items from tasks` });
});

/**
 * POST /households/:householdId/budget/expenses
 * Add an expense
 */
budget.post('/expenses', zValidator('json', addExpenseSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const expense = await budgetService.addExpense(householdId, userId, {
    title: input.title,
    description: input.description,
    amount: input.amount,
    expenseDate: input.expense_date,
    categoryId: input.category_id,
    budgetItemId: input.budget_item_id,
    vendor: input.vendor,
    savedAmount: input.saved_amount,
    taxAmount: input.tax_amount,
    depositAmount: input.deposit_amount,
  });

  return c.json({ expense }, 201);
});

/**
 * POST /households/:householdId/budget/expenses/bulk
 * Add multiple expenses atomically (used by grocery receipt scanning).
 */
budget.post('/expenses/bulk', zValidator('json', bulkExpensesSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const created = await budgetService.addExpensesBulk(
    householdId,
    userId,
    input.expenses.map((e) => ({
      title: e.title,
      description: e.description,
      amount: e.amount,
      expenseDate: e.expense_date,
      categoryId: e.category_id,
      vendor: e.vendor,
      savedAmount: e.saved_amount,
      taxAmount: e.tax_amount,
      depositAmount: e.deposit_amount,
    }))
  );

  return c.json({ expenses: created }, 201);
});

/**
 * GET /households/:householdId/budget/expenses
 * Get expenses
 */
budget.get('/expenses', zValidator('query', expenseFiltersSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const filters = c.req.valid('query');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const expenseList = await budgetService.getExpenses(householdId, userId, {
    startDate: filters.start_date,
    endDate: filters.end_date,
    categoryId: filters.category_id,
    limit: filters.limit,
  });

  return c.json({ expenses: expenseList });
});

/**
 * GET /households/:householdId/budget/expenses/:id
 */
budget.get('/expenses/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const expenseId = c.req.param('id');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const expense = await budgetService.getExpense(householdId, expenseId, userId);

  return c.json({ expense });
});

/**
 * PATCH /households/:householdId/budget/expenses/:id
 */
budget.patch('/expenses/:id', zValidator('json', updateExpenseSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const expenseId = c.req.param('id');
  const input = c.req.valid('json');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const expense = await budgetService.updateExpense(householdId, expenseId, userId, {
    title: input.title,
    description: input.description,
    amount: input.amount,
    expenseDate: input.expense_date,
    categoryId: input.category_id,
    savedAmount: input.saved_amount,
    taxAmount: input.tax_amount,
    depositAmount: input.deposit_amount,
    vendor: input.vendor,
  });

  return c.json({ expense });
});

/**
 * DELETE /households/:householdId/budget/expenses/:id
 */
budget.delete('/expenses/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const expenseId = c.req.param('id');
  const budgetService = new BudgetService(c.env, c.env.DB);

  await budgetService.deleteExpense(householdId, expenseId, userId);

  return c.body(null, 204);
});

/**
 * GET /households/:householdId/budget/goals/:year/:month
 * Get (or auto-create) the monthly budget goal
 */
budget.get('/goals/:year/:month', zValidator('param', monthParamsSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, month } = c.req.valid('param');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const goal = await budgetService.getOrCreateMonthlyGoal(householdId, userId, year, month);

  return c.json({ goal });
});

/**
 * PUT /households/:householdId/budget/goals/:year/:month
 * Set the monthly budget cap
 */
budget.put(
  '/goals/:year/:month',
  zValidator('param', monthParamsSchema),
  zValidator('json', setMonthlyGoalSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const { year, month } = c.req.valid('param');
    const input = c.req.valid('json');
    const budgetService = new BudgetService(c.env, c.env.DB);

    // Captured before the write so it reflects whether *any* month had a
    // budget prior to this save — drives the client's first-time-setup prompt.
    const hadAnyBudgetThisYear = await budgetService.hasAnyBudgetSetForYear(householdId, userId, year);

    const goal = await budgetService.setMonthlyGoal(householdId, userId, year, month, {
      plannedBudget: input.planned_budget,
      categoryBudgets: input.category_budgets,
      notes: input.notes,
    });

    return c.json({ goal, isFirstForYear: !hadAnyBudgetThisYear });
  }
);

/**
 * POST /households/:householdId/budget/goals/:year/:month/apply-to-year
 * Fill every remaining month this year that has no budget set yet with the same cap.
 */
budget.post(
  '/goals/:year/:month/apply-to-year',
  zValidator('param', monthParamsSchema),
  zValidator('json', setMonthlyGoalSchema.pick({ planned_budget: true })),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const { year, month } = c.req.valid('param');
    const { planned_budget } = c.req.valid('json');
    const budgetService = new BudgetService(c.env, c.env.DB);

    const updatedMonths = await budgetService.applyBudgetToRemainingMonths(
      householdId,
      userId,
      year,
      month,
      planned_budget
    );

    return c.json({ updatedMonths });
  }
);

/**
 * POST /households/:householdId/budget/goals/:year/:month/schedule-reminder
 * Schedule a "set next month's budget" notification for every household member,
 * delivered on the 1st of next month.
 */
budget.post(
  '/goals/:year/:month/schedule-reminder',
  zValidator('param', monthParamsSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = getHouseholdId(c);
    const { year, month } = c.req.valid('param');
    const budgetService = new BudgetService(c.env, c.env.DB);

    const memberIds = await budgetService.getHouseholdMemberIds(householdId, userId);

    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const scheduledFor = new Date(Date.UTC(nextYear, nextMonth - 1, 1, 14, 0, 0));

    const notificationService = new NotificationService(c.env, c.env.DB);
    await Promise.all(
      memberIds.map((memberId) =>
        notificationService.scheduleNotification({
          userId: memberId,
          householdId,
          type: 'budget_reminder',
          title: 'Set next month’s budget',
          body: 'Don’t forget to set your household’s budget cap for the new month.',
          data: {
            householdId,
            screen: 'BudgetSettings',
            year: String(nextYear),
            month: String(nextMonth),
          },
          scheduledFor,
          referenceType: 'budget_goal',
          referenceId: `${householdId}:${nextYear}-${nextMonth}`,
        })
      )
    );

    return c.json({ scheduledFor: scheduledFor.toISOString() });
  }
);

/**
 * GET /households/:householdId/budget/monthly-overview?year=&month=
 * Monthly remaining-balance + priority/urgency-ranked affordability view
 */
budget.get('/monthly-overview', zValidator('query', monthQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, month } = c.req.valid('query');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const overview = await budgetService.getMonthlyOverview(householdId, userId, year, month);

  return c.json(overview);
});

/**
 * GET /households/:householdId/budget/sub-budgets?year=&month=
 * Per-category sub-budget caps + spend for a month, plus the raw rows for the
 * whole year (both recurring defaults and month overrides) so the editor can
 * prefill and toggle scope.
 */
budget.get('/sub-budgets', zValidator('query', subBudgetsQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, month } = c.req.valid('query');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const [summary, rows] = await Promise.all([
    budgetService.getSubBudgetProgress(householdId, userId, year, month),
    budgetService.getSubBudgetRows(householdId, userId, year),
  ]);

  return c.json({
    subBudgets: summary.entries,
    totals: {
      totalCapCents: summary.totalCapCents,
      plannedBudget: summary.plannedBudget,
      overAllocatedBy: summary.overAllocatedBy,
    },
    rows,
  });
});

/**
 * PUT /households/:householdId/budget/sub-budgets
 * Create or update one category's sub-budget cap (idempotent set, keyed by
 * household + year + month|default + category).
 */
budget.put('/sub-budgets', zValidator('json', upsertSubBudgetSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const subBudget = await budgetService.upsertSubBudget(householdId, userId, {
    categoryId: input.category_id,
    year: input.year,
    month: input.month,
    limitType: input.limit_type,
    amountCents: input.amount_cents,
    percentBps: input.percent_bps,
  });

  return c.json({ subBudget });
});

/**
 * DELETE /households/:householdId/budget/sub-budgets
 * Remove one category's sub-budget cap for a scope (month override or default).
 */
budget.delete('/sub-budgets', zValidator('json', deleteSubBudgetSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const budgetService = new BudgetService(c.env, c.env.DB);

  await budgetService.deleteSubBudget(householdId, userId, {
    categoryId: input.category_id,
    year: input.year,
    month: input.month,
  });

  return c.json({ success: true });
});

/**
 * GET /households/:householdId/budget/transfers?year=&month=
 * Budget Transfer screen payload: this month's movable leftover, the
 * destinations it can go to (next month / savings goals / registered accounts),
 * and the transfers already made from this month.
 */
budget.get('/transfers', zValidator('query', monthQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, month } = c.req.valid('query');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const context = await budgetService.getTransferContext(householdId, userId, year, month);

  return c.json(context);
});

/**
 * POST /households/:householdId/budget/transfers
 * Move a month's leftover to a destination. Returns the refreshed context.
 */
budget.post('/transfers', zValidator('json', createTransferSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const context = await budgetService.createTransfer(householdId, userId, {
    sourceYear: input.source_year,
    sourceMonth: input.source_month,
    amountCents: input.amount_cents,
    destinationType: input.destination_type,
    destinationId: input.destination_id ?? null,
    note: input.note ?? null,
  });

  return c.json(context);
});

/**
 * DELETE /households/:householdId/budget/transfers/:id
 * Undo a transfer (reverses the destination-side effect). Returns the refreshed context.
 */
budget.delete('/transfers/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const transferId = c.req.param('id');
  if (!transferId) throw new ValidationError('Transfer ID is required');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const context = await budgetService.deleteTransfer(householdId, userId, transferId);

  return c.json(context);
});

/**
 * GET /households/:householdId/budget/insights?year=&month=&force_refresh=
 * Cached AI-generated narrative insights for the month
 */
budget.get('/insights', zValidator('query', insightsQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await assertCanUseAI(userId, c.env);
  const { year, month, force_refresh } = c.req.valid('query');
  const insightsService = new BudgetInsightsService(c.env, c.env.DB);

  const insights = await insightsService.getInsights(householdId, userId, year, month, force_refresh);

  return c.json(insights);
});

/**
 * GET /households/:householdId/budget/encouragement?year=&month=
 * Deterministic, upbeat "Budget Wins" card for the month (savings pace,
 * week-over-week trend, year-to-date savings). Computed server-side — the client
 * only renders the returned copy.
 */
budget.get('/encouragement', zValidator('query', monthQuerySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const { year, month } = c.req.valid('query');
  const encouragementService = new BudgetEncouragementService(c.env, c.env.DB);

  const encouragement = await encouragementService.getEncouragement(householdId, userId, year, month);

  return c.json(encouragement);
});

/**
 * POST /households/:householdId/budget/categories
 * Create a custom budget category
 */
budget.post('/categories', zValidator('json', createCategorySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const category = await budgetService.createCategory(householdId, userId, input);

  return c.json({ category }, 201);
});

/**
 * PATCH /households/:householdId/budget/categories/:id
 * Update a budget category
 */
budget.patch('/categories/:id', zValidator('json', updateCategorySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const categoryId = c.req.param('id');
  const input = c.req.valid('json');
  const budgetService = new BudgetService(c.env, c.env.DB);

  const category = await budgetService.updateCategory(householdId, categoryId, userId, {
    name: input.name,
    icon: input.icon,
    color: input.color,
    sortOrder: input.sort_order,
    hidden: input.hidden,
  });

  return c.json({ category });
});

/**
 * DELETE /households/:householdId/budget/categories/:id
 * Delete a budget category (referencing items are detached, not deleted)
 */
budget.delete('/categories/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const categoryId = c.req.param('id');
  const budgetService = new BudgetService(c.env, c.env.DB);

  await budgetService.deleteCategory(householdId, categoryId, userId);

  return c.body(null, 204);
});

export default budget;
