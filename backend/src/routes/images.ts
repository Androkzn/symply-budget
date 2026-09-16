import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { ImageExtractionService } from '../services/image-extraction-service';
import type { Env } from '../types';

const images = new Hono<{ Bindings: Env }>();

// All routes require authentication
images.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

/**
 * GET /households/:householdId/reports/:reportId/images
 * List all images for a report
 */
images.get('/reports/:reportId/images', async (c) => {
  getHouseholdId(c);
  const reportId = c.req.param('reportId')!;
  const { page_number, system_category, limit, offset } = c.req.query();

  const service = new ImageExtractionService(c.env, c.env.DB);

  const imageList = await service.getReportImages(reportId, {
    page_number: page_number ? parseInt(page_number) : undefined,
    system_category,
    limit: limit ? parseInt(limit) : undefined,
    offset: offset ? parseInt(offset) : undefined,
  });

  return c.json({ images: imageList });
});

/**
 * GET /households/:householdId/images/:imageId
 * Get a single image metadata
 */
images.get('/images/:imageId', async (c) => {
  const imageId = c.req.param('imageId')!;
  const service = new ImageExtractionService(c.env, c.env.DB);

  const image = await service.getImage(imageId);

  if (!image) {
    return c.json({ error: 'Image not found' }, 404);
  }

  return c.json({ image });
});

/**
 * GET /households/:householdId/findings/:findingId/images
 * Get images linked to a finding
 */
images.get('/findings/:findingId/images', async (c) => {
  const findingId = c.req.param('findingId')!;
  const service = new ImageExtractionService(c.env, c.env.DB);

  const imageList = await service.getImagesForFinding(findingId);

  return c.json({ images: imageList });
});

/**
 * POST /households/:householdId/reports/:reportId/images
 * Upload an image for a report
 */
images.post('/reports/:reportId/images', async (c) => {
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('reportId')!;

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  const pageNumber = formData.get('page_number');
  const systemCategory = formData.get('system_category');
  const imageType = formData.get('image_type');

  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  // Validate content type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP' }, 400);
  }

  // Limit file size to 10MB
  if (file.size > 10 * 1024 * 1024) {
    return c.json({ error: 'File too large. Maximum size: 10MB' }, 400);
  }

  const service = new ImageExtractionService(c.env, c.env.DB);
  const imageData = await file.arrayBuffer();

  const result = await service.uploadImage(reportId, householdId, imageData, file.type, {
    page_number: pageNumber ? parseInt(pageNumber as string) : undefined,
    original_filename: file.name,
    system_category: systemCategory as string | undefined,
    image_type: imageType as 'photo' | 'chart' | 'table' | 'diagram' | 'other' | undefined,
  });

  return c.json({ image: result }, 201);
});

const updateImageSchema = z.object({
  caption: z.string().optional(),
  ai_description: z.string().optional(),
  system_category: z.string().optional(),
  image_type: z.enum(['photo', 'chart', 'table', 'diagram', 'other']).optional(),
});

/**
 * PATCH /households/:householdId/images/:imageId
 * Update image metadata
 */
images.patch('/images/:imageId', zValidator('json', updateImageSchema), async (c) => {
  const imageId = c.req.param('imageId')!;
  const updates = c.req.valid('json');

  const service = new ImageExtractionService(c.env, c.env.DB);
  await service.updateImageMetadata(imageId, updates);

  const image = await service.getImage(imageId);
  return c.json({ image });
});

const linkToFindingSchema = z.object({
  finding_id: z.string(),
});

/**
 * POST /households/:householdId/images/:imageId/link
 * Link an image to a finding
 */
images.post('/images/:imageId/link', zValidator('json', linkToFindingSchema), async (c) => {
  const imageId = c.req.param('imageId')!;
  const { finding_id } = c.req.valid('json');

  const service = new ImageExtractionService(c.env, c.env.DB);
  const success = await service.linkImageToFinding(imageId, finding_id);

  if (!success) {
    return c.json({ error: 'Image not found' }, 404);
  }

  return c.json({ success: true });
});

/**
 * DELETE /households/:householdId/images/:imageId
 * Delete an image
 */
images.delete('/images/:imageId', async (c) => {
  const imageId = c.req.param('imageId')!;
  const service = new ImageExtractionService(c.env, c.env.DB);

  const success = await service.deleteImage(imageId);

  if (!success) {
    return c.json({ error: 'Image not found' }, 404);
  }

  return c.json({ success: true });
});

export default images;

/**
 * Separate router for serving images directly (no auth for public images)
 * This is mounted at /api/images for serving image files
 */
export const imageServing = new Hono<{ Bindings: Env }>();

/**
 * GET /api/images/:imageKey
 * Serve an image file from R2
 */
imageServing.get('/:imageKey{.*}', async (c) => {
  const imageKey = c.req.param('imageKey');

  if (!imageKey) {
    return c.json({ error: 'Image key required' }, 400);
  }

  const decodedKey = decodeURIComponent(imageKey);
  const object = await c.env.REPORTS_BUCKET.get(decodedKey);

  if (!object) {
    return c.json({ error: 'Image not found' }, 404);
  }

  const data = await object.arrayBuffer();
  const contentType = object.httpMetadata?.contentType || 'image/jpeg';

  return new Response(data, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
    },
  });
});
