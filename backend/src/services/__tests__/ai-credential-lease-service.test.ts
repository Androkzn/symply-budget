/**
 * One-time credential leases — how the out-of-Worker report processor (Lambda)
 * gets an inference key without one ever being stored outside the vault.
 *
 * This is the highest-blast-radius path in the AI stack: the response body is a
 * live API key. The properties locked here are the ones whose absence would be
 * silent and expensive:
 *   - a lease is single-use (a replayed token must not mint a second key);
 *   - an expired lease is dead, even if never consumed;
 *   - the lease row itself NEVER stores the key — only routing metadata;
 *   - a decrypt failure returns a typed, member-safe error with no ciphertext,
 *     key material or system detail in it.
 *
 * Runs against the live miniflare D1 with the real encryption helper, so the
 * decrypt path is genuinely exercised. Nothing here touches a vendor API.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';

import { getDefaultModel } from '../../ai/model-catalog';
import { aiCredentialLeases, userAiCredentials } from '../../db/schema-ai-credentials';
import type { Env } from '../../types';
import { nowIso } from '../../utils/id';
import { consumeAiCredentialLease, sha256Hex } from '../ai-credential-lease-service';
import { encryptCredential } from '../credential-encryption';

const testEnv = env as unknown as Env;
const d1 = testEnv.DB as unknown as D1Database;
const db = drizzle(d1);

const KEK = btoa('0123456789abcdef0123456789abcdef'); // 32 raw bytes, base64
const UID = 'u_lease_1';
const JOB = 'job_lease_1';
const OWN_KEY = 'sk-ant-user-own-lease-key';
const MANAGED_KEY = 'sk-ant-managed-lease-key';

const leaseEnv = (over?: Partial<Env>) =>
  ({
    ...testEnv,
    ANTHROPIC_API_KEY: MANAGED_KEY,
    AI_CREDENTIAL_KEK_V1: KEK,
    ...over,
  }) as unknown as Env;

async function createTables(): Promise<void> {
  await d1.exec(
    `CREATE TABLE IF NOT EXISTS ai_credential_leases (
      token_hash TEXT PRIMARY KEY, job_id TEXT NOT NULL, user_id TEXT NOT NULL,
      provider TEXT NOT NULL, required_capability TEXT, selected_model_id TEXT,
      expires_at TEXT NOT NULL, consumed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`.replace(/\s+/g, ' ')
  );
  await d1.exec(
    `CREATE TABLE IF NOT EXISTS user_ai_credentials (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL,
      ciphertext TEXT NOT NULL, iv TEXT NOT NULL, key_version TEXT NOT NULL,
      key_hint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_validation',
      last_validated_at TEXT, last_used_at TEXT, last_error_code TEXT,
      expires_at TEXT, session_leased INTEGER NOT NULL DEFAULT 0,
      consent_version TEXT, consent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`.replace(/\s+/g, ' ')
  );
}

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString();

/** Insert a lease and return the bearer token the processor would present. */
async function issueLease(over?: Partial<typeof aiCredentialLeases.$inferInsert>): Promise<string> {
  const token = `tok_${Math.random().toString(36).slice(2)}${Date.now()}`;
  await db.insert(aiCredentialLeases).values({
    token_hash: await sha256Hex(token),
    job_id: JOB,
    user_id: UID,
    provider: 'anthropic',
    selected_model_id: null,
    expires_at: inAnHour(),
    created_at: nowIso(),
    ...over,
  });
  return token;
}

async function storeByokKey(over?: { ciphertext?: string; status?: string }): Promise<void> {
  const enc = await encryptCredential(OWN_KEY, { userId: UID, provider: 'anthropic' }, KEK);
  await db.insert(userAiCredentials).values({
    id: `cred_${Math.random().toString(36).slice(2)}`,
    user_id: UID,
    provider: 'anthropic',
    ciphertext: over?.ciphertext ?? enc.ciphertext,
    iv: enc.iv,
    key_version: enc.keyVersion,
    key_hint: 'sk-…key',
    status: over?.status ?? 'active',
    created_at: nowIso(),
    updated_at: nowIso(),
  });
}

const consume = (token: string, e: Env = leaseEnv()) =>
  sha256Hex(token).then((hash) => consumeAiCredentialLease(e, hash));

beforeEach(async () => {
  await createTables();
  await d1.exec('DELETE FROM ai_credential_leases');
  await d1.exec('DELETE FROM user_ai_credentials');
});

describe('consumeAiCredentialLease — the happy path', () => {
  it('returns the user’s own decrypted key plus the routing metadata', async () => {
    await storeByokKey();
    const token = await issueLease();

    const res = await consume(token);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({
      provider: 'anthropic',
      api_key: OWN_KEY,
      job_id: JOB,
      registry_key: getDefaultModel('anthropic')?.id,
      vendor_model_id: getDefaultModel('anthropic')?.vendorModelId,
      substituted: false,
    });
  });

  it('resolves the lease’s own model pick rather than the account default', async () => {
    await storeByokKey();
    const token = await issueLease({ selected_model_id: 'anthropic.claude-haiku-4-5' });

    const res = await consume(token);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.vendor_model_id).toBe('claude-haiku-4-5');
  });

  it('flags a substitution when the lease names a model that no longer exists', async () => {
    await storeByokKey();
    const token = await issueLease({ selected_model_id: 'anthropic.retired-model' });

    const res = await consume(token);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.substituted).toBe(true);
  });

  it('falls back to the managed key when the user connected none', async () => {
    const token = await issueLease();
    const res = await consume(token);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.api_key).toBe(MANAGED_KEY);
  });

  it('marks the lease consumed so the token is spent', async () => {
    await storeByokKey();
    const token = await issueLease();
    await consume(token);

    const [row] = await db.select().from(aiCredentialLeases).all();
    expect(row.consumed_at).toBeTruthy();
  });
});

describe('consumeAiCredentialLease — a lease is single-use and time-boxed', () => {
  it('rejects a replayed token after the first consume', async () => {
    await storeByokKey();
    const token = await issueLease();

    const first = await consume(token);
    expect(first.ok).toBe(true);

    const replay = await consume(token);
    expect(replay).toMatchObject({ ok: false, status: 404 });
  });

  it('rejects an expired lease that was never consumed', async () => {
    await storeByokKey();
    const token = await issueLease({ expires_at: anHourAgo() });

    expect(await consume(token)).toMatchObject({ ok: false, status: 404 });
  });

  it('rejects a token that was never issued', async () => {
    expect(await consume('tok_never_existed')).toMatchObject({ ok: false, status: 404 });
  });

  it('rejects a lease that is already marked consumed', async () => {
    await storeByokKey();
    const token = await issueLease({ consumed_at: nowIso() });

    expect(await consume(token)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('consumeAiCredentialLease — credential hygiene', () => {
  it('stores only routing metadata on the lease row, never the key', async () => {
    await storeByokKey();
    const token = await issueLease();
    await consume(token);

    const [row] = await db.select().from(aiCredentialLeases).all();
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(OWN_KEY);
    expect(serialized).not.toContain(MANAGED_KEY);
    expect(serialized).not.toContain(KEK);
    // The bearer token is stored only as a hash.
    expect(serialized).not.toContain(token);
    expect(row.token_hash).toBe(await sha256Hex(token));
  });

  it('returns a typed error with no key, ciphertext or system detail when decrypt fails', async () => {
    // A tampered/rotated ciphertext must not surface a crypto stack trace.
    await storeByokKey({ ciphertext: btoa('not-a-valid-ciphertext-at-all') });
    const token = await issueLease();

    const res = await consume(token);
    expect(res).toMatchObject({ ok: false, status: 500 });
    if (res.ok) return;
    expect(res.error).toBe('Credential decrypt failed');
    expect(res.error).not.toContain(OWN_KEY);
    expect(res.error).not.toContain(KEK);
    expect(res.error).not.toMatch(/OperationError|DOMException|atob|subtle/i);
  });

  it('denies with 503 when neither a user key nor a managed key exists', async () => {
    const token = await issueLease();
    const res = await consume(token, leaseEnv({ ANTHROPIC_API_KEY: undefined }));
    expect(res).toMatchObject({ ok: false, status: 503, error: 'No API key available' });
  });

  it('ignores a stored credential that is not active', async () => {
    await storeByokKey({ status: 'invalid' });
    const token = await issueLease();

    const res = await consume(token);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.api_key).toBe(MANAGED_KEY);
  });

  it('does not attempt a decrypt when the vault key is unconfigured', async () => {
    await storeByokKey();
    const token = await issueLease();

    const res = await consume(token, leaseEnv({ AI_CREDENTIAL_KEK_V1: undefined }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.api_key).toBe(MANAGED_KEY);
  });
});

describe('consumeAiCredentialLease — model denials', () => {
  it('returns 409 with the denial reason when no model can serve the lease', async () => {
    await storeByokKey();
    // A provider with no catalog entries cannot resolve a model.
    const token = await issueLease({ provider: 'perplexity' });

    const res = await consume(token);
    expect(res).toMatchObject({ ok: false, status: 409, error: 'NO_PROVIDER_AVAILABLE' });
  });
});

describe('sha256Hex', () => {
  it('produces a stable lowercase 64-char digest', async () => {
    const hash = await sha256Hex('abc');
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
