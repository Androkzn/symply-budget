/**
 * Sole construction site for AI providers (Phase 7).
 */

import { resolveProviderApiKey } from '../services/ai-credential-resolver';
import type { AIProviderId } from '../services/ai-entitlement-types';
import { usageRecorderFor, type AiUsageContext } from '../services/ai-usage-service';
import type { Env } from '../types';

import { ClaudeProvider } from './claude-provider';
import { GeminiProvider } from './gemini-provider';
import { getDefaultModel, SPECIALTY_MODELS } from './model-catalog';
import { OpenAIProvider } from './openai-provider';
import type { AIProvider, AIProviderOptions } from './provider';

export interface CreateProviderArgs {
  provider: AIProviderId;
  apiKey: string;
  /** Vendor model ID (already resolved from catalog). */
  model?: string;
  options?: Omit<AIProviderOptions, 'model'>;
}

export function createProviderAdapter(args: CreateProviderArgs): AIProvider {
  const defaultVendor = getDefaultModel(args.provider)?.vendorModelId;
  const model = args.model || defaultVendor;
  const options: AIProviderOptions = { ...args.options, model };

  switch (args.provider) {
    case 'openai':
      return new OpenAIProvider(args.apiKey, options);
    case 'anthropic':
      return new ClaudeProvider(args.apiKey, options);
    case 'gemini':
      return new GeminiProvider(args.apiKey, options);
    default: {
      const _exhaustive: never = args.provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

/**
 * An adapter that can actually produce an image, or null.
 *
 * `generateImage` is optional on `AIProvider` (see its doc comment), so a call
 * site has two things to get right: pick a vendor that has an image model, and
 * pass that vendor's image model rather than its chat one. Both live in
 * `SPECIALTY_MODELS`, and doing the lookup here means a service never hardcodes
 * `'gpt-image-1'` — the day a second vendor gains an image model, or the model
 * id changes, this function is the only edit.
 *
 * Returns null rather than throwing when nothing is available (no vendor with
 * an image model, or no key for the one there is), because "we cannot render a
 * preview right now" is a state a member should be told about plainly, not an
 * exception in a log.
 */
export async function imageCapableProviderFor(
  env: Env,
  userId: string | null | undefined,
  usageContext: AiUsageContext
): Promise<{ provider: AIProvider; model: string } | null> {
  const order: AIProviderId[] = ['openai', 'gemini', 'anthropic'];
  for (const id of order) {
    const model = SPECIALTY_MODELS[id]?.imageGeneration;
    if (!model) continue;
    const { apiKey } = await resolveProviderApiKey(env, userId, id);
    if (!apiKey) continue;
    const provider = createProviderAdapter({
      provider: id,
      apiKey,
      model,
      options: { onUsage: usageRecorderFor(env, usageContext) },
    });
    if (typeof provider.generateImage !== 'function' || !provider.isAvailable()) continue;
    return { provider, model };
  }
  return null;
}

/** BYOK-aware Anthropic adapter with usage tracking for service-layer call sites. */
export async function createAnthropicAdapterForUser(
  env: Env,
  userId: string | null | undefined,
  usageContext: AiUsageContext,
  model?: string
): Promise<ClaudeProvider> {
  const { apiKey } = await resolveProviderApiKey(env, userId, 'anthropic');
  return createProviderAdapter({
    provider: 'anthropic',
    apiKey: apiKey || (env.ANTHROPIC_API_KEY ?? ''),
    model,
    options: { onUsage: usageRecorderFor(env, usageContext) },
  }) as ClaudeProvider;
}

/** Token counts returned by Anthropic-compatible extraction flows. */
export type ModelTokenUsage = {
  input_tokens: number;
  output_tokens: number;
};
