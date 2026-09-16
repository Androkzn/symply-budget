import { cors } from 'hono/cors';

import type { Env } from '../types';

/**
 * CORS middleware configuration
 */
export function corsMiddleware() {
  return cors({
    origin: (origin, c) => {
      const env = c.env as Env;

      // In development, allow localhost
      if (env.ENVIRONMENT === 'development') {
        return origin;
      }

      // In production, check against allowed origins
      const allowedOrigins = [
        env.APP_URL,
        'https://simplehouse.app',
        'https://www.simplehouse.app',
      ].filter(Boolean);

      if (allowedOrigins.includes(origin)) {
        return origin;
      }

      // Native mobile clients send no Origin — do not return '*' with credentials (SEC-5).
      if (!origin) {
        return allowedOrigins[0] ?? null;
      }

      return null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposeHeaders: ['X-Request-Id', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400, // 24 hours
    credentials: true,
  });
}
