import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The coordinator is the security authority for enrolment, and the checks that
 * matter are the ones no other tier can make: it alone holds the claim on record.
 *
 * Exercised against the real object rather than through the routes, because the
 * route-level suites replace this with a fake — a fake that answered these
 * questions would only be testing itself.
 */

const HOUSEHOLD_ID = 'hh_1';
const OWNER = 'u_owner';
const JOINER = 'u_joiner';
const OWNER_DEVICE = 'dev_owner';
const JOINER_DEVICE = 'dev_joiner';

const CLAIM_SIGNING_KEY = `sign-${'a'.repeat(40)}`;
const CLAIM_AGREEMENT_KEY = `agree-${'b'.repeat(40)}`;
/** What a control plane substituting its own key would look like. */
const ATTACKER_AGREEMENT_KEY = `agree-${'f'.repeat(40)}`;

const INVITE_ID = 'inv_1';

/**
 * A fresh coordinator instance, addressed by a unique name per test so state
 * from one case cannot leak into the next.
 */
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

/** A household with an owner, an active invite, and that invite claimed. */
async function seedClaimedInvite(
  coordinator: Coordinator,
  overrides?: { agreementPublicKey?: string },
): Promise<void> {
  await post(coordinator, '/bootstrap', {
    householdId: HOUSEHOLD_ID,
    ownerUserId: OWNER,
    device: {
      deviceId: OWNER_DEVICE,
      userId: OWNER,
      signingPublicKey: `sign-${'o'.repeat(40)}`,
      agreementPublicKey: `agree-${'o'.repeat(40)}`,
    },
  });

  await post(coordinator, '/invites', {
    inviteId: INVITE_ID,
    shortCode: 'AB12CD',
    secretHash: 'hash',
    role: 'ADULT',
    createdByUserId: OWNER,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });

  await post(coordinator, '/invites/claim', {
    inviteId: INVITE_ID,
    secretHash: 'hash',
    userId: JOINER,
    deviceId: JOINER_DEVICE,
    signingPublicKey: CLAIM_SIGNING_KEY,
    agreementPublicKey: overrides?.agreementPublicKey ?? CLAIM_AGREEMENT_KEY,
  });
}

function approveBody(overrides?: Partial<Record<string, string>>) {
  return {
    inviteId: INVITE_ID,
    actorUserId: OWNER,
    confirmedSigningPublicKey: CLAIM_SIGNING_KEY,
    confirmedAgreementPublicKey: CLAIM_AGREEMENT_KEY,
    ...overrides,
  };
}

describe('approving an enrolment', () => {
  let coordinator: Coordinator;

  beforeEach(async () => {
    coordinator = makeCoordinator();
    await seedClaimedInvite(coordinator);
  });

  it('admits the device whose keys the owner confirmed', async () => {
    const res = await post(coordinator, '/invites/approve', approveBody());
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      approved: { userId: string; deviceId: string; agreementPublicKey: string };
    };
    expect(body.approved).toEqual({
      userId: JOINER,
      deviceId: JOINER_DEVICE,
      agreementPublicKey: CLAIM_AGREEMENT_KEY,
    });
  });

  /**
   * The case the whole change exists for. If the two people compared digits for
   * one key and the approval names another, the enrolment on record is not the
   * one anybody looked at — so it must not proceed.
   */
  it('refuses an approval naming an agreement key other than the claimed one', async () => {
    const res = await post(
      coordinator,
      '/invites/approve',
      approveBody({ confirmedAgreementPublicKey: ATTACKER_AGREEMENT_KEY }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'claim_changed' });
  });

  it('refuses an approval naming a different signing key', async () => {
    const res = await post(
      coordinator,
      '/invites/approve',
      approveBody({ confirmedSigningPublicKey: `sign-${'z'.repeat(40)}` }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'claim_changed' });
  });

  it('leaves the invite claimable after a refusal, rather than burning it', async () => {
    await post(
      coordinator,
      '/invites/approve',
      approveBody({ confirmedAgreementPublicKey: ATTACKER_AGREEMENT_KEY }),
    );

    // The owner reloads, compares afresh, and approves for real.
    const retry = await post(coordinator, '/invites/approve', approveBody());
    expect(retry.status).toBe(200);
  });

  it('admits nobody when the approval is refused', async () => {
    await post(
      coordinator,
      '/invites/approve',
      approveBody({ confirmedAgreementPublicKey: ATTACKER_AGREEMENT_KEY }),
    );

    const state = await coordinator.fetch(new Request('http://do/state'));
    const body = (await state.json()) as {
      members: Array<{ userId: string }>;
      devices: Array<{ deviceId: string }>;
    };
    expect(body.members.map((m) => m.userId)).toEqual([OWNER]);
    expect(body.devices.map((d) => d.deviceId)).toEqual([OWNER_DEVICE]);
  });

  it('compares keys by value, not by case', async () => {
    const res = await post(
      coordinator,
      '/invites/approve',
      approveBody({ confirmedAgreementPublicKey: CLAIM_AGREEMENT_KEY.toUpperCase() }),
    );

    expect(res.status).toBe(200);
  });

  it('still requires an owner, whatever keys are named', async () => {
    const res = await post(
      coordinator,
      '/invites/approve',
      approveBody({ actorUserId: JOINER }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });
});

/**
 * Revocation is the other half of enrolment, and it has two distinct subjects:
 * cutting off SOMEONE ELSE (a trust decision about another person, owner-only)
 * and cutting off YOUR OWN phone (removing a key holder you already control).
 *
 * Requiring OWNER for both stranded members: a member whose phone was lost or
 * replaced had no way to revoke it, so their stale device kept household keys
 * until the owner noticed. These cases pin the split.
 */
describe('revoking a device', () => {
  let coordinator: Coordinator;

  /** Owner + joiner, both enrolled with an active device each. */
  beforeEach(async () => {
    coordinator = makeCoordinator();
    await seedClaimedInvite(coordinator);
    await post(coordinator, '/invites/approve', approveBody());
  });

  function revoke(actorUserId: string, deviceId: string) {
    return post(coordinator, '/devices/revoke', { actorUserId, deviceId });
  }

  async function deviceStatus(res: Response, deviceId: string): Promise<string | undefined> {
    const state = (await res.json()) as { devices: { deviceId: string; status: string }[] };
    return state.devices.find((d) => d.deviceId === deviceId)?.status;
  }

  it('lets the owner revoke another member’s device', async () => {
    const res = await revoke(OWNER, JOINER_DEVICE);

    expect(res.status).toBe(200);
    expect(await deviceStatus(res, JOINER_DEVICE)).toBe('revoked');
  });

  it('lets a member revoke their OWN device', async () => {
    const res = await revoke(JOINER, JOINER_DEVICE);

    expect(res.status).toBe(200);
    expect(await deviceStatus(res, JOINER_DEVICE)).toBe('revoked');
  });

  it('refuses a member revoking someone else’s device', async () => {
    const res = await revoke(JOINER, OWNER_DEVICE);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  /**
   * A revoked device must not keep reading what it was removed from, so a
   * self-revoke has to rotate the household keys exactly as an owner revoke
   * does — the epoch bump is the point, not a side effect of who asked.
   */
  it('rotates the key epoch on a self-revoke, exactly as on an owner revoke', async () => {
    const res = await revoke(JOINER, JOINER_DEVICE);
    const state = (await res.json()) as { keyEpoch: number; securityRevision: number };

    expect(state.keyEpoch).toBeGreaterThan(0);
    expect(state.securityRevision).toBeGreaterThan(0);
  });

  /** Membership is checked before existence, so a stranger learns nothing. */
  it('tells a non-member nothing about which devices exist', async () => {
    const res = await revoke('u_stranger', 'dev_does_not_exist');

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('404s the owner on a device that is not there', async () => {
    const res = await revoke(OWNER, 'dev_does_not_exist');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'device_not_found' });
  });
});

/**
 * Revoking folds a device away and keeps the row forever, which is right for an
 * audit and wrong as a permanent state: replaced phones pile up until the list
 * of devices that still hold the budget is the minority of it.
 *
 * Forgetting deletes the row — and must never become a quieter second way to
 * evict a live device, which is the one path that has to rotate keys. These
 * cases pin both halves: it deletes, and it refuses anything still active.
 */
describe('forgetting a revoked device', () => {
  let coordinator: Coordinator;

  beforeEach(async () => {
    coordinator = makeCoordinator();
    await seedClaimedInvite(coordinator);
    await post(coordinator, '/invites/approve', approveBody());
  });

  function forget(actorUserId: string, deviceId: string) {
    return post(coordinator, '/devices/forget', { actorUserId, deviceId });
  }

  async function state(): Promise<{
    devices: Array<{ deviceId: string }>;
    keyEpoch: number;
  }> {
    const res = await coordinator.fetch(new Request('http://do/state'));
    return (await res.json()) as { devices: Array<{ deviceId: string }>; keyEpoch: number };
  }

  it('lets the owner delete a revoked row', async () => {
    await post(coordinator, '/devices/revoke', { actorUserId: OWNER, deviceId: JOINER_DEVICE });

    const res = await forget(OWNER, JOINER_DEVICE);

    expect(res.status).toBe(200);
    expect((await state()).devices.map((d) => d.deviceId)).toEqual([OWNER_DEVICE]);
  });

  /** The member who cut off their own lost phone gets to finish the job. */
  it('lets a member delete their OWN revoked row', async () => {
    await post(coordinator, '/devices/revoke', { actorUserId: JOINER, deviceId: JOINER_DEVICE });

    const res = await forget(JOINER, JOINER_DEVICE);

    expect(res.status).toBe(200);
    expect((await state()).devices.some((d) => d.deviceId === JOINER_DEVICE)).toBe(false);
  });

  it('refuses a member deleting someone else’s row', async () => {
    await post(coordinator, '/devices/revoke', { actorUserId: OWNER, deviceId: OWNER_DEVICE });

    const res = await forget(JOINER, OWNER_DEVICE);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  /**
   * The one that matters: a device with access must be revoked — key rotation
   * and all — before its record can go. Deleting it here would drop a live key
   * holder out of the list the household polices access with.
   */
  it('refuses a device that still has access', async () => {
    const res = await forget(OWNER, JOINER_DEVICE);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'device_not_revoked' });
    expect((await state()).devices.some((d) => d.deviceId === JOINER_DEVICE)).toBe(true);
  });

  /**
   * Bookkeeping, not a security act. The epoch moved when the device was
   * revoked; moving it again would put every remaining peer through a rewrap to
   * record a deletion from a list.
   */
  it('does not rotate the key epoch', async () => {
    await post(coordinator, '/devices/revoke', { actorUserId: OWNER, deviceId: JOINER_DEVICE });
    const before = (await state()).keyEpoch;

    await forget(OWNER, JOINER_DEVICE);

    expect((await state()).keyEpoch).toBe(before);
  });

  /** Membership before existence, so a stranger still learns nothing. */
  it('tells a non-member nothing about which devices exist', async () => {
    const res = await forget('u_stranger', JOINER_DEVICE);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('404s the owner on a device that is not there', async () => {
    const res = await forget(OWNER, 'dev_does_not_exist');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'device_not_found' });
  });
});

/**
 * A device record used to carry no evidence of life — `status` stayed 'active'
 * from enrolment until somebody revoked it. Members were shown wiped and
 * abandoned phones labelled "Active" beside ones syncing every few seconds,
 * with nothing in the data to tell them apart.
 */
describe('device liveness', () => {
  let coordinator: Coordinator;

  beforeEach(async () => {
    coordinator = makeCoordinator();
    await seedClaimedInvite(coordinator);
    await post(coordinator, '/invites/approve', approveBody());
  });

  async function devices(): Promise<Array<{ deviceId: string; lastSeenAt?: string | null }>> {
    const res = await coordinator.fetch(new Request('http://do/state'));
    const state = (await res.json()) as {
      devices: Array<{ deviceId: string; lastSeenAt?: string | null }>;
    };
    return state.devices;
  }

  it('stamps a device that reports in', async () => {
    const res = await post(coordinator, '/devices/seen', { deviceId: JOINER_DEVICE });
    expect(await res.json()).toEqual({ ok: true, stamped: true });

    const stamped = (await devices()).find((d) => d.deviceId === JOINER_DEVICE);
    expect(stamped?.lastSeenAt).toBeTruthy();
  });

  /**
   * The poll runs every few seconds per device. Writing on each one would be
   * thousands of DO writes an hour to record a fact needed at day resolution.
   */
  it('does not write again inside the throttle window', async () => {
    await post(coordinator, '/devices/seen', { deviceId: JOINER_DEVICE });
    const first = (await devices()).find((d) => d.deviceId === JOINER_DEVICE)?.lastSeenAt;

    const second = await post(coordinator, '/devices/seen', { deviceId: JOINER_DEVICE });
    expect(await second.json()).toEqual({ ok: true, stamped: false });

    const after = (await devices()).find((d) => d.deviceId === JOINER_DEVICE)?.lastSeenAt;
    expect(after).toBe(first);
  });

  /** Liveness rides on the sync poll; it must never turn a working sync into an error. */
  it('is a no-op for an unknown device rather than an error', async () => {
    const res = await post(coordinator, '/devices/seen', { deviceId: 'dev_never_enrolled' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stamped: false });
  });

  it('refuses to mark a revoked device as alive', async () => {
    await post(coordinator, '/devices/revoke', { actorUserId: OWNER, deviceId: JOINER_DEVICE });

    const res = await post(coordinator, '/devices/seen', { deviceId: JOINER_DEVICE });
    expect(await res.json()).toEqual({ ok: true, stamped: false });
    expect((await devices()).find((d) => d.deviceId === JOINER_DEVICE)?.lastSeenAt).toBeFalsy();
  });
});

/**
 * A claim is not the end of enrolment — it starts a wait on the OWNER, who has
 * to open the app, read six digits off the claimant's screen and tap approve.
 *
 * Accepting a claim on an invite that is about to run out produced the worst
 * outcome available: the invite expired seconds later, and the claiming device
 * was left holding a household it could never be approved into and could not
 * leave. Observed on staging 2026-08-19 — claimed 37s before expiry.
 */
describe('claiming an invite close to its expiry', () => {
  let coordinator: Coordinator;

  async function seedInvite(expiresInMs: number): Promise<void> {
    await post(coordinator, '/bootstrap', {
      householdId: HOUSEHOLD_ID,
      ownerUserId: OWNER,
      device: {
        deviceId: OWNER_DEVICE,
        userId: OWNER,
        signingPublicKey: `sign-${'o'.repeat(40)}`,
        agreementPublicKey: `agree-${'o'.repeat(40)}`,
      },
    });
    await post(coordinator, '/invites', {
      inviteId: INVITE_ID,
      shortCode: 'AB12CD',
      secretHash: 'hash',
      role: 'ADULT',
      createdByUserId: OWNER,
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    });
  }

  function claim(secretHash = 'hash'): Promise<Response> {
    return post(coordinator, '/invites/claim', {
      inviteId: INVITE_ID,
      secretHash,
      userId: JOINER,
      deviceId: JOINER_DEVICE,
      signingPublicKey: CLAIM_SIGNING_KEY,
      agreementPublicKey: CLAIM_AGREEMENT_KEY,
    });
  }

  const invites = async () => {
    const res = await coordinator.fetch(new Request('http://do/state'));
    return ((await res.json()) as { invites: Array<{ status: string }> }).invites;
  };

  beforeEach(() => {
    coordinator = makeCoordinator();
  });

  it('refuses a claim the owner could not possibly approve in time', async () => {
    await seedInvite(60_000);

    const res = await claim();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'invite_expiring' });
  });

  /**
   * The invite has NOT expired, and saying it had would break the owner's own
   * list of live invites — and the Cancel button on the row it still shows.
   */
  it('leaves the invite active rather than retiring it early', async () => {
    await seedInvite(60_000);
    await claim();

    expect((await invites())[0]?.status).toBe('active');
  });

  /**
   * Checked before the secret, so the answer cannot be used to probe secrets
   * against invites in their last minutes.
   */
  it('refuses on the remaining time before it looks at the secret', async () => {
    await seedInvite(60_000);

    const res = await claim('wrong-hash');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'invite_expiring' });
  });

  it('still accepts a claim with real time left on the invite', async () => {
    await seedInvite(3600_000);

    const res = await claim();

    expect(res.status).toBe(200);
    expect((await invites())[0]?.status).toBe('claimed');
  });

  /** Past its expiry is a different answer, and keeps its own status code. */
  it('answers gone, not expiring, once the invite is actually dead', async () => {
    await seedInvite(-1000);

    const res = await claim();

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'invite_expired' });
  });
});
