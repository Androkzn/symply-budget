/**
 * Nightly model-catalog health check — the periodic counterpart to the
 * read-time guards in `ai-provider-model-service` / `ai-access-service`.
 *
 * `MODEL_CATALOG` is a hand-maintained table of vendor model ids, and it rots in
 * BOTH directions. Each direction has already cost us a user-visible outage, and
 * each is checked here:
 *
 * 1. **The vendor retires a model we still offer.** `gemini-2.0-flash` started
 *    answering "This model is no longer available" (2026-08-14) while it was
 *    still in the picker — every receipt scan on it failed. Nothing told us; a
 *    member did. `checkCatalogAgainstVendors` asks each provider for its own
 *    model list and reports catalog entries the vendor no longer serves.
 *
 * 2. **We retire a model users are still pinned to.** `gemini.3.1-flash-lite`
 *    was pulled from the catalog for returning zero items on every receipt
 *    photo, but the `user_ai_provider_models` rows pointing at it stayed. Those
 *    users could not select Gemini AT ALL: switching to it restored the stored
 *    pick, re-validated it against the shrunken catalog, and answered 400
 *    (observed on staging 2026-08-15). `healStrandedModelPicks` rewrites those
 *    rows to the provider's flagship so the data matches the catalog rather than
 *    relying on every reader to defend itself.
 *
 * ## Report-only, deliberately (direction 1)
 *
 * A vendor probe that AUTO-REMOVED entries would let one bad response — a 500, a
 * rate limit, a paginated list we mis-parsed — silently empty a provider's
 * picker for everyone. That is a worse outage than the one it prevents. So this
 * only reports: `console.error` (→ Worker logs / Sentry) plus a snapshot in
 * `CONFIG_KV` for inspection. Removing an entry from `MODEL_CATALOG` stays a
 * human, reviewed edit — and direction 2 then cleans up after it automatically.
 *
 * Runs on the platform's OWN keys. A BYOK-only deployment has none, and every
 * provider is skipped with a reason rather than reported as drift.
 */

import { and, eq, isNotNull } from 'drizzle-orm';

import {
  MODEL_CATALOG,
  getFlagshipModel,
  getDefaultModel,
  getModelById,
  type ModelCatalogEntry,
} from '../ai/model-catalog';
import { userAiPreferences, userAiProviderModels } from '../db/schema-ai-credentials';
import type { Env } from '../types';

import type { AIProviderId } from './ai-entitlement-types';
import { createDb } from './db';

/** KV key holding the most recent run, for ops inspection. */
export const CATALOG_HEALTH_KV_KEY = 'ai_model_catalog_health';

/** Rows healed per run. Bounded so one tick cannot run long; the next tick continues. */
const HEAL_BATCH = 500;

export interface ProviderCatalogHealth {
  provider: AIProviderId;
  /** Set when we did not get a usable list — never treated as drift. */
  skippedReason?: string;
  /** Catalog vendor ids the provider no longer lists. */
  missingAtVendor: string[];
  /** How many ids the vendor returned (sanity signal for a mis-parsed response). */
  vendorModelCount: number;
}

export interface CatalogHealthReport {
  checkedAt: string;
  environment: string;
  providers: ProviderCatalogHealth[];
  healed: HealResult;
}

// ---------------------------------------------------------------------------
// Direction 1 — is every catalogued model still served by its vendor?
// ---------------------------------------------------------------------------

async function listVendorModels(
  provider: AIProviderId,
  apiKey: string
): Promise<string[]> {
  switch (provider) {
    case 'openai': {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`openai /v1/models ${res.status}`);
      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      return (body.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    }
    case 'anthropic': {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      });
      if (!res.ok) throw new Error(`anthropic /v1/models ${res.status}`);
      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      return (body.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    }
    case 'gemini': {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`
      );
      if (!res.ok) throw new Error(`gemini ListModels ${res.status}`);
      const body = (await res.json()) as { models?: Array<{ name?: string }> };
      // ListModels returns `models/gemini-3.5-flash`; the catalog stores the bare id.
      return (body.models ?? [])
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter(Boolean);
    }
  }
}

/**
 * Is `catalogId` covered by the vendor's list?
 *
 * Exact match, OR a dated snapshot of the same alias: providers list
 * `claude-sonnet-5-20260101` while we (and everyone else) address the model as
 * `claude-sonnet-5`. Treating the alias as missing because only its snapshot is
 * listed would make this check cry wolf on a perfectly working model, and a
 * check that cries wolf gets ignored — which is the same as not having one.
 */
function isServedByVendor(catalogId: string, vendorIds: Set<string>): boolean {
  if (vendorIds.has(catalogId)) return true;
  for (const id of vendorIds) {
    if (id.startsWith(`${catalogId}-`)) return true;
  }
  return false;
}

function platformKeyFor(env: Env, provider: AIProviderId): string | undefined {
  switch (provider) {
    case 'openai':
      return env.OPENAI_API_KEY;
    case 'anthropic':
      return env.ANTHROPIC_API_KEY;
    case 'gemini':
      return env.GEMINI_API_KEY;
  }
}

async function checkProvider(
  env: Env,
  provider: AIProviderId,
  catalog: readonly ModelCatalogEntry[]
): Promise<ProviderCatalogHealth> {
  const entries = catalog.filter((e) => e.provider === provider);
  if (entries.length === 0) {
    return { provider, skippedReason: 'no catalog entries', missingAtVendor: [], vendorModelCount: 0 };
  }

  const apiKey = platformKeyFor(env, provider);
  if (!apiKey) {
    // Normal for a BYOK-only deployment — we hold no key of our own to ask with.
    return { provider, skippedReason: 'no platform key', missingAtVendor: [], vendorModelCount: 0 };
  }

  let vendorIds: string[];
  try {
    vendorIds = await listVendorModels(provider, apiKey);
  } catch (error) {
    return {
      provider,
      skippedReason: `list failed: ${(error as Error)?.message ?? 'unknown'}`,
      missingAtVendor: [],
      vendorModelCount: 0,
    };
  }

  // An empty list is a mis-parse or an entitlement problem far more often than
  // it is "this vendor serves no models". Reporting every entry as missing off
  // the back of it would be pure noise.
  if (vendorIds.length === 0) {
    return { provider, skippedReason: 'vendor returned no models', missingAtVendor: [], vendorModelCount: 0 };
  }

  const served = new Set(vendorIds);
  return {
    provider,
    missingAtVendor: entries
      .filter((e) => !isServedByVendor(e.vendorModelId, served))
      .map((e) => e.vendorModelId),
    vendorModelCount: vendorIds.length,
  };
}

export async function checkCatalogAgainstVendors(
  env: Env,
  catalog: readonly ModelCatalogEntry[] = MODEL_CATALOG
): Promise<ProviderCatalogHealth[]> {
  const providers: AIProviderId[] = ['openai', 'anthropic', 'gemini'];
  return Promise.all(providers.map((p) => checkProvider(env, p, catalog)));
}

// ---------------------------------------------------------------------------
// Direction 2 — is every stored user pick still a model we offer?
// ---------------------------------------------------------------------------

export interface HealResult {
  /** `user_ai_provider_models` rows repointed at their provider's flagship. */
  providerRows: number;
  /** `user_ai_preferences.selected_model_id` values repointed. */
  preferenceRows: number;
  /** True when the batch cap was hit — the next run continues where this stopped. */
  truncated: boolean;
}

/**
 * Repoint stored picks that no longer resolve, rather than leaving readers to
 * paper over them. Chooses the FLAGSHIP for a BYOK user and the managed default
 * otherwise, matching what `patchUserAiPreferences` picks when a provider has no
 * stored model — a healed row is indistinguishable from a fresh one.
 *
 * Repointing beats deleting: the row is what feeds `selected_vendor_model_id`,
 * and a null there sends the device back to its own hardcoded default for
 * offline BYOK work. An explicit, current flagship is the honest answer.
 */
export async function healStrandedModelPicks(d1: D1Database): Promise<HealResult> {
  const db = createDb(d1);
  const now = new Date().toISOString();
  const result: HealResult = { providerRows: 0, preferenceRows: 0, truncated: false };

  // --- user_ai_provider_models -------------------------------------------------
  const providerRows = await db
    .select({
      user_id: userAiProviderModels.user_id,
      provider: userAiProviderModels.provider,
      selected_model_id: userAiProviderModels.selected_model_id,
    })
    .from(userAiProviderModels)
    .limit(HEAL_BATCH + 1);

  if (providerRows.length > HEAL_BATCH) result.truncated = true;

  for (const row of providerRows.slice(0, HEAL_BATCH)) {
    if (getModelById(row.selected_model_id)) continue;
    // This table is per-provider and BYOK-only by construction (a managed user
    // has no per-provider pick to restore), so flagship is the right target.
    const replacement = getFlagshipModel(row.provider as AIProviderId);
    if (!replacement) continue;
    await db
      .update(userAiProviderModels)
      .set({ selected_model_id: replacement.id, updated_at: now })
      .where(
        and(
          eq(userAiProviderModels.user_id, row.user_id),
          eq(userAiProviderModels.provider, row.provider)
        )
      );
    result.providerRows += 1;
  }

  // --- user_ai_preferences -----------------------------------------------------
  const prefRows = await db
    .select({
      user_id: userAiPreferences.user_id,
      credential_source: userAiPreferences.credential_source,
      active_provider: userAiPreferences.active_provider,
      selected_model_id: userAiPreferences.selected_model_id,
    })
    .from(userAiPreferences)
    .where(isNotNull(userAiPreferences.selected_model_id))
    .limit(HEAL_BATCH + 1);

  if (prefRows.length > HEAL_BATCH) result.truncated = true;

  for (const row of prefRows.slice(0, HEAL_BATCH)) {
    const stored = row.selected_model_id;
    if (!stored || getModelById(stored)) continue;
    const provider = row.active_provider as AIProviderId | null;
    const replacement = provider
      ? row.credential_source === 'byok'
        ? getFlagshipModel(provider)
        : getDefaultModel(provider)
      : null;
    await db
      .update(userAiPreferences)
      .set({ selected_model_id: replacement?.id ?? null, updated_at: now })
      .where(eq(userAiPreferences.user_id, row.user_id));
    result.preferenceRows += 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cron entry point
// ---------------------------------------------------------------------------

export async function runAiModelCatalogHousekeeping(
  env: Env,
  now: Date
): Promise<CatalogHealthReport> {
  const providers = await checkCatalogAgainstVendors(env);
  const healed = await healStrandedModelPicks(env.DB);

  for (const p of providers) {
    if (p.skippedReason) {
      console.log(`[ai-model-catalog] skipped ${p.provider}: ${p.skippedReason}`);
    } else if (p.missingAtVendor.length > 0) {
      // console.error so it reaches Sentry — this is the signal that a model in
      // the picker is about to start failing every call made against it.
      console.error(
        `[ai-model-catalog] ${p.provider}: ${p.missingAtVendor.length} catalogued model(s) NOT served by the vendor ` +
          `(${p.missingAtVendor.join(', ')}) — vendor listed ${p.vendorModelCount}. ` +
          'Retire them from MODEL_CATALOG; the nightly heal will move pinned users off.'
      );
    } else {
      console.log(`[ai-model-catalog] ${p.provider}: all entries served (${p.vendorModelCount} listed)`);
    }
  }

  if (healed.providerRows > 0 || healed.preferenceRows > 0) {
    console.log(
      `[ai-model-catalog] healed ${healed.providerRows} provider pick(s) and ${healed.preferenceRows} preference row(s) off retired models`
    );
  }
  if (healed.truncated) {
    // Never let a bounded sweep read as "everything is clean".
    console.log(`[ai-model-catalog] heal hit the ${HEAL_BATCH}-row cap — remaining rows heal on the next run`);
  }

  const report: CatalogHealthReport = {
    checkedAt: now.toISOString(),
    environment: env.ENVIRONMENT,
    providers,
    healed,
  };

  try {
    await env.CONFIG_KV.put(CATALOG_HEALTH_KV_KEY, JSON.stringify(report));
  } catch (error) {
    console.error('[ai-model-catalog] could not store health report:', error);
  }

  return report;
}
