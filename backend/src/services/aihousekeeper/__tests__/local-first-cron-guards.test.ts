/**
 * H7 P4 — the House cron jobs that must not run for a local-first household.
 *
 * **Why a guard is needed at all.** Under E2EE the Worker's D1 holds no domain
 * rows for a local-first household, and the plan's expectation was that server
 * compute therefore degrades to a harmless no-op. `mirrorLegacyMembership`
 * broke that: V2 households ARE mirrored into the legacy `households` /
 * `household_members` tables so chat and the other `/households/:id/...`
 * features keep authorising — so anything enumerating households now sees
 * local-first ones and does per-household work against data that lives only on
 * someone's phone.
 *
 * For most cron work that really is a no-op (an overdue-task sweep over an empty
 * `tasks` finds nothing). The two covered here are not, and each fails
 * differently:
 *
 *  - `composeBriefingsDueThisHour` calls a model BEFORE it can know the context
 *    is empty, and the model — not the caller — decides whether to emit
 *    `compose_briefing` or `skip_briefing`. So an unguarded local-first
 *    household burns an LLM call an hour and can end up with a chatty paragraph
 *    persisted as if it described their home.
 *  - `BriefingDispatcher.dispatchFresh` is the SEND. It resolves a real owner
 *    push token — `push_tokens` and `household_members` exist for local-first
 *    households — so the paragraph above becomes a real notification.
 *
 * Each case asserts BOTH directions. "Guarded household skipped" alone would
 * pass just as well if the guard had accidentally disabled the job for
 * everybody, which is the more expensive bug.
 *
 * Live miniflare D1 rather than a fake, matching
 * `local-first-household-gate.test.ts`: the gate is one SQL question and a fake
 * would only prove the fake.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '../../../db/schema';
import { assistantBriefings, assistantIdentity } from '../../../db/schema-aihousekeeper';
import type { Env } from '../../../types';
import { BriefingDispatcher } from '../briefing-dispatcher';
import { AihousekeeperEventBus } from '../event-bus';
import type { OutboundDispatcher } from '../outbound-dispatcher';
import { composeBriefingsDueThisHour } from '../outbound-loop';

import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from './test-helpers';

const testEnv = env as unknown as Env;

/** Local-first. */
const HID_LF = 'hh_lf_guard';
/** An ordinary server household, present to prove the guard is not a kill switch. */
const HID_SERVER = 'hh_server_guard';

const BRIEFING_DATE = '2026-04-20';
/** UTC 07:00 on that date — the hour both identities' `briefing_time` names. */
const DUE_AT = new Date('2026-04-20T07:00:00Z');

/**
 * `lf_households` is not in `test-helpers.ts` — it belongs to the local-first
 * control plane, not the Aihousekeeper schema. DDL copied from
 * `local-first-household-gate.test.ts` so the two stay recognisably the same
 * table.
 */
async function createLfHouseholdsTable(): Promise<void> {
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_households (id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, display_name TEXT NOT NULL, key_epoch INTEGER NOT NULL DEFAULT 1, security_revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  );
}

/**
 * `test-helpers.ts` creates a narrower `push_tokens` than production, and
 * `BriefingDispatcher.resolveOwnerPushToken` selects `app_version` (it drives
 * the legacy-payload fallback). Added additively rather than by recreating the
 * table, so this file cannot break any other suite that shares the helper.
 */
async function ensurePushTokenAppVersion(): Promise<void> {
  try {
    await testEnv.DB.exec('ALTER TABLE push_tokens ADD COLUMN app_version TEXT');
  } catch {
    // Already present.
  }
}

async function markLocalFirst(ids: string[]): Promise<void> {
  await testEnv.DB.exec('DELETE FROM lf_households');
  const now = new Date().toISOString();
  for (const id of ids) {
    await testEnv.DB.prepare(
      `INSERT INTO lf_households (id, owner_user_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, `u_${id}`, 'Home', now, now)
      .run();
  }
}

/**
 * Two households that are identical in every way the cron can see — mirrored
 * legacy rows, an assistant identity, an owner, an active push token. The ONLY
 * difference between them is the `lf_households` row, which is the definition of
 * "local-first" the gate uses.
 */
async function seedTwinHouseholds(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await createLfHouseholdsTable();
  await ensurePushTokenAppVersion();
  await resetAllTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  for (const hid of [HID_LF, HID_SERVER]) {
    await db.insert(schema.users).values({
      id: `u_${hid}`,
      email: `${hid}@example.com`,
      email_verified: true,
    });
    await db.insert(schema.households).values({ id: hid, name: `Home ${hid}` });
    await db.insert(schema.householdMembers).values({
      id: `m_${hid}`,
      household_id: hid,
      user_id: `u_${hid}`,
      role: 'owner',
      joined_at: '2024-01-01T00:00:00Z',
    });
    await db.insert(assistantIdentity).values({
      household_id: hid,
      timezone: 'UTC',
      briefing_time: '07:00',
    });
    // Raw SQL: the helper's `push_tokens` has fewer columns than the drizzle
    // model, so a drizzle insert would bind columns the test table lacks.
    await testEnv.DB.prepare(
      `INSERT INTO push_tokens (id, user_id, token, platform, is_active) VALUES (?, ?, ?, ?, 1)`,
    )
      .bind(`pt_${hid}`, `u_${hid}`, `ExponentPushToken[${hid}]`, 'ios')
      .run();
  }
}

describe('composeBriefingsDueThisHour — local-first guard', () => {
  beforeEach(async () => {
    await seedTwinHouseholds();
    await markLocalFirst([HID_LF]);
    await testEnv.CONFIG_KV.put('aihousekeeper_briefings_enabled', 'true');
  });

  it('skips the local-first household and writes it no briefing row', async () => {
    const res = await composeBriefingsDueThisHour(testEnv, DUE_AT);

    expect(res.skippedLocalFirst).toBe(1);

    const db = drizzle(testEnv.DB, { schema });
    const rows = await db.select().from(assistantBriefings).all();
    // Whatever the composer did for the server household, the local-first one
    // must have no row at all: a row here is what the dispatcher later pushes.
    expect(rows.some((r) => r.household_id === HID_LF)).toBe(false);
  });

  it('still runs for a household that is not local-first', async () => {
    await markLocalFirst([]);
    const res = await composeBriefingsDueThisHour(testEnv, DUE_AT);
    expect(res.skippedLocalFirst).toBe(0);

    // Both twins are now ordinary server households, so the scheduler must
    // reach the compose step for each of them. Whether the model answers is
    // not this test's business — `composeFor` writes a row either way — but a
    // guard that had become a kill switch would leave the table empty.
    const db = drizzle(testEnv.DB, { schema });
    const rows = await db.select().from(assistantBriefings).all();
    expect(rows.map((r) => r.household_id).sort()).toEqual([HID_LF, HID_SERVER].sort());
  });

  it('counts every local-first household, not just the first', async () => {
    await markLocalFirst([HID_LF, HID_SERVER]);
    const res = await composeBriefingsDueThisHour(testEnv, DUE_AT);
    expect(res.skippedLocalFirst).toBe(2);

    const db = drizzle(testEnv.DB, { schema });
    const rows = await db.select().from(assistantBriefings).all();
    expect(rows).toHaveLength(0);
  });
});

describe('BriefingDispatcher.dispatchFresh — local-first guard', () => {
  function mkDispatcher() {
    const db = drizzle(testEnv.DB, { schema });
    const sendPush = vi.fn(async () => ({
      status: 'sent' as const,
      externalMessageId: 'mid',
    }));
    const dispatcher = { sendPush } as unknown as OutboundDispatcher;
    return {
      sendPush,
      briefingDispatcher: new BriefingDispatcher({
        db,
        env: testEnv,
        dispatcher,
        events: new AihousekeeperEventBus(),
      }),
    };
  }

  /** A non-empty briefing — `empty_reason` rows are skipped for other reasons. */
  async function seedBriefing(householdId: string): Promise<void> {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(assistantBriefings).values({
      id: `brief_${householdId}`,
      household_id: householdId,
      date: BRIEFING_DATE,
      paragraph: 'Two things need you today.',
      bullets_json: '[]',
      source_signals_json: '[]',
      composed_at: '2026-04-20T07:00:00Z',
    });
  }

  beforeEach(async () => {
    await seedTwinHouseholds();
    await markLocalFirst([HID_LF]);
    await seedBriefing(HID_LF);
    await seedBriefing(HID_SERVER);
  });

  it('does not push a briefing to a local-first household', async () => {
    const { briefingDispatcher, sendPush } = mkDispatcher();
    await briefingDispatcher.dispatchFresh(HID_LF, BRIEFING_DATE);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('leaves the row unmarked so nothing looks delivered', async () => {
    const { briefingDispatcher } = mkDispatcher();
    await briefingDispatcher.dispatchFresh(HID_LF, BRIEFING_DATE);

    const db = drizzle(testEnv.DB, { schema });
    const rows = await db.select().from(assistantBriefings).all();
    const row = rows.find((r) => r.household_id === HID_LF);
    expect(row?.push_sent).toBeFalsy();
    expect(row?.push_message_id).toBeFalsy();
  });

  it('still pushes to a household that is not local-first', async () => {
    const { briefingDispatcher, sendPush } = mkDispatcher();
    await briefingDispatcher.dispatchFresh(HID_SERVER, BRIEFING_DATE);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });
});
