/**
 * H5 — multi-property session manager (plan §7 verification).
 *
 * The failure modes this guards are all silent. Nothing crashes when two
 * properties share a ledger, an HDK or a checkpoint watermark; the data just
 * ends up in the wrong home, or one property's compaction truncates what
 * another still needs. Each `it` below is one of the plan's four verification
 * bullets, plus the invariants that make them meaningful.
 */
import {
  activateLocalHouseProperty,
  compactLocalHouseLogIfSafe,
  closeLocalHouseSession,
  createLocalHouseProperty,
  getActiveHouseholdId,
  getLocalHouseLedger,
  getLocalHouseLedgerFor,
  getLocalHouseSession,
  listLocalHouseProperties,
  mutateLocalHouseLedger,
  openLocalHouseSession,
  rememberPublishedHouseCheckpoint,
  removeLocalHouseProperty,
  resetLocalHouseSession,
  subscribeToHouseLedgerChanges,
  type HouseLedgerChange,
} from '../engine';
import { newLocalId } from '../ids';

import { taskRow } from './houseLedgerTestKit';

const USER = 'user-multi-1';

async function twoProperties() {
  await resetLocalHouseSession();
  const first = await openLocalHouseSession({ userId: USER, displayName: 'Maple Grove' });
  const second = await createLocalHouseProperty({ displayName: 'Lakeside Cottage' });
  return { a: first.household.id, b: second.household.id };
}

async function addTask(householdId: string, title: string): Promise<string> {
  await activateLocalHouseProperty(householdId);
  const id = newLocalId('task');
  await mutateLocalHouseLedger(
    (ledger) => {
      ledger.tasks.push(taskRow(id, { title, household_id: householdId }) as never);
    },
    { opType: 'TASK_CREATE', entityType: 'task', entityId: id, payload: { title } },
  );
  return id;
}

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('the registry holds several properties at once', () => {
  it('opens a second property without closing the first', async () => {
    const { a, b } = await twoProperties();
    const properties = listLocalHouseProperties();
    expect(properties.map((p) => p.householdId).sort()).toEqual([a, b].sort());
    expect(a).not.toBe(b);
  });

  it('reuses ONE device identity across properties', async () => {
    // One device, one keypair, registered per property on the control plane.
    // A per-property device id would make each property think the others are
    // different devices and fan out mailbox deposits to phantom peers.
    const { a, b } = await twoProperties();
    const sessionA = await getLocalHouseSession(a);
    const sessionB = await getLocalHouseSession(b);
    expect(sessionA.identity.deviceId).toBe(sessionB.identity.deviceId);
    expect(sessionA.ledger.deviceId).toBe(sessionB.ledger.deviceId);
  });

  it('gives each property its OWN household key', async () => {
    // Each property is its own membership with its own key epoch. Sharing an
    // HDK would let a revoked member of one property read the other.
    const { a, b } = await twoProperties();
    const sessionA = await getLocalHouseSession(a);
    const sessionB = await getLocalHouseSession(b);
    expect(sessionA.householdKeys.householdId).toBe(a);
    expect(sessionB.householdKeys.householdId).toBe(b);
    expect(Array.from(sessionA.householdKeys.hdk)).not.toEqual(
      Array.from(sessionB.householdKeys.hdk),
    );
  });

  it('seeds each property independently', async () => {
    const { a, b } = await twoProperties();
    const ledgerA = await getLocalHouseLedgerFor(a);
    const ledgerB = await getLocalHouseLedgerFor(b);
    expect(ledgerA.householdSpaces.length).toBeGreaterThan(0);
    expect(ledgerB.householdSpaces.length).toBeGreaterThan(0);
    // Deterministic ids are per household, so the two seeds must NOT collide.
    expect(ledgerA.householdSpaces[0]!.id).not.toBe(ledgerB.householdSpaces[0]!.id);
  });
});

describe('write to A, activate B, write to B, reactivate A', () => {
  it('keeps both ledgers intact with no cross-property row bleed', async () => {
    const { a, b } = await twoProperties();

    const taskA = await addTask(a, 'Clean the gutters at Maple Grove');
    const taskB = await addTask(b, 'Winterize the cottage');

    const ledgerA = await getLocalHouseLedgerFor(a);
    const ledgerB = await getLocalHouseLedgerFor(b);

    expect(ledgerA.tasks.map((t) => t.id)).toEqual([taskA]);
    expect(ledgerB.tasks.map((t) => t.id)).toEqual([taskB]);
    expect(ledgerA.tasks[0]!.title).toContain('Maple Grove');
    expect(ledgerB.tasks[0]!.title).toContain('cottage');
  });

  it('attributes each op to the right household', async () => {
    const { a, b } = await twoProperties();
    await addTask(a, 'A');
    await addTask(b, 'B');

    const sessionA = await getLocalHouseSession(a);
    const sessionB = await getLocalHouseSession(b);
    for (const op of sessionA.ledger.ops) expect(op.householdId).toBe(a);
    for (const op of sessionB.ledger.ops) expect(op.householdId).toBe(b);
  });

  it('survives reactivating the first property', async () => {
    const { a, b } = await twoProperties();
    const taskA = await addTask(a, 'first');
    await activateLocalHouseProperty(b);
    await activateLocalHouseProperty(a);

    expect(getActiveHouseholdId()).toBe(a);
    expect(getLocalHouseLedger().tasks.map((t) => t.id)).toEqual([taskA]);
  });

  it('keeps rows apart across a full close and reopen', async () => {
    const { a, b } = await twoProperties();
    const taskA = await addTask(a, 'persisted A');
    const taskB = await addTask(b, 'persisted B');

    await closeLocalHouseSession();
    await openLocalHouseSession({ userId: USER });

    expect(listLocalHouseProperties()).toHaveLength(2);
    const ledgerA = await getLocalHouseLedgerFor(a);
    const ledgerB = await getLocalHouseLedgerFor(b);
    expect(ledgerA.tasks.map((t) => t.id)).toEqual([taskA]);
    expect(ledgerB.tasks.map((t) => t.id)).toEqual([taskB]);
  });
});

describe('lazy hydration (plan §7 rule 3)', () => {
  it('hydrates only the property the member is looking at', async () => {
    const { a, b } = await twoProperties();
    await addTask(a, 'A');
    await addTask(b, 'B');
    await closeLocalHouseSession();

    await openLocalHouseSession({ userId: USER });
    const summaries = listLocalHouseProperties();
    const hydrated = summaries.filter((property) => property.hydrated);

    // Exactly one — the active one. H10 measured cold open at 34–37 µs/row, so
    // hydrating all three properties of a landlord on launch would cost three
    // times over for data two of which nobody is looking at.
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0]!.householdId).toBe(getActiveHouseholdId());
  });

  it('hydrates the other property on demand, once', async () => {
    const { a, b } = await twoProperties();
    await addTask(b, 'B');
    await closeLocalHouseSession();
    await openLocalHouseSession({ userId: USER });

    const cold = listLocalHouseProperties().find((p) => p.householdId === b)!;
    if (!cold.hydrated) {
      const ledger = await getLocalHouseLedgerFor(b);
      expect(ledger.tasks).toHaveLength(1);
    }
    expect(listLocalHouseProperties().find((p) => p.householdId === b)!.hydrated).toBe(true);
    // Idempotent: asking again neither re-reads nor duplicates rows.
    const again = await getLocalHouseLedgerFor(b);
    expect(again.tasks).toHaveLength(1);
    expect(a).not.toBe(b);
  });
});

describe('property removal is scoped', () => {
  it('clears one property’s rows and leaves the other untouched', async () => {
    const { a, b } = await twoProperties();
    const taskA = await addTask(a, 'stays');
    await addTask(b, 'goes');

    await activateLocalHouseProperty(a);
    await removeLocalHouseProperty(b);

    expect(listLocalHouseProperties().map((p) => p.householdId)).toEqual([a]);
    const ledgerA = await getLocalHouseLedgerFor(a);
    expect(ledgerA.tasks.map((t) => t.id)).toEqual([taskA]);
  });

  it('refuses to remove the last property', async () => {
    await resetLocalHouseSession();
    const only = await openLocalHouseSession({ userId: USER });
    await expect(removeLocalHouseProperty(only.household.id)).rejects.toThrow(
      /cannot remove the last property/,
    );
  });

  it('activates a survivor when the ACTIVE property is removed', async () => {
    const { a, b } = await twoProperties();
    await activateLocalHouseProperty(b);
    await removeLocalHouseProperty(b);
    expect(getActiveHouseholdId()).toBe(a);
    expect(listLocalHouseProperties()).toHaveLength(1);
  });
});

describe('change notifications carry the property', () => {
  it('names which property moved, so a background sync cannot repaint the screen', async () => {
    const { a, b } = await twoProperties();
    const changes: HouseLedgerChange[] = [];
    const stop = subscribeToHouseLedgerChanges((change) => changes.push(change));

    await activateLocalHouseProperty(b);
    stop();

    expect(changes).toHaveLength(1);
    expect(changes[0]!.householdId).toBe(b);
    expect(changes[0]!.householdId).not.toBe(a);
  });
});

describe('checkpoint watermarks are per property', () => {
  it('does not let one property’s watermark govern another’s compaction', async () => {
    const { a, b } = await twoProperties();
    const sessionA = await getLocalHouseSession(a);
    const vvA = await sessionA.store.getVersionVector(a);
    await rememberPublishedHouseCheckpoint(vvA, a);

    // B has published nothing, so B must refuse to compact — a shared watermark
    // key would have handed it A's and truncated a log nobody has a checkpoint for.
    await expect(compactLocalHouseLogIfSafe(b)).resolves.toBe(0);
  });
});
