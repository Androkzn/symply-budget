/**
 * resolveModelForExecution — turns a user's saved model pick into the vendor
 * model a request actually runs on, or a typed denial.
 *
 * The substitution flags matter as much as the happy path: when the resolver
 * silently swaps a model, `substituted: true` is the only signal the UI has to
 * tell the member they are not on the model they chose. A swap that forgets to
 * set it is invisible.
 */
import { describe, expect, it } from 'vitest';

import { getDefaultModel, getFlagshipModel } from '../model-catalog';
import { resolveModelForExecution } from '../model-resolver';

/** Managed (SimpleHouse-billed) resolution for a provider. */
const managed = (selectedModelId?: string | null) =>
  resolveModelForExecution({ provider: 'anthropic', selectedModelId, accessSource: 'simplehouse' });

/** BYOK resolution for a provider. */
const byok = (args: Partial<Parameters<typeof resolveModelForExecution>[0]> = {}) =>
  resolveModelForExecution({ provider: 'anthropic', accessSource: 'byok', ...args });

describe('resolveModelForExecution — default selection', () => {
  it('falls back to the provider default when the user has picked nothing', () => {
    const res = managed(null);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registryKey).toBe(getDefaultModel('anthropic')?.id);
    expect(res.vendorModelId).toBe(getDefaultModel('anthropic')?.vendorModelId);
    expect(res.substituted).toBe(false);
  });

  it('returns the vendor id for a valid pick without flagging a substitution', () => {
    const res = managed('anthropic.claude-haiku-4-5');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registryKey).toBe('anthropic.claude-haiku-4-5');
    expect(res.vendorModelId).toBe('claude-haiku-4-5');
    expect(res.substituted).toBe(false);
  });

  it('resolves each provider to its own default, never another provider’s', () => {
    for (const provider of ['openai', 'anthropic', 'gemini'] as const) {
      const res = resolveModelForExecution({ provider, accessSource: 'simplehouse' });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.entry.provider).toBe(provider);
    }
  });
});

describe('resolveModelForExecution — substitution', () => {
  it('substitutes the default for an unknown model id and says so', () => {
    const res = managed('anthropic.model-that-was-retired');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registryKey).toBe(getDefaultModel('anthropic')?.id);
    expect(res.substituted).toBe(true);
  });

  it('substitutes when the saved pick belongs to a different provider', () => {
    // A user who switches provider keeps a stale global pick; it must not leak
    // an OpenAI model id into an Anthropic request.
    const res = managed('openai.gpt-5.6-terra');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entry.provider).toBe('anthropic');
    expect(res.substituted).toBe(true);
  });

  it('substitutes a BYOK-only (managed-hidden) model for a managed user', () => {
    // The frontier model is `managedVisible: false` — a managed user must not be
    // able to run it by having its id saved.
    const flagship = getFlagshipModel('anthropic');
    expect(flagship?.managedVisible).toBe(false);
    const res = managed(flagship!.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registryKey).not.toBe(flagship!.id);
    expect(res.substituted).toBe(true);
  });

  it('lets a BYOK user run the managed-hidden flagship they picked', () => {
    const flagship = getFlagshipModel('anthropic')!;
    const res = byok({ selectedModelId: flagship.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registryKey).toBe(flagship.id);
    expect(res.substituted).toBe(false);
  });
});

describe('resolveModelForExecution — capability gating', () => {
  it('accepts a model that satisfies the required capabilities', () => {
    const res = resolveModelForExecution({
      provider: 'anthropic',
      accessSource: 'simplehouse',
      requiredCapabilities: ['image_understanding', 'pdf_understanding'],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entry.capabilities).toEqual(expect.arrayContaining(['image_understanding']));
  });

  it('denies when no model in the provider catalog has the capability', () => {
    // No chat entry declares realtime audio — the caller must get a typed denial
    // rather than a text model that will fail at request time.
    const res = resolveModelForExecution({
      provider: 'anthropic',
      accessSource: 'simplehouse',
      requiredCapabilities: ['realtime_audio'],
    });
    expect(res).toEqual({ ok: false, reason: 'PROVIDER_CAPABILITY_UNSUPPORTED' });
  });

  it('treats an empty capability list as no constraint', () => {
    const res = resolveModelForExecution({
      provider: 'gemini',
      accessSource: 'simplehouse',
      requiredCapabilities: [],
    });
    expect(res.ok).toBe(true);
  });
});

describe('resolveModelForExecution — BYOK key reachability', () => {
  const defaultId = getDefaultModel('anthropic')!.id;

  it('keeps the pick when the key is known to be able to call it', () => {
    const res = byok({
      selectedModelId: 'anthropic.claude-haiku-4-5',
      callableRegistryKeys: new Set(['anthropic.claude-haiku-4-5', defaultId]),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registryKey).toBe('anthropic.claude-haiku-4-5');
    expect(res.substituted).toBe(false);
  });

  it('falls back to the default when the key cannot call the picked model', () => {
    const res = byok({
      selectedModelId: 'anthropic.claude-opus-4-8',
      callableRegistryKeys: new Set([defaultId]),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registryKey).toBe(defaultId);
    expect(res.substituted).toBe(true);
  });

  it('falls back to any callable model when the default is not callable either', () => {
    const res = byok({
      selectedModelId: 'anthropic.claude-opus-4-8',
      callableRegistryKeys: new Set(['anthropic.claude-haiku-4-5']),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registryKey).toBe('anthropic.claude-haiku-4-5');
    expect(res.substituted).toBe(true);
  });

  it('denies when the key can call nothing in the catalog', () => {
    const res = byok({ callableRegistryKeys: new Set<string>() });
    expect(res).toEqual({ ok: false, reason: 'MODEL_NOT_AVAILABLE_FOR_KEY' });
  });

  it('assumes every model is callable when the caller supplies no key info', () => {
    const res = byok({ selectedModelId: 'anthropic.claude-opus-4-8', callableRegistryKeys: null });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registryKey).toBe('anthropic.claude-opus-4-8');
  });
});

describe('resolveModelForExecution — environment filtering', () => {
  it('resolves within an explicitly named environment', () => {
    for (const environment of ['staging', 'production'] as const) {
      const res = resolveModelForExecution({
        provider: 'gemini',
        accessSource: 'simplehouse',
        environment,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.entry.environments).toContain(environment);
    }
  });
});
