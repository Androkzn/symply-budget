import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { isPlatformRefreshSpineEnabled } from '../config/brand-capabilities';
import { authMiddleware } from '../middleware/auth';
import { resolveTrustedCallerBrand } from '../middleware/platform-caller';
import { checkRateLimitDO, RATE_LIMITS } from '../middleware/rate-limit';
import { AuthService } from '../services/auth-service';
import { assertPlatformRegistrationEnabled } from '../services/bridge-control';
import { mustProxyAuthToHouse, proxyAuthToHouse } from '../services/child-auth-proxy';
import { EmailService } from '../services/email-service';
import type { Env } from '../types';
import { RateLimitError } from '../utils/errors';
import { verifyAppleToken, verifyGoogleToken } from '../utils/jwt';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  changePasswordSchema,
  appleAuthSchema,
  googleAuthSchema,
} from '../utils/validation';

const auth = new Hono<{ Bindings: Env }>();

const PROXY_AUTH_PATHS = new Set([
  '/login',
  '/register',
  '/refresh',
  '/apple',
  '/google',
  '/logout',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/resend-verification',
  '/change-password',
  '/account',
  '/accept-terms',
]);

function normalizeProxyAuthPath(rawPath: string): string | null {
  // Hono may expose `/login` or `/auth/login` depending on mount.
  const suffixes = [
    '/login',
    '/register',
    '/refresh',
    '/apple',
    '/google',
    '/logout',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/resend-verification',
    '/change-password',
    '/account',
    '/accept-terms',
  ] as const;
  for (const suffix of suffixes) {
    if (rawPath === suffix || rawPath.endsWith(suffix)) return suffix;
  }
  return null;
}

function proxyRateLimitAction(path: string): keyof typeof RATE_LIMITS | string {
  if (path === '/register') return 'auth:register';
  if (path === '/apple' || path === '/google') return 'auth:idp-challenge';
  if (path === '/forgot-password' || path === '/reset-password') return 'auth:forgot-password';
  if (path === '/verify-email' || path === '/resend-verification') return 'auth:verify-email';
  return 'auth:login';
}

/** Budget/Kaizen: forward credential auth to House once platform JWKS is installed. */
auth.use(async (c, next) => {
  if (!mustProxyAuthToHouse(c.env)) return next();
  const path = normalizeProxyAuthPath(c.req.path);
  if (!path || !PROXY_AUTH_PATHS.has(path)) return next();

  // DO rate limit on the child edge before hopping to House.
  await enforceBridgeRateLimit(c, proxyRateLimitAction(path));

  const headers: Record<string, string> = {
    'Content-Type': c.req.header('Content-Type') || 'application/json',
  };
  const authorization = c.req.header('Authorization');
  if (authorization) headers.Authorization = authorization;

  const init: RequestInit = {
    method: c.req.method,
    headers,
  };
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    init.body = await c.req.arrayBuffer();
  }

  return proxyAuthToHouse(c.env, `/auth${path}`, init);
});

function applyCallerMintAudience(
  c: Context<{ Bindings: Env }>,
  authService: AuthService
): void {
  if (!isPlatformRefreshSpineEnabled(c.env)) return;
  const caller = resolveTrustedCallerBrand(c);
  if (caller) authService.setMintAudienceBrand(caller);
}

async function enforceBridgeRateLimit(
  c: { env: Env; req: { header: (name: string) => string | undefined }; header: (k: string, v: string) => void; get: (k: 'userId') => string | undefined },
  action: keyof typeof RATE_LIMITS | string
): Promise<void> {
  const userId = c.get('userId');
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const identifier = userId || ip;
  try {
    const result = await checkRateLimitDO(c.env, action, identifier);
    c.header('X-RateLimit-Remaining', String(result.remaining));
    c.header('X-RateLimit-Reset', String(result.resetAt));
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      c.header('Retry-After', String(retryAfter));
      throw new RateLimitError(retryAfter);
    }
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    // DO unavailable — fail closed for bridge abuse surfaces
    console.error('[auth] RATE_LIMITER DO check failed:', (error as Error).message);
    throw new RateLimitError(60);
  }
}

/**
 * POST /auth/test - Test JSON parsing
 */
auth.post('/test', async (c) => {
  try {
    const body = await c.req.json();
    return c.json({ success: true, received: body });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

/**
 * POST /auth/register - Register a new user
 */
auth.post(
  '/register',
  zValidator('json', registerSchema),
  async (c) => {
    await enforceBridgeRateLimit(c, 'auth:register');
    await assertPlatformRegistrationEnabled(c.env);
    const { email, password, display_name } = c.req.valid('json');
    const authService = new AuthService(c.env, c.env.DB);
    applyCallerMintAudience(c, authService);
    const emailService = new EmailService(c.env);

    const { user, tokens } = await authService.register(email, password, display_name);

    // Send verification email (don't await, fire and forget)
    const verificationToken = await authService.createEmailVerification(user.id);
    emailService.sendVerificationEmail(email, verificationToken).catch(console.error);

    return c.json(
      {
        user,
        ...tokens,
      },
      201
    );
  }
);

/**
 * POST /auth/login - Login with email and password
 */
auth.post(
  '/login',
  zValidator('json', loginSchema),
  async (c) => {
    await enforceBridgeRateLimit(c, 'auth:login');
    const { email, password } = c.req.valid('json');
    const authService = new AuthService(c.env, c.env.DB);
    applyCallerMintAudience(c, authService);

    const { user, tokens } = await authService.login(email, password);

    return c.json({
      user,
      ...tokens,
    });
  }
);

/**
 * POST /auth/refresh - Refresh access token
 */
auth.post('/refresh', zValidator('json', refreshTokenSchema), async (c) => {
  const { refresh_token } = c.req.valid('json');
  const authService = new AuthService(c.env, c.env.DB);
  applyCallerMintAudience(c, authService);

  const tokens = await authService.refreshTokens(refresh_token);

  return c.json(tokens);
});

/**
 * POST /auth/logout - Logout (revoke refresh token)
 */
auth.post('/logout', zValidator('json', refreshTokenSchema), async (c) => {
  const { refresh_token } = c.req.valid('json');
  const authService = new AuthService(c.env, c.env.DB);

  await authService.logout(refresh_token);

  return c.body(null, 204);
});

/**
 * POST /auth/forgot-password - Request password reset
 */
auth.post(
  '/forgot-password',
  zValidator('json', forgotPasswordSchema),
  async (c) => {
    await enforceBridgeRateLimit(c, 'auth:forgot-password');
    const { email } = c.req.valid('json');
    const authService = new AuthService(c.env, c.env.DB);
    const emailService = new EmailService(c.env);

    const token = await authService.createPasswordReset(email);

    // Send email if user exists (don't reveal if user exists)
    if (token) {
      emailService.sendPasswordResetEmail(email, token).catch(console.error);
    }

    return c.json({
      message: 'If an account exists with this email, a password reset link has been sent.',
    });
  }
);

/**
 * POST /auth/reset-password - Reset password with token
 */
auth.post(
  '/reset-password',
  zValidator('json', resetPasswordSchema),
  async (c) => {
    await enforceBridgeRateLimit(c, 'auth:forgot-password');
    const { token, password } = c.req.valid('json');
    const authService = new AuthService(c.env, c.env.DB);

    await authService.resetPassword(token, password);

    return c.json({
      message: 'Password has been reset successfully.',
    });
  }
);

/**
 * POST /auth/verify-email - Verify email with token
 */
auth.post(
  '/verify-email',
  zValidator('json', verifyEmailSchema),
  async (c) => {
    await enforceBridgeRateLimit(c, 'auth:verify-email');
    const { token } = c.req.valid('json');
    const authService = new AuthService(c.env, c.env.DB);

    await authService.verifyEmail(token);

    return c.json({
      message: 'Email has been verified successfully.',
    });
  }
);

/**
 * POST /auth/resend-verification - Resend verification email
 */
auth.post('/resend-verification', authMiddleware(), async (c) => {
  await enforceBridgeRateLimit(c, 'auth:verify-email');
  const userId = c.get('userId');
  const userEmail = c.get('userEmail');
  const authService = new AuthService(c.env, c.env.DB);
  const emailService = new EmailService(c.env);

  const token = await authService.createEmailVerification(userId);
  await emailService.sendVerificationEmail(userEmail, token);

  return c.json({
    message: 'Verification email has been sent.',
  });
});

/**
 * POST /auth/apple - Sign in with Apple
 */
auth.post(
  '/apple',
  zValidator('json', appleAuthSchema),
  async (c) => {
    await enforceBridgeRateLimit(c, 'auth:idp-challenge');
    const { identity_token, user } = c.req.valid('json');
    const authService = new AuthService(c.env, c.env.DB);
    applyCallerMintAudience(c, authService);

    // Verify Apple token
    const appleData = await verifyAppleToken(identity_token, c.env);
    if (!appleData) {
      return c.json(
        {
          error: {
            code: 'invalid_token',
            message: 'Invalid Apple identity token',
          },
        },
        401
      );
    }

    const result = await authService.handleAppleAuth(
      appleData.sub,
      appleData.email || user?.email,
      appleData.email_verified || false,
      user?.name?.firstName,
      user?.name?.lastName
    );

    return c.json({
      user: result.user,
      ...result.tokens,
      is_new_user: result.isNewUser,
    });
  }
);

/**
 * POST /auth/google - Sign in with Google
 */
auth.post(
  '/google',
  zValidator('json', googleAuthSchema),
  async (c) => {
    await enforceBridgeRateLimit(c, 'auth:idp-challenge');
    const { id_token } = c.req.valid('json');
    const authService = new AuthService(c.env, c.env.DB);
    applyCallerMintAudience(c, authService);

    // Verify Google token
    const googleData = await verifyGoogleToken(id_token, c.env);
    if (!googleData) {
      return c.json(
        {
          error: {
            code: 'invalid_token',
            message: 'Invalid Google ID token',
          },
        },
        401
      );
    }

    const result = await authService.handleGoogleAuth(
      googleData.sub,
      googleData.email,
      googleData.email_verified,
      googleData.name,
      googleData.picture
    );

    return c.json({
      user: result.user,
      ...result.tokens,
      is_new_user: result.isNewUser,
    });
  }
);

/**
 * POST /auth/change-password - Change password (authenticated)
 */
auth.post(
  '/change-password',
  authMiddleware(),
  zValidator('json', changePasswordSchema),
  async (c) => {
    const userId = c.get('userId');
    const { current_password, new_password } = c.req.valid('json');
    const authService = new AuthService(c.env, c.env.DB);

    await authService.changePassword(userId, current_password, new_password);

    return c.json({
      message: 'Password has been changed successfully.',
    });
  }
);

/**
 * DELETE /auth/account - Delete account (soft delete)
 */
auth.delete('/account', authMiddleware(), async (c) => {
  const userId = c.get('userId');
  const authService = new AuthService(c.env, c.env.DB);

  await authService.deleteAccount(userId);

  return c.json({
    message: 'Account has been scheduled for deletion.',
  });
});

/**
 * POST /auth/accept-terms - Accept terms of service and privacy policy
 */
auth.post('/accept-terms', authMiddleware(), async (c) => {
  const userId = c.get('userId');
  const authService = new AuthService(c.env, c.env.DB);

  const user = await authService.acceptTerms(userId);

  return c.json({ user });
});

export default auth;
