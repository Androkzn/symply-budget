/**
 * Joining ADDS a home. It used to replace one.
 *
 * `adoptJoinedHousehold` was written when the engine could hold exactly one
 * property: the joined home took over the running session, and the previous
 * one's rows, sync cursors and index entry were cleared. That is why the Join
 * screen carried a warning headed "This replaces what is on this device" — and
 * why accepting an invite destroyed whatever the member had set up on their own
 * phone, irreversibly.
 *
 * The engine has held a session registry since §7, and every other path into it
 * adds rather than replaces. Joining was the odd one out, and the cost of the
 * inconsistency was somebody's home.
 *
 * These are the properties a screen cannot assert for itself, because they are
 * about what survives on disk rather than about what is rendered.
 */
import {
  abandonHouseEnrolment,
  activateLocalHouseProperty,
  adoptJoinedHousehold,
  createLocalHouseProperty,
  getActiveHouseholdId,
  getLocalHouseLedger,
  getLocalHouseLedgerFor,
  getLocalHouseSession,
  hasLocalHouseProperty,
  isAwaitingHouseEnrolment,
  listLocalHouseProperties,
  mutateLocalHouseLedger,
  openLocalHouseSession,
  renameLocalHouseProperty,
  resetLocalHouseSession,
} from '../engine';
import { newLocalId } from '../ids';

import { taskRow } from './houseLedgerTestKit';

const USER = 'user-join-1';

/** A device with one home of its own, holding one task nobody may destroy. */
async function ownHomeWithATask() {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({ userId: USER, displayName: 'My Own Place' });
  const taskId = newLocalId('task');
  await mutateLocalHouseLedger(
    (draft) => {
      draft.tasks.push(taskRow(taskId, { title: 'Bleed the radiators' }) as never);
    },
    { opType: 'TASK_CREATE', entityType: 'task', entityId: taskId, payload: { title: 'x' } },
  );
  return { own: ledger.household.id, taskId };
}

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('adopting a joined home', () => {
  it('keeps the home this device already had, and everything in it', async () => {
    const { own, taskId } = await ownHomeWithATask();

    await adoptJoinedHousehold({ householdId: 'hh-shared', displayName: 'Maple Street House' });

    expect(listLocalHouseProperties().map((p) => p.householdId).sort()).toEqual(
      ['hh-shared', own].sort(),
    );
    // Not merely listed — still readable. A registry entry over cleared rows
    // would be the same data loss with a longer list.
    const mine = await getLocalHouseLedgerFor(own);
    expect(mine.tasks.map((t) => t.id)).toContain(taskId);
  });

  it('activates the joined home, because that is where the member now is', async () => {
    await ownHomeWithATask();
    await adoptJoinedHousehold({ householdId: 'hh-shared', displayName: 'Maple Street House' });

    expect(getActiveHouseholdId()).toBe('hh-shared');
    expect(getLocalHouseLedger().household.id).toBe('hh-shared');
  });

  it('carries the NAME in, because nothing later can repair it', async () => {
    // The name lives in each device's sealed identity blob and no op type
    // carries a rename, so there is nothing for a peer to merge and nothing on
    // the control plane that fixes it. Dropped here, the joined home reads
    // "Shared home" in the switcher for ever.
    await ownHomeWithATask();
    await adoptJoinedHousehold({ householdId: 'hh-shared', displayName: 'Maple Street House' });

    expect(getLocalHouseLedger().household.name).toBe('Maple Street House');
  });

  it('joins as a MEMBER, not as an owner of somebody else’s home', async () => {
    await ownHomeWithATask();
    await adoptJoinedHousehold({ householdId: 'hh-shared', displayName: 'Maple Street House' });

    expect(getLocalHouseLedger().household.my_role).toBe('member');
  });

  it('waits for keys, and refuses to author ops until they arrive', async () => {
    await ownHomeWithATask();
    await adoptJoinedHousehold({ householdId: 'hh-shared' });

    expect(isAwaitingHouseEnrolment('hh-shared')).toBe(true);
    // The home this device already owned is NOT awaiting anything — enrolment
    // is per property, and blocking writes to the first because of the second
    // would be wrong.
    const own = listLocalHouseProperties().find((p) => p.householdId !== 'hh-shared');
    expect(isAwaitingHouseEnrolment(own!.householdId)).toBe(false);
  });

  it('starts empty, so nothing local is pushed at the peers as if it were theirs', async () => {
    await ownHomeWithATask();
    await adoptJoinedHousehold({ householdId: 'hh-shared' });

    const joined = await getLocalHouseLedgerFor('hh-shared');
    expect(joined.tasks).toHaveLength(0);
    expect(joined.ops).toHaveLength(0);
  });

  it('holds a key of its OWN, never a copy of the home it was adopted beside', async () => {
    // Copying property A's key bytes into property B's sealed identity blob is
    // exactly the cross-property key smear the session registry exists to
    // prevent. Nothing is ever sealed with the throwaway — `awaitingKeys`
    // refuses every write until the real wrap arrives.
    const { own } = await ownHomeWithATask();
    await adoptJoinedHousehold({ householdId: 'hh-shared' });

    const mine = await getLocalHouseSession(own);
    const theirs = await getLocalHouseSession('hh-shared');
    expect(Buffer.from(theirs.householdKeys.hdk)).not.toEqual(
      Buffer.from(mine.householdKeys.hdk),
    );
    expect(theirs.householdKeys.householdId).toBe('hh-shared');
  });

  it('is idempotent — claiming the same invite twice activates rather than duplicating', async () => {
    await ownHomeWithATask();
    await adoptJoinedHousehold({ householdId: 'hh-shared', displayName: 'Maple Street House' });
    const afterFirst = listLocalHouseProperties().length;

    await activateLocalHouseProperty(
      listLocalHouseProperties().find((p) => p.householdId !== 'hh-shared')!.householdId,
    );
    await adoptJoinedHousehold({ householdId: 'hh-shared', displayName: 'Maple Street House' });

    expect(listLocalHouseProperties()).toHaveLength(afterFirst);
    expect(getActiveHouseholdId()).toBe('hh-shared');
  });
});

describe('abandoning a claim that can never be approved', () => {
  it('drops the half-joined home and leaves the member somewhere real', async () => {
    // What a cancelled or expired invite leaves behind is worse than useless: a
    // home whose every request is answered 403, and join controls disabled by
    // the very wait it is stuck in — on the exact screen the member needs in
    // order to claim the replacement invite.
    const { own, taskId } = await ownHomeWithATask();
    await adoptJoinedHousehold({ householdId: 'hh-shared' });

    expect(await abandonHouseEnrolment('hh-shared')).toBe(true);

    expect(hasLocalHouseProperty('hh-shared')).toBe(false);
    expect(getActiveHouseholdId()).toBe(own);
    // …and the home that was never in question is untouched.
    expect((await getLocalHouseLedgerFor(own)).tasks.map((t) => t.id)).toContain(taskId);
  });

  it('refuses a home that is NOT awaiting keys — that one holds real data', async () => {
    const { own } = await ownHomeWithATask();
    await createLocalHouseProperty({ displayName: 'Lakeside Cottage' });

    expect(await abandonHouseEnrolment(own)).toBe(false);
    expect(hasLocalHouseProperty(own)).toBe(true);
  });

  it('refuses the last home, leaving the app stuck rather than empty', async () => {
    await resetLocalHouseSession();
    const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Only Home' });
    expect(await abandonHouseEnrolment(ledger.household.id)).toBe(false);
  });
});

describe('renaming a home', () => {
  it('renames the one NAMED, not whichever happens to be active', async () => {
    // A rename swiped on a background card would otherwise retitle the home the
    // member is looking at.
    const { own } = await ownHomeWithATask();
    const other = await createLocalHouseProperty({ displayName: 'Lakeside Cottage' });
    await activateLocalHouseProperty(own);

    await renameLocalHouseProperty('The Cottage', other.household.id);

    expect((await getLocalHouseLedgerFor(other.household.id)).household.name).toBe('The Cottage');
    expect(getLocalHouseLedger().household.name).toBe('My Own Place');
  });

  it('refuses an empty name rather than leaving a home with none', async () => {
    await ownHomeWithATask();
    await expect(renameLocalHouseProperty('   ')).rejects.toThrow('required');
  });
});
