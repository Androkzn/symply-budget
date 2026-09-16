/**
 * Aihousekeeper public briefing route — plan §E3.
 *
 * This router is mounted at `/b` in backend/src/index.ts, explicitly OUTSIDE
 * the authenticated `/households/*` boundary. The gate here is the HMAC
 * signature on the path token (see `verifyBriefingToken` in
 * backend/src/services/aihousekeeper/briefing-token.ts).
 *
 * DO NOT add JWT auth to this router — the whole point of the web briefing
 * link is that it works without the mobile app / login. The HMAC token plus
 * soft-delete revocation check is the entire security boundary.
 */

import { Hono } from 'hono';

import { buildPublicBriefingPage } from '../services/public-briefing-service';
import type { Env } from '../types';

const publicBriefing = new Hono<{ Bindings: Env }>();

// EXPLICIT: no JWT auth middleware here. Gate is the signed HMAC token.

const BRIEFING_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store, no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
} as const;

publicBriefing.get('/:signed_token', async (c) => {
  const token = c.req.param('signed_token');
  const result = await buildPublicBriefingPage(token, c.env);

  if (result.status === 'ok') {
    return new Response(result.html, { headers: BRIEFING_HEADERS });
  }

  const status =
    result.status === 'expired' || result.status === 'revoked' ? 410 : result.status === 'not_found' ? 404 : 401;

  return c.text(result.message, status);
});

export default publicBriefing;
