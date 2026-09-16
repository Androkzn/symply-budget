/**
 * Resolve selected_model_id against the server catalog for execution.
 * See documents/product/features/ai-paid-subscription-migration-plan.md §19.5.1.
 */

import type { AIProviderId } from '../services/ai-entitlement-types';

import {
  type AICapability,
  type ModelCatalogEntry,
  getCatalogForProvider,
  getDefaultModel,
  getModelById,
} from './model-catalog';

export type ModelResolveDenial =
  | 'NO_PROVIDER_AVAILABLE'
  | 'PROVIDER_CAPABILITY_UNSUPPORTED'
  | 'MODEL_NOT_AVAILABLE_FOR_KEY';

export type ModelResolveResult =
  | {
      ok: true;
      registryKey: string;
      vendorModelId: string;
      entry: ModelCatalogEntry;
      substituted: boolean;
    }
  | { ok: false; reason: ModelResolveDenial };

export interface ResolveModelArgs {
  provider: AIProviderId;
  selectedModelId?: string | null;
  accessSource: 'simplehouse' | 'byok';
  requiredCapabilities?: AICapability[];
  /** BYOK: registry keys known callable for this credential. Omit = assume all available. */
  callableRegistryKeys?: ReadonlySet<string> | null;
  environment?: 'staging' | 'production';
}

function capabilitiesSatisfied(
  entry: ModelCatalogEntry,
  required: AICapability[] | undefined
): boolean {
  if (!required || required.length === 0) return true;
  return required.every((c) => entry.capabilities.includes(c));
}

export function resolveModelForExecution(args: ResolveModelArgs): ModelResolveResult {
  const managedOnly = args.accessSource === 'simplehouse';
  const entries = getCatalogForProvider(args.provider, {
    environment: args.environment,
    managedOnly,
  });

  if (entries.length === 0) {
    return { ok: false, reason: 'NO_PROVIDER_AVAILABLE' };
  }

  const defaultEntry =
    entries.find((e) => e.isDefault) ?? getDefaultModel(args.provider) ?? entries[0];

  let candidate: ModelCatalogEntry | null = null;
  let substituted = false;

  if (args.selectedModelId) {
    const selected = getModelById(args.selectedModelId);
    if (selected && selected.provider === args.provider && entries.some((e) => e.id === selected.id)) {
      candidate = selected;
    } else {
      candidate = defaultEntry;
      substituted = true;
    }
  } else {
    candidate = defaultEntry;
  }

  if (!candidate) {
    return { ok: false, reason: 'NO_PROVIDER_AVAILABLE' };
  }

  if (!capabilitiesSatisfied(candidate, args.requiredCapabilities)) {
    const alt = entries.find((e) => capabilitiesSatisfied(e, args.requiredCapabilities));
    if (!alt) {
      return { ok: false, reason: 'PROVIDER_CAPABILITY_UNSUPPORTED' };
    }
    candidate = alt;
    substituted = true;
  }

  if (args.accessSource === 'byok' && args.callableRegistryKeys) {
    if (!args.callableRegistryKeys.has(candidate.id)) {
      const fallback = entries.find(
        (e) => e.isDefault && args.callableRegistryKeys!.has(e.id)
      ) ?? entries.find((e) => args.callableRegistryKeys!.has(e.id));

      if (!fallback) {
        return { ok: false, reason: 'MODEL_NOT_AVAILABLE_FOR_KEY' };
      }
      candidate = fallback;
      substituted = true;
    }
  }

  return {
    ok: true,
    registryKey: candidate.id,
    vendorModelId: candidate.vendorModelId,
    entry: candidate,
    substituted,
  };
}
