/**
 * Subscription tools — read-only entitlement state.
 * StoreKit owns cancel/reactivate; Mira must not mutate D1 billing (§2 #11).
 */
import { z } from 'zod';

import {
  getSubscriptionForEntitlement,
  isPaidSubscription,
  resolveAIEntitlement,
} from '../../../entitlement-service';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

export const getSubscription: AihousekeeperTool = {
  name: 'get_subscription',
  kind: 'READ',
  description:
    "Get the user's AI access and subscription state: whether they are paid (Apple/RevenueCat pro), can use AI, access source (simplehouse vs byok), provider, and period end. For cancel/manage billing, tell the user to use Apple Settings → Subscriptions or the in-app Manage Subscription screen — do not claim you can cancel for them.",
  input: z.object({}),
  async execute(ctx: AihousekeeperToolContext, _input): Promise<ToolResult> {
    const sub = await getSubscriptionForEntitlement(ctx.env.DB, ctx.userId);
    const entitlement = await resolveAIEntitlement(ctx.userId, ctx.env, {
      subscription: sub,
    });
    const isPaid = isPaidSubscription(sub);

    return {
      ok: true,
      subscription: {
        tier: sub?.tier ?? 'free',
        status: sub?.status ?? 'none',
        entitlement_id: sub?.entitlement_id ?? null,
        billing_state: sub?.billing_state ?? null,
        current_period_end: sub?.current_period_end ?? null,
        cancel_at_period_end: Boolean(sub?.cancel_at_period_end),
        provider: sub?.provider ?? null,
      },
      is_paid: isPaid,
      can_use_ai: entitlement.allowed,
      access_source: entitlement.allowed ? entitlement.source : null,
      ai_provider: entitlement.allowed ? entitlement.provider : null,
      denial_reason: entitlement.allowed ? null : entitlement.reason,
      manage_billing:
        'Open Apple Settings → [Your Name] → Subscriptions, or use Manage Subscription in the app. Mira cannot cancel or reactivate App Store subscriptions.',
    };
  },
};

/** Replaced: directs user to Apple management UI instead of mutating D1. */
export const openManageSubscription: AihousekeeperTool = {
  name: 'open_manage_subscription',
  kind: 'READ',
  description:
    'Explain how the user can manage, cancel, or restore their Apple subscription. Use when the user asks to cancel, reactivate, or change billing. Does not change any billing state.',
  input: z.object({
    intent: z
      .enum(['cancel', 'reactivate', 'manage', 'restore'])
      .optional()
      .describe('What the user wants to do'),
  }),
  async execute(_ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const intent = input.intent ?? 'manage';
    return {
      ok: true,
      intent,
      instructions:
        intent === 'restore'
          ? 'Use Restore Purchases on the paywall / Unlock AI screen. Purchases are tied to the Apple ID.'
          : 'Manage or cancel in iOS Settings → [Your Name] → Subscriptions, or open Manage Subscription in the app. Changes apply through Apple; the app cannot cancel StoreKit subscriptions directly.',
      deep_link_hint: 'simplehouse://ai-access/paywall',
    };
  },
};

export const subscriptionTools: readonly AihousekeeperTool[] = [
  getSubscription,
  openManageSubscription,
] as const;
