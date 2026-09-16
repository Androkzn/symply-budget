/**
 * The audit trail must never decide the caller's outcome.
 *
 * Regression test for a live staging failure (2026-09-07): a member pasted a
 * VALID OpenAI key, the provider probe succeeded, and the request still failed
 * — because `ai_credential_audit.user_id` has a foreign key to `users(id)` and
 * the authenticated principal had no row in this Worker's `users` table. The
 * connect screen reported it as "Couldn't reach OpenAI... check your
 * connection", so a working key looked like a broken network.
 */
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ensureLocalUser, testAiCredentialDryRun } from '../ai-credentials-service';
import type { Env } from '../../types';

const testEnv = env as unknown as Env;

/**
 * A D1 stub whose every call fails the way a FK violation does.
 *
 * Throws SYNCHRONOUSLY rather than returning a rejected promise. `await` catches
 * either, but a rejected promise the driver constructs and does not await is an
 * unhandled rejection that Vitest reports as an error even while the tests pass
 * — noise that makes a green run look broken.
 */
function d1ThatCannotWrite() {
  const fail = (): never => {
    throw new Error('D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT');
  };
  const statement = { run: fail, all: fail, first: fail, raw: fail, bind: () => statement };
  return {
    prepare: () => statement,
    batch: fail,
    exec: fail,
    dump: fail,
  } as unknown as D1Database;
}

describe('testAiCredentialDryRun — audit failures are absorbed', () => {
  it('reports a valid key as ok even when the audit row cannot be written', async () => {
    // The provider accepts the key...
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"data":[]}', { status: 200 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // ...and the audit insert fails exactly as it did on staging.
    const result = await testAiCredentialDryRun(
      d1ThatCannotWrite(),
      'user-with-no-users-row',
      'openai',
      'sk-a-valid-looking-key'
    );

    expect(result.ok).toBe(true);
    // The failure is recorded for operators rather than raised at the member.
    expect(warn).toHaveBeenCalledWith(
      '[ai-credentials] audit write failed',
      expect.objectContaining({ provider: 'openai', action: 'tested' })
    );

    fetchMock.mockRestore();
    warn.mockRestore();
  });

  it('still reports a rejected key as not-ok when the audit row cannot be written', async () => {
    // The audit fix must not paper over a genuinely bad key.
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await testAiCredentialDryRun(
      d1ThatCannotWrite(),
      'user-with-no-users-row',
      'openai',
      'sk-a-revoked-key'
    );

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe('invalid_key');

    fetchMock.mockRestore();
    warn.mockRestore();
  });
});

/**
 * Provisioning the local `users` row for a platform identity.
 *
 * Regression test for the second half of the same staging failure: Test
 * connection said "this key works" and Connect then reported "Couldn't connect
 * your key. Check your connection" — a network message for a FOREIGN KEY
 * violation, because `user_ai_credentials.user_id` points at a `users` row this
 * Worker's D1 had never seen.
 */
describe('ensureLocalUser', () => {
  // miniflare's D1 starts empty; create just the columns and the constraint
  // this helper depends on. The UNIQUE email index is the whole point of the
  // conflict case — without it that test would pass by writing a duplicate.
  beforeAll(async () => {
    // Every column drizzle's `users` insert names — it writes the full row, so
    // a trimmed-down table fails the insert and the helper's catch (correctly)
    // swallows it, which reads as "the helper did nothing".
    await testEnv.DB.exec(
      'CREATE TABLE IF NOT EXISTS users (' +
        'id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0, ' +
        'password_hash TEXT, apple_id TEXT, google_id TEXT, display_name TEXT, avatar_url TEXT, ' +
        'terms_accepted_at TEXT, role TEXT NOT NULL DEFAULT \'user\', ' +
        'has_completed_onboarding INTEGER NOT NULL DEFAULT 0, onboarding_household_created INTEGER NOT NULL DEFAULT 0, ' +
        'onboarding_report_added INTEGER NOT NULL DEFAULT 0, onboarding_garbage_setup INTEGER NOT NULL DEFAULT 0, ' +
        'onboarding_floor_plan_added INTEGER NOT NULL DEFAULT 0, ' +
        "created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), " +
        'deleted_at TEXT, updated_by TEXT, version INTEGER NOT NULL DEFAULT 1)'
    );
    await testEnv.DB.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)');
  });

  /**
   * Runs against the live miniflare D1, not a fake. These are SQL questions —
   * a UNIQUE index on users.email and a primary-key lookup — and a hand-rolled
   * stub only proves the stub. (The first attempt at this file did exactly
   * that and passed the interesting case for the wrong reason.)
   */
  const uniq = () => `u_${Math.random().toString(36).slice(2, 10)}`;

  it('creates the row when the platform identity is unknown to this Worker', async () => {
    const id = uniq();
    const email = `${id}@example.test`;

    await ensureLocalUser(testEnv.DB, id, email, true);

    const row = await testEnv.DB.prepare('SELECT id, email FROM users WHERE id = ?')
      .bind(id)
      .first<{ id: string; email: string }>();
    expect(row).toMatchObject({ id, email });
  });

  it('does nothing when the row already exists', async () => {
    const id = uniq();
    await testEnv.DB.prepare('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)')
      .bind(id, `${id}@example.test`, 'Already Here')
      .run();

    await ensureLocalUser(testEnv.DB, id, `${id}@example.test`, true);

    const { n } = (await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?')
      .bind(id)
      .first<{ n: number }>())!;
    expect(n).toBe(1);
  });

  it('REFUSES to merge when the email is held under a different id', async () => {
    // The staging case: a pre-platform row already owns the address. Renaming
    // or re-pointing either record automatically could merge two people's data,
    // so the helper logs the conflict and writes nothing.
    const legacyId = uniq();
    const platformId = uniq();
    const shared = `${legacyId}-shared@example.test`;
    await testEnv.DB.prepare('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)')
      .bind(legacyId, shared, 'Legacy')
      .run();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await ensureLocalUser(testEnv.DB, platformId, shared, true);

    // No new row, and the legacy row is untouched.
    const created = await testEnv.DB.prepare('SELECT id FROM users WHERE id = ?')
      .bind(platformId)
      .first();
    expect(created).toBeNull();
    const legacy = await testEnv.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(legacyId)
      .first<{ email: string }>();
    expect(legacy?.email).toBe(shared);
    expect(warn).toHaveBeenCalledWith(
      '[ai-credentials] email already held by a different user id — not merging',
      expect.objectContaining({ authenticatedUserId: platformId, existingUserId: legacyId })
    );
    warn.mockRestore();
  });

  it('does not invent a row when the token carried no email', async () => {
    const id = uniq();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await ensureLocalUser(testEnv.DB, id, undefined);

    const row = await testEnv.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
    expect(row).toBeNull();
    warn.mockRestore();
  });
});
