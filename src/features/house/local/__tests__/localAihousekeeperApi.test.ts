/**
 * `localAihousekeeperApi` — H13 B-wave.
 *
 * The assistant's records on the ledger. What these tests are really pinning is
 * the boundary: D1 stores four columns as TEXT and derives two booleans, and
 * the client DTOs expose all six differently. Getting that wrong does not throw
 * — it produces a row that a server-written row will never converge with, which
 * is invisible until two devices disagree.
 *
 * Static imports only — `await import()` throws under this Jest config (§6.2).
 */
import { getLocalHouseLedger, openLocalHouseSession, resetLocalHouseSession } from '../engine';
import { houseDeterministicIds } from '../ids';
import { localAihousekeeperApi } from '../localAihousekeeperApi';
import type { LocalAssistantBriefing, LocalAssistantTrustLedger } from '../types';

const USER = 'user-aihk-1';

async function freshSession() {
  await resetLocalHouseSession();
  return openLocalHouseSession({ userId: USER, displayName: 'Assistant home' });
}

function seedBriefing(householdId: string, date: string, over: Partial<LocalAssistantBriefing> = {}) {
  getLocalHouseLedger().assistantBriefings.push({
    id: `br_${date}`,
    household_id: householdId,
    date,
    composed_at: `${date}T07:30:00.000Z`,
    paragraph: `Briefing for ${date}`,
    bullets_json: JSON.stringify(['first', 'second']),
    push_message_id: null,
    read_at: null,
    empty_reason: null,
    source_signals_json: JSON.stringify([{ kind: 'weather' }]),
    composed_by_model: 'claude',
    prompt_version: 'v1',
    ...over,
  } as LocalAssistantBriefing);
}

function seedLedgerEntry(
  householdId: string,
  id: string,
  over: Partial<LocalAssistantTrustLedger> = {},
) {
  getLocalHouseLedger().assistantTrustLedger.push({
    id,
    household_id: householdId,
    occurred_at: '2026-08-20T10:00:00.000Z',
    category: 'action',
    summary: `did ${id}`,
    rationale: 'because',
    undo_token: null,
    related_refs_json: null,
    user_dismissed_at: null,
    event_idempotency_key: `evt_${id}`,
    ...over,
  } as LocalAssistantTrustLedger);
}

describe('identity is get-or-create, and converges across devices', () => {
  it('materialises a persona rather than 404ing', async () => {
    const { household } = await freshSession();
    const { identity } = await localAihousekeeperApi.getIdentity(household.id);

    expect(identity.name).toBe('Mira');
    expect(identity.household_id).toBe(household.id);
    // `channels_enabled` reaches the screen PARSED even though D1 stores TEXT.
    expect(identity.channels_enabled).toEqual({ push: true, inApp: true });
  });

  it('gives the row an id derived from the household, because D1 has no `id` column', async () => {
    // `assistant_identity` is PK'd on `household_id` alone. Two devices that
    // both materialise before syncing must produce ONE persona, not two.
    const { household } = await freshSession();
    await localAihousekeeperApi.getIdentity(household.id);

    expect(getLocalHouseLedger().assistantIdentity[0].id).toBe(
      houseDeterministicIds.assistantIdentityId(household.id),
    );
  });

  it('does not create a second persona on a repeat read', async () => {
    const { household } = await freshSession();
    await localAihousekeeperApi.getIdentity(household.id);
    await localAihousekeeperApi.getIdentity(household.id);

    expect(getLocalHouseLedger().assistantIdentity).toHaveLength(1);
  });

  it('patches a field without disturbing the others', async () => {
    const { household } = await freshSession();
    await localAihousekeeperApi.updateIdentity(household.id, { name: 'Ada' } as never);

    const { identity } = await localAihousekeeperApi.getIdentity(household.id);
    expect(identity.name).toBe('Ada');
    expect(identity.briefing_time).toBe('07:30');
    expect(identity.daily_interrupt_budget).toBe(3);
  });

  it('writes `channels_enabled` back as JSON TEXT, not as a parsed key', async () => {
    // The failure a spread-based patch produces: the row grows a
    // `channels_enabled` key, `channels_enabled_json` keeps its old value, and a
    // server-written row disagrees on the column that actually syncs.
    const { household } = await freshSession();
    await localAihousekeeperApi.updateIdentity(household.id, {
      channels_enabled: { push: false, inApp: true },
    } as never);

    const row = getLocalHouseLedger().assistantIdentity[0] as unknown as Record<string, unknown>;
    expect(row.channels_enabled).toBeUndefined();
    expect(JSON.parse(row.channels_enabled_json as string)).toEqual({ push: false, inApp: true });

    const { identity } = await localAihousekeeperApi.getIdentity(household.id);
    expect(identity.channels_enabled).toEqual({ push: false, inApp: true });
  });

  it('patches a household that has never opened the assistant', async () => {
    // The server's route is a get-or-create, so a patch must not no-op.
    const { household } = await freshSession();
    expect(getLocalHouseLedger().assistantIdentity).toHaveLength(0);

    const { identity } = await localAihousekeeperApi.updateIdentity(household.id, {
      name: 'Ada',
    } as never);
    expect(identity.name).toBe('Ada');
  });
});

describe('briefings parse their TEXT columns and derive `push_sent`', () => {
  it('returns bullets and source signals parsed', async () => {
    const { household } = await freshSession();
    seedBriefing(household.id, '2026-08-20');

    const { briefings } = await localAihousekeeperApi.listBriefings(household.id);
    expect(briefings[0].bullets).toEqual(['first', 'second']);
    expect(briefings[0].source_signals).toEqual([{ kind: 'weather' }]);
  });

  it('derives `push_sent` from `push_message_id` rather than storing it', async () => {
    const { household } = await freshSession();
    seedBriefing(household.id, '2026-08-20', { push_message_id: null });
    seedBriefing(household.id, '2026-08-21', { push_message_id: 'msg_1' });

    const { briefings } = await localAihousekeeperApi.listBriefings(household.id);
    const byDate = Object.fromEntries(briefings.map((b) => [b.date, b]));
    expect(byDate['2026-08-20'].push_sent).toBe(false);
    expect(byDate['2026-08-21'].push_sent).toBe(true);
  });

  it('survives a malformed JSON column instead of taking down the screen', async () => {
    const { household } = await freshSession();
    seedBriefing(household.id, '2026-08-20', { bullets_json: '{not json' });

    const { briefings } = await localAihousekeeperApi.listBriefings(household.id);
    expect(briefings[0].bullets).toEqual([]);
    expect(briefings[0].paragraph).toBe('Briefing for 2026-08-20');
  });

  it('lists newest first', async () => {
    const { household } = await freshSession();
    seedBriefing(household.id, '2026-08-19');
    seedBriefing(household.id, '2026-08-21');
    seedBriefing(household.id, '2026-08-20');

    const { briefings } = await localAihousekeeperApi.listBriefings(household.id);
    expect(briefings.map((b) => b.date)).toEqual(['2026-08-21', '2026-08-20', '2026-08-19']);
  });

  it('throws for a date with no briefing rather than inventing an empty one', async () => {
    // A day the assistant did not compose for and a day whose briefing failed
    // to load must not render identically.
    const { household } = await freshSession();
    await expect(localAihousekeeperApi.getBriefing(household.id, '2026-01-01')).rejects.toThrow(
      /No briefing/,
    );
  });

  it('keeps the FIRST read time when marked twice', async () => {
    const { household } = await freshSession();
    seedBriefing(household.id, '2026-08-20');

    const first = await localAihousekeeperApi.markBriefingRead(household.id, '2026-08-20');
    const readAt = first.briefing.read_at;
    expect(readAt).toBeTruthy();

    const second = await localAihousekeeperApi.markBriefingRead(household.id, '2026-08-20');
    expect(second.briefing.read_at).toBe(readAt);
  });
});

describe('the trust ledger is a record, not a to-do list', () => {
  it('derives `reversible` from `undo_token`', async () => {
    const { household } = await freshSession();
    seedLedgerEntry(household.id, 'e1', { undo_token: null });
    seedLedgerEntry(household.id, 'e2', { undo_token: 'tok' });

    const { entries } = await localAihousekeeperApi.listTrustLedger(household.id);
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(byId.e1.reversible).toBe(false);
    expect(byId.e2.reversible).toBe(true);
  });

  it('KEEPS a dismissed entry in the list', async () => {
    // Hiding it would turn a record of what the assistant did into a record of
    // what the member has not yet objected to.
    const { household } = await freshSession();
    seedLedgerEntry(household.id, 'e1');
    await localAihousekeeperApi.dismissLedgerEntry(household.id, 'e1');

    const { entries } = await localAihousekeeperApi.listTrustLedger(household.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].user_dismissed_at).toBeTruthy();
  });

  it('does not overwrite an existing dismissal timestamp', async () => {
    const { household } = await freshSession();
    seedLedgerEntry(household.id, 'e1');
    await localAihousekeeperApi.dismissLedgerEntry(household.id, 'e1');
    const first = getLocalHouseLedger().assistantTrustLedger[0].user_dismissed_at;

    await localAihousekeeperApi.dismissLedgerEntry(household.id, 'e1');
    expect(getLocalHouseLedger().assistantTrustLedger[0].user_dismissed_at).toBe(first);
  });

  it('honours a limit, newest first', async () => {
    const { household } = await freshSession();
    seedLedgerEntry(household.id, 'old', { occurred_at: '2026-08-01T00:00:00.000Z' });
    seedLedgerEntry(household.id, 'new', { occurred_at: '2026-08-25T00:00:00.000Z' });

    const { entries } = await localAihousekeeperApi.listTrustLedger(household.id, {
      limit: 1,
    } as never);
    expect(entries.map((e) => e.id)).toEqual(['new']);
  });

  it('returns `related_refs` parsed, and null when absent', async () => {
    const { household } = await freshSession();
    seedLedgerEntry(household.id, 'e1', { related_refs_json: JSON.stringify([{ task: 't1' }]) });
    seedLedgerEntry(household.id, 'e2', { related_refs_json: null });

    const { entries } = await localAihousekeeperApi.listTrustLedger(household.id);
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(byId.e1.related_refs).toEqual([{ task: 't1' }]);
    expect(byId.e2.related_refs).toBeNull();
  });
});
