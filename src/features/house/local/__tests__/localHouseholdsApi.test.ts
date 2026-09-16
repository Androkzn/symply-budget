/**
 * H3 — `householdsApi` against a real in-memory session.
 *
 * Three properties of this facade are worth a test and nothing else here is:
 *
 *  1. **A property's domain fields land in the LEDGER row**, not on the control
 *     plane and not only in the local binding (plan §1.5 hazard S5). The proof is
 *     that they survive a close/reopen — which reads them back out of the
 *     encrypted row store — and that they carry LWW stamps, i.e. they will
 *     converge on a peer rather than sit in a device-local cache.
 *  2. **Listing reads the H5 session manager**, so a landlord sees three homes
 *     and an edit addressed at a background property cannot land in the one on
 *     screen.
 *  3. **Every legacy invite method throws** with copy that names the replacement
 *     flow (§5.1, Q14) — a silent fallthrough to the server is the failure mode
 *     the coverage rule exists to prevent.
 *
 * Static imports only: `await import()` throws under this Jest config
 * (plan §6.2), and every network-touching method is left untested here on
 * purpose — those belong to the two-device E2E (H12).
 */
import { householdsApi } from '@api/households';

import {
  activateLocalHouseProperty,
  closeLocalHouseSession,
  createLocalHouseProperty,
  getActiveHouseholdId,
  getLocalHouseLedgerFor,
  listLocalHouseProperties,
  mutateLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { HouseLocalUnsupportedError } from '../errors';
import { parityGap } from '../localApiProxy';
import {
  activateHouseProperty,
  getActiveHousePropertyId,
  listHouseProperties,
  localHouseholdsApi,
} from '../localHouseholdsApi';
import { toLedgeredHousehold } from '../types';

const USER = 'user-house-props';

async function oneProperty() {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Maple Grove' });
  return ledger.household.id;
}

async function twoProperties() {
  const a = await oneProperty();
  const second = await createLocalHouseProperty({ displayName: 'Lakeside Cottage' });
  await activateLocalHouseProperty(a);
  return { a, b: second.household.id };
}

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('property fields live in the ledger (plan §1.5 hazard S5)', () => {
  it('writes address, unit system and purchase details to the ledgered households row', async () => {
    const householdId = await oneProperty();

    const { household } = await localHouseholdsApi.update(householdId, {
      address_line1: '14 Maple Grove',
      city: 'Victoria',
      state_province: 'BC',
      postal_code: 'V8W 1A1',
      country: 'CA',
      unit_system: 'metric',
      purchase_price: 84_500_000,
      purchase_date: '2021-06-30',
    });

    expect(household.address_line1).toBe('14 Maple Grove');
    expect(household.unit_system).toBe('metric');
    expect(household.purchase_price).toBe(84_500_000);

    // The row — not the binding — is what syncs. `lf_households` on the control
    // plane never sees any of this.
    const ledger = await getLocalHouseLedgerFor(householdId);
    const row = ledger.households.find((candidate) => candidate.id === householdId)!;
    expect(row.address_line1).toBe('14 Maple Grove');
    expect(row.postal_code).toBe('V8W 1A1');
    expect(row.purchase_date).toBe('2021-06-30');
  });

  it('stamps the edit under per-field LWW so a peer converges on it', async () => {
    const householdId = await oneProperty();
    await localHouseholdsApi.update(householdId, { city: 'Nanaimo' });

    const ledger = await getLocalHouseLedgerFor(householdId);
    // A stamp exists only for fields that went through the projection. A write
    // that only touched the in-memory binding would leave this undefined.
    expect(ledger.lww?.households?.[householdId]?.f?.city).toBeDefined();
  });

  it('survives a close and reopen — the fields are in the encrypted row store', async () => {
    const householdId = await oneProperty();
    await localHouseholdsApi.update(householdId, {
      address_line1: '9 Ledger Lane',
      unit_system: 'imperial',
    });

    await closeLocalHouseSession();
    await openLocalHouseSession({ userId: USER });

    const { household } = await localHouseholdsApi.get(householdId);
    expect(household.address_line1).toBe('9 Ledger Lane');
    expect(household.unit_system).toBe('imperial');
  });

  it('clears a field on null and leaves an absent field alone', async () => {
    const householdId = await oneProperty();
    await localHouseholdsApi.update(householdId, {
      address_line1: '9 Ledger Lane',
      city: 'Victoria',
    });

    // `undefined` is "not sent" and `null` clears — collapsing the two would
    // wipe the address on every partial save from a form that omits it.
    await localHouseholdsApi.update(householdId, { city: null });

    const { household } = await localHouseholdsApi.get(householdId);
    expect(household.city).toBeNull();
    expect(household.address_line1).toBe('9 Ledger Lane');
  });

  it('renames the property everywhere the switcher reads it', async () => {
    const householdId = await oneProperty();
    await localHouseholdsApi.update(householdId, { name: 'Maple Grove (rented)' });

    const { households } = await localHouseholdsApi.list();
    expect(households[0]!.name).toBe('Maple Grove (rented)');
    // The binding is a cache of the row; the switcher reads it without hydrating,
    // so a rename that updated only the row would show the old name there.
    expect(listHouseProperties()[0]!.name).toBe('Maple Grove (rented)');
  });

  it('clears the photo pointer, and its stale signed URL with it', async () => {
    const householdId = await oneProperty();
    await localHouseholdsApi.update(householdId, { photo_key: 'households/abc.jpg' });

    await localHouseholdsApi.deletePhoto(householdId);

    const { household } = await localHouseholdsApi.get(householdId);
    expect(household.photo_key).toBeNull();
    expect(household.photo_url).toBeNull();
  });
});

describe('multi-property reads come from the H5 session manager (plan §7)', () => {
  it('lists every property this device holds, with each one’s own fields', async () => {
    const { a, b } = await twoProperties();
    await localHouseholdsApi.update(a, { address_line1: '14 Maple Grove' });
    await localHouseholdsApi.update(b, { address_line1: '2 Lakeside Road' });

    const { households } = await localHouseholdsApi.list();
    expect(households).toHaveLength(2);
    const byId = new Map(households.map((household) => [household.id, household]));
    expect(byId.get(a)!.address_line1).toBe('14 Maple Grove');
    expect(byId.get(b)!.address_line1).toBe('2 Lakeside Road');
  });

  it('writes an edit into the property it names, never the active one', async () => {
    const { a, b } = await twoProperties();
    await activateLocalHouseProperty(a);

    await localHouseholdsApi.update(b, { city: 'Tofino' });

    const ledgerA = await getLocalHouseLedgerFor(a);
    const ledgerB = await getLocalHouseLedgerFor(b);
    expect(ledgerB.households.find((row) => row.id === b)!.city).toBe('Tofino');
    // The write path binds to the ACTIVE session, so addressing another property
    // has to move the session. Landing in A would be silent cross-home corruption.
    expect(ledgerA.households.find((row) => row.id === a)!.city).toBeNull();
  });

  it('creates a property with its domain fields and leaves the first intact', async () => {
    const first = await oneProperty();

    const { household } = await localHouseholdsApi.create({
      name: 'Lakeside Cottage',
      address_line1: '2 Lakeside Road',
      unit_system: 'imperial',
    });

    expect(household.name).toBe('Lakeside Cottage');
    expect(household.address_line1).toBe('2 Lakeside Road');
    expect(household.unit_system).toBe('imperial');
    expect(listLocalHouseProperties()).toHaveLength(2);
    const original = await getLocalHouseLedgerFor(first);
    expect(original.households.find((row) => row.id === first)!.address_line1).toBeNull();
  });

  it('delegates activation to the session manager', async () => {
    const { a, b } = await twoProperties();
    const activated = await activateHouseProperty(b);

    expect(activated.id).toBe(b);
    expect(getActiveHousePropertyId()).toBe(b);
    expect(getActiveHouseholdId()).toBe(b);
    expect(a).not.toBe(b);
  });

  it('deletes one property and refuses to delete the only home', async () => {
    const { a, b } = await twoProperties();
    await localHouseholdsApi.delete(b);
    expect(listLocalHouseProperties().map((property) => property.householdId)).toEqual([a]);

    // The engine has no "no property" state, so this is copy a member can act on
    // rather than an assertion failure.
    await expect(localHouseholdsApi.delete(a)).rejects.toThrow(/only home/i);
  });

  it('returns the member list, including this device’s own account', async () => {
    const householdId = await oneProperty();
    const { members } = await localHouseholdsApi.get(householdId);

    // Wave A writes no membership rows; a members screen that lists nobody —
    // not even you — reads as data loss rather than as an empty table.
    expect(members).toHaveLength(1);
    expect(members[0]!.user_id).toBe(USER);
    expect(members[0]!.role).toBe('owner');
  });

  it('keeps per-viewer fields off the ledgered row entirely', () => {
    // The original bug: a minted ledger held ONE object in both `household` and
    // `households[0]`, and the projection merges peer fields into a row in
    // place — so a peer's `my_role` wrote straight through into this device's
    // answer, handing a member the owner's controls.
    //
    // The fix is structural, not defensive: `LedgeredHousehold` omits
    // `my_role`, `member_count` and `photo_url`, so they cannot enter a delta
    // because they are not on the row. This asserts the shape rather than
    // simulating the attack, because the attack no longer type-checks.
    const sample = toLedgeredHousehold({
      id: 'hh_x',
      name: 'X',
      my_role: 'owner',
      member_count: 4,
      photo_url: 'https://signed.example/expires-soon',
    } as never);
    expect('my_role' in sample).toBe(false);
    expect('member_count' in sample).toBe(false);
    expect('photo_url' in sample).toBe(false);
    expect(sample.id).toBe('hh_x');
  });

  it('answers my_role from this device while property fields still converge', async () => {
    const householdId = await oneProperty();
    await localHouseholdsApi.update(householdId, { city: 'Victoria' });

    // A peer edits a real property fact. That SHOULD converge — it is the same
    // home, and one shared answer is the correct one.
    await mutateLocalHouseLedger(
      (draft) => {
        draft.households.find((row) => row.id === householdId)!.city = 'Peer City';
      },
      { opType: 'HOUSEHOLD_UPDATE', entityType: 'household', entityId: householdId, payload: {} },
    );

    const { household } = await localHouseholdsApi.get(householdId);
    expect(household.city).toBe('Peer City');
    // …while the per-viewer answer stays this device's.
    expect(household.my_role).toBe('owner');
  });

  it('refuses to leave a home you are the only owner of', async () => {
    const householdId = await oneProperty();
    // Same rule the Worker enforces on POST /households/:id/leave — the local
    // answer must not be more permissive than the remote one.
    await expect(localHouseholdsApi.leave(householdId)).rejects.toThrow(/only owner/i);
  });
});

describe('the legacy invite model is replaced, not run alongside (plan §5.1, Q14)', () => {
  /**
   * A member who joined by email invite has no device keypair and can decrypt
   * nothing, so each of these must fail loudly with copy that names the new flow.
   * They take no parameters: the Proxy hands them whatever the screen passed and
   * JavaScript discards it, so no call site changes just to receive the error.
   */
  const replaced: Array<[string, () => Promise<unknown>, RegExp]> = [
    ['invite', () => localHouseholdsApi.invite(), /invite code/i],
    ['getInvitations', () => localHouseholdsApi.getInvitations(), /invite/i],
    ['cancelInvitation', () => localHouseholdsApi.cancelInvitation(), /expires/i],
    ['validateInvitation', () => localHouseholdsApi.validateInvitation(), /new invite code/i],
    ['acceptInvitation', () => localHouseholdsApi.acceptInvitation(), /new invite code/i],
    ['acceptInvitationInApp', () => localHouseholdsApi.acceptInvitationInApp(), /three-word/i],
    ['declineInvitationInApp', () => localHouseholdsApi.declineInvitationInApp(), /expires/i],
    ['searchUsers', () => localHouseholdsApi.searchUsers(), /invite code/i],
    ['approveJoinRequest', () => localHouseholdsApi.approveJoinRequest(), /three-word/i],
    ['denyJoinRequest', () => localHouseholdsApi.denyJoinRequest(), /expires/i],
    ['updateMemberRole', () => localHouseholdsApi.updateMemberRole(), /invite/i],
    // `uploadPhoto` used to be here on copy that said photos "sync in a later
    // update". H6 had already shipped; it now seals the picture through the blob
    // channel like every other attachment, and its coverage is in
    // `houseHomePhoto.test.ts`.
  ];

  it.each(replaced)('%s throws with member-facing copy', async (_name, call, copy) => {
    await expect(call()).rejects.toThrow(HouseLocalUnsupportedError);
    await expect(call()).rejects.toThrow(copy);
  });

  it('keeps the shared error identity so handlers keep matching on it', async () => {
    // The copy is per method; `name` and `code` are not, because `app.onError`,
    // the sync status card and the screens all key on those.
    const error = await localHouseholdsApi.invite().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(HouseLocalUnsupportedError);
    expect((error as HouseLocalUnsupportedError).name).toBe('HouseLocalUnsupportedError');
    expect((error as HouseLocalUnsupportedError).code).toBe('house_local_unsupported');
    // Not the generic "not available offline yet" sentence — this one is replaced.
    expect((error as Error).message).not.toMatch(/not available offline yet/i);
  });

  it('rejects an invite code that is missing its secret', async () => {
    await expect(localHouseholdsApi.requestToJoin('ABC123')).rejects.toThrow(
      HouseLocalUnsupportedError,
    );
    await expect(localHouseholdsApi.requestToJoin('ABC123')).rejects.toThrow(/whole link/i);
  });

  it('reports no pending joins for a device that has not claimed an invite', async () => {
    await oneProperty();
    // Answered from the session registry, not the network: the "waiting for
    // approval" banner has to render on a plane.
    await expect(localHouseholdsApi.getMyJoinRequests()).resolves.toEqual({ requests: [] });
  });
});

describe('coverage rule (plan §6)', () => {
  it('implements every remote method and adds none of its own', () => {
    const gap = parityGap(householdsApi, localHouseholdsApi);
    // Every gap in this module is a THROWN error, never a missing key: a missing
    // key routes the call to a server that holds no rows for this household.
    expect(gap.missingLocally).toEqual([]);
    // The House-only surface (property switching, OOB approval) is exported by
    // name instead — the Proxy is typed `typeof householdsApi`, so a method that
    // is not on the remote module could never be called through it anyway.
    expect(gap.extraLocally).toEqual([]);
    expect(typeof listHouseProperties).toBe('function');
    expect(typeof getActiveHousePropertyId).toBe('function');
    expect(typeof activateHouseProperty).toBe('function');
  });
});
