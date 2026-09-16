import { subscriptionMeResponseSchema } from '@symply/contracts';

import { apiClient } from './client';
import { shouldValidateApiResponses, validateApiResponse } from './validateResponse';

export type SubscriptionTier = 'free' | 'basic' | 'premium' | 'enterprise';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing';

export interface SubscriptionPlan {
  id: string;
  tier: SubscriptionTier;
  name: string;
  price: number;
  interval: 'month' | 'year';
  features: string[];
}

export interface Subscription {
  id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  entitlement_id?: string | null;
  provider?: string | null;
  billing_state?: string | null;
}

interface SubscriptionResponse {
  subscription: Subscription;
  is_paid?: boolean;
  can_use_ai?: boolean;
  denial_reason?: string | null;
  access_source?: string | null;
}

interface PlansResponse {
  plans: SubscriptionPlan[];
}

interface CheckoutResponse {
  checkout_url: string;
  session_id: string;
}

interface PortalResponse {
  portal_url: string;
}

export const subscriptionApi = {
  getSubscription: () =>
    apiClient.get<SubscriptionResponse>('/subscriptions/me').then((res) => {
      const data = res.data;
      if (!shouldValidateApiResponses()) return data;
      return validateApiResponse(
        subscriptionMeResponseSchema,
        data,
        'GET /subscriptions/me'
      );
    }),

  getPlans: () =>
    apiClient.get<PlansResponse>('/subscriptions/plans').then((res) => res.data),

  createCheckoutSession: (planId: string) =>
    apiClient
      .post<CheckoutResponse>('/subscriptions/checkout', { plan_id: planId })
      .then((res) => res.data),

  getCustomerPortal: () =>
    apiClient.post<PortalResponse>('/subscriptions/portal').then((res) => res.data),

  cancelSubscription: () =>
    apiClient
      .post<SubscriptionResponse>('/subscriptions/cancel')
      .then((res) => res.data),

  resumeSubscription: () =>
    apiClient
      .post<SubscriptionResponse>('/subscriptions/resume')
      .then((res) => res.data),

  /** Pull RevenueCat state into backend (authoritative for is_paid / can_use_ai). */
  sync: () =>
    apiClient
      .post<{
        subscription: Subscription;
        is_paid: boolean;
        can_use_ai: boolean;
        denial_reason: string | null;
      }>('/subscriptions/sync')
      .then((res) => res.data),
};
