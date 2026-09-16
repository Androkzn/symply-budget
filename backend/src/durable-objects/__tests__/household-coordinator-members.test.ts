import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Member administration — the rules only the coordinator can enforce, because
 * it alone holds the membership state they are about.
 *
 * Until this existed a household was a one-way door: an owner could let someone
 * in and could revoke a DEVICE, but could not end a membership. Revoking
 * devices one by one did not amount to it — the membership row stayed active,
 * so the person could enrol a fresh device and walk back in.
 *
 * Exercised against the real object rather than through the routes, for the
 * same reason as `household-coordinator.test.ts`: the route-level suites
 * replace this with a fake, and a fake that answered these questions would only
 * be testing itself.
 */

const HOUSEHOLD_ID = 'hh_members';
const OWNER = 'u_owner';
const MEMBER = 'u_member';

type Coordinator = { fetch: (request: Request) => Promise<Response> };

let instanceSeq = 0;
function makeCoordinator(): Coordinator {
  instanceSeq += 1;
  // `cloudflare:test` types `env` from the worker's own bindings, which do not
  // include this Durable Object namespace — it is declared per-environment in
  // wrangler.toml and reaches the test runtime without reaching the type.
  const binding = (env as unknown as { HOUSEHOLD_COORDINATOR: DurableObjectNamespace })
    .HOUSEHOLD_COORDINATOR;
  return binding.get(binding.idFromName(`${HOUSEHOLD_ID}-${instanceSeq}`)) as Coordinator;
}

function post(coordinator: Coordinator, path: string, body: unknown): Promise<Response> {
  return coordinator.fetch(
    new Request(`http://do${path}`, { method: 'POST', body: JSON.stringify(body) }),
  );
}

type State = {
  keyEpoch: number;
  securityRevision: number;
  members: Array<{ userId: string; role: string; status: string }>;
  devices: Array<{ deviceId: string; userId: string; status: string }>;
};

/** An owner, a plain member, and a device each. */
async function seedHousehold(coordinator: Coordinator): Promise<void> {
  await post(coordinator, '/bootstrap', {
    householdId: HOUSEHOLD_ID,
    ownerUserId: OWNER,
    device: {
      deviceId: 'dev_owner',
      userId: OWNER,
      signingPublicKey: `sign-${'o'.repeat(40)}`,
      agreementPublicKey: `agree-${'o'.repeat(40)}`,
    },
  });

  const invite = {
    inviteId: 'inv_member',
    shortCode: 'MEM123',
    secretHash: 'hash',
    role: 'ADULT' as const,
    createdByUserId: OWNER,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
  await post(coordinator, '/invites', invite);
  await post(coordinator, '/invites/claim', {
    inviteId: invite.inviteId,
    secretHash: 'hash',
    userId: MEMBER,
    deviceId: 'dev_member',
    signingPublicKey: `sign-${'m'.repeat(40)}`,
    agreementPublicKey: `agree-${'m'.repeat(40)}`,
  });
  await post(coordinator, '/invites/approve', {
    inviteId: invite.inviteId,
    actorUserId: OWNER,
    confirmedSigningPublicKey: `sign-${'m'.repeat(40)}`,
    confirmedAgreementPublicKey: `agree-${'m'.repeat(40)}`,
  });
}

describe('POST /members — role changes', () => {
  it('promotes a member to owner without touching the household key', async () => {
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);
    const before = (await (await coordinator.fetch(new Request('http://do/state'))).json()) as State;

    const res = await post(coordinator, '/members', {
      userId: MEMBER,
      role: 'OWNER',
      actorUserId: OWNER,
    });

    expect(res.status).toBe(200);
    const state = (await res.json()) as State;
    expect(state.members.find((m) => m.userId === MEMBER)).toMatchObject({
      role: 'OWNER',
      status: 'active',
    });
    // A role is a permission, not key material. Rotating on it would lock every
    // peer out of the household to record a promotion.
    expect(state.keyEpoch).toBe(before.keyEpoch);
    expect(state.devices.every((d) => d.status === 'active')).toBe(true);
  });

  it('demotes an owner back to member', async () => {
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);
    await post(coordinator, '/members', { userId: MEMBER, role: 'OWNER', actorUserId: OWNER });

    const res = await post(coordinator, '/members', {
      userId: MEMBER,
      role: 'ADULT',
      actorUserId: OWNER,
    });

    const state = (await res.json()) as State;
    expect(state.members.find((m) => m.userId === MEMBER)).toMatchObject({ role: 'ADULT' });
  });

  it('keeps the role on record when only a status is sent', async () => {
    // Removal names a status and must not have to restate a role it is not
    // changing — restating it from a stale client read is how a demotion rides
    // along with a removal.
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);
    await post(coordinator, '/members', { userId: MEMBER, role: 'OWNER', actorUserId: OWNER });

    const res = await post(coordinator, '/members', {
      userId: MEMBER,
      status: 'revoked',
      actorUserId: OWNER,
    });

    const state = (await res.json()) as State;
    expect(state.members.find((m) => m.userId === MEMBER)).toMatchObject({
      role: 'OWNER',
      status: 'revoked',
    });
  });
});

describe('POST /members — removal', () => {
  it('ends the membership, deletes every device they hold, and rotates the key', async () => {
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);
    const before = (await (await coordinator.fetch(new Request('http://do/state'))).json()) as State;

    const res = await post(coordinator, '/members', {
      userId: MEMBER,
      status: 'revoked',
      actorUserId: OWNER,
    });

    expect(res.status).toBe(200);
    const state = (await res.json()) as State;
    expect(state.members.find((m) => m.userId === MEMBER)).toMatchObject({ status: 'revoked' });
    // The devices go with the person — revoking them one at a time leaves the
    // membership standing, which is the hole this closes — and they go
    // entirely, not as revoked rows. A revoked row is the memory of a device
    // whose owner stayed; once they are gone it keeps their hardware, labels
    // and enrolment dates on the household's record forever, and it keeps
    // `deviceBelongsToUser` (which matches the row, not its status) answering
    // yes for a phone that belongs to nobody here.
    expect(state.devices.some((d) => d.userId === MEMBER)).toBe(false);
    expect(state.devices.find((d) => d.userId === OWNER)).toMatchObject({ status: 'active' });
    // …and the epoch bump is what makes everything written from now on
    // unreadable to the keys they already hold.
    expect(state.keyEpoch).toBe(before.keyEpoch + 1);
  });

  it('refuses to remove somebody who is already out', async () => {
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);
    await post(coordinator, '/members', { userId: MEMBER, status: 'revoked', actorUserId: OWNER });

    const res = await post(coordinator, '/members', {
      userId: MEMBER,
      status: 'revoked',
      actorUserId: OWNER,
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'member_not_found' });
  });

  it('never adds a member — a membership is only ever created by an approval', async () => {
    // A handler that would happily push `{userId, role: 'OWNER'}` is a way into
    // a household that bypasses the six-digit comparison entirely.
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);

    const res = await post(coordinator, '/members', {
      userId: 'u_stranger',
      role: 'OWNER',
      actorUserId: OWNER,
    });

    expect(res.status).toBe(404);
    const state = (await (await coordinator.fetch(new Request('http://do/state'))).json()) as State;
    expect(state.members.some((m) => m.userId === 'u_stranger')).toBe(false);
  });
});

describe('POST /members — who may', () => {
  it('is owner-only', async () => {
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);

    const res = await post(coordinator, '/members', {
      userId: OWNER,
      status: 'revoked',
      actorUserId: MEMBER,
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('refuses the actor their own membership — this is what keeps an owner', async () => {
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);

    for (const body of [
      { userId: OWNER, status: 'revoked', actorUserId: OWNER },
      { userId: OWNER, role: 'ADULT', actorUserId: OWNER },
    ]) {
      const res = await post(coordinator, '/members', body);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'cannot_change_own_membership' });
    }

    const state = (await (await coordinator.fetch(new Request('http://do/state'))).json()) as State;
    expect(state.members.find((m) => m.userId === OWNER)).toMatchObject({
      role: 'OWNER',
      status: 'active',
    });
  });

  it('lets one owner remove another — the self-rule is not a rule about owners', async () => {
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);
    await post(coordinator, '/members', { userId: MEMBER, role: 'OWNER', actorUserId: OWNER });

    const res = await post(coordinator, '/members', {
      userId: MEMBER,
      status: 'revoked',
      actorUserId: OWNER,
    });

    expect(res.status).toBe(200);
    const state = (await res.json()) as State;
    // One owner still standing: the actor. That is the invariant, and it holds
    // without counting anything, because the actor is an active owner and is
    // never the target.
    expect(state.members.filter((m) => m.role === 'OWNER' && m.status === 'active')).toHaveLength(1);
  });
});

/**
 * Leaving is the door `/members` refuses to be.
 *
 * That handler rejects any actor acting on their own membership, which is what
 * keeps a household's last owner in place — so before this existed, the only
 * way out of a household was to ask its owner to remove you, and a member who
 * deleted their local copy stayed on the roster with every device they held
 * still listed as trusted.
 *
 * The invariant survives here as its own rule: an owner may not leave while
 * somebody else is still in the household and no other owner is.
 */
describe('POST /members/leave', () => {
  const state = async (coordinator: Coordinator): Promise<State> =>
    (await (await coordinator.fetch(new Request('http://do/state'))).json()) as State;

  it('ends the membership, deletes their devices, and rotates the key', async () => {
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);
    const before = await state(coordinator);

    const res = await post(coordinator, '/members/leave', { actorUserId: MEMBER });

    expect(res.status).toBe(200);
    const after = (await res.json()) as State;
    expect(after.members.find((m) => m.userId === MEMBER)).toMatchObject({ status: 'revoked' });
    // Exactly what a removal leaves behind. A household where "left" and
    // "was removed" leave different residue is one where the trusted-device
    // list means two different things depending on how somebody went.
    expect(after.devices.some((d) => d.userId === MEMBER)).toBe(false);
    expect(after.devices.find((d) => d.userId === OWNER)).toMatchObject({ status: 'active' });
    expect(after.keyEpoch).toBe(before.keyEpoch + 1);
  });

  it('lets an owner leave once somebody else owns it too', async () => {
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);
    await post(coordinator, '/members', { userId: MEMBER, role: 'OWNER', actorUserId: OWNER });

    const res = await post(coordinator, '/members/leave', { actorUserId: OWNER });

    expect(res.status).toBe(200);
    const after = (await res.json()) as State;
    expect(after.members.find((m) => m.userId === OWNER)).toMatchObject({ status: 'revoked' });
    expect(after.members.filter((m) => m.role === 'OWNER' && m.status === 'active')).toHaveLength(1);
  });

  /**
   * The refusal that matters. A household left with members and no owner can
   * never invite anybody, approve a device or remove anyone — a budget nobody
   * can administer, with no way back short of support.
   */
  it('refuses the last owner while anybody else is still in the household', async () => {
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);

    const res = await post(coordinator, '/members/leave', { actorUserId: OWNER });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'last_owner_cannot_leave' });
    const after = await state(coordinator);
    expect(after.members.find((m) => m.userId === OWNER)).toMatchObject({ status: 'active' });
    expect(after.devices.some((d) => d.userId === OWNER)).toBe(true);
  });

  /** Nobody left to strand — and trapping them would create the very debris this avoids. */
  it('lets the last person leave, owner or not', async () => {
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);
    await post(coordinator, '/members/leave', { actorUserId: MEMBER });

    const res = await post(coordinator, '/members/leave', { actorUserId: OWNER });

    expect(res.status).toBe(200);
    const after = (await res.json()) as State;
    expect(after.members.every((m) => m.status === 'revoked')).toBe(true);
    expect(after.devices).toHaveLength(0);
  });

  /**
   * Not a 403: the caller is asking about their own membership, so there is
   * nothing to withhold — and a client that has just been removed needs to hear
   * "already out" to finish cleaning up locally.
   */
  it('tells somebody already out that they are already out', async () => {
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);
    await post(coordinator, '/members', { userId: MEMBER, status: 'revoked', actorUserId: OWNER });

    const res = await post(coordinator, '/members/leave', { actorUserId: MEMBER });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'member_not_found' });
  });

  it('does not let a stranger leave a household they were never in', async () => {
    const coordinator = makeCoordinator();
    await seedHousehold(coordinator);

    const res = await post(coordinator, '/members/leave', { actorUserId: 'u_stranger' });

    expect(res.status).toBe(404);
    const after = await state(coordinator);
    expect(after.members.filter((m) => m.status === 'active')).toHaveLength(2);
  });
});
