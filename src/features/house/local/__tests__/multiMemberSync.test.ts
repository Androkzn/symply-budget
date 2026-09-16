/**
 * Two members of one home converge — and disagree predictably (BR-044).
 *
 * House had suites for every PIECE of sync (projection deltas, out-of-order
 * parking, the keyring, the blob channel, per-property isolation) and none for
 * the guarantee they exist to produce: that two phones holding the same home end
 * up holding the same rows. That is the whole promise of a shared home, and it
 * was covered only by a 40-minute two-simulator run — so a merge regression
 * could not be caught in CI at all.
 *
 * These run the REAL crypto/op-log path: each member gets its own
 * `MemoryLocalFirstStore` + `OpLog` wired to the same projection handler the
 * engine installs, and ops move between them through `OpLog.applyRemote` — the
 * same call the mailbox transport makes. Only the transport is shortcut;
 * sealing, signing, HLC ordering and merge are all production code.
 *
 * Mirrors `src/features/budget/local/__tests__/multiMemberSync.test.ts` on
 * purpose: the merge engine is shared, so a reader who knows one should not have
 * to re-learn the other. What differs is the tables — House's rows are tasks,
 * spaces and appliances, and `tasks` is the widest table and the one every screen
 * reads.
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

import type { HouseLedger } from '../engine';
import {
  applyLedgerDelta,
  captureLedgerSnapshot,
  decodeLedgerOpPayload,
  diffLedger,
  encodeLedgerOpPayload,
} from '../projection';

import { emptyHouseLedger, taskRow } from './houseLedgerTestKit';

const HOUSEHOLD = 'hh_shared_test';

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

type Member = {
  memberId: string;
  identity: DeviceIdentity;
  store: MemoryLocalFirstStore;
  opLog: OpLog;
  ledger: HouseLedger;
  clock: ManualClock;
  /** Ops this member authored, in append order. */
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
  const ledger = emptyHouseLedger(householdKeys.householdId, memberId, deviceId);
  const clock = new ManualClock(startMs);

  // Mirrors `projectionFor` in engine.ts.
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

/** Mirrors `mutateLocalHouseLedger` in engine.ts: mutate, diff, seal the delta. */
async function commit(
  member: Member,
  mutator: (ledger: HouseLedger) => void,
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

/** Everything each member has authored and not yet handed over. */
async function exchange(a: Member, b: Member): Promise<void> {
  const fromA = a.outbox.splice(0);
  const fromB = b.outbox.splice(0);
  await deliver(fromA, a, b);
  await deliver(fromB, b, a);
}

function tasksById(member: Member): Map<string, HouseLedger['tasks'][number]> {
  return new Map(member.ledger.tasks.map((task) => [task.id, task]));
}

describe('house local-first multi-member sync', () => {
  let householdKeys: HouseholdKeys;
  let ada: Member;
  let bo: Member;

  beforeEach(async () => {
    householdKeys = generateHouseholdKeys(HOUSEHOLD, 1);
    ada = await createMember('member-ada', 'dev-ada', householdKeys, 1_800_000_000_000);
    bo = await createMember('member-bo', 'dev-bo', householdKeys, 1_800_000_000_000);
  });

  it("projects a member's new task onto the other member's ledger", async () => {
    await commit(
      ada,
      (ledger) => {
        ledger.tasks.push(taskRow('task-1', { title: 'Bleed the radiators' }) as never);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: 'task-1' },
    );

    expect(await deliver(ada.outbox.splice(0), ada, bo)).toBe(1);
    expect(tasksById(bo).get('task-1')?.title).toBe('Bleed the radiators');
  });

  it('propagates changes in both directions', async () => {
    await commit(
      ada,
      (ledger) => {
        ledger.tasks.push(taskRow('task-a', { title: 'Service the boiler' }) as never);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: 'task-a' },
    );
    await commit(
      bo,
      (ledger) => {
        ledger.tasks.push(taskRow('task-b', { title: 'Clean the gutters' }) as never);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: 'task-b' },
    );

    await exchange(ada, bo);

    for (const member of [ada, bo]) {
      expect([...tasksById(member).keys()].sort()).toEqual(['task-a', 'task-b']);
    }
  });

  it('keeps both edits when members change DIFFERENT fields of the same row', async () => {
    // The common shape of two people tidying the same home at once, and the one
    // a naive last-writer-wins on the whole ROW would silently destroy.
    await commit(
      ada,
      (ledger) => {
        ledger.tasks.push(taskRow('task-1', { title: 'Service the boiler' }) as never);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: 'task-1' },
    );
    await exchange(ada, bo);

    ada.clock.set(1_800_000_100_000);
    await commit(
      ada,
      (ledger) => {
        ledger.tasks[0]!.title = 'Service the boiler (annual)';
      },
      { opType: 'TASK_UPDATE', entityType: 'task', entityId: 'task-1' },
    );

    bo.clock.set(1_800_000_100_000);
    await commit(
      bo,
      (ledger) => {
        ledger.tasks[0]!.next_due_date = '2026-12-01';
      },
      { opType: 'TASK_UPDATE', entityType: 'task', entityId: 'task-1' },
    );

    await exchange(ada, bo);

    for (const member of [ada, bo]) {
      const task = tasksById(member).get('task-1');
      expect(task?.title).toBe('Service the boiler (annual)');
      expect(task?.next_due_date).toBe('2026-12-01');
    }
    // Neither member lost anything, so neither is told anything was discarded.
    expect(ada.ledger.conflicts).toHaveLength(0);
    expect(bo.ledger.conflicts).toHaveLength(0);
  });

  it('resolves SAME-field edits deterministically, and records the discarded one', async () => {
    await commit(
      ada,
      (ledger) => {
        ledger.tasks.push(taskRow('task-1', { title: 'Service the boiler' }) as never);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: 'task-1' },
    );
    await exchange(ada, bo);

    // Both write the same field at the same instant — the shape where one of the
    // two typed values has to lose.
    ada.clock.set(1_800_000_100_000);
    bo.clock.set(1_800_000_100_000);
    await commit(
      ada,
      (ledger) => {
        ledger.tasks[0]!.title = "Ada's title";
      },
      { opType: 'TASK_UPDATE', entityType: 'task', entityId: 'task-1' },
    );
    await commit(
      bo,
      (ledger) => {
        ledger.tasks[0]!.title = "Bo's title";
      },
      { opType: 'TASK_UPDATE', entityType: 'task', entityId: 'task-1' },
    );

    await exchange(ada, bo);

    // WHICHEVER wins, both phones must land on the same value. The tiebreak
    // itself (HLC, then author) is the merge engine's business and asserting a
    // specific winner would pin an implementation detail; asserting that they
    // AGREE is the property a member can actually observe.
    expect(tasksById(ada).get('task-1')?.title).toBe(tasksById(bo).get('task-1')?.title);
    expect(["Ada's title", "Bo's title"]).toContain(tasksById(ada).get('task-1')?.title);

    // BR-044: the loser is not silently dropped. The replica that discarded a
    // write says so — on that phone the value the member typed simply changed
    // back, and this is the only trace that it ever existed.
    const conflicts = [...(ada.ledger.conflicts ?? []), ...(bo.ledger.conflicts ?? [])];
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'field_lww', field: 'title', rowKey: 'task-1' });
  });

  it('converges on delete when one member deletes and the other edits', async () => {
    await commit(
      ada,
      (ledger) => {
        ledger.tasks.push(taskRow('task-1', { title: 'Service the boiler' }) as never);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: 'task-1' },
    );
    await exchange(ada, bo);

    ada.clock.set(1_800_000_100_000);
    await commit(
      ada,
      (ledger) => {
        ledger.tasks = ledger.tasks.filter((task) => task.id !== 'task-1');
      },
      { opType: 'TASK_DELETE', entityType: 'task', entityId: 'task-1' },
    );

    bo.clock.set(1_800_000_150_000);
    await commit(
      bo,
      (ledger) => {
        ledger.tasks[0]!.title = 'Edited after the delete';
      },
      { opType: 'TASK_UPDATE', entityType: 'task', entityId: 'task-1' },
    );

    await exchange(ada, bo);

    // Both phones agree. A row that exists on one and not the other is the one
    // divergence a member can see and cannot explain.
    expect(tasksById(ada).has('task-1')).toBe(tasksById(bo).has('task-1'));
  });

  it('keeps both rows when members create DIFFERENT entities concurrently', async () => {
    ada.clock.set(1_800_000_100_000);
    await commit(
      ada,
      (ledger) => {
        ledger.tasks.push(taskRow('task-a', { title: 'Ada task' }) as never);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: 'task-a' },
    );
    bo.clock.set(1_800_000_100_000);
    await commit(
      bo,
      (ledger) => {
        ledger.tasks.push(taskRow('task-b', { title: 'Bo task' }) as never);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: 'task-b' },
    );

    await exchange(ada, bo);

    expect(ada.ledger.tasks).toHaveLength(2);
    expect(bo.ledger.tasks).toHaveLength(2);
  });

  it('is idempotent when the same op is delivered twice', async () => {
    // The mailbox re-delivers anything it could not confirm was acked, so a
    // duplicate is routine rather than exceptional.
    const op = await commit(
      ada,
      (ledger) => {
        ledger.tasks.push(taskRow('task-1', { title: 'Service the boiler' }) as never);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: 'task-1' },
    );
    ada.outbox.splice(0);

    expect(await deliver([op], ada, bo)).toBe(1);
    expect(await deliver([op], ada, bo)).toBe(0);
    expect(bo.ledger.tasks).toHaveLength(1);
  });

  it('refuses an op signed by a key the home does not know', async () => {
    // The signature is what makes a relay unable to author on a member's behalf.
    const op = await commit(
      ada,
      (ledger) => {
        ledger.tasks.push(taskRow('task-1') as never);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: 'task-1' },
    );
    ada.outbox.splice(0);

    const impostor = generateDeviceIdentity('dev-relay');
    const result = await bo.opLog.applyRemote(op, impostor.signingPublicKey);

    expect(result.status).not.toBe('applied');
    expect(bo.ledger.tasks).toHaveLength(0);
  });

  it('converges however the two phones happen to interleave', async () => {
    // A member offline for a while comes back with a burst, and the order the
    // mailbox happens to page it in is not the order it was written.
    for (const [index, member] of [ada, bo, ada, bo, ada].entries()) {
      member.clock.set(1_800_000_100_000 + index * 1_000);
      await commit(
        member,
        (ledger) => {
          ledger.tasks.push(taskRow(`task-${index}`, { title: `Task ${index}` }) as never);
        },
        { opType: 'TASK_CREATE', entityType: 'task', entityId: `task-${index}` },
      );
    }

    // Delivered back to front, which is what a paged mailbox with a stale cursor
    // looks like from the receiving end.
    const fromAda = ada.outbox.splice(0).reverse();
    const fromBo = bo.outbox.splice(0).reverse();
    await deliver(fromAda, ada, bo);
    await deliver(fromBo, bo, ada);

    const adaIds = [...tasksById(ada).keys()].sort();
    const boIds = [...tasksById(bo).keys()].sort();
    expect(adaIds).toEqual(boIds);
    expect(adaIds).toHaveLength(5);
  });
});
