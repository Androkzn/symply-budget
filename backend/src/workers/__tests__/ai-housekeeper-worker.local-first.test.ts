/**
 * H7 P4 — `AIHousekeeperWorker` must not analyse or notify a local-first
 * household (plan §9, Q8).
 *
 * This worker is the older House pipeline, separate from `services/aihousekeeper/`
 * and invoked straight from the cron handler:
 *
 *   `execute()`            — cron/scheduled.ts, every 6h
 *   `sendDailyDigests()`   — cron/scheduled.ts, 08:00 UTC
 *   `sendWeeklySummaries()`— cron/scheduled.ts, Sun 20:00 UTC
 *
 * All three enumerate `household_members` / `households` — the tables
 * `mirrorLegacyMembership` writes so chat can authorise — so they see
 * local-first households. What they then do with them is the problem:
 * `analyzeHousehold` runs an AI pass over an empty D1 and `scheduleNotifications`
 * turns the result into push notifications; the digest and summary paths send
 * per household directly. `maintenance_suggestions` is a Tier-D table under
 * E2EE — gone, not degraded — and its replacement is on the device
 * (`features/house/local/ai/houseHomeInsights.ts`).
 *
 * The collaborators are replaced on the instance rather than mocked at module
 * level: the guard is about which households reach them, and a module mock
 * would also hide whether the enumeration itself still works.
 *
 * Both directions are asserted on every method. "Local-first is skipped" alone
 * would also pass if the guard had switched the worker off for everybody.
 */

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCoreTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import { AIHousekeeperWorker } from '../ai-housekeeper-worker';

const testEnv = env as unknown as Env;

const HID_LF = 'hh_wrk_lf';
const HID_SERVER = 'hh_wrk_server';

/**
 * `users` / `households` / `household_members` come from the shared helper —
 * one maintained copy of that DDL rather than a second one drifting here — and
 * the two tables it does not know about are declared below.
 */
async function createTables(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS ai_housekeeper_preferences (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, notification_frequency TEXT NOT NULL DEFAULT 'daily', ai_personality TEXT NOT NULL DEFAULT 'friendly', diy_skill_level TEXT NOT NULL DEFAULT 'beginner', budget_preference TEXT NOT NULL DEFAULT 'moderate', preferred_learning_style TEXT DEFAULT 'article', enable_predictions INTEGER NOT NULL DEFAULT 1, enable_seasonal_reminders INTEGER NOT NULL DEFAULT 1, enable_cost_insights INTEGER NOT NULL DEFAULT 1, enable_procrastination_nudges INTEGER NOT NULL DEFAULT 1, enable_celebrations INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_households (id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, display_name TEXT NOT NULL, key_epoch INTEGER NOT NULL DEFAULT 1, security_revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  );
}

/**
 * Two households identical in everything the worker enumerates — a user, a
 * mirrored legacy household + membership, and AI housekeeper preferences
 * enabled at the given frequency. The only difference is the `lf_households`
 * row, which is what "local-first" means to the gate.
 */
async function seed(frequency: 'daily' | 'weekly'): Promise<void> {
  await createTables();
  for (const t of ['lf_households', 'ai_housekeeper_preferences', 'household_members', 'households', 'users']) {
    await testEnv.DB.exec(`DELETE FROM ${t}`);
  }

  for (const hid of [HID_LF, HID_SERVER]) {
    await testEnv.DB.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`)
      .bind(`u_${hid}`, `${hid}@example.com`)
      .run();
    await testEnv.DB.prepare(`INSERT INTO households (id, name) VALUES (?, ?)`)
      .bind(hid, `Home ${hid}`)
      .run();
    await testEnv.DB.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, joined_at) VALUES (?, ?, ?, 'owner', '2024-01-01T00:00:00Z')`,
    )
      .bind(`m_${hid}`, hid, `u_${hid}`)
      .run();
    await testEnv.DB.prepare(
      `INSERT INTO ai_housekeeper_preferences (id, user_id, enabled, notification_frequency) VALUES (?, ?, 1, ?)`,
    )
      .bind(`pref_${hid}`, `u_${hid}`, frequency)
      .run();
  }

  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO lf_households (id, owner_user_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(HID_LF, `u_${HID_LF}`, 'Home', now, now)
    .run();
}

/**
 * Nothing here should reach a provider or a push service, so both are stubs.
 *
 * `execute()` builds its analyser PER HOUSEHOLD via `aiServiceFor(id)` so the AI
 * spend lands on that household's ledger — replacing a single `aiService` field
 * (as this did before 74f397f26) no longer intercepts anything: the real
 * service ran, queried `home_features`, threw, and `execute()` swallowed it into
 * `results.errors`, leaving `households_processed` at 0. The guard under test
 * still worked the whole time — the local-first household was skipped
 * correctly — so only the "did the others get analysed" half went red. Stub the
 * factory, and the spy sees exactly the households that reach the analyser.
 */
function mkWorker() {
  const worker = new AIHousekeeperWorker(testEnv, testEnv.DB);
  const analyzeHousehold = vi.fn(async () => ({ suggestions: [], predictions: [] }));
  const sendDailyDigest = vi.fn(async () => undefined);
  const sendWeeklySummary = vi.fn(async () => undefined);
  const patched = worker as unknown as {
    aiServiceFor: (householdId: string) => { analyzeHousehold: typeof analyzeHousehold };
    notificationOrchestrator: {
      sendDailyDigest: typeof sendDailyDigest;
      sendWeeklySummary: typeof sendWeeklySummary;
    };
  };
  patched.aiServiceFor = () => ({ analyzeHousehold });
  patched.notificationOrchestrator = { sendDailyDigest, sendWeeklySummary };
  return { worker, analyzeHousehold, sendDailyDigest, sendWeeklySummary };
}

/** Household ids the spy was called for, in call order. */
function householdArgs(spy: ReturnType<typeof vi.fn>, index: number): string[] {
  return spy.mock.calls.map((call) => call[index] as string);
}

describe('AIHousekeeperWorker.execute — local-first guard', () => {
  beforeEach(async () => {
    await seed('daily');
  });

  it('does not analyse a local-first household but still analyses the others', async () => {
    const { worker, analyzeHousehold } = mkWorker();
    const results = await worker.execute();

    expect(results.skipped_local_first).toBe(1);
    expect(results.households_processed).toBe(1);
    expect(householdArgs(analyzeHousehold, 0)).toEqual([HID_SERVER]);
  });

  it('analyses both once neither is local-first', async () => {
    await testEnv.DB.exec('DELETE FROM lf_households');
    const { worker, analyzeHousehold } = mkWorker();
    const results = await worker.execute();

    expect(results.skipped_local_first).toBe(0);
    expect(results.households_processed).toBe(2);
    expect(householdArgs(analyzeHousehold, 0).sort()).toEqual([HID_LF, HID_SERVER].sort());
  });
});

describe('AIHousekeeperWorker.sendDailyDigests — local-first guard', () => {
  beforeEach(async () => {
    await seed('daily');
  });

  it('sends no digest to a local-first household', async () => {
    const { worker, sendDailyDigest } = mkWorker();
    const sent = await worker.sendDailyDigests();

    expect(sent).toBe(1);
    // Arg 1 is householdId; arg 0 is the userId.
    expect(householdArgs(sendDailyDigest, 1)).toEqual([HID_SERVER]);
  });

  it('sends to both once neither is local-first', async () => {
    await testEnv.DB.exec('DELETE FROM lf_households');
    const { worker, sendDailyDigest } = mkWorker();
    const sent = await worker.sendDailyDigests();

    expect(sent).toBe(2);
    expect(householdArgs(sendDailyDigest, 1).sort()).toEqual([HID_LF, HID_SERVER].sort());
  });
});

describe('AIHousekeeperWorker.sendWeeklySummaries — local-first guard', () => {
  beforeEach(async () => {
    await seed('weekly');
  });

  it('sends no weekly summary to a local-first household', async () => {
    const { worker, sendWeeklySummary } = mkWorker();
    const sent = await worker.sendWeeklySummaries();

    expect(sent).toBe(1);
    expect(householdArgs(sendWeeklySummary, 1)).toEqual([HID_SERVER]);
  });

  it('sends to both once neither is local-first', async () => {
    await testEnv.DB.exec('DELETE FROM lf_households');
    const { worker, sendWeeklySummary } = mkWorker();
    const sent = await worker.sendWeeklySummaries();

    expect(sent).toBe(2);
    expect(householdArgs(sendWeeklySummary, 1).sort()).toEqual([HID_LF, HID_SERVER].sort());
  });
});
