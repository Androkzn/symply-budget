/**
 * AI entitlement types — shared by entitlement-service and API responses.
 * See documents/product/features/ai-paid-subscription-migration-plan.md §4.4.
 */

export type AIProviderId = 'openai' | 'anthropic' | 'gemini';

export type AIDenialReason =
  | 'AI_DISABLED'
  | 'AI_ACCESS_REQUIRED'
  | 'PROVIDER_NOT_CONNECTED'
  | 'PROVIDER_KEY_INVALID'
  | 'PROVIDER_CAPABILITY_UNSUPPORTED'
  | 'MODEL_NOT_AVAILABLE_FOR_KEY'
  | 'NO_PROVIDER_AVAILABLE';

export type AIEntitlementResult =
  | { allowed: true; source: 'simplehouse' | 'byok'; provider: AIProviderId }
  | { allowed: false; reason: AIDenialReason };

/** Map denial reason → HTTP status + API error code. */
export function denialToHttp(reason: AIDenialReason): { status: number; code: string } {
  switch (reason) {
    case 'AI_DISABLED':
      return { status: 403, code: 'ai_features_disabled' };
    case 'AI_ACCESS_REQUIRED':
      return { status: 403, code: 'ai_access_required' };
    case 'PROVIDER_NOT_CONNECTED':
      return { status: 409, code: 'ai_provider_not_connected' };
    case 'PROVIDER_KEY_INVALID':
      return { status: 409, code: 'ai_provider_key_invalid' };
    case 'PROVIDER_CAPABILITY_UNSUPPORTED':
      return { status: 422, code: 'ai_provider_capability_unsupported' };
    case 'MODEL_NOT_AVAILABLE_FOR_KEY':
      return { status: 409, code: 'ai_model_not_available_for_key' };
    case 'NO_PROVIDER_AVAILABLE':
      return { status: 503, code: 'ai_provider_unavailable' };
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/** Billing states persisted on subscriptions; product chooses paidBillingStates. */
export type BillingState = 'normal' | 'grace' | 'paused';

/** Plan default: strict — grace/paused users lose AI (§4.1 / §23 #2). */
export const PAID_BILLING_STATES: ReadonlySet<BillingState> = new Set(['normal']);
