/**
 * Two-household-member convergence + conflict resolution (TRD §8.4, BR-044).
 *
 * These run the REAL crypto/op-log path: each member gets its own
 * `MemoryLocalFirstStore` + `OpLog` wired to the same projection handler the
 * engine installs, and ops move between them through `OpLog.applyRemote` —
 * the same call the mailbox and WebRTC transports make. Only the transport is
 * shortcut; sealing, signing, HLC ordering and merge are all production code.
 */
import '../cryptoPolyfill';

import {
  MemoryLocalFirstStore,
  OpLog,
  aeadDecrypt,
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

import { defaultCategories } from '../defaults';
import {
  closeLocalBudgetSession,
  getLocalHouseholdKeys,
  getLocalLedger,
  openLocalBudgetSessionForTests,
  type LocalBudgetLedger,
} from '../engine';
import { localBudgetApi } from '../localBudgetApi';
import {
  applyLedgerDelta,
  captureLedgerSnapshot,
  decodeLedgerOpPayload,
  diffLedger,
  encodeLedgerOpPayload,
} from '../projection';

/** Wall clock the test drives, so two members can write "at the same time". */
class ManualClock implements Clock {
  constructor(private ms: number) {}
  nowMs(): number {
    return this.ms;
  }
  set(ms: number): void {
    this.ms = ms;
  }
}

function emptyLedger(householdId: string, memberId: string, deviceId: string): LocalBudgetLedger {
  return {
    version: 1,
    household: {
      id: householdId,
      name: 'Shared household',
      address_line1: null,
      address_line2: null,
      city: null,
      state_province: null,
      postal_code: null,
      country: 'CA',
      unit_system: null,
      photo_key: null,
      photo_url: null,
      purchase_price: null,
      purchase_date: null,
      created_at: '2026-08-10T00:00:00.000Z',
      updated_at: '2026-08-10T00:00:00.000Z',
      member_count: 2,
      my_role: 'owner',
    },
    memberId,
    deviceId,
    categories: defaultCategories(householdId),
    expenses: [],
    items: [],
    goals: [],
    subBudgets: [],
    transfers: [],
    mortgages: [],
    mortgageTerms: [],
    mortgageStatements: [],
    mortgageEvents: [],
    mortgageOffers: [],
    savingsIncome: [],
    savingsSpending: [],
    savingsRecurringPayments: [],
    savingsGoals: [],
    savingsCategories: [],
    savingsIncomeTemplates: [],
    savingsMonthlyTargets: [],
    budgetLoans: [],
    budgetRenewals: [],
    registeredAccounts: [],
    registeredTransactions: [],
    wishes: [],
    wishEntries: [],
    wishAttachments: [],
    ops: [],
    lww: {},
    conflicts: [],
  };
}

type Member = {
  memberId: string;
  identity: DeviceIdentity;
  store: MemoryLocalFirstStore;
  opLog: OpLog;
  ledger: LocalBudgetLedger;
  clock: ManualClock;
  /** Ops this member authored or accepted, in append order. */
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

  // Mirrors `ledgerProjection` in engine.ts.
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

  return { memberId, identity, store, opLog, ledger, clock, outbox: [] };
}

/** Mirrors `mutateLocalLedger` in engine.ts: mutate, diff, seal the delta. */
async function commit(
  member: Member,
  mutator: (ledger: LocalBudgetLedger) => void,
  op: { opType: string; entityType: string; entityId: string; payload?: unknown },
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
    plaintextPayload: utf8Encode(JSON.stringify(encodeLedgerOpPayload(op.payload ?? {}, delta))),
  });
  member.outbox.push(stored);
  return stored;
}

/** Deliver ops to a peer exactly as the mailbox engine does. */
async function deliver(ops: StoredOperation[], from: Member, to: Member): Promise<number> {
  let applied = 0;
  for (const op of ops) {
    const result = await to.opLog.applyRemote(op, from.identity.signingPublicKey);
    if (result.status === 'applied') applied += 1;
  }
  return applied;
}

function expenseRow(householdId: string, id: string, title: string, amount: number) {
  return {
    id,
    household_id: householdId,
    title,
    description: null,
    amount,
    expense_date: '2026-08-10',
    category_id: null,
    saved_amount: 0,
    tax_amount: 0,
    created_by: 'test',
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
  } as unknown as LocalBudgetLedger['expenses'][number];
}

describe('budget local-first multi-member sync', () => {
  let householdKeys: HouseholdKeys;
  let alice: Member;
  let bob: Member;

  beforeEach(async () => {
    householdKeys = generateHouseholdKeys('hh_shared_test', 1);
    alice = await createMember('member-alice', 'dev-alice', householdKeys, 1_800_000_000_000);
    bob = await createMember('member-bob', 'dev-bob', householdKeys, 1_800_000_000_000);
  });

  it("projects a member's new spending onto the other member's ledger", async () => {
    const householdId = householdKeys.householdId;
    await commit(
      alice,
      (ledger) => {
        ledger.expenses.push(expenseRow(householdId, 'exp-1', 'Groceries', 4200));
      },
      { opType: 'EXPENSE_CREATE', entityType: 'expense', entityId: 'exp-1' },
    );

    expect(bob.ledger.expenses).toHaveLength(0);
    const applied = await deliver(alice.outbox, alice, bob);

    expect(applied).toBe(1);
    expect(bob.ledger.expenses).toHaveLength(1);
    expect(bob.ledger.expenses[0]).toMatchObject({ id: 'exp-1', title: 'Groceries', amount: 4200 });
  });

  it('propagates changes in both directions', async () => {
    const householdId = householdKeys.householdId;
    await commit(
      alice,
      (ledger) => {
        ledger.expenses.push(expenseRow(householdId, 'exp-a', 'Alice coffee', 500));
      },
      { opType: 'EXPENSE_CREATE', entityType: 'expense', entityId: 'exp-a' },
    );
    await deliver(alice.outbox, alice, bob);

    await commit(
      bob,
      (ledger) => {
        ledger.expenses.push(expenseRow(householdId, 'exp-b', 'Bob transit', 275));
      },
      { opType: 'EXPENSE_CREATE', entityType: 'expense', entityId: 'exp-b' },
    );
    await deliver(bob.outbox, bob, alice);

    const titles = (member: Member) => member.ledger.expenses.map((e) => e.title).sort();
    expect(titles(alice)).toEqual(['Alice coffee', 'Bob transit']);
    expect(titles(bob)).toEqual(['Alice coffee', 'Bob transit']);
  });

  it('keeps both edits when members change different fields of the same row', async () => {
    const householdId = householdKeys.householdId;
    await commit(
      alice,
      (ledger) => {
        ledger.expenses.push(expenseRow(householdId, 'exp-1', 'Dinner', 6000));
      },
      { opType: 'EXPENSE_CREATE', entityType: 'expense', entityId: 'exp-1' },
    );
    await deliver(alice.outbox, alice, bob);
    alice.outbox.length = 0;

    // Same wall clock on both devices — genuinely concurrent writes.
    alice.clock.set(1_800_000_100_000);
    bob.clock.set(1_800_000_100_000);
    await commit(
      alice,
      (ledger) => {
        ledger.expenses[0]!.title = 'Dinner out';
      },
      { opType: 'EXPENSE_UPDATE', entityType: 'expense', entityId: 'exp-1' },
    );
    await commit(
      bob,
      (ledger) => {
        ledger.expenses[0]!.amount = 7500;
      },
      { opType: 'EXPENSE_UPDATE', entityType: 'expense', entityId: 'exp-1' },
    );

    await deliver(alice.outbox, alice, bob);
    await deliver(bob.outbox.slice(-1), bob, alice);

    for (const member of [alice, bob]) {
      expect(member.ledger.expenses[0]).toMatchObject({ title: 'Dinner out', amount: 7500 });
    }
    expect(alice.ledger.conflicts ?? []).toHaveLength(0);
    expect(bob.ledger.conflicts ?? []).toHaveLength(0);
  });

  it('resolves same-field edits deterministically and records the discarded one', async () => {
    const householdId = householdKeys.householdId;
    await commit(
      alice,
      (ledger) => {
        ledger.expenses.push(expenseRow(householdId, 'exp-1', 'Dinner', 6000));
      },
      { opType: 'EXPENSE_CREATE', entityType: 'expense', entityId: 'exp-1' },
    );
    await deliver(alice.outbox, alice, bob);
    alice.outbox.length = 0;

    alice.clock.set(1_800_000_100_000);
    bob.clock.set(1_800_000_100_000);
    await commit(
      alice,
      (ledger) => {
        ledger.expenses[0]!.amount = 6500;
      },
      { opType: 'EXPENSE_UPDATE', entityType: 'expense', entityId: 'exp-1' },
    );
    await commit(
      bob,
      (ledger) => {
        ledger.expenses[0]!.amount = 9900;
      },
      { opType: 'EXPENSE_UPDATE', entityType: 'expense', entityId: 'exp-1' },
    );

    await deliver(alice.outbox, alice, bob);
    await deliver(bob.outbox.slice(-1), bob, alice);

    // Whoever wins, BOTH replicas must land on the same value.
    expect(alice.ledger.expenses[0]!.amount).toBe(bob.ledger.expenses[0]!.amount);
    expect([6500, 9900]).toContain(alice.ledger.expenses[0]!.amount);

    // The replica that discarded a write says so (BR-044).
    const conflicts = [...(alice.ledger.conflicts ?? []), ...(bob.ledger.conflicts ?? [])];
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'field_lww', field: 'amount', rowKey: 'exp-1' });
  });

  it('converges on delete when one member deletes and the other edits', async () => {
    const householdId = householdKeys.householdId;
    await commit(
      alice,
      (ledger) => {
        ledger.expenses.push(expenseRow(householdId, 'exp-1', 'Dinner', 6000));
      },
      { opType: 'EXPENSE_CREATE', entityType: 'expense', entityId: 'exp-1' },
    );
    await deliver(alice.outbox, alice, bob);
    alice.outbox.length = 0;

    alice.clock.set(1_800_000_100_000);
    bob.clock.set(1_800_000_100_000);
    await commit(
      alice,
      (ledger) => {
        ledger.expenses = ledger.expenses.filter((e) => e.id !== 'exp-1');
      },
      { opType: 'EXPENSE_DELETE', entityType: 'expense', entityId: 'exp-1' },
    );
    await commit(
      bob,
      (ledger) => {
        ledger.expenses[0]!.title = 'Dinner (split)';
      },
      { opType: 'EXPENSE_UPDATE', entityType: 'expense', entityId: 'exp-1' },
    );

    await deliver(alice.outbox, alice, bob);
    await deliver(bob.outbox.slice(-1), bob, alice);

    expect(alice.ledger.expenses).toHaveLength(0);
    expect(bob.ledger.expenses).toHaveLength(0);
    const conflicts = [...(alice.ledger.conflicts ?? []), ...(bob.ledger.conflicts ?? [])];
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    expect(conflicts.every((c) => c.kind === 'edit_vs_delete')).toBe(true);
  });

  it('keeps both rows when members create different entities concurrently', async () => {
    const householdId = householdKeys.householdId;
    await commit(
      alice,
      (ledger) => {
        ledger.expenses.push(expenseRow(householdId, 'exp-a', 'Alice', 100));
      },
      { opType: 'EXPENSE_CREATE', entityType: 'expense', entityId: 'exp-a' },
    );
    await commit(
      bob,
      (ledger) => {
        ledger.expenses.push(expenseRow(householdId, 'exp-b', 'Bob', 200));
      },
      { opType: 'EXPENSE_CREATE', entityType: 'expense', entityId: 'exp-b' },
    );

    await deliver(alice.outbox, alice, bob);
    await deliver(bob.outbox, bob, alice);

    expect(alice.ledger.expenses).toHaveLength(2);
    expect(bob.ledger.expenses).toHaveLength(2);
  });

  it('is idempotent when the same op is delivered twice', async () => {
    const householdId = householdKeys.householdId;
    await commit(
      alice,
      (ledger) => {
        ledger.expenses.push(expenseRow(householdId, 'exp-1', 'Once', 999));
      },
      { opType: 'EXPENSE_CREATE', entityType: 'expense', entityId: 'exp-1' },
    );

    expect(await deliver(alice.outbox, alice, bob)).toBe(1);
    expect(await deliver(alice.outbox, alice, bob)).toBe(0);
    expect(bob.ledger.expenses).toHaveLength(1);
  });
});

describe('engine mutations carry a projectable delta', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-delta-1' });
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('emits the changed rows for a real localBudgetApi write', async () => {
    const householdId = getLocalLedger().household.id;
    const { expense } = await localBudgetApi.addExpense(householdId, {
      title: 'Delta check',
      amount: 1234,
      expense_date: '2026-08-10',
    });

    const ops = getLocalLedger().ops;
    const stored = ops[ops.length - 1]!;
    expect(stored.opType).toBe('EXPENSE_CREATE');

    // Open the sealed payload exactly as a peer's OpLog does, so this asserts
    // what actually goes on the wire rather than a re-derived copy.
    const keys = getLocalHouseholdKeys();
    const plaintext = aeadDecrypt(
      keys.hdk,
      stored.payload,
      utf8Encode(`${stored.householdId}:${stored.keyEpoch}:${stored.opId}`),
    );
    const delta = decodeLedgerOpPayload(JSON.parse(utf8Decode(plaintext)));
    expect(delta).not.toBeNull();
    expect(delta!.u?.expenses?.[0]).toMatchObject({ k: expense.id, n: 1 });

    // And that delta alone must rebuild the row on a member who has never
    // seen this household's data.
    const peer = emptyLedger(householdId, 'peer', 'dev-peer');
    applyLedgerDelta(peer, delta!, {
      hlc: stored.hlc,
      authorMemberId: stored.authorMemberId,
      opId: stored.opId,
    });
    expect(peer.expenses).toHaveLength(1);
    expect(peer.expenses[0]).toMatchObject({ id: expense.id, title: 'Delta check', amount: 1234 });
  });
});
