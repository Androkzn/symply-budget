/**
 * Entitlement resolver unit tests — flag × paid × BYOK truth table.
 */

import { describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import {
  isPaidSubscription,
  isEffectivelyPaid,
  resolveAIEntitlement,
  type EntitlementSubscriptionRow,
} from '../entitlement-service';
import type { FeatureFlags } from '../featureFlagService';
import { DEFAULT_FLAGS } from '../featureFlagService';

function flags(over: Partial<FeatureFlags> = {}): FeatureFlags {
  return { ...DEFAULT_FLAGS, ...over };
}

function paidSub(over: Partial<EntitlementSubscriptionRow> = {}): EntitlementSubscriptionRow {
  const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return {
    tier: 'premium',
    status: 'active',
    current_period_end: end,
    cancel_at_period_end: false,
    entitlement_id: 'pro',
    billing_state: 'normal',
    ...over,
  };
}

const fakeEnv = {} as Env;

describe('isPaidSubscription', () => {
  it('returns false for null / missing entitlement', () => {
    expect(isPaidSubscription(null)).toBe(false);
    expect(isPaidSubscription(paidSub({ entitlement_id: null }))).toBe(false);
    expect(isPaidSubscription(paidSub({ entitlement_id: 'other' }))).toBe(false);
  });

  it('returns true for active pro with normal billing', () => {
    expect(isPaidSubscription(paidSub())).toBe(true);
  });

  it('returns false when period expired', () => {
    expect(
      isPaidSubscription(
        paidSub({ current_period_end: new Date(Date.now() - 1000).toISOString() })
      )
    ).toBe(false);
  });

  it('returns false for grace billing under strict policy', () => {
    expect(isPaidSubscription(paidSub({ billing_state: 'grace' }))).toBe(false);
  });

  it('returns true for trialing pro', () => {
    expect(isPaidSubscription(paidSub({ status: 'trialing' }))).toBe(true);
  });
});

describe('isEffectivelyPaid', () => {
  it('returns true for admin allowlisted email without subscription', () => {
    expect(isEffectivelyPaid(null, 'andrei.tekhtelev@gmail.com')).toBe(true);
    expect(isEffectivelyPaid(null, 'A.TEKHTELEVA@Gmail.com')).toBe(true);
  });

  it('returns false for non-admin without subscription', () => {
    expect(isEffectivelyPaid(null, 'other@example.com')).toBe(false);
  });
});

describe('resolveAIEntitlement', () => {
  it('denies when aiFeaturesEnabled=false', async () => {
    const result = await resolveAIEntitlement('u1', fakeEnv, {
      flags: flags({ aiFeaturesEnabled: false }),
      subscription: paidSub(),
    });
    expect(result).toEqual({ allowed: false, reason: 'AI_DISABLED' });
  });

  it('denies when access required and not paid', async () => {
    const result = await resolveAIEntitlement('u1', fakeEnv, {
      flags: flags({
        aiFeaturesEnabled: true,
        aiRequiresAccess: true,
        anthropicProviderEnabled: true,
      }),
      subscription: null,
    });
    expect(result).toEqual({ allowed: false, reason: 'AI_ACCESS_REQUIRED' });
  });

  it('allows paid user with managed provider', async () => {
    const result = await resolveAIEntitlement('u1', fakeEnv, {
      flags: flags({
        aiFeaturesEnabled: true,
        aiRequiresAccess: true,
        anthropicProviderEnabled: true,
      }),
      subscription: paidSub(),
    });
    expect(result).toEqual({
      allowed: true,
      source: 'simplehouse',
      provider: 'anthropic',
    });
  });

  it('returns NO_PROVIDER_AVAILABLE when paid but all providers off', async () => {
    const result = await resolveAIEntitlement('u1', fakeEnv, {
      flags: flags({
        aiFeaturesEnabled: true,
        aiRequiresAccess: true,
        openAIProviderEnabled: false,
        anthropicProviderEnabled: false,
        geminiProviderEnabled: false,
      }),
      subscription: paidSub(),
    });
    expect(result).toEqual({ allowed: false, reason: 'NO_PROVIDER_AVAILABLE' });
  });

  it('allows BYOK when bringYourOwnAIEnabled and provider enabled', async () => {
    const result = await resolveAIEntitlement('u1', fakeEnv, {
      flags: flags({
        aiFeaturesEnabled: true,
        aiRequiresAccess: true,
        bringYourOwnAIEnabled: true,
        openAIProviderEnabled: true,
        anthropicProviderEnabled: false,
        geminiProviderEnabled: false,
      }),
      subscription: null,
      byokProvider: 'openai',
    });
    expect(result).toEqual({ allowed: true, source: 'byok', provider: 'openai' });
  });

  it('allows when AI on and access not required', async () => {
    const result = await resolveAIEntitlement('u1', fakeEnv, {
      flags: flags({
        aiFeaturesEnabled: true,
        aiRequiresAccess: false,
        anthropicProviderEnabled: true,
      }),
      subscription: null,
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.source).toBe('simplehouse');
      expect(result.provider).toBe('anthropic');
    }
  });

  it('honors an explicit BYOK choice for a NON-paid user even when managed AI is free-for-all', async () => {
    // Regression: a free-tier user who connected their own key and set
    // credential_source='byok' must route through THEIR key, not the free managed
    // one. Before the fix the BYOK-preference check was gated on isPaid, so this
    // returned source:'simplehouse' and the "default provider" toggle never lit.
    const result = await resolveAIEntitlement('u1', fakeEnv, {
      flags: flags({
        aiFeaturesEnabled: true,
        aiRequiresAccess: false, // managed AI available to everyone
        bringYourOwnAIEnabled: true,
        geminiProviderEnabled: true,
      }),
      subscription: null, // NOT paid
      byokProvider: 'gemini',
      credentialSource: 'byok',
    });
    expect(result).toEqual({ allowed: true, source: 'byok', provider: 'gemini' });
  });

  it('does NOT force BYOK for a non-paid user who has a key connected but has not chosen it', async () => {
    // A connected-but-not-selected key (credential_source still managed/null) must
    // leave the user on managed AI — connecting a key is not the same as choosing it.
    const result = await resolveAIEntitlement('u1', fakeEnv, {
      flags: flags({
        aiFeaturesEnabled: true,
        aiRequiresAccess: false,
        bringYourOwnAIEnabled: true,
        anthropicProviderEnabled: true,
        geminiProviderEnabled: true,
      }),
      subscription: null,
      byokProvider: 'gemini',
      credentialSource: 'simplehouse',
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.source).toBe('simplehouse');
  });

  it('allows admin allowlisted email without paid subscription', async () => {
    const result = await resolveAIEntitlement('u1', fakeEnv, {
      flags: flags({
        aiFeaturesEnabled: true,
        aiRequiresAccess: true,
        anthropicProviderEnabled: true,
      }),
      subscription: null,
      userEmail: 'a.tekhtelev@gmail.com',
    });
    expect(result).toEqual({
      allowed: true,
      source: 'simplehouse',
      provider: 'anthropic',
    });
  });

  it('honors an explicit BYOK choice for an ADMIN-allowlisted user (byok wins over the admin managed grant)', async () => {
    // Regression: the admin short-circuit used to return 'simplehouse' BEFORE the
    // BYOK check, so an allow-listed tester who connected their own key could never
    // get source:'byok' and the default toggle never stuck. An explicit choice now
    // wins for admins too.
    const result = await resolveAIEntitlement('u1', fakeEnv, {
      flags: flags({
        aiFeaturesEnabled: true,
        aiRequiresAccess: true,
        bringYourOwnAIEnabled: true,
        geminiProviderEnabled: true,
      }),
      subscription: null,
      userEmail: 'a.tekhtelev@gmail.com', // admin-allowlisted
      byokProvider: 'gemini',
      credentialSource: 'byok',
    });
    expect(result).toEqual({ allowed: true, source: 'byok', provider: 'gemini' });
  });

  it('still gives an admin managed AI when they have NOT chosen BYOK', async () => {
    const result = await resolveAIEntitlement('u1', fakeEnv, {
      flags: flags({
        aiFeaturesEnabled: true,
        aiRequiresAccess: true,
        bringYourOwnAIEnabled: true,
        anthropicProviderEnabled: true,
        geminiProviderEnabled: true,
      }),
      subscription: null,
      userEmail: 'a.tekhtelev@gmail.com',
      byokProvider: 'gemini',
      credentialSource: 'simplehouse',
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.source).toBe('simplehouse');
  });
});
