/**
 * Central inference-credential resolver (AI Access Migration §17.2 / §18 / §19.1).
 *
 * Turns an authenticated `userId` into the concrete API key + resolved vendor
 * model that a provider client should run with, honouring the user's access
 * source:
 *   - `simplehouse` (paid / admin) → SimpleHouse-managed env key;
 *   - `byok`                       → the user's own decrypted developer key.
 *
 * This is the single place that decides *whose* key runs inference. Before this
 * existed, every call site read `env.ANTHROPIC_API_KEY` (etc.) directly, so a
 * connected BYOK key was validated and stored but never actually used. Route
 * handlers are still responsible for gating access (middleware / assertCanUseAI);
 * this resolver assumes the caller is entitled and focuses on key + model.
 */

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { getModelById, type AICapability } from '../ai/model-catalog';
import { resolveModelForExecution, type ModelResolveResult } from '../ai/model-resolver';
import * as schema from '../db/schema';
import {
  userAiCredentials,
  userAiPreferences,
  aiCredentialLeases,
} from '../db/schema-ai-credentials';
import type { Env } from '../types';
import { AIAccessError } from '../utils/errors';
import { nowIso } from '../utils/id';
import { scrubForLogs } from '../utils/log-scrubber';

import type { AIProviderId } from './ai-entitlement-types';
import { getProviderModel } from './ai-provider-model-service';
import { decryptCredential } from './credential-encryption';
import {
  resolveAIEntitlement,
  type AIEntitlementResult,
} from './entitlement-service';



export interface ResolvedInferenceCredential {
  provider: AIProviderId;
  source: 'simplehouse' | 'byok';
  apiKey: string;
  registryKey: string;
  vendorModelId: string;
  /** true when the requested model was swapped for the provider default. */
  substituted: boolean;
}

/** Managed (SimpleHouse-owned) key for a provider, from Worker secrets. */
export function envKeyForProvider(env: Env, provider: AIProviderId): string | null {
  switch (provider) {
    case 'openai':
      return env.OPENAI_API_KEY ?? null;
    case 'anthropic':
      return env.ANTHROPIC_API_KEY ?? null;
    case 'gemini':
      return env.GEMINI_API_KEY ?? null;
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/**
 * Pure decision step: given the (already gathered) entitlement, resolved model,
 * and candidate keys, produce the final credential or throw the right denial.
 * Kept separate from I/O so it is directly unit-testable.
 */
export function assembleInferenceCredential(inputs: {
  entitlement: Extract<AIEntitlementResult, { allowed: true }>;
  model: ModelResolveResult;
  byokKey: string | null;
  envKey: string | null;
}): ResolvedInferenceCredential {
  const { entitlement, model, byokKey, envKey } = inputs;
  if (!model.ok) {
    throw AIAccessError.fromReason(model.reason);
  }

  if (entitlement.source === 'byok') {
    // BYOK was selected but the stored key could not be decrypted / is gone.
    if (!byokKey) {
      throw AIAccessError.fromReason('PROVIDER_KEY_INVALID');
    }
    return {
      provider: entitlement.provider,
      source: 'byok',
      apiKey: byokKey,
      registryKey: model.registryKey,
      vendorModelId: model.vendorModelId,
      substituted: model.substituted,
    };
  }

  if (!envKey) {
    // Managed source but the platform has no key configured for this provider.
    throw AIAccessError.fromReason('NO_PROVIDER_AVAILABLE');
  }
  return {
    provider: entitlement.provider,
    source: 'simplehouse',
    apiKey: envKey,
    registryKey: model.registryKey,
    vendorModelId: model.vendorModelId,
    substituted: model.substituted,
  };
}

/** Read the user's persisted model preference (registry key), if any. */
async function readSelectedModelId(env: Env, userId: string): Promise<string | null> {
  try {
    const db = drizzle(env.DB, { schema });
    const [prefs] = await db
      .select({ selected_model_id: userAiPreferences.selected_model_id })
      .from(userAiPreferences)
      .where(eq(userAiPreferences.user_id, userId))
      .limit(1);
    return prefs?.selected_model_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Decrypt the user's active BYOK credential for a specific provider.
 * Returns null when there is no active credential or the vault is unconfigured;
 * throws only on an actual decrypt failure (tamper / wrong key), surfaced as
 * PROVIDER_KEY_INVALID by callers.
 */
export async function decryptActiveByokKey(
  env: Env,
  userId: string,
  provider: AIProviderId
): Promise<string | null> {
  const kek = env.AI_CREDENTIAL_KEK_V1;
  if (!kek) return null;

  const db = drizzle(env.DB, { schema });
  const [cred] = await db
    .select()
    .from(userAiCredentials)
    .where(
      and(
        eq(userAiCredentials.user_id, userId),
        eq(userAiCredentials.provider, provider),
        eq(userAiCredentials.status, 'active')
      )
    )
    .limit(1);
  if (!cred) return null;

  // Session lease expired → the device must re-lease on next foreground. Treat
  // as "no key" so background jobs skip rather than run on a stale credential.
  if (cred.expires_at && cred.expires_at < nowIso()) return null;

  const key = await decryptCredential(
    { ciphertext: cred.ciphertext, iv: cred.iv, keyVersion: cred.key_version },
    { userId, provider },
    kek
  );
  void markCredentialUsed(env, userId, provider);
  return key;
}

/** Best-effort `last_used_at` stamp — never blocks or breaks the AI call. */
async function markCredentialUsed(
  env: Env,
  userId: string,
  provider: AIProviderId
): Promise<void> {
  try {
    const db = drizzle(env.DB, { schema });
    await db
      .update(userAiCredentials)
      .set({ last_used_at: nowIso() })
      .where(
        and(
          eq(userAiCredentials.user_id, userId),
          eq(userAiCredentials.provider, provider)
        )
      );
  } catch (err) {
    console.error('[ai-credential] last_used_at update failed', scrubForLogs((err as Error).message));
  }
}

/**
 * Full resolution for provider-neutral execution: entitlement → provider →
 * model → key. Throws AIAccessError on any denial. Use this where the call site
 * can run *any* provider through the canonical AIProvider interface (report
 * pipeline, briefing composer) and for issuing Lambda leases.
 */
export async function resolveInferenceCredential(
  env: Env,
  userId: string,
  opts?: {
    requiredCapabilities?: AICapability[];
    environment?: 'staging' | 'production';
  }
): Promise<ResolvedInferenceCredential> {
  const entitlement = await resolveAIEntitlement(userId, env);
  if (!entitlement.allowed) {
    throw AIAccessError.fromReason(entitlement.reason);
  }

  const selectedModelId = await readSelectedModelId(env, userId);
  const model = resolveModelForExecution({
    provider: entitlement.provider,
    selectedModelId,
    accessSource: entitlement.source,
    requiredCapabilities: opts?.requiredCapabilities,
    environment: opts?.environment,
  });

  let byokKey: string | null = null;
  if (entitlement.source === 'byok') {
    try {
      byokKey = await decryptActiveByokKey(env, userId, entitlement.provider);
    } catch (err) {
      console.error('[ai-credential] decrypt failed', scrubForLogs((err as Error).message));
      throw AIAccessError.fromReason('PROVIDER_KEY_INVALID');
    }
  }

  return assembleInferenceCredential({
    entitlement,
    model,
    byokKey,
    envKey: envKeyForProvider(env, entitlement.provider),
  });
}

/**
 * Lightweight per-provider key pick for call sites bound to a *specific* vendor
 * SDK (Anthropic tool-use / Gemini vision) that cannot transparently swap
 * providers. Returns the user's own key for `provider` when they have an active
 * BYOK credential for exactly that provider and BYOK is enabled; otherwise the
 * managed env key. Never throws — the route already gated entitlement, and a
 * missing key surfaces at the provider call. Does not change behaviour for
 * managed/paid users (they keep the env key).
 */
export async function resolveProviderApiKey(
  env: Env,
  userId: string | null | undefined,
  provider: AIProviderId
): Promise<{ apiKey: string; source: 'byok' | 'managed' }> {
  const managed = envKeyForProvider(env, provider) ?? '';
  if (!userId || !env.AI_CREDENTIAL_KEK_V1) {
    return { apiKey: managed, source: 'managed' };
  }
  try {
    const byokKey = await decryptActiveByokKey(env, userId, provider);
    if (byokKey) return { apiKey: byokKey, source: 'byok' };
  } catch (err) {
    // Corrupt/undecryptable key → fall back to managed rather than break the call.
    console.error('[ai-credential] byok key unavailable', scrubForLogs((err as Error).message));
  }
  return { apiKey: managed, source: 'managed' };
}

/**
 * "Can inference actually run for this user on this provider?" — i.e. is there
 * ANY usable key, their own or the managed one.
 *
 * Call sites used to answer this with `if (!env.ANTHROPIC_API_KEY) …`, which is
 * the wrong question under the free-app model: a member who connected their own
 * key is entitled to AI whether or not the platform holds a managed key, and the
 * platform intends to stop holding managed keys for free users entirely. Asking
 * the managed key alone would lock a BYOK-only member out of a feature they are
 * paying their own provider for.
 *
 * Cheap when it says yes for a managed user (no D1 read); only a BYOK-connected
 * user costs one decrypt. Never throws — a broken key reads as "no BYOK key",
 * which then falls through to the managed answer.
 */
export async function hasUsableProviderKey(
  env: Env,
  userId: string | null | undefined,
  provider: AIProviderId
): Promise<boolean> {
  const { apiKey } = await resolveProviderApiKey(env, userId, provider);
  return apiKey.length > 0;
}

/**
 * The user's chosen vendor model for `provider` from the ≤5-model picker, if
 * their saved `selected_model_id` resolves to a model of that provider;
 * otherwise null (the caller then uses its own feature-appropriate default).
 * Lets a provider-specific call site honor the user's model pick without
 * overriding when the pick is for a different provider.
 */
export async function resolveSelectedModelForProvider(
  env: Env,
  userId: string | null | undefined,
  provider: AIProviderId
): Promise<string | null> {
  if (!userId) return null;
  try {
    // Prefer this provider's own stored pick; fall back to the global field
    // (the active provider's model) for back-compat.
    const perProvider = await getProviderModel(env.DB, userId, provider);
    if (perProvider) {
      const entry = getModelById(perProvider);
      if (entry && entry.provider === provider) return entry.vendorModelId;
    }

    const db = drizzle(env.DB, { schema });
    const [prefs] = await db
      .select({ selected_model_id: userAiPreferences.selected_model_id })
      .from(userAiPreferences)
      .where(eq(userAiPreferences.user_id, userId))
      .limit(1);
    const id = prefs?.selected_model_id;
    if (!id) return null;
    const entry = getModelById(id);
    return entry && entry.provider === provider ? entry.vendorModelId : null;
  } catch {
    return null;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface IssuedLease {
  token: string;
  expiresAt: string;
}

/**
 * Issue a one-time, job-bound credential lease for out-of-Worker execution
 * (Lambda report processor). Persists only routing metadata — never the key —
 * and returns the bearer token the processor exchanges at
 * `POST /internal/ai-credential-leases/consume`. Returns null if the lease
 * vault secret is unconfigured (caller then falls back to a managed path).
 */
export async function issueCredentialLease(
  env: Env,
  args: {
    userId: string;
    jobId: string;
    provider: AIProviderId;
    selectedModelId?: string | null;
    requiredCapability?: AICapability | null;
    ttlSeconds?: number;
  }
): Promise<IssuedLease | null> {
  if (!env.AI_CREDENTIAL_LEASE_SECRET) return null;

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  const tokenHash = await sha256Hex(token);
  const ttl = args.ttlSeconds ?? 15 * 60;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const db = drizzle(env.DB, { schema });
  await db.insert(aiCredentialLeases).values({
    token_hash: tokenHash,
    job_id: args.jobId,
    user_id: args.userId,
    provider: args.provider,
    required_capability: args.requiredCapability ?? null,
    selected_model_id: args.selectedModelId ?? null,
    expires_at: expiresAt,
  });

  return { token, expiresAt };
}
