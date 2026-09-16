import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth';
import { HouseholdSpaceService } from '../services/household-space-service';
import type { Env } from '../types';
import {
  createHouseholdSpaceSchema,
  updateHouseholdSpaceSchema,
  reorderSpacesSchema,
  bulkCreateSpacesSchema,
} from '../utils/validation';

const householdSpaces = new Hono<{ Bindings: Env }>();

// All household space routes require authentication
householdSpaces.use('/*', authMiddleware());

/**
 * GET /households/:householdId/spaces - List all spaces for a household
 */
householdSpaces.get('/:householdId/spaces', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('householdId');
  const category = c.req.query('category');
  const floorLevel = c.req.query('floor_level');

  const service = new HouseholdSpaceService(c.env, c.env.DB);
  const spaces = await service.listSpaces(householdId, userId, {
    category,
    floor_level: floorLevel ? parseInt(floorLevel) : undefined,
  });

  return c.json({ spaces });
});

/**
 * GET /households/:householdId/spaces/presets - Get preset space templates
 */
householdSpaces.get('/:householdId/spaces/presets', async (c) => {
  const service = new HouseholdSpaceService(c.env, c.env.DB);
  const templates = service.getPresetTemplates();

  return c.json({ templates });
});

/**
 * POST /households/:householdId/spaces - Create a new space
 */
householdSpaces.post(
  '/:householdId/spaces',
  zValidator('json', createHouseholdSpaceSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = c.req.param('householdId');
    const input = c.req.valid('json');

    const service = new HouseholdSpaceService(c.env, c.env.DB);
    const space = await service.createSpace(householdId, userId, input);

    return c.json({ space }, 201);
  }
);

/**
 * POST /households/:householdId/spaces/bulk - Create multiple spaces from template
 */
householdSpaces.post(
  '/:householdId/spaces/bulk',
  zValidator('json', bulkCreateSpacesSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = c.req.param('householdId');
    const { template_type } = c.req.valid('json');

    const service = new HouseholdSpaceService(c.env, c.env.DB);
    const spaces = await service.bulkCreateFromTemplate(
      householdId,
      userId,
      template_type
    );

    return c.json({ spaces }, 201);
  }
);

/**
 * GET /households/:householdId/spaces/:id - Get a single space
 */
householdSpaces.get('/:householdId/spaces/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('householdId');
  const spaceId = c.req.param('id');

  const service = new HouseholdSpaceService(c.env, c.env.DB);
  const space = await service.getSpace(householdId, spaceId, userId);

  return c.json({ space });
});

/**
 * PATCH /households/:householdId/spaces/:id - Update a space
 */
householdSpaces.patch(
  '/:householdId/spaces/:id',
  zValidator('json', updateHouseholdSpaceSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = c.req.param('householdId');
    const spaceId = c.req.param('id');
    const input = c.req.valid('json');

    const service = new HouseholdSpaceService(c.env, c.env.DB);
    const space = await service.updateSpace(householdId, spaceId, userId, input);

    return c.json({ space });
  }
);

/**
 * DELETE /households/:householdId/spaces/:id - Delete a space
 */
householdSpaces.delete('/:householdId/spaces/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = c.req.param('householdId');
  const spaceId = c.req.param('id');
  const versionParam = c.req.query('version');
  const expectedVersion =
    versionParam !== undefined && versionParam !== ''
      ? Number.parseInt(versionParam, 10)
      : undefined;

  const service = new HouseholdSpaceService(c.env, c.env.DB);
  await service.deleteSpace(
    householdId,
    spaceId,
    userId,
    Number.isFinite(expectedVersion) ? expectedVersion : undefined
  );

  return c.body(null, 204);
});

/**
 * POST /households/:householdId/spaces/reorder - Reorder spaces
 */
householdSpaces.post(
  '/:householdId/spaces/reorder',
  zValidator('json', reorderSpacesSchema),
  async (c) => {
    const userId = c.get('userId');
    const householdId = c.req.param('householdId');
    const { space_orders } = c.req.valid('json');

    const service = new HouseholdSpaceService(c.env, c.env.DB);
    await service.reorderSpaces(householdId, userId, space_orders);

    return c.json({ success: true });
  }
);

/**
 * GET /api/space-images/:imageKey - Serve space image from R2
 * Note: This endpoint is at the root level, not under /households
 */
const spaceImageProxy = new Hono<{ Bindings: Env }>();
spaceImageProxy.get('/space-images/:imageKey', async (c) => {
  const imageKey = c.req.param('imageKey');

  try {
    const object = await c.env.REPORTS_BUCKET.get(`space-images/${imageKey}`);

    if (!object) {
      return c.json({ error: { code: 'not_found', message: 'Image not found' } }, 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('ETag', object.httpEtag);

    return new Response(object.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Error serving space image:', error);
    return c.json({ error: { code: 'internal_error', message: 'Failed to load image' } }, 500);
  }
});

export default householdSpaces;
export { spaceImageProxy };
