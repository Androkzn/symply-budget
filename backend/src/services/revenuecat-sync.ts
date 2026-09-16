/**
 * Sync RevenueCat subscriber → D1 subscriptions row.
 */

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { nanoid } from 'nanoid';

import * as schema from '../db/schema';
import type { Env } from '../types';
import { nowIso } from '../utils/id';

import {
  getSubscriptionForEntitlement,
  isEffectivelyPaid,
  resolveAIEntitlement,
  getUserEmailForEntitlement,
} from './entitlement-service';
import {
  deriveBillingState,
  getSubscriber,
  hasActivePro,
} from './revenuecat-service';

/**
 * Resolve the `current_period_end` to store for a synced subscription.
 *
 * A non-expiring (lifetime / promotional) active pro grant has no `expires_date`
 * on the entitlement OR on any store subscription. That must map to a far-future
 * date, NOT `now` — otherwise isPaidSubscription sees `current_period_end <= now`
 * and denies the paid entitlement the instant it syncs.
 */
export function resolvePeriodEnd(
  proExpiresDate: string | null | undefined,
  subscriptionExpiries: Array<string | null | undefined>,
  proActive: boolean,
  nowIso: string
): string {
  let periodEnd: string | null = proExpiresDate ?? null;
  for (const exp of subscriptionExpiries) {
    if (exp && (periodEnd == null || exp > periodEnd)) periodEnd = exp;
  }
  if (periodEnd == null) return proActive ? '2999-12-31T00:00:00.000Z' : nowIso;
  return periodEnd;
}

export async function syncRevenueCatSubscription(
  userId: string,
  env: Env
): Promise<{
  subscription: schema.Subscription;
  is_paid: boolean;
  can_use_ai: boolean;
  denial_reason: string | null;
}> {
  const subscriber = await getSubscriber(userId, env);
  const proActive = hasActivePro(subscriber);
  const pro = subscriber.entitlements.active.pro;
  const billingState = deriveBillingState(subscriber);
  const now = nowIso();

  let productId = pro?.product_identifier ?? null;
  let storeEnv: string | null = null;
  const subs = subscriber.subscriptions ?? {};
  const subscriptionExpiries: Array<string | null> = [];
  for (const [id, sub] of Object.entries(subs)) {
    if (sub.is_sandbox != null) storeEnv = sub.is_sandbox ? 'sandbox' : 'production';
    if (!productId) productId = id;
    subscriptionExpiries.push(sub.expires_date ?? null);
  }
  // Non-expiring (lifetime/promo) active pro → far future, not `now` (see helper).
  const periodEnd = resolvePeriodEnd(pro?.expires_date, subscriptionExpiries, proActive, now);

  const db = drizzle(env.DB, { schema });
  const [existing] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.user_id, userId))
    .limit(1);

  const status = proActive ? 'active' : 'canceled';
  const tier = proActive ? 'premium' : 'free';
  const periodStart = pro?.purchase_date ?? existing?.current_period_start ?? now;

  if (existing) {
    await db
      .update(schema.subscriptions)
      .set({
        tier,
        status,
        provider: 'revenuecat',
        entitlement_id: proActive ? 'pro' : null,
        store_environment: storeEnv,
        revenuecat_app_user_id: subscriber.original_app_user_id || userId,
        revenuecat_product_id: productId,
        billing_state: billingState,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        cancel_at_period_end: false,
        updated_at: now,
      })
      .where(eq(schema.subscriptions.user_id, userId));
  } else {
    await db.insert(schema.subscriptions).values({
      id: nanoid(),
      user_id: userId,
      tier,
      status,
      provider: 'revenuecat',
      entitlement_id: proActive ? 'pro' : null,
      store_environment: storeEnv,
      revenuecat_app_user_id: subscriber.original_app_user_id || userId,
      revenuecat_product_id: productId,
      billing_state: billingState,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      cancel_at_period_end: false,
      created_at: now,
      updated_at: now,
    });
  }

  const subscription = (await getSubscriptionForEntitlement(env.DB, userId))!;
  const userEmail = await getUserEmailForEntitlement(env.DB, userId);
  const is_paid = isEffectivelyPaid(subscription, userEmail);
  const entitlement = await resolveAIEntitlement(userId, env, { subscription, userEmail });

  const [row] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.user_id, userId))
    .limit(1);

  return {
    subscription: row!,
    is_paid,
    can_use_ai: entitlement.allowed,
    denial_reason: entitlement.allowed ? null : entitlement.reason,
  };
}
