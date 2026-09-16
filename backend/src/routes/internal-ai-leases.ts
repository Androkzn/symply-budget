/**
 * Internal Lambda credential lease consume (Phase 6/7).
 * Authenticated with AI_CREDENTIAL_LEASE_SECRET — never under public user auth.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import {
  consumeAiCredentialLease,
  sha256Hex,
} from '../services/ai-credential-lease-service';
import type { Env } from '../types';

const leases = new Hono<{ Bindings: Env }>();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  let mismatch = 0;
  for (let i = 0; i < ae.length; i++) mismatch |= ae[i]! ^ be[i]!;
  return mismatch === 0;
}

const consumeSchema = z.object({
  token: z.string().min(16),
});

leases.post('/ai-credential-leases/consume', async (c) => {
  const secret = c.env.AI_CREDENTIAL_LEASE_SECRET;
  if (!secret) {
    return c.json({ error: 'Lease secret not configured' }, 503);
  }
  const auth = c.req.header('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!timingSafeEqual(token, secret)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = consumeSchema.parse(await c.req.json());
  const tokenHash = await sha256Hex(body.token);
  const result = await consumeAiCredentialLease(c.env, tokenHash);

  if (!result.ok) {
    return c.json({ error: result.error }, result.status as 404);
  }

  return c.json(result.data);
});

export default leases;
