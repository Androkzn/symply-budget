/**
 * Settings Routes
 * API endpoints for user and household settings management
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import * as settingsController from '../controllers/settingsController';
import { authMiddleware } from '../middleware/auth';

const settingsRouter = new Hono();

// Apply auth middleware to all routes
settingsRouter.use('/*', authMiddleware());

/**
 * GET /api/settings
 * Fetch all settings for the authenticated user
 */
settingsRouter.get('/', async (c: Context) => {
  try {
    const userId = c.get('userId');
    const householdId = c.get('householdId');

    const settings = await settingsController.fetchAllSettings(c.env.DB, userId, householdId);

    return c.json({
      settings,
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return c.json(
      {
        error: 'Failed to fetch settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/settings/sync
 * Sync local settings with backend (two-way sync)
 */
const SyncRequestSchema = z.object({
  settings: z.array(
    z.object({
      key: z.string(),
      value: z.any(),
      updated_at: z.string(),
    })
  ),
  last_synced_at: z.string().nullable().optional(),
});

settingsRouter.post('/sync', async (c: Context) => {
  try {
    const userId = c.get('userId');
    const householdId = c.get('householdId');
    const body = await c.req.json();
    
    const { settings, last_synced_at } = SyncRequestSchema.parse(body);

    const result = await settingsController.syncSettings(
      c.env.DB,
      userId,
      householdId,
      settings,
      last_synced_at
    );

    return c.json(result);
  } catch (error) {
    console.error('Error syncing settings:', error);
    return c.json(
      {
        error: 'Failed to sync settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * PUT /api/settings/bulk
 * Update multiple settings (must be registered before /:key)
 */
settingsRouter.put('/bulk', async (c: Context) => {
  try {
    const userId = c.get('userId');
    const householdId = c.get('householdId');
    const body = await c.req.json();
    
    const { settings } = z.object({
      settings: z.array(
        z.object({
          key: z.string(),
          value: z.any(),
        })
      ),
    }).parse(body);

    for (const setting of settings) {
      await settingsController.updateSetting(
        c.env.DB,
        userId,
        householdId,
        setting.key,
        setting.value
      );
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error updating settings:', error);
    return c.json(
      {
        error: 'Failed to update settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * PUT /api/settings/:key
 * Update a single setting
 */
settingsRouter.put('/:key', async (c: Context) => {
  try {
    const userId = c.get('userId');
    const householdId = c.get('householdId');
    const key = c.req.param('key')!;
    const body = await c.req.json();
    
    const { value } = z.object({ value: z.any() }).parse(body);

    const setting = await settingsController.updateSetting(
      c.env.DB,
      userId,
      householdId,
      key,
      value
    );

    return c.json({ setting });
  } catch (error) {
    console.error('Error updating setting:', error);
    return c.json(
      {
        error: 'Failed to update setting',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * DELETE /api/settings/:key
 * Delete a setting
 */
settingsRouter.delete('/:key', async (c: Context) => {
  try {
    const userId = c.get('userId');
    const householdId = c.get('householdId');
    const key = c.req.param('key')!;

    await settingsController.deleteSetting(c.env.DB, userId, householdId, key);

    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting setting:', error);
    return c.json(
      {
        error: 'Failed to delete setting',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/settings/reset
 * Reset all settings to defaults
 */
settingsRouter.post('/reset', async (c: Context) => {
  try {
    const userId = c.get('userId');
    const householdId = c.get('householdId');

    const allSettings = await settingsController.fetchAllSettings(
      c.env.DB,
      userId,
      householdId
    );

    for (const setting of allSettings) {
      await settingsController.deleteSetting(
        c.env.DB,
        userId,
        householdId,
        setting.key
      );
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error resetting settings:', error);
    return c.json(
      {
        error: 'Failed to reset settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export default settingsRouter;
