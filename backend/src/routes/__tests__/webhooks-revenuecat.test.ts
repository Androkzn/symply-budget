import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { revenuecatWebhookEvents } from '../../db/schema-ai-credentials';
import { syncRevenueCatSubscription } from '../../services/revenuecat-sync';
import type { Env } from '../../types';
import webhooks from '../webhooks';

const testEnv = env as unknown as Env;
const WEBHOOK_SECRET = 'rc-webhook-test-secret-32chars!!';

vi.mock('../../services/revenuecat-sync', () => ({
  syncRevenueCatSubscription: vi.fn(),
}));


async function createRevenueCatLedgerTable(): Promise<void> {
  await testEnv.DB.prepare(
    `CREATE TABLE IF NOT EXISTS revenuecat_webhook_events (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      app_user_id TEXT,
      processed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  ).run();
}

function buildApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/webhooks', webhooks);
  return app;
}

describe('POST /webhooks/revenuecat', () => {
  beforeEach(async () => {
    await createRevenueCatLedgerTable();
    await testEnv.DB.prepare('DELETE FROM revenuecat_webhook_events').run();
    vi.mocked(syncRevenueCatSubscription).mockReset();
    testEnv.REVENUECAT_WEBHOOK_AUTH = WEBHOOK_SECRET;
    testEnv.REVENUECAT_SECRET_API_KEY = 'rc-secret-key';
  });

  it('leaves processed_at null when subscription sync throws (transient)', async () => {
    vi.mocked(syncRevenueCatSubscription).mockRejectedValue(new Error('RC API timeout'));

    const app = buildApp();
    const res = await app.request(
      '/webhooks/revenuecat',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WEBHOOK_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: {
            id: 'evt-transient-1',
            type: 'INITIAL_PURCHASE',
            app_user_id: 'user-rc-1',
          },
        }),
      },
      testEnv
    );

    expect(res.status).toBe(503);

    const row = await drizzle(testEnv.DB, { schema: { revenuecatWebhookEvents } })
      .select()
      .from(revenuecatWebhookEvents)
      .where(eq(revenuecatWebhookEvents.event_id, 'evt-transient-1'))
      .get();
    expect(row).toBeDefined();
    expect(row?.processed_at).toBeNull();
  });

  it('sets processed_at after a successful subscription sync', async () => {
    vi.mocked(syncRevenueCatSubscription).mockResolvedValue({
      subscription: {} as never,
      is_paid: true,
      can_use_ai: true,
      denial_reason: null,
    });

    const app = buildApp();
    const res = await app.request(
      '/webhooks/revenuecat',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WEBHOOK_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: {
            id: 'evt-ok-1',
            type: 'RENEWAL',
            app_user_id: 'user-rc-2',
          },
        }),
      },
      testEnv
    );

    expect(res.status).toBe(200);

    const row = await drizzle(testEnv.DB, { schema: { revenuecatWebhookEvents } })
      .select()
      .from(revenuecatWebhookEvents)
      .where(eq(revenuecatWebhookEvents.event_id, 'evt-ok-1'))
      .get();
    expect(row?.processed_at).not.toBeNull();
  });
});
