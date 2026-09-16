import type { ZodType } from 'zod';

import { captureException } from '@services/monitoring';

export class ApiResponseValidationError extends Error {
  readonly name = 'ApiResponseValidationError';

  constructor(
    message: string,
    readonly issues: unknown
  ) {
    super(message);
  }
}

export type ValidateResponseMode = 'strict' | 'warn';

/**
 * Optional Zod validation at the mobile API boundary (Track A / A3).
 * In dev and when EXPO_PUBLIC_API_VALIDATE=1, mismatches throw in strict mode
 * or log in warn mode so hot paths can adopt validation incrementally.
 */
export function validateApiResponse<T>(
  schema: ZodType<T>,
  payload: unknown,
  context: string,
  mode: ValidateResponseMode = __DEV__ ? 'warn' : 'warn'
): T {
  const parsed = schema.safeParse(payload);
  if (parsed.success) {
    return parsed.data;
  }

  const error = new ApiResponseValidationError(
    `API response validation failed: ${context}`,
    parsed.error.flatten()
  );

  if (mode === 'strict') {
    throw error;
  }

  if (__DEV__) {
    console.warn('[API validate]', context, parsed.error.flatten());
  }
  captureException(error, { source: 'api_validate', context, mode });
  return payload as T;
}

/** True when response validation should run (dev or explicit env flag). */
export function shouldValidateApiResponses(): boolean {
  return __DEV__ || process.env.EXPO_PUBLIC_API_VALIDATE === '1';
}
