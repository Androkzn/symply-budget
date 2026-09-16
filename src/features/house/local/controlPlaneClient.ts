/**
 * House's client for the `/v2` control plane (plan §5, stage H4; §7 for the
 * per-property scoping).
 *
 * The Worker routes are shared with Budget — same relay, same mailbox, same
 * checkpoint store, gated by the `localFirstApi` capability (H0). What differs
 * is the header this brand sends and the deep-link scheme its invites carry.
 *
 * `X-House-Local-First: '1'` is not decoration: `rejectHomeWritesForLocalFirst`
 * on the Worker uses it to 410 the House domain API for clients that have
 * already moved to the ledger, so a half-migrated build cannot write to both
 * sides of the same property.
 *
 * ## Every call names a property
 *
 * A device holds SEVERAL properties — it always could (`createLocalHouseProperty`)
 * and now always does the moment somebody accepts an invite, because joining ADDS
 * a property rather than replacing the one already there. Every function below
 * used to read `getLocalHouseLedger()`, the ACTIVE session, which is right for a
 * screen and wrong for anything running in the background: a mailbox poll for B
 * fetching A's mail under B's cursor, and a deposit of B's ops landing in A's
 * mailbox addressed to A's peers — correctly encrypted, wrong property,
 * invisible. So the household is a parameter, defaulted to the active one for the
 * screens that genuinely mean "the one I am looking at".
 */
import axios from 'axios';

import { apiClient } from '@api/client';
import {
  forgetInviteSecret,
  recallInviteSecret,
  rememberInviteSecret,
  rememberJoinSas,
} from '@services/enrolment/inviteSecretStore';
import { useAuthStore } from '@stores/authStore';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  deriveEnrolmentSas,
  generateHouseholdKeys,
} from '@symply/local-first';

import { getLocalDeviceName, setLocalDeviceName } from './deviceName';
import {
  adoptJoinedHousehold,
  getActiveHouseholdId,
  getLocalHouseDeviceId,
  getLocalHouseIdentity,
  getLocalHouseSession,
  getLocalHouseStore,
  installHouseholdKeys,
  isLocalHouseSessionOpen,
  listLocalHouseProperties,
  openHouseDeviceForEnrolment,
  type HousePropertySummary,
  type HouseSessionHandle,
} from './engine';
import { syncHouseholdStoreFromLocalLedger } from './ensureSession';
import {
  HouseInviteAlreadyApprovedError,
  HouseInviteExpiringError,
  HouseInviteGoneError,
  HouseLocalNotReadyError,
  HouseLocalUnknownPropertyError,
} from './errors';
import { isHouseLocalFirst } from './flag';

const LF_HEADERS = { 'X-House-Local-First': '1' };

/**
 * The brand's URL scheme, from `brands/symply-house/brand.cjs`. NOT
 * `symply-house://` — that is the app's *code id*, not a scheme, and it is
 * exactly what the shared Worker hands back in `invite.qrPayload`. It parses
 * fine and opens nothing on either platform, which is why the link is rebuilt
 * here rather than taken from the response.
 */
export const HOUSE_INVITE_LINK_SCHEME = 'simplehouse';

/**
 * The link an invite is shared as — `simplehouse://lf-invite?id=…&secret=…&code=…`.
 *
 * Carries both halves the invitee needs, so tapping it fills the Join fields for
 * them (see `inviteLinkStore`). Deliberately does NOT carry the verification
 * digits: those are the owner's half of the check, and a link that hands them to
 * the person being verified checks nothing at all. They do not exist yet either
 * — the SAS is derived from the claiming device's keys.
 */
export function buildHouseInviteLink(invite: {
  inviteId: string;
  shortCode: string;
  secret: string;
}): string {
  const params = new URLSearchParams({
    id: invite.inviteId,
    secret: invite.secret,
    code: invite.shortCode,
  });
  return `${HOUSE_INVITE_LINK_SCHEME}://lf-invite?${params.toString()}`;
}

export type ControlPlaneHousehold = {
  id: string;
  display_name: string;
  role: string;
  key_epoch: number;
};

export type ControlPlaneInvite = {
  inviteId: string;
  shortCode: string;
  role: string;
  status: 'active' | 'claimed' | 'approved' | 'revoked' | 'expired';
  claimedByUserId?: string | null;
  claimedDeviceId?: string | null;
  expiresAt: string;
};

/**
 * A claimed invite awaiting the owner's approval, as the owner sees it.
 *
 * Carries a person (address, display name, device name) so the owner has
 * something to refuse on, and the claimed public keys so the owner's device can
 * derive the enrolment SAS and — after the human confirms — wrap the home key to
 * the key it verified.
 */
export type PendingJoinRequest = {
  inviteId: string;
  shortCode: string;
  role: string;
  expiresAt: string;
  claimedByUserId: string | null;
  claimedByEmail: string | null;
  claimedByDisplayName: string | null;
  claimedDeviceId: string | null;
  claimedDeviceLabel: string | null;
  claimedSigningPublicKey: string | null;
  claimedAgreementPublicKey: string | null;
};

/**
 * Who a member is, joined onto coordinator state by the Worker.
 *
 * Every field is OPTIONAL on purpose: a peer running a build from before the
 * server sent these, or a server whose profile lookup failed, still returns a
 * usable roster — the UI falls back to initials and "Home member" rather than
 * rendering `undefined`. See `local-first-control-service.ts`.
 */
export type ControlPlaneProfile = {
  displayName?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
  /** `users.updated_at` — changes when they rename themselves or swap avatar. */
  profileUpdatedAt?: string | null;
};

export type ControlPlaneMember = ControlPlaneProfile & {
  userId: string;
  role: string;
  status: string;
};

export type ControlPlaneDevice = ControlPlaneProfile & {
  deviceId: string;
  userId: string;
  signingPublicKey: string;
  agreementPublicKey: string;
  status: string;
  /** Human name for the device list — see `deviceName.ts`. */
  label?: string | null;
  enrolledAt?: string | null;
  revokedAt?: string | null;
  /**
   * When this device last reached the home, stamped server-side by its own sync
   * poll. Absent on records enrolled before liveness tracking existed — treat
   * that as "unknown", never as "never".
   */
  lastSeenAt?: string | null;
};

export type ControlPlaneState = {
  householdId: string;
  keyEpoch: number;
  securityRevision: number;
  members: ControlPlaneMember[];
  devices: ControlPlaneDevice[];
  invites?: ControlPlaneInvite[];
};

export type CreatedInvite = {
  inviteId: string;
  shortCode: string;
  secret: string;
  role: string;
  expiresAt: string;
  /** Set when the invite is bound to one account — only that address may claim. */
  inviteeEmail: string | null;
  universalLink: string;
  qrPayload: string;
};

// ---------------------------------------------------------------------------
// Which property a call addresses
// ---------------------------------------------------------------------------

/**
 * Resolve the property a control-plane call is about: the named one, or the
 * active one when the caller does not care (every screen).
 *
 * SYNCHRONOUS and cold-safe on purpose. It reads only `listLocalHouseProperties`,
 * which the engine builds from cold-session fields, so an owner polling pending
 * join requests across three homes does not decrypt three ledgers just to learn
 * three ids — that would undo the lazy hydration §7 exists for.
 *
 * The two errors are not interchangeable: no session at all means "sign in",
 * while a property this device does not hold is a stale id (a sync cursor for a
 * property just removed, a screen holding an id across a switch) that signing in
 * cannot fix.
 */
function resolveProperty(householdId?: string): HousePropertySummary {
  const target = householdId ?? getActiveHouseholdId();
  if (!target) throw new HouseLocalNotReadyError();
  const summary = listLocalHouseProperties().find((p) => p.householdId === target);
  if (!summary) throw new HouseLocalUnknownPropertyError(target);
  return summary;
}

/**
 * The same target, hydrated — for the calls that need this property's own KEY
 * MATERIAL rather than just its address.
 *
 * Deliberately not `getLocalHouseIdentity()` / `getLocalHouseholdKeys()`, which
 * read the active session: a session built from disk carries the keypair its own
 * ops were signed with, so publishing the active property's public keys under
 * property B's registration would leave B's peers verifying B's ops against a
 * key that never signed them.
 */
function sessionFor(householdId?: string): Promise<HouseSessionHandle> {
  return getLocalHouseSession(resolveProperty(householdId).householdId);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * A property this device knows the control plane holds a row for.
 *
 * Keyed by household id because every property on a device shares ONE store —
 * the same reason the engine's identity keys are keyed. Purged by
 * `removeLocalHouseProperty`; keep the string in step with its
 * `FOREIGN_HOUSEHOLD_META_KEYS` list.
 */
const registeredMetaKey = (householdId: string) => `lf.cp.registered:${householdId}`;

/**
 * The properties this ACCOUNT already has on the control plane — asked once per
 * session, and asked with a GET, which is the entire point.
 *
 * It is how a device that predates the marker learns that a property it holds is
 * genuinely on the server, without a POST that would CREATE the row if it were
 * not. Cached because session open asks it once per property and the answer
 * cannot change underneath one run; dropped on teardown so the next account does
 * not inherit it.
 */
let remoteHouseholdIds: Promise<Set<string>> | null = null;

function knownRemoteHouseholdIds(): Promise<Set<string>> {
  if (!remoteHouseholdIds) {
    remoteHouseholdIds = listControlPlaneHouseholds()
      .then((households) => new Set(households.map((household) => household.id)))
      .catch((error: unknown) => {
        // Offline is not "this account owns nothing" — forget the answer so the
        // next caller asks again rather than caching a lie for the session.
        remoteHouseholdIds = null;
        throw error;
      });
  }
  return remoteHouseholdIds;
}

/** Sign-out and account switch — see `teardownHouseLocalSession`. */
export function resetHouseControlPlaneCache(): void {
  remoteHouseholdIds = null;
  controlPlaneSyncInFlight.clear();
  registeredHouseholds.clear();
}

/**
 * Record that this property is on the control plane. Persisted, so the next
 * launch does not have to ask the network before it may sync.
 *
 * Best-effort by design — the marker is a cache of a server fact, and
 * `knownRemoteHouseholdIds` rebuilds it. Failing a join over a meta write would
 * be the wrong trade.
 */
export async function markHouseHouseholdOnControlPlane(householdId: string): Promise<void> {
  try {
    await getLocalHouseStore().setMeta(registeredMetaKey(householdId), '1');
  } catch (error) {
    console.warn('[house.local] control-plane marker not persisted', householdId, error);
  }
}

/**
 * Was this property EVER registered — asked of this device alone, with no
 * network and no cached list behind it.
 *
 * `houseHouseholdIsOnControlPlane` is the wrong question for one caller:
 * `membershipWatch`, which has to tell a home this account was REMOVED from
 * apart from a home that was never shared in the first place. Both are absent
 * from `GET /v2/households`, and the helper below folds them into the same
 * answer — so deciding on it would erase a private home the moment the list came
 * back without it.
 *
 * The marker separates them, and it is durable evidence rather than a guess: it
 * is written the moment a property earns its row (an invite minted, a join
 * adopted, or the list confirming one), it survives relaunches, and
 * `removeLocalHouseProperty` clears it along with everything else that property
 * owns. A property carrying it was shared; one without it never was.
 *
 * A store that cannot be read answers false, which defers the decision by one
 * round rather than making it on nothing.
 */
export async function houseHouseholdWasRegistered(householdId: string): Promise<boolean> {
  try {
    return Boolean(await getLocalHouseStore().getMeta(registeredMetaKey(householdId)));
  } catch {
    return false;
  }
}

/**
 * Does this property have a row on the control plane?
 *
 * Read, never asserted. The leave path is the caller that matters: a property
 * with no control-plane row was never shared with anybody, so there is no
 * membership to end and the local copy is the whole of it — ending a membership
 * that does not exist would 404 and block a removal that should just happen.
 *
 * Offline reads false. A device that cannot reach the control plane cannot end a
 * membership there either, and a property that really is shared has the marker
 * set from the first time it registered.
 */
export async function houseHouseholdIsOnControlPlane(householdId: string): Promise<boolean> {
  return (await houseHouseholdControlPlaneStatus(householdId)) === 'yes';
}

/**
 * 'no' and 'unknown' are NOT the same answer, and anything user-facing has to
 * tell them apart.
 *
 * The boolean above collapses three states into false: genuinely private,
 * offline, and "the property list would not load". That is the right trade for
 * the SYNC gate — a home that cannot be confirmed shared has nothing to sync
 * either way, and it recovers on the next round. It is the wrong trade for copy.
 * A sync surface saying "This home is only on this device" off that false tells
 * a member of a real shared home who is merely in a tunnel that their home is
 * not shared, and invites them to fix it by inviting somebody who is already in
 * it. A false statement about the home is worse than the uninformative line it
 * replaced.
 *
 * Same reasoning — and the same three values — as `isStillAdmitted` in
 * `useHouseJoinWait`: a property that cannot be reached has said nothing, and
 * silence must not be reported as an answer.
 */
export type HouseControlPlaneStatus = 'yes' | 'no' | 'unknown';

export async function houseHouseholdControlPlaneStatus(
  householdId: string,
): Promise<HouseControlPlaneStatus> {
  try {
    // The marker is a local read; if IT throws, nothing is known — the property
    // list below is not evidence about a store we could not open.
    if (await getLocalHouseStore().getMeta(registeredMetaKey(householdId))) return 'yes';
  } catch {
    return 'unknown';
  }
  try {
    const remote = await knownRemoteHouseholdIds();
    if (!remote.has(householdId)) return 'no';
    await markHouseHouseholdOnControlPlane(householdId);
    return 'yes';
  } catch {
    // Offline, or the list failed. `knownRemoteHouseholdIds` already forgets its
    // cached promise on failure, so the next caller asks again rather than
    // inheriting this silence.
    return 'unknown';
  }
}

/**
 * Single-flight guard, KEYED BY PROPERTY.
 *
 * Session open runs from more than one trigger (auth hydration, foreground,
 * property switch), and each one calls this. Three simultaneous
 * `POST /v2/households` on a fresh device means one winner, two 409s, and two
 * retries of `POST …/devices` that 500 when they race the household row they
 * depend on.
 *
 * One GLOBAL promise was worse than no guard once a device holds two properties:
 * registering B behind A's in-flight promise returned A's promise, B's
 * `POST /v2/households` never happened, and B's peers never learned this device's
 * keys — so B looked enrolled and silently received nothing. Keyed per property,
 * A and B register concurrently and each still de-duplicates against itself.
 */
const controlPlaneSyncInFlight = new Map<string, Promise<void>>();

/**
 * Properties whose registration has completed at least once this process.
 *
 * Registration is what mirrors the V2 property into the LEGACY `households` /
 * `household_members` tables (`mirrorLegacyMembership`, and `ensureLegacyMirror`
 * on the 409 re-post). Every Tier-B endpoint still scoped as
 * `/households/:householdId/...` authorises against those legacy rows, so until
 * this has run once for a property, a local-first client is "not a member" of
 * its own home and every Tier-B read 403s.
 *
 * A SET, not a boolean: a device holding two properties has registered one of
 * them and not the other far more often than it has registered both.
 */
const registeredHouseholds = new Set<string>();

/**
 * Register a local property + this device's real keys with the House Worker
 * control plane. Defaults to the active property. No-op when local-first is off
 * or no session is open. Best-effort (offline OK).
 */
export async function syncLocalHouseholdToControlPlane(householdId?: string): Promise<void> {
  if (!isHouseLocalFirst() || !isLocalHouseSessionOpen()) return;
  const target = householdId ?? getActiveHouseholdId();
  if (!target) return;

  // Already done this process — the latch below exists for exactly this and was
  // never read on the way IN.
  //
  // `controlPlaneSyncInFlight` de-duplicates concurrent calls, which is a
  // different question from "has this already succeeded". So every sync cycle
  // re-ran `registerHouseholdOnce`, which POSTs `/v2/households` for a row that
  // is already there, takes the 409, re-asserts the legacy mirror and returns
  // true — correct, and entirely wasted. Observed on a device as a
  // `POST /v2/households → 409` every ~30s, once per property, for the life of
  // the process.
  //
  // Latching here rather than persisting is deliberate and matches
  // `registeredHouseholds`' own contract ("at least once this process"): the
  // legacy mirror is what Tier-B authorises against, so paying for one
  // re-assertion per launch is cheap insurance against a mirror that was dropped
  // server-side, while paying for one every 30 seconds is not. An offline launch
  // still retries, because the set is only added to on a REAL success.
  if (registeredHouseholds.has(target)) return;

  const existing = controlPlaneSyncInFlight.get(target);
  if (existing) return existing;

  const run = registerHouseholdOnce(target)
    .then((ok) => {
      // Only latch on a REAL success — an offline launch must stay retryable.
      if (ok) registeredHouseholds.add(target);
    })
    // Swallowed here rather than left to the caller: every caller floats this,
    // and the resolver throws — `removeLocalHouseProperty` can retire a property
    // while a registration queued for it is still pending. Unhandled, that race
    // turns a no-op into a red-box promise rejection.
    .catch((error: unknown) => {
      console.warn('[house.local] control-plane sync skipped', target, error);
    })
    .finally(() => {
      // Clear only OUR entry: a later call for the same property installs a new
      // one, and a blind delete would evict it and reopen the 409 storm.
      if (controlPlaneSyncInFlight.get(target) === run) {
        controlPlaneSyncInFlight.delete(target);
      }
    });
  controlPlaneSyncInFlight.set(target, run);
  return run;
}

/**
 * Register EVERY property this device holds.
 *
 * Session open used to register the active one only, which was complete while a
 * device held one property. It holds several now — and the ones it is NOT
 * looking at are exactly the ones whose peers cannot find it, because a peer
 * discovers this device's public keys from its registration. A background
 * property that never registers syncs nothing, for ever, with no error on any
 * screen.
 */
export async function syncAllLocalHouseholdsToControlPlane(): Promise<void> {
  if (!isHouseLocalFirst() || !isLocalHouseSessionOpen()) return;
  await Promise.allSettled(
    listLocalHouseProperties().map((property) =>
      syncLocalHouseholdToControlPlane(property.householdId),
    ),
  );
}

/**
 * Resolve once the legacy membership mirror is guaranteed to exist.
 *
 * **Why this exists.** `openLocalHouseSession` kicks registration off as
 * fire-and-forget — deliberately, because session open is the offline-first
 * cold-start path and must not block on a network round trip. The consequence,
 * measured on a real device run (2026-08-13): screens mount and fire Tier-B
 * requests ~2s before registration lands, producing a burst of 403s on
 * `home-projects`, `quotes/pending`, `home-budget/monthly-overview`,
 * `projects/active` and the AI-housekeeper endpoints. Every one of those same
 * calls returns 200 after registration completes — it is a startup ORDERING
 * race, not a broken authorisation model.
 *
 * So rather than blocking cold start, the 403 is made recoverable: the API
 * client awaits this and retries once (see `client.ts`).
 *
 * Returns false when the caller should NOT wait — local-first off, no session,
 * a property this device does not hold, or registration already done — so the
 * interceptor can skip the retry.
 */
export async function awaitHouseControlPlaneRegistration(householdId?: string): Promise<boolean> {
  if (!isHouseLocalFirst() || !isLocalHouseSessionOpen()) return false;
  const target = householdId ?? getActiveHouseholdId();
  if (!target) return false;
  // A property this device does not hold cannot be registered from here, and a
  // 403 on someone else's home is a real denial that must stay one.
  if (!listLocalHouseProperties().some((p) => p.householdId === target)) return false;
  if (registeredHouseholds.has(target)) return false;
  try {
    await syncLocalHouseholdToControlPlane(target);
  } catch {
    return false;
  }
  return registeredHouseholds.has(target);
}

/** Test seam — reset the per-process registration latch. */
export function __resetHouseControlPlaneRegistrationForTests(): void {
  registeredHouseholds.clear();
  controlPlaneSyncInFlight.clear();
  remoteHouseholdIds = null;
}

function httpStatusOf(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'response' in error
    ? (error as { response?: { status?: number } }).response?.status
    : undefined;
}

/**
 * This device's registration payload FOR ONE PROPERTY.
 *
 * The label rides along on every call so a rename propagates on the next session
 * open even if the rename itself was made offline (the coordinator upserts
 * `label` on re-registration).
 *
 * The keys come from that property's own session (see `sessionFor`) — this is
 * the payload where reading the active session instead would register the wrong
 * public keys against a property and break signature verification for every peer
 * in it.
 */
async function buildDevicePayload(householdId?: string): Promise<{
  deviceId: string;
  signingPublicKey: string;
  agreementPublicKey: string;
  label: string;
}> {
  const session = await sessionFor(householdId);
  return {
    deviceId: session.ledger.deviceId,
    signingPublicKey: bytesToHex(session.identity.signingPublicKey),
    agreementPublicKey: bytesToHex(session.identity.agreementPublicKey),
    label: await getLocalDeviceName(),
  };
}

/**
 * Returns whether the legacy membership mirror is now guaranteed to exist.
 *
 * This has to be a real success/failure signal, not `void`: every error path
 * below is deliberately swallowed so a fire-and-forget session open cannot
 * reject, and a caller that treats "did not throw" as "registered" would latch
 * an OFFLINE launch as done and never retry — leaving Tier-B endpoints 403ing
 * for the rest of the process.
 *
 * `true` for 201 (registered, mirror written) and for 409 (already registered —
 * the Worker's 409 path calls `ensureLegacyMirror`, which is exactly the mirror
 * we need). `false` for anything else.
 */
async function registerHouseholdOnce(householdId: string): Promise<boolean> {
  const session = await sessionFor(householdId);
  const device = await buildDevicePayload(session.householdId);

  // A MEMBER never issues a create for a property they do not own.
  //
  // `POST /v2/households` carries `displayName` from THIS device's ledger, and a
  // joined property goes down the same path — which means a member POSTing a
  // household-CREATE for the OWNER's id, carrying the member's own local name
  // for it. It is harmless today only by accident: the row already exists,
  // `createHousehold` hits a UNIQUE violation, and the 409 branch below
  // re-asserts the legacy mirror without touching `display_name`. The day that
  // endpoint becomes an upsert, the first member to sync renames the owner's
  // home for everyone in it.
  //
  // So members go straight to the branch that was always the correct one for
  // them — registering this DEVICE against a property that already exists. Same
  // call the 409 fallback makes, without needing the 409 to get there.
  const isOwner = (session.ledger.household.my_role ?? '').trim().toLowerCase() === 'owner';
  if (!isOwner) {
    try {
      await apiClient.post(`/v2/households/${session.householdId}/devices`, device, {
        headers: LF_HEADERS,
      });
      await markHouseHouseholdOnControlPlane(session.householdId);
      return true;
    } catch (deviceError) {
      // Expected while an invite is claimed but not yet approved: the device is
      // not a member server-side yet, and the next sync retries.
      console.warn('[house.local] member device registration skipped', deviceError);
      return false;
    }
  }

  try {
    await apiClient.post(
      '/v2/households',
      {
        householdId: session.householdId,
        displayName: session.ledger.household.name,
        device,
      },
      { headers: LF_HEADERS },
    );
    await markHouseHouseholdOnControlPlane(session.householdId);
    return true;
  } catch (error: unknown) {
    if (httpStatusOf(error) === 409) {
      // The row is already there — that is a registration too, and the marker
      // must record it or every launch re-asks the network for the same answer.
      await markHouseHouseholdOnControlPlane(session.householdId);
      try {
        await apiClient.post(`/v2/households/${session.householdId}/devices`, device, {
          headers: LF_HEADERS,
        });
      } catch (deviceError) {
        console.warn('[house.local] device registration skipped', deviceError);
      }
      // The 409 itself is what re-asserted the mirror, so this is a success even
      // if the follow-up device upsert failed.
      return true;
    }
    console.warn('[house.local] control-plane sync skipped', error);
    return false;
  }
}

export async function listControlPlaneHouseholds(): Promise<ControlPlaneHousehold[]> {
  const res = await apiClient.get<{ households: ControlPlaneHousehold[] }>('/v2/households', {
    headers: LF_HEADERS,
  });
  return res.data.households;
}

export async function fetchControlPlaneState(householdId: string): Promise<ControlPlaneState> {
  const res = await apiClient.get<{ state: ControlPlaneState }>(
    `/v2/households/${householdId}/state`,
    { headers: LF_HEADERS },
  );
  return res.data.state;
}

// ---------------------------------------------------------------------------
// Invites — the owner's half
// ---------------------------------------------------------------------------

export async function createLocalFirstInvite(options?: {
  role?: 'OWNER' | 'ADULT';
  ttlHours?: number;
  /** Bind the invite to one account — a copy in anyone else's hands is inert. */
  inviteeEmail?: string | null;
  /**
   * Which property to invite into. Defaults to the active one; a member of two
   * homes invites into exactly one, and it is not always the one on screen.
   */
  householdId?: string;
}): Promise<CreatedInvite> {
  const property = resolveProperty(options?.householdId);
  // Minting an invite is the moment a private ledger becomes something another
  // device has to be able to find, and it is the last moment before this POST at
  // which the row can be created — so make sure the registration has landed
  // rather than assuming session open got there first. Awaited, not floated: the
  // POST below 403s against a property the server has never heard of.
  await syncLocalHouseholdToControlPlane(property.householdId);
  const res = await apiClient.post<{ invite: CreatedInvite }>(
    `/v2/households/${property.householdId}/invites`,
    {
      role: options?.role ?? 'ADULT',
      // TTL is the server's call (an hour) unless a caller asks otherwise.
      ...(options?.ttlHours ? { ttlHours: options.ttlHours } : {}),
      ...(options?.inviteeEmail ? { inviteeEmail: options.inviteeEmail.trim() } : {}),
    },
    { headers: LF_HEADERS },
  );
  const invite = res.data.invite;
  // Kept so the SAS is still derivable if the owner leaves this screen and comes
  // back to approve — see `inviteSecretStore`.
  await rememberInviteSecret({
    inviteId: invite.inviteId,
    secret: invite.secret,
    expiresAt: invite.expiresAt,
  });
  return invite;
}

/** An invite this property has out in the world, claimed or not. */
export type OutstandingInvite = {
  inviteId: string;
  shortCode: string;
  /** `active` — nobody has claimed it yet; `claimed` — someone is waiting. */
  status: 'active' | 'claimed';
  role: string;
  expiresAt: string;
  inviteeEmail: string | null;
  createdByUserId: string;
  createdAt: string;
  claimedByUserId: string | null;
  claimedByEmail: string | null;
  claimedByDisplayName: string | null;
};

/**
 * Every invite still in play for this property.
 *
 * Distinct from `listPendingJoinRequests`, which answers only "who is waiting"
 * and therefore cannot see a code nobody has claimed. Without this an owner who
 * minted an invite and closed the app had no way back to it: the code lived in
 * the screen's memory and nowhere else, so it could be neither shown again nor
 * cancelled — a code sent to the wrong person, or screenshotted into a group
 * chat, stayed live until it expired.
 */
export async function listOutstandingInvites(householdId?: string): Promise<OutstandingInvite[]> {
  const property = resolveProperty(householdId);
  const res = await apiClient.get<{ invites: OutstandingInvite[] }>(
    `/v2/households/${property.householdId}/invites/outstanding`,
    { headers: LF_HEADERS },
  );
  return res.data.invites ?? [];
}

/**
 * Take an invite out of play before anyone is approved.
 *
 * Refused by the control plane once the invite is approved — that device is
 * enrolled, and removing it is device revocation, a different act with different
 * consequences.
 *
 * The two refusals are translated here rather than left as raw axios errors,
 * because both mean the same thing to the caller and neither means what a bare
 * `catch` would assume: the invite is no longer cancellable, the row that
 * offered the button is stale, and retrying cannot change either. Everything
 * else — timeouts, 5xx, a real offline — is rethrown untouched, and only those
 * deserve "check you are online".
 */
export async function revokeLocalFirstInvite(
  inviteId: string,
  householdId?: string,
): Promise<void> {
  const property = resolveProperty(householdId);
  try {
    await apiClient.post(
      `/v2/households/${property.householdId}/invites/${inviteId}/revoke`,
      {},
      { headers: LF_HEADERS },
    );
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status !== 409 && status !== 404) throw error;
    // Spent either way: an approved invite has already enrolled its device and a
    // vanished one can never be claimed, so the secret this device is holding
    // for it is dead weight and goes with the same tidy-up the success path does.
    await forgetInviteSecret(inviteId);
    throw status === 409 ? new HouseInviteAlreadyApprovedError() : new HouseInviteGoneError();
  }
  await forgetInviteSecret(inviteId);
}

/**
 * Owner side: who has claimed an invite and is waiting to be let in.
 *
 * Read from its own endpoint rather than filtered out of coordinator state,
 * because the owner needs the claimant as a person — address and device name —
 * which only the control plane's own tables can supply.
 *
 * The property is a parameter because an owner of several checks all of them
 * from one screen, and `resolveProperty` answers without hydrating any of them.
 */
export async function listPendingJoinRequests(householdId?: string): Promise<PendingJoinRequest[]> {
  const property = resolveProperty(householdId);
  const res = await apiClient.get<{ pending: PendingJoinRequest[] }>(
    `/v2/households/${property.householdId}/invites/pending`,
    { headers: LF_HEADERS },
  );
  return res.data.pending ?? [];
}

/**
 * The digits the owner reads out, derived from what the control plane says the
 * claiming device holds.
 *
 * Null when this device no longer has the invite secret (a different device
 * issued the invite, or the secret was pruned) — in that case there is nothing
 * to verify against and the owner is told to re-issue rather than shown a number
 * that proves nothing.
 */
export async function deriveJoinRequestSas(request: PendingJoinRequest): Promise<string | null> {
  if (!request.claimedSigningPublicKey || !request.claimedAgreementPublicKey) return null;
  const secret = await recallInviteSecret(request.inviteId);
  if (!secret) return null;
  return deriveEnrolmentSas({
    inviteId: request.inviteId,
    inviteSecret: secret,
    signingPublicKeyHex: request.claimedSigningPublicKey,
    agreementPublicKeyHex: request.claimedAgreementPublicKey,
  });
}

/**
 * Approve a claimed invite the human has just verified by voice.
 *
 * `request` is the record whose SAS was displayed and confirmed, and its keys
 * are what the home key is wrapped to. Reading the wrap target from the approve
 * RESPONSE would leave the control plane free to show honest keys during the
 * comparison and hand back its own immediately after, wrapping the home to
 * itself with two humans having just agreed that everything matched.
 */
export async function approveLocalFirstInvite(input: {
  request: PendingJoinRequest;
  /** The property being joined. Defaults to the active one. */
  householdId?: string;
}): Promise<{ approved: { userId: string; deviceId: string; agreementPublicKey: string } }> {
  const property = resolveProperty(input.householdId);
  const { request } = input;
  if (!request.claimedSigningPublicKey || !request.claimedAgreementPublicKey) {
    throw new Error('claim_incomplete');
  }

  const res = await apiClient.post<{
    approved: { userId: string; deviceId: string; agreementPublicKey: string };
  }>(
    `/v2/households/${property.householdId}/invites/${request.inviteId}/approve`,
    {
      confirmedSigningPublicKey: request.claimedSigningPublicKey,
      confirmedAgreementPublicKey: request.claimedAgreementPublicKey,
    },
    { headers: LF_HEADERS },
  );

  // A snapshot the new member can actually bootstrap from, published BEFORE the
  // key that lets them look for it.
  //
  // The op backlog alone is not a bootstrap: it is bounded by the relay's blob
  // TTL and by whatever the sender's per-peer cursor believes was delivered, and
  // it is chunked non-atomically. The checkpoint is the designed path — and its
  // ordinary gate is an op threshold an owner with a modest ledger never clears,
  // so the home can sit on a years-old generation. Forcing one here costs the
  // owner a single upload at the one moment somebody is about to need it.
  //
  // THE ORDER IS THE FIX. This used to run after the HDK deposit, which made the
  // joiner's first sync a race: the moment the key lands it looks for a
  // checkpoint, and a snapshot of a whole home is a multi-chunk upload that
  // routinely had not finished — or had not started, on a slow link. The joiner
  // found nothing, merged a live op instead, and that one op was enough to close
  // its bootstrap window for good, leaving it holding whatever happened since
  // the join with no rooms, no appliances and no history. The joiner now retries
  // until the snapshot arrives (`runHouseholdBackfill`), so this ordering is no
  // longer load-bearing on its own — but it is what makes the FIRST attempt
  // succeed, and every retry it saves is a member not staring at an empty home.
  try {
    const { maybePublishCheckpoint } = await import('./sync/checkpoints');
    await maybePublishCheckpoint(property.householdId, { force: true });
  } catch (error) {
    console.warn('[house.local] checkpoint publish before approve handoff skipped', error);
  }

  // Deliver the HDK to the approved device via the zero-knowledge mailbox, to
  // the verified key and the device that claimed with it.
  try {
    const { depositHdkForDevice } = await import('./sync/hdkTransfer');
    await depositHdkForDevice({
      recipientDeviceId: request.claimedDeviceId ?? res.data.approved.deviceId,
      recipientAgreementPublicKeyHex: request.claimedAgreementPublicKey,
      // Named, never defaulted: WHICH property's key is wrapped is the entire
      // security content of this step. Approving into a background home while
      // another is on screen would otherwise wrap the ACTIVE home's HDK and hand
      // a member of B the key to a home they were never invited to — a break no
      // later fix takes back, because the key has left the device.
      householdId: property.householdId,
    });
  } catch (error) {
    console.warn('[house.local] HDK deposit after approve failed', error);
  }

  await forgetInviteSecret(request.inviteId);
  return res.data;
}

// ---------------------------------------------------------------------------
// Invites — the invitee's half
// ---------------------------------------------------------------------------

/**
 * Pull the code + secret out of whatever the invitee actually pasted.
 *
 * The invite is issued as a QR payload / link precisely so nobody has to retype
 * two opaque strings by hand. Accept that link, a bare `code secret` pair, or a
 * lone short code — anything else returns nulls and the caller falls back to the
 * separate fields.
 */
export function parseInviteInput(raw: string): { shortCode: string | null; secret: string | null } {
  const text = (raw ?? '').trim();
  if (!text) return { shortCode: null, secret: null };

  const fromQuery = (key: string) => {
    const m = text.match(new RegExp(`[?&]${key}=([^&\\s]+)`, 'i'));
    return m ? decodeURIComponent(m[1]!) : null;
  };
  const linkCode = fromQuery('code');
  const linkSecret = fromQuery('secret');
  if (linkCode || linkSecret) {
    return { shortCode: linkCode?.toUpperCase() ?? null, secret: linkSecret };
  }

  // "ABC123 <64-hex-ish secret>" — whitespace-separated pair.
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { shortCode: parts[0]!.toUpperCase(), secret: parts[1]! };
  }
  return { shortCode: text.toUpperCase(), secret: null };
}

/**
 * An invite as the person about to accept it needs to see it.
 *
 * `householdName` is what makes an informed answer possible. A confirmation that
 * can only name `hh_local_9f3a…` is not something anyone can meaningfully agree
 * to — least of all somebody who belongs to more than one home and has to work
 * out which one they are being let into.
 *
 * Optional in the type because a Worker that predates this field answers without
 * it; the UI says "their home" rather than inventing a name.
 */
export type LocalFirstInviteLookup = {
  inviteId: string;
  householdId: string;
  householdName?: string | null;
  status: string;
  expiresAt: string;
};

/** Resolve a short code an invitee typed in to the property + invite it belongs to. */
export async function lookupLocalFirstInvite(shortCode: string): Promise<LocalFirstInviteLookup> {
  const res = await apiClient.get<{ invite: LocalFirstInviteLookup }>('/v2/invites/lookup', {
    headers: LF_HEADERS,
    params: { code: shortCode.trim().toUpperCase() },
  });
  return res.data.invite;
}

/**
 * The same, by invite id — how a device that already claimed learns its fate.
 *
 * A claim leaves this device waiting on somebody else's tap, and that wait can
 * end in three ways the device is never told about directly: approved (the key
 * arrives by mailbox), revoked, or expired. Push covers the live case; this
 * covers the one where the app was closed when it happened, so the screen does
 * not go on saying "Waiting for approval…" about an invite that died yesterday.
 */
export async function lookupLocalFirstInviteById(
  inviteId: string,
): Promise<LocalFirstInviteLookup> {
  const res = await apiClient.get<{ invite: LocalFirstInviteLookup }>('/v2/invites/lookup', {
    headers: LF_HEADERS,
    params: { id: inviteId },
  });
  return res.data.invite;
}

export async function claimLocalFirstInvite(input: {
  householdId: string;
  inviteId: string;
  secret: string;
}): Promise<unknown> {
  // Read off the DEVICE, not off a ledger. The invitee may hold no household at
  // all — a new account that was never given one — and that device is exactly
  // the one claiming.
  const deviceId = getLocalHouseDeviceId();
  const identity = getLocalHouseIdentity();
  try {
    const res = await apiClient.post(
      `/v2/households/${input.householdId}/invites/${input.inviteId}/claim`,
      {
        secret: input.secret,
        deviceId,
        signingPublicKey: bytesToHex(identity.signingPublicKey),
        agreementPublicKey: bytesToHex(identity.agreementPublicKey),
      },
      { headers: LF_HEADERS },
    );
    return res.data;
  } catch (error) {
    // Named while the refusal still has its reason attached. Everything after
    // this point sees one failed claim and cannot tell "the invite is minutes
    // from expiry" — the one refusal the invitee can act on — from a code typed
    // wrong, and the generic advice to re-check the code sends them to re-read a
    // perfectly good one.
    if (axios.isAxiosError(error) && error.response?.status === 409) {
      const code = (error.response.data as { error?: { code?: string } } | undefined)?.error?.code;
      if (code === 'invite_expiring') throw new HouseInviteExpiringError();
    }
    throw error;
  }
}

/**
 * Invitee side of enrolment: resolve the code, claim it with this device's
 * public keys, and ADD the joined property to this device.
 *
 * The home data key is NOT delivered here — the owner still has to compare the
 * returned SAS against the one on their screen and approve, after which the
 * wrapped HDK lands in this device's mailbox and `tryAcceptHdkFromMailbox`
 * installs it on the next sync. Writes stay paused until then (see
 * `adoptJoinedHousehold`).
 *
 * The SAS is derived here from THIS device's own keys — never from anything the
 * response carries. That is the entire point: the digits assert what this device
 * actually holds, so that when the owner's device derives the same digits from
 * what the control plane told it, the two agreeing means the control plane
 * relayed the real key.
 */
export async function joinLocalFirstHousehold(input: {
  shortCode: string;
  secret: string;
}): Promise<{ householdId: string; inviteId: string; sas: string }> {
  // A device with no home of its own still has to present a keypair to claim,
  // and since sign-up stopped minting a home nobody asked for, "no home of its
  // own" is the ordinary state of an invitee who has just made an account. A
  // no-op once a session is open, so a member joining a second home keeps the
  // identity their existing home already knows them by.
  const { user } = useAuthStore.getState();
  if (!user?.id) throw new HouseLocalNotReadyError();
  await openHouseDeviceForEnrolment({ userId: user.id });

  const invite = await lookupLocalFirstInvite(input.shortCode);
  const secret = input.secret.trim();
  await claimLocalFirstInvite({
    householdId: invite.householdId,
    inviteId: invite.inviteId,
    secret,
  });
  const identity = getLocalHouseIdentity();
  const sas = deriveEnrolmentSas({
    inviteId: invite.inviteId,
    inviteSecret: secret,
    signingPublicKeyHex: bytesToHex(identity.signingPublicKey),
    agreementPublicKeyHex: bytesToHex(identity.agreementPublicKey),
  });
  // Persisted BEFORE the adopt, because what follows unmounts the screen that
  // called this, taking any in-memory copy with it. The invitee has to be able
  // to read these digits out afterwards.
  await rememberJoinSas({
    inviteId: invite.inviteId,
    householdId: invite.householdId,
    sas,
  });
  if (__DEV__) {
    // Emitted HERE, not from the screen: `adoptJoinedHousehold` below switches
    // property, which unmounts whatever screen called this. A marker logged
    // after that never runs.
    console.log(`[E2E-JOIN-SAS] sas=${sas}`);
  }
  // The NAME comes with the invite and must be carried in.
  //
  // It is the only chance to get it: the property name lives in each device's
  // sealed identity blob and no op type carries a rename — so there is nothing
  // for a peer to merge later and nothing on the control plane that repairs it.
  // Dropped here, the joined home reads "Shared home" in the switcher for ever,
  // beside the member's own home, with no way to tell which is which.
  await adoptJoinedHousehold({
    householdId: invite.householdId,
    displayName: invite.householdName ?? null,
  });
  // Shared by definition — this device just claimed an invite into someone
  // else's home, so it must sync from the next tick without first asking the
  // network whether the property counts.
  await markHouseHouseholdOnControlPlane(invite.householdId);
  // Publish the FULL set. Replacing `households` with only the joined one hides
  // the member's own home in the switcher the moment the invite is claimed.
  syncHouseholdStoreFromLocalLedger();
  return { householdId: invite.householdId, inviteId: invite.inviteId, sas };
}

// ---------------------------------------------------------------------------
// Mailbox — every call names a property
// ---------------------------------------------------------------------------

/**
 * The mailbox is where a wrong property is most expensive, and least visible: a
 * deposit under the wrong id lands ops sealed with B's HDK in A's mailbox,
 * addressed to A's peers, who cannot open them and never ack them. So all three
 * mailbox calls take the property, and background sync must pass it — the
 * default to active exists for the enrolment screens, not for the pollers.
 *
 * It rides in the options bag rather than as a fourth positional so the call
 * site has to name it: a mailbox call that silently defaults to whatever is on
 * screen is the exact bug this parameter exists to prevent.
 */
export async function depositMailboxBlob(
  ciphertext: Uint8Array,
  recipientDeviceId?: string,
  options?: { wake?: boolean; householdId?: string },
) {
  const property = resolveProperty(options?.householdId);
  const res = await apiClient.post(
    `/v2/households/${property.householdId}/mailbox`,
    {
      recipientDeviceId: recipientDeviceId ?? null,
      // The Worker verifies this belongs to the caller (H0 security fix) — a
      // member may not deposit as an arbitrary source device.
      sourceDeviceId: property.deviceId,
      ciphertextBase64: bytesToBase64(ciphertext),
      // Suppressed on all but the last chunk so a multi-chunk push does not wake
      // every peer once per chunk.
      ...(options?.wake === undefined ? {} : { wake: options.wake }),
    },
    { headers: LF_HEADERS },
  );
  return res.data;
}

export async function fetchMailboxBlobs(
  cursor?: string,
  householdId?: string,
): Promise<{
  blobs: Array<{ blobId: string; ciphertext: Uint8Array; recipientDeviceId: string | null }>;
  hasMore: boolean;
  nextCursor?: string;
}> {
  const property = resolveProperty(householdId);
  const res = await apiClient.get<{
    blobs: Array<{
      blobId: string;
      ciphertextBase64: string;
      recipientDeviceId?: string | null;
    }>;
    hasMore?: boolean;
    cursor?: string;
  }>(`/v2/households/${property.householdId}/mailbox`, {
    headers: LF_HEADERS,
    // Without the cursor every page is the oldest page: paging on ack alone
    // cannot step over a blob that is never ackable (any broadcast), and the
    // mailbox stops delivering everything behind it.
    params: { deviceId: property.deviceId, ...(cursor ? { cursor } : {}) },
  });
  const blobs = (res.data.blobs ?? []).map((b) => ({
    blobId: b.blobId,
    ciphertext: base64ToBytes(b.ciphertextBase64),
    // Kept, not discarded: only mail ADDRESSED to this device may be acked. A
    // broadcast blob is addressed to every peer, so acking it on receipt would
    // destroy it for the others.
    recipientDeviceId: b.recipientDeviceId ?? null,
  }));
  return {
    blobs,
    hasMore: res.data.hasMore === true,
    ...(res.data.cursor ? { nextCursor: res.data.cursor } : {}),
  };
}

export async function ackMailboxBlobs(
  blobIds: string[],
  deviceId?: string,
  householdId?: string,
): Promise<void> {
  if (blobIds.length === 0) return;
  const property = resolveProperty(householdId);
  await apiClient.post(
    `/v2/households/${property.householdId}/mailbox/ack`,
    { blobIds, deviceId: deviceId ?? property.deviceId },
    { headers: LF_HEADERS },
  );
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/**
 * The key epoch this device holds for a property — the helper kept for callers
 * that need the epoch without leaking the key itself.
 *
 * Asynchronous: an epoch is per-property state, and per-property key material is
 * only reachable through the session handle, which hydrates a property on first
 * use. The active property is already hydrated, so the common call resolves
 * without touching disk.
 */
export async function getLocalKeyEpoch(householdId?: string): Promise<number> {
  const session = await sessionFor(householdId);
  return session.householdKeys.keyEpoch;
}

/**
 * Rename THIS device and push the new label to the control plane, so the rest of
 * the home sees a name instead of `dev_652de89b0240`.
 *
 * The local write happens first and is what the UI trusts: the label is
 * cosmetic, so a failed push (offline, or a peer that has not re-synced) must
 * not lose the rename. Registration re-sends it on the next session open.
 * Returns the resolved name — an empty input clears the override and resolves
 * back to the OS suggestion.
 *
 * The NAME is device-scoped but a registration is per property, so this pushes
 * to one of them. The rest converge on their own next registration, which
 * carries the current label (`buildDevicePayload`) — no fan-out needed, and none
 * attempted, because a rename must not block on N round trips.
 */
export async function renameLocalFirstDevice(
  rawName: string,
  householdId?: string,
): Promise<{ name: string; state: ControlPlaneState | null }> {
  const name = await setLocalDeviceName(rawName);
  try {
    const property = resolveProperty(householdId);
    const res = await apiClient.post<{ state: ControlPlaneState }>(
      `/v2/households/${property.householdId}/devices`,
      await buildDevicePayload(property.householdId),
      { headers: LF_HEADERS },
    );
    return { name, state: res.data.state };
  } catch (error) {
    console.warn('[house.local] device rename not pushed yet', error);
    return { name, state: null };
  }
}

/**
 * After an epoch rotation: hand the new key to every device that is still in.
 *
 * `generateHouseholdKeys` mints a RANDOM key, so a rotation is not something the
 * other devices can derive — it has to be delivered, exactly as enrolment
 * delivers the first one. Without this, every revoke silently locks the home's
 * remaining devices out of everything written afterwards: they keep syncing,
 * keep acking nothing, and diverge with no error on any screen.
 *
 * Best-effort per device and never throws: the revocation itself has already
 * succeeded server-side, and a device that misses this wrap is no worse off than
 * it was before — the next rotation, or a re-enrolment, delivers again. The wrap
 * carries the whole retired ring, so a device that missed several rotations
 * catches up in one.
 */
async function rewrapHouseholdKeyForPeers(
  householdId: string,
  state: ControlPlaneState,
  ownDeviceId: string,
): Promise<void> {
  const peers = state.devices.filter(
    (device) =>
      device.status === 'active' && device.deviceId !== ownDeviceId && device.agreementPublicKey,
  );
  if (peers.length === 0) return;
  try {
    const { depositHdkForDevice } = await import('./sync/hdkTransfer');
    for (const peer of peers) {
      try {
        await depositHdkForDevice({
          recipientDeviceId: peer.deviceId,
          recipientAgreementPublicKeyHex: peer.agreementPublicKey,
          householdId,
        });
      } catch (error) {
        console.warn('[house.local] key rewrap skipped for device', peer.deviceId, error);
      }
    }
  } catch (error) {
    console.warn('[house.local] key rewrap skipped', householdId, error);
  }
}

/**
 * Republish the home snapshot under the epoch that is now current.
 *
 * A checkpoint is sealed once and never re-sealed, so the moment the key rotates
 * the home's newest snapshot becomes unreadable to anyone holding only the new
 * key — including every future joiner. Owner-only and best-effort;
 * `maybePublishCheckpoint` makes the role decision itself.
 */
async function republishCheckpointAfterRotation(householdId: string): Promise<void> {
  try {
    const { maybePublishCheckpoint } = await import('./sync/checkpoints');
    await maybePublishCheckpoint(householdId, { force: true });
  } catch (error) {
    console.warn('[house.local] checkpoint republish after rotation skipped', error);
  }
}

/**
 * Revoke a device on the control plane and rotate the local HDK to the new key
 * epoch. Revoked peers keep the old HDK and cannot open ops sealed under the new
 * epoch. Remaining peers receive the new HDK by mailbox.
 *
 * A revocation is scoped to ONE property — the same device can stay enrolled in
 * the member's other homes — so both the DELETE and the rotation that follows
 * name it. Without `forHouseholdId` on the install, revoking a device in a
 * background home would rotate the ACTIVE home's key instead: every peer of an
 * untouched home locked out, and the revoked device still able to read the one
 * it was removed from.
 */
export async function revokeLocalFirstDevice(
  deviceId: string,
  householdId?: string,
): Promise<ControlPlaneState> {
  const session = await sessionFor(householdId);
  const res = await apiClient.delete<{ state: ControlPlaneState }>(
    `/v2/households/${session.householdId}/devices/${encodeURIComponent(deviceId)}`,
    { headers: LF_HEADERS },
  );
  const state = res.data.state;
  // Re-read rather than trust the handle taken before the round trip: the handle
  // is a snapshot copy, and an HDK arriving by mailbox mid-request swaps the
  // session's keys underneath it. Comparing against a stale epoch would
  // reinstall a key this device already retired.
  const current = await getLocalHouseSession(session.householdId);
  if (state.keyEpoch > current.householdKeys.keyEpoch) {
    await installHouseholdKeys(
      generateHouseholdKeys(session.householdId, state.keyEpoch),
      session.householdId,
    );
    // The key this device just minted is random and exists nowhere else yet.
    await rewrapHouseholdKeyForPeers(session.householdId, state, current.ledger.deviceId);
    await republishCheckpointAfterRotation(session.householdId);
  }
  return state;
}

/**
 * Revoke a device from a property this phone does NOT hold a ledger for.
 *
 * The sibling above is the normal path and is bound to a local session: it
 * re-reads the session after the round trip and installs the rotated home key.
 * Neither step is possible — or meaningful — here. An owner who wiped or
 * replaced the phone they administered a home from keeps their membership
 * server-side but holds no ledger, no session and no key for it, so `sessionFor`
 * throws and the home becomes unadministrable: its device list can be read by
 * every OTHER member and cleaned up by none of them.
 *
 * The epoch still rotates server-side, and the devices that DO hold the property
 * pick it up on their next sync. This phone has nothing to install because it
 * holds nothing to re-encrypt.
 */
export async function revokeRemoteHouseholdDevice(
  householdId: string,
  deviceId: string,
): Promise<ControlPlaneState> {
  const res = await apiClient.delete<{ state: ControlPlaneState }>(
    `/v2/households/${householdId}/devices/${encodeURIComponent(deviceId)}`,
    { headers: LF_HEADERS },
  );
  return res.data.state;
}

/**
 * Drop an already-revoked device off the home's record.
 *
 * Not a revocation and not a second one: the server refuses anything still
 * active (409), the key epoch does not move, and nothing has to be installed
 * locally — which is why this takes no session, unlike `revokeLocalFirstDevice`.
 * The property is named rather than resolved from a session for the same reason
 * it is there: the list on screen belongs to ONE home, and by the time this
 * resolves the active one may be another.
 *
 * The whole registry comes back, so the caller repaints from the answer instead
 * of re-fetching and briefly showing the row it just deleted.
 */
export async function forgetLocalFirstDevice(
  householdId: string,
  deviceId: string,
): Promise<ControlPlaneState> {
  const res = await apiClient.delete<{ state: ControlPlaneState }>(
    `/v2/households/${householdId}/devices/${encodeURIComponent(deviceId)}/record`,
    { headers: LF_HEADERS },
  );
  return res.data.state;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/**
 * Promote a member to owner, or hand a former owner back to member.
 *
 * No key rotation and no session needed: a role is a permission, and the home
 * key material does not move. The whole registry comes back so the caller can
 * publish the new roster without a second round trip — the list the owner is
 * looking at is the one they just changed, and re-fetching it is how a screen
 * ends up showing the old role for a second.
 */
export async function setHouseMemberRole(input: {
  userId: string;
  role: 'OWNER' | 'ADULT';
  /** Which property. Defaults to the active one — the list on screen. */
  householdId?: string;
}): Promise<ControlPlaneState> {
  const property = resolveProperty(input.householdId);
  const res = await apiClient.patch<{ state: ControlPlaneState }>(
    `/v2/households/${property.householdId}/members/${encodeURIComponent(input.userId)}`,
    { role: input.role },
    { headers: LF_HEADERS },
  );
  return res.data.state;
}

/**
 * Remove someone from a home — the person, and with them every device they hold
 * in it.
 *
 * The member-shaped sibling of `revokeLocalFirstDevice`, and it rotates for the
 * same reason: the home key the removed devices hold must stop opening anything
 * written from here on. Revoking their devices one at a time is NOT this — that
 * leaves the membership standing, so they can enrol a new device and be back in
 * the home before the owner has put the phone down.
 *
 * Scoped to ONE property, like every other revocation: the same person can
 * remain in the member's other homes, so the DELETE and the rotation that
 * follows both name this one.
 */
export async function removeHouseHouseholdMember(input: {
  userId: string;
  householdId?: string;
}): Promise<ControlPlaneState> {
  const session = await sessionFor(input.householdId);
  const res = await apiClient.delete<{ state: ControlPlaneState }>(
    `/v2/households/${session.householdId}/members/${encodeURIComponent(input.userId)}`,
    { headers: LF_HEADERS },
  );
  const state = res.data.state;
  // Re-read rather than trust the handle taken before the round trip — same
  // reason as `revokeLocalFirstDevice`.
  const current = await getLocalHouseSession(session.householdId);
  if (state.keyEpoch > current.householdKeys.keyEpoch) {
    await installHouseholdKeys(
      generateHouseholdKeys(session.householdId, state.keyEpoch),
      session.householdId,
    );
    await rewrapHouseholdKeyForPeers(session.householdId, state, current.ledger.deviceId);
    await republishCheckpointAfterRotation(session.householdId);
  }
  return state;
}

/**
 * Leave a home: end your OWN membership, and take every device you hold in it
 * off the home's record.
 *
 * Deliberately server-side only. What happens to this phone's copy is the
 * caller's to sequence, because it is the irreversible half — the ledger, its
 * history and its sync cursors are erased by `removeLocalHouseProperty`, and
 * that has to happen after the home has agreed you are out rather than before,
 * or a failed request leaves a member with no home and a membership they cannot
 * see.
 *
 * No key rotation here, and none possible: the epoch moves server-side so the
 * ops written from now on cannot be opened with the key this phone keeps, and
 * the one device that must NOT mint the home's next key is the one walking out
 * with the old one. The members who stay rotate on their own next sync.
 *
 * 404 means the membership is already gone — removed by an owner while this
 * phone was offline. That is not a failure of leaving; it is leaving, already
 * done, and the caller should finish the local half exactly the same way.
 */
export async function leaveHouseHousehold(householdId: string): Promise<ControlPlaneState | null> {
  const res = await apiClient.post<{ state: ControlPlaneState }>(
    `/v2/households/${householdId}/leave`,
    {},
    { headers: LF_HEADERS },
  );
  return res.data.state ?? null;
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

export type RemoteCheckpointManifest = {
  v: 1;
  householdId: string;
  generation: number;
  versionVector: Record<string, number>;
  chunkCount: number;
  rootHash: string;
  signerDeviceId: string;
  signatureB64: string;
};

export async function putCheckpointChunk(input: {
  householdId: string;
  generation: number;
  chunkIndex: number;
  chunkCount: number;
  ciphertextBase64: string;
  manifest?: RemoteCheckpointManifest;
}): Promise<void> {
  await apiClient.put(
    `/v2/households/${input.householdId}/checkpoints`,
    {
      generation: input.generation,
      chunkIndex: input.chunkIndex,
      chunkCount: input.chunkCount,
      ciphertextBase64: input.ciphertextBase64,
      ...(input.manifest ? { manifest: input.manifest } : {}),
    },
    { headers: LF_HEADERS },
  );
}

export async function fetchLatestCheckpoint(householdId: string): Promise<{
  generation: number;
  chunkCount: number;
  expiresAt: string;
  manifest: RemoteCheckpointManifest;
} | null> {
  try {
    const res = await apiClient.get<{
      generation: number;
      chunkCount: number;
      expiresAt: string;
      manifest: RemoteCheckpointManifest;
    }>(`/v2/households/${householdId}/checkpoints/latest`, { headers: LF_HEADERS });
    return res.data;
  } catch (error: unknown) {
    if (httpStatusOf(error) === 404) return null;
    throw error;
  }
}

export async function fetchCheckpointChunk(
  householdId: string,
  index: number,
): Promise<{ generation: number; chunkIndex: number; ciphertextBase64: string }> {
  const res = await apiClient.get<{
    generation: number;
    chunkIndex: number;
    ciphertextBase64: string;
  }>(`/v2/households/${householdId}/checkpoints/latest/chunks/${index}`, {
    headers: LF_HEADERS,
  });
  return res.data;
}
