import { DurableObject } from 'cloudflare:workers';

import type { Env } from '../types';

/**
 * How much life an invite must have left for a claim to be worth accepting.
 *
 * A claim is not the end of enrolment — it starts a wait on the OWNER, who has
 * to open the app, read six digits off the claimant's screen and tap approve.
 * An invite claimed with seconds to run cannot survive that, and the failure is
 * not symmetric: the invite quietly expires, while the claiming device is left
 * holding a half-joined household it can neither use nor be approved into.
 * Observed on staging 2026-08-19 — a claim landed 37s before expiry, the owner
 * never had a chance, and the invitee's device sat on "Waiting for approval…"
 * polling a household the control plane answered 403 for, 194 times.
 *
 * Refusing is the honest answer, and it is actionable in a way the dead wait
 * never was: the invitee is told immediately to ask for a new invite. The
 * invite itself is left ACTIVE and untouched — it has not expired yet, and
 * lying about its state here would break the owner's own list of live invites.
 */
const CLAIM_MIN_REMAINING_MS = 5 * 60 * 1000;

export type LfDeviceRecord = {
  deviceId: string;
  userId: string;
  signingPublicKey: string;
  agreementPublicKey: string;
  status: 'active' | 'revoked';
  label?: string | null;
  enrolledAt: string;
  revokedAt?: string | null;
  /**
   * When this device last actually reached the household, stamped by its own
   * sync poll (see `/devices/seen`).
   *
   * Without it a device record carries no evidence of life: `status` stays
   * 'active' from enrolment until somebody revokes it, so a phone that was
   * wiped, re-signed-in or simply abandoned is indistinguishable in the trusted
   * device list from one syncing every few seconds. Members were shown ghost
   * enrolments labelled "Active" and had no way to tell which were real.
   *
   * Undefined on records written before this existed — render those as unknown
   * rather than as "never seen", which would libel a live device.
   */
  lastSeenAt?: string | null;
};

export type LfMembershipRecord = {
  userId: string;
  role: 'OWNER' | 'ADULT';
  status: 'active' | 'revoked';
};

export type LfInviteRecord = {
  inviteId: string;
  shortCode: string;
  /** SHA-256 hex of invite secret — secret returned once at create. */
  secretHash: string;
  role: 'OWNER' | 'ADULT';
  createdByUserId: string;
  status: 'active' | 'claimed' | 'approved' | 'revoked' | 'expired';
  expiresAt: string;
  /**
   * Address the invite was issued to, lowercased. When set, only that account
   * may claim — so an intercepted link is inert in anyone else's hands.
   * Enforced in the service layer, which is the tier that can resolve a user id
   * to an address; the coordinator only carries it.
   */
  inviteeEmail?: string | null;
  claimedByUserId?: string | null;
  claimedDeviceId?: string | null;
  claimedSigningPublicKey?: string | null;
  claimedAgreementPublicKey?: string | null;
  /** When the owner confirmed the enrolment SAS against the claiming device. */
  sasVerifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CoordinatorState = {
  householdId: string;
  keyEpoch: number;
  securityRevision: number;
  members: LfMembershipRecord[];
  devices: LfDeviceRecord[];
  invites: LfInviteRecord[];
};

const STATE_KEY = 'state';

/**
 * How stale `lastSeenAt` may get before a sync poll rewrites it. Five minutes
 * is far finer than the "is this a ghost?" question needs (answered in days)
 * and keeps the write rate to at most 12/hour per device.
 */
const DEVICE_SEEN_THROTTLE_MS = 5 * 60 * 1000;

type SocketAttachment = {
  userId: string;
  deviceId: string;
  /**
   * Set when the socket is held by a device that is NOT enrolled yet: it has
   * claimed this invite and is waiting to be let in.
   *
   * Enrolment is the one moment where the device that most needs to hear from
   * this room is not allowed in it. Every other reader here is an active member
   * with an active device; a claimant is neither, by definition, until the
   * owner approves — so the only channel that could tell it "you are in" was
   * the one channel it could not open. Without this it learns its own fate from
   * a push (undelivered in the Simulator, denied or throttled in the wild) or
   * not at all, which is how a device ends up sitting on "Waiting for
   * approval…" for an invite that was answered an hour ago.
   *
   * A pending socket is deliberately the weakest thing in the room: it may not
   * send (see `webSocketMessage`), it is not announced to peers, it is not
   * counted as presence, and it receives nothing but the fate of its own
   * invite. It is a doorbell, not a seat at the table.
   */
  pendingInviteId?: string;
};

/**
 * Socket tags, set at accept time so fan-out can select without waking and
 * deserializing every socket in the room.
 *
 * `device:<id>` addresses one device — the claimant waiting on an answer.
 * `member` is every enrolled socket, which is the audience for "somebody is
 * waiting": any of the owner's devices may be the one in their hand.
 */
const TAG_MEMBER = 'member';
const tagForDevice = (deviceId: string) => `device:${deviceId}`;

/**
 * What the room says out loud about enrolment.
 *
 * Deliberately thin: an id and a status, never key material, never the
 * claimant's identity. A reader is told THAT something moved and re-asks the
 * control plane over an authenticated request — which is the tier that decides
 * what each caller may see. Putting the answer in the broadcast would hand the
 * pending socket, the weakest reader in the room, a view of the household it
 * has not been approved into.
 */
type EnrolmentEvent = {
  type:
    | 'enrolment.claimed'
    | 'enrolment.approved'
    | 'enrolment.revoked'
    | 'enrolment.expired';
  inviteId: string;
};

/**
 * Per-household security authority for Budget V2 local-first.
 * Membership / device / key-epoch / invites + WebRTC signaling fan-out.
 */
export class HouseholdCoordinatorDO extends DurableObject<Env> {
  private state: CoordinatorState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime while the object stays asleep. The client pings
    // every 25s to hold the connection open; handling that in
    // `webSocketMessage` woke the DO ~140 times an hour per room to say "pong"
    // — the exact cost hibernation exists to avoid. `webSocketMessage` still
    // answers a ping, for any client whose frame is not byte-identical to this
    // pair (the match is exact, not structural).
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: 'ping' }),
        JSON.stringify({ type: 'pong' }),
      ),
    );
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = (await this.ctx.storage.get<CoordinatorState>(STATE_KEY)) ?? null;
      if (stored && !stored.invites) {
        stored.invites = [];
      }
      this.state = stored;
    });
  }

  /**
   * Tell the room an enrolment moved.
   *
   * Two audiences, and they are not the same people. Members hear about a claim
   * because the owner is the one who has to act on it; the CLAIMANT hears about
   * the answer because it is the one waiting for it, and it is reachable by
   * device tag alone — it has no membership to select on.
   *
   * Never throws and never awaits: a send that fails is a socket that has gone
   * away, and the state change this announces is already persisted. Losing the
   * announcement costs a reader its instant update; both sides still poll, and
   * both re-ask on focus, so the floor is the old behaviour rather than a
   * missed enrolment.
   */
  private announce(event: EnrolmentEvent, audience: { members?: boolean; deviceId?: string | null }): void {
    const frame = JSON.stringify(event);
    const targets: WebSocket[] = [];
    if (audience.members) targets.push(...this.ctx.getWebSockets(TAG_MEMBER));
    if (audience.deviceId) targets.push(...this.ctx.getWebSockets(tagForDevice(audience.deviceId)));
    // A device may hold both a member socket and (briefly, mid-enrolment) a
    // pending one; addressing both audiences must not send twice.
    for (const ws of new Set(targets)) {
      try {
        ws.send(frame);
      } catch {
        /* socket is gone; the poll behind this covers it */
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/bootstrap' && request.method === 'POST') {
        return this.handleBootstrap(request);
      }
      if (path === '/state' && request.method === 'GET') {
        return this.handleGetState();
      }
      if (path === '/devices' && request.method === 'POST') {
        return this.handleRegisterDevice(request);
      }
      if (path === '/devices/revoke' && request.method === 'POST') {
        return this.handleRevokeDevice(request);
      }
      if (path === '/devices/forget' && request.method === 'POST') {
        return this.handleForgetDevice(request);
      }
      if (path === '/devices/seen' && request.method === 'POST') {
        return this.handleDeviceSeen(request);
      }
      if (path === '/members' && request.method === 'POST') {
        return this.handleUpsertMember(request);
      }
      if (path === '/members/leave' && request.method === 'POST') {
        return this.handleLeaveHousehold(request);
      }
      if (path === '/invites' && request.method === 'POST') {
        return this.handleCreateInvite(request);
      }
      if (path === '/invites/claim' && request.method === 'POST') {
        return this.handleClaimInvite(request);
      }
      if (path === '/invites/approve' && request.method === 'POST') {
        return this.handleApproveInvite(request);
      }
      if (path === '/invites/revoke' && request.method === 'POST') {
        return this.handleRevokeInvite(request);
      }
      if (path === '/presence' && request.method === 'GET') {
        return this.handlePresence();
      }
      if (path === '/connect') {
        return this.handleConnect(request, url);
      }
      return new Response('Not found', { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'coordinator_error';
      return Response.json({ error: message }, { status: 400 });
    }
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    await this.ctx.storage.put(STATE_KEY, this.state);
  }

  private requireState(): CoordinatorState {
    if (!this.state) {
      throw new Error('household_not_bootstrapped');
    }
    if (!this.state.invites) this.state.invites = [];
    return this.state;
  }

  private async handleBootstrap(request: Request): Promise<Response> {
    const body = await request.json<{
      householdId: string;
      ownerUserId: string;
      device?: Omit<LfDeviceRecord, 'status' | 'enrolledAt' | 'revokedAt'> & {
        label?: string | null;
      };
    }>();

    const now = new Date().toISOString();
    if (!this.state) {
      this.state = {
        householdId: body.householdId,
        keyEpoch: 1,
        securityRevision: 1,
        members: [{ userId: body.ownerUserId, role: 'OWNER', status: 'active' }],
        devices: [],
        invites: [],
      };
    }

    if (body.device) {
      const existing = this.state.devices.find((d) => d.deviceId === body.device!.deviceId);
      if (!existing) {
        this.state.devices.push({
          deviceId: body.device.deviceId,
          userId: body.device.userId,
          signingPublicKey: body.device.signingPublicKey,
          agreementPublicKey: body.device.agreementPublicKey,
          label: body.device.label ?? null,
          status: 'active',
          enrolledAt: now,
          revokedAt: null,
        });
        this.state.securityRevision += 1;
      }
    }

    await this.persist();
    return Response.json(this.state);
  }

  private handleGetState(): Response {
    return Response.json(this.requireState());
  }

  private async handleRegisterDevice(request: Request): Promise<Response> {
    const state = this.requireState();
    const body = await request.json<{
      deviceId: string;
      userId: string;
      signingPublicKey: string;
      agreementPublicKey: string;
      label?: string | null;
    }>();

    const member = state.members.find((m) => m.userId === body.userId && m.status === 'active');
    if (!member) {
      return Response.json({ error: 'not_a_member' }, { status: 403 });
    }

    const now = new Date().toISOString();
    const idx = state.devices.findIndex((d) => d.deviceId === body.deviceId);
    if (idx >= 0) {
      const prev = state.devices[idx]!;
      state.devices[idx] = {
        ...prev,
        signingPublicKey: body.signingPublicKey,
        agreementPublicKey: body.agreementPublicKey,
        label: body.label ?? prev.label,
        status: 'active',
        revokedAt: null,
      };
    } else {
      state.devices.push({
        deviceId: body.deviceId,
        userId: body.userId,
        signingPublicKey: body.signingPublicKey,
        agreementPublicKey: body.agreementPublicKey,
        label: body.label ?? null,
        status: 'active',
        enrolledAt: now,
        revokedAt: null,
      });
    }
    state.securityRevision += 1;
    await this.persist();
    return Response.json(state);
  }

  private async handleRevokeDevice(request: Request): Promise<Response> {
    const state = this.requireState();
    const body = await request.json<{ deviceId: string; actorUserId: string }>();
    // Membership first, so a non-member still learns nothing about which
    // devices exist (403 before any 404).
    const actor = state.members.find((m) => m.userId === body.actorUserId && m.status === 'active');
    if (!actor) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    const device = state.devices.find((d) => d.deviceId === body.deviceId);
    if (!device) {
      return Response.json({ error: 'device_not_found' }, { status: 404 });
    }

    // The OWNER may revoke any device in the household; everyone else may
    // revoke only their OWN hardware.
    //
    // Owner-only for EVERY revoke left a member with a lost or replaced phone
    // no way to cut it off — their own stale device sat in the trusted list
    // holding household keys until the owner happened to remove it. Revoking
    // your own device is not a trust decision about anyone else: it removes a
    // key holder the actor already controls, and the epoch bump that follows
    // is exactly the point. Evicting SOMEONE ELSE's device stays owner-only.
    if (actor.role !== 'OWNER' && device.userId !== actor.userId) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    device.status = 'revoked';
    device.revokedAt = new Date().toISOString();
    state.keyEpoch += 1;
    state.securityRevision += 1;
    await this.persist();
    return Response.json(state);
  }

  /**
   * Take a REVOKED device off the record entirely.
   *
   * Revoking folds a device away but keeps its row forever, because the list is
   * also an audit of who lost access and when. That is the right default and the
   * wrong permanent state: a phone replaced twice a year, a member who re-enrols
   * after a wipe, and a household that has been running for a while accumulates
   * rows nobody will ever read again — five stale enrolments crowding out the
   * three devices that actually hold the budget. Folding them behind a toggle
   * hid the clutter; it did not give anybody a way to be rid of it.
   *
   * Only a device that is ALREADY revoked may be forgotten (409 otherwise). This
   * is bookkeeping, not a security act: it must never become a second, quieter
   * way to evict a live device, which is the one path that has to rotate keys.
   *
   * Same actor rule as revoking — the OWNER may forget any row, everyone else
   * only their own hardware — so a member who cut off their own lost phone can
   * finish the job they started.
   *
   * No key rotation, deliberately. The epoch moved when the device was revoked
   * and the device has held no usable key since; bumping again would put every
   * remaining peer through a rewrap to record a deletion from a list. The
   * security revision still moves, because the registry did.
   */
  private async handleForgetDevice(request: Request): Promise<Response> {
    const state = this.requireState();
    const body = await request.json<{ deviceId: string; actorUserId: string }>();
    // Membership before existence, as in `handleRevokeDevice`: a non-member must
    // not be able to probe which device ids exist.
    const actor = state.members.find((m) => m.userId === body.actorUserId && m.status === 'active');
    if (!actor) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    const index = state.devices.findIndex((d) => d.deviceId === body.deviceId);
    if (index < 0) {
      return Response.json({ error: 'device_not_found' }, { status: 404 });
    }
    const device = state.devices[index]!;

    if (actor.role !== 'OWNER' && device.userId !== actor.userId) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    if (device.status !== 'revoked') {
      return Response.json({ error: 'device_not_revoked' }, { status: 409 });
    }

    state.devices.splice(index, 1);
    state.securityRevision += 1;
    await this.persist();
    return Response.json(state);
  }

  /**
   * "This device is alive" — stamped by the device's own sync poll.
   *
   * Deliberately throttled. The poll runs every few seconds per device, and a
   * DO storage write per poll would be a write amplification of thousands per
   * hour to record a fact that only needs minute-level resolution. Skipping a
   * write inside the window costs nothing: the value is already recent enough
   * to answer the only question anyone asks of it — "is this device still
   * syncing, or is it a leftover?"
   *
   * Never fails the caller's sync: an unknown device or a revoked one is a
   * no-op 200, because the poll's own auth already decided whether it may read.
   */
  private async handleDeviceSeen(request: Request): Promise<Response> {
    const state = this.requireState();
    const body = await request.json<{ deviceId: string }>();

    const device = state.devices.find((d) => d.deviceId === body.deviceId);
    if (!device || device.status !== 'active') {
      return Response.json({ ok: true, stamped: false });
    }

    const now = Date.now();
    const previous = device.lastSeenAt ? Date.parse(device.lastSeenAt) : 0;
    if (Number.isFinite(previous) && now - previous < DEVICE_SEEN_THROTTLE_MS) {
      return Response.json({ ok: true, stamped: false });
    }

    device.lastSeenAt = new Date(now).toISOString();
    await this.persist();
    return Response.json({ ok: true, stamped: true });
  }

  /**
   * Administer an EXISTING membership: change its role, or end it.
   *
   * Deliberately not an upsert. A membership is created in exactly one place —
   * `handleApproveInvite`, after a human compared six digits — and a handler
   * that would happily push a brand-new `{userId, role: 'OWNER'}` record is a
   * way into a household that bypasses that comparison entirely. So an unknown
   * or already-revoked user is `member_not_found`, never a silent add.
   *
   * Both fields are optional and default to what is on record: removal names a
   * status and must not have to restate a role it is not changing (restating it
   * from a stale client read is how a demotion rides along with a removal).
   *
   * **The actor may not change their own membership.** That is what keeps the
   * household's one invariant — at least one active OWNER — true without a
   * separate count: the actor is an active OWNER by the check above, and is not
   * the target, so an owner always survives whatever this does. An owner who
   * wants out leaves through the household, not through this door.
   */
  private async handleUpsertMember(request: Request): Promise<Response> {
    const state = this.requireState();
    const body = await request.json<{
      userId: string;
      role?: 'OWNER' | 'ADULT';
      status?: 'active' | 'revoked';
      actorUserId: string;
    }>();
    const actor = state.members.find((m) => m.userId === body.actorUserId && m.status === 'active');
    if (!actor || actor.role !== 'OWNER') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    if (body.userId === body.actorUserId) {
      return Response.json({ error: 'cannot_change_own_membership' }, { status: 409 });
    }

    const idx = state.members.findIndex((m) => m.userId === body.userId);
    const current = idx >= 0 ? state.members[idx]! : null;
    if (!current || current.status !== 'active') {
      return Response.json({ error: 'member_not_found' }, { status: 404 });
    }

    const next: LfMembershipRecord = {
      userId: body.userId,
      role: body.role ?? current.role,
      status: body.status ?? current.status,
    };
    state.members[idx] = next;

    // A removal is an ended membership, and everything that goes with one lives
    // in `endMembership` so that being removed and leaving cost the same.
    if (next.status === 'revoked') {
      this.endMembership(state, body.userId);
    }
    state.securityRevision += 1;
    await this.persist();
    return Response.json(state);
  }

  /**
   * Walk somebody out of the household: their membership, their devices, and
   * the key they could read with.
   *
   * Shared by the two ways a membership ends — an owner removing someone
   * (`handleUpsertMember`) and a person leaving of their own accord
   * (`handleLeaveHousehold`) — because they differ only in who is allowed to ask.
   * What happens afterwards must not: a household where "removed" and "left"
   * leave different residue is one where the trusted-device list means two
   * different things depending on how somebody went.
   *
   * The epoch bump is what makes the ops written from now on unreadable to the
   * keys they already hold. (A role change moves no key material and must NOT
   * rotate — it would lock every peer out to record a permission.)
   *
   * Their device records are DELETED, not marked revoked. A revoked row is the
   * right memory of a device the household cut off while its owner stayed; it
   * is only clutter once the person is gone, and it is clutter that keeps their
   * hardware, their labels and their enrolment dates on the household's record
   * indefinitely. Deleting also closes the softer hole: `deviceBelongsToUser`
   * (the mailbox's authz) matches on the row rather than on its status, so a
   * removed member's device kept a lane to deposit into until the row went.
   *
   * The caller bumps `securityRevision` and persists — this only mutates.
   */
  private endMembership(state: CoordinatorState, userId: string): void {
    const member = state.members.find((m) => m.userId === userId);
    if (member) member.status = 'revoked';
    state.keyEpoch += 1;
    state.devices = state.devices.filter((device) => device.userId !== userId);
  }

  /**
   * Leave the household yourself.
   *
   * The door `handleUpsertMember` deliberately refuses to be: it rejects any
   * actor acting on their own membership, because that is what keeps "a
   * household always has an active OWNER" true without counting anything. So
   * leaving needs its own handler, and its own version of that invariant.
   *
   * The rule: an owner may not leave while somebody else is still in the
   * household and no other owner is. Otherwise the household survives with
   * members who can never invite, approve a device, or remove anybody — a
   * budget nobody can administer, and no way back short of support. They are
   * told to make someone else an owner first, which is a thing they can do on
   * the same screen.
   *
   * The LAST person in a household may always leave, owner or not. There is
   * nobody left to strand, and refusing would trap somebody in a household that
   * exists only on the server — the exact debris this refuses to create.
   */
  private async handleLeaveHousehold(request: Request): Promise<Response> {
    const state = this.requireState();
    const body = await request.json<{ actorUserId: string }>();

    const actor = state.members.find((m) => m.userId === body.actorUserId && m.status === 'active');
    if (!actor) {
      // Not a 403: the caller is asking about their own membership, so there is
      // nothing to withhold — and "you are already out" is what a client that
      // has just been removed needs to hear to finish cleaning up locally.
      return Response.json({ error: 'member_not_found' }, { status: 404 });
    }

    const others = state.members.filter(
      (m) => m.status === 'active' && m.userId !== body.actorUserId,
    );
    // Only an OWNER can be the last one. A member walking out of a household
    // that has somehow lost its owner is not the cause of that, and holding
    // them there would not fix it.
    if (actor.role === 'OWNER' && others.length > 0 && !others.some((m) => m.role === 'OWNER')) {
      return Response.json({ error: 'last_owner_cannot_leave' }, { status: 409 });
    }

    this.endMembership(state, body.actorUserId);
    state.securityRevision += 1;
    await this.persist();
    return Response.json(state);
  }

  private async handleCreateInvite(request: Request): Promise<Response> {
    const state = this.requireState();
    const body = await request.json<{
      inviteId: string;
      shortCode: string;
      secretHash: string;
      role: 'OWNER' | 'ADULT';
      createdByUserId: string;
      expiresAt: string;
      inviteeEmail?: string | null;
    }>();

    const actor = state.members.find(
      (m) => m.userId === body.createdByUserId && m.status === 'active',
    );
    if (!actor || actor.role !== 'OWNER') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    if (state.invites.some((i) => i.inviteId === body.inviteId || i.shortCode === body.shortCode)) {
      return Response.json({ error: 'conflict' }, { status: 409 });
    }

    const now = new Date().toISOString();
    const invite: LfInviteRecord = {
      inviteId: body.inviteId,
      shortCode: body.shortCode,
      secretHash: body.secretHash,
      role: body.role,
      createdByUserId: body.createdByUserId,
      status: 'active',
      expiresAt: body.expiresAt,
      inviteeEmail: body.inviteeEmail?.trim().toLowerCase() || null,
      createdAt: now,
      updatedAt: now,
    };
    state.invites.push(invite);
    state.securityRevision += 1;
    await this.persist();
    return Response.json({ invite }, { status: 201 });
  }

  private async handleClaimInvite(request: Request): Promise<Response> {
    const state = this.requireState();
    const body = await request.json<{
      inviteId: string;
      secretHash: string;
      userId: string;
      deviceId: string;
      signingPublicKey: string;
      agreementPublicKey: string;
    }>();

    const invite = state.invites.find((i) => i.inviteId === body.inviteId);
    if (!invite) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (invite.status !== 'active') {
      return Response.json({ error: 'invite_not_active' }, { status: 409 });
    }
    const remainingMs = new Date(invite.expiresAt).getTime() - Date.now();
    if (remainingMs < 0) {
      invite.status = 'expired';
      invite.updatedAt = new Date().toISOString();
      await this.persist();
      // The owner may be looking at this invite right now, offering a code that
      // just died in the claimant's hands.
      this.announce({ type: 'enrolment.expired', inviteId: invite.inviteId }, { members: true });
      return Response.json({ error: 'invite_expired' }, { status: 410 });
    }
    // Checked before the secret on purpose: an invite too close to expiry is
    // refused whether or not the secret is right, so the answer cannot be used
    // to probe secrets against invites in their last minutes.
    if (remainingMs < CLAIM_MIN_REMAINING_MS) {
      return Response.json({ error: 'invite_expiring' }, { status: 409 });
    }
    if (invite.secretHash !== body.secretHash) {
      return Response.json({ error: 'invalid_secret' }, { status: 403 });
    }

    const now = new Date().toISOString();
    invite.status = 'claimed';
    invite.claimedByUserId = body.userId;
    invite.claimedDeviceId = body.deviceId;
    invite.claimedSigningPublicKey = body.signingPublicKey;
    invite.claimedAgreementPublicKey = body.agreementPublicKey;
    invite.updatedAt = now;
    state.securityRevision += 1;
    await this.persist();
    // Somebody is now standing in front of the owner with six digits on their
    // screen. This is the moment the owner's list has to change, and the only
    // one where a person is actively waiting on the other side of it.
    this.announce({ type: 'enrolment.claimed', inviteId: invite.inviteId }, { members: true });
    return Response.json({
      invite: {
        inviteId: invite.inviteId,
        householdId: state.householdId,
        role: invite.role,
        status: invite.status,
      },
    });
  }

  /**
   * Approve a claimed invite.
   *
   * The owner sends back the exact keys it displayed to the human during the
   * SAS comparison. Those are checked against the claim on record, so an
   * approval can only ever land on the enrolment the owner actually verified.
   *
   * This is a consistency check, not the security boundary — this tier is the
   * one the SAS exists to distrust, and it could return anything it likes. The
   * boundary is that the owner's device wraps the household key to the key IT
   * verified rather than to anything in this response. What the check buys is
   * that a claim which changed underneath the owner (a re-claim between reading
   * the digits and tapping approve) fails loudly instead of enrolling a device
   * no one looked at.
   */
  private async handleApproveInvite(request: Request): Promise<Response> {
    const state = this.requireState();
    const body = await request.json<{
      inviteId: string;
      actorUserId: string;
      confirmedSigningPublicKey: string;
      confirmedAgreementPublicKey: string;
    }>();

    const actor = state.members.find((m) => m.userId === body.actorUserId && m.status === 'active');
    if (!actor || actor.role !== 'OWNER') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    const invite = state.invites.find((i) => i.inviteId === body.inviteId);
    if (!invite) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (invite.status !== 'claimed') {
      return Response.json({ error: 'invite_not_claimed' }, { status: 409 });
    }
    if (
      !invite.claimedByUserId ||
      !invite.claimedDeviceId ||
      !invite.claimedSigningPublicKey ||
      !invite.claimedAgreementPublicKey
    ) {
      return Response.json({ error: 'claim_incomplete' }, { status: 409 });
    }
    // Case-insensitive: both sides carry hex, and only the bytes are meaningful.
    const sameKey = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    if (
      !sameKey(body.confirmedSigningPublicKey ?? '', invite.claimedSigningPublicKey) ||
      !sameKey(body.confirmedAgreementPublicKey ?? '', invite.claimedAgreementPublicKey)
    ) {
      return Response.json({ error: 'claim_changed' }, { status: 409 });
    }

    const now = new Date().toISOString();
    invite.status = 'approved';
    invite.sasVerifiedAt = now;
    invite.updatedAt = now;

    const memberIdx = state.members.findIndex((m) => m.userId === invite.claimedByUserId);
    const member: LfMembershipRecord = {
      userId: invite.claimedByUserId,
      role: invite.role,
      status: 'active',
    };
    if (memberIdx >= 0) state.members[memberIdx] = member;
    else state.members.push(member);

    const deviceIdx = state.devices.findIndex((d) => d.deviceId === invite.claimedDeviceId);
    const device: LfDeviceRecord = {
      deviceId: invite.claimedDeviceId,
      userId: invite.claimedByUserId,
      signingPublicKey: invite.claimedSigningPublicKey,
      agreementPublicKey: invite.claimedAgreementPublicKey,
      status: 'active',
      enrolledAt: now,
      revokedAt: null,
    };
    if (deviceIdx >= 0) state.devices[deviceIdx] = device;
    else state.devices.push(device);

    state.securityRevision += 1;
    await this.persist();
    // Both halves of the hand-off, in one place. The claimant is told it is in
    // — that is the whole wait ending — and the owner's other devices drop the
    // row, so the person who approved on a phone does not find the same request
    // still waiting on their iPad.
    this.announce(
      { type: 'enrolment.approved', inviteId: invite.inviteId },
      { members: true, deviceId: invite.claimedDeviceId },
    );
    return Response.json({
      state,
      approved: {
        userId: invite.claimedByUserId,
        deviceId: invite.claimedDeviceId,
        agreementPublicKey: invite.claimedAgreementPublicKey,
      },
    });
  }

  private async handleRevokeInvite(request: Request): Promise<Response> {
    const state = this.requireState();
    const body = await request.json<{ inviteId: string; actorUserId: string }>();
    const actor = state.members.find((m) => m.userId === body.actorUserId && m.status === 'active');
    if (!actor || actor.role !== 'OWNER') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    const invite = state.invites.find((i) => i.inviteId === body.inviteId);
    if (!invite) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const claimant = invite.claimedDeviceId ?? null;
    invite.status = 'revoked';
    invite.updatedAt = new Date().toISOString();
    state.securityRevision += 1;
    await this.persist();
    // A claimant is owed this most of all: nothing else will ever arrive, and
    // without being told it waits on an answer that is not coming.
    this.announce(
      { type: 'enrolment.revoked', inviteId: invite.inviteId },
      { members: true, deviceId: claimant },
    );
    return Response.json({ invite });
  }

  private handlePresence(): Response {
    const devices: Array<{ userId: string; deviceId: string }> = [];
    // Enrolled sockets only — a device waiting to be let in is not "here".
    for (const ws of this.ctx.getWebSockets(TAG_MEMBER)) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.deviceId) {
        devices.push({ userId: attachment.userId, deviceId: attachment.deviceId });
      }
    }
    return Response.json({ devices });
  }

  private handleConnect(request: Request, url: URL): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const userId = url.searchParams.get('userId') ?? '';
    const deviceId = url.searchParams.get('deviceId') ?? '';
    if (!userId || !deviceId) {
      return Response.json({ error: 'userId_and_deviceId_required' }, { status: 400 });
    }

    // Eligibility, in two tiers. An active member on an active device gets the
    // full socket. A device that has CLAIMED an invite and is waiting on it
    // gets a pending one — see `SocketAttachment.pendingInviteId` for why the
    // room has to admit it at all, and for how little it is admitted to.
    let pendingInviteId: string | null = null;
    try {
      const state = this.requireState();
      const member = state.members.find((m) => m.userId === userId && m.status === 'active');
      const device = state.devices.find(
        (d) => d.deviceId === deviceId && d.userId === userId && d.status === 'active',
      );
      if (!member || !device) {
        const claim = state.invites.find(
          (i) =>
            i.status === 'claimed' &&
            i.claimedDeviceId === deviceId &&
            i.claimedByUserId === userId,
        );
        // Matched on the claim itself, not on "is unenrolled": the only device
        // this admits is the one already recorded against a live claim, by both
        // user and device id.
        if (!claim) {
          return Response.json({ error: 'not_eligible' }, { status: 403 });
        }
        pendingInviteId = claim.inviteId;
      }
    } catch {
      return Response.json({ error: 'household_not_bootstrapped' }, { status: 404 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Tagged at accept time so fan-out can select without waking every socket.
    this.ctx.acceptWebSocket(
      server,
      pendingInviteId ? [tagForDevice(deviceId)] : [TAG_MEMBER, tagForDevice(deviceId)],
    );
    server.serializeAttachment({
      userId,
      deviceId,
      ...(pendingInviteId ? { pendingInviteId } : {}),
    } satisfies SocketAttachment);

    // A claimant is not in the household yet, so it is not present in it: no
    // announcement out, and — because it carries no `member` tag — none in.
    if (pendingInviteId) {
      return new Response(null, { status: 101, webSocket: client });
    }

    // Announce presence to peers (no financial payload).
    const joinEvent = JSON.stringify({
      type: 'presence.join',
      userId,
      deviceId,
    });
    for (const ws of this.ctx.getWebSockets(TAG_MEMBER)) {
      if (ws === server) continue;
      try {
        ws.send(joinEvent);
      } catch {
        /* ignore */
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    let parsed: { type?: string; toDeviceId?: string } | null = null;
    try {
      parsed = JSON.parse(message) as { type?: string; toDeviceId?: string };
    } catch {
      return;
    }
    if (!parsed || typeof parsed.type !== 'string') return;

    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment?.deviceId) return;

    if (parsed.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    // A pending socket is receive-only. It belongs to a device that has not been
    // approved into this household, so nothing it says may be relayed to
    // members — least of all the signaling frames below, which are the opening
    // move of a peer-to-peer session over the household's own ledger.
    if (attachment.pendingInviteId) return;

    // Signaling frames: offer / answer / ice / sync_available — fan-out only.
    const allowed = new Set(['signal.offer', 'signal.answer', 'signal.ice', 'sync_available']);
    if (!allowed.has(parsed.type)) return;

    const envelope = JSON.stringify({
      ...parsed,
      fromDeviceId: attachment.deviceId,
      fromUserId: attachment.userId,
    });

    // Members only: a pending socket must never be handed signaling frames.
    for (const peer of this.ctx.getWebSockets(TAG_MEMBER)) {
      if (peer === ws) continue;
      const peerAtt = peer.deserializeAttachment() as SocketAttachment | null;
      if (parsed.toDeviceId && peerAtt?.deviceId !== parsed.toDeviceId) continue;
      try {
        peer.send(envelope);
      } catch {
        /* ignore */
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    // A pending socket was never announced as present, so its going away is not
    // a departure anyone was told to expect.
    if (attachment?.deviceId && !attachment.pendingInviteId) {
      const leave = JSON.stringify({
        type: 'presence.leave',
        userId: attachment.userId,
        deviceId: attachment.deviceId,
      });
      for (const peer of this.ctx.getWebSockets(TAG_MEMBER)) {
        if (peer === ws) continue;
        try {
          peer.send(leave);
        } catch {
          /* ignore */
        }
      }
    }
    try {
      ws.close(code, 'closing');
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error');
    } catch {
      /* ignore */
    }
  }
}
