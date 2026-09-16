import { Context, Next } from 'hono';

import { isBudgetApiEnabled } from '../config/budget-api';
import type { Env, AccessTokenPayload } from '../types';
import { verifyAccessToken } from '../utils/jwt';
import { WrongTokenClassError } from '../utils/platform-jwt';

import { resolveTrustedCallerBrand } from './platform-caller';

// Extend Hono's context to include user info
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    userEmail: string;
    userEmailVerified: boolean;
    user: AccessTokenPayload;
  }
}

/**
 * Authentication middleware - requires valid JWT
 */
export function authMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const path = c.req.path;

    // House Worker: money product disabled — 404 before JWT (Symply Budget owns these).
    // Path segments only: `budget` / `savings` / `wishes` — not `home-budget`.
    if (!isBudgetApiEnabled(c.env)) {
      const segments = c.req.path.split('/').filter(Boolean);
      if (segments.some((s) => s === 'budget' || s === 'savings' || s === 'wishes')) {
        return c.json({ error: 'Not found' }, 404);
      }
    }

    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error(`[auth] Missing or invalid authorization header for ${path}`);
      return c.json(
        {
          error: {
            code: 'unauthorized',
            message: 'Missing or invalid authorization header',
          },
        },
        401
      );
    }

    const token = authHeader.slice(7);
    const tokenPrefix = token.substring(0, 20);
    console.log(`[auth] Verifying token for ${path}, token prefix: ${tokenPrefix}...`);

    // Trusted child→House proxy (e.g. Kaizen/Budget forwarding accept-terms,
    // change-password, delete-account): the bearer token was minted for the
    // caller brand, so verify against that brand's audience rather than House's.
    // Returns null for direct app requests (no header) and House-origin calls.
    const callerBrand = resolveTrustedCallerBrand(c);

    let payload: AccessTokenPayload | null;
    try {
      payload = await verifyAccessToken(token, c.env, {
        audienceBrand: callerBrand ?? undefined,
      });
    } catch (error) {
      if (error instanceof WrongTokenClassError) {
        return c.json(
          {
            error: {
              code: error.code,
              message: error.message,
            },
          },
          401
        );
      }
      throw error;
    }

    if (!payload) {
      console.error(`[auth] Token verification failed for ${path}, token prefix: ${tokenPrefix}...`);
      return c.json(
        {
          error: {
            code: 'unauthorized',
            message: 'Invalid or expired token',
          },
        },
        401
      );
    }

    console.log(`[auth] Token verified successfully for ${path}, user: ${payload.sub}`);

    // Set user info in context
    c.set('userId', payload.sub);
    c.set('userEmail', payload.email);
    c.set('userEmailVerified', payload.email_verified);
    c.set('user', payload);

    await next();
  };
}

/**
 * Optional auth middleware - doesn't fail if no token
 */
export function optionalAuthMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const authHeader = c.req.header('Authorization');

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const payload = await verifyAccessToken(token, c.env);

      if (payload) {
        c.set('userId', payload.sub);
        c.set('userEmail', payload.email);
        c.set('userEmailVerified', payload.email_verified);
        c.set('user', payload);
      }
    }

    await next();
  };
}

/**
 * Email verification required middleware
 */
export function requireEmailVerified() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const emailVerified = c.get('userEmailVerified');

    if (!emailVerified) {
      return c.json(
        {
          error: {
            code: 'email_not_verified',
            message: 'Please verify your email address to access this resource',
          },
        },
        403
      );
    }

    await next();
  };
}
