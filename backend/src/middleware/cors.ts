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
      const configuredWebOrigins = (env.WEB_APP_ORIGINS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

      const allowedOrigins = [
        env.APP_URL,
        ...configuredWebOrigins,
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
    // The Web client includes both cache headers on login and authenticated reads.
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Cache-Control', 'Pragma'],
    exposeHeaders: ['X-Request-Id', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400, // 24 hours
    credentials: true,
  });
}
