import { and, eq, gt, isNull } from 'drizzle-orm';

import { resolveModelForExecution } from '../ai/model-resolver';
import { aiCredentialLeases, userAiCredentials } from '../db/schema-ai-credentials';
import type { Env } from '../types';
import { nowIso } from '../utils/id';
import { scrubForLogs } from '../utils/log-scrubber';

import { envKeyForProvider } from './ai-credential-resolver';
import type { AIProviderId } from './ai-entitlement-types';
import { decryptCredential } from './credential-encryption';
import { createDb } from './db';


export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type ConsumeLeaseResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string };

export async function consumeAiCredentialLease(
  env: Env,
  tokenHash: string
): Promise<ConsumeLeaseResult> {
  const db = createDb(env.DB);
  const now = nowIso();

  const [lease] = await db
    .select()
    .from(aiCredentialLeases)
    .where(
      and(
        eq(aiCredentialLeases.token_hash, tokenHash),
        isNull(aiCredentialLeases.consumed_at),
        gt(aiCredentialLeases.expires_at, now)
      )
    )
    .limit(1);

  if (!lease) {
    return { ok: false, status: 404, error: 'Lease not found or already consumed' };
  }

  const updated = await db
    .update(aiCredentialLeases)
    .set({ consumed_at: now })
    .where(
      and(eq(aiCredentialLeases.token_hash, tokenHash), isNull(aiCredentialLeases.consumed_at))
    )
    .returning({ token_hash: aiCredentialLeases.token_hash });

  if (updated.length !== 1) {
    return { ok: false, status: 409, error: 'Lease already consumed' };
  }

  const provider = lease.provider as AIProviderId;
  const modelResult = resolveModelForExecution({
    provider,
    selectedModelId: lease.selected_model_id,
    accessSource: 'byok',
  });

  if (!modelResult.ok) {
    return { ok: false, status: 409, error: modelResult.reason };
  }

  let apiKey: string | null = envKeyForProvider(env, provider);

  const [cred] = await db
    .select()
    .from(userAiCredentials)
    .where(
      and(
        eq(userAiCredentials.user_id, lease.user_id),
        eq(userAiCredentials.provider, provider),
        eq(userAiCredentials.status, 'active')
      )
    )
    .limit(1);

  if (cred && env.AI_CREDENTIAL_KEK_V1) {
    try {
      apiKey = await decryptCredential(
        { ciphertext: cred.ciphertext, iv: cred.iv, keyVersion: cred.key_version },
        { userId: lease.user_id, provider },
        env.AI_CREDENTIAL_KEK_V1
      );
    } catch (err) {
      console.error('[lease] decrypt failed', scrubForLogs((err as Error).message));
      return { ok: false, status: 500, error: 'Credential decrypt failed' };
    }
  }

  if (!apiKey) {
    return { ok: false, status: 503, error: 'No API key available' };
  }

  return {
    ok: true,
    data: {
      provider,
      vendor_model_id: modelResult.vendorModelId,
      registry_key: modelResult.registryKey,
      substituted: modelResult.substituted,
      api_key: apiKey,
      job_id: lease.job_id,
    },
  };
}
