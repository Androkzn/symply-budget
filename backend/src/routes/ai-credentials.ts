/**
 * BYOK credential vault routes — metadata-only responses, never return ciphertext.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../middleware/auth';
import {
  deleteAiCredential,
  listAiCredentials,
  requireByokEnabled,
  requireKek,
  sessionLeaseTtlSeconds,
  testAiCredentialDryRun,
  upsertAiCredential,
  validateStoredAiCredential,
  ensureLocalUser,
} from '../services/ai-credentials-service';
import type { AIProviderId } from '../services/ai-entitlement-types';
import type { Env } from '../types';
import { BadRequestError } from '../utils/errors';

const credentials = new Hono<{ Bindings: Env }>();
credentials.use('/ai-credentials', authMiddleware());
credentials.use('/ai-credentials/*', authMiddleware());

const providerSchema = z.enum(['openai', 'anthropic', 'gemini']);

credentials.get('/ai-credentials', async (c) => {
  const userId = c.get('userId');
  await requireByokEnabled(c.env);
  const rows = await listAiCredentials(c.env.DB, userId);
  return c.json({ credentials: rows });
});

const upsertSchema = z.object({
  api_key: z.string().min(8).max(512),
  // Per-provider data-sharing consent captured on Connect (Apple 5.1.2(i)).
  // Optional for back-compat, but the client always sends it on a user connect.
  consent: z
    .object({
      version: z.string().min(1).max(64),
      accepted_at: z.string().datetime().optional(),
    })
    .optional(),
});

credentials.post('/ai-credentials/:provider', async (c) => {
  const userId = c.get('userId');
  await requireByokEnabled(c.env);
  const parsedProvider = providerSchema.safeParse(c.req.param('provider'));
  if (!parsedProvider.success) throw new BadRequestError('Invalid provider');
  const provider = parsedProvider.data as AIProviderId;

  const body = upsertSchema.parse(await c.req.json());
  const kek = await requireKek(c.env);
  // The credential row has a foreign key to users(id); identity comes from the
  // platform JWT, so this Worker's own table may never have seen this member.
  await ensureLocalUser(c.env.DB, userId, c.get('userEmail'), c.get('userEmailVerified'));
  const result = await upsertAiCredential(c.env.DB, userId, provider, body.api_key.trim(), kek, {
    consent: body.consent
      ? { version: body.consent.version, acceptedAt: body.consent.accepted_at }
      : undefined,
  });
  return c.json(result);
});

/**
 * Hybrid storage — the durable key lives in the DEVICE Keychain; this endpoint
 * takes it only to mint a short-lived, encrypted SESSION LEASE (probe + encrypt
 * + TTL) so background AI keeps working. The server never keeps it permanently:
 * it expires and the app re-leases from the Keychain on foreground.
 */
credentials.post('/ai-credentials/:provider/session-lease', async (c) => {
  const userId = c.get('userId');
  await requireByokEnabled(c.env);
  const parsedProvider = providerSchema.safeParse(c.req.param('provider'));
  if (!parsedProvider.success) throw new BadRequestError('Invalid provider');
  const provider = parsedProvider.data as AIProviderId;

  const body = upsertSchema.parse(await c.req.json());
  const kek = await requireKek(c.env);
  // Same reason as the permanent route above — a lease is still a row with a
  // users foreign key, and this is the path Connect actually takes.
  await ensureLocalUser(c.env.DB, userId, c.get('userEmail'), c.get('userEmailVerified'));
  const result = await upsertAiCredential(c.env.DB, userId, provider, body.api_key.trim(), kek, {
    leaseTtlSeconds: sessionLeaseTtlSeconds(c.env),
    // Carry the per-provider data-sharing consent (Apple 5.1.2(i)) through the
    // lease path too, so it is recorded exactly as on the permanent route.
    consent: body.consent
      ? { version: body.consent.version, acceptedAt: body.consent.accepted_at }
      : undefined,
  });
  return c.json(result);
});

const validateSchema = z.object({
  // Optional: when present, dry-run probe THIS key (no save) — powers the
  // "Test connection" button on the connect screen. Absent → re-probe the
  // already-stored key (the manage screen's health check / re-validate).
  api_key: z.string().min(8).max(512).optional(),
});

credentials.post('/ai-credentials/:provider/validate', async (c) => {
  const userId = c.get('userId');
  await requireByokEnabled(c.env);
  const parsedProvider = providerSchema.safeParse(c.req.param('provider'));
  if (!parsedProvider.success) throw new BadRequestError('Invalid provider');
  const provider = parsedProvider.data as AIProviderId;

  // Body is optional — a bodyless POST re-validates the stored key.
  const raw = await c.req.text();
  const body = raw ? validateSchema.parse(JSON.parse(raw)) : {};

  if (body.api_key) {
    const result = await testAiCredentialDryRun(c.env.DB, userId, provider, body.api_key.trim());
    return c.json(result);
  }

  const kek = await requireKek(c.env);
  const result = await validateStoredAiCredential(c.env.DB, userId, provider, kek);
  return c.json(result);
});

credentials.delete('/ai-credentials/:provider', async (c) => {
  const userId = c.get('userId');
  await requireByokEnabled(c.env);
  const parsedProvider = providerSchema.safeParse(c.req.param('provider'));
  if (!parsedProvider.success) throw new BadRequestError('Invalid provider');
  const provider = parsedProvider.data as AIProviderId;
  const result = await deleteAiCredential(c.env.DB, userId, provider);
  return c.json(result);
});

export default credentials;
