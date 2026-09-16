import axios from 'axios';

import { apiClient } from '@api/client';
import {
  forgetInviteSecret,
  recallInviteSecret,
  rememberInviteSecret,
  rememberJoinSas,
} from '@services/enrolment/inviteSecretStore';
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
  getActiveBudgetHouseholdId,
  getLocalBudgetSession,
  getLocalIdentity,
  getLocalLedger,
  getLocalStore,
  installHouseholdKeys,
  isLocalBudgetSessionOpen,
  listLocalBudgetHouseholds,
  type BudgetHouseholdSummary,
  type BudgetSessionHandle,
} from './engine';
import { syncHouseholdStoreFromLocalLedger } from './ensureSession';
import {
  BudgetInviteAlreadyApprovedError,
  BudgetInviteExpiringError,
  BudgetInviteGoneError,
  BudgetLocalNotReadyError,
  BudgetLocalUnknownHouseholdError,
} from './errors';
import { isBudgetLocalFirst } from './flag';

const LF_HEADERS = { 'X-Budget-Local-First': '1' };

/**
 * The brand's URL scheme, verified at `brands/symply-budget/brand.cjs:9`.
 *
 * NOT `symply-budget://` — that is the app's *code id*, not a scheme, and it is
 * exactly what the shared Worker hands back in `invite.qrPayload`
 * (`local-first-v2.ts:553`). It parses fine and opens nothing on either
 * platform, which is why the invite used to be a code and a secret read out
 * loud. House and Health already rebuild the link client-side for the same
 * reason (`buildHouseInviteLink`, `buildHealthEnrolmentLink`); this is Budget's.
 */
export const BUDGET_INVITE_LINK_SCHEME = 'simplebudget';

/**
 * The link an invite is shared as — `simplebudget://lf-invite?id=…&secret=…&code=…`.
 *
 * Carries both halves the invitee needs, so tapping it fills the Join fields
 * for them (see `inviteLinkStore`). Deliberately does NOT carry the
 * out-of-band word: that one is the owner's half of the verification, and a
 * link that hands it to the person being verified checks nothing at all.
 */
export function buildBudgetInviteLink(invite: {
  inviteId: string;
  shortCode: string;
  secret: string;
}): string {
  const params = new URLSearchParams({
    id: invite.inviteId,
    secret: invite.secret,
    code: invite.shortCode,
  });
  return `${BUDGET_INVITE_LINK_SCHEME}://lf-invite?${params.toString()}`;
}

export type ControlPlaneHousehold = {
  id: string;
  display_name: string;
  role: string;
  key_epoch: number;
};

/**
 * A claimed invite awaiting the owner's approval, as the owner sees it.
 *
 * Carries a person (address, display name, device name) so the owner has
 * something to refuse on, and the claimed public keys so the owner's device can
 * derive the enrolment SAS and — after the human confirms — wrap the household
 * key to the key it verified.
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
 * Who a member is, joined onto coordinator state by the Worker.
 *
 * Every field is OPTIONAL on purpose: a peer running a build from before the
 * server sent these, or a server whose profile lookup failed, still returns a
 * usable roster — the UI falls back to initials and "Household member" rather
 * than rendering `undefined`. See `local-first-control-service.ts`.
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
   * When this device last reached the household, stamped server-side by its own
   * sync poll. Absent on records enrolled before liveness tracking existed —
   * treat that as "unknown", never as "never".
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
// Which household a call addresses (BR-016 B3)
// ---------------------------------------------------------------------------

/**
 * Resolve the household a control-plane call is about: the named one, or the
 * active one when the caller does not care (every screen).
 *
 * Every function below used to read `getLocalLedger()` — the ACTIVE session —
 * which is right for a screen and wrong for anything running in the background.
 * With two households on one device that meant a mailbox poll for B fetching A's
 * mail under B's cursor, and a deposit of B's ops landing in A's mailbox
 * addressed to A's peers: correctly encrypted, wrong household, invisible.
 *
 * SYNCHRONOUS and cold-safe on purpose. It reads only `listLocalBudgetHouseholds`,
 * which the engine builds from cold-session fields, so an owner polling pending
 * join requests across three households does not decrypt three ledgers just to
 * learn three ids — that would undo the lazy hydration B2 exists for.
 *
 * The two errors are not interchangeable: no session at all means "sign in",
 * while a household this device does not hold is a stale id (a sync cursor for a
 * household just removed, a screen holding an id across a switch) that signing in
 * cannot fix.
 */
function resolveHousehold(householdId?: string): BudgetHouseholdSummary {
  const target = householdId ?? getActiveBudgetHouseholdId();
  if (!target) throw new BudgetLocalNotReadyError();
  const summary = listLocalBudgetHouseholds().find((h) => h.householdId === target);
  if (!summary) throw new BudgetLocalUnknownHouseholdError(target);
  return summary;
}

/**
 * The same target, hydrated — for the calls that need this household's own KEY
 * MATERIAL rather than just its address.
 *
 * Deliberately not `getLocalIdentity()` / `getLocalHouseholdKeys()`, which read
 * the active session: a session built from disk carries the keypair its own ops
 * were signed with, so publishing the active household's public keys under
 * household B's registration would leave B's peers verifying B's ops against a
 * key that never signed them.
 *
 * Hydration is the price, and it is the right one: every caller here is either
 * the active household (already hydrated, so this is a map lookup) or a
 * background sync that is about to decrypt that household's rows anyway.
 */
function sessionFor(householdId?: string): Promise<BudgetSessionHandle> {
  return getLocalBudgetSession(resolveHousehold(householdId).householdId);
}

// ---------------------------------------------------------------------------
// Which households get a server row at all
// ---------------------------------------------------------------------------

/**
 * A household this device knows the control plane holds a row for.
 *
 * Keyed by household id because every household on a device shares ONE store —
 * the same reason `engine`'s identity and checkpoint keys are keyed.
 */
/** Purged by `removeLocalBudgetHousehold` — keep the string in step with its list. */
const registeredMetaKey = (householdId: string) => `lf.cp.registered:${householdId}`;

/**
 * The households this ACCOUNT already has on the control plane — asked once per
 * session, and asked with a GET, which is the entire point.
 *
 * It is how a device that predates the marker above learns that a household it
 * holds is genuinely shared, without a POST that would CREATE the row if it
 * were not. Cached because session open asks it once per household and the
 * answer cannot change underneath one run; dropped on teardown
 * (`resetBudgetControlPlaneCache`) so the next account does not inherit it.
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

/** Sign-out and account switch — see `teardownBudgetLocalSession`. */
export function resetBudgetControlPlaneCache(): void {
  remoteHouseholdIds = null;
}

/**
 * Record that this household is on the control plane: an invite was just minted
 * for it, or this device just joined it. Persisted, so the next launch does not
 * have to ask the network before it may sync.
 *
 * Best-effort by design — the marker is a cache of a server fact, and
 * `knownRemoteHouseholdIds` rebuilds it. Failing a join over a meta write would
 * be the wrong trade.
 */
export async function markBudgetHouseholdOnControlPlane(householdId: string): Promise<void> {
  try {
    await getLocalStore().setMeta(registeredMetaKey(householdId), '1');
  } catch (error) {
    console.warn('[budget.local] control-plane marker not persisted', householdId, error);
  }
}

/**
 * Was this household EVER registered — asked of this device alone, with no
 * network and no cached list behind it.
 *
 * `budgetHouseholdIsOnControlPlane` is the wrong question for one caller:
 * `membershipWatch`, which has to tell a household this account was REMOVED
 * from apart from a household that was never shared in the first place. Both
 * are absent from `GET /v2/households`, and the status helper folds them into
 * the same answer — so deciding on it would erase a solo budget the moment the
 * list came back without it.
 *
 * The marker separates them, and it is durable evidence rather than a guess: it
 * is written the moment a household earns its row (an invite minted, a join
 * adopted, or the list confirming one), it survives relaunches, and
 * `removeLocalBudgetHousehold` clears it along with everything else that
 * household owns. A household carrying it was shared; one without it never was.
 *
 * A store that cannot be read answers false, which defers the decision by one
 * round rather than making it on nothing.
 */
export async function budgetHouseholdWasRegistered(householdId: string): Promise<boolean> {
  try {
    return Boolean(await getLocalStore().getMeta(registeredMetaKey(householdId)));
  } catch {
    return false;
  }
}

/**
 * Does this household have — and need — a row on the control plane?
 *
 * The answer used to be "yes, always", and that is what filled production with
 * household debris. `openLocalBudgetSession` mints a fresh `hh_local_*` whenever
 * the device has no ledger on disk — a reinstall, a wipe, "Clean up previous
 * data", an account switch — and session open then POSTed it. Every local reset
 * left one more permanently orphaned household on the server: named after the
 * member, one device, no invites, no second member, and no way to delete it from
 * the app. (Observed 2026-08-22 in production: 13 such rows across two accounts,
 * five of them one member's, every one of them listed back to that member under
 * "Other households on your account".)
 *
 * The rule now: a solo household is a file on this phone, not an account object.
 * It earns a row the first time it needs a peer to find it — an invite minted
 * for it, or a join that adopted someone else's. Every other caller READS this
 * answer instead of asserting it.
 *
 * Offline reads false. A sync that cannot reach the control plane has nothing to
 * do either way, and a household that really is shared has the marker set from
 * the first time it was online — so this only defers a device that has never
 * synced since the marker existed, and it defers it by one round.
 */
export async function budgetHouseholdIsOnControlPlane(householdId: string): Promise<boolean> {
  return (await budgetHouseholdControlPlaneStatus(householdId)) === 'yes';
}

/**
 * 'no' and 'unknown' are NOT the same answer, and anything user-facing has to
 * tell them apart.
 *
 * The boolean above collapses three states into false: genuinely solo, offline,
 * and "the household list would not load". That is the right trade for the SYNC
 * gate — a household that cannot be confirmed shared has nothing to sync either
 * way, and it recovers on the next round. It is the wrong trade for copy. The
 * sync screen said "This budget is only on this device" off that false, so a
 * member of a real shared household who was merely in a tunnel got told their
 * budget is not shared, and was invited to fix it by inviting somebody who is
 * already a member. A false statement about the household is worse than the
 * uninformative line it replaced.
 *
 * Same reasoning — and the same three values — as `isStillAdmitted` in
 * `useBudgetJoinWait`: a household that cannot be reached has said nothing, and
 * silence must not be reported as an answer.
 */
export type BudgetControlPlaneStatus = 'yes' | 'no' | 'unknown';

export async function budgetHouseholdControlPlaneStatus(
  householdId: string,
): Promise<BudgetControlPlaneStatus> {
  try {
    // The marker is a local read; if IT throws, nothing is known — the
    // household list below is not evidence about a store we could not open.
    if (await getLocalStore().getMeta(registeredMetaKey(householdId))) return 'yes';
  } catch {
    return 'unknown';
  }
  try {
    const remote = await knownRemoteHouseholdIds();
    if (!remote.has(householdId)) return 'no';
    await markBudgetHouseholdOnControlPlane(householdId);
    return 'yes';
  } catch {
    // Offline, or the list failed. `knownRemoteHouseholdIds` already forgets its
    // cached promise on failure, so the next caller asks again rather than
    // inheriting this silence.
    return 'unknown';
  }
}

/**
 * Earn the row NOW, because a server-authoritative endpoint just refused us.
 *
 * The gate above is right about the common case and blind to one thing: Budget
 * is local-first for its own data, but chat, the assistant room, reports and
 * notifications are still `/households/:householdId/...` endpoints that
 * authorise against the LEGACY `household_members` mirror — the mirror that
 * only exists once this household has been registered. So a household that
 * never registers is not merely absent from the control plane; it is a
 * household whose owner gets 403 the moment they open chat.
 *
 * Registering eagerly to avoid that is what filled the database in the first
 * place. Registering HERE — from the API client's 403 retry, the same seam
 * House already uses (`awaitHouseControlPlaneRegistration`) — keeps both
 * properties: a member who never touches a server-backed feature never creates
 * a row, and one who does gets the row created under them and the call retried
 * once, with no visible failure.
 *
 * Returns whether the household is registered afterwards, so the interceptor
 * knows whether a retry is worth making.
 */
export async function awaitBudgetControlPlaneRegistration(householdId: string): Promise<boolean> {
  if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) return false;
  // A household this device does not hold cannot be registered from here, and a
  // 403 on someone else's household is a real denial that must stay one.
  if (!listLocalBudgetHouseholds().some((h) => h.householdId === householdId)) return false;
  if (await budgetHouseholdIsOnControlPlane(householdId)) {
    // Already registered — the 403 is about something else (a revoked device, a
    // household this member was removed from), and a retry would just re-fail.
    return false;
  }
  try {
    await syncLocalHouseholdToControlPlane(householdId, { force: true });
  } catch {
    return false;
  }
  return budgetHouseholdIsOnControlPlane(householdId);
}

/**
 * Single-flight guard, KEYED BY HOUSEHOLD. Session open runs from more than one
 * trigger (auth hydration, foreground, household switch), and each one called
 * this. Three simultaneous `POST /v2/households` were observed on a fresh
 * device: one wins, the losers get 409, and every loser then retried
 * `POST …/devices`, which 500s when it races the household row it depends on.
 * Same pattern `runBudgetLocalSync` already uses.
 *
 * One global promise was WORSE than no guard once a device holds two households
 * (plan §2 hazard 8): registering B behind A's in-flight promise returned A's
 * promise, B's `POST /v2/households` never happened, and B's peers never learned
 * this device's keys — so B looked enrolled and silently received nothing.
 * Keyed per household, A and B register concurrently and each still
 * de-duplicates against itself.
 *
 * The `force` an entry ran under is part of the guard now: a forced caller that
 * joined an unforced run would be told "registered" by a run that decided the
 * household stays local, and would then mint an invite against a household the
 * server has never heard of.
 */
type ControlPlaneSyncRun = { force: boolean; run: Promise<void> };
const controlPlaneSyncInFlight = new Map<string, ControlPlaneSyncRun>();

/**
 * Register a local household + this device's real keys with the Budget Worker
 * control plane. Defaults to the active household. No-op when local-first is off
 * or no session is open. Best-effort (offline OK).
 *
 * Unforced — every background caller — this only RE-asserts a household that
 * already has a row (keeping the device label and the legacy mirror fresh); it
 * never creates one. Pass `force` from the act that makes a household shared.
 */
export async function syncLocalHouseholdToControlPlane(
  householdId?: string,
  options?: { force?: boolean },
): Promise<void> {
  if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) return;
  const target = householdId ?? getActiveBudgetHouseholdId();
  if (!target) return;
  const force = options?.force === true;

  const existing = controlPlaneSyncInFlight.get(target);
  if (existing && (existing.force || !force)) return existing.run;

  const entry: ControlPlaneSyncRun = { force, run: Promise.resolve() };
  // A forced call chains AFTER an unforced one in flight rather than replacing
  // it, so the two never race the same POST.
  entry.run = (existing ? existing.run.catch(() => undefined) : Promise.resolve())
    .then(() => registerHouseholdOnce(target, force))
    // Swallowed here rather than left to the caller: every caller floats this
    // (`void import('./controlPlaneClient').then((m) => m.sync…())`), and the
    // resolver now throws — `removeLocalBudgetHousehold` can retire a household
    // while a registration queued for it is still pending. Unhandled, that
    // race turns a no-op into a red-box promise rejection.
    .catch((error: unknown) => {
      console.warn('[budget.local] control-plane sync skipped', error);
    })
    .finally(() => {
      // Clear only OUR entry: a later call for the same household installs a new
      // one, and a blind delete would evict it and reopen the 409 storm.
      if (controlPlaneSyncInFlight.get(target) === entry) {
        controlPlaneSyncInFlight.delete(target);
      }
    });
  controlPlaneSyncInFlight.set(target, entry);
  return entry.run;
}

/**
 * This device's registration payload FOR ONE HOUSEHOLD. The label rides along on
 * every call so a rename propagates on the next session open even if the rename
 * itself was made offline (the coordinator upserts `label` on re-registration).
 *
 * The keys come from that household's own session (see `sessionFor`) — this is
 * the payload where reading the active session instead would register the wrong
 * public keys against a household and break signature verification for every
 * peer in it.
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

async function registerHouseholdOnce(householdId: string, force: boolean): Promise<void> {
  const session = await sessionFor(householdId);
  if (!force && !(await budgetHouseholdIsOnControlPlane(session.householdId))) {
    // Solo, never shared, and staying that way until it is. See
    // `budgetHouseholdIsOnControlPlane` for what this line is worth.
    console.log('[budget.local] household stays on this device', session.householdId);
    return;
  }
  const device = await buildDevicePayload(session.householdId);

  // A MEMBER never issues a create for a household they do not own.
  //
  // `POST /v2/households` carries `displayName` from THIS device's ledger. A
  // joined household goes down the same path — `joinLocalFirstHousehold` marks
  // it registered, so every later sync passes the gate above — which meant a
  // member POSTing a household-CREATE for the OWNER's id, carrying the member's
  // own local name for it. It is harmless today only by accident: the row
  // already exists, `createHousehold` hits a UNIQUE violation, and the 409
  // branch below re-asserts the legacy mirror without touching `display_name`.
  // The day that endpoint becomes an upsert, the first member to sync renames
  // the owner's household for everyone in it.
  //
  // So members go straight to the branch that was always the correct one for
  // them — registering this DEVICE against a household that already exists.
  // Same call the 409 fallback makes, without needing the 409 to get there.
  // (Found by simply-ecosystem-budget-4b while tracing a member-join bug;
  // verified against production D1 that no such rename has occurred.)
  const isOwner = (session.ledger.household.my_role ?? '').trim().toLowerCase() === 'owner';
  if (!isOwner) {
    try {
      await apiClient.post(`/v2/households/${session.householdId}/devices`, device, {
        headers: LF_HEADERS,
      });
      await markBudgetHouseholdOnControlPlane(session.householdId);
    } catch (deviceError) {
      // Expected while an invite is claimed but not yet approved: the device is
      // not a member server-side yet, and the next sync retries.
      console.warn('[budget.local] member device registration skipped', deviceError);
    }
    return;
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
    await markBudgetHouseholdOnControlPlane(session.householdId);
  } catch (error: unknown) {
    const status =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { status?: number } }).response?.status
        : undefined;
    if (status === 409) {
      // The row is already there — that is a registration too, and the marker
      // must record it or every launch re-asks the network for the same answer.
      await markBudgetHouseholdOnControlPlane(session.householdId);
      try {
        await apiClient.post(`/v2/households/${session.householdId}/devices`, device, {
          headers: LF_HEADERS,
        });
      } catch (deviceError) {
        console.warn('[budget.local] device registration skipped', deviceError);
      }
      return;
    }
    console.warn('[budget.local] control-plane sync skipped', error);
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

export async function createLocalFirstInvite(options?: {
  role?: 'OWNER' | 'ADULT';
  ttlHours?: number;
  /** Bind the invite to one account — a copy in anyone else's hands is inert. */
  inviteeEmail?: string | null;
  /**
   * Which household to invite into. Defaults to the active one; a member of two
   * households invites into exactly one, and it is not always the one on screen.
   */
  householdId?: string;
}): Promise<CreatedInvite> {
  const household = resolveHousehold(options?.householdId);
  // The household earns its server row HERE. Minting an invite is the moment a
  // private ledger becomes something another device has to be able to find, and
  // it is the only moment before this POST at which the row can be created —
  // unforced registration would (correctly) decide the household is local-only,
  // and this call would then 403 against a household the server never heard of.
  await syncLocalHouseholdToControlPlane(household.householdId, { force: true });
  const res = await apiClient.post<{ invite: CreatedInvite }>(
    `/v2/households/${household.householdId}/invites`,
    {
      role: options?.role ?? 'ADULT',
      // TTL is the server's call (an hour) unless a caller asks otherwise.
      ...(options?.ttlHours ? { ttlHours: options.ttlHours } : {}),
      ...(options?.inviteeEmail ? { inviteeEmail: options.inviteeEmail.trim() } : {}),
    },
    { headers: LF_HEADERS },
  );
  const invite = res.data.invite;
  // Kept so the SAS is still derivable if the owner leaves this screen and
  // comes back to approve — see `inviteSecretStore`.
  await rememberInviteSecret({
    inviteId: invite.inviteId,
    secret: invite.secret,
    expiresAt: invite.expiresAt,
  });
  return invite;
}

export async function claimLocalFirstInvite(input: {
  householdId: string;
  inviteId: string;
  secret: string;
}): Promise<unknown> {
  const ledger = getLocalLedger();
  const identity = getLocalIdentity();
  try {
    const res = await apiClient.post(
      `/v2/households/${input.householdId}/invites/${input.inviteId}/claim`,
      {
        secret: input.secret,
        deviceId: ledger.deviceId,
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
    // wrong, and the generic advice to re-check the code sends them to re-read
    // a perfectly good one.
    if (axios.isAxiosError(error) && error.response?.status === 409) {
      const code = (error.response.data as { error?: { code?: string } } | undefined)?.error?.code;
      if (code === 'invite_expiring') throw new BudgetInviteExpiringError();
    }
    throw error;
  }
}

/**
 * Pull the code + secret out of whatever the invitee actually pasted.
 *
 * The invite is issued as a QR payload / link
 * (`symply-budget://lf-invite?id=…&secret=…&code=…`) precisely so nobody has to
 * retype two opaque strings by hand (BRD: "Invites use QR/link/code"). Accept
 * that link, a bare `code secret` pair, or a lone short code — anything else
 * returns nulls and the caller falls back to the separate fields.
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
 * `householdName` is what makes an informed answer possible. Joining REPLACES
 * the budget on this device, and a confirmation that can only name
 * `hh_local_9f3a…` is not something anyone can meaningfully agree to — least of
 * all someone who is a member of more than one household and has to work out
 * which one they are about to lose.
 *
 * Optional in the type because a Worker that predates this field answers
 * without it; the UI says "their household" rather than inventing a name.
 */
export type LocalFirstInviteLookup = {
  inviteId: string;
  householdId: string;
  householdName?: string | null;
  status: string;
  expiresAt: string;
};

/** Resolve a short code an invitee typed in to the household + invite it belongs to. */
export async function lookupLocalFirstInvite(
  shortCode: string,
): Promise<LocalFirstInviteLookup> {
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

/** An invite this household has out in the world, claimed or not. */
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
 * Every invite still in play for this household.
 *
 * Distinct from `listPendingJoinRequests`, which answers only "who is waiting"
 * and therefore cannot see a code nobody has claimed. Without this an owner who
 * minted an invite and closed the app had no way back to it: the code lived in
 * the screen's memory and nowhere else, so it could be neither shown again nor
 * cancelled.
 */
export async function listOutstandingInvites(householdId?: string): Promise<OutstandingInvite[]> {
  const household = resolveHousehold(householdId);
  const res = await apiClient.get<{ invites: OutstandingInvite[] }>(
    `/v2/households/${household.householdId}/invites/outstanding`,
    { headers: LF_HEADERS },
  );
  return res.data.invites ?? [];
}

/**
 * Take an invite out of play before anyone is approved.
 *
 * The answer to a code that went to the wrong person, was screenshotted into a
 * group chat, or was simply a mistake. Refused by the control plane once the
 * invite is approved — that device is enrolled, and removing it is device
 * revocation, a different act with different consequences.
 *
 * The two refusals are translated here rather than left as raw axios errors,
 * because both mean the same thing to the caller and neither means what a
 * bare `catch` would assume: the invite is no longer cancellable, the row that
 * offered the button is stale, and retrying cannot change either. Everything
 * else — timeouts, 5xx, a real offline — is rethrown untouched, and only those
 * deserve "check you are online".
 */
export async function revokeLocalFirstInvite(
  inviteId: string,
  householdId?: string,
): Promise<void> {
  const household = resolveHousehold(householdId);
  try {
    await apiClient.post(
      `/v2/households/${household.householdId}/invites/${inviteId}/revoke`,
      {},
      { headers: LF_HEADERS },
    );
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status !== 409 && status !== 404) throw error;
    // Spent either way: an approved invite has already enrolled its device and
    // a vanished one can never be claimed, so the secret this device is holding
    // for it is dead weight and goes with the same tidy-up the success path does.
    await forgetInviteSecret(inviteId);
    throw status === 409 ? new BudgetInviteAlreadyApprovedError() : new BudgetInviteGoneError();
  }
  await forgetInviteSecret(inviteId);
}

/**
 * Invitee side of enrolment (BR-011): resolve the code, claim it with this
 * device's public keys, and rebind the local ledger to the joined household.
 *
 * The household data key is NOT delivered here — the owner still has to
 * compare the returned SAS against the one on their screen and approve, after
 * which the wrapped HDK lands in this device's mailbox and
 * `tryAcceptHdkFromMailbox` installs it on the next sync. Writes stay paused
 * until then (see `adoptJoinedHousehold`).
 *
 * The SAS is derived here from THIS device's own keys — never from anything the
 * response carries. That is the entire point: the digits assert what this
 * device actually holds, so that when the owner's device derives the same
 * digits from what the control plane told it, the two agreeing means the
 * control plane relayed the real key.
 */
export async function joinLocalFirstHousehold(input: {
  shortCode: string;
  secret: string;
}): Promise<{ householdId: string; inviteId: string; sas: string }> {
  const invite = await lookupLocalFirstInvite(input.shortCode);
  const secret = input.secret.trim();
  await claimLocalFirstInvite({
    householdId: invite.householdId,
    inviteId: invite.inviteId,
    secret,
  });
  const identity = getLocalIdentity();
  const sas = deriveEnrolmentSas({
    inviteId: invite.inviteId,
    inviteSecret: secret,
    signingPublicKeyHex: bytesToHex(identity.signingPublicKey),
    agreementPublicKeyHex: bytesToHex(identity.agreementPublicKey),
  });
  // Persisted BEFORE the rebind, for the same reason the marker is logged here:
  // what follows unmounts the screen that called this, taking any in-memory copy
  // with it. The invitee has to be able to read these digits out afterwards.
  await rememberJoinSas({
    inviteId: invite.inviteId,
    householdId: invite.householdId,
    sas,
  });
  if (__DEV__) {
    // Emitted HERE, not from the screen: `adoptJoinedHousehold` below rebinds
    // the ledger and switches household, which unmounts whatever screen called
    // this. A marker logged after that never runs, which is exactly how the
    // two-device run lost it the first time.
    console.log(`[E2E-JOIN-SAS] sas=${sas}`);
  }
  // The NAME comes with the invite and must be carried in.
  //
  // It is the only chance to get it: the household name lives in each device's
  // sealed identity blob, `LEDGER_TABLE_KEYS` has no `household` table, and no
  // op type carries a rename — so there is nothing for a peer to merge later
  // and nothing on the control plane that repairs it. Dropped here, the joined
  // household reads "Shared household" in the switcher for ever, which is what
  // production shipped: `Sweet Home` appeared to its new member as a placeholder
  // beside their own household, with no way to tell which was which.
  await adoptJoinedHousehold({
    householdId: invite.householdId,
    displayName: invite.householdName ?? null,
  });
  // Shared by definition — this device just claimed an invite into someone
  // else's household, so it must sync from the next tick without first asking
  // the network whether the household counts.
  await markBudgetHouseholdOnControlPlane(invite.householdId);
  // Publish the FULL set. Replacing `households` with only the joined one hid
  // the personal ledger in the switcher the moment the invite was claimed —
  // the member could not pick a default household, and a later drop of the
  // joined session left Device Sync looking like a solo phone.
  syncHouseholdStoreFromLocalLedger();
  return { householdId: invite.householdId, inviteId: invite.inviteId, sas };
}

/**
 * Owner side: who has claimed an invite and is waiting to be let in.
 *
 * Read from its own endpoint rather than filtered out of coordinator state,
 * because the owner needs the claimant as a person — address and device name —
 * which only the control plane's own tables can supply.
 *
 * The household is a parameter because an owner of several checks all of them
 * from one screen, and `resolveHousehold` answers without hydrating any of them.
 */
export async function listPendingJoinRequests(
  householdId?: string,
): Promise<PendingJoinRequest[]> {
  const household = resolveHousehold(householdId);
  const res = await apiClient.get<{ pending: PendingJoinRequest[] }>(
    `/v2/households/${household.householdId}/invites/pending`,
    { headers: LF_HEADERS },
  );
  return res.data.pending ?? [];
}

/**
 * The digits the owner reads out, derived from what the control plane says the
 * claiming device holds. Null when this device no longer has the invite secret
 * (a different device issued the invite, or the secret was pruned) — in that
 * case there is nothing to verify against and the owner is told to re-issue
 * rather than shown a number that proves nothing.
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
 * are what the household key is wrapped to. Reading the wrap target from the
 * approve RESPONSE — which is what this used to do — would leave the control
 * plane free to show honest keys during the comparison and hand back its own
 * immediately after, wrapping the household to itself with two humans having
 * just agreed that everything matched.
 */
export async function approveLocalFirstInvite(input: {
  request: PendingJoinRequest;
  /** The household being joined. Defaults to the active one. */
  householdId?: string;
}): Promise<{ approved: { userId: string; deviceId: string; agreementPublicKey: string } }> {
  const household = resolveHousehold(input.householdId);
  const { request } = input;
  if (!request.claimedSigningPublicKey || !request.claimedAgreementPublicKey) {
    throw new Error('claim_incomplete');
  }

  const res = await apiClient.post<{
    approved: { userId: string; deviceId: string; agreementPublicKey: string };
  }>(
    `/v2/households/${household.householdId}/invites/${request.inviteId}/approve`,
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
  // ordinary gate is "100 ops since the last one", which an owner with a modest
  // ledger never clears, so the household can sit on a years-old generation.
  // Forcing one here costs the owner a single upload at the one moment somebody
  // is about to need it.
  //
  // THE ORDER IS THE FIX. This used to run after the HDK deposit, which made the
  // joiner's first sync a race: the moment the key lands it looks for a
  // checkpoint, and a snapshot of years of budget is a multi-chunk upload that
  // routinely had not finished — or had not started, on a slow link. The joiner
  // found nothing, merged a live op instead, and that one op was enough to close
  // its bootstrap window for good, leaving it holding the current month with no
  // goals, no income and no earlier history. The joiner now retries until the
  // snapshot arrives (`runHouseholdBackfill`), so this ordering is no longer
  // load-bearing on its own — but it is what makes the FIRST attempt succeed,
  // and every retry it saves is a member not staring at a half-empty budget.
  try {
    const { maybePublishCheckpoint } = await import('./sync/checkpoints');
    await maybePublishCheckpoint(household.householdId, { force: true });
  } catch (error) {
    console.warn('[budget.local] checkpoint publish before approve handoff skipped', error);
  }

  // Deliver HDK to the approved device via ZK mailbox (app-layer wrap), to the
  // verified key and the device that claimed with it.
  try {
    const { depositHdkForDevice } = await import('./sync/hdkTransfer');
    await depositHdkForDevice({
      recipientDeviceId: request.claimedDeviceId ?? res.data.approved.deviceId,
      recipientAgreementPublicKeyHex: request.claimedAgreementPublicKey,
      // Named, never defaulted: WHICH household's key is wrapped is the entire
      // security content of this step. Approving into a background household
      // while another is on screen would otherwise wrap the ACTIVE household's
      // HDK and hand a member of B the key to a budget they were never invited
      // to — a break no later fix takes back, because the key has left the
      // device.
      householdId: household.householdId,
    });
  } catch (error) {
    console.warn('[budget.local] HDK deposit after approve failed', error);
  }

  await forgetInviteSecret(request.inviteId);
  return res.data;
}

/**
 * After an epoch rotation: hand the new key to every device that is still in.
 *
 * `generateHouseholdKeys` mints a RANDOM key, so a rotation is not something
 * the other devices can derive — it has to be delivered, exactly as enrolment
 * delivers the first one. Nothing did that, so every revoke silently locked the
 * household's remaining devices out of everything written afterwards: they kept
 * syncing, kept acking nothing, and diverged with no error on any screen.
 * (Production: `Sweet Home` reached epoch 5 with the owner's own second device
 * still holding epoch 1.)
 *
 * Best-effort per device and never throws: the revocation itself has already
 * succeeded server-side, and a device that misses this wrap is no worse off
 * than it was before — the next rotation, or a re-enrolment, delivers again.
 * The wrap carries the whole retired ring, so a device that missed several
 * rotations catches up in one.
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
        console.warn('[budget.local] key rewrap skipped for device', peer.deviceId, error);
      }
    }
  } catch (error) {
    console.warn('[budget.local] key rewrap skipped', householdId, error);
  }
}

/**
 * Republish the household snapshot under the epoch that is now current.
 *
 * A checkpoint is sealed once and never re-sealed, so the moment the key
 * rotates the household's newest snapshot becomes unreadable to anyone holding
 * only the new key — including every future joiner. Owner-only and best-effort;
 * `maybePublishCheckpoint` makes the role decision itself.
 */
async function republishCheckpointAfterRotation(householdId: string): Promise<void> {
  try {
    const { maybePublishCheckpoint } = await import('./sync/checkpoints');
    await maybePublishCheckpoint(householdId, { force: true });
  } catch (error) {
    console.warn('[budget.local] checkpoint republish after rotation skipped', error);
  }
}

/**
 * The mailbox is where a wrong household is most expensive, and least visible:
 * a deposit under the wrong id lands ops sealed with B's HDK in A's mailbox,
 * addressed to A's peers, who cannot open them and never ack them. So all three
 * mailbox calls take the household, and background sync must pass it — the
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
  const household = resolveHousehold(options?.householdId);
  const res = await apiClient.post(
    `/v2/households/${household.householdId}/mailbox`,
    {
      recipientDeviceId: recipientDeviceId ?? null,
      sourceDeviceId: household.deviceId,
      // Chunked, table-driven base64 from the package. The old per-byte
      // `binary += String.fromCharCode(...)` loop ran over up to 384 KB, and
      // now runs once per chunk rather than once per sync; btoa/atob are also
      // not guaranteed under Hermes.
      ciphertextBase64: bytesToBase64(ciphertext),
      // Suppressed on all but the last chunk so a multi-chunk push does not
      // wake every peer once per chunk.
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
  const household = resolveHousehold(householdId);
  const res = await apiClient.get<{
    blobs: Array<{
      blobId: string;
      ciphertextBase64: string;
      recipientDeviceId?: string | null;
    }>;
    hasMore?: boolean;
    cursor?: string;
  }>(`/v2/households/${household.householdId}/mailbox`, {
    headers: LF_HEADERS,
    // Without the cursor every page is the oldest page: paging on ack alone
    // cannot step over a blob that is never ackable (any broadcast), and the
    // mailbox stops delivering everything behind it.
    params: { deviceId: household.deviceId, ...(cursor ? { cursor } : {}) },
  });
  const blobs = (res.data.blobs ?? []).map((b) => ({
    blobId: b.blobId,
    ciphertext: base64ToBytes(b.ciphertextBase64),
    // Kept, not discarded: only mail ADDRESSED to this device may be acked.
    // A broadcast blob is addressed to every peer, so acking it on receipt would
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
  const household = resolveHousehold(householdId);
  await apiClient.post(
    `/v2/households/${household.householdId}/mailbox/ack`,
    { blobIds, deviceId: deviceId ?? household.deviceId },
    { headers: LF_HEADERS },
  );
}

export async function fetchTurnConfig(): Promise<{
  status: string;
  iceServers: Array<{ urls: string[]; username?: string; credential?: string }>;
}> {
  const res = await apiClient.post<{
    status: string;
    iceServers: Array<{ urls: string[]; username?: string; credential?: string }>;
  }>('/v2/turn', {}, { headers: LF_HEADERS });
  return res.data;
}

/**
 * The key epoch this device holds for a household — the helper kept for callers
 * that need the epoch without leaking the key itself.
 *
 * Asynchronous since BR-016: an epoch is per-household state, and per-household
 * key material is only reachable through the session handle, which hydrates a
 * household on first use. The active household is already hydrated, so the
 * common call resolves without touching disk.
 */
export async function getLocalKeyEpoch(householdId?: string): Promise<number> {
  const session = await sessionFor(householdId);
  return session.householdKeys.keyEpoch;
}

/**
 * Rename THIS device and push the new label to the control plane, so the rest
 * of the household sees a name instead of `dev_652de89b0240`.
 *
 * The local write happens first and is what the UI trusts: the label is
 * cosmetic, so a failed push (offline, or a peer that has not re-synced) must
 * not lose the rename. Registration re-sends it on the next session open.
 * Returns the resolved name — an empty input clears the override and resolves
 * back to the OS suggestion.
 *
 * The NAME is device-scoped but a registration is per household, so this pushes
 * to one of them. The rest converge on their own next registration, which
 * carries the current label (`buildDevicePayload`) — no fan-out needed, and none
 * attempted, because a rename must not block on N round trips.
 */
export async function renameLocalFirstDevice(
  rawName: string,
  householdId?: string,
): Promise<{
  name: string;
  state: ControlPlaneState | null;
}> {
  const name = await setLocalDeviceName(rawName);
  try {
    const household = resolveHousehold(householdId);
    const res = await apiClient.post<{ state: ControlPlaneState }>(
      `/v2/households/${household.householdId}/devices`,
      await buildDevicePayload(household.householdId),
      { headers: LF_HEADERS },
    );
    return { name, state: res.data.state };
  } catch (error) {
    console.warn('[budget.local] device rename not pushed yet', error);
    return { name, state: null };
  }
}

/**
 * Revoke a device on the control plane and rotate the local HDK to the new
 * key epoch. Revoked peers keep the old HDK and cannot open ops sealed under
 * the new epoch (Phase 4). Remaining peers must re-enrol / receive the new HDK.
 *
 * A revocation is scoped to ONE household — the same device can stay enrolled in
 * the member's other households — so both the DELETE and the rotation that
 * follows name it. Without `forHouseholdId` on the install, revoking a device in
 * a background household would rotate the ACTIVE household's key instead: every
 * peer of an untouched household locked out, and the revoked device still able
 * to read the one it was removed from.
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
  // session's keys underneath it. Comparing against a stale epoch would reinstall
  // a key this device already retired.
  const current = await getLocalBudgetSession(session.householdId);
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
 * Revoke a device from a household this phone does NOT hold a ledger for.
 *
 * The sibling above is the normal path and is bound to a local session: it
 * re-reads the session after the round trip and installs the rotated household
 * key. Neither step is possible — or meaningful — here. An owner who wiped or
 * replaced the phone they administered a household from keeps their membership
 * server-side but holds no ledger, no session and no key for it, so
 * `sessionFor` throws and the household becomes unadministrable: its device
 * list can be read by every OTHER member and cleaned up by none of them.
 *
 * The epoch still rotates server-side, and the devices that DO hold the
 * household pick it up on their next sync. This phone has nothing to install
 * because it holds nothing to re-encrypt.
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
 * Drop an already-revoked device off the household's record.
 *
 * Not a revocation and not a second one: the server refuses anything still
 * active (409), the key epoch does not move, and nothing has to be installed
 * locally — which is why this takes no session, unlike `revokeLocalFirstDevice`
 * above. The household is named rather than resolved from a session for the
 * same reason it is there: the list on screen belongs to ONE household, and by
 * the time this resolves the active one may be another.
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

/**
 * Promote a member to owner, or hand a former owner back to member.
 *
 * No key rotation and no session needed: a role is a permission, and the
 * household key material does not move. The whole registry comes back so the
 * caller can publish the new roster without a second round trip — the list the
 * owner is looking at is the one they just changed, and re-fetching it is how a
 * screen ends up showing the old role for a second.
 */
export async function setBudgetMemberRole(input: {
  userId: string;
  role: 'OWNER' | 'ADULT';
  /** Which household. Defaults to the active one — the list on screen. */
  householdId?: string;
}): Promise<ControlPlaneState> {
  const household = resolveHousehold(input.householdId);
  const res = await apiClient.patch<{ state: ControlPlaneState }>(
    `/v2/households/${household.householdId}/members/${encodeURIComponent(input.userId)}`,
    { role: input.role },
    { headers: LF_HEADERS },
  );
  return res.data.state;
}

/**
 * Remove someone from a household — the person, and with them every device
 * they hold in it.
 *
 * The member-shaped sibling of `revokeLocalFirstDevice`, and it rotates for the
 * same reason: the household key the removed devices hold must stop opening
 * anything written from here on. Revoking their devices one at a time is NOT
 * this — that leaves the membership standing, so they can enrol a new device
 * and be back in the household before the owner has put the phone down.
 *
 * Scoped to ONE household, like every other revocation: the same person can
 * remain in the member's other households, so the DELETE and the rotation that
 * follows both name this one.
 */
export async function removeBudgetHouseholdMember(input: {
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
  // reason as `revokeLocalFirstDevice`: an HDK arriving by mailbox mid-request
  // swaps the session's keys underneath a snapshot copy, and comparing against
  // a stale epoch would reinstall a key this device already retired.
  const current = await getLocalBudgetSession(session.householdId);
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
 * Leave a household: end your OWN membership, and take every device you hold
 * in it off the household's record.
 *
 * Deliberately server-side only. What happens to this phone's copy is the
 * caller's to sequence, because it is the irreversible half — the ledger, its
 * history and its sync cursors are erased by `removeLocalBudgetHousehold`, and
 * that has to happen after the household has agreed you are out rather than
 * before, or a failed request leaves a member with no budget and a membership
 * they cannot see.
 *
 * No key rotation here, and none possible: the epoch moves server-side so the
 * ops written from now on cannot be opened with the key this phone keeps, and
 * the one device that must NOT mint the household's next key is the one walking
 * out with the old one. The members who stay rotate on their own next sync.
 *
 * 404 means the membership is already gone — removed by an owner while this
 * phone was offline. That is not a failure of leaving; it is leaving, already
 * done, and the caller should finish the local half exactly the same way.
 */
export async function leaveBudgetHousehold(householdId: string): Promise<ControlPlaneState | null> {
  const res = await apiClient.post<{ state: ControlPlaneState }>(
    `/v2/households/${householdId}/leave`,
    {},
    { headers: LF_HEADERS },
  );
  return res.data.state ?? null;
}

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
    const status =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { status?: number } }).response?.status
        : undefined;
    if (status === 404) return null;
    throw error;
  }
}

export async function fetchCheckpointChunk(
  householdId: string,
  index: number,
  generation?: number,
): Promise<{ generation: number; chunkIndex: number; ciphertextBase64: string }> {
  const res = await apiClient.get<{
    generation: number;
    chunkIndex: number;
    ciphertextBase64: string;
  }>(`/v2/households/${householdId}/checkpoints/latest/chunks/${index}${generation == null ? '' : `?generation=${generation}`}`, {
    headers: LF_HEADERS,
  });
  return res.data;
}
