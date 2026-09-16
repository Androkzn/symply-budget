/**
 * Unit tests for the pure credential-selection logic + env key mapping.
 * The I/O wrappers (resolveInferenceCredential / decryptActiveByokKey) are
 * exercised via the entitlement + model-resolver suites; here we lock the
 * source→key decision and denial mapping.
 */

import { describe, expect, it } from 'vitest';

import type { ModelResolveResult } from '../../ai/model-resolver';
import type { Env } from '../../types';
import {
  assembleInferenceCredential,
  envKeyForProvider,
  hasUsableProviderKey,
  resolveProviderApiKey,
} from '../ai-credential-resolver';
import type { AIEntitlementResult } from '../ai-entitlement-types';

const okModel: ModelResolveResult = {
  ok: true,
  registryKey: 'anthropic.claude-sonnet-5',
  vendorModelId: 'claude-sonnet-5',
  substituted: false,
  entry: { id: 'anthropic.claude-sonnet-5' } as never,
};

const byokEntitlement = {
  allowed: true,
  source: 'byok',
  provider: 'anthropic',
} satisfies Extract<AIEntitlementResult, { allowed: true }>;

const managedEntitlement = {
  allowed: true,
  source: 'simplehouse',
  provider: 'anthropic',
} satisfies Extract<AIEntitlementResult, { allowed: true }>;

describe('envKeyForProvider', () => {
  const env = {
    OPENAI_API_KEY: 'sk-openai',
    ANTHROPIC_API_KEY: 'sk-anthropic',
    GEMINI_API_KEY: 'sk-gemini',
  } as unknown as Env;

  it('maps each provider to its managed env key', () => {
    expect(envKeyForProvider(env, 'openai')).toBe('sk-openai');
    expect(envKeyForProvider(env, 'anthropic')).toBe('sk-anthropic');
    expect(envKeyForProvider(env, 'gemini')).toBe('sk-gemini');
  });

  it('returns null when the managed key is unset', () => {
    expect(envKeyForProvider({} as Env, 'gemini')).toBeNull();
  });
});

describe('assembleInferenceCredential', () => {
  it('uses the decrypted BYOK key for a byok user', () => {
    const cred = assembleInferenceCredential({
      entitlement: byokEntitlement,
      model: okModel,
      byokKey: 'sk-user-own',
      envKey: 'sk-managed',
    });
    expect(cred).toMatchObject({
      source: 'byok',
      provider: 'anthropic',
      apiKey: 'sk-user-own',
      vendorModelId: 'claude-sonnet-5',
    });
  });

  it('rejects a byok user whose stored key is gone/undecryptable', () => {
    expect(() =>
      assembleInferenceCredential({
        entitlement: byokEntitlement,
        model: okModel,
        byokKey: null,
        envKey: 'sk-managed',
      })
    ).toThrowError(/invalid/i);
  });

  it('uses the managed env key for a paid/managed user', () => {
    const cred = assembleInferenceCredential({
      entitlement: managedEntitlement,
      model: okModel,
      byokKey: null,
      envKey: 'sk-managed',
    });
    expect(cred).toMatchObject({ source: 'simplehouse', apiKey: 'sk-managed' });
  });

  it('denies a managed user when the platform has no key for the provider', () => {
    let code: string | undefined;
    try {
      assembleInferenceCredential({
        entitlement: managedEntitlement,
        model: okModel,
        byokKey: null,
        envKey: null,
      });
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe('ai_provider_unavailable');
  });

  it('surfaces the model-resolution denial reason', () => {
    let code: string | undefined;
    try {
      assembleInferenceCredential({
        entitlement: byokEntitlement,
        model: { ok: false, reason: 'MODEL_NOT_AVAILABLE_FOR_KEY' },
        byokKey: 'sk-user-own',
        envKey: null,
      });
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe('ai_model_not_available_for_key');
  });
});

describe('resolveProviderApiKey — managed fallback branches (no DB)', () => {
  const env = {
    OPENAI_API_KEY: 'sk-openai',
    ANTHROPIC_API_KEY: 'sk-anthropic',
    GEMINI_API_KEY: 'sk-gemini',
  } as unknown as Env;

  it('returns the managed key (no BYOK lookup) when userId is absent', async () => {
    const r = await resolveProviderApiKey(env, null, 'anthropic');
    expect(r).toEqual({ apiKey: 'sk-anthropic', source: 'managed' });
  });

  it('returns the managed key when the credential vault (KEK) is not configured', async () => {
    // env has no AI_CREDENTIAL_KEK_V1 → resolver must not attempt a decrypt.
    const r = await resolveProviderApiKey(env, 'user-1', 'gemini');
    expect(r).toEqual({ apiKey: 'sk-gemini', source: 'managed' });
  });

  it('returns an empty managed key (not undefined) when the provider env key is unset', async () => {
    const r = await resolveProviderApiKey({} as Env, null, 'openai');
    expect(r).toEqual({ apiKey: '', source: 'managed' });
  });
});

describe('hasUsableProviderKey — the question call sites should be asking', () => {
  it('is true when the platform holds a managed key', async () => {
    const env = { ANTHROPIC_API_KEY: 'sk-anthropic' } as unknown as Env;
    await expect(hasUsableProviderKey(env, 'user-1', 'anthropic')).resolves.toBe(true);
  });

  it('is false when NEITHER a managed key nor a BYOK key exists', async () => {
    // No env key and no vault → the only honest answer is "AI is not configured".
    await expect(hasUsableProviderKey({} as Env, 'user-1', 'anthropic')).resolves.toBe(false);
  });

  it('is per-provider — a managed Gemini key does not make Anthropic runnable', async () => {
    const env = { GEMINI_API_KEY: 'sk-gemini' } as unknown as Env;
    await expect(hasUsableProviderKey(env, 'user-1', 'gemini')).resolves.toBe(true);
    await expect(hasUsableProviderKey(env, 'user-1', 'anthropic')).resolves.toBe(false);
  });
});
