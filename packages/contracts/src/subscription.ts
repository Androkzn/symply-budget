import { z } from 'zod';

/** Subscription row fields returned by GET /subscriptions/me (shared FE/BE contract). */
export const subscriptionSchema = z
  .object({
    id: z.string(),
    tier: z.enum(['free', 'basic', 'premium', 'enterprise', 'pro']),
    status: z.enum(['active', 'canceled', 'past_due', 'trialing']),
    current_period_start: z.string(),
    current_period_end: z.string(),
    cancel_at_period_end: z.boolean(),
    entitlement_id: z.string().nullable().optional(),
    provider: z.string().nullable().optional(),
    billing_state: z.string().nullable().optional(),
  })
  .passthrough();

export type SubscriptionContract = z.infer<typeof subscriptionSchema>;

/** GET /subscriptions/me response envelope. */
export const subscriptionMeResponseSchema = z.object({
  subscription: subscriptionSchema,
  is_paid: z.boolean(),
  can_use_ai: z.boolean(),
  denial_reason: z.string().nullable(),
  access_source: z.string().nullable(),
});

export type SubscriptionMeResponse = z.infer<typeof subscriptionMeResponseSchema>;
