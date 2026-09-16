import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { RatingService } from '../services/rating-service';
import type { Env } from '../types';

const ratingsRouter = new Hono<{ Bindings: Env }>();

// All routes require authentication
ratingsRouter.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

// Helper to get contractorId from parent route param
function getContractorId(c: { req: { param: (key: string) => string | undefined } }): string {
  const contractorId = c.req.param('contractorId');
  if (!contractorId) throw new Error('Contractor ID is required');
  return contractorId;
}

// ============ VALIDATION SCHEMAS ============

const createRatingSchema = z.object({
  visit_id: z.string().uuid(),
  overall_rating: z.number().int().min(1).max(5),
  quality_rating: z.number().int().min(1).max(5).optional(),
  punctuality_rating: z.number().int().min(1).max(5).optional(),
  communication_rating: z.number().int().min(1).max(5).optional(),
  cleanliness_rating: z.number().int().min(1).max(5).optional(),
  value_rating: z.number().int().min(1).max(5).optional(),
  would_hire_again: z.boolean().optional(),
  review_text: z.string().max(5000).optional(),
  review_photos: z.array(z.string()).max(10).optional(),
  is_private: z.boolean().optional(),
});

const updateRatingSchema = z.object({
  overall_rating: z.number().int().min(1).max(5).optional(),
  quality_rating: z.number().int().min(1).max(5).optional(),
  punctuality_rating: z.number().int().min(1).max(5).optional(),
  communication_rating: z.number().int().min(1).max(5).optional(),
  cleanliness_rating: z.number().int().min(1).max(5).optional(),
  value_rating: z.number().int().min(1).max(5).optional(),
  would_hire_again: z.boolean().optional(),
  review_text: z.string().max(5000).optional(),
  review_photos: z.array(z.string()).max(10).optional(),
  is_private: z.boolean().optional(),
});

// ============ RATING ROUTES ============

/**
 * GET /households/:householdId/contractors/:contractorId/ratings
 * Get all ratings for a contractor
 */
ratingsRouter.get('/', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const contractorId = getContractorId(c);
  const service = new RatingService(c.env, c.env.DB);

  const ratings = await service.getRatingsForContractor(householdId, contractorId, userId);

  return c.json({ ratings });
});

/**
 * GET /households/:householdId/contractors/:contractorId/ratings/summary
 * Get rating summary for a contractor
 */
ratingsRouter.get('/summary', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const contractorId = getContractorId(c);
  const service = new RatingService(c.env, c.env.DB);

  const summary = await service.getContractorRatingSummary(householdId, contractorId, userId);

  return c.json({ summary });
});

/**
 * GET /households/:householdId/contractors/:contractorId/ratings/:ratingId
 * Get single rating
 */
ratingsRouter.get('/:ratingId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const ratingId = c.req.param('ratingId');
  const service = new RatingService(c.env, c.env.DB);

  const rating = await service.getRating(householdId, ratingId!, userId);

  return c.json({ rating });
});

/**
 * POST /households/:householdId/contractors/:contractorId/ratings
 * Create rating for contractor visit
 */
ratingsRouter.post('/', zValidator('json', createRatingSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const contractorId = getContractorId(c);
  const input = c.req.valid('json');
  const service = new RatingService(c.env, c.env.DB);

  const rating = await service.createRating(householdId, contractorId, userId, {
    visitId: input.visit_id,
    overallRating: input.overall_rating,
    qualityRating: input.quality_rating,
    punctualityRating: input.punctuality_rating,
    communicationRating: input.communication_rating,
    cleanlinessRating: input.cleanliness_rating,
    valueRating: input.value_rating,
    wouldHireAgain: input.would_hire_again,
    reviewText: input.review_text,
    reviewPhotos: input.review_photos,
    isPrivate: input.is_private,
  });

  return c.json({ rating }, 201);
});

/**
 * PATCH /households/:householdId/contractors/:contractorId/ratings/:ratingId
 * Update rating
 */
ratingsRouter.patch('/:ratingId', zValidator('json', updateRatingSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const ratingId = c.req.param('ratingId');
  const input = c.req.valid('json');
  const service = new RatingService(c.env, c.env.DB);

  const rating = await service.updateRating(householdId, ratingId!, userId, {
    overallRating: input.overall_rating,
    qualityRating: input.quality_rating,
    punctualityRating: input.punctuality_rating,
    communicationRating: input.communication_rating,
    cleanlinessRating: input.cleanliness_rating,
    valueRating: input.value_rating,
    wouldHireAgain: input.would_hire_again,
    reviewText: input.review_text,
    reviewPhotos: input.review_photos,
    isPrivate: input.is_private,
  });

  return c.json({ rating });
});

/**
 * DELETE /households/:householdId/contractors/:contractorId/ratings/:ratingId
 * Delete rating
 */
ratingsRouter.delete('/:ratingId', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const ratingId = c.req.param('ratingId');
  const service = new RatingService(c.env, c.env.DB);

  await service.deleteRating(householdId, ratingId!, userId);

  return c.body(null, 204);
});

export default ratingsRouter;
