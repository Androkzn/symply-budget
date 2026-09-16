import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { QUOTE_STATUSES } from '../db/schema-labor-hub';
import { authMiddleware } from '../middleware/auth';
import { assertCanUseAI } from '../services/entitlement-service';
import { QuoteService } from '../services/quote-service';
import type { Env } from '../types';

const quotesRouter = new Hono<{ Bindings: Env }>();

// All routes require authentication
quotesRouter.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// ============ VALIDATION SCHEMAS ============

const createQuoteSchema = z.object({
  contractor_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  amount_cents: z.number().int().min(0).optional(),
  amount_range_low_cents: z.number().int().min(0).optional(),
  amount_range_high_cents: z.number().int().min(0).optional(),
  valid_until: z.string().optional(),
  estimated_duration: z.string().max(100).optional(),
  warranty_terms: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  // Links
  appointment_id: z.string().uuid().optional(),
  linked_report_id: z.string().uuid().optional(),
  linked_task_id: z.string().uuid().optional(),
});

const updateQuoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  amount_cents: z.number().int().min(0).optional(),
  amount_range_low_cents: z.number().int().min(0).optional(),
  amount_range_high_cents: z.number().int().min(0).optional(),
  valid_until: z.string().optional(),
  estimated_duration: z.string().max(100).optional(),
  warranty_terms: z.string().max(1000).optional(),
  status: z.enum(QUOTE_STATUSES).optional(),
  document_key: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

const quoteFiltersSchema = z.object({
  contractor_id: z.string().uuid().optional(),
  status: z.enum(QUOTE_STATUSES).optional(),
  expiring_soon: z.coerce.boolean().optional(),
});

const requestQuotesSchema = z.object({
  contractor_ids: z.array(z.string().uuid()).min(1).max(10),
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  linked_report_id: z.string().uuid().optional(),
  linked_task_id: z.string().uuid().optional(),
});

const compareQuotesSchema = z.object({
  quote_ids: z.array(z.string().uuid()).min(2).max(5),
});

const compareQuotesAISchema = z.object({
  quote_ids: z.array(z.string().uuid()).min(2).max(5),
  task_context: z.object({
    title: z.string(),
    description: z.string().optional(),
    category: z.string().optional(),
  }).optional(),
});

// ============ QUOTE ROUTES ============

/**
 * GET /households/:householdId/quotes
 * List all quotes
 */
quotesRouter.get('/', zValidator('query', quoteFiltersSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const filters = c.req.valid('query');
  const service = new QuoteService(c.env, c.env.DB);

  const quotes = await service.getQuotes(householdId, userId, {
    contractorId: filters.contractor_id,
    status: filters.status,
    expiringSoon: filters.expiring_soon,
  });

  return c.json({ quotes });
});

/**
 * GET /households/:householdId/quotes/pending
 * Get pending quotes (convenience endpoint)
 */
quotesRouter.get('/pending', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const service = new QuoteService(c.env, c.env.DB);

  const quotes = await service.getPendingQuotes(householdId, userId);

  return c.json({ quotes });
});

/**
 * GET /households/:householdId/quotes/:id
 * Get quote detail
 */
quotesRouter.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const quoteId = c.req.param('id');
  const service = new QuoteService(c.env, c.env.DB);

  const quote = await service.getQuote(householdId, quoteId!, userId);

  return c.json({ quote });
});

/**
 * POST /households/:householdId/quotes
 * Create a single quote
 */
quotesRouter.post('/', zValidator('json', createQuoteSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new QuoteService(c.env, c.env.DB);

  const quote = await service.createQuote(householdId, userId, {
    contractorId: input.contractor_id,
    title: input.title,
    description: input.description,
    amountCents: input.amount_cents,
    amountRangeLowCents: input.amount_range_low_cents,
    amountRangeHighCents: input.amount_range_high_cents,
    validUntil: input.valid_until,
    estimatedDuration: input.estimated_duration,
    warrantyTerms: input.warranty_terms,
    notes: input.notes,
    appointmentId: input.appointment_id,
    linkedReportId: input.linked_report_id,
    linkedTaskId: input.linked_task_id,
  });

  return c.json({ quote }, 201);
});

/**
 * POST /households/:householdId/quotes/request
 * Request quotes from multiple contractors
 */
quotesRouter.post('/request', zValidator('json', requestQuotesSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new QuoteService(c.env, c.env.DB);

  const quotes = await service.requestQuotes(householdId, userId, {
    contractorIds: input.contractor_ids,
    title: input.title,
    description: input.description,
    linkedReportId: input.linked_report_id,
    linkedTaskId: input.linked_task_id,
  });

  return c.json({ quotes }, 201);
});

/**
 * POST /households/:householdId/quotes/compare
 * Compare multiple quotes side by side (rule-based)
 */
quotesRouter.post('/compare', zValidator('json', compareQuotesSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const service = new QuoteService(c.env, c.env.DB);

  const comparison = await service.compareQuotes(householdId, userId, input.quote_ids);

  return c.json({ comparison });
});

/**
 * POST /households/:householdId/quotes/compare-ai
 * Compare multiple quotes using AI analysis
 */
quotesRouter.post('/compare-ai', zValidator('json', compareQuotesAISchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  await assertCanUseAI(userId, c.env);
  const input = c.req.valid('json');
  const service = new QuoteService(c.env, c.env.DB);

  const comparison = await service.compareQuotesWithAI(
    householdId,
    userId,
    input.quote_ids,
    input.task_context
  );

  return c.json({ comparison });
});

/**
 * PATCH /households/:householdId/quotes/:id
 * Update quote
 */
quotesRouter.patch('/:id', zValidator('json', updateQuoteSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const quoteId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new QuoteService(c.env, c.env.DB);

  const quote = await service.updateQuote(householdId, quoteId!, userId, {
    title: input.title,
    description: input.description,
    amountCents: input.amount_cents,
    amountRangeLowCents: input.amount_range_low_cents,
    amountRangeHighCents: input.amount_range_high_cents,
    validUntil: input.valid_until,
    estimatedDuration: input.estimated_duration,
    warrantyTerms: input.warranty_terms,
    status: input.status,
    documentKey: input.document_key,
    notes: input.notes,
  });

  return c.json({ quote });
});

/**
 * DELETE /households/:householdId/quotes/:id
 * Delete quote
 */
quotesRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const quoteId = c.req.param('id');
  const service = new QuoteService(c.env, c.env.DB);

  await service.deleteQuote(householdId, quoteId!, userId);

  return c.body(null, 204);
});

// ============ STATUS TRANSITION ROUTES ============

/**
 * POST /households/:householdId/quotes/:id/accept
 * Accept a quote
 */
quotesRouter.post('/:id/accept', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const quoteId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const createProject = body.create_project as boolean | undefined;
  const service = new QuoteService(c.env, c.env.DB);

  const result = await service.acceptQuote(householdId, quoteId!, userId, createProject);

  return c.json(result);
});

/**
 * POST /households/:householdId/quotes/:id/decline
 * Decline a quote
 */
quotesRouter.post('/:id/decline', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const quoteId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const reason = body.reason as string | undefined;
  const service = new QuoteService(c.env, c.env.DB);

  const quote = await service.declineQuote(householdId, quoteId!, userId, reason);

  return c.json({ quote });
});

/**
 * POST /households/:householdId/quotes/:id/mark-received
 * Mark quote as received (when contractor provides the quote)
 */
quotesRouter.post('/:id/mark-received', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const quoteId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const service = new QuoteService(c.env, c.env.DB);

  const quote = await service.markQuoteReceived(householdId, quoteId!, userId, {
    amountCents: body.amount_cents,
    amountRangeLowCents: body.amount_range_low_cents,
    amountRangeHighCents: body.amount_range_high_cents,
    validUntil: body.valid_until,
    estimatedDuration: body.estimated_duration,
    warrantyTerms: body.warranty_terms,
    documentKey: body.document_key,
  });

  return c.json({ quote });
});

/**
 * GET /households/:householdId/quotes/:id/document
 * Get a signed URL or stream the quote document
 */
quotesRouter.get('/:id/document', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const quoteId = c.req.param('id');
  const service = new QuoteService(c.env, c.env.DB);

  try {
    // Verify user has access to this quote
    const quote = await service.getQuote(householdId, quoteId!, userId);

    if (!quote.document_key) {
      return c.json({ error: 'No document attached to this quote' }, 404);
    }

    // Fetch the document from R2
    const object = await c.env.REPORTS_BUCKET.get(quote.document_key);

    if (!object) {
      return c.json({ error: 'Document not found in storage' }, 404);
    }

    // Get content type from metadata or infer from file extension
    const extension = quote.document_key.split('.').pop()?.toLowerCase();
    const contentType =
      extension === 'pdf' ? 'application/pdf' :
      extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' :
      extension === 'png' ? 'image/png' :
      extension === 'doc' || extension === 'docx' ? 'application/msword' :
      'application/octet-stream';

    // Stream the file to the client
    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${quote.document_key.split('/').pop()}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error: any) {
    console.error('[quotes] Error fetching document:', error);
    if (error.message === 'Quote not found' || error.message?.includes('not found')) {
      return c.json({ error: 'Quote not found' }, 404);
    }
    if (error.message?.includes('access') || error.message?.includes('forbidden')) {
      return c.json({ error: 'Access denied' }, 403);
    }
    return c.json({ error: 'Failed to fetch document' }, 500);
  }
});

export default quotesRouter;
