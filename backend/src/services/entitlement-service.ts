/**
 * AI entitlement resolution — canonical gate for all AI execution.
 * See documents/product/features/ai-paid-subscription-migration-plan.md §4, §8.1.
 *
 * Fail closed on KV errors. Missing subscription row = free (no insert).
 */

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { isAdminAllowlistedEmail } from '../config/admin-emails';
import * as schema from '../db/schema';
import { subscriptions, users } from '../db/schema';
import { userAiCredentials, userAiPreferences } from '../db/schema-ai-credentials';
import type { Env } from '../types';
import { AIAccessError } from '../utils/errors';

import {
  type AIEntitlementResult,
  type AIProviderId,
  type BillingState,
  PAID_BILLING_STATES,
} from './ai-entitlement-types';
import { getFlags } from './featureFlagService';


export type { AIEntitlementResult, AIProviderId } from './ai-entitlement-types';
export { denialToHttp, PAID_BILLING_STATES } from './ai-entitlement-types';

/** Minimal subscription shape used for paid checks. */
export interface EntitlementSubscriptionRow {
  tier: string;
  status: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  entitlement_id?: string | null;
  billing_state?: string | null;
  provider?: string | null;
}

export interface ActiveByokCredential {
  provider: AIProviderId;
  status: string;
  key_hint: string;
  last_validated_at: string | null;
  /** Session-lease expiry (device Keychain is the durable home). Null = legacy permanent store. */
  expires_at: string | null;
}

/**
 * Canonical paid check (§4.1). Requires RevenueCat-synced entitlement_id === 'pro'.
 */
export function isPaidSubscription(
  subscription: EntitlementSubscriptionRow | null | undefined,
  now: Date = new Date(),
  paidBillingStates: ReadonlySet<BillingState> = PAID_BILLING_STATES
): boolean {
  if (!subscription) return false;
  if (subscription.entitlement_id !== 'pro') return false;
  if (!['active', 'trialing'].includes(subscription.status)) return false;
  if (new Date(subscription.current_period_end).getTime() <= now.getTime()) return false;
  const billing = (subscription.billing_state ?? 'normal') as BillingState;
  return paidBillingStates.has(billing);
}

/** Paid via subscription or internal admin email allowlist. */
export function isEffectivelyPaid(
  subscription: EntitlementSubscriptionRow | null | undefined,
  userEmail?: string | null,
  now: Date = new Date()
): boolean {
  if (isAdminAllowlistedEmail(userEmail)) return true;
  return isPaidSubscription(subscription, now);
}

export async function getUserEmailForEntitlement(
  db: D1Database,
  userId: string
): Promise<string | null> {
  const d1 = drizzle(db, { schema });
  const [row] = await d1
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.email ?? null;
}

/** Read-only subscription lookup — never creates a free row. */
export async function getSubscriptionForEntitlement(
  db: D1Database,
  userId: string
): Promise<EntitlementSubscriptionRow | null> {
  const d1 = drizzle(db, { schema });
  const [row] = await d1
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.user_id, userId))
    .limit(1);
  if (!row) return null;
  return row as EntitlementSubscriptionRow;
}

/** Active BYOK credentials for a user (metadata only). */
export async function listActiveByokCredentials(
  db: D1Database,
  userId: string
): Promise<ActiveByokCredential[]> {
  const d1 = drizzle(db, { schema });
  const rows = await d1
    .select({
      provider: userAiCredentials.provider,
      status: userAiCredentials.status,
      key_hint: userAiCredentials.key_hint,
      last_validated_at: userAiCredentials.last_validated_at,
      expires_at: userAiCredentials.expires_at,
    })
    .from(userAiCredentials)
    .where(
      and(eq(userAiCredentials.user_id, userId), eq(userAiCredentials.status, 'active'))
    );
  const now = new Date().toISOString();
  return rows
    .filter((r) => ['openai', 'anthropic', 'gemini'].includes(r.provider))
    .map((r) => ({
      provider: r.provider as AIProviderId,
      // An expired session lease reads as needs_reconnect until the device re-leases.
      status: r.expires_at && r.expires_at < now ? 'needs_reconnect' : r.status,
      key_hint: r.key_hint,
      last_validated_at: r.last_validated_at,
      expires_at: r.expires_at ?? null,
    }));
}

async function resolvePreferredByokProvider(
  db: D1Database,
  userId: string,
  active: ActiveByokCredential[],
  flags: {
    openAIProviderEnabled: boolean;
    anthropicProviderEnabled: boolean;
    geminiProviderEnabled: boolean;
  }
): Promise<AIProviderId | null> {
  const enabled = active.filter((c) => {
    if (c.provider === 'openai') return flags.openAIProviderEnabled;
    if (c.provider === 'anthropic') return flags.anthropicProviderEnabled;
    if (c.provider === 'gemini') return flags.geminiProviderEnabled;
    return false;
  });
  if (enabled.length === 0) return null;

  try {
    const d1 = drizzle(db, { schema });
    const [prefs] = await d1
      .select()
      .from(userAiPreferences)
      .where(eq(userAiPreferences.user_id, userId))
      .limit(1);
    if (
      prefs?.credential_source === 'byok' &&
      prefs.active_provider &&
      enabled.some((c) => c.provider === prefs.active_provider)
    ) {
      return prefs.active_provider as AIProviderId;
    }
  } catch {
    // fall through
  }
  for (const p of ['anthropic', 'openai', 'gemini'] as const) {
    if (enabled.some((c) => c.provider === p)) return p;
  }
  return enabled[0]?.provider ?? null;
}

function pickManagedProvider(flags: {
  openAIProviderEnabled: boolean;
  anthropicProviderEnabled: boolean;
  geminiProviderEnabled: boolean;
}): AIProviderId | null {
  if (flags.anthropicProviderEnabled) return 'anthropic';
  if (flags.openAIProviderEnabled) return 'openai';
  if (flags.geminiProviderEnabled) return 'gemini';
  return null;
}

/**
 * Resolve whether the user may invoke AI. Flag + subscription + active BYOK.
 * KV failures → AI_DISABLED (fail closed).
 */
export async function resolveAIEntitlement(
  userId: string,
  env: Env,
  options?: {
    subscription?: EntitlementSubscriptionRow | null;
    flags?: Awaited<ReturnType<typeof getFlags>>['flags'];
    byokProvider?: AIProviderId | null;
    byokConnections?: ActiveByokCredential[];
    /** The user's `user_ai_preferences.credential_source`. Pass it to skip a
     *  redundant D1 read (the caller usually already has the prefs row). */
    credentialSource?: 'simplehouse' | 'byok' | null;
    userEmail?: string | null;
    now?: Date;
  }
): Promise<AIEntitlementResult> {
  let flags = options?.flags;
  if (!flags) {
    try {
      const payload = await getFlags(env.CONFIG_KV);
      flags = payload.flags;
    } catch {
      return { allowed: false, reason: 'AI_DISABLED' };
    }
  }

  if (!flags.aiFeaturesEnabled) {
    return { allowed: false, reason: 'AI_DISABLED' };
  }

  let userEmail = options?.userEmail;
  if (userEmail === undefined) {
    try {
      userEmail = await getUserEmailForEntitlement(env.DB, userId);
    } catch {
      userEmail = null;
    }
  }

  const now = options?.now ?? new Date();
  let subscription = options?.subscription;
  if (subscription === undefined) {
    try {
      subscription = await getSubscriptionForEntitlement(env.DB, userId);
    } catch {
      subscription = null;
    }
  }

  const isPaid = isEffectivelyPaid(subscription, userEmail, now);
  const isAdmin = isAdminAllowlistedEmail(userEmail);

  // Preferred BYOK provider, computed up-front so an EXPLICIT BYOK choice can be
  // honored ahead of BOTH managed and internal-admin access.
  let byokProvider: AIProviderId | null = null;
  if (flags.bringYourOwnAIEnabled) {
    if (options?.byokProvider !== undefined) {
      byokProvider = options.byokProvider;
    } else {
      try {
        const connections =
          options?.byokConnections ?? (await listActiveByokCredentials(env.DB, userId));
        byokProvider = await resolvePreferredByokProvider(env.DB, userId, connections, flags);
      } catch {
        byokProvider = null;
      }
    }
  }
  const hasBYOK = byokProvider != null;

  // An EXPLICIT BYOK choice wins for EVERYONE — free, paid, or internal admin. A
  // user who connected their own key and set `credential_source = 'byok'` wants the
  // app to route through it, so this is checked BEFORE the admin short-circuit and
  // the managed free-for-all branch — either of which would otherwise ignore the
  // key they deliberately connected (this is what kept the "default provider"
  // toggle from ever sticking for allow-listed / non-paid users).
  if (hasBYOK && byokProvider && flags.bringYourOwnAIEnabled) {
    let credentialSource = options?.credentialSource;
    if (credentialSource === undefined) {
      try {
        const d1 = drizzle(env.DB, { schema });
        const [prefs] = await d1
          .select()
          .from(userAiPreferences)
          .where(eq(userAiPreferences.user_id, userId))
          .limit(1);
        credentialSource = (prefs?.credential_source as 'simplehouse' | 'byok' | null) ?? null;
      } catch {
        credentialSource = null;
      }
    }
    if (credentialSource === 'byok') {
      return { allowed: true, source: 'byok', provider: byokProvider };
    }
  }

  if (isAdmin) {
    const provider = pickManagedProvider(flags) ?? 'anthropic';
    return { allowed: true, source: 'simplehouse', provider };
  }

  if (flags.aiRequiresAccess && !isPaid && !hasBYOK) {
    return { allowed: false, reason: 'AI_ACCESS_REQUIRED' };
  }

  if (isPaid || !flags.aiRequiresAccess) {
    const provider = pickManagedProvider(flags);
    if (!provider) {
      if (hasBYOK && byokProvider) {
        return { allowed: true, source: 'byok', provider: byokProvider };
      }
      if (isPaid) {
        return { allowed: false, reason: 'NO_PROVIDER_AVAILABLE' };
      }
      return { allowed: false, reason: 'NO_PROVIDER_AVAILABLE' };
    }
    return { allowed: true, source: 'simplehouse', provider };
  }

  if (hasBYOK && byokProvider) {
    return { allowed: true, source: 'byok', provider: byokProvider };
  }

  return { allowed: false, reason: 'AI_ACCESS_REQUIRED' };
}

export async function assertCanUseAI(
  userId: string,
  env: Env
): Promise<AIEntitlementResult & { allowed: true }> {
  const result = await resolveAIEntitlement(userId, env);
  if (!result.allowed) {
    throw AIAccessError.fromReason(result.reason);
  }
  return result;
}
