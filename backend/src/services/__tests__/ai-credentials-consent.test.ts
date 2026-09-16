/**
 * Per-provider data-sharing consent persistence (Apple App Review Guideline
 * 5.1.2(i)). Locks the server-side half of the consent flag that the connect
 * screen drives — see documents/engineering/ai-provider-consent-legal.md:
 *   - a user connect records consent_version + consent_at on the credential row;
 *   - a background session-lease refresh (no consent in the call) must NOT wipe
 *     the recorded consent;
 *   - re-consent with a newer version updates it;
 *   - listAiCredentials surfaces the consent fields;
 *   - disconnect deletes the row, so the flag genuinely resets (reconnect
 *     re-prompts).
 *
 * Runs against the live miniflare D1 (cloudflare:test) with a minimal DDL subset
 * of schema-ai-credentials.ts, and stubs the provider key-probe fetch so
 * upsertAiCredential treats the key as valid without a network call.
 */

import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiCredentialAudit, userAiCredentials } from '../../db/schema-ai-credentials';
import type { Env } from '../../types';
import {
  deleteAiCredential,
  listAiCredentials,
  upsertAiCredential,
} from '../ai-credentials-service';

const testEnv = env as unknown as Env;
const d1 = testEnv.DB as unknown as D1Database;
const db = drizzle(d1);

const UID = 'u_consent_1';
const KEK = btoa('0123456789abcdef0123456789abcdef'); // base64 of a 32-byte key
const KEY = 'sk-ant-consenttestkey';

async function createTables(): Promise<void> {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS user_ai_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      key_version TEXT NOT NULL,
      key_hint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_validation',
      last_validated_at TEXT,
      last_used_at TEXT,
      last_error_code TEXT,
      expires_at TEXT,
      session_leased INTEGER NOT NULL DEFAULT 0,
      consent_version TEXT,
      consent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS ai_credential_audit (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      action TEXT NOT NULL,
      result TEXT,
      request_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS user_ai_provider_models (
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      selected_model_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ];
  for (const stmt of ddl) await d1.exec(stmt.replace(/\s+/g, ' '));
}

async function resetTables(): Promise<void> {
  await d1.exec('DELETE FROM user_ai_credentials');
  await d1.exec('DELETE FROM ai_credential_audit');
  await d1.exec('DELETE FROM user_ai_provider_models');
}

const row = () =>
  db
    .select()
    .from(userAiCredentials)
    .where(and(eq(userAiCredentials.user_id, UID), eq(userAiCredentials.provider, 'anthropic')))
    .get();

beforeEach(async () => {
  await createTables();
  await resetTables();
  // probeKey() hits the provider — treat every probe as a valid key (200).
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => vi.unstubAllGlobals());

describe('AI credential consent — persistence', () => {
  it('records consent_version + consent_at + a "consented" audit row on connect', async () => {
    const result = await upsertAiCredential(d1, UID, 'anthropic', KEY, KEK, {
      consent: { version: '2026-07-21' },
    });
    expect(result.consent_version).toBe('2026-07-21');
    expect(result.consent_at).toBeTruthy();

    const stored = await row();
    expect(stored?.consent_version).toBe('2026-07-21');
    expect(stored?.consent_at).toBeTruthy();

    const audits = await db
      .select()
      .from(aiCredentialAudit)
      .where(and(eq(aiCredentialAudit.user_id, UID), eq(aiCredentialAudit.action, 'consented')))
      .all();
    expect(audits).toHaveLength(1);
    expect(audits[0].result).toBe('2026-07-21');
  });

  it('does NOT overwrite consent on a background session-lease refresh (no consent in the call)', async () => {
    await upsertAiCredential(d1, UID, 'anthropic', KEY, KEK, { consent: { version: '2026-07-21' } });
    const before = await row();

    // AiLeaseKeeper re-leases the device key in the background — no consent sent.
    await upsertAiCredential(d1, UID, 'anthropic', KEY, KEK, { leaseTtlSeconds: 3600 });

    const after = await row();
    expect(after?.consent_version).toBe('2026-07-21');
    expect(after?.consent_at).toBe(before?.consent_at); // untouched
    expect(after?.session_leased).toBe(true); // the lease DID update
  });

  it('updates consent when the user re-consents with a newer version', async () => {
    await upsertAiCredential(d1, UID, 'anthropic', KEY, KEK, { consent: { version: '2026-07-21' } });
    await upsertAiCredential(d1, UID, 'anthropic', KEY, KEK, { consent: { version: '2026-09-01' } });
    expect((await row())?.consent_version).toBe('2026-09-01');
  });

  it('surfaces consent fields via listAiCredentials', async () => {
    await upsertAiCredential(d1, UID, 'anthropic', KEY, KEK, { consent: { version: '2026-07-21' } });
    const list = await listAiCredentials(d1, UID);
    const conn = list.find((c) => c.provider === 'anthropic');
    expect(conn?.consent_version).toBe('2026-07-21');
    expect(conn?.consent_at).toBeTruthy();
  });

  it('resets the flag on disconnect — the row (and its consent) is gone', async () => {
    await upsertAiCredential(d1, UID, 'anthropic', KEY, KEK, { consent: { version: '2026-07-21' } });
    await deleteAiCredential(d1, UID, 'anthropic');
    expect(await row()).toBeUndefined();
    expect(await listAiCredentials(d1, UID)).toHaveLength(0);
  });

  it('stores no consent when a connect omits it (back-compat)', async () => {
    const result = await upsertAiCredential(d1, UID, 'anthropic', KEY, KEK);
    expect(result.consent_version).toBeNull();
    expect((await row())?.consent_version).toBeNull();
  });
});
