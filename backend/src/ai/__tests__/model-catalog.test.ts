import { describe, expect, it } from 'vitest';

import {
  MODEL_CATALOG,
  assertModelCatalogValid,
  getCatalogForProvider,
  getDefaultModel,
  getFlagshipModel,
  toModelOptionDTO,
  ModelCatalogValidationError,
} from '../model-catalog';
import { resolveModelForExecution } from '../model-resolver';

describe('model-catalog', () => {
  it('passes boot validation', () => {
    expect(() => assertModelCatalogValid()).not.toThrow();
  });

  it('has ≤5 entries per provider and exactly one default', () => {
    for (const provider of ['openai', 'anthropic', 'gemini'] as const) {
      const entries = getCatalogForProvider(provider);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.length).toBeLessThanOrEqual(5);
      expect(entries.filter((e) => e.isDefault)).toHaveLength(1);
    }
  });

  it('rejects catalogs with >5 entries', () => {
    const bloated = [
      ...MODEL_CATALOG,
      ...Array.from({ length: 6 }, (_, i) => ({
        ...MODEL_CATALOG[0],
        id: `openai.extra-${i}`,
        vendorModelId: `extra-${i}`,
        isDefault: false,
      })),
    ];
    expect(() => assertModelCatalogValid(bloated)).toThrow(ModelCatalogValidationError);
  });

  it('defaults match plan V1', () => {
    expect(getDefaultModel('openai')?.vendorModelId).toBe('gpt-5.6-terra');
    expect(getDefaultModel('anthropic')?.vendorModelId).toBe('claude-sonnet-5');
    expect(getDefaultModel('gemini')?.vendorModelId).toBe('gemini-3.5-flash');
  });

  it('has exactly one flagship (most-capable) per provider', () => {
    for (const provider of ['openai', 'anthropic', 'gemini'] as const) {
      const flagships = getCatalogForProvider(provider).filter((e) => e.flagship);
      expect(flagships).toHaveLength(1);
    }
  });

  it('flagship is the frontier model, distinct from the balanced default', () => {
    expect(getFlagshipModel('openai')?.vendorModelId).toBe('gpt-5.6-sol');
    expect(getFlagshipModel('anthropic')?.vendorModelId).toBe('claude-fable-5');
    expect(getFlagshipModel('gemini')?.vendorModelId).toBe('gemini-3.1-pro-preview');
    // Flagship ≠ default (default is the balanced/cheap tier for managed cost control).
    for (const provider of ['openai', 'anthropic', 'gemini'] as const) {
      expect(getFlagshipModel(provider)?.id).not.toBe(getDefaultModel(provider)?.id);
    }
  });

  it('rejects catalogs without exactly one flagship per provider', () => {
    const twoFlagships = MODEL_CATALOG.map((e) =>
      e.provider === 'gemini' ? { ...e, flagship: true } : e
    );
    expect(() => assertModelCatalogValid(twoFlagships)).toThrow(ModelCatalogValidationError);
  });

  it('exposes flagship on the public model DTO', () => {
    const sol = MODEL_CATALOG.find((e) => e.id === 'openai.gpt-5.6-sol')!;
    const terra = MODEL_CATALOG.find((e) => e.id === 'openai.gpt-5.6-terra')!;
    expect(toModelOptionDTO(sol).flagship).toBe(true);
    expect(toModelOptionDTO(terra).flagship).toBe(false);
  });

  /**
   * A BYOK device calls the provider's API directly with the member's own key,
   * so it needs `vendor_model_id`. Our catalog `id` is NOT interchangeable with
   * it — sending the catalog key produced
   * "models/gemini.3-flash is not found for API version v1beta"
   * on 2026-08-14, which surfaced to the member as a failed receipt scan.
   */
  it('exposes vendor_model_id on the picker DTO', () => {
    const entry = MODEL_CATALOG.find((e) => e.id === 'gemini.3-flash');
    expect(entry).toBeDefined();
    expect(toModelOptionDTO(entry!).vendor_model_id).toBe('gemini-3-flash-preview');
  });

  it('has catalog ids that are NOT usable as provider ids — the reason the DTO carries both', () => {
    const differing = MODEL_CATALOG.filter((e) => e.id !== e.vendorModelId);
    // If this ever hits zero the two fields have silently converged and a
    // caller could start using `id` directly without noticing.
    expect(differing.length).toBeGreaterThan(0);
  });

  it('gives every catalog entry a non-empty vendor id', () => {
    for (const entry of MODEL_CATALOG) {
      expect(toModelOptionDTO(entry).vendor_model_id, entry.id).toBeTruthy();
    }
  });
});

describe('resolveModelForExecution', () => {
  it('uses default when selected unset', () => {
    const result = resolveModelForExecution({
      provider: 'anthropic',
      accessSource: 'simplehouse',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.registryKey).toBe('anthropic.claude-sonnet-5');
      expect(result.substituted).toBe(false);
    }
  });

  it('substitutes default for unknown selected id', () => {
    const result = resolveModelForExecution({
      provider: 'openai',
      selectedModelId: 'openai.does-not-exist',
      accessSource: 'simplehouse',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.registryKey).toBe('openai.gpt-5.6-terra');
      expect(result.substituted).toBe(true);
    }
  });

  it('hides frontier models for managed source', () => {
    const result = resolveModelForExecution({
      provider: 'openai',
      selectedModelId: 'openai.gpt-5.6-sol',
      accessSource: 'simplehouse',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Sol is not managedVisible — falls back to default
      expect(result.registryKey).toBe('openai.gpt-5.6-terra');
      expect(result.substituted).toBe(true);
    }
  });

  it('allows frontier for BYOK', () => {
    const result = resolveModelForExecution({
      provider: 'openai',
      selectedModelId: 'openai.gpt-5.6-sol',
      accessSource: 'byok',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.registryKey).toBe('openai.gpt-5.6-sol');
    }
  });

  it('returns MODEL_NOT_AVAILABLE_FOR_KEY when no callable model', () => {
    const result = resolveModelForExecution({
      provider: 'anthropic',
      selectedModelId: 'anthropic.claude-sonnet-5',
      accessSource: 'byok',
      callableRegistryKeys: new Set(),
    });
    expect(result).toEqual({ ok: false, reason: 'MODEL_NOT_AVAILABLE_FOR_KEY' });
  });
});
