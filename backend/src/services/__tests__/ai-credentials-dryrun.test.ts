/**
 * Dry-run "Test connection" probe (powers the connect screen's Test button).
 *
 * `testAiCredentialDryRun` probes a freshly-typed key WITHOUT persisting it and,
 * unlike the save/re-validate paths, NEVER throws on a bad key — it resolves a
 * structured `{ ok, status, error_code }` the UI renders inline. It also leaves
 * an audit trail so key-testing is visible. This locks all three:
 *   - a valid key → ok/active, no error;
 *   - a rejected key → ok:false/invalid/invalid_key, and it does NOT throw;
 *   - nothing is written to user_ai_credentials (truly a dry run), while a
 *     `tested` audit row IS recorded.
 *
 * Runs against the live miniflare D1 (cloudflare:test) with a minimal DDL subset
 * and stubs the provider key-probe fetch to force the 200 / 401 branches.
 */

import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiCredentialAudit, userAiCredentials } from '../../db/schema-ai-credentials';
import type { Env } from '../../types';
import { testAiCredentialDryRun } from '../ai-credentials-service';

const testEnv = env as unknown as Env;
const d1 = testEnv.DB as unknown as D1Database;
const db = drizzle(d1);

const UID = 'u_dryrun_1';
const KEY = 'sk-ant-dryruntestkey';

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
  ];
  for (const stmt of ddl) await d1.exec(stmt.replace(/\s+/g, ' '));
}

async function resetTables(): Promise<void> {
  await d1.exec('DELETE FROM user_ai_credentials');
  await d1.exec('DELETE FROM ai_credential_audit');
}

const stubFetch = (status: number) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));

const credentialRows = () =>
  db.select().from(userAiCredentials).where(eq(userAiCredentials.user_id, UID)).all();

const testedAudits = () =>
  db
    .select()
    .from(aiCredentialAudit)
    .where(and(eq(aiCredentialAudit.user_id, UID), eq(aiCredentialAudit.action, 'tested')))
    .all();

beforeEach(async () => {
  await createTables();
  await resetTables();
});

afterEach(() => vi.unstubAllGlobals());

describe('testAiCredentialDryRun', () => {
  it('reports a valid key as active with no error and saves nothing', async () => {
    stubFetch(200);
    const result = await testAiCredentialDryRun(d1, UID, 'anthropic', KEY);

    expect(result).toEqual({
      provider: 'anthropic',
      ok: true,
      status: 'active',
      error_code: null,
    });
    // Dry run: no credential persisted.
    expect(await credentialRows()).toHaveLength(0);
    // But the test is audited.
    const audits = await testedAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0].result).toBe('active');
  });

  it('reports a rejected key without throwing, and still saves nothing', async () => {
    stubFetch(401);
    const result = await testAiCredentialDryRun(d1, UID, 'anthropic', KEY);

    expect(result).toEqual({
      provider: 'anthropic',
      ok: false,
      status: 'invalid',
      error_code: 'invalid_key',
    });
    expect(await credentialRows()).toHaveLength(0);
    const audits = await testedAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0].result).toBe('invalid_key');
  });
});
