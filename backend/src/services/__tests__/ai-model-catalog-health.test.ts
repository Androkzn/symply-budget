/**
 * Nightly model-catalog health check.
 *
 * Two directions, two failure modes that have each already reached members:
 *  - the vendor drops a model we still offer (silent 404s mid-scan);
 *  - we drop a model users are still pinned to (provider becomes unselectable).
 *
 * The vendor probe is exercised with a stubbed `fetch`; the heal sweep runs
 * against miniflare D1 with the same minimal DDL as ai-provider-model.test.ts.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelCatalogEntry } from '../../ai/model-catalog';
import type { Env } from '../../types';
import { getUserAiPreferences } from '../ai-access-service';
import {
  checkCatalogAgainstVendors,
  healStrandedModelPicks,
} from '../ai-model-catalog-health-service';
import { getAllProviderModels } from '../ai-provider-model-service';

const PREFS_DDL = `CREATE TABLE IF NOT EXISTS user_ai_preferences (
  user_id TEXT PRIMARY KEY,
  credential_source TEXT,
  active_provider TEXT,
  selected_model_id TEXT,
  allow_paid_fallback INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const PROVIDER_MODELS_DDL = `CREATE TABLE IF NOT EXISTS user_ai_provider_models (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  selected_model_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const USER = 'user-health-1';
const testEnv = env as unknown as Env;

const CAPS = ['text'] as ModelCatalogEntry['capabilities'];
const entry = (
  provider: ModelCatalogEntry['provider'],
  id: string,
  vendorModelId: string
): ModelCatalogEntry => ({
  id,
  provider,
  vendorModelId,
  displayName: id,
  profileLabel: 'quality',
  isDefault: true,
  flagship: true,
  managedVisible: true,
  capabilities: CAPS,
  contextTokens: 1000,
  maxOutputTokens: 100,
  environments: ['staging', 'production'],
});

beforeAll(async () => {
  await testEnv.DB.exec(PREFS_DDL.replace(/\n/g, ' '));
  await testEnv.DB.exec(PROVIDER_MODELS_DDL.replace(/\n/g, ' '));
});

beforeEach(async () => {
  await testEnv.DB.exec('DELETE FROM user_ai_preferences');
  await testEnv.DB.exec('DELETE FROM user_ai_provider_models');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stub every provider list endpoint from one url → model-ids map. */
function stubVendorLists(byHost: {
  openai?: string[] | { status: number };
  anthropic?: string[] | { status: number };
  gemini?: string[] | { status: number };
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const pick = url.includes('openai')
        ? byHost.openai
        : url.includes('anthropic')
          ? byHost.anthropic
          : byHost.gemini;

      if (pick && !Array.isArray(pick)) {
        return new Response('nope', { status: pick.status });
      }
      const ids = pick ?? [];
      if (url.includes('generativelanguage')) {
        return Response.json({ models: ids.map((id) => ({ name: `models/${id}` })) });
      }
      return Response.json({ data: ids.map((id) => ({ id })) });
    })
  );
}

const withKeys = (): Env =>
  ({
    ...testEnv,
    OPENAI_API_KEY: 'sk-test',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    GEMINI_API_KEY: 'AIza-test',
  }) as Env;

describe('checkCatalogAgainstVendors — a model the vendor stopped serving', () => {
  it('reports a catalogued id missing from the vendor list', async () => {
    stubVendorLists({ gemini: ['gemini-3.5-flash'] });
    const catalog = [
      entry('gemini', 'gemini.3.5-flash', 'gemini-3.5-flash'),
      entry('gemini', 'gemini.gone', 'gemini-2.0-flash'),
    ];

    const [gemini] = (await checkCatalogAgainstVendors(withKeys(), catalog)).filter(
      (p) => p.provider === 'gemini'
    );
    expect(gemini.skippedReason).toBeUndefined();
    expect(gemini.missingAtVendor).toEqual(['gemini-2.0-flash']);
  });

  it('accepts a dated snapshot as covering its alias', async () => {
    // Vendors list `claude-sonnet-5-20260101`; we address it as `claude-sonnet-5`.
    // Flagging that as missing would make the check cry wolf on a working model.
    stubVendorLists({ anthropic: ['claude-sonnet-5-20260101'] });
    const catalog = [entry('anthropic', 'anthropic.sonnet-5', 'claude-sonnet-5')];

    const [anthropic] = (await checkCatalogAgainstVendors(withKeys(), catalog)).filter(
      (p) => p.provider === 'anthropic'
    );
    expect(anthropic.missingAtVendor).toEqual([]);
  });

  it('skips (never reports drift) when the vendor call fails', async () => {
    stubVendorLists({ openai: { status: 500 } });
    const catalog = [entry('openai', 'openai.x', 'gpt-5.6-sol')];

    const [openai] = (await checkCatalogAgainstVendors(withKeys(), catalog)).filter(
      (p) => p.provider === 'openai'
    );
    expect(openai.skippedReason).toContain('500');
    expect(openai.missingAtVendor).toEqual([]);
  });

  it('skips on an empty list rather than condemning the whole catalog', async () => {
    stubVendorLists({ openai: [] });
    const catalog = [entry('openai', 'openai.x', 'gpt-5.6-sol')];

    const [openai] = (await checkCatalogAgainstVendors(withKeys(), catalog)).filter(
      (p) => p.provider === 'openai'
    );
    expect(openai.skippedReason).toBe('vendor returned no models');
    expect(openai.missingAtVendor).toEqual([]);
  });

  it('skips a provider with no platform key (the BYOK-only norm)', async () => {
    stubVendorLists({});
    const catalog = [entry('openai', 'openai.x', 'gpt-5.6-sol')];

    const bare = { ...testEnv, OPENAI_API_KEY: undefined } as unknown as Env;
    const [openai] = (await checkCatalogAgainstVendors(bare, catalog)).filter(
      (p) => p.provider === 'openai'
    );
    expect(openai.skippedReason).toBe('no platform key');
  });
});

describe('healStrandedModelPicks — a model WE retired that users are pinned to', () => {
  it('repoints a per-provider pick at the flagship', async () => {
    await testEnv.DB.prepare(
      'INSERT INTO user_ai_provider_models (user_id, provider, selected_model_id, updated_at) VALUES (?, ?, ?, ?)'
    )
      .bind(USER, 'gemini', 'gemini.3.1-flash-lite', '2026-08-13T00:00:00.000Z')
      .run();

    const result = await healStrandedModelPicks(testEnv.DB);
    expect(result.providerRows).toBe(1);
    expect(await getAllProviderModels(testEnv.DB, USER)).toEqual({ gemini: 'gemini.3.1-pro' });
  });

  it('repoints the global preference to flagship for BYOK, default for managed', async () => {
    await testEnv.DB.prepare(
      'INSERT INTO user_ai_preferences (user_id, credential_source, active_provider, selected_model_id) VALUES (?, ?, ?, ?)'
    )
      .bind(USER, 'byok', 'gemini', 'gemini.3.1-flash-lite')
      .run();
    await testEnv.DB.prepare(
      'INSERT INTO user_ai_preferences (user_id, credential_source, active_provider, selected_model_id) VALUES (?, ?, ?, ?)'
    )
      .bind('user-managed', 'simplehouse', 'gemini', 'gemini.3.1-flash-lite')
      .run();

    const result = await healStrandedModelPicks(testEnv.DB);
    expect(result.preferenceRows).toBe(2);
    expect((await getUserAiPreferences(testEnv.DB, USER))?.selected_model_id).toBe('gemini.3.1-pro');
    expect((await getUserAiPreferences(testEnv.DB, 'user-managed'))?.selected_model_id).toBe(
      'gemini.3.5-flash'
    );
  });

  it('leaves current picks untouched', async () => {
    await testEnv.DB.prepare(
      'INSERT INTO user_ai_provider_models (user_id, provider, selected_model_id, updated_at) VALUES (?, ?, ?, ?)'
    )
      .bind(USER, 'anthropic', 'anthropic.claude-opus-4-8', '2026-08-13T00:00:00.000Z')
      .run();

    const result = await healStrandedModelPicks(testEnv.DB);
    expect(result).toEqual({ providerRows: 0, preferenceRows: 0, truncated: false });
    expect(await getAllProviderModels(testEnv.DB, USER)).toEqual({
      anthropic: 'anthropic.claude-opus-4-8',
    });
  });
});
