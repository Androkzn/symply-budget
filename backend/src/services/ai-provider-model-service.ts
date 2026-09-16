/**
 * Per-provider chosen model (see `user_ai_provider_models`). Each provider
 * remembers its own model pick so switching the active provider restores its
 * model instead of resetting. Absent row → caller falls back to flagship (BYOK)
 * or default (managed).
 *
 * A row can outlive its catalog entry: models are RETIRED from `MODEL_CATALOG`
 * when they misbehave (e.g. `gemini.3.1-flash-lite`, pulled 2026-08-14), and the
 * rows pointing at them stay behind. Reads therefore treat a retired id as "never
 * chosen" — anything else hands callers an id that fails their own catalog
 * validation, which is how a stale Gemini pick made the provider impossible to
 * activate at all (PATCH /ai-preferences 400 "Unknown selected_model_id").
 */
import { and, eq } from 'drizzle-orm';

import { getModelById } from '../ai/model-catalog';
import { userAiProviderModels } from '../db/schema-ai-credentials';
import { BadRequestError } from '../utils/errors';
import { nowIso } from '../utils/id';

import type { AIProviderId } from './ai-entitlement-types';
import { createDb } from './db';

/** A stored id still in the catalog, or null (never chosen / since retired). */
function liveModelId(storedId: string | null | undefined): string | null {
  if (!storedId) return null;
  return getModelById(storedId) ? storedId : null;
}

/**
 * The registry model id this provider is set to, or null if never chosen (or
 * chosen and since retired from the catalog).
 */
export async function getProviderModel(
  d1: D1Database,
  userId: string,
  provider: AIProviderId
): Promise<string | null> {
  const db = createDb(d1);
  const [row] = await db
    .select({ selected_model_id: userAiProviderModels.selected_model_id })
    .from(userAiProviderModels)
    .where(
      and(eq(userAiProviderModels.user_id, userId), eq(userAiProviderModels.provider, provider))
    )
    .limit(1);
  return liveModelId(row?.selected_model_id);
}

/** Map of provider → chosen registry model id, for surfacing per-connection. */
export async function getAllProviderModels(
  d1: D1Database,
  userId: string
): Promise<Partial<Record<AIProviderId, string>>> {
  const db = createDb(d1);
  const rows = await db
    .select({
      provider: userAiProviderModels.provider,
      selected_model_id: userAiProviderModels.selected_model_id,
    })
    .from(userAiProviderModels)
    .where(eq(userAiProviderModels.user_id, userId));
  const out: Partial<Record<AIProviderId, string>> = {};
  for (const r of rows) {
    const live = liveModelId(r.selected_model_id);
    if (live) out[r.provider as AIProviderId] = live;
  }
  return out;
}

/** Upsert this provider's chosen model. Validates it belongs to the provider. */
export async function setProviderModel(
  d1: D1Database,
  userId: string,
  provider: AIProviderId,
  selectedModelId: string
): Promise<void> {
  const entry = getModelById(selectedModelId);
  if (!entry) throw new BadRequestError('Unknown selected_model_id');
  if (entry.provider !== provider) {
    throw new BadRequestError('selected_model_id does not belong to provider');
  }

  const db = createDb(d1);
  const now = nowIso();
  const updated = await db
    .update(userAiProviderModels)
    .set({ selected_model_id: selectedModelId, updated_at: now })
    .where(
      and(eq(userAiProviderModels.user_id, userId), eq(userAiProviderModels.provider, provider))
    )
    .returning({ provider: userAiProviderModels.provider });

  if (updated.length === 0) {
    await db
      .insert(userAiProviderModels)
      .values({ user_id: userId, provider, selected_model_id: selectedModelId, updated_at: now });
  }
}

/** Seed a provider's model only if it has none yet (e.g. flagship on first connect). */
export async function seedProviderModelIfUnset(
  d1: D1Database,
  userId: string,
  provider: AIProviderId,
  selectedModelId: string
): Promise<void> {
  const existing = await getProviderModel(d1, userId, provider);
  if (existing) return;
  await setProviderModel(d1, userId, provider, selectedModelId);
}

export async function deleteProviderModel(
  d1: D1Database,
  userId: string,
  provider: AIProviderId
): Promise<void> {
  const db = createDb(d1);
  await db
    .delete(userAiProviderModels)
    .where(
      and(eq(userAiProviderModels.user_id, userId), eq(userAiProviderModels.provider, provider))
    );
}
