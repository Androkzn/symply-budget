import type { AxiosError } from 'axios';

import type { ApiError } from '@/types';

/** Server codes that mean the user must resolve AI access (subscription / API key). */
export const AI_ACCESS_DENIAL_CODES = [
  'ai_access_required',
  'ai_features_disabled',
  'ai_provider_not_connected',
  'ai_provider_key_invalid',
  'ai_provider_unavailable',
  'ai_model_not_available_for_key',
  'ai_provider_capability_unsupported',
] as const;

export type AIAccessDenialCode = (typeof AI_ACCESS_DENIAL_CODES)[number];

const AI_DENIAL_CODE_SET = new Set<string>(AI_ACCESS_DENIAL_CODES);

const DEFAULT_MESSAGES: Record<AIAccessDenialCode, string> = {
  ai_features_disabled: 'AI features are currently disabled',
  ai_access_required: 'AI access requires an Apple subscription or a connected API key',
  ai_provider_not_connected: 'No AI provider API key is connected',
  ai_provider_key_invalid: 'The connected AI provider API key is invalid',
  ai_provider_capability_unsupported: 'The selected provider does not support this feature',
  ai_model_not_available_for_key: 'The selected model is not available for this API key',
  ai_provider_unavailable: 'AI is temporarily unavailable',
};

export function isAIAccessDenialCode(code: unknown): code is AIAccessDenialCode {
  return typeof code === 'string' && AI_DENIAL_CODE_SET.has(code);
}

export function extractApiErrorCode(
  body: { error?: { code?: string }; code?: string } | undefined
): string | undefined {
  const code = body?.error?.code ?? body?.code;
  return typeof code === 'string' ? code : undefined;
}

export function isAIAccessAxiosDenial(
  status: number | undefined,
  code: string | undefined
): code is AIAccessDenialCode {
  return (
    (status === 403 || status === 409 || status === 422 || status === 503) &&
    isAIAccessDenialCode(code)
  );
}

/** Typed error for AI entitlement / provider denials from the API client. */
export class AIAccessError extends Error {
  readonly code: AIAccessDenialCode;
  readonly statusCode: number;
  readonly axiosError?: AxiosError<ApiError>;

  constructor(
    code: AIAccessDenialCode,
    message: string,
    statusCode: number,
    axiosError?: AxiosError<ApiError>
  ) {
    super(message);
    this.name = 'AIAccessError';
    this.code = code;
    this.statusCode = statusCode;
    this.axiosError = axiosError;
  }

  static fromAxiosError(error: AxiosError<ApiError>): AIAccessError | null {
    const status = error.response?.status;
    const body = error.response?.data as
      | { error?: ApiError; code?: string }
      | undefined;
    const code = extractApiErrorCode(body);
    if (!isAIAccessAxiosDenial(status, code)) {
      return null;
    }
    const apiError = body?.error;
    const message =
      apiError?.message ?? DEFAULT_MESSAGES[code] ?? 'AI access denied';
    return new AIAccessError(code, message, status!, error);
  }
}

export function isAIAccessError(error: unknown): error is AIAccessError {
  return error instanceof AIAccessError;
}
