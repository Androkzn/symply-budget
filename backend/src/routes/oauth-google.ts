/**
 * Google OAuth for Aihousekeeper Calendar — plan §G3 / Stream G + H.
 */

import { Hono } from 'hono';
import * as jose from 'jose';

import { authMiddleware } from '../middleware/auth';
import {
  deleteGoogleCalendarTokens,
  findHouseholdMemberId,
  findMemberByIdAndUser,
  getGoogleOAuthStatus,
  upsertGoogleCalendarTokens,
} from '../services/google-oauth-service';
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
} from '../services/integrations/google-calendar';
import type { Env } from '../types';
import { ValidationError } from '../utils/errors';

const oauthGoogle = new Hono<{ Bindings: Env }>();

const STATE_ISSUER = 'simple-house-oauth';
const STATE_AUDIENCE = 'google-oauth-callback';
const STATE_TTL_SECONDS = 10 * 60;

const ALLOWED_APP_SCHEMES = new Set([
  'simplehouse',
  'simplebudget',
  'kaizen',
  'simplelanguage',
  'simplehealth',
]);

function resolveAppScheme(raw: string | undefined): string {
  const scheme = (raw ?? 'simplehouse').toLowerCase();
  return ALLOWED_APP_SCHEMES.has(scheme) ? scheme : 'simplehouse';
}

function normalizeAppScheme(raw: string | undefined): string {
  if (raw == null || raw === '') return 'simplehouse';
  const scheme = raw.toLowerCase();
  if (!ALLOWED_APP_SCHEMES.has(scheme)) {
    throw new ValidationError({ appScheme: ['invalid'] });
  }
  return scheme;
}

async function signState(
  env: Env,
  payload: { mid: string; uid: string; sch: string }
): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .setIssuer(STATE_ISSUER)
    .setAudience(STATE_AUDIENCE)
    .sign(secret);
}

async function verifyState(
  env: Env,
  token: string
): Promise<{ mid: string; uid: string; sch: string } | null> {
  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret, {
      issuer: STATE_ISSUER,
      audience: STATE_AUDIENCE,
    });
    if (typeof payload.mid !== 'string' || typeof payload.uid !== 'string') {
      return null;
    }
    const sch =
      typeof payload.sch === 'string' && ALLOWED_APP_SCHEMES.has(payload.sch)
        ? payload.sch
        : 'simplehouse';
    return { mid: payload.mid, uid: payload.uid, sch };
  } catch {
    return null;
  }
}

function appReturnUrl(
  scheme: string,
  status: 'success' | 'error',
  reason?: string
): string {
  const params = new URLSearchParams({ status });
  if (reason) params.set('reason', reason);
  return `${scheme}://oauth/google/callback?${params.toString()}`;
}

oauthGoogle.get('/start', authMiddleware(), async (c) => {
  const householdId = c.req.query('householdId');
  const userId = c.get('userId');
  if (!householdId) {
    throw new ValidationError({ householdId: ['required'] });
  }

  const memberId = await findHouseholdMemberId(c.env.DB, householdId, userId);
  const state = await signState(c.env, {
    mid: memberId,
    uid: userId,
    sch: normalizeAppScheme(c.req.query('appScheme')),
  });
  const url = buildGoogleAuthUrl(
    {
      GOOGLE_OAUTH_CLIENT_ID: c.env.GOOGLE_OAUTH_CLIENT_ID,
      APP_URL: c.env.APP_URL,
      API_URL: c.env.API_URL,
    },
    state
  );
  return c.json({ url });
});

oauthGoogle.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const errorParam = c.req.query('error');

  if (errorParam) {
    return c.redirect(
      appReturnUrl(resolveAppScheme(c.req.query('appScheme')), 'error', errorParam),
      302
    );
  }
  if (!code || !state) {
    return c.redirect(
      appReturnUrl(resolveAppScheme(c.req.query('appScheme')), 'error', 'missing_params'),
      302
    );
  }

  const claims = await verifyState(c.env, state);
  if (!claims) {
    return c.redirect(appReturnUrl('simplehouse', 'error', 'invalid_state'), 302);
  }

  const member = await findMemberByIdAndUser(c.env.DB, claims.mid, claims.uid);

  try {
    const tokens = await exchangeCodeForTokens(
      {
        GOOGLE_OAUTH_CLIENT_ID: c.env.GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET: c.env.GOOGLE_OAUTH_CLIENT_SECRET,
        APP_URL: c.env.APP_URL,
        API_URL: c.env.API_URL,
      },
      code
    );
    const expiresAtSec = Math.floor(Date.now() / 1000) + tokens.expires_in;

    await upsertGoogleCalendarTokens(c.env.DB, member.id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAtSec,
      scope: tokens.scope,
    });
  } catch (err) {
    console.error('Google token exchange failed', err);
    return c.redirect(appReturnUrl(claims.sch, 'error', 'exchange_failed'), 302);
  }

  return c.redirect(appReturnUrl(claims.sch, 'success'), 302);
});

oauthGoogle.get('/status', authMiddleware(), async (c) => {
  const householdId = c.req.query('householdId');
  const userId = c.get('userId');
  if (!householdId) {
    throw new ValidationError({ householdId: ['required'] });
  }

  const status = await getGoogleOAuthStatus(c.env.DB, householdId, userId);
  return c.json(status);
});

oauthGoogle.delete('/', authMiddleware(), async (c) => {
  const householdId = c.req.query('householdId');
  const userId = c.get('userId');
  if (!householdId) {
    throw new ValidationError({ householdId: ['required'] });
  }

  await deleteGoogleCalendarTokens(c.env.DB, householdId, userId);
  return c.json({ ok: true });
});

export default oauthGoogle;
