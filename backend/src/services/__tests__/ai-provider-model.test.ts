/**
 * Per-provider model preference + patchUserAiPreferences model resolution.
 *
 * Seeds the minimal `user_ai_preferences` + `user_ai_provider_models` tables
 * (miniflare D1 does not auto-apply migrations; mirrors the DDL style of
 * subscription-service.test.ts) and locks the "most capable by default" +
 * "each provider remembers its own model" behavior.
 */
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import { patchUserAiPreferences, getUserAiPreferences } from '../ai-access-service';
import {
  getAllProviderModels,
  getProviderModel,
  setProviderModel,
} from '../ai-provider-model-service';

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

const USER = 'user-1';
const testEnv = env as unknown as Env;

beforeAll(async () => {
  await testEnv.DB.exec(PREFS_DDL.replace(/\n/g, ' '));
  await testEnv.DB.exec(PROVIDER_MODELS_DDL.replace(/\n/g, ' '));
});

beforeEach(async () => {
  await testEnv.DB.exec('DELETE FROM user_ai_preferences');
  await testEnv.DB.exec('DELETE FROM user_ai_provider_models');
});

describe('ai-provider-model-service', () => {
  it('upserts and reads a provider model', async () => {
    await setProviderModel(testEnv.DB, USER, 'anthropic', 'anthropic.claude-opus-4-8');
    expect(await getProviderModel(testEnv.DB, USER, 'anthropic')).toBe('anthropic.claude-opus-4-8');
    // Upsert replaces, does not duplicate.
    await setProviderModel(testEnv.DB, USER, 'anthropic', 'anthropic.claude-sonnet-5');
    expect(await getProviderModel(testEnv.DB, USER, 'anthropic')).toBe('anthropic.claude-sonnet-5');
  });

  it('rejects a model that does not belong to the provider', async () => {
    await expect(
      setProviderModel(testEnv.DB, USER, 'openai', 'anthropic.claude-sonnet-5')
    ).rejects.toThrow();
  });

  it('returns all providers as a map', async () => {
    await setProviderModel(testEnv.DB, USER, 'openai', 'openai.gpt-5.6-sol');
    await setProviderModel(testEnv.DB, USER, 'gemini', 'gemini.3.1-pro');
    expect(await getAllProviderModels(testEnv.DB, USER)).toEqual({
      openai: 'openai.gpt-5.6-sol',
      gemini: 'gemini.3.1-pro',
    });
  });
});

describe('patchUserAiPreferences — per-provider model + flagship default', () => {
  it('activating a BYOK provider with no stored model defaults to its flagship', async () => {
    const res = await patchUserAiPreferences(
      testEnv.DB,
      USER,
      { credential_source: 'byok', active_provider: 'anthropic' },
      'production'
    );
    expect(res.active_provider).toBe('anthropic');
    // Flagship = Fable 5 (most capable), NOT the balanced default Sonnet 5.
    expect(res.selected_model_id).toBe('anthropic.claude-fable-5');
  });

  it('a per-provider model set persists and is restored on re-activation', async () => {
    // User picks Opus for anthropic while it is active.
    await patchUserAiPreferences(testEnv.DB, USER, { credential_source: 'byok', active_provider: 'anthropic' }, 'production');
    await patchUserAiPreferences(testEnv.DB, USER, { provider: 'anthropic', selected_model_id: 'anthropic.claude-opus-4-8' }, 'production');
    expect(await getProviderModel(testEnv.DB, USER, 'anthropic')).toBe('anthropic.claude-opus-4-8');

    // Switch to openai (gets its flagship), then back to anthropic → Opus restored.
    await patchUserAiPreferences(testEnv.DB, USER, { active_provider: 'openai', credential_source: 'byok' }, 'production');
    const back = await patchUserAiPreferences(testEnv.DB, USER, { active_provider: 'anthropic', credential_source: 'byok' }, 'production');
    expect(back.selected_model_id).toBe('anthropic.claude-opus-4-8');
  });

  it('setting a non-active provider model does not change the active global model', async () => {
    await patchUserAiPreferences(testEnv.DB, USER, { credential_source: 'byok', active_provider: 'anthropic' }, 'production');
    await patchUserAiPreferences(testEnv.DB, USER, { provider: 'openai', selected_model_id: 'openai.gpt-5.6-luna' }, 'production');
    const prefs = await getUserAiPreferences(testEnv.DB, USER);
    expect(prefs?.active_provider).toBe('anthropic');
    expect(prefs?.selected_model_id).toBe('anthropic.claude-fable-5'); // unchanged
    expect(await getProviderModel(testEnv.DB, USER, 'openai')).toBe('openai.gpt-5.6-luna');
  });
});

/**
 * Models are RETIRED from `MODEL_CATALOG` when they misbehave (`gemini.3.1-flash-lite`
 * was pulled 2026-08-14 for returning zero items on every receipt photo), but the
 * rows that point at them stay in `user_ai_provider_models` / `user_ai_preferences`.
 *
 * Observed 2026-08-15 on staging: a stored `gemini.3.1-flash-lite` made Gemini
 * IMPOSSIBLE to select — `PATCH /ai-preferences {active_provider:'gemini'}`
 * restored the stored pick, re-validated it against the shrunken catalog and
 * answered 400 "Unknown selected_model_id" on every tap of the toggle.
 */
describe('patchUserAiPreferences — a retired catalog model must not brick the user', () => {
  // Bypass setProviderModel (which validates) to plant the pre-retirement row.
  const plantRetiredPick = async (provider: string, modelId: string) =>
    testEnv.DB.prepare(
      'INSERT INTO user_ai_provider_models (user_id, provider, selected_model_id, updated_at) VALUES (?, ?, ?, ?)'
    )
      .bind(USER, provider, modelId, '2026-08-13T00:00:00.000Z')
      .run();

  it('reads a retired per-provider pick as "never chosen"', async () => {
    await plantRetiredPick('gemini', 'gemini.3.1-flash-lite');
    expect(await getProviderModel(testEnv.DB, USER, 'gemini')).toBeNull();
    expect(await getAllProviderModels(testEnv.DB, USER)).toEqual({});
  });

  it('activating a provider whose stored pick was retired falls back to its flagship', async () => {
    await patchUserAiPreferences(testEnv.DB, USER, { credential_source: 'byok', active_provider: 'anthropic' }, 'production');
    await plantRetiredPick('gemini', 'gemini.3.1-flash-lite');

    const res = await patchUserAiPreferences(
      testEnv.DB,
      USER,
      { credential_source: 'byok', active_provider: 'gemini' },
      'production'
    );
    expect(res.active_provider).toBe('gemini');
    expect(res.selected_model_id).toBe('gemini.3.1-pro');
  });

  it('heals a retired GLOBAL pick instead of rejecting an unrelated patch', async () => {
    await testEnv.DB.prepare(
      'INSERT INTO user_ai_preferences (user_id, credential_source, active_provider, selected_model_id) VALUES (?, ?, ?, ?)'
    )
      .bind(USER, 'byok', 'gemini', 'gemini.3.1-flash-lite')
      .run();

    const res = await patchUserAiPreferences(
      testEnv.DB,
      USER,
      { allow_paid_fallback: true },
      'production'
    );
    expect(res.allow_paid_fallback).toBe(true);
    expect(res.selected_model_id).toBe('gemini.3.1-pro');
  });

  it('still rejects an unknown model the CALLER supplied', async () => {
    await expect(
      patchUserAiPreferences(
        testEnv.DB,
        USER,
        { credential_source: 'byok', active_provider: 'gemini', selected_model_id: 'gemini.3.1-flash-lite' },
        'production'
      )
    ).rejects.toThrow();
  });
});
