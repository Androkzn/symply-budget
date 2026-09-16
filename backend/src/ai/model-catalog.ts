/**
 * Server-controlled per-provider model catalog (≤5 selectable chat/reasoning models).
 * See documents/product/features/ai-paid-subscription-migration-plan.md §19.5 / §19.5.1.
 *
 * Client never free-types vendor model IDs — only registry keys from this catalog.
 */

import type { AIProviderId } from '../services/ai-entitlement-types';

import { assertPricingCoversCatalog } from './model-pricing';

export type AICapability =
  | 'text'
  | 'structured_output'
  | 'tool_calling'
  | 'image_understanding'
  | 'pdf_understanding'
  | 'web_grounded_search'
  | 'embeddings'
  | 'image_generation'
  | 'realtime_audio'
  | 'realtime_audio_transport';

export type ModelProfileLabel = 'quality' | 'balanced' | 'fast' | 'economy' | string;

export interface ModelCatalogEntry {
  id: string;
  provider: AIProviderId;
  vendorModelId: string;
  displayName: string;
  profileLabel: ModelProfileLabel;
  isDefault: boolean;
  /**
   * The provider's most-capable model — the BYOK default. Distinct from `isDefault`,
   * which points at the balanced/economy tier for managed cost control. Exactly one
   * flagship per provider (enforced by `assertModelCatalogValid`).
   */
  flagship?: boolean;
  /** false => BYOK / explicit opt-in only (managed catalog hides frontier). */
  managedVisible: boolean;
  capabilities: AICapability[];
  contextTokens: number;
  maxOutputTokens: number;
  environments: Array<'staging' | 'production'>;
  retirementNotBefore?: string;
}

export interface SpecialtyModelMap {
  openai: {
    imageGeneration: string;
    realtimeAudio: string;
    realtimeAudioMini?: string;
    embeddings?: string;
    transcription?: string;
  };
  anthropic: Record<string, never>;
  gemini: {
    imageGeneration?: string;
    embeddings?: string;
    liveAudio?: string;
  };
}

const CHAT_CAPS: AICapability[] = [
  'text',
  'structured_output',
  'tool_calling',
  'image_understanding',
  'pdf_understanding',
];

const ALL_ENVS: Array<'staging' | 'production'> = ['staging', 'production'];

/** V1 catalog — verified IDs as of 2026-07-10. Re-check before production lock. */
export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  // OpenAI — 3 chat tiers
  {
    id: 'openai.gpt-5.6-sol',
    provider: 'openai',
    vendorModelId: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    profileLabel: 'quality',
    isDefault: false,
    flagship: true,
    managedVisible: false,
    capabilities: CHAT_CAPS,
    contextTokens: 1_050_000,
    maxOutputTokens: 128_000,
    environments: ALL_ENVS,
  },
  {
    id: 'openai.gpt-5.6-terra',
    provider: 'openai',
    vendorModelId: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    profileLabel: 'balanced',
    isDefault: true,
    managedVisible: true,
    capabilities: CHAT_CAPS,
    contextTokens: 1_050_000,
    maxOutputTokens: 128_000,
    environments: ALL_ENVS,
  },
  {
    id: 'openai.gpt-5.6-luna',
    provider: 'openai',
    vendorModelId: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    profileLabel: 'fast',
    isDefault: false,
    managedVisible: true,
    capabilities: CHAT_CAPS,
    contextTokens: 1_050_000,
    maxOutputTokens: 128_000,
    environments: ALL_ENVS,
  },

  // Anthropic — 4 chat models
  {
    id: 'anthropic.claude-fable-5',
    provider: 'anthropic',
    vendorModelId: 'claude-fable-5',
    displayName: 'Claude Fable 5',
    profileLabel: 'quality',
    isDefault: false,
    flagship: true,
    managedVisible: false,
    capabilities: CHAT_CAPS,
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
    environments: ALL_ENVS,
  },
  {
    id: 'anthropic.claude-opus-4-8',
    provider: 'anthropic',
    vendorModelId: 'claude-opus-4-8',
    displayName: 'Claude Opus 4.8',
    profileLabel: 'quality',
    isDefault: false,
    managedVisible: false,
    capabilities: CHAT_CAPS,
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
    environments: ALL_ENVS,
  },
  {
    id: 'anthropic.claude-sonnet-5',
    provider: 'anthropic',
    vendorModelId: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 5',
    profileLabel: 'balanced',
    isDefault: true,
    managedVisible: true,
    capabilities: CHAT_CAPS,
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
    environments: ALL_ENVS,
  },
  {
    id: 'anthropic.claude-haiku-4-5',
    provider: 'anthropic',
    vendorModelId: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5',
    profileLabel: 'fast',
    isDefault: false,
    managedVisible: true,
    capabilities: CHAT_CAPS,
    contextTokens: 200_000,
    maxOutputTokens: 64_000,
    environments: ALL_ENVS,
  },

  // Gemini — 3 verified IDs
  {
    id: 'gemini.3.1-pro',
    provider: 'gemini',
    vendorModelId: 'gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro',
    profileLabel: 'quality',
    isDefault: false,
    flagship: true,
    managedVisible: false,
    capabilities: CHAT_CAPS,
    contextTokens: 1_048_576,
    maxOutputTokens: 65_536,
    environments: ALL_ENVS,
  },
  {
    id: 'gemini.3.5-flash',
    provider: 'gemini',
    vendorModelId: 'gemini-3.5-flash',
    displayName: 'Gemini 3.5 Flash',
    profileLabel: 'balanced',
    isDefault: true,
    managedVisible: true,
    capabilities: CHAT_CAPS,
    contextTokens: 1_048_576,
    maxOutputTokens: 65_536,
    environments: ALL_ENVS,
  },
  {
    id: 'gemini.3-flash',
    provider: 'gemini',
    vendorModelId: 'gemini-3-flash-preview',
    displayName: 'Gemini 3 Flash',
    profileLabel: 'balanced',
    isDefault: false,
    managedVisible: true,
    capabilities: CHAT_CAPS,
    contextTokens: 1_048_576,
    maxOutputTokens: 65_536,
    environments: ALL_ENVS,
  },
  // gemini-3.1-flash-lite was REMOVED on 2026-08-14. It advertised CHAT_CAPS
  // (which includes `image_understanding`) and the picker offered it, but it
  // returned an empty item list for every receipt photo — a legible 960x1280
  // receipt that gemini-3.5-flash reads as 17 line items came back as zero.
  // A model in this catalog is selectable for vision features (receipt scan,
  // savings import, mortgage statement, garbage photo detect), so one that
  // cannot actually read an image is a silent "Nothing found" for whoever
  // picks it. Re-add only with a capability set it can honour.
] as const;

/** Specialty models outside the user-facing ≤5 picker. */
export const SPECIALTY_MODELS: SpecialtyModelMap = {
  openai: {
    imageGeneration: 'gpt-image-1',
    realtimeAudio: 'gpt-realtime-2.1',
    realtimeAudioMini: 'gpt-realtime-2.1-mini',
    transcription: 'gpt-4o-transcribe',
  },
  anthropic: {},
  gemini: {
    embeddings: 'gemini-embedding-2',
  },
};

export class ModelCatalogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelCatalogValidationError';
  }
}

export function assertModelCatalogValid(
  catalog: readonly ModelCatalogEntry[] = MODEL_CATALOG
): void {
  const providers: AIProviderId[] = ['openai', 'anthropic', 'gemini'];
  const seenIds = new Set<string>();

  for (const provider of providers) {
    const entries = catalog.filter((e) => e.provider === provider);
    if (entries.length > 5) {
      throw new ModelCatalogValidationError(
        `${provider} catalog has ${entries.length} entries (max 5)`
      );
    }
    const defaults = entries.filter((e) => e.isDefault);
    if (entries.length > 0 && defaults.length !== 1) {
      throw new ModelCatalogValidationError(
        `${provider} must have exactly one default (found ${defaults.length})`
      );
    }
    const flagships = entries.filter((e) => e.flagship);
    if (entries.length > 0 && flagships.length !== 1) {
      throw new ModelCatalogValidationError(
        `${provider} must have exactly one flagship (found ${flagships.length})`
      );
    }
    const vendorIds = new Set<string>();
    for (const e of entries) {
      if (!e.id.startsWith(`${provider}.`)) {
        throw new ModelCatalogValidationError(
          `registry key ${e.id} must start with ${provider}.`
        );
      }
      if (seenIds.has(e.id)) {
        throw new ModelCatalogValidationError(`duplicate registry key ${e.id}`);
      }
      seenIds.add(e.id);
      if (vendorIds.has(e.vendorModelId)) {
        throw new ModelCatalogValidationError(
          `duplicate vendorModelId ${e.vendorModelId} for ${provider}`
        );
      }
      vendorIds.add(e.vendorModelId);
      if (e.managedVisible) {
        if (!e.capabilities.includes('text') || !e.capabilities.includes('structured_output')) {
          throw new ModelCatalogValidationError(
            `${e.id} is managedVisible but missing text/structured_output`
          );
        }
      }
    }
  }

  // A catalogued model with no exact price gets billed at whatever family
  // pattern it happens to match — which is how a new release silently inherits
  // its predecessor's rate. Fail here instead.
  assertPricingCoversCatalog(catalog);
}

// Validate at module load so misconfigured catalogs fail fast in tests/dev.
assertModelCatalogValid();

export function getCatalogForProvider(
  provider: AIProviderId,
  options?: {
    environment?: 'staging' | 'production';
    managedOnly?: boolean;
  }
): ModelCatalogEntry[] {
  const env = options?.environment ?? 'production';
  return MODEL_CATALOG.filter((e) => {
    if (e.provider !== provider) return false;
    if (!e.environments.includes(env)) return false;
    if (options?.managedOnly && !e.managedVisible) return false;
    return true;
  });
}

export function getDefaultModel(provider: AIProviderId): ModelCatalogEntry | null {
  return MODEL_CATALOG.find((e) => e.provider === provider && e.isDefault) ?? null;
}

/**
 * The provider's most-capable model — the BYOK default. Falls back to the
 * balanced default if no flagship is flagged (shouldn't happen; validated at load).
 */
export function getFlagshipModel(provider: AIProviderId): ModelCatalogEntry | null {
  return (
    MODEL_CATALOG.find((e) => e.provider === provider && e.flagship) ??
    getDefaultModel(provider)
  );
}

export function getModelById(id: string): ModelCatalogEntry | null {
  return MODEL_CATALOG.find((e) => e.id === id) ?? null;
}

/**
 * Public picker DTO.
 *
 * `vendor_model_id` used to be withheld ("no vendor secrets"), but a BYOK device
 * calls the provider's API directly from the member's own key — it cannot route
 * through the resolver, so without this field it has nothing valid to send. Our
 * catalog key is NOT interchangeable (`gemini.3-flash` vs the provider's
 * `gemini-3-flash-preview`), and sending the catalog key is a 404 (observed
 * 2026-08-14 on Budget receipt scan). These are published model names, not
 * secrets — the key itself never leaves the device Keychain.
 */
export interface AIModelOptionDTO {
  id: string;
  display_name: string;
  profile_label: string | null;
  capabilities: AICapability[];
  is_default: boolean;
  /** The provider's most-capable model — the BYOK default (see `getFlagshipModel`). */
  flagship: boolean;
  /** The id the provider's own API expects — for direct BYOK calls from device. */
  vendor_model_id: string;
}

export function toModelOptionDTO(entry: ModelCatalogEntry): AIModelOptionDTO {
  return {
    id: entry.id,
    display_name: entry.displayName,
    profile_label: entry.profileLabel,
    capabilities: entry.capabilities,
    is_default: entry.isDefault,
    flagship: entry.flagship === true,
    vendor_model_id: entry.vendorModelId,
  };
}
