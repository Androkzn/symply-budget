import {
  type AIDenialReason,
  denialToHttp,
} from '../services/ai-entitlement-types';

/**
 * Canonical API error hierarchy. Imported by services/routes; the global
 * error-handler middleware maps these to HTTP responses via `instanceof ApiError`.
 */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, string[]>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ValidationError extends ApiError {
  constructor(detailsOrMessage: Record<string, string[]> | string) {
    if (typeof detailsOrMessage === 'string') {
      super('validation_error', detailsOrMessage, 400);
    } else {
      super('validation_error', 'Validation failed', 400, detailsOrMessage);
    }
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized') {
    super('unauthorized', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden') {
    super('forbidden', message, 403);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends ApiError {
  constructor(resourceOrMessage: string = 'Resource') {
    const message = resourceOrMessage.endsWith(' not found')
      ? resourceOrMessage
      : `${resourceOrMessage} not found`;
    super('not_found', message, 404);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string) {
    super('bad_request', message, 400);
    this.name = 'BadRequestError';
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super('conflict', message, 409);
    this.name = 'ConflictError';
  }
}

export class GoneError extends ApiError {
  constructor(message: string) {
    super('gone', message, 410);
    this.name = 'GoneError';
  }
}

export class RateLimitError extends ApiError {
  constructor(retryAfter?: number) {
    super('rate_limited', 'Too many requests. Please try again later.', 429);
    this.name = 'RateLimitError';
    if (retryAfter) {
      this.details = { retry_after: [retryAfter.toString()] };
    }
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(message = 'Service temporarily unavailable') {
    super('service_unavailable', message, 503);
    this.name = 'ServiceUnavailableError';
  }
}

/**
 * A second `user_id` was offered to a household that may only hold one
 * (Health plan §1.2 / §6 Stage He5, promoted into DoD He0).
 *
 * Distinct from `ForbiddenError` on purpose: "not a member" and "this ledger is
 * personal and you are not its owner" are different facts, and only the second
 * one means the control plane just refused to turn a personal ledger into a
 * shared one. Ops needs to be able to count it.
 */
export class PersonalHouseholdViolationError extends ApiError {
  constructor(message = 'This household is personal and accepts only its owner') {
    super('personal_household_single_user', message, 403);
    this.name = 'PersonalHouseholdViolationError';
  }
}

/** AI entitlement / provider denials (§4.4). */
export class AIAccessError extends ApiError {
  constructor(code: string, message: string, statusCode: number) {
    super(code, message, statusCode);
    this.name = 'AIAccessError';
  }

  static fromReason(reason: AIDenialReason): AIAccessError {
    const { status, code } = denialToHttp(reason);
    const messages: Record<string, string> = {
      ai_features_disabled: 'AI features are currently disabled',
      ai_access_required: 'AI access requires an Apple subscription or a connected API key',
      ai_provider_not_connected: 'No AI provider API key is connected',
      ai_provider_key_invalid: 'The connected AI provider API key is invalid',
      ai_provider_capability_unsupported: 'The selected provider does not support this feature',
      ai_model_not_available_for_key: 'The selected model is not available for this API key',
      ai_provider_unavailable: 'AI is temporarily unavailable',
    };
    return new AIAccessError(code, messages[code] ?? 'AI access denied', status);
  }
}
