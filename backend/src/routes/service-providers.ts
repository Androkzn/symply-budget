import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { ServiceProviderService } from '../services/service-provider-service';
import type { Env } from '../types';

const serviceProviders = new Hono<{ Bindings: Env }>();

// Public routes - providers can be viewed without auth
// But reviews require auth

/**
 * GET /service-providers
 * List service providers
 */
serviceProviders.get('/', async (c) => {
  const service = new ServiceProviderService(c.env, c.env.DB);
  const category = c.req.query('category');
  const service_area = c.req.query('service_area');
  const minRatingParam = c.req.query('min_rating');
  const parsedMinRating = minRatingParam ? parseFloat(minRatingParam) : undefined;
  const min_rating = parsedMinRating !== undefined && !isNaN(parsedMinRating) 
    ? Math.max(0, Math.min(5, parsedMinRating)) 
    : undefined;
  const is_verified = c.req.query('is_verified') === 'true';
  const search = c.req.query('search');

  const providers = await service.listProviders({
    category: category || undefined,
    service_area: service_area || undefined,
    min_rating: min_rating !== undefined ? min_rating : undefined,
    is_verified: c.req.query('is_verified') ? is_verified : undefined,
    search: search || undefined,
  });

  return c.json({ providers });
});

/**
 * GET /service-providers/:id/reviews
 * Get reviews for a service provider
 * Note: More specific route must come before /:id
 */
serviceProviders.get('/:id/reviews', async (c) => {
  const providerId = c.req.param('id');
  const service = new ServiceProviderService(c.env, c.env.DB);

  const reviews = await service.getReviews(providerId);

  return c.json({ reviews });
});

/**
 * GET /service-providers/:id
 * Get a single service provider
 */
serviceProviders.get('/:id', async (c) => {
  const providerId = c.req.param('id');
  const service = new ServiceProviderService(c.env, c.env.DB);

  const provider = await service.getProvider(providerId);

  return c.json({ provider });
});

// Authenticated routes
const authenticatedProviders = new Hono<{ Bindings: Env }>();
authenticatedProviders.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

const addReviewSchema = z.object({
  household_id: z.string().optional(),
  rating: z.number().min(1).max(5),
  review_text: z.string().optional(),
  service_date: z.string().optional(),
  cost: z.number().optional(),
});

/**
 * POST /households/:householdId/service-providers/:id/reviews
 * Add a review for a service provider
 */
authenticatedProviders.post('/:id/reviews', zValidator('json', addReviewSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const providerId = c.req.param('id');
  const input = c.req.valid('json');
  const service = new ServiceProviderService(c.env, c.env.DB);

  const review = await service.addReview(providerId, userId, {
    household_id: householdId,
    ...input,
  });

  return c.json({ review }, 201);
});

// Mount authenticated routes
serviceProviders.route('/households/:householdId', authenticatedProviders);

export default serviceProviders;
