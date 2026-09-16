/**
 * Aihousekeeper attachments — files the user attaches inside the Aihousekeeper chat flow
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import { rateLimitDO } from '../middleware/rate-limit';
import { AihousekeeperAttachmentService } from '../services/aihousekeeper/attachment-service';
import { HouseholdService } from '../services/household-service';
import type { Env } from '../types';
import { ValidationError } from '../utils/errors';

const aihousekeeperAttachmentsRouter = new Hono<{ Bindings: Env }>();

aihousekeeperAttachmentsRouter.use('/*', authMiddleware());

function getHouseholdId(c: {
  req: { param: (k: string) => string | undefined };
}): string {
  const hid = c.req.param('householdId');
  if (!hid) {
    throw new ValidationError({ householdId: ['missing householdId param'] });
  }
  return hid;
}

function attachmentService(c: { env: Env }) {
  return new AihousekeeperAttachmentService(c.env, c.env.DB);
}

const uploadUrlSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  size: z.number().int().positive().max(25 * 1024 * 1024).optional(),
  kindHint: z.string().max(64).optional(),
});

aihousekeeperAttachmentsRouter.post(
  '/upload-url',
  rateLimitDO('aihousekeeper:default'),
  zValidator('json', uploadUrlSchema),
  async (c) => {
    const householdId = getHouseholdId(c);
    const userId = c.get('userId');
    const householdService = new HouseholdService(c.env, c.env.DB);
    await householdService.getHousehold(householdId, userId);

    const input = c.req.valid('json');
    const service = attachmentService(c);
    service.assertAllowedMime(input.mimeType);

    const result = await service.createUploadRecord(householdId, userId, {
      fileName: input.fileName,
      mimeType: input.mimeType,
      size: input.size,
      kindHint: input.kindHint,
    });

    return c.json(result);
  }
);

aihousekeeperAttachmentsRouter.put('/:id/upload', async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const attachmentId = c.req.param('id');
  if (!attachmentId) {
    throw new ValidationError({ id: ['missing attachment id'] });
  }

  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const service = attachmentService(c);
  const row = await service.getAttachmentForUpload(householdId, userId, attachmentId);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) {
    throw new ValidationError({ body: ['empty file'] });
  }
  if (body.byteLength > service.maxSizeBytes) {
    throw new ValidationError({
      body: [`file too large (${body.byteLength} > ${service.maxSizeBytes})`],
    });
  }

  const contentType = c.req.header('content-type') || row.mime_type;
  await c.env.REPORTS_BUCKET.put(row.r2_key, body, {
    httpMetadata: { contentType },
  });

  const result = await service.markUploaded(attachmentId, body, contentType);
  return c.json(result);
});

aihousekeeperAttachmentsRouter.get('/:id', rateLimitDO('aihousekeeper:read'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const attachmentId = c.req.param('id');
  if (!attachmentId) {
    throw new ValidationError({ id: ['missing attachment id'] });
  }

  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const row = await attachmentService(c).getAttachment(householdId, attachmentId);
  return c.json({ attachment: row });
});

aihousekeeperAttachmentsRouter.get('/', rateLimitDO('aihousekeeper:read'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const rows = await attachmentService(c).listAttachments(householdId);
  return c.json({ attachments: rows });
});

aihousekeeperAttachmentsRouter.delete('/:id', rateLimitDO('aihousekeeper:default'), async (c) => {
  const householdId = getHouseholdId(c);
  const userId = c.get('userId');
  const attachmentId = c.req.param('id');
  if (!attachmentId) {
    throw new ValidationError({ id: ['missing attachment id'] });
  }

  const householdService = new HouseholdService(c.env, c.env.DB);
  await householdService.getHousehold(householdId, userId);

  const result = await attachmentService(c).deleteAttachment(householdId, userId, attachmentId);
  return c.json(result);
});

export default aihousekeeperAttachmentsRouter;
