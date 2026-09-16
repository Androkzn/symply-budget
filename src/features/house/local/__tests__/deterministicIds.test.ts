/**
 * S3b convergence — the test the plan requires "one per table" (§1.5).
 *
 * The failure this prevents: two members, both offline, create the *same*
 * logical row — the same setting, the same membership, the same checklist item
 * completion, the same reminder period. With random ids each device mints a
 * different key, LWW has nothing to merge on, and BOTH rows survive the sync.
 * The member then sees a duplicate that no amount of later editing can
 * reconcile.
 *
 * Written before the write sites exist on purpose: without deterministic ids
 * these tests fail, which is the point.
 */
import { houseDeterministicIds } from '../ids';
import { applyLedgerDelta, captureLedgerSnapshot, diffLedger } from '../projection';

import { emptyHouseLedger, stampAt, TEST_HOUSEHOLD_ID } from './houseLedgerTestKit';

describe('deterministic row ids', () => {
  it('is stable for the same natural key and different for a different one', () => {
    const a = houseDeterministicIds.setting('user-1', TEST_HOUSEHOLD_ID, 'units');
    const b = houseDeterministicIds.setting('user-1', TEST_HOUSEHOLD_ID, 'units');
    const c = houseDeterministicIds.setting('user-1', TEST_HOUSEHOLD_ID, 'theme');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('separates a null household from the literal string "null"', () => {
    expect(houseDeterministicIds.setting('user-1', null, 'units')).not.toBe(
      houseDeterministicIds.setting('user-1', 'null', 'units'),
    );
  });

  it('cannot be confused by a delimiter inside a key part', () => {
    // Naive concatenation would make ('a','b|c') and ('a|b','c') collide.
    expect(houseDeterministicIds.setting('a', 'b_c', 'd')).not.toBe(
      houseDeterministicIds.setting('a_b', 'c', 'd'),
    );
  });

  it('never collides across tables for the same key parts', () => {
    expect(houseDeterministicIds.householdMember('x', 'y')).not.toBe(
      houseDeterministicIds.checklistItemCompletion('x', 'y'),
    );
  });
});

/**
 * H11 Wave B / Wave C builders.
 *
 * Three of these five tables are registered but not yet on `HouseLedger`, so the
 * two-device convergence below cannot be run against them — there is no array to
 * push a row into. That is a smaller gap than it looks: the engine's behaviour
 * given two rows with the SAME id is already proven, table-independently, by the
 * four convergence tests below. What is table-specific is only whether both
 * devices arrive at the same id, and that is exactly what these assert.
 *
 * The other two — `contractorQuotes` and `quoteRequests` — went live with H11
 * B2, so they now have an array and the real convergence IS run, in
 * `localQuotesApi.test.ts`. Their id assertions stay here, beside the sibling
 * builders they must not collide with.
 */
describe('deterministic row ids — staged waves', () => {
  it('gives one quote per contractor per task, and never merges with the request', () => {
    // `contractor_quotes` and `quote_requests` are both unique on
    // `(task_id, contractor_id)`. Asking for a quote and receiving one are two
    // rows about the same pair of entities — if the ids collided, accepting the
    // quote would overwrite the request that produced it.
    const quote = houseDeterministicIds.contractorQuote('task-9', 'con-3');
    const request = houseDeterministicIds.quoteRequest('task-9', 'con-3');
    expect(quote).toBe(houseDeterministicIds.contractorQuote('task-9', 'con-3'));
    expect(quote).not.toBe(request);
    expect(quote).not.toBe(houseDeterministicIds.contractorQuote('task-9', 'con-4'));
  });

  it('gives one rating per visit', () => {
    const rating = houseDeterministicIds.contractorJobRating('visit-1');
    expect(rating).toBe(houseDeterministicIds.contractorJobRating('visit-1'));
    expect(rating).not.toBe(houseDeterministicIds.contractorJobRating('visit-2'));
  });

  it('treats the year as part of the key for both annual property records', () => {
    // `tax_year` and `assessment_year` are D1 integers. The shared builder
    // stringifies, so the two devices agree whether the caller reads the year off
    // a numeric column or a parsed form field — the mismatch that would otherwise
    // give one household two 2026 tax records.
    const tax = houseDeterministicIds.propertyTax(TEST_HOUSEHOLD_ID, 2026);
    expect(tax).toBe(houseDeterministicIds.propertyTax(TEST_HOUSEHOLD_ID, 2026));
    expect(tax).not.toBe(houseDeterministicIds.propertyTax(TEST_HOUSEHOLD_ID, 2025));
    expect(tax).not.toBe(houseDeterministicIds.bcAssessment(TEST_HOUSEHOLD_ID, 2026));
    expect(houseDeterministicIds.bcAssessment(TEST_HOUSEHOLD_ID, 2026)).toBe(
      houseDeterministicIds.bcAssessment(TEST_HOUSEHOLD_ID, 2026),
    );
  });

  it('scopes the annual records per property, not per user', () => {
    // Both are `(household_id, year)`. H5 puts several properties on one device;
    // dropping the household from the key would merge two homes' tax records.
    expect(houseDeterministicIds.propertyTax('hh_a', 2026)).not.toBe(
      houseDeterministicIds.propertyTax('hh_b', 2026),
    );
  });
});

/**
 * Simulate the real failure: two devices mutate independently offline, then
 * exchange deltas. Convergence means exactly one row, with the same value, on
 * both replicas.
 *
 * The local echo is not optional here. `mutateLocalHouseLedger` appends the op
 * and the OpLog immediately projects it back, which is what stamps the author's
 * own fields in `lww`. Skipping that step would leave the local row unstamped,
 * so the FIRST peer delta to arrive would win every field regardless of clock —
 * and the test would be measuring an engine state no device is ever in.
 */
const STAMP_A = stampAt(10, 'member-a', 'op-a');
const STAMP_B = stampAt(20, 'member-b', 'op-b');

function converge(
  seed: () => ReturnType<typeof emptyHouseLedger>,
  mutateA: (ledger: ReturnType<typeof emptyHouseLedger>) => void,
  mutateB: (ledger: ReturnType<typeof emptyHouseLedger>) => void,
) {
  const deviceA = seed();
  const deviceB = seed();

  const beforeA = captureLedgerSnapshot(deviceA);
  mutateA(deviceA);
  const deltaA = diffLedger(beforeA, deviceA)!;
  applyLedgerDelta(deviceA, deltaA, STAMP_A);

  const beforeB = captureLedgerSnapshot(deviceB);
  mutateB(deviceB);
  const deltaB = diffLedger(beforeB, deviceB)!;
  applyLedgerDelta(deviceB, deltaB, STAMP_B);

  // Each device now receives the other's op. B's stamp is newer, so B wins any
  // same-field contest — which is only observable if they share a row key.
  applyLedgerDelta(deviceA, deltaB, STAMP_B);
  applyLedgerDelta(deviceB, deltaA, STAMP_A);

  return { deviceA, deviceB };
}

describe('S3b — offline double-create converges to one row', () => {
  it('household_members: (household_id, user_id)', () => {
    const id = houseDeterministicIds.householdMember(TEST_HOUSEHOLD_ID, 'user-7');
    const { deviceA, deviceB } = converge(
      emptyHouseLedger,
      (l) =>
        l.householdMembers.push({
          id,
          household_id: TEST_HOUSEHOLD_ID,
          user_id: 'user-7',
          display_name: 'Alex',
          avatar_url: null,
          email: 'alex@example.com',
          role: 'member',
          joined_at: '2026-08-10T00:00:00.000Z',
        } as never),
      (l) =>
        l.householdMembers.push({
          id,
          household_id: TEST_HOUSEHOLD_ID,
          user_id: 'user-7',
          display_name: 'Alexandra',
          avatar_url: null,
          email: 'alex@example.com',
          role: 'member',
          joined_at: '2026-08-10T00:00:00.000Z',
        } as never),
    );

    expect(deviceA.householdMembers).toHaveLength(1);
    expect(deviceB.householdMembers).toHaveLength(1);
    expect(deviceA.householdMembers[0]!.display_name).toBe('Alexandra');
    expect(deviceB.householdMembers[0]!.display_name).toBe('Alexandra');
  });

  it('settings: (user_id, household_id, key)', () => {
    const id = houseDeterministicIds.setting('user-1', TEST_HOUSEHOLD_ID, 'unit_system');
    const { deviceA, deviceB } = converge(
      emptyHouseLedger,
      (l) =>
        l.settings.push({
          id,
          user_id: 'user-1',
          household_id: TEST_HOUSEHOLD_ID,
          key: 'unit_system',
          value: '"metric"',
          created_at: '2026-08-10T00:00:00.000Z',
          updated_at: '2026-08-10T00:00:00.000Z',
        } as never),
      (l) =>
        l.settings.push({
          id,
          user_id: 'user-1',
          household_id: TEST_HOUSEHOLD_ID,
          key: 'unit_system',
          value: '"imperial"',
          created_at: '2026-08-10T00:00:00.000Z',
          updated_at: '2026-08-10T00:00:00.000Z',
        } as never),
    );

    expect(deviceA.settings).toHaveLength(1);
    expect(deviceB.settings).toHaveLength(1);
    expect(deviceA.settings[0]!.value).toBe('"imperial"');
    expect(deviceB.settings[0]!.value).toBe('"imperial"');
  });

  it('checklist_item_completions: (instance_id, item_id)', () => {
    const id = houseDeterministicIds.checklistItemCompletion('inst-1', 'item-1');
    const { deviceA, deviceB } = converge(
      emptyHouseLedger,
      (l) =>
        l.checklistItemCompletions.push({
          id,
          household_id: TEST_HOUSEHOLD_ID,
          instance_id: 'inst-1',
          item_id: 'item-1',
          completed_by: 'user-a',
          completed_at: '2026-08-10T09:00:00.000Z',
          notes: null,
        } as never),
      (l) =>
        l.checklistItemCompletions.push({
          id,
          household_id: TEST_HOUSEHOLD_ID,
          instance_id: 'inst-1',
          item_id: 'item-1',
          completed_by: 'user-b',
          completed_at: '2026-08-10T10:00:00.000Z',
          notes: 'done',
        } as never),
    );

    expect(deviceA.checklistItemCompletions).toHaveLength(1);
    expect(deviceB.checklistItemCompletions).toHaveLength(1);
    expect(deviceA.checklistItemCompletions[0]!.completed_by).toBe('user-b');
  });

  it('recurring_reminders: (household_id, type, reference_id, period_key)', () => {
    const id = houseDeterministicIds.recurringReminder(
      TEST_HOUSEHOLD_ID,
      'furnace_filter',
      'task-1',
      '2026-08',
    );
    const { deviceA, deviceB } = converge(
      emptyHouseLedger,
      (l) =>
        l.recurringReminders.push({
          id,
          household_id: TEST_HOUSEHOLD_ID,
          type: 'furnace_filter',
          reference_type: 'task',
          reference_id: 'task-1',
          period_key: '2026-08',
          status: 'pending',
          title: 'Change the furnace filter',
          body: 'Due this month',
          data: null,
          frequency: 'monthly',
          next_nudge_at: '2026-08-20T09:00:00.000Z',
          last_nudged_at: null,
          nudge_count: 0,
          snoozed_until: null,
          completed_at: null,
          completed_by_user_id: null,
          completed_reason: null,
          created_at: '2026-08-10T00:00:00.000Z',
          updated_at: '2026-08-10T00:00:00.000Z',
        } as never),
      (l) =>
        l.recurringReminders.push({
          id,
          household_id: TEST_HOUSEHOLD_ID,
          type: 'furnace_filter',
          reference_type: 'task',
          reference_id: 'task-1',
          period_key: '2026-08',
          status: 'done',
          title: 'Change the furnace filter',
          body: 'Due this month',
          data: null,
          frequency: 'monthly',
          next_nudge_at: '2026-08-20T09:00:00.000Z',
          last_nudged_at: null,
          nudge_count: 0,
          snoozed_until: null,
          completed_at: '2026-08-12T00:00:00.000Z',
          completed_by_user_id: 'user-b',
          completed_reason: 'manual',
          created_at: '2026-08-10T00:00:00.000Z',
          updated_at: '2026-08-12T00:00:00.000Z',
        } as never),
    );

    expect(deviceA.recurringReminders).toHaveLength(1);
    expect(deviceB.recurringReminders).toHaveLength(1);
    expect(deviceA.recurringReminders[0]!.status).toBe('done');
  });
});

describe('S3b — the counter-example that justifies the rule', () => {
  it('random ids on the same logical row DO survive as duplicates', () => {
    const { deviceA } = converge(
      emptyHouseLedger,
      (l) =>
        l.settings.push({
          id: 'set_random_a',
          user_id: 'user-1',
          household_id: TEST_HOUSEHOLD_ID,
          key: 'unit_system',
          value: '"metric"',
          created_at: '2026-08-10T00:00:00.000Z',
          updated_at: '2026-08-10T00:00:00.000Z',
        } as never),
      (l) =>
        l.settings.push({
          id: 'set_random_b',
          user_id: 'user-1',
          household_id: TEST_HOUSEHOLD_ID,
          key: 'unit_system',
          value: '"imperial"',
          created_at: '2026-08-10T00:00:00.000Z',
          updated_at: '2026-08-10T00:00:00.000Z',
        } as never),
    );
    expect(deviceA.settings).toHaveLength(2);
  });
});
