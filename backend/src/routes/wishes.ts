import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { requireBudgetApi } from '../middleware/brand-gate';
import { rejectFinancialWritesForLocalFirst } from '../middleware/budget-local-first-gate';
import { WishesService } from '../services/wishes-service';
import type { Env } from '../types';

const wishes = new Hono<{ Bindings: Env }>();

wishes.use(requireBudgetApi());
wishes.use('/*', rejectFinancialWritesForLocalFirst());

// All routes require authentication
wishes.use('/*', authMiddleware());

function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

const createWishSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  estimated_cost_cents: z.number().int().min(0).max(1_000_000_000).optional(),
  target_date: z.string().max(10).optional(),
});

const updateWishSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  estimated_cost_cents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  target_date: z.string().max(10).nullable().optional(),
  status: z.enum(['active', 'achieved', 'archived']).optional(),
  cover_image_key: z.string().max(500).nullable().optional(),
});

const addEntrySchema = z.object({
  kind: z.enum(['note', 'image', 'link']),
  body: z.string().max(4000).optional(),
  image_key: z.string().max(500).optional(),
  url: z.string().url().max(2000).optional(),
  link_title: z.string().max(300).optional(),
  price_cents: z.number().int().min(0).max(1_000_000_000).optional(),
  parent_entry_id: z.string().max(100).optional(),
});

const updateEntrySchema = z.object({
  body: z.string().max(4000).nullable().optional(),
  url: z.string().url().max(2000).optional(),
  link_title: z.string().max(300).nullable().optional(),
  price_cents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
});

/**
 * GET /households/:householdId/wishes
 * List wishes (optionally filtered by status).
 */
wishes.get('/', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const statusParam = c.req.query('status');
  const status =
    statusParam === 'active' || statusParam === 'achieved' || statusParam === 'archived'
      ? statusParam
      : undefined;

  const service = new WishesService(c.env, c.env.DB);
  const items = await service.listWishes(householdId, userId, { status });

  return c.json({ wishes: items });
});

/**
 * POST /households/:householdId/wishes
 * Create a wish.
 */
wishes.post('/', zValidator('json', createWishSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');

  const service = new WishesService(c.env, c.env.DB);
  const wish = await service.createWish(householdId, userId, {
    title: input.title,
    notes: input.notes,
    estimatedCostCents: input.estimated_cost_cents,
    targetDate: input.target_date,
  });

  return c.json({ wish }, 201);
});

/**
 * GET /households/:householdId/wishes/:id
 * A single wish plus its ordered entry feed.
 */
wishes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const wishId = c.req.param('id');

  const service = new WishesService(c.env, c.env.DB);
  const wish = await service.getWish(householdId, wishId, userId);

  return c.json({ wish });
});

/**
 * PATCH /households/:householdId/wishes/:id
 * Update wish fields (title, notes, cost, target, status, cover).
 */
wishes.patch('/:id', zValidator('json', updateWishSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const wishId = c.req.param('id');
  const input = c.req.valid('json');

  const service = new WishesService(c.env, c.env.DB);
  const wish = await service.updateWish(householdId, wishId, userId, {
    title: input.title,
    notes: input.notes,
    estimatedCostCents: input.estimated_cost_cents,
    targetDate: input.target_date,
    status: input.status,
    coverImageKey: input.cover_image_key,
  });

  return c.json({ wish });
});

/**
 * DELETE /households/:householdId/wishes/:id
 */
wishes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const wishId = c.req.param('id');

  const service = new WishesService(c.env, c.env.DB);
  await service.deleteWish(householdId, wishId, userId);

  return c.body(null, 204);
});

/**
 * POST /households/:householdId/wishes/:id/image
 * Multipart image upload for a wish; returns the R2 key to attach as an entry.
 */
wishes.post('/:id/image', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const wishId = c.req.param('id');

  const formData = await c.req.formData();
  const file = formData.get('image') as File | null;
  if (!file) {
    return c.json({ error: 'No image provided' }, 400);
  }

  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const contentType = file.type || 'image/jpeg';
  if (!allowed.includes(contentType)) {
    return c.json({ error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP' }, 400);
  }

  const service = new WishesService(c.env, c.env.DB);
  const data = await file.arrayBuffer();
  const result = await service.uploadImage(householdId, wishId, userId, data, contentType);

  return c.json(result, 201);
});

/**
 * POST /households/:householdId/wishes/:id/entries
 * Append a note / image / link entry to the wish's feed.
 */
wishes.post('/:id/entries', zValidator('json', addEntrySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const wishId = c.req.param('id');
  const input = c.req.valid('json');

  const service = new WishesService(c.env, c.env.DB);
  const entry = await service.addEntry(householdId, wishId, userId, {
    kind: input.kind,
    body: input.body,
    imageKey: input.image_key,
    url: input.url,
    linkTitle: input.link_title,
    priceCents: input.price_cents,
    parentEntryId: input.parent_entry_id,
  });

  return c.json({ entry }, 201);
});

/**
 * PATCH /households/:householdId/wishes/:id/entries/:entryId
 * Edit an existing feed item (note text, link url/title, price).
 */
wishes.patch('/:id/entries/:entryId', zValidator('json', updateEntrySchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const wishId = c.req.param('id');
  const entryId = c.req.param('entryId');
  const input = c.req.valid('json');

  const service = new WishesService(c.env, c.env.DB);
  const entry = await service.updateEntry(householdId, wishId, entryId, userId, {
    body: input.body,
    url: input.url,
    linkTitle: input.link_title,
    priceCents: input.price_cents,
  });

  return c.json({ entry });
});

/**
 * DELETE /households/:householdId/wishes/:id/entries/:entryId
 */
wishes.delete('/:id/entries/:entryId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const wishId = c.req.param('id');
  const entryId = c.req.param('entryId');

  const service = new WishesService(c.env, c.env.DB);
  await service.deleteEntry(householdId, wishId, entryId, userId);

  return c.body(null, 204);
});

export default wishes;
