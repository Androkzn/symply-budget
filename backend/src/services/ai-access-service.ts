import { eq } from 'drizzle-orm';

import { getModelById, getFlagshipModel, getDefaultModel } from '../ai/model-catalog';
import { userAiPreferences } from '../db/schema-ai-credentials';
import { BadRequestError } from '../utils/errors';
import { nowIso } from '../utils/id';

import type { AIProviderId } from './ai-entitlement-types';
import { getProviderModel, setProviderModel } from './ai-provider-model-service';
import { createDb } from './db';

export async function getUserAiPreferences(d1: D1Database, userId: string) {
  const db = createDb(d1);
  const [prefs] = await db
    .select()
    .from(userAiPreferences)
    .where(eq(userAiPreferences.user_id, userId))
    .limit(1);
  return prefs ?? null;
}

export async function patchUserAiPreferences(
  d1: D1Database,
  userId: string,
  body: {
    credential_source?: 'simplehouse' | 'byok';
    active_provider?: AIProviderId;
    /** Provider whose model is being set (per-provider). Defaults to the active provider. */
    provider?: AIProviderId;
    selected_model_id?: string;
    allow_paid_fallback?: boolean;
  },
  environment: 'staging' | 'production'
) {
  void environment;
  const db = createDb(d1);
  const now = nowIso();

  const [existing] = await db
    .select()
    .from(userAiPreferences)
    .where(eq(userAiPreferences.user_id, userId))
    .limit(1);

  const source = body.credential_source ?? existing?.credential_source ?? null;

  // A per-provider model set: `{ provider, selected_model_id }` targets that
  // provider's stored pick (which may not be the active one).
  const modelTargetProvider = body.provider ?? body.active_provider ?? null;
  if (body.selected_model_id && modelTargetProvider) {
    await setProviderModel(d1, userId, modelTargetProvider, body.selected_model_id);
  }

  let activeProvider = body.active_provider ?? (existing?.active_provider as AIProviderId | null);
  let selectedModelId = existing?.selected_model_id ?? null;

  if (body.active_provider && body.active_provider !== existing?.active_provider) {
    // Switching active provider → restore that provider's own model: its stored
    // pick, else its flagship (BYOK) / default (managed).
    activeProvider = body.active_provider;
    const stored = await getProviderModel(d1, userId, body.active_provider);
    const fallback =
      source === 'byok' ? getFlagshipModel(body.active_provider) : getDefaultModel(body.active_provider);
    selectedModelId = body.selected_model_id ?? stored ?? fallback?.id ?? null;
  } else if (body.selected_model_id && modelTargetProvider === activeProvider) {
    // Model change for the already-active provider → mirror to the global field.
    selectedModelId = body.selected_model_id;
  }

  if (selectedModelId) {
    const entry = getModelById(selectedModelId);
    if (!entry) {
      // An id the CALLER supplied is a real client error. An id we carried over
      // from the stored row is not: models get retired from the catalog (see
      // MODEL_CATALOG) and the row outlives them, so rejecting it would brick
      // every later patch for that user — including the one that would have
      // moved them off the retired model. Heal to the provider's flagship
      // (BYOK) / default (managed) instead.
      if (body.selected_model_id === selectedModelId) {
        throw new BadRequestError('Unknown selected_model_id');
      }
      const healed = activeProvider
        ? source === 'byok'
          ? getFlagshipModel(activeProvider)
          : getDefaultModel(activeProvider)
        : null;
      selectedModelId = healed?.id ?? null;
    } else if (activeProvider && entry.provider !== activeProvider) {
      throw new BadRequestError('selected_model_id does not belong to active_provider');
    }
  }

  const values = {
    user_id: userId,
    credential_source: body.credential_source ?? existing?.credential_source ?? null,
    active_provider: activeProvider ?? null,
    selected_model_id: selectedModelId,
    allow_paid_fallback: body.allow_paid_fallback ?? existing?.allow_paid_fallback ?? false,
    updated_at: now,
  };

  if (existing) {
    await db
      .update(userAiPreferences)
      .set(values)
      .where(eq(userAiPreferences.user_id, userId));
  } else {
    await db.insert(userAiPreferences).values({
      ...values,
      created_at: now,
    });
  }

  return {
    credential_source: values.credential_source,
    active_provider: values.active_provider,
    selected_model_id: values.selected_model_id,
    allow_paid_fallback: values.allow_paid_fallback,
  };
}
