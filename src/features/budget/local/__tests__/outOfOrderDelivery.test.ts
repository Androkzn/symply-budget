/**
 * Audit finding B4 — out-of-order delivery used to DROP a peer's edit.
 *
 * A RowDelta with no `n:1` for a row this replica has never seen was discarded
 * outright, and the op was then marked applied, so it was never reconsidered
 * when the create finally arrived. These tests pin the replacement behaviour:
 * the patch is parked and replayed, and out-of-order delivery is
 * indistinguishable from in-order delivery — same row, same stamps, same
 * conflicts.
 *
 * The convergence half runs through the REAL OpLog/crypto member harness so the
 * assertions are about what actually crosses the wire, not a re-derived copy.
 */
import '../cryptoPolyfill';

import {
  MemoryLocalFirstStore,
  OpLog,
  createOpId,
  generateDeviceIdentity,
  generateHouseholdKeys,
  randomBytes,
  utf8Decode,
  utf8Encode,
  type Clock,
  type DeviceIdentity,
  type HouseholdKeys,
  type StoredOperation,
} from '@symply/local-first';

import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
  type LocalBudgetLedger,
} from '../engine';
import { localBudgetApi } from '../localBudgetApi';
import {
  MAX_PARKED_ROWS,
  applyLedgerDelta,
  captureLedgerSnapshot,
  decodeLedgerOpPayload,
  diffLedger,
  drainParkedRows,
  encodeLedgerOpPayload,
  type LedgerDelta,
  type RowLww,
} from '../projection';

import { emptyLedger, expenseRow, stampAt } from './ledgerTestKit';

class ManualClock implements Clock {
  constructor(private ms: number) {}
  nowMs(): number {
    return this.ms;
  }
  set(ms: number): void {
    this.ms = ms;
  }
}

type Member = {
  memberId: string;
  identity: DeviceIdentity;
  opLog: OpLog;
  ledger: LocalBudgetLedger;
  clock: ManualClock;
  outbox: StoredOperation[];
};

async function createMember(
  memberId: string,
  deviceId: string,
  householdKeys: HouseholdKeys,
  startMs: number,
): Promise<Member> {
  const store = new MemoryLocalFirstStore();
  await store.open(randomBytes(32));
  const identity = generateDeviceIdentity(deviceId);
  const ledger = emptyLedger(householdKeys.householdId, memberId, deviceId);
  const clock = new ManualClock(startMs);
  const opLog = new OpLog({
    store,
    identity,
    householdKeys,
    clock,
    projection: {
      async apply(args) {
        const delta = decodeLedgerOpPayload(JSON.parse(utf8Decode(args.plaintextPayload)));
        if (!delta) return;
        applyLedgerDelta(ledger, delta, {
          hlc: args.hlc,
          authorMemberId: args.authorMemberId,
          opId: args.opId,
        });
      },
    },
  });
  return { memberId, identity, opLog, ledger, clock, outbox: [] };
}

async function commit(
  member: Member,
  mutator: (ledger: LocalBudgetLedger) => void,
  op: { opType: string; entityType: string; entityId: string },
): Promise<StoredOperation> {
  const before = captureLedgerSnapshot(member.ledger);
  mutator(member.ledger);
  const delta = diffLedger(before, member.ledger);
  const stored = await member.opLog.append({
    opId: createOpId(),
    authorMemberId: member.memberId,
    parents: [],
    opType: op.opType,
    entityType: op.entityType,
    entityId: op.entityId,
    plaintextPayload: utf8Encode(JSON.stringify(encodeLedgerOpPayload({}, delta))),
  });
  member.outbox.push(stored);
  return stored;
}

async function deliver(ops: StoredOperation[], from: Member, to: Member): Promise<number> {
  let applied = 0;
  for (const op of ops) {
    const result = await to.opLog.applyRemote(op, from.identity.signingPublicKey);
    if (result.status === 'applied') applied += 1;
  }
  return applied;
}

function parkedEntries(ledger: LocalBudgetLedger): RowLww[] {
  const out: RowLww[] = [];
  for (const forTable of Object.values(ledger.lww ?? {})) {
    if (!forTable) continue;
    for (const meta of Object.values(forTable)) {
      if (meta.p) out.push(meta);
    }
  }
  return out;
}

const createDelta = (id: string, overrides: Record<string, unknown> = {}): LedgerDelta => ({
  v: 1,
  u: { expenses: [{ k: id, f: expenseRow(id, overrides), n: 1 }] },
});

const patchDelta = (id: string, fields: Record<string, unknown>): LedgerDelta => ({
  v: 1,
  u: { expenses: [{ k: id, f: fields }] },
});

const deleteDelta = (id: string): LedgerDelta => ({ v: 1, d: { expenses: [id] } });

describe('out-of-order delivery parks and replays a peer patch', () => {
  // Revert-proof drill 2026-08-13: making parkOrphanPatch a no-op failed 16 of
  // these cases (create-before-patch still passed). Do not weaken the amount
  // assertion below — that is the lost-edit detector.
  it('applies a patch that arrived before its create', () => {
    const ledger = emptyLedger();
    // Patch first — the create has not been delivered yet.
    applyLedgerDelta(ledger, patchDelta('exp-1', { amount: 7500 }), stampAt(200));
    expect(ledger.expenses).toHaveLength(0);

    applyLedgerDelta(ledger, createDelta('exp-1', { amount: 1000 }), stampAt(100));

    expect(ledger.expenses).toHaveLength(1);
    // Without parking this reads 1000 — the peer's edit was lost forever.
    expect(ledger.expenses[0]).toMatchObject({ id: 'exp-1', amount: 7500 });
    expect(parkedEntries(ledger)).toHaveLength(0);
  });

  it('is indistinguishable from in-order delivery', () => {
    const create = createDelta('exp-1', { amount: 1000 });
    const patch = patchDelta('exp-1', { amount: 7500, title: 'Dinner out' });
    const createStamp = stampAt(100);
    const patchStamp = stampAt(200);

    const inOrder = emptyLedger();
    applyLedgerDelta(inOrder, create, createStamp);
    applyLedgerDelta(inOrder, patch, patchStamp);

    const outOfOrder = emptyLedger();
    applyLedgerDelta(outOfOrder, patch, patchStamp);
    applyLedgerDelta(outOfOrder, create, createStamp);

    expect(outOfOrder.expenses).toEqual(inOrder.expenses);
    expect(outOfOrder.lww).toEqual(inOrder.lww);
    expect(outOfOrder.conflicts).toEqual(inOrder.conflicts);
  });

  it('is idempotent when the parked patch is delivered twice', () => {
    const once = emptyLedger();
    applyLedgerDelta(once, patchDelta('exp-1', { amount: 7500 }), stampAt(200));
    const onceResult = applyLedgerDelta(once, createDelta('exp-1'), stampAt(100));

    const twice = emptyLedger();
    applyLedgerDelta(twice, patchDelta('exp-1', { amount: 7500 }), stampAt(200));
    applyLedgerDelta(twice, patchDelta('exp-1', { amount: 7500 }), stampAt(200));
    const twiceResult = applyLedgerDelta(twice, createDelta('exp-1'), stampAt(100));

    expect(twice.expenses).toEqual(once.expenses);
    expect(twice.conflicts).toEqual(once.conflicts);
    expect(twiceResult).toEqual(onceResult);
  });

  it('lets a tombstone absorb a parked patch', () => {
    const ledger = emptyLedger();
    applyLedgerDelta(ledger, patchDelta('exp-1', { amount: 7500 }), stampAt(300));
    applyLedgerDelta(ledger, deleteDelta('exp-1'), stampAt(400));
    applyLedgerDelta(ledger, createDelta('exp-1'), stampAt(100));

    expect(ledger.expenses).toHaveLength(0);
    expect(parkedEntries(ledger)).toHaveLength(0);
    expect(ledger.conflicts!.length).toBeGreaterThanOrEqual(1);
    expect(ledger.conflicts!.every((c) => c.kind === 'edit_vs_delete')).toBe(true);
  });

  it('surfaces a parked edit an older-losing tombstone discards', () => {
    // Tombstone is NEWER than the parked patch → the patch loses and is told so.
    const ledger = emptyLedger();
    applyLedgerDelta(ledger, patchDelta('exp-1', { amount: 7500 }), stampAt(500));
    applyLedgerDelta(ledger, deleteDelta('exp-1'), stampAt(400));
    expect(ledger.conflicts).toEqual([
      expect.objectContaining({ kind: 'edit_vs_delete', field: 'amount', rowKey: 'exp-1' }),
    ]);
  });

  it('records the in-order conflict id when a parked field loses to the create', () => {
    const patchStamp = stampAt(100, 'member-peer', 'op-patch');
    const createStamp = stampAt(900, 'member-peer', 'op-create');

    const outOfOrder = emptyLedger();
    applyLedgerDelta(outOfOrder, patchDelta('exp-1', { amount: 7500 }), patchStamp);
    applyLedgerDelta(outOfOrder, createDelta('exp-1', { amount: 1000 }), createStamp);

    expect(outOfOrder.expenses[0]).toMatchObject({ amount: 1000 });
    expect(outOfOrder.conflicts).toHaveLength(1);
    expect(outOfOrder.conflicts![0]!.id).toBe('op-patch:expenses:exp-1:amount');

    // The in-order run mints the same id, which is what keeps recordConflict's
    // dedupe working across a replay.
    const inOrder = emptyLedger();
    applyLedgerDelta(inOrder, createDelta('exp-1', { amount: 1000 }), createStamp);
    applyLedgerDelta(inOrder, patchDelta('exp-1', { amount: 7500 }), patchStamp);
    expect(inOrder.conflicts![0]!.id).toBe(outOfOrder.conflicts![0]!.id);
  });

  it('merges two parked patches on different fields', () => {
    const ledger = emptyLedger();
    applyLedgerDelta(ledger, patchDelta('exp-1', { amount: 7500 }), stampAt(200));
    applyLedgerDelta(ledger, patchDelta('exp-1', { title: 'Dinner out' }), stampAt(300));
    applyLedgerDelta(ledger, createDelta('exp-1', { amount: 1000, title: 'Dinner' }), stampAt(100));

    expect(ledger.expenses[0]).toMatchObject({ amount: 7500, title: 'Dinner out' });
    expect(ledger.conflicts).toHaveLength(0);
  });

  it('keeps the newer of two parked patches on the same field, without a conflict', () => {
    const ledger = emptyLedger();
    applyLedgerDelta(ledger, patchDelta('exp-1', { amount: 100 }), stampAt(200));
    applyLedgerDelta(ledger, patchDelta('exp-1', { amount: 999 }), stampAt(300));
    applyLedgerDelta(ledger, createDelta('exp-1'), stampAt(100));

    expect(ledger.expenses[0]).toMatchObject({ amount: 999 });
    // The older parked write would have lost in-order too, so it is silent.
    expect(ledger.conflicts).toHaveLength(0);
  });

  it('bounds parked rows and still replays one that survived', () => {
    const ledger = emptyLedger();
    const overflow = MAX_PARKED_ROWS + 200;
    for (let i = 0; i < overflow; i += 1) {
      applyLedgerDelta(ledger, patchDelta(`exp-${i}`, { amount: i }), stampAt(1_000 + i));
    }

    const parked = parkedEntries(ledger);
    expect(parked.length).toBeLessThanOrEqual(MAX_PARKED_ROWS);
    // Eviction drops the OLDEST stamps, so the newest orphan is still held.
    const newest = ledger.lww!.expenses![`exp-${overflow - 1}`]!;
    expect(newest.p).toBeDefined();

    applyLedgerDelta(ledger, createDelta(`exp-${overflow - 1}`, { amount: 0 }), stampAt(1));
    expect(ledger.expenses[0]).toMatchObject({ amount: overflow - 1 });
  });

  it('survives a persist/reload JSON round trip', () => {
    const ledger = emptyLedger();
    applyLedgerDelta(ledger, patchDelta('exp-1', { amount: 7500 }), stampAt(200));

    const revived = JSON.parse(JSON.stringify(ledger)) as LocalBudgetLedger;
    applyLedgerDelta(revived, createDelta('exp-1', { amount: 1000 }), stampAt(100));

    expect(revived.expenses[0]).toMatchObject({ amount: 7500 });
  });
});

/**
 * The create branch is NOT the only way a parked row materializes.
 *
 * `mutateLocalLedger` runs its mutator BEFORE the op is appended, and the OpLog
 * fires the projection after the append — so a locally-created row is already in
 * the ledger when its own `n:1` delta is projected, and that delta takes the
 * PATCH branch. Any table whose ids are deterministic and member-independent
 * (`goal_${year}_${month}`) therefore has a real, reachable path in which a
 * peer's parked patch is never replayed.
 */
describe('parked fields are drained by every path that materializes the row', () => {
  it('replays a parked patch when the row appears through the patch branch', () => {
    const ledger = emptyLedger();
    applyLedgerDelta(ledger, patchDelta('exp-1', { amount: 7500 }), stampAt(200));
    expect(ledger.expenses).toHaveLength(0);

    // Local echo: the row is written by the mutator, so `cursor.find` hits and
    // the create delta below never reaches the create branch.
    ledger.expenses.push(expenseRow('exp-1', { amount: 1000 }) as never);
    applyLedgerDelta(ledger, createDelta('exp-1', { amount: 1000 }), stampAt(100));

    expect(ledger.expenses[0]).toMatchObject({ id: 'exp-1', amount: 7500 });
    expect(parkedEntries(ledger)).toHaveLength(0);
  });

  it('converges with the create-branch replay, stamps and conflicts included', () => {
    const patch = patchDelta('exp-1', { amount: 7500, title: 'Dinner out' });
    const create = createDelta('exp-1', { amount: 1000, title: 'Dinner' });
    const patchStamp = stampAt(200);
    const createStamp = stampAt(100);

    const viaCreate = emptyLedger();
    applyLedgerDelta(viaCreate, patch, patchStamp);
    applyLedgerDelta(viaCreate, create, createStamp);

    const viaPatch = emptyLedger();
    applyLedgerDelta(viaPatch, patch, patchStamp);
    viaPatch.expenses.push(expenseRow('exp-1', { amount: 1000, title: 'Dinner' }) as never);
    applyLedgerDelta(viaPatch, create, createStamp);

    expect(viaPatch.expenses).toEqual(viaCreate.expenses);
    expect(viaPatch.lww).toEqual(viaCreate.lww);
    expect(viaPatch.conflicts).toEqual(viaCreate.conflicts);
  });

  it('surfaces a parked field the materializing op outranks, with the in-order id', () => {
    const patchStamp = stampAt(100, 'member-peer', 'op-patch');
    const createStamp = stampAt(900, 'member-peer', 'op-create');

    const ledger = emptyLedger();
    applyLedgerDelta(ledger, patchDelta('exp-1', { amount: 7500 }), patchStamp);
    ledger.expenses.push(expenseRow('exp-1', { amount: 1000 }) as never);
    applyLedgerDelta(ledger, createDelta('exp-1', { amount: 1000 }), createStamp);

    expect(ledger.expenses[0]).toMatchObject({ amount: 1000 });
    expect(parkedEntries(ledger)).toHaveLength(0);
    expect(ledger.conflicts).toHaveLength(1);
    expect(ledger.conflicts![0]!.id).toBe('op-patch:expenses:exp-1:amount');
  });

  it('drains a parked patch when a LATER peer patch materializes nothing new', () => {
    // Second reachable shape: the create never arrives at all, the row shows up
    // locally, and the next thing the peer sends is another plain patch.
    const ledger = emptyLedger();
    applyLedgerDelta(ledger, patchDelta('exp-1', { title: 'Dinner out' }), stampAt(200));
    ledger.expenses.push(expenseRow('exp-1', { amount: 1000 }) as never);
    applyLedgerDelta(ledger, patchDelta('exp-1', { amount: 4200 }), stampAt(300));

    expect(ledger.expenses[0]).toMatchObject({ amount: 4200, title: 'Dinner out' });
    expect(parkedEntries(ledger)).toHaveLength(0);
  });

  it('frees the parked-row slot so eviction is not starved by drained rows', () => {
    const ledger = emptyLedger();
    for (let i = 0; i < 10; i += 1) {
      applyLedgerDelta(ledger, patchDelta(`exp-${i}`, { amount: i }), stampAt(1_000 + i));
      ledger.expenses.push(expenseRow(`exp-${i}`) as never);
      applyLedgerDelta(ledger, createDelta(`exp-${i}`), stampAt(1));
    }
    expect(parkedEntries(ledger)).toHaveLength(0);
  });
});

describe('out-of-order delivery over the real op log', () => {
  let householdKeys: HouseholdKeys;
  let alice: Member;
  let bob: Member;

  beforeEach(async () => {
    householdKeys = generateHouseholdKeys('hh_ooo_test', 1);
    alice = await createMember('member-alice', 'dev-alice', householdKeys, 1_800_000_000_000);
    bob = await createMember('member-bob', 'dev-bob', householdKeys, 1_800_000_000_000);
  });

  it("does not lose Alice's edit when Bob receives the update before the create", async () => {
    const householdId = householdKeys.householdId;
    const created = await commit(
      alice,
      (ledger) => {
        ledger.expenses.push(
          expenseRow('exp-1', { household_id: householdId, amount: 4200 }) as never,
        );
      },
      { opType: 'EXPENSE_CREATE', entityType: 'expense', entityId: 'exp-1' },
    );

    alice.clock.set(1_800_000_030_000);
    const updated = await commit(
      alice,
      (ledger) => {
        (ledger.expenses[0] as unknown as { amount: number }).amount = 9900;
      },
      { opType: 'EXPENSE_UPDATE', entityType: 'expense', entityId: 'exp-1' },
    );

    // The mailbox delivers the UPDATE first — the CREATE is still in flight.
    expect(await deliver([updated], alice, bob)).toBe(1);
    expect(bob.ledger.expenses).toHaveLength(0);

    expect(await deliver([created], alice, bob)).toBe(1);
    expect(bob.ledger.expenses).toHaveLength(1);
    expect(bob.ledger.expenses[0]).toMatchObject({ id: 'exp-1', amount: 9900 });
    expect(bob.ledger.expenses[0]).toEqual(alice.ledger.expenses[0]);
  });
});

/**
 * The reachable product shape: `goal_${year}_${month}` (upsertGoalRow) is
 * deterministic and member-independent, so both members mint the SAME key
 * without ever seeing each other's create. Running the real engine here proves
 * the patch-branch path is not a unit-fixture artefact.
 */
describe('local echo of a deterministic id drains the parked patch', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-park-echo' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('keeps the peer note when the local member creates the same goal row', async () => {
    const householdId = getLocalLedger().household.id;

    // Peer's PATCH lands first: parked, because the row does not exist yet.
    applyLedgerDelta(
      getLocalLedger(),
      { v: 1, u: { goals: [{ k: 'goal_2026_3', f: { notes: 'rent up' } }] } },
      stampAt(500, 'member-peer', 'op-peer-notes'),
    );
    expect(getLocalLedger().goals.find((g) => g.id === 'goal_2026_3')).toBeUndefined();
    expect(getLocalLedger().lww!.goals!.goal_2026_3!.p).toBeDefined();

    // The mutator writes the row, THEN the op's own `n:1` delta is projected
    // onto a ledger that already holds it — straight into the patch branch.
    await localBudgetApi.setMonthlyGoal(householdId, 2026, 3, { planned_budget: 5_000 });

    const goal = getLocalLedger().goals.find((g) => g.id === 'goal_2026_3')!;
    expect(goal.planned_budget).toBe(5_000);
    expect(goal.notes).toBe('rent up');
    expect(getLocalLedger().lww!.goals!.goal_2026_3!.p).toBeUndefined();
  });
});

/**
 * Restore now merges through `applyLedgerDelta` with an ancient stamp, so a
 * parked patch is drained on the create branch. `drainParkedRows` remains the
 * sweep for any wholesale table write that still bypasses a delta.
 */
describe('drainParkedRows sweeps rows that materialized without a delta', () => {
  it('replays a parked patch onto a row restored wholesale', () => {
    const ledger = emptyLedger();
    applyLedgerDelta(ledger, patchDelta('exp-1', { amount: 7500 }), stampAt(200));
    expect(ledger.expenses).toHaveLength(0);

    // Backup restore: the table is replaced outright, no delta is computed.
    ledger.expenses = [expenseRow('exp-1', { amount: 1000 }) as never];

    expect(drainParkedRows(ledger).applied).toBe(1);
    expect(ledger.expenses[0]).toMatchObject({ amount: 7500 });
    expect(parkedEntries(ledger)).toHaveLength(0);
  });

  it('leaves a parked patch alone while its row is still absent', () => {
    const ledger = emptyLedger();
    applyLedgerDelta(ledger, patchDelta('exp-1', { amount: 7500 }), stampAt(200));

    expect(drainParkedRows(ledger).applied).toBe(0);
    expect(parkedEntries(ledger)).toHaveLength(1);

    // …and the create still replays it, so the sweep did not consume anything.
    applyLedgerDelta(ledger, createDelta('exp-1', { amount: 1000 }), stampAt(100));
    expect(ledger.expenses[0]).toMatchObject({ amount: 7500 });
  });

  it('records the losing parked field as a conflict rather than dropping it', () => {
    const ledger = emptyLedger();
    applyLedgerDelta(
      ledger,
      patchDelta('exp-1', { amount: 7500 }),
      stampAt(100, 'member-peer', 'op-patch'),
    );
    // The restored row already carries a newer stamp for that field.
    ledger.expenses = [expenseRow('exp-1', { amount: 1000 }) as never];
    ledger.lww!.expenses!['exp-1']!.f.amount = '001800000000900-0-devpeer1|member-peer';

    drainParkedRows(ledger);
    expect(ledger.expenses[0]).toMatchObject({ amount: 1000 });
    expect(parkedEntries(ledger)).toHaveLength(0);
    expect(ledger.conflicts).toEqual([
      expect.objectContaining({ id: 'op-patch:expenses:exp-1:amount', kind: 'field_lww' }),
    ]);
  });
});
