/**
 * AI access API — entitlement, model catalog, preferences.
 */

import { aiAccessResponseSchema } from '@symply/contracts';

import { api } from './client';
import { shouldValidateApiResponses, validateApiResponse } from './validateResponse';

export type AIProviderId = 'openai' | 'anthropic' | 'gemini';

export type AIDenialReason =
  | 'AI_DISABLED'
  | 'AI_ACCESS_REQUIRED'
  | 'PROVIDER_NOT_CONNECTED'
  | 'PROVIDER_KEY_INVALID'
  | 'PROVIDER_CAPABILITY_UNSUPPORTED'
  | 'MODEL_NOT_AVAILABLE_FOR_KEY'
  | 'NO_PROVIDER_AVAILABLE';

export interface AIModelOption {
  id: string;
  display_name: string;
  profile_label: string | null;
  capabilities: string[];
  is_default: boolean;
  /** Provider's most-capable model — the BYOK default. */
  flagship?: boolean;
  /**
   * The id the PROVIDER's own API expects (`gemini-3-flash-preview`), which is
   * NOT `id` (`gemini.3-flash` — our catalog key). A BYOK device calls
   * the provider directly, so it must send this one; sending the catalog id is
   * a 404 from the provider. Optional: older servers omit it, and the client
   * then falls back to the provider default rather than guessing.
   */
  vendor_model_id?: string | null;
}

/** A single connected BYOK credential, as reported by the server. */
export interface AICredentialSummary {
  provider: AIProviderId;
  status: string;
  key_hint: string;
  last_validated_at: string | null;
  capabilities: string[];
  /** This provider's chosen model (per-provider). Null → resolves to flagship. */
  selected_model_id?: string | null;
  /** `selected_model_id` translated to the provider's own id — see AIModelOption. */
  selected_vendor_model_id?: string | null;
  /** Session-lease expiry ISO (device Keychain is the durable home). Null = no expiry. */
  lease_expires_at?: string | null;
  /** Version of the per-provider data-sharing disclaimer accepted on Connect. */
  consent_version?: string | null;
  /** Timestamp of that explicit consent (Apple 5.1.2(i) audit trail). */
  consent_at?: string | null;
}

export interface AIAccessResponse {
  can_use_ai: boolean;
  source: 'simplehouse' | 'byok' | null;
  provider: AIProviderId | null;
  selected_model_id: string | null;
  available_models: AIModelOption[];
  denial_reason: AIDenialReason | string | null;
  subscription: { is_paid: boolean };
  byok: {
    enabled: boolean;
    connections: AICredentialSummary[];
  };
}

export const aiAccessApi = {
  getAccess: async () => {
    const data = (await api.get<AIAccessResponse>('/ai-access')) as AIAccessResponse;
    if (!shouldValidateApiResponses()) return data;
    return validateApiResponse(aiAccessResponseSchema, data, 'GET /ai-access');
  },
  getModels: (provider: AIProviderId) =>
    api.get<{ provider: AIProviderId; models: AIModelOption[] }>(
      `/ai-models?provider=${provider}`
    ) as Promise<{ provider: AIProviderId; models: AIModelOption[] }>,
  patchPreferences: (body: {
    credential_source?: 'simplehouse' | 'byok';
    active_provider?: AIProviderId;
    /** Provider whose model is being set (per-provider). Defaults to active_provider. */
    provider?: AIProviderId;
    selected_model_id?: string;
    allow_paid_fallback?: boolean;
  }) =>
    api.patch<{
      credential_source: string | null;
      active_provider: string | null;
      selected_model_id: string | null;
      allow_paid_fallback: boolean;
    }>('/ai-preferences', body),
  /** Connected-credential metadata (no secrets) — source for the manage screen. */
  listConnections: () =>
    api.get<{ credentials: AICredentialSummary[] }>('/ai-credentials') as Promise<{
      credentials: AICredentialSummary[];
    }>,
  /** Re-probe a stored key; server updates + returns the credential's status. */
  validateConnection: (provider: AIProviderId) =>
    api.post<AICredentialSummary>(
      `/ai-credentials/${provider}/validate`
    ) as Promise<AICredentialSummary>,
  /**
   * Dry-run a freshly-typed key (nothing saved) so the user can verify it works
   * before committing. Never rejects on a bad key — resolves `{ ok: false }`.
   */
  testConnection: (provider: AIProviderId, apiKey: string) =>
    api.post<{ provider: AIProviderId; ok: boolean; status: string; error_code: string | null }>(
      `/ai-credentials/${provider}/validate`,
      { api_key: apiKey }
    ) as Promise<{ provider: AIProviderId; ok: boolean; status: string; error_code: string | null }>,
  /**
   * Mint / refresh a short-lived server session lease from the device-held key.
   * The key's durable home is the Keychain; this only refreshes the encrypted,
   * auto-expiring server copy that lets background AI run.
   *
   * `consent` is sent ONLY on a user-facing connect (the connect screen), where
   * it records the per-provider data-sharing acknowledgement (Apple 5.1.2(i)).
   * Background re-leases (AiLeaseKeeper) omit it, so a silent refresh never
   * overwrites the recorded consent. See
   * documents/engineering/ai-provider-consent-legal.md.
   */
  createSessionLease: (
    provider: AIProviderId,
    apiKey: string,
    consent?: { version: string; accepted_at: string }
  ) =>
    api.post<{ provider: AIProviderId; status: string; key_hint: string; expires_at: string | null }>(
      `/ai-credentials/${provider}/session-lease`,
      consent ? { api_key: apiKey, consent } : { api_key: apiKey }
    ) as Promise<{ provider: AIProviderId; status: string; key_hint: string; expires_at: string | null }>,
  /** Disconnect (delete) a stored credential for a provider. */
  deleteConnection: (provider: AIProviderId) =>
    api.delete<{ success: boolean }>(`/ai-credentials/${provider}`) as Promise<{
      success: boolean;
    }>,
};
