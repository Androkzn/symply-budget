import { z } from 'zod';

const aiProviderIdSchema = z.enum(['openai', 'anthropic', 'gemini']);

/** Model option row in GET /ai-access.available_models. */
export const aiModelOptionSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  profile_label: z.string().nullable(),
  capabilities: z.array(z.string()),
  is_default: z.boolean(),
  /** Provider's most-capable model (BYOK default). Optional for rollout skew. */
  flagship: z.boolean().optional(),
});

export type AIModelOptionContract = z.infer<typeof aiModelOptionSchema>;

/** Connected BYOK credential summary (no secrets). */
export const aiCredentialSummarySchema = z.object({
  provider: aiProviderIdSchema,
  status: z.string(),
  key_hint: z.string(),
  last_validated_at: z.string().nullable(),
  capabilities: z.array(z.string()),
  /** This provider's chosen model (per-provider preference). Null → resolves to flagship. */
  selected_model_id: z.string().nullable().optional(),
  /** Session-lease expiry (device Keychain is the durable home). Null = no expiry. */
  lease_expires_at: z.string().nullable().optional(),
  /** Version of the per-provider data-sharing disclaimer the user accepted on Connect. */
  consent_version: z.string().nullable().optional(),
  /** Timestamp of that explicit consent (Apple 5.1.2(i) audit trail). */
  consent_at: z.string().nullable().optional(),
});

export type AICredentialSummaryContract = z.infer<typeof aiCredentialSummarySchema>;

/** GET /ai-access response — mobile entitlement + model catalog source of truth. */
export const aiAccessResponseSchema = z.object({
  can_use_ai: z.boolean(),
  source: z.enum(['simplehouse', 'byok']).nullable(),
  provider: aiProviderIdSchema.nullable(),
  selected_model_id: z.string().nullable(),
  available_models: z.array(aiModelOptionSchema),
  denial_reason: z.string().nullable(),
  subscription: z.object({
    is_paid: z.boolean(),
  }),
  byok: z.object({
    enabled: z.boolean(),
    connections: z.array(aiCredentialSummarySchema),
  }),
});

export type AIAccessResponseContract = z.infer<typeof aiAccessResponseSchema>;
