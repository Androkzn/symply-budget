import { eq } from 'drizzle-orm';

import * as schema from '../db/schema';
import type { Env } from '../types';
import { now } from '../utils/id';

import { createDb } from './db';

export async function processLambdaReportCallback(
  d1: D1Database,
  reportId: string,
  status: 'completed' | 'failed',
  errorMessage?: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const db = createDb(d1);

  const report = await db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .get();

  if (!report) {
    return { ok: false, status: 404, error: 'Report not found' };
  }

  if (status === 'completed') {
    await db
      .update(schema.reports)
      .set({
        status: 'completed',
        processing_completed_at: now(),
        processing_progress: 100,
        processing_stage: 'complete',
        updated_at: now(),
      })
      .where(eq(schema.reports.id, reportId));
  } else {
    await db
      .update(schema.reports)
      .set({
        status: 'failed',
        error_message: errorMessage || 'Processing failed in Lambda',
        updated_at: now(),
      })
      .where(eq(schema.reports.id, reportId));
  }

  return { ok: true };
}

export async function updateLambdaReportProgress(
  d1: D1Database,
  reportId: string,
  progress: number,
  stage?: string | null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const db = createDb(d1);

  const report = await db
    .select({ id: schema.reports.id })
    .from(schema.reports)
    .where(eq(schema.reports.id, reportId))
    .get();

  if (!report) {
    return { ok: false, status: 404, error: 'Report not found' };
  }

  await db
    .update(schema.reports)
    .set({
      processing_progress: progress,
      processing_stage: stage || null,
      updated_at: now(),
    })
    .where(eq(schema.reports.id, reportId));

  return { ok: true };
}

export type RevenueCatWebhookResult =
  | { ok: true; duplicate?: boolean; ignored?: string }
  | { ok: false; status: number; error: string; retryable?: boolean };

export async function processRevenueCatWebhook(
  env: Env,
  input: {
    eventId: string;
    eventType: string;
    appUserId?: string;
    appId?: string;
  }
): Promise<RevenueCatWebhookResult> {
  const brandAppIds = (env.REVENUECAT_APP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (brandAppIds.length > 0 && input.appId && !brandAppIds.includes(input.appId)) {
    return { ok: true, ignored: 'app_not_in_brand' };
  }

  const db = createDb(env.DB);
  const existing = await db
    .select()
    .from(schema.revenuecatWebhookEvents)
    .where(eq(schema.revenuecatWebhookEvents.event_id, input.eventId))
    .get();

  if (existing?.processed_at) {
    return { ok: true, duplicate: true };
  }

  if (!existing) {
    await db.insert(schema.revenuecatWebhookEvents).values({
      id: crypto.randomUUID(),
      event_id: input.eventId,
      event_type: input.eventType,
      app_user_id: input.appUserId ?? null,
      created_at: now(),
    });
  }

  if (input.appUserId && env.REVENUECAT_SECRET_API_KEY) {
    try {
      const { syncRevenueCatSubscription } = await import('./revenuecat-sync');
      await syncRevenueCatSubscription(input.appUserId, env);
    } catch (err) {
      console.error('[RevenueCat webhook] sync failed', (err as Error).message);
      return { ok: false, status: 503, error: 'Subscription sync failed', retryable: true };
    }
  }

  await db
    .update(schema.revenuecatWebhookEvents)
    .set({ processed_at: now() })
    .where(eq(schema.revenuecatWebhookEvents.event_id, input.eventId));

  return { ok: true };
}
