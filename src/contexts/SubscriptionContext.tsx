import React, { createContext, useContext, useCallback, useMemo, useState, useEffect } from 'react';

import { aiAccessApi } from '@api/aiAccess';
import { subscriptionApi } from '@api/subscription';
import { ENV } from '@config/env';
import { useAuthStore } from '@stores/authStore';

type SubscriptionTier = 'free' | 'basic' | 'premium' | 'enterprise' | 'pro';

interface SubscriptionPlan {
  id: string;
  tier: SubscriptionTier;
  name: string;
  price: number;
  interval: 'month' | 'year';
  features: string[];
}

interface Subscription {
  id: string;
  tier: SubscriptionTier;
  status: 'active' | 'canceled' | 'past_due' | 'trialing';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  entitlementId?: string | null;
  provider?: string | null;
}

interface SubscriptionContextType {
  subscription: Subscription | null;
  isLoading: boolean;
  error: string | null;
  /** True when server says paid (RevenueCat pro) — not legacy premium tier. */
  isPremium: boolean;
  canUseAI: boolean;
  canAccessFeature: (feature: string) => boolean;
  availablePlans: SubscriptionPlan[];
  refreshSubscription: () => Promise<void>;
  clearError: () => void;
}

const FREE_FEATURES = ['basic_reports', 'basic_tasks', 'single_household'];
const PRO_FEATURES = [
  ...FREE_FEATURES,
  'unlimited_reports',
  'email_notifications',
  'export_pdf',
  'multiple_households',
  'priority_support',
  'advanced_analytics',
  'advanced_ai',
];

// Built lazily (not at module-load time) because the `pro` plan reads
// `ENV.APP_NAME`. This module can be pulled into a circular import chain where
// `@config/env` hasn't finished initializing — evaluating `ENV.APP_NAME` at
// module scope would throw. Same reason as AIDisclaimerModal's lazy content.
const buildDefaultPlans = (): SubscriptionPlan[] => [
  {
    id: 'free',
    tier: 'free',
    name: 'Free',
    price: 0,
    interval: 'month',
    features: FREE_FEATURES,
  },
  {
    id: 'pro',
    tier: 'pro',
    name: `${ENV.APP_NAME} Pro`,
    price: 0,
    interval: 'month',
    features: PRO_FEATURES,
  },
];

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [canUseAI, setCanUseAI] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPremium = isPaid;

  const canAccessFeature = useCallback(
    (feature: string): boolean => {
      if (feature === 'advanced_ai') return canUseAI;
      if (isPaid) return PRO_FEATURES.includes(feature) || FREE_FEATURES.includes(feature);
      return FREE_FEATURES.includes(feature);
    },
    [canUseAI, isPaid]
  );

  const refreshSubscription = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [subRes, accessRes] = await Promise.all([
        subscriptionApi.getSubscription(),
        aiAccessApi.getAccess().catch(() => null),
      ]);

      const sub = subRes.subscription;
      setSubscription({
        id: sub.id,
        tier: (sub.tier as SubscriptionTier) || 'free',
        status: sub.status,
        currentPeriodStart: new Date(sub.current_period_start),
        currentPeriodEnd: new Date(sub.current_period_end),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        entitlementId: (sub as { entitlement_id?: string | null }).entitlement_id ?? null,
        provider: (sub as { provider?: string | null }).provider ?? null,
      });

      const paid =
        typeof subRes.is_paid === 'boolean'
          ? subRes.is_paid
          : Boolean(accessRes?.subscription?.is_paid);
      const ai =
        typeof subRes.can_use_ai === 'boolean'
          ? subRes.can_use_ai
          : Boolean(accessRes?.can_use_ai);

      setIsPaid(paid);
      setCanUseAI(ai);
    } catch (err) {
      setSubscription({
        id: 'free',
        tier: 'free',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
      });
      setIsPaid(false);
      setCanUseAI(false);
      setError(err instanceof Error ? err.message : 'Failed to load subscription');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  useEffect(() => {
    // Wait for auth rehydration to fully resolve (isAuthenticated can flip true
    // from the persisted flag before the SecureStore-held token has loaded — see
    // `hasHydrated` on authStore) so /subscriptions/me and /ai-access don't fire
    // pre-token and 401 on every cold launch.
    if (!hasHydrated || !isAuthenticated) return;
    refreshSubscription();
  }, [hasHydrated, isAuthenticated, refreshSubscription]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      subscription,
      isLoading,
      error,
      isPremium,
      canUseAI,
      canAccessFeature,
      availablePlans: buildDefaultPlans(),
      refreshSubscription,
      clearError,
    }),
    [
      subscription,
      isLoading,
      error,
      isPremium,
      canUseAI,
      canAccessFeature,
      refreshSubscription,
      clearError,
    ]
  );

  return (
    <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
}
