import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The live half of enrolment: who is told when a claim moves, and who is
 * allowed to be listening.
 *
 * Enrolment is two people standing next to each other, each waiting on the
 * other's screen, so "it updates within ten seconds" is the wrong shape of
 * answer — and for the INVITEE there was no answer at all. That device is not a
 * member and not enrolled, which is precisely what the room used to check for
 * before letting anyone listen, so the one participant with nothing to do but
 * wait was the one participant that could not be told. It found out from a push
 * (never delivered in the Simulator) or not at all: observed on Budget-B, stuck
 * on "Waiting to be let in" for an invite answered an hour earlier, with the
 * Join button disabled by that same wait so the person could not even claim the
 * replacement invite.
 *
 * Admitting it is a security question, so these tests pin the shape of the
 * exception as much as the feature: matched on a live claim by BOTH ids,
 * receive-only, and told nothing but the fate of its own invite.
 */

const HOUSEHOLD_ID = 'hh_live';
const OWNER = 'u_owner';
const JOINER = 'u_joiner';
const OWNER_DEVICE = 'dev_owner';
const JOINER_DEVICE = 'dev_joiner';
const INVITE_ID = 'inv_live';

const CLAIM_SIGNING_KEY = `sign-${'a'.repeat(40)}`;
const CLAIM_AGREEMENT_KEY = `agree-${'b'.repeat(40)}`;

type Coordinator = { fetch: (request: Request) => Promise<Response> };

let instanceSeq = 0;
function makeCoordinator(): Coordinator {
  instanceSeq += 1;
  const binding = (env as unknown as { HOUSEHOLD_COORDINATOR: DurableObjectNamespace })
    .HOUSEHOLD_COORDINATOR;
  return binding.get(binding.idFromName(`${HOUSEHOLD_ID}-${instanceSeq}`)) as Coordinator;
}

function post(coordinator: Coordinator, path: string, body: unknown): Promise<Response> {
  return coordinator.fetch(
    new Request(`http://do${path}`, { method: 'POST', body: JSON.stringify(body) }),
  );
}

/** Open a socket the way the signaling route does, and start collecting frames. */
async function connect(
  coordinator: Coordinator,
  userId: string,
  deviceId: string,
): Promise<{ status: number; frames: string[]; socket: WebSocket | null }> {
  const res = await coordinator.fetch(
    new Request(
      `http://do/connect?userId=${encodeURIComponent(userId)}&deviceId=${encodeURIComponent(deviceId)}`,
      { headers: { Upgrade: 'websocket' } },
    ),
  );
  if (res.status !== 101 || !res.webSocket) {
    return { status: res.status, frames: [], socket: null };
  }
  const socket = res.webSocket;
  const frames: string[] = [];
  socket.accept();
  socket.addEventListener('message', (event) => {
    frames.push(String((event as MessageEvent).data));
  });
  return { status: res.status, frames, socket };
}

/** Frames are delivered on the event loop; let it turn before asserting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function typesIn(frames: string[]): string[] {
  return frames.map((f) => (JSON.parse(f) as { type: string }).type);
}

async function seedOwner(coordinator: Coordinator): Promise<void> {
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
}

function claim(coordinator: Coordinator): Promise<Response> {
  return post(coordinator, '/invites/claim', {
    inviteId: INVITE_ID,
    secretHash: 'hash',
    userId: JOINER,
    deviceId: JOINER_DEVICE,
    signingPublicKey: CLAIM_SIGNING_KEY,
    agreementPublicKey: CLAIM_AGREEMENT_KEY,
  });
}

function approve(coordinator: Coordinator): Promise<Response> {
  return post(coordinator, '/invites/approve', {
    inviteId: INVITE_ID,
    actorUserId: OWNER,
    confirmedSigningPublicKey: CLAIM_SIGNING_KEY,
    confirmedAgreementPublicKey: CLAIM_AGREEMENT_KEY,
  });
}

describe('telling the owner somebody is waiting', () => {
  let coordinator: Coordinator;

  beforeEach(async () => {
    coordinator = makeCoordinator();
    await seedOwner(coordinator);
  });

  it('announces a claim to the owner as it lands', async () => {
    const owner = await connect(coordinator, OWNER, OWNER_DEVICE);
    expect(owner.status).toBe(101);

    await claim(coordinator);
    await settle();

    expect(typesIn(owner.frames)).toContain('enrolment.claimed');
    const event = owner.frames
      .map((f) => JSON.parse(f) as { type: string; inviteId?: string })
      .find((e) => e.type === 'enrolment.claimed');
    expect(event?.inviteId).toBe(INVITE_ID);
  });

  it('carries an id and nothing else', async () => {
    // The claimant's keys and identity stay out of the room: a reader is told
    // THAT something moved and re-asks over an authenticated request, which is
    // the tier that decides what each caller may see.
    const owner = await connect(coordinator, OWNER, OWNER_DEVICE);
    await claim(coordinator);
    await settle();

    const event = owner.frames
      .map((f) => JSON.parse(f) as Record<string, unknown>)
      .find((e) => e.type === 'enrolment.claimed');
    expect(Object.keys(event ?? {}).sort()).toEqual(['inviteId', 'type']);
  });

  it('tells every owner device the request is answered', async () => {
    // Approving on a phone must clear the same row on the iPad.
    await claim(coordinator);
    const owner = await connect(coordinator, OWNER, OWNER_DEVICE);
    await approve(coordinator);
    await settle();

    expect(typesIn(owner.frames)).toContain('enrolment.approved');
  });
});

describe('the device waiting to be let in', () => {
  let coordinator: Coordinator;

  beforeEach(async () => {
    coordinator = makeCoordinator();
    await seedOwner(coordinator);
  });

  it('may listen once it has claimed, and is told when it is approved', async () => {
    await claim(coordinator);
    const joiner = await connect(coordinator, JOINER, JOINER_DEVICE);
    expect(joiner.status).toBe(101);

    await approve(coordinator);
    await settle();

    expect(typesIn(joiner.frames)).toContain('enrolment.approved');
  });

  it('is told when the owner cancels instead', async () => {
    // The ending nobody else would ever tell it about: without this the screen
    // waits on an answer that is never coming.
    await claim(coordinator);
    const joiner = await connect(coordinator, JOINER, JOINER_DEVICE);

    await post(coordinator, '/invites/revoke', { inviteId: INVITE_ID, actorUserId: OWNER });
    await settle();

    expect(typesIn(joiner.frames)).toContain('enrolment.revoked');
  });

  it('is refused before it has claimed anything', async () => {
    const joiner = await connect(coordinator, JOINER, JOINER_DEVICE);
    expect(joiner.status).toBe(403);
  });

  it('is refused when the claim on record names a different device', async () => {
    // The claim is matched on BOTH ids, so holding the right account is not
    // enough to listen from a device nobody enrolled.
    await claim(coordinator);
    const impostor = await connect(coordinator, JOINER, 'dev_somebody_else');
    expect(impostor.status).toBe(403);
  });

  it('is not counted as present in a household it has not joined', async () => {
    await claim(coordinator);
    await connect(coordinator, JOINER, JOINER_DEVICE);

    const res = await coordinator.fetch(new Request('http://do/presence'));
    const body = (await res.json()) as { devices: Array<{ deviceId: string }> };
    expect(body.devices.map((d) => d.deviceId)).not.toContain(JOINER_DEVICE);
  });

  it('cannot relay signaling frames to members', async () => {
    // Receive-only. These frames open a peer-to-peer session over the
    // household's own ledger, which is the last thing an unapproved device may
    // start.
    await claim(coordinator);
    const owner = await connect(coordinator, OWNER, OWNER_DEVICE);
    const joiner = await connect(coordinator, JOINER, JOINER_DEVICE);

    joiner.socket?.send(JSON.stringify({ type: 'signal.offer', sdp: 'v=0' }));
    await settle();

    expect(typesIn(owner.frames)).not.toContain('signal.offer');
  });

  it('is not announced to members as a peer joining', async () => {
    await claim(coordinator);
    const owner = await connect(coordinator, OWNER, OWNER_DEVICE);
    await connect(coordinator, JOINER, JOINER_DEVICE);
    await settle();

    expect(typesIn(owner.frames)).not.toContain('presence.join');
  });
});
