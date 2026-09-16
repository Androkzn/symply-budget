/**
 * Reactive AI entitlement for mobile surfaces.
 * Server GET /ai-access is authoritative; flags gate presentation only.
 * Account-level `ai.status` is derived for Shared User / fleet gating.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  aiAccessApi,
  type AIAccessResponse,
  type AICredentialSummary,
  type AIDenialReason,
  type AIModelOption,
  type AIProviderId,
} from '@api/aiAccess';
import { setPreferredModel, setPreferredProvider } from '@services/aiModelPreference';
import { useAuthStore } from '@stores/authStore';
import { useFeatureFlagStore, isFeatureEnabled } from '@stores/featureFlagStore';

import {
  isAiEntitled,
  resolveAccountAiStatus,
  type AccountAiStatus,
} from '../shared-user';

export type { AIDenialReason, AIModelOption, AIProviderId, AccountAiStatus };

/** A connected BYOK credential in view-model (camelCase) form. */
export interface BYOKConnectionView {
  provider: AIProviderId;
  status: string;
  keyHint: string;
  lastValidatedAt: string | null;
  capabilities: string[];
  /** This provider's chosen model id (per-provider). Null → resolves to flagship. */
  selectedModelId: string | null;
  /** Session-lease expiry ISO (device Keychain is the durable home). Null = no expiry. */
  leaseExpiresAt: string | null;
  /** ISO timestamp of the per-provider data-sharing consent given on Connect. */
  consentAt: string | null;
}

const AI_ACCESS_KEY = ['ai-access'] as const;

export function useAIEntitlement() {
  const queryClient = useQueryClient();
  // Subscribe so flag flips re-render presentation gates.
  useFeatureFlagStore(s => s.remoteFlags);
  useFeatureFlagStore(s => s.version);

  const aiFeaturesEnabled = isFeatureEnabled('aiFeaturesEnabled');
  const subscriptionsEnabled = isFeatureEnabled('subscriptionsEnabled');
  const bringYourOwnAIEnabled = isFeatureEnabled('bringYourOwnAIEnabled');

  // Per-provider rollout switches — a provider can be pulled from the picker
  // remotely (e.g. an outage) without an app release. The picker/manage hub
  // read these so a disabled provider is greyed out instead of 500-ing on save.
  const providerEnabled: Record<AIProviderId, boolean> = {
    openai: isFeatureEnabled('openAIProviderEnabled'),
    anthropic: isFeatureEnabled('anthropicProviderEnabled'),
    gemini: isFeatureEnabled('geminiProviderEnabled'),
  };

  // Gate on full auth rehydration, not just isAuthenticated: isAuthenticated can
  // flip true from the persisted flag before the SecureStore-held token has
  // loaded, which would fire this query pre-token and 401 on every cold launch
  // (this hook is also read by AiLeaseKeeper, mounted unconditionally at the
  // app root, so there's no screen-level auth gate upstream to rely on).
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const query = useQuery({
    queryKey: AI_ACCESS_KEY,
    queryFn: async (): Promise<AIAccessResponse> => aiAccessApi.getAccess(),
    enabled: hasHydrated && isAuthenticated,
    staleTime: 30_000,
  });

  const data = query.data;

  // Mirror each provider's server-side model pick into the on-device cache the
  // offline BYOK ladders read. Without this, a selection made before this cache
  // existed (or on another device) would never reach a local scan, which would
  // silently run the hardcoded default instead.
  //
  // Cache the VENDOR id, never `selected_model_id` — that is our catalog key
  // (`gemini.3-flash`, vendor `gemini-3-flash-preview`) and the provider 404s
  // on it. A server that does
  // not send one leaves the cache empty, which falls back to the provider
  // default: the picker is then inert, but nothing breaks.
  useEffect(() => {
    const connections = data?.byok.connections ?? [];
    if (connections.length === 0) return;
    Promise.all([
      ...connections.map((conn: AICredentialSummary) =>
        setPreferredModel(conn.provider, conn.selected_vendor_model_id ?? null)
      ),
      setPreferredProvider(data?.source === 'byok' ? data?.provider ?? null : null),
    ]).catch(() => undefined);
  }, [data]);

  const canUseAI = aiFeaturesEnabled && (data?.can_use_ai ?? false);
  const accountAiStatus: AccountAiStatus = resolveAccountAiStatus({
    aiFeaturesEnabled,
    canUseAI,
  });

  return {
    isPaid: data?.subscription.is_paid ?? false,
    hasBYOKAccess:
      (data?.byok.connections.length ?? 0) > 0 && bringYourOwnAIEnabled,
    /** Connected BYOK credentials (source of truth for the manage screen). */
    byokConnections: (data?.byok.connections ?? []).map(
      (conn: AICredentialSummary): BYOKConnectionView => ({
        provider: conn.provider,
        status: conn.status,
        keyHint: conn.key_hint,
        lastValidatedAt: conn.last_validated_at,
        capabilities: conn.capabilities,
        selectedModelId: conn.selected_model_id ?? null,
        leaseExpiresAt: conn.lease_expires_at ?? null,
        consentAt: conn.consent_at ?? null,
      })
    ),
    /** Set of providers that already have a stored key (for picker checkmarks). */
    connectedProviders: new Set<AIProviderId>(
      (data?.byok.connections ?? []).map((conn: AICredentialSummary) => conn.provider)
    ),
    /** Per-provider rollout flags (openai / anthropic / gemini). */
    providerEnabled,
    canUseAI,
    /** Account-level AI entitlement (Shared User / fleet spine). */
    accountAiStatus,
    isAccountAiEntitled: isAiEntitled(accountAiStatus),
    source: data?.source ?? null,
    provider: data?.provider ?? null,
    selectedModelId: data?.selected_model_id ?? null,
    availableModels: (data?.available_models ?? []).map(m => ({
      id: m.id,
      displayName: m.display_name,
      profileLabel: m.profile_label,
      capabilities: m.capabilities,
      isDefault: m.is_default,
      flagship: m.flagship ?? false,
    })),
    denialReason: (data?.denial_reason as AIDenialReason | null) ?? null,
    isLoading: query.isLoading,
    subscriptionsEnabled,
    bringYourOwnAIEnabled,
    aiFeaturesEnabled,
    refetch: query.refetch,
    invalidate: () =>
      queryClient.invalidateQueries({ queryKey: AI_ACCESS_KEY }),
  };
}
