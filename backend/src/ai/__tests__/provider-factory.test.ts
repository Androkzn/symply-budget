/**
 * provider-factory — the single construction site for AI providers.
 *
 * Two things go wrong here expensively and quietly:
 *  1. the wrong adapter class for a provider id (an OpenAI key posted to
 *     Anthropic just 401s, but the member only sees "AI unavailable"), and
 *  2. BYOK selection: `createAnthropicAdapterForUser` must bill the ACTING
 *     USER's own key when they have one connected, and fall back to the managed
 *     key otherwise. Before the resolver existed, a connected BYOK key was
 *     stored and validated but never actually used — invisible from the outside.
 *
 * The BYOK case runs against the real miniflare D1 + the real encryption helper
 * so the decrypt path is genuinely exercised; no network call is ever made
 * (constructing an adapter does not talk to a vendor).
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';

import { userAiCredentials } from '../../db/schema-ai-credentials';
import { encryptCredential } from '../../services/credential-encryption';
import type { Env } from '../../types';
import { nowIso } from '../../utils/id';
import { ClaudeProvider } from '../claude-provider';
import { GeminiProvider } from '../gemini-provider';
import { getDefaultModel } from '../model-catalog';
import { OpenAIProvider } from '../openai-provider';
import { createAnthropicAdapterForUser, createProviderAdapter } from '../provider-factory';

const testEnv = env as unknown as Env;
const d1 = testEnv.DB as unknown as D1Database;
const db = drizzle(d1);

const KEK = btoa('0123456789abcdef0123456789abcdef'); // 32 raw bytes, base64
const UID = 'u_factory_1';
const MANAGED_KEY = 'sk-ant-managed-platform-key';
const OWN_KEY = 'sk-ant-user-own-byok-key';

/** Read the private `model` an adapter was constructed with. */
function modelOf(provider: object): string {
  return (provider as unknown as { model: string }).model;
}

async function createTables(): Promise<void> {
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
  await d1.exec(
    `CREATE TABLE IF NOT EXISTS user_ai_provider_models (
      user_id TEXT NOT NULL, provider TEXT NOT NULL,
      selected_model_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`.replace(/\s+/g, ' ')
  );
}

/** Store an active, decryptable BYOK credential for UID. */
async function storeByokKey(opts?: { expiresAt?: string; status?: string }): Promise<void> {
  const enc = await encryptCredential(OWN_KEY, { userId: UID, provider: 'anthropic' }, KEK);
  await db.insert(userAiCredentials).values({
    id: `cred_${Math.random().toString(36).slice(2)}`,
    user_id: UID,
    provider: 'anthropic',
    ciphertext: enc.ciphertext,
    iv: enc.iv,
    key_version: enc.keyVersion,
    key_hint: 'sk-…key',
    status: opts?.status ?? 'active',
    expires_at: opts?.expiresAt ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
}

/** Env with the managed key + a configured credential vault. */
const byokEnv = () =>
  ({ ...testEnv, ANTHROPIC_API_KEY: MANAGED_KEY, AI_CREDENTIAL_KEK_V1: KEK }) as unknown as Env;

beforeEach(async () => {
  await createTables();
  await d1.exec('DELETE FROM user_ai_credentials');
});

describe('createProviderAdapter — provider selection', () => {
  it('builds the matching adapter class for each provider id', () => {
    expect(createProviderAdapter({ provider: 'openai', apiKey: 'k' })).toBeInstanceOf(OpenAIProvider);
    expect(createProviderAdapter({ provider: 'anthropic', apiKey: 'k' })).toBeInstanceOf(ClaudeProvider);
    expect(createProviderAdapter({ provider: 'gemini', apiKey: 'k' })).toBeInstanceOf(GeminiProvider);
  });

  it('names each adapter so usage rows attribute to the right vendor', () => {
    expect(createProviderAdapter({ provider: 'openai', apiKey: 'k' }).name).toBe('openai');
    expect(createProviderAdapter({ provider: 'anthropic', apiKey: 'k' }).name).toBe('claude');
    expect(createProviderAdapter({ provider: 'gemini', apiKey: 'k' }).name).toBe('gemini');
  });

  it('defaults to the catalog default model when the caller names none', () => {
    for (const provider of ['openai', 'anthropic', 'gemini'] as const) {
      const expected = getDefaultModel(provider)?.vendorModelId;
      expect(expected).toBeTruthy();
      expect(modelOf(createProviderAdapter({ provider, apiKey: 'k' }))).toBe(expected);
    }
  });

  it('honours an explicitly requested vendor model over the catalog default', () => {
    const adapter = createProviderAdapter({
      provider: 'anthropic',
      apiKey: 'k',
      model: 'claude-opus-4-1-20250805',
    });
    expect(modelOf(adapter)).toBe('claude-opus-4-1-20250805');
  });

  it('throws on an unknown provider id rather than silently picking one', () => {
    expect(() =>
      createProviderAdapter({ provider: 'perplexity' as never, apiKey: 'k' })
    ).toThrow(/Unknown provider/i);
  });

  it('passes the usage recorder through to the adapter', () => {
    const onUsage = () => undefined;
    const adapter = createProviderAdapter({ provider: 'anthropic', apiKey: 'k', options: { onUsage } });
    expect((adapter as unknown as { onUsage: unknown }).onUsage).toBe(onUsage);
  });
});

describe('createAnthropicAdapterForUser — BYOK vs managed key', () => {
  /** Read the key an Anthropic adapter was constructed with. */
  const keyOf = (p: ClaudeProvider) =>
    (p as unknown as { client: { apiKey: string } }).client.apiKey;

  it('uses the acting user’s own key when they have an active BYOK credential', async () => {
    await storeByokKey();
    const adapter = await createAnthropicAdapterForUser(byokEnv(), UID, { feature: 'test' });
    expect(keyOf(adapter)).toBe(OWN_KEY);
  });

  it('uses the managed platform key when the user has connected nothing', async () => {
    const adapter = await createAnthropicAdapterForUser(byokEnv(), UID, { feature: 'test' });
    expect(keyOf(adapter)).toBe(MANAGED_KEY);
  });

  it('uses the managed key for an anonymous / background caller', async () => {
    await storeByokKey();
    const adapter = await createAnthropicAdapterForUser(byokEnv(), null, { feature: 'test' });
    expect(keyOf(adapter)).toBe(MANAGED_KEY);
  });

  it('falls back to the managed key once a session lease has expired', async () => {
    // An expired lease must not keep running on a stale credential — the device
    // re-leases on next foreground; background work meanwhile uses the managed key.
    await storeByokKey({ expiresAt: '2000-01-01T00:00:00.000Z' });
    const adapter = await createAnthropicAdapterForUser(byokEnv(), UID, { feature: 'test' });
    expect(keyOf(adapter)).toBe(MANAGED_KEY);
  });

  it('ignores a credential that is no longer active', async () => {
    await storeByokKey({ status: 'invalid' });
    const adapter = await createAnthropicAdapterForUser(byokEnv(), UID, { feature: 'test' });
    expect(keyOf(adapter)).toBe(MANAGED_KEY);
  });

  it('does not attempt a decrypt when the credential vault is unconfigured', async () => {
    await storeByokKey();
    const noVault = { ...testEnv, ANTHROPIC_API_KEY: MANAGED_KEY } as unknown as Env;
    const adapter = await createAnthropicAdapterForUser(noVault, UID, { feature: 'test' });
    expect(keyOf(adapter)).toBe(MANAGED_KEY);
  });

  it('constructs with an empty key rather than undefined when nothing is configured', async () => {
    const bare = { ...testEnv, ANTHROPIC_API_KEY: undefined } as unknown as Env;
    const adapter = await createAnthropicAdapterForUser(bare, null, { feature: 'test' });
    expect(keyOf(adapter)).toBe('');
  });

  it('applies the requested model to the returned adapter', async () => {
    const adapter = await createAnthropicAdapterForUser(
      byokEnv(),
      null,
      { feature: 'test' },
      'claude-sonnet-4-5-20250929'
    );
    expect(modelOf(adapter)).toBe('claude-sonnet-4-5-20250929');
  });
});
