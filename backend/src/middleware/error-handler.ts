import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

import type { Env } from '../types';
import { ApiError } from '../utils/errors';
import { safeErrorLog } from '../utils/log-scrubber';

// Re-export canonical errors for backward compatibility during migration.
export {
  ApiError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  BadRequestError,
  ConflictError,
  GoneError,
  RateLimitError,
  ServiceUnavailableError,
  AIAccessError,
  PersonalHouseholdViolationError,
} from '../utils/errors';

/**
 * Global error handler middleware
 */
export function errorHandler() {
  return async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
    try {
      await next();
    } catch (error) {
      const requestId = c.get('requestId');
      // Scrub secrets before console emission (Track B B7 / OBS-1 / OBS-4).
      safeErrorLog('[ErrorHandler]', {
        requestId,
        method: c.req.method,
        url: c.req.url,
        message: (error as Error).message,
      });

      // Handle Zod validation errors
      if (error instanceof ZodError) {
        const details: Record<string, string[]> = {};
        for (const issue of error.issues) {
          const path = issue.path.join('.');
          if (!details[path]) {
            details[path] = [];
          }
          details[path].push(issue.message);
        }

        return c.json(
          {
            error: {
              code: 'validation_error',
              message: 'Validation failed',
              details,
            },
          },
          400
        );
      }

      // Handle custom API errors (check error name for bundling compatibility)
      const isApiError = error instanceof ApiError ||
        (error as Error).name === 'ApiError' ||
        (error as Error).name === 'ValidationError' ||
        (error as Error).name === 'UnauthorizedError' ||
        (error as Error).name === 'ForbiddenError' ||
        (error as Error).name === 'NotFoundError' ||
        (error as Error).name === 'BadRequestError' ||
        (error as Error).name === 'ConflictError' ||
        (error as Error).name === 'GoneError' ||
        (error as Error).name === 'RateLimitError' ||
        (error as Error).name === 'ServiceUnavailableError' ||
        (error as Error).name === 'AIAccessError' ||
        (error as Error).name === 'PersonalHouseholdViolationError';

      if (isApiError) {
        const apiError = error as ApiError;
        return c.json(
          {
            error: {
              code: apiError.code,
              message: apiError.message,
              details: apiError.details,
            },
          },
          apiError.statusCode as 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 503
        );
      }

      // Handle Hono HTTP exceptions
      if (error instanceof HTTPException) {
        return c.json(
          {
            error: {
              code: 'http_error',
              message: error.message,
            },
          },
          error.status
        );
      }

      // Handle unknown errors — scrub stack / message before logging
      const errorMessage = (error as Error).message || 'Unknown error';
      const errorStack = (error as Error).stack || '';
      safeErrorLog('[ERROR]', {
        requestId: c.get('requestId'),
        url: c.req.url,
        method: c.req.method,
        message: errorMessage,
        stack: errorStack,
        name: (error as Error).name,
      });

      const isDev = c.env.ENVIRONMENT === 'development' || c.env.ENVIRONMENT === 'staging';
      return c.json(
        {
          error: {
            code: 'internal_error',
            message: isDev ? errorMessage : 'An unexpected error occurred',
            ...(isDev && { debug: { stack: errorStack.split('\n').slice(0, 5) } }),
          },
        },
        500
      );
    }
  };
}
