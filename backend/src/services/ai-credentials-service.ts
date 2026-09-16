import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { getFlagshipModel } from '../ai/model-catalog';
import { userAiCredentials, aiCredentialAudit } from '../db/schema-ai-credentials';
import { users } from '../db/schema';
import type { Env } from '../types';
import {
  AIAccessError,
  BadRequestError,
  NotFoundError,
} from '../utils/errors';
import { nowIso } from '../utils/id';
import { scrubForLogs } from '../utils/log-scrubber';

import type { AIProviderId } from './ai-entitlement-types';
import { seedProviderModelIfUnset, deleteProviderModel } from './ai-provider-model-service';
import {
  encryptCredential,
  decryptCredential,
  keyHint,
} from './credential-encryption';
import { createDb } from './db';
import { getFlags } from './featureFlagService';



export async function requireByokEnabled(env: Env): Promise<void> {
  const flags = (await getFlags(env.CONFIG_KV)).flags;
  if (!flags.bringYourOwnAIEnabled) {
    throw AIAccessError.fromReason('AI_ACCESS_REQUIRED');
  }
}

export async function requireKek(env: Env): Promise<string> {
  const kek = env.AI_CREDENTIAL_KEK_V1;
  if (!kek) {
    throw new BadRequestError('Credential encryption is not configured');
  }
  return kek;
}

/**
 * Append to the credential audit trail. BEST-EFFORT, deliberately.
 *
 * An audit row is a record OF an operation, never a precondition FOR it, so a
 * failed insert must not decide the caller's outcome. Awaiting it unguarded
 * meant the opposite: `ai_credential_audit.user_id` carries a foreign key to
 * `users(id)`, so for any authenticated principal with no row in THIS Worker's
 * `users` table the insert raised a FOREIGN KEY violation and turned a
 * perfectly good result into a 500.
 *
 * That is not hypothetical. On staging, 2026-09-07: a member pasted a VALID
 * OpenAI key, `probeKey` returned ok and the audit row was written as
 * `result: 'active'` — and the request still failed, because the E2E account
 * (1ec8d019-…) authenticates by platform JWT and has no `users` row here. The
 * connect screen reads a thrown error with no 401/403 as a network fault, so it
 * told the member "Couldn't reach OpenAI to test the key. Check your
 * connection" — three claims that were all false, about the one component that
 * had just worked. Every provider failed identically, because this write is
 * provider-agnostic.
 *
 * So: log it and carry on. Losing an audit line is a smaller harm than telling
 * someone their working key is broken, and a much smaller one than the
 * misdiagnosis that copy invites.
 */
async function audit(
  d1: D1Database,
  userId: string,
  provider: string,
  action: string,
  result: string
): Promise<void> {
  try {
    const db = createDb(d1);
    await db.insert(aiCredentialAudit).values({
      id: nanoid(),
      user_id: userId,
      provider,
      action,
      result,
      created_at: nowIso(),
    });
  } catch (error) {
    console.warn('[ai-credentials] audit write failed', {
      provider,
      action,
      result,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Make sure this Worker's `users` table knows the authenticated principal.
 *
 * Identity is issued by the PLATFORM: `userId` is the verified JWT's `sub`
 * (middleware/auth.ts), and every fleet Worker keeps its own D1. So a member
 * who authenticates perfectly can still have no row in THIS database — and
 * `user_ai_credentials.user_id` carries a foreign key to `users(id)`, so
 * storing their key raises a FOREIGN KEY violation. Unlike the audit row, this
 * one cannot be shrugged off: that insert IS the key being saved.
 *
 * Seen on staging 2026-09-07: Gemini answered "this key works" on Test
 * connection and Connect then failed with "Couldn't connect your key. Check
 * your connection and try again" — a network message for a database
 * constraint, on an account whose row simply lived under a pre-platform id.
 *
 * Creating the row grants NOTHING new: the token is already verified and the
 * Worker already trusts `sub` for authorisation, so this only writes down an
 * identity it has decided to honour.
 *
 * The email collision is deliberately NOT resolved here. `users.email` is
 * UNIQUE, and an address already held under a DIFFERENT id means two records
 * claim one person — either a stale pre-migration row or genuinely separate
 * accounts. Renaming or re-pointing either one automatically could merge two
 * people's data, so this logs the conflict precisely and leaves it to a human.
 * The caller then fails as it did before, but with a log line that names the
 * cause instead of one that blames the network.
 */
export async function ensureLocalUser(
  d1: D1Database,
  userId: string,
  email: string | undefined,
  emailVerified?: boolean
): Promise<void> {
  const db = createDb(d1);
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
  if (existing) return;

  if (!email) {
    console.warn('[ai-credentials] cannot provision local user — token carried no email', {
      userId,
    });
    return;
  }

  const emailOwner = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (emailOwner) {
    console.warn('[ai-credentials] email already held by a different user id — not merging', {
      authenticatedUserId: userId,
      existingUserId: emailOwner.id,
    });
    return;
  }

  try {
    await db.insert(users).values({
      id: userId,
      email,
      email_verified: emailVerified ?? false,
    });
    console.log('[ai-credentials] provisioned local user row for platform identity', { userId });
  } catch (error) {
    // A concurrent request may have inserted the same row between the check and
    // here; that is success, not failure. Anything else is worth a line.
    console.warn('[ai-credentials] local user provisioning failed', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function probeKey(
  provider: AIProviderId,
  apiKey: string
): Promise<{ ok: boolean; errorCode?: string }> {
  try {
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 401) return { ok: false, errorCode: 'invalid_key' };
      if (!res.ok) return { ok: false, errorCode: `http_${res.status}` };
      return { ok: true };
    }
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      if (res.status === 401) return { ok: false, errorCode: 'invalid_key' };
      if (res.status === 401 || res.status === 403) return { ok: false, errorCode: 'invalid_key' };
      return { ok: true };
    }
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'hi' }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      }
    );
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const body = await res.text();
      if (/API_KEY_INVALID|PERMISSION_DENIED|401|403/i.test(body) || res.status === 401) {
        return { ok: false, errorCode: 'invalid_key' };
      }
    }
    if (!res.ok && res.status >= 500) return { ok: false, errorCode: `http_${res.status}` };
    return { ok: true };
  } catch (err) {
    console.error('[byok] probe failed', scrubForLogs((err as Error).message));
    return { ok: false, errorCode: 'probe_failed' };
  }
}

/**
 * Dry-run connectivity check for a freshly-typed key — probes the provider
 * WITHOUT persisting anything. Never throws on a bad key; returns a structured
 * result the "Test connection" affordance can render inline before the user
 * commits to saving. (An audit row is still written so key-testing is visible.)
 */
export async function testAiCredentialDryRun(
  d1: D1Database,
  userId: string,
  provider: AIProviderId,
  apiKey: string
): Promise<{ provider: AIProviderId; ok: boolean; status: 'active' | 'invalid'; error_code: string | null }> {
  const probe = await probeKey(provider, apiKey);
  await audit(d1, userId, provider, 'tested', probe.ok ? 'active' : probe.errorCode ?? 'invalid');
  return {
    provider,
    ok: probe.ok,
    status: probe.ok ? 'active' : 'invalid',
    error_code: probe.ok ? null : probe.errorCode ?? 'invalid',
  };
}

export async function listAiCredentials(d1: D1Database, userId: string) {
  const db = createDb(d1);
  return db
    .select({
      id: userAiCredentials.id,
      provider: userAiCredentials.provider,
      status: userAiCredentials.status,
      key_hint: userAiCredentials.key_hint,
      last_validated_at: userAiCredentials.last_validated_at,
      last_used_at: userAiCredentials.last_used_at,
      last_error_code: userAiCredentials.last_error_code,
      consent_version: userAiCredentials.consent_version,
      consent_at: userAiCredentials.consent_at,
      created_at: userAiCredentials.created_at,
    })
    .from(userAiCredentials)
    .where(eq(userAiCredentials.user_id, userId));
}

/** Default session-lease TTL — how long the encrypted server copy stays usable
 *  between app foregrounds. Configurable via env; falls back to 7 days. */
export function sessionLeaseTtlSeconds(env?: { AI_SESSION_LEASE_TTL_SECONDS?: string }): number {
  const raw = env?.AI_SESSION_LEASE_TTL_SECONDS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7 * 24 * 60 * 60;
}

export async function upsertAiCredential(
  d1: D1Database,
  userId: string,
  provider: AIProviderId,
  apiKey: string,
  kek: string,
  opts?: {
    /** When set, store as a session lease that expires after this many seconds
     *  (device Keychain is the durable home). Omit for the legacy permanent store. */
    leaseTtlSeconds?: number;
    /** Per-provider data-sharing consent captured on Connect (Apple 5.1.2(i)).
     *  Recorded only on a user-facing connect (not a background session-lease
     *  refresh), so a lease renewal never silently overwrites the accepted terms. */
    consent?: { version: string; acceptedAt?: string };
  }
) {
  const db = createDb(d1);
  const now = nowIso();
  const leased = typeof opts?.leaseTtlSeconds === 'number';
  const consentVersion = opts?.consent?.version ?? null;
  const consentAt = consentVersion ? opts?.consent?.acceptedAt ?? now : null;
  const expiresAt = leased
    ? new Date(Date.now() + (opts!.leaseTtlSeconds as number) * 1000).toISOString()
    : null;

  const probe = await probeKey(provider, apiKey);
  if (!probe.ok) {
    await audit(d1, userId, provider, 'validated', probe.errorCode ?? 'invalid');
    throw AIAccessError.fromReason('PROVIDER_KEY_INVALID');
  }

  const encrypted = await encryptCredential(apiKey, { userId, provider }, kek);
  const hint = keyHint(apiKey);

  const [existing] = await db
    .select()
    .from(userAiCredentials)
    .where(and(eq(userAiCredentials.user_id, userId), eq(userAiCredentials.provider, provider)))
    .limit(1);

  if (existing) {
    await db
      .update(userAiCredentials)
      .set({
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        key_version: encrypted.keyVersion,
        key_hint: hint,
        status: 'active',
        last_validated_at: now,
        last_error_code: null,
        expires_at: expiresAt,
        session_leased: leased,
        // Only overwrite consent when this call carried a fresh acknowledgement —
        // a background session-lease refresh must not wipe the recorded consent.
        ...(consentVersion ? { consent_version: consentVersion, consent_at: consentAt } : {}),
        updated_at: now,
      })
      .where(eq(userAiCredentials.id, existing.id));
  } else {
    await db.insert(userAiCredentials).values({
      id: nanoid(),
      user_id: userId,
      provider,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      key_version: encrypted.keyVersion,
      key_hint: hint,
      status: 'active',
      last_validated_at: now,
      expires_at: expiresAt,
      session_leased: leased,
      consent_version: consentVersion,
      consent_at: consentAt,
      created_at: now,
      updated_at: now,
    });
  }

  await audit(d1, userId, provider, existing ? 'replaced' : 'created', leased ? 'leased' : 'active');
  if (consentVersion) {
    await audit(d1, userId, provider, 'consented', consentVersion);
  }

  // Default this provider to its most-capable (flagship) model on first connect,
  // unless the user already has a stored pick for it. "Most capable by default."
  const flagship = getFlagshipModel(provider);
  if (flagship) {
    await seedProviderModelIfUnset(d1, userId, provider, flagship.id);
  }

  return {
    provider,
    status: 'active' as const,
    key_hint: hint,
    last_validated_at: now,
    expires_at: expiresAt,
    consent_version: consentVersion,
    consent_at: consentAt,
  };
}

export async function validateStoredAiCredential(
  d1: D1Database,
  userId: string,
  provider: AIProviderId,
  kek: string
) {
  const db = createDb(d1);

  const [row] = await db
    .select()
    .from(userAiCredentials)
    .where(and(eq(userAiCredentials.user_id, userId), eq(userAiCredentials.provider, provider)))
    .limit(1);

  if (!row) throw new NotFoundError('Credential');

  const plaintext = await decryptCredential(
    { ciphertext: row.ciphertext, iv: row.iv, keyVersion: row.key_version },
    { userId, provider },
    kek
  );
  const probe = await probeKey(provider, plaintext);
  const now = nowIso();

  await db
    .update(userAiCredentials)
    .set({
      status: probe.ok ? 'active' : 'invalid',
      last_validated_at: now,
      last_error_code: probe.ok ? null : probe.errorCode ?? 'invalid',
      updated_at: now,
    })
    .where(eq(userAiCredentials.id, row.id));

  await audit(d1, userId, provider, 'validated', probe.ok ? 'active' : 'invalid');

  if (!probe.ok) throw AIAccessError.fromReason('PROVIDER_KEY_INVALID');

  return {
    provider,
    status: 'active' as const,
    key_hint: row.key_hint,
    last_validated_at: now,
  };
}

export async function deleteAiCredential(
  d1: D1Database,
  userId: string,
  provider: AIProviderId
) {
  const db = createDb(d1);

  const deleted = await db
    .delete(userAiCredentials)
    .where(and(eq(userAiCredentials.user_id, userId), eq(userAiCredentials.provider, provider)))
    .returning({ id: userAiCredentials.id });

  if (deleted.length === 0) throw new NotFoundError('Credential');

  await deleteProviderModel(d1, userId, provider);
  await audit(d1, userId, provider, 'disconnected', 'ok');
  return { ok: true as const, provider };
}
