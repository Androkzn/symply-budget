/**
 * Health's client for the shared `/v2` control plane — Stage He5 (plan §6).
 *
 * WHAT MAKES THIS DIFFERENT FROM ITS SIBLINGS
 * -------------------------------------------
 * Budget and House address a *household*: several people, each with several
 * devices, and a real invite-a-member surface. Health addresses a **personal
 * ledger** (plan §1.2): **one implicit household per user, N devices, no member
 * list**. `HouseholdCoordinatorDO` is reused because it already stores devices,
 * keys and a mailbox — not because Health has members.
 *
 * Three consequences, all load-bearing:
 *
 * 1. **There is no member-invite API in this module and there must never be
 *    one.** The only enrolment surface is `createHealthDeviceEnrolment()`, whose
 *    product name is "your other device". `controlPlaneClient.test.ts` fails the
 *    build if any exported name or exported string reads like an invitation to a
 *    person rather than to a device.
 * 2. The control plane **refuses a second `user_id`** on a Health household
 *    (DoD He0, re-asserted He5). This client never asks for that, and surfaces
 *    the server's 403 as the named `HealthSecondUserRefusedError` rather than a
 *    raw axios failure — plus it fails closed on its own if a fetched state ever
 *    shows two members (`assertHealthPersonalHousehold`).
 * 3. `X-Health-Local-First: 1` goes on **every** `/v2` call. It is what arms
 *    `rejectHealthWritesForLocalFirstEarly` to 410 the Wave A D1 surfaces for
 *    this client, so a half-migrated build cannot write to both sides
 *    (plan §1.3). A flag-`0` binary must never send it.
 *
 * ⚠️ **The enrolment link is built HERE, client-side.** The shared Worker
 * hardcodes the Budget scheme in its invite response —
 * `qrPayload: \`symply-budget://lf-invite?...\`` at
 * `backend/src/routes/local-first-v2.ts:535` — so consuming `invite.qrPayload`
 * would hand Health users a link that opens Symply Budget, or nothing at all.
 * House works around the identical bug the identical way
 * (`src/features/house/local/controlPlaneClient.ts:206`). Plan §2 item 5.
 */
import { apiClient } from '@api/client';
import {
  forgetInviteSecret,
  recallInviteSecret,
  rememberInviteSecret,
} from '@services/enrolment/inviteSecretStore';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  deriveEnrolmentSas,
} from '@symply/local-first';

import {
  getLocalHealthIdentity,
  getLocalHealthLedger,
  isLocalHealthSessionOpen,
  openLocalHealthSession,
  resetLocalHealthSession,
} from './engine';
import { isHealthLocalFirst } from './flag';
import { HEALTH_LEDGER_TABLE_NAMES } from './schema';

/** Arms the Worker's Wave A 410 gate. Present on every `/v2` request below. */
const LF_HEADERS = { 'X-Health-Local-First': '1' };

/**
 * The brand's URL scheme, verified at `brands/symply-health/brand.cjs:9`.
 *
 * NOT `symply-health://` (that scheme does not exist — the code id is not the
 * scheme) and emphatically NOT `symply-budget://`, which is what the shared
 * Worker would hand back. Both parse fine and open nothing.
 */
export const HEALTH_ENROLMENT_LINK_SCHEME = 'simplehealth';

/**
 * Display name the personal household is registered under on the control plane.
 *
 * Server-visible metadata, so it is a constant rather than anything derived from
 * the person: a household row that says "Anna's weight loss" would leak more
 * than every encrypted op in the mailbox combined (plan §1.5 hazard S5).
 */
export const HEALTH_PERSONAL_HOUSEHOLD_DISPLAY_NAME = 'Symply Health';

/**
 * Product copy for the whole enrolment flow, in one place so the negative test
 * can read it.
 *
 * Every string is about a **device**. Health has no members to invite; a screen
 * that says "invite a member" is describing a product Health is not
 * (plan §1.2 / §6 "no invite-member strings in Health Settings").
 */
export const HEALTH_ENROLMENT_COPY = {
  title: 'Add your other device',
  body: 'Scan this code on your other device to keep both in sync. Your health data stays encrypted on your devices.',
  scanCta: 'Scan on your other device',
  approveTitle: 'Approve your other device',
  approveBody:
    'Check that the number matches the one shown on your other device, then approve it.',
  pendingWrites: 'Waiting for your other device to approve this one. Changes are paused until then.',
  refused: 'Symply Health keeps your data to a single account. Only your own devices can be added.',
} as const;

/**
 * A second account tried to join this personal ledger — refused.
 *
 * Named, not string-matched, because the caller has to render "this is a
 * personal ledger" copy rather than a generic "forbidden". Reachable two ways:
 * the control plane 403s the join (DoD He0, the compensating control for
 * dropping `excludeUserId` from the peer query — plan §2 item 4c), or this
 * client notices a fetched state carrying more than one member and fails closed.
 */
export class HealthSecondUserRefusedError extends Error {
  readonly code = 'health_second_user_refused';
  constructor(phase: string) {
    super(`${HEALTH_ENROLMENT_COPY.refused} (${phase})`);
    this.name = 'HealthSecondUserRefusedError';
  }
}

export type ControlPlaneHealthHousehold = {
  id: string;
  display_name: string;
  role: string;
  key_epoch: number;
};

/**
 * An enrolment offer for one of this user's own devices.
 *
 * Deliberately NOT called an "invite": the shared Worker's route is
 * `/invites`, but the product concept here is "let my other phone in".
 * `qrPayload` is intentionally absent — see the module header.
 */
export type ControlPlaneHealthEnrolment = {
  inviteId: string;
  shortCode: string;
  role: string;
  status: 'active' | 'claimed' | 'approved' | 'revoked' | 'expired';
  claimedByUserId?: string | null;
  claimedDeviceId?: string | null;
  expiresAt: string;
};

/**
 * A claimed enrolment awaiting approval on the first device, with the claiming
 * device's keys so this device can derive the enrolment SAS and — once the two
 * screens agree — wrap the household key to the key it verified.
 *
 * Health pairs one person's own devices, so there is no second account to name;
 * the device label is the identifying detail that matters here.
 */
export type PendingHealthDeviceEnrolment = {
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

export type ControlPlaneHealthState = {
  householdId: string;
  keyEpoch: number;
  securityRevision: number;
  members: Array<{ userId: string; role: string; status: string }>;
  devices: Array<{
    deviceId: string;
    userId: string;
    signingPublicKey: string;
    agreementPublicKey: string;
    status: string;
  }>;
  invites?: ControlPlaneHealthEnrolment[];
};

/** What `createHealthDeviceEnrolment` returns to the QR screen. */
export type CreatedHealthDeviceEnrolment = {
  inviteId: string;
  shortCode: string;
  secret: string;
  expiresAt: string;
  /** Built here, from `HEALTH_ENROLMENT_LINK_SCHEME` — never the Worker's. */
  enrolmentLink: string;
};

function httpStatusOf(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'response' in error
    ? (error as { response?: { status?: number } }).response?.status
    : undefined;
}

function httpMessageOf(error: unknown): string {
  if (!error || typeof error !== 'object' || !('response' in error)) return '';
  const data = (error as { response?: { data?: unknown } }).response?.data;
  if (!data || typeof data !== 'object') return '';
  const inner = (data as { error?: { code?: unknown; message?: unknown } }).error;
  if (!inner || typeof inner !== 'object') return '';
  return `${String(inner.code ?? '')} ${String(inner.message ?? '')}`.trim();
}

/**
 * Translate a 403 on an enrolment call into the named error.
 *
 * Claim/approve are the only routes on which a *different account* can present
 * itself to this household, so a 403 there means the control plane refused a
 * second `user_id` — UNLESS the server explicitly said the secret or the OOB
 * phrase was wrong, which are ordinary user errors and must keep their own
 * failure path.
 */
function rethrowSecondUserRefusal(error: unknown, phase: string): void {
  if (httpStatusOf(error) !== 403) return;
  if (/invalid invite secret|oob/i.test(httpMessageOf(error))) return;
  throw new HealthSecondUserRefusedError(phase);
}

/**
 * Fail closed if a personal ledger ever reports more than one member.
 *
 * The client never asks to add one, and the Worker refuses — this is the third
 * line, and it is here because the failure it catches is otherwise silent: a
 * second member means someone else's device is in the mailbox of a household
 * whose whole threat model is "one person's health record".
 */
export function assertHealthPersonalHousehold(state: ControlPlaneHealthState): void {
  const active = state.members.filter((m) => m.status !== 'revoked');
  if (active.length > 1) {
    throw new HealthSecondUserRefusedError('state');
  }
}

/**
 * Single-flight guard. Session open runs from more than one trigger (sign-in,
 * cold-start hydration), and each one calls this. Two simultaneous
 * `POST /v2/households` on a fresh device means one winner, one 409, and a retry
 * of `POST …/devices` that races the household row it depends on.
 */
let controlPlaneSyncInFlight: Promise<void> | null = null;

/**
 * Mint the one implicit personal household, or reuse the one already there, and
 * register this device's real keys against it.
 *
 * Idempotent by construction: the household id comes from the local ledger, so
 * re-running this posts the same id, takes the 409, and registers the device.
 * There is no "create another household" path — a Health user has exactly one.
 */
export async function syncLocalHealthHouseholdToControlPlane(): Promise<void> {
  if (!isHealthLocalFirst() || !isLocalHealthSessionOpen()) return;
  if (controlPlaneSyncInFlight) return controlPlaneSyncInFlight;

  controlPlaneSyncInFlight = registerPersonalHouseholdOnce().finally(() => {
    controlPlaneSyncInFlight = null;
  });
  return controlPlaneSyncInFlight;
}

function thisDevicePayload(): {
  deviceId: string;
  signingPublicKey: string;
  agreementPublicKey: string;
  label: string;
} {
  const ledger = getLocalHealthLedger();
  const identity = getLocalHealthIdentity();
  return {
    deviceId: ledger.deviceId,
    signingPublicKey: bytesToHex(identity.signingPublicKey),
    agreementPublicKey: bytesToHex(identity.agreementPublicKey),
    label: 'This device',
  };
}

async function registerPersonalHouseholdOnce(): Promise<void> {
  const ledger = getLocalHealthLedger();
  const device = thisDevicePayload();

  try {
    await apiClient.post(
      '/v2/households',
      {
        householdId: ledger.household.id,
        displayName: HEALTH_PERSONAL_HOUSEHOLD_DISPLAY_NAME,
        device,
      },
      { headers: LF_HEADERS },
    );
  } catch (error: unknown) {
    if (httpStatusOf(error) === 409) {
      // Already minted — reuse it and make sure THIS device is on the roster.
      try {
        await apiClient.post(`/v2/households/${ledger.household.id}/devices`, device, {
          headers: LF_HEADERS,
        });
      } catch (deviceError) {
        rethrowSecondUserRefusal(deviceError, 'device');
        console.warn('[health.local] device registration skipped', deviceError);
      }
      return;
    }
    rethrowSecondUserRefusal(error, 'household');
    console.warn('[health.local] control-plane sync skipped', error);
  }
}

export async function listControlPlaneHealthHouseholds(): Promise<ControlPlaneHealthHousehold[]> {
  const res = await apiClient.get<{ households: ControlPlaneHealthHousehold[] }>('/v2/households', {
    headers: LF_HEADERS,
  });
  return res.data.households;
}

export async function fetchHealthControlPlaneState(
  householdId: string,
): Promise<ControlPlaneHealthState> {
  const res = await apiClient.get<{ state: ControlPlaneHealthState }>(
    `/v2/households/${householdId}/state`,
    { headers: LF_HEADERS },
  );
  assertHealthPersonalHousehold(res.data.state);
  return res.data.state;
}

/**
 * Offer enrolment to another device **of the same person**.
 *
 * `role: 'OWNER'` is not a privilege grant — there is only one person here, and
 * their second phone is not a junior member of anything. The Worker's enum only
 * offers `OWNER | ADULT`; `ADULT` would imply a second adult in a household,
 * which is the concept Health does not have.
 */
export async function createHealthDeviceEnrolment(options?: {
  ttlHours?: number;
}): Promise<CreatedHealthDeviceEnrolment> {
  const ledger = getLocalHealthLedger();
  const res = await apiClient.post<{
    invite: {
      inviteId: string;
      shortCode: string;
      secret: string;
      expiresAt: string;
      /** Present in the response and deliberately ignored — see module header. */
      qrPayload?: string;
    };
  }>(
    `/v2/households/${ledger.household.id}/invites`,
    {
      role: 'OWNER',
      ...(options?.ttlHours ? { ttlHours: options.ttlHours } : {}),
    },
    { headers: LF_HEADERS },
  );
  const invite = res.data.invite;
  // Kept so the SAS stays derivable if this device leaves the screen and comes
  // back to approve — see `inviteSecretStore`.
  await rememberInviteSecret({
    inviteId: invite.inviteId,
    secret: invite.secret,
    expiresAt: invite.expiresAt,
  });
  return {
    inviteId: invite.inviteId,
    shortCode: invite.shortCode,
    secret: invite.secret,
    expiresAt: invite.expiresAt,
    enrolmentLink: buildHealthEnrolmentLink(invite),
  };
}

/**
 * The link / QR payload the other device scans — `simplehealth://lf-invite?...`.
 *
 * Built here rather than taken from `invite.qrPayload`, which the shared Worker
 * hardcodes to `symply-budget://` (`local-first-v2.ts:535`).
 */
export function buildHealthEnrolmentLink(enrolment: {
  inviteId: string;
  shortCode: string;
  secret: string;
}): string {
  const params = new URLSearchParams({
    id: enrolment.inviteId,
    secret: enrolment.secret,
    code: enrolment.shortCode,
  });
  return `${HEALTH_ENROLMENT_LINK_SCHEME}://lf-invite?${params.toString()}`;
}

/**
 * Pull the code + secret out of whatever landed on the second device.
 *
 * The payload is issued as a QR/link precisely so nobody retypes two opaque
 * strings, but a scanner that returns raw text, a pasted link, or a hand-typed
 * short code all have to work. Anything else returns nulls and the caller falls
 * back to the separate fields.
 */
export function parseHealthEnrolmentInput(raw: string): {
  shortCode: string | null;
  secret: string | null;
} {
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

  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { shortCode: parts[0]!.toUpperCase(), secret: parts[1]! };
  }
  return { shortCode: text.toUpperCase(), secret: null };
}

/** Resolve a short code the second device scanned to the household it names. */
export async function lookupHealthDeviceEnrolment(shortCode: string): Promise<{
  inviteId: string;
  householdId: string;
  status: string;
  expiresAt: string;
}> {
  const res = await apiClient.get<{
    invite: { inviteId: string; householdId: string; status: string; expiresAt: string };
  }>('/v2/invites/lookup', {
    headers: LF_HEADERS,
    params: { code: shortCode.trim().toUpperCase() },
  });
  return res.data.invite;
}

async function claimHealthDeviceEnrolment(input: {
  householdId: string;
  inviteId: string;
  secret: string;
}): Promise<void> {
  const ledger = getLocalHealthLedger();
  const identity = getLocalHealthIdentity();
  try {
    await apiClient.post(
      `/v2/households/${input.householdId}/invites/${input.inviteId}/claim`,
      {
        secret: input.secret,
        deviceId: ledger.deviceId,
        signingPublicKey: bytesToHex(identity.signingPublicKey),
        agreementPublicKey: bytesToHex(identity.agreementPublicKey),
      },
      { headers: LF_HEADERS },
    );
  } catch (error) {
    // The one route on which a DIFFERENT account can present itself.
    rethrowSecondUserRefusal(error, 'claim');
    throw error;
  }
}

/**
 * This device already holds Health rows of its own.
 *
 * Enrolment rebinds the ledger to the household the QR named, and the engine
 * does not model merging a bound ledger into another one — "a persisted binding
 * always wins over the argument" (`engine.ts:665`). Rebinding anyway would
 * discard whatever is already here, silently. So the client refuses and says so.
 */
export class HealthEnrolmentWouldDiscardDataError extends Error {
  readonly code = 'health_enrolment_would_discard_data';
  constructor() {
    super(
      'This device already has Symply Health entries. Set it up as your other device before logging anything on it.',
    );
    this.name = 'HealthEnrolmentWouldDiscardDataError';
  }
}

/** True when the open ledger holds no rows in any of the eight Wave A tables. */
function localLedgerIsEmpty(): boolean {
  const ledger = getLocalHealthLedger();
  return HEALTH_LEDGER_TABLE_NAMES.every((table) => (ledger[table] ?? []).length === 0);
}

/**
 * Second-device side of enrolment: resolve the code, rebind this device's ledger
 * to the household the code named, then claim with the identity that rebinding
 * produced.
 *
 * ⚠️ **The order is the whole correctness argument.** Rebinding mints a fresh
 * device identity (`engine.ts` `mintPersonalHousehold` → `generateDeviceIdentity`),
 * so claiming first would register the pre-rebind agreement key on the control
 * plane, the first device would wrap the HDK for a keypair that no longer
 * exists, and this device would sit in `pendingEnrolment` forever with an
 * undecryptable mailbox. Rebind, then claim.
 *
 * The household data key is NOT delivered here — the first device still has to
 * confirm that the six digits this call returns match the six on its own
 * screen, after which the wrapped HDK lands in this device's mailbox and
 * `installHealthHouseholdKeys` installs it. Writes stay paused until then
 * (`HealthLocalEnrolmentPendingError`, `errors.ts`), which is the loud failure;
 * authoring ops under the placeholder key would be the silent one.
 *
 * The SAS is derived from THIS device's own keys, never from the response.
 */
export async function enrolThisDeviceInHealthHousehold(input: {
  userId: string;
  shortCode: string;
  secret: string;
}): Promise<{ householdId: string; inviteId: string; sas: string }> {
  if (isLocalHealthSessionOpen() && !localLedgerIsEmpty()) {
    throw new HealthEnrolmentWouldDiscardDataError();
  }

  // Read-only: resolves the household id without committing this device to it.
  const enrolment = await lookupHealthDeviceEnrolment(input.shortCode);

  // Drop the empty household this device minted at sign-in and rebind to the
  // one being joined. `resetLocalHealthSession()` is what makes the engine's
  // persisted-binding-wins rule yield.
  await resetLocalHealthSession();
  await openLocalHealthSession({ userId: input.userId, householdId: enrolment.householdId });

  try {
    await claimHealthDeviceEnrolment({
      householdId: enrolment.householdId,
      inviteId: enrolment.inviteId,
      secret: input.secret.trim(),
    });
  } catch (error) {
    // A failed claim would otherwise strand this device bound to a household it
    // was never admitted to, with writes permanently paused. Put it back on its
    // own personal ledger before rethrowing.
    await resetLocalHealthSession();
    await openLocalHealthSession({ userId: input.userId });
    throw error;
  }

  const identity = getLocalHealthIdentity();
  const sas = deriveEnrolmentSas({
    inviteId: enrolment.inviteId,
    inviteSecret: input.secret.trim(),
    signingPublicKeyHex: bytesToHex(identity.signingPublicKey),
    agreementPublicKeyHex: bytesToHex(identity.agreementPublicKey),
  });

  return { householdId: enrolment.householdId, inviteId: enrolment.inviteId, sas };
}

/**
 * First-device side: enrolments a device has claimed and that await approval,
 * carrying the claimed keys the SAS is derived from.
 */
export async function listPendingHealthDeviceEnrolments(): Promise<PendingHealthDeviceEnrolment[]> {
  const ledger = getLocalHealthLedger();
  const res = await apiClient.get<{ pending: PendingHealthDeviceEnrolment[] }>(
    `/v2/households/${ledger.household.id}/invites/pending`,
    { headers: LF_HEADERS },
  );
  return res.data.pending ?? [];
}

/**
 * The digits this device shows for a pending enrolment. Null when the invite
 * secret is no longer held here, in which case nothing can be verified and the
 * screen says so rather than offering an approval that checks nothing.
 */
export async function deriveHealthEnrolmentSas(
  request: PendingHealthDeviceEnrolment,
): Promise<string | null> {
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
 * Approve an enrolment whose digits match. The caller passes the record it
 * displayed, and the key wrapped to downstream is that record's — not whatever
 * the response carries, which the control plane chooses.
 */
export async function approveHealthDeviceEnrolment(input: {
  request: PendingHealthDeviceEnrolment;
}): Promise<{ approved: { userId: string; deviceId: string; agreementPublicKey: string } }> {
  const ledger = getLocalHealthLedger();
  const { request } = input;
  if (!request.claimedSigningPublicKey || !request.claimedAgreementPublicKey) {
    throw new Error('claim_incomplete');
  }
  try {
    const res = await apiClient.post<{
      approved: { userId: string; deviceId: string; agreementPublicKey: string };
    }>(
      `/v2/households/${ledger.household.id}/invites/${request.inviteId}/approve`,
      {
        confirmedSigningPublicKey: request.claimedSigningPublicKey,
        confirmedAgreementPublicKey: request.claimedAgreementPublicKey,
      },
      { headers: LF_HEADERS },
    );
    await forgetInviteSecret(request.inviteId);
    // The HDK handover is NOT done here. House deposits it inline
    // (`house/local/controlPlaneClient.ts:375`) behind a dynamic
    // `await import('./sync/hdkTransfer')`, which is the only way it can: that
    // module imports this one back. Dynamic import throws under this repo's Jest
    // config, so Health's callers deposit instead — `HealthOtherDeviceScreen`
    // right after this resolves, and `sync/hdkRotation` after a revoke. An
    // approved device that never receives the key stays in `pendingEnrolment`
    // and cannot write, which is the correct failure (paused writes) rather than
    // the silent one (ops sealed under a key the peer cannot open).
    return res.data;
  } catch (error) {
    rethrowSecondUserRefusal(error, 'approve');
    throw error;
  }
}

/**
 * Remove one of this user's own devices from the control plane — the TRANSPORT
 * half of a revoke, and on its own **not a cryptographic revocation**.
 *
 * ⚠️ **Callers want `revokeHealthLocalFirstDeviceAndRotateKey`**
 * (`sync/hdkRotation.ts`), which wraps this one. The Worker bumps `key_epoch`
 * here (`household-coordinator.ts:237-240`), but a device that has already been
 * handed the household data key keeps it: it decrypts every row and every blob
 * it can still reach until this device mints a NEW key at the new epoch and
 * hands it to the devices that remain. That rotation cannot live in this module
 * — it needs `sync/hdkTransfer`, which imports this file back, and House only
 * escapes the cycle with a dynamic `await import()` that throws under this
 * repo's Jest config. So the split is deliberate: transport here, rotation and
 * re-delivery there.
 *
 * The engine side is already in place — `installHealthHouseholdKeys` retires the
 * outgoing HDK into a bounded ring (`HEALTH_RETAINED_KEY_EPOCHS`), so rotating
 * no longer orphans attachments sealed under the old epoch.
 */
export async function revokeHealthLocalFirstDevice(
  deviceId: string,
): Promise<ControlPlaneHealthState> {
  const ledger = getLocalHealthLedger();
  const res = await apiClient.delete<{ state: ControlPlaneHealthState }>(
    `/v2/households/${ledger.household.id}/devices/${encodeURIComponent(deviceId)}`,
    { headers: LF_HEADERS },
  );
  return res.data.state;
}

// ---------------------------------------------------------------------------
// Mailbox + checkpoints — the transport He4 / He8 build on. Pure `/v2` plumbing,
// identical in shape to House; the ciphertext is opaque to this module.
// ---------------------------------------------------------------------------

export async function depositHealthMailboxBlob(
  ciphertext: Uint8Array,
  recipientDeviceId?: string,
  options?: { wake?: boolean },
): Promise<unknown> {
  const ledger = getLocalHealthLedger();
  const res = await apiClient.post(
    `/v2/households/${ledger.household.id}/mailbox`,
    {
      recipientDeviceId: recipientDeviceId ?? null,
      // Required, not optional, for Health: the Worker uses it as the ONLY peer
      // exclusion. A Health household has one user, so `excludeUserId` matches
      // zero rows and cannot be relied on — and an empty `excludeDeviceId`
      // matches every device, i.e. this one wakes itself in a loop
      // (plan §2 item 4c).
      sourceDeviceId: ledger.deviceId,
      // The payload itself, which this function took as an argument and used to
      // drop on the floor: the body went out with a recipient and no blob, so
      // the Worker's `ciphertextBase64: z.string().min(1)` 400'd every deposit —
      // every op batch and every HDK wrap alike. Nothing caught it because no
      // test read the body it posts.
      ciphertextBase64: bytesToBase64(ciphertext),
      ...(options?.wake === undefined ? {} : { wake: options.wake }),
    },
    { headers: LF_HEADERS },
  );
  return res.data;
}

export async function fetchHealthMailboxBlobs(cursor?: string): Promise<{
  blobs: Array<{ blobId: string; ciphertext: Uint8Array; recipientDeviceId: string | null }>;
  hasMore: boolean;
  nextCursor?: string;
}> {
  const ledger = getLocalHealthLedger();
  const res = await apiClient.get<{
    blobs: Array<{ blobId: string; ciphertextBase64: string; recipientDeviceId?: string | null }>;
    hasMore?: boolean;
    cursor?: string;
  }>(`/v2/households/${ledger.household.id}/mailbox`, {
    headers: LF_HEADERS,
    // Without the cursor every page is the oldest page: paging on ack alone
    // cannot step over a blob that is never ackable (any broadcast), and the
    // mailbox stops delivering everything behind it.
    params: { deviceId: ledger.deviceId, ...(cursor ? { cursor } : {}) },
  });
  return {
    blobs: (res.data.blobs ?? []).map((b) => ({
      blobId: b.blobId,
      ciphertext: base64ToBytes(b.ciphertextBase64),
      // Kept, not discarded: only mail ADDRESSED to this device may be acked.
      recipientDeviceId: b.recipientDeviceId ?? null,
    })),
    hasMore: res.data.hasMore === true,
    ...(res.data.cursor ? { nextCursor: res.data.cursor } : {}),
  };
}

export async function ackHealthMailboxBlobs(blobIds: string[], deviceId?: string): Promise<void> {
  if (blobIds.length === 0) return;
  const ledger = getLocalHealthLedger();
  await apiClient.post(
    `/v2/households/${ledger.household.id}/mailbox/ack`,
    { blobIds, deviceId: deviceId ?? ledger.deviceId },
    { headers: LF_HEADERS },
  );
}

export type HealthCheckpointManifest = {
  v: 1;
  householdId: string;
  generation: number;
  versionVector: Record<string, number>;
  chunkCount: number;
  rootHash: string;
  signerDeviceId: string;
  signatureB64: string;
};

export async function putHealthCheckpointChunk(input: {
  householdId: string;
  generation: number;
  chunkIndex: number;
  chunkCount: number;
  ciphertext: Uint8Array;
  manifest?: HealthCheckpointManifest;
}): Promise<void> {
  await apiClient.put(
    `/v2/households/${input.householdId}/checkpoints`,
    {
      generation: input.generation,
      chunkIndex: input.chunkIndex,
      chunkCount: input.chunkCount,
      ciphertextBase64: bytesToBase64(input.ciphertext),
      ...(input.manifest ? { manifest: input.manifest } : {}),
    },
    { headers: LF_HEADERS },
  );
}

export async function fetchLatestHealthCheckpoint(householdId: string): Promise<{
  generation: number;
  chunkCount: number;
  expiresAt: string;
  manifest: HealthCheckpointManifest;
} | null> {
  try {
    const res = await apiClient.get<{
      generation: number;
      chunkCount: number;
      expiresAt: string;
      manifest: HealthCheckpointManifest;
    }>(`/v2/households/${householdId}/checkpoints/latest`, { headers: LF_HEADERS });
    return res.data;
  } catch (error: unknown) {
    if (httpStatusOf(error) === 404) return null;
    throw error;
  }
}

export async function fetchHealthCheckpointChunk(
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

/** Exported for the header test — every request above must carry exactly this. */
export const HEALTH_LOCAL_FIRST_HEADERS = LF_HEADERS;
