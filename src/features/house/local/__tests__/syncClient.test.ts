/**
 * H4 wiring contracts.
 *
 * These are the details that are individually trivial and collectively decide
 * whether sync works at all: the header the Worker gates on, the wake type it
 * emits, the URL scheme an invite link has to use, and — new for House — the
 * fact that the engine tells subscribers WHICH tables moved.
 */
import {
  HOUSE_INVITE_LINK_SCHEME,
  buildHouseInviteLink,
  parseInviteInput,
} from '../controlPlaneClient';
import {
  adoptJoinedHousehold,
  closeLocalHouseSession,
  mutateLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
  subscribeToHouseLedgerChanges,
  type HouseLedgerChange,
} from '../engine';
import { newLocalId } from '../ids';
import { HOUSE_SYNC_WAKE_TYPE } from '../pushWake';
import { HOUSE_LEDGER_TABLE_NAMES } from '../schema';

import { taskRow } from './houseLedgerTestKit';

describe('invite links use the brand scheme that actually exists', () => {
  it('builds simplehouse://lf-invite, not symply-house://', () => {
    // `brands/symply-house/brand.cjs` declares `scheme: 'simplehouse'`. A link
    // built on `symply-house://` parses fine and opens nothing.
    expect(HOUSE_INVITE_LINK_SCHEME).toBe('simplehouse');
    const link = buildHouseInviteLink({
      inviteId: 'inv_1',
      shortCode: 'ABC123',
      secret: 'sekret',
    });
    expect(link.startsWith('simplehouse://lf-invite?')).toBe(true);
    expect(link).not.toContain('symply-house://');
  });

  it('round-trips its own link back through the parser', () => {
    const link = buildHouseInviteLink({
      inviteId: 'inv_1',
      shortCode: 'ABC123',
      secret: 'sekret-value',
    });
    expect(parseInviteInput(link)).toEqual({ shortCode: 'ABC123', secret: 'sekret-value' });
  });

  it('accepts what a member might actually paste', () => {
    expect(parseInviteInput('ABC123 sekret')).toEqual({ shortCode: 'ABC123', secret: 'sekret' });
    expect(parseInviteInput('abc123')).toEqual({ shortCode: 'ABC123', secret: null });
    expect(parseInviteInput('  ')).toEqual({ shortCode: null, secret: null });
  });

  it('url-decodes a secret that had to be escaped', () => {
    const link = buildHouseInviteLink({
      inviteId: 'inv_1',
      shortCode: 'ABC123',
      secret: 'a+b/c=d',
    });
    expect(parseInviteInput(link).secret).toBe('a+b/c=d');
  });
});

describe('the wake type is the one H0 taught the Worker', () => {
  it('is house_sync_wake, distinct from Budget’s', () => {
    expect(HOUSE_SYNC_WAKE_TYPE).toBe('house_sync_wake');
    expect(HOUSE_SYNC_WAKE_TYPE).not.toBe('budget_sync_wake');
  });
});

describe('the engine reports WHICH tables changed (§5.2 precondition)', () => {
  const USER = 'user-sync-1';

  afterEach(async () => {
    await resetLocalHouseSession();
  });

  it('reports no tables for a local write — the author already has it', async () => {
    await resetLocalHouseSession();
    await openLocalHouseSession({ userId: USER });

    const changes: HouseLedgerChange[] = [];
    const stop = subscribeToHouseLedgerChanges((change) => changes.push(change));

    const taskId = newLocalId('task');
    await mutateLocalHouseLedger(
      (ledger) => {
        ledger.tasks.push(taskRow(taskId) as never);
      },
      { opType: 'TASK_CREATE', entityType: 'task', entityId: taskId, payload: {} },
    );
    stop();

    // A local echo must NOT invalidate: the writer's UI already rendered it, and
    // firing here would refetch on every keystroke-sized save.
    expect(changes).toHaveLength(0);
  });

  it('reports every table a whole-ledger event touched', async () => {
    await resetLocalHouseSession();
    const ledger = await openLocalHouseSession({ userId: USER });

    const changes: HouseLedgerChange[] = [];
    const stop = subscribeToHouseLedgerChanges((change) => changes.push(change));

    await adoptJoinedHousehold({ householdId: `${ledger.household.id}_joined` });
    stop();

    expect(changes).toHaveLength(1);
    // Adoption empties and rebinds every table, so this is one of the few
    // legitimate whole-ledger invalidations.
    expect(changes[0]!.tables).toContain('tasks');
    expect(changes[0]!.tables).toContain('householdSpaces');
    // Off the registry, not a literal: activating a sub-wave widens the ledger,
    // and a hardcoded count would fail for the one reason that is not a bug.
    // What must hold is that adoption names EVERY live table — a table missing
    // here is one whose screens never refresh after a join.
    expect([...changes[0]!.tables].sort()).toEqual([...HOUSE_LEDGER_TABLE_NAMES].sort());
    expect(changes[0]!.revision).toBeGreaterThan(0);
  });

  it('unsubscribes cleanly', async () => {
    await resetLocalHouseSession();
    await openLocalHouseSession({ userId: USER });
    const changes: HouseLedgerChange[] = [];
    const stop = subscribeToHouseLedgerChanges((change) => changes.push(change));
    stop();

    await adoptJoinedHousehold({ householdId: 'hh_other' });
    expect(changes).toHaveLength(0);
    await closeLocalHouseSession();
  });
});
