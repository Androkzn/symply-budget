/**
 * AI access + model catalog routes (AI Access Migration).
 * GET /ai-access, GET /ai-models, PATCH /ai-preferences
 */

import { Hono } from 'hono';
import { z } from 'zod';

import {
  getCatalogForProvider,
  getModelById,
  toModelOptionDTO,
  type AIModelOptionDTO,
} from '../ai/model-catalog';
import { authMiddleware } from '../middleware/auth';
import { getUserAiPreferences, patchUserAiPreferences } from '../services/ai-access-service';
import type { AIProviderId } from '../services/ai-entitlement-types';
import { getAllProviderModels } from '../services/ai-provider-model-service';
import {
  resolveAIEntitlement,
  isEffectivelyPaid,
  getSubscriptionForEntitlement,
  listActiveByokCredentials,
} from '../services/entitlement-service';
import { getFlags } from '../services/featureFlagService';
import type { Env } from '../types';
import { BadRequestError } from '../utils/errors';

const aiAccess = new Hono<{ Bindings: Env }>();

aiAccess.use('/ai-access', authMiddleware());
aiAccess.use('/ai-models', authMiddleware());
aiAccess.use('/ai-preferences', authMiddleware());

const providerSchema = z.enum(['openai', 'anthropic', 'gemini']);

function envName(environment: string): 'staging' | 'production' {
  return environment === 'production' ? 'production' : 'staging';
}

aiAccess.get('/ai-access', async (c) => {
  const userId = c.get('userId');
  const userEmail = c.get('userEmail');

  const flagsPayload = await getFlags(c.env.CONFIG_KV);
  const flags = flagsPayload.flags;
  const subscription = await getSubscriptionForEntitlement(c.env.DB, userId);
  const isPaid = isEffectivelyPaid(subscription, userEmail);
  const connections = flags.bringYourOwnAIEnabled
    ? await listActiveByokCredentials(c.env.DB, userId)
    : [];

  const prefs = await getUserAiPreferences(c.env.DB, userId);
  const providerModels = connections.length
    ? await getAllProviderModels(c.env.DB, userId)
    : {};

  const entitlement = await resolveAIEntitlement(userId, c.env, {
    subscription,
    flags,
    byokConnections: connections,
    credentialSource: (prefs?.credential_source as 'simplehouse' | 'byok' | null) ?? null,
    userEmail,
  });

  const provider = (entitlement.allowed ? entitlement.provider : prefs?.active_provider) as
    | AIProviderId
    | null
    | undefined;

  let available_models: AIModelOptionDTO[] = [];
  if (provider && providerSchema.safeParse(provider).success) {
    const managedOnly = !entitlement.allowed || entitlement.source === 'simplehouse';
    available_models = getCatalogForProvider(provider, {
      environment: envName(c.env.ENVIRONMENT),
      managedOnly,
    }).map(toModelOptionDTO);
  }

  return c.json({
    can_use_ai: entitlement.allowed,
    source: entitlement.allowed ? entitlement.source : null,
    provider: entitlement.allowed ? entitlement.provider : prefs?.active_provider ?? null,
    // Never report a pick the catalog no longer knows: a retired model id can
    // match nothing in `available_models`, and clients that echo it back get a
    // 400. Null reads as "no explicit pick" and falls back to the flagship.
    selected_model_id: getModelById(prefs?.selected_model_id ?? '')?.id ?? null,
    available_models,
    denial_reason: entitlement.allowed ? null : entitlement.reason,
    subscription: { is_paid: isPaid },
    byok: {
      enabled: flags.bringYourOwnAIEnabled,
      connections: connections.map((conn) => ({
        provider: conn.provider,
        status: conn.status,
        key_hint: conn.key_hint,
        last_validated_at: conn.last_validated_at,
        capabilities: [] as string[],
        selected_model_id: providerModels[conn.provider as AIProviderId] ?? null,
        // A BYOK device calls the provider directly and needs the PROVIDER's id,
        // not our catalog key — see AIModelOptionDTO.
        selected_vendor_model_id:
          getModelById(providerModels[conn.provider as AIProviderId] ?? '')?.vendorModelId ?? null,
        lease_expires_at: conn.expires_at ?? null,
      })),
    },
  });
});

aiAccess.get('/ai-models', async (c) => {
  const userId = c.get('userId');

  const parsed = providerSchema.safeParse(c.req.query('provider'));
  if (!parsed.success) {
    throw new BadRequestError('provider must be openai, anthropic, or gemini');
  }

  const flags = (await getFlags(c.env.CONFIG_KV)).flags;
  const entitlement = await resolveAIEntitlement(userId, c.env, { flags });
  const managedOnly = !entitlement.allowed || entitlement.source === 'simplehouse';

  const models = getCatalogForProvider(parsed.data, {
    environment: envName(c.env.ENVIRONMENT),
    managedOnly,
  }).map(toModelOptionDTO);

  return c.json({ provider: parsed.data, models });
});

const patchPrefsSchema = z.object({
  credential_source: z.enum(['simplehouse', 'byok']).optional(),
  active_provider: providerSchema.optional(),
  /** Provider whose model is being set (per-provider). Defaults to active_provider. */
  provider: providerSchema.optional(),
  selected_model_id: z.string().min(1).optional(),
  allow_paid_fallback: z.boolean().optional(),
});

aiAccess.patch('/ai-preferences', async (c) => {
  const userId = c.get('userId');
  const body = patchPrefsSchema.parse(await c.req.json());
  const result = await patchUserAiPreferences(
    c.env.DB,
    userId,
    body,
    envName(c.env.ENVIRONMENT)
  );
  return c.json(result);
});

export default aiAccess;
