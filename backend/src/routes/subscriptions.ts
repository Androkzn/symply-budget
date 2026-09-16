import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth';
import {
  getSubscriptionForEntitlement,
  isEffectivelyPaid,
  resolveAIEntitlement,
} from '../services/entitlement-service';
import { SubscriptionService } from '../services/subscription-service';
import type { Env } from '../types';
import { GoneError } from '../utils/errors';

const subscriptionsRouter = new Hono<{ Bindings: Env }>();

subscriptionsRouter.use('/*', authMiddleware());

/** Apple IAP / RevenueCat is the only paid path — Stripe stubs retired. */
const PLANS = [
  {
    id: 'pro',
    tier: 'pro',
    name: 'SimpleHouse Pro',
    price: null as number | null,
    interval: 'month' as const,
    features: [
      'SimpleHouse-managed AI (Mira, reports, drafts)',
      'Apple App Store billing',
      'Manage or cancel in Apple Settings → Subscriptions',
    ],
    manage_via: 'apple_storekit',
  },
];

/**
 * GET /subscriptions/me — subscription + server-computed entitlement snapshot.
 */
subscriptionsRouter.get('/me', async (c) => {
  const userId = c.get('userId');
  const userEmail = c.get('userEmail');
  if (!userId) {
    return c.json({ error: { code: 'unauthorized', message: 'User not authenticated' } }, 401);
  }

  try {
    const row = await getSubscriptionForEntitlement(c.env.DB, userId);
    const entitlement = await resolveAIEntitlement(userId, c.env, {
      subscription: row,
      userEmail,
    });
    const isPaid = isEffectivelyPaid(row, userEmail);

    // Materialize free row only for clients that still expect a subscription object.
    const subscriptionService = new SubscriptionService(c.env.DB);
    const subscription = row ?? (await subscriptionService.getUserSubscription(userId));

    return c.json({
      subscription: {
        ...subscription,
        provider: (subscription as { provider?: string | null }).provider ?? null,
        entitlement_id: (subscription as { entitlement_id?: string | null }).entitlement_id ?? null,
        billing_state: (subscription as { billing_state?: string | null }).billing_state ?? null,
      },
      is_paid: isPaid,
      can_use_ai: entitlement.allowed,
      denial_reason: entitlement.allowed ? null : entitlement.reason,
      access_source: entitlement.allowed ? entitlement.source : null,
    });
  } catch (error: unknown) {
    console.error('[Subscriptions] Error fetching subscription:', (error as Error).message);
    return c.json(
      { error: { code: 'internal_error', message: 'Failed to fetch subscription' } },
      500
    );
  }
});

subscriptionsRouter.get('/plans', async (c) => {
  return c.json({ plans: PLANS });
});

/**
 * GET /subscriptions/limits — legacy shape; hasAdvancedAI derives from entitlement.
 */
subscriptionsRouter.get('/limits', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: { code: 'unauthorized', message: 'User not authenticated' } }, 401);
  }

  try {
    const subscriptionService = new SubscriptionService(c.env.DB);
    const limits = await subscriptionService.getUsageLimits(userId, c.env);
    return c.json({ limits });
  } catch (error: unknown) {
    console.error('[Subscriptions] Error fetching limits:', (error as Error).message);
    return c.json(
      { error: { code: 'internal_error', message: 'Failed to fetch usage limits' } },
      500
    );
  }
});

/** Stripe checkout retired — use Apple IAP /ai-access/paywall. */
subscriptionsRouter.post('/checkout', () => {
  throw new GoneError(
    'Stripe checkout is retired. Use Apple In-App Purchase via /ai-access/paywall and POST /subscriptions/sync.'
  );
});

/** Stripe portal retired — manage via Apple Settings. */
subscriptionsRouter.post('/portal', () => {
  throw new GoneError(
    'Billing portal is retired. Manage subscriptions in Apple Settings → Subscriptions, or open /ai-access.'
  );
});

/** D1 cancel retired — StoreKit owns cancellation. */
subscriptionsRouter.post('/cancel', () => {
  throw new GoneError(
    'Server-side cancel is retired. Cancel in Apple Settings → Subscriptions. Mira cannot cancel App Store billing.'
  );
});

/** D1 reactivate retired. */
subscriptionsRouter.post('/reactivate', () => {
  throw new GoneError(
    'Server-side reactivate is retired. Reactivate or restore via Apple / the in-app paywall.'
  );
});

/** Alias some clients still call. */
subscriptionsRouter.post('/resume', () => {
  throw new GoneError(
    'Server-side resume is retired. Restore purchases on the Unlock AI / paywall screen.'
  );
});

/**
 * POST /subscriptions/sync — pull canonical RevenueCat state into D1.
 */
subscriptionsRouter.post('/sync', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: { code: 'unauthorized', message: 'User not authenticated' } }, 401);
  }

  if (!c.env.REVENUECAT_SECRET_API_KEY) {
    return c.json(
      {
        error: {
          code: 'billing_not_configured',
          message: 'RevenueCat is not configured for this environment',
        },
      },
      503
    );
  }

  try {
    const { syncRevenueCatSubscription } = await import('../services/revenuecat-sync');
    const result = await syncRevenueCatSubscription(userId, c.env);
    return c.json({
      subscription: result.subscription,
      is_paid: result.is_paid,
      can_use_ai: result.can_use_ai,
      denial_reason: result.denial_reason,
    });
  } catch (error: unknown) {
    console.error('[Subscriptions] sync failed', (error as Error).message);
    return c.json(
      { error: { code: 'sync_failed', message: 'Failed to sync subscription' } },
      502
    );
  }
});

export default subscriptionsRouter;
