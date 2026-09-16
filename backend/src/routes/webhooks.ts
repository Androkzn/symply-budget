import { Hono } from 'hono';

import {
  processLambdaReportCallback,
  processRevenueCatWebhook,
  updateLambdaReportProgress,
} from '../services/webhook-service';
import type { Env } from '../types';
import { safeErrorLog } from '../utils/log-scrubber';
import { verifySharedSecret } from '../utils/timing-safe-equal';

const webhooks = new Hono<{ Bindings: Env }>();

function isNonEmptyReportId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function isValidReportStatus(value: unknown): value is 'completed' | 'failed' {
  return value === 'completed' || value === 'failed';
}

function isValidProgress(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

webhooks.post('/lambda/report-processed', async (c) => {
  const body = await c.req.json();
  const { reportId, status, error: errorMessage, apiKey } = body;

  const auth = await verifySharedSecret(apiKey, c.env.LAMBDA_CALLBACK_API_KEY);
  if (auth === 'unconfigured') {
    return c.json({ error: 'Webhook not configured' }, 503);
  }
  if (auth === 'unauthorized') {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!isNonEmptyReportId(reportId) || !isValidReportStatus(status)) {
    return c.json({ error: 'Missing or invalid reportId or status' }, 400);
  }

  try {
    const result = await processLambdaReportCallback(c.env.DB, reportId, status, errorMessage);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404);
    }

    if (status === 'completed') {
      console.log(`[Lambda Callback] Report ${reportId} marked as completed`);
    } else {
      console.log(`[Lambda Callback] Report ${reportId} marked as failed: ${errorMessage}`);
    }

    return c.json({ success: true, reportId, status });
  } catch (error) {
    safeErrorLog('[Lambda Callback]', { requestId: c.get('requestId'), error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

webhooks.post('/lambda/report-progress', async (c) => {
  const body = await c.req.json();
  const { reportId, progress, stage, apiKey } = body;

  const auth = await verifySharedSecret(apiKey, c.env.LAMBDA_CALLBACK_API_KEY);
  if (auth === 'unconfigured') {
    return c.json({ error: 'Webhook not configured' }, 503);
  }
  if (auth === 'unauthorized') {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!isNonEmptyReportId(reportId) || !isValidProgress(progress)) {
    return c.json({ error: 'Missing or invalid reportId or progress (0–100)' }, 400);
  }

  try {
    const result = await updateLambdaReportProgress(c.env.DB, reportId, progress, stage);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404);
    }
    return c.json({ success: true });
  } catch (error) {
    safeErrorLog('[Lambda Progress]', { requestId: c.get('requestId'), error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

webhooks.post('/revenuecat', async (c) => {
  const expected = c.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected) {
    return c.json({ error: 'Webhook not configured' }, 503);
  }

  const auth = c.req.header('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!token || token.length !== expected.length) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const a = new TextEncoder().encode(token);
  const b = new TextEncoder().encode(expected);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i]! ^ b[i]!;
  if (mismatch !== 0) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{
    api_version?: string;
    event?: { id?: string; type?: string; app_user_id?: string; app_id?: string };
  }>();

  const eventId = body.event?.id;
  const eventType = body.event?.type ?? 'unknown';
  const appUserId = body.event?.app_user_id;
  const appId = body.event?.app_id;

  if (!eventId) {
    return c.json({ error: 'Missing event.id' }, 400);
  }

  const result = await processRevenueCatWebhook(c.env, {
    eventId,
    eventType,
    appUserId,
    appId,
  });

  if (!result.ok) {
    return c.json({ error: result.error }, result.status as 503);
  }

  if (result.duplicate) {
    return c.json({ ok: true, duplicate: true });
  }
  if (result.ignored) {
    return c.json({ ok: true, ignored: result.ignored });
  }

  return c.json({ ok: true });
});

export default webhooks;
