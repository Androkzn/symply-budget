// Side-effect BEFORE engine/@symply/local-first — noble caches crypto at import.
import './cryptoPolyfill';

import type {
  CreateInviteLinkRequest,
  Household,
  HouseholdMember,
  HouseUnitSystem,
  JoinRequest,
  MyJoinRequest,
  OwnerJoinRequest,
} from '@api/households';
import { useAuthStore } from '@stores/authStore';

import { blobKeyFor, deleteHouseBlob, uploadHouseBlob, type HouseBlobDescriptor } from './blobs';
import {
  approveLocalFirstInvite,
  buildHouseInviteLink,
  createLocalFirstInvite,
  fetchControlPlaneState,
  joinLocalFirstHousehold,
  listPendingJoinRequests,
  lookupLocalFirstInvite,
  parseInviteInput,
  revokeLocalFirstDevice,
  type PendingJoinRequest,
} from './controlPlaneClient';
import {
  activateLocalHouseProperty,
  createLocalHouseProperty,
  getActiveHouseholdId,
  getLocalHouseLedger,
  getLocalHouseLedgerFor,
  isLocalHouseSessionOpen,
  listLocalHouseProperties,
  removeLocalHouseProperty,
  type HouseLedger,
  type HousePropertySummary,
} from './engine';
import { startNewHouseholdOnThisDevice } from './ensureSession';
import { HouseLocalNotReadyError, HouseLocalUnsupportedError } from './errors';
import { houseDeterministicIds } from './ids';
import { ledger, nowIso, writeLocal } from './localWrite';
import { toLedgeredHousehold, type LedgeredHousehold } from './types';

/**
 * `householdsApi` for a local-first House device (plan §6, Wave A).
 *
 * This is the one Wave-A module that does not map onto a single destination.
 * The remote module is 26 methods across three subsystems, and H3 sends each to
 * the place that actually owns it:
 *
 *  1. **Property fields → the ledger.** `name`, address, `unit_system`,
 *     `photo_key`, `purchase_price`, `purchase_date`. `lf_households` on the
 *     control plane is metadata-only by design (id, owner, display name, key
 *     epoch), so writing these there would put a member's home address in
 *     plaintext on the server — plan §1.5 hazard S5. They live in the ledgered
 *     `households` row, and list/get read the H5 session manager so a landlord's
 *     three properties all appear rather than only the active one.
 *  2. **Membership + invites → the device-enrolment handshake.** Q14 (§5.1)
 *     COLLAPSES `household_invitations`, `household_invite_links` and
 *     `household_join_requests` into the `lf_invites` flow (create → claim → OOB
 *     phrase → approve → HDK deposit). The two models cannot run side by side: a
 *     member who joined by email invite has no device keypair and can decrypt
 *     nothing, so a legacy-only method THROWS with copy pointing at the new flow
 *     instead of quietly doing half the job.
 *  3. **Photo bytes → H6.** `uploadPhoto` seals the picture to the household key
 *     through `uploadHouseBlob` and writes BOTH the synthetic `lf-blob/<blobId>`
 *     key and the descriptor that opens it; `deletePhoto` clears the pair and
 *     drops the bytes. This threw "photos sync in a later update" for longer
 *     than it was true — H6 shipped, three other local modules were already
 *     sealing through it, and the home photo was the last thing on the property
 *     that did not travel.
 *
 * Coverage rule (plan §6, non-negotiable): every remote method has a local
 * counterpart here. A gap is a THROWN `HouseLocalUnsupportedError`, never a
 * missing key — a missing key routes the call to a server that holds no rows for
 * this household, and the screen renders empty and confident.
 */

/**
 * The S5 field set: the domain columns that belong in the ledger.
 *
 * `src/api/households.ts` keeps `CreateHouseholdRequest`/`UpdateHouseholdRequest`
 * private, so the shape is restated here. `null` clears a field, an absent key
 * leaves it alone — the same contract the remote PATCH has.
 */
export type HousePropertyFieldsInput = {
  name?: string;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: 'CA' | 'US' | null;
  unit_system?: HouseUnitSystem | null;
  photo_key?: string | null;
  /**
   * The H6 descriptor for the home photo — see `Household.photo_blob`.
   *
   * Beside `photo_key` rather than instead of it, and written in the same op:
   * the key is what the DTO requires and the descriptor is what actually opens
   * the bytes on another member's phone.
   */
  photo_blob?: HouseBlobDescriptor | null;
  purchase_price?: number | null;
  purchase_date?: string | null;
};

/**
 * Exactly the columns hazard S5 names, in one place, so "is this a ledger field
 * or a control-plane field?" is answered by a list rather than by memory.
 */
const PROPERTY_FIELD_KEYS = [
  'name',
  'address_line1',
  'address_line2',
  'city',
  'state_province',
  'postal_code',
  'country',
  'unit_system',
  'photo_key',
  'photo_blob',
  'purchase_price',
  'purchase_date',
] as const;

/**
 * What the invitee's device is allowed to know before approval.
 *
 * `/v2/invites/lookup` deliberately does not disclose the property's display
 * name: an invite code travels over whatever channel the owner chose, and the
 * name is member data. The join screen shows this until the HDK lands and the
 * real name arrives with the owner's rows.
 */
const UNAPPROVED_PROPERTY_NAME = 'Shared home';

/**
 * Member-facing copy for the legacy membership surface (plan §5.1, Q14).
 *
 * Mirrors Budget's `ai/localAiUnsupported.ts`: the shared error class carries one
 * generic sentence, which is right for a screen that is merely offline and wrong
 * here — these methods are not "not yet", they are *replaced*, and the member
 * needs to be told what to do instead. `name` and `code` are untouched, so
 * `app.onError`, the sync status card and any `instanceof` check still key on the
 * same error.
 */
const REPLACED_BY_ENROLMENT = {
  invite:
    'Email invitations have been replaced by invite codes. Only a device can hold this home’s encryption key, so open Members → Invite and share the code with the person you want to add.',
  getInvitations:
    'Pending email invitations no longer exist. Members → Invite shows the codes you have shared and any device waiting for your approval.',
  cancelInvitation:
    'There is nothing to cancel — an invite code expires on its own, and a device only joins after you approve it in Members.',
  validateInvitation:
    'That invitation link is from an older version of Symply House. Ask the home owner to send you a new invite code from Members → Invite.',
  acceptInvitation:
    'That invitation link is from an older version of Symply House. Ask the home owner to send you a new invite code, then enter it on this device.',
  acceptInvitationInApp:
    'Invitations are now accepted by entering the invite code on the joining device and confirming the three-word phrase with the home owner.',
  declineInvitationInApp:
    'There is nothing to decline — an invite you ignore expires on its own.',
  searchUsers:
    'Symply House no longer searches for people by name or email. Share your invite code with them instead — only their device can be added to this home.',
  approveJoinRequest:
    'Approving someone now needs the three-word check. Open Members → Requests, compare the phrase with the person joining, and tap the one they read out.',
  denyJoinRequest:
    'Requests cannot be declined yet — one you ignore expires by itself, and you can remove the device later from Members.',
  updateMemberRole:
    'Roles are chosen when you send an invite. To change someone’s role, remove them and send a new invite with the role you want.',
  requestToJoin:
    'That invite code does not look complete. Paste the whole link the owner sent you, or type the code and the secret exactly as they appear.',
  deleteLastProperty:
    'This is your only home, and Symply House needs one. Add another property first, or edit this one instead of deleting it.',
} as const;

/** Throw the shared error, carrying copy that names the replacement flow. */
function unsupported(method: keyof typeof REPLACED_BY_ENROLMENT): never {
  const error = new HouseLocalUnsupportedError(`households.${method}`);
  error.message = REPLACED_BY_ENROLMENT[method];
  throw error;
}

/**
 * The member row for this device's own account.
 *
 * Wave A writes no `householdMembers` rows (membership arrives with enrolment in
 * H12), and a members screen that lists nobody — not even you — reads as data
 * loss rather than as an empty table. The id is the S3b deterministic one, so
 * this view row and the row a later enrolment writes are the same row key.
 */
function selfMember(source: HouseLedger): HouseholdMember {
  const { user } = useAuthStore.getState();
  return {
    id: houseDeterministicIds.householdMember(source.household.id, source.memberId),
    user_id: source.memberId,
    display_name: user?.display_name ?? null,
    avatar_url: null,
    email: user?.email ?? '',
    role: source.household.my_role,
    joined_at: source.household.created_at,
  };
}

function membersOf(source: HouseLedger): HouseholdMember[] {
  const householdId = source.household.id;
  const rows = source.householdMembers.filter((row) => row.household_id === householdId);
  if (rows.some((row) => row.user_id === source.memberId)) return rows;
  return [selfMember(source), ...rows];
}

/**
 * The `Household` a screen sees: ledgered domain fields, local answers for the
 * per-viewer ones.
 *
 * The ledgered row is shared byte-for-byte with every peer, so `my_role` and
 * `member_count` must NOT be read from it — they answer "who is asking", not
 * "what is this home". Reading `my_role` off the synced row would render the
 * owner's role on a member's phone and hand them owner-only controls.
 */
function propertyView(source: HouseLedger): Household {
  const binding = source.household;
  const row = source.households.find((candidate) => candidate.id === binding.id);
  const members = membersOf(source);
  return {
    ...binding,
    ...(row ?? {}),
    id: binding.id,
    my_role: binding.my_role,
    member_count: members.length,
  };
}

/**
 * The ledgered domain row for a property, created from the local binding if the
 * ledger has not got one yet.
 *
 * A property adopted by enrolment starts with empty tables — the owner's rows
 * arrive later as ops. Seeding from the binding means an edit made in that window
 * is a real ledgered write that converges under LWW, rather than a change that
 * disappears the moment the owner's row lands.
 */
function propertyRowFor(draft: HouseLedger, householdId: string): LedgeredHousehold {
  const existing = draft.households.find((row) => row.id === householdId);
  if (existing) return existing;
  // `toLedgeredHousehold` drops `my_role`/`member_count`/`photo_url`: those are
  // per-VIEWER answers and ledgering them would sync one member's role to
  // everyone else (see the type's header in `types.ts`).
  const seeded: LedgeredHousehold = { ...toLedgeredHousehold(draft.household), id: householdId };
  draft.households.push(seeded);
  return seeded;
}

/**
 * Refresh the local binding from the row it caches — as a COPY, never as the row.
 *
 * `engine.ts` seeds a minted property with ONE object in both `household` and
 * `households[0]`, and the projection merges a peer's fields into a row IN PLACE
 * (`applyLedgerDelta`: `target[field] = value`). Left aliased, a peer op carrying
 * `my_role` would write straight through the row into this device's binding and
 * hand a member the owner's controls. Copying on the first write breaks the link
 * for good, and preserving the per-viewer fields is what makes the binding the
 * answer to "who am I here" while the row stays the answer to "what is this home".
 *
 * The durable fix LANDED: `LedgeredHousehold` (`types.ts`) omits the per-viewer
 * fields, so they cannot enter a delta at all. This copy remains because the
 * binding must still be a distinct object from the row — the projection merges
 * a peer's property fields into the row in place, and the binding is what the
 * screens read.
 */
function refreshBinding(draft: HouseLedger, row: LedgeredHousehold): void {
  draft.household = {
    ...draft.household,
    ...row,
    // Per-viewer, and deliberately NOT sourced from the row: it does not have
    // them. This device's answer stays this device's answer.
    my_role: draft.household.my_role,
    member_count: draft.household.member_count,
    photo_url: draft.household.photo_url,
  };
}

/**
 * Copy the S5 fields onto a row. Returns whether anything actually moved, so a
 * PATCH that changes nothing does not cost an op (and a peer round-trip).
 */
function applyPropertyFields(target: LedgeredHousehold, input: HousePropertyFieldsInput): boolean {
  const patch = input as Record<string, unknown>;
  const row = target as unknown as Record<string, unknown>;
  let changed = false;
  for (const key of PROPERTY_FIELD_KEYS) {
    if (!(key in patch)) continue;
    const next = patch[key];
    // `undefined` is "not sent"; only `null` clears. The remote PATCH draws the
    // same line, and collapsing them would wipe a field on every partial save.
    if (next === undefined) continue;
    if (row[key] === next) continue;
    row[key] = next;
    changed = true;
  }
  if (changed && 'photo_key' in patch) {
    // `photo_url` is a server-signed URL derived from the key. Keeping the old
    // one alive would keep rendering the previous photo after a change.
    row.photo_url = null;
  }
  if (changed) row.updated_at = nowIso();
  return changed;
}

/**
 * Run a ledger write against a named property.
 *
 * The write path (`mutateLocalHouseLedger` → `writeLocal`) is bound to the ACTIVE
 * session, so a call naming another property has exactly two honest outcomes:
 * move the session, or refuse. Writing anyway would put property B's address into
 * property A's ledger — silent cross-home corruption, and the H5 design rule
 * (§7, one engine state per property) exists to prevent precisely that.
 * Activating is what the member meant: they addressed that home.
 */
async function withProperty<T>(householdId: string, run: () => Promise<T>): Promise<T> {
  if (getActiveHouseholdId() !== householdId) {
    // Throws `HouseLocalUnknownPropertyError` for an id this device holds no
    // ledger for, which is the right answer — there is nothing to write into.
    await activateLocalHouseProperty(householdId);
  }
  return run();
}

/**
 * Claimed-but-unapproved invites for ONE property.
 *
 * An owner of three homes needs the answer for all three, so the household is
 * named explicitly rather than taken from whichever ledger is on screen. This
 * used to fork — active property through the client, background properties
 * through a filtered state read — but the pending endpoint takes the household
 * as a parameter and resolves the claimant to a person either way, so both
 * cases are now the one call.
 */
async function pendingEnrolmentsFor(householdId: string): Promise<PendingJoinRequest[]> {
  return listPendingJoinRequests(householdId);
}

/** Legacy `'owner' | 'member'` → the `lf_memberships` enum (plan §1.5 hazard S4). */
function enrolmentRole(role?: 'owner' | 'member'): 'OWNER' | 'ADULT' {
  return role === 'owner' ? 'OWNER' : 'ADULT';
}

/**
 * Enrolment invite → the legacy join-request shape the members screen renders.
 *
 * The claimant now arrives as a person: an owner deciding whether to admit a
 * device needs an address and a name, not a user id and a key. Only the claim
 * timestamp still has no counterpart — the control plane returns the expiry and
 * nothing else — so that one field stays borrowed rather than invented.
 */
function toJoinRequest(invite: PendingJoinRequest): JoinRequest {
  return {
    id: invite.inviteId,
    user_id: invite.claimedByUserId ?? '',
    display_name: invite.claimedByDisplayName,
    avatar_url: null,
    email: invite.claimedByEmail ?? '',
    requested_at: invite.expiresAt,
  };
}

export const localHouseholdsApi = {
  // ---------------------------------------------------------------------
  // 1. Property fields — the ledger (plan §1.5 hazard S5) + the H5 registry
  // ---------------------------------------------------------------------

  /**
   * Every property this device holds, not just the active one.
   *
   * Reads the H5 session manager rather than a single ledger, because House
   * users routinely hold several homes and the property switcher enumerates all
   * of them. Hydration is the cost: the domain fields live in encrypted rows, so
   * a cold property must be decrypted before its address can be read. It is paid
   * once per property per app run (`getLocalHouseLedgerFor` is idempotent), and
   * the alternative — returning name and role only — would render every
   * background property with a blank address, which is worse than slow.
   */
  list: async (): Promise<{ households: Household[] }> => {
    if (!isLocalHouseSessionOpen()) throw new HouseLocalNotReadyError();
    const households: Household[] = [];
    for (const property of listLocalHouseProperties()) {
      // One SQLite file: parallel decrypts interleave transactions for no gain.
      households.push(propertyView(await getLocalHouseLedgerFor(property.householdId)));
    }
    return { households };
  },

  /**
   * A home on this device — the FIRST one, or a second, third, fourth.
   *
   * `createLocalHouseProperty` mints the ledger, the HDK and the preset seed;
   * this adds the S5 domain fields the create form collected. The new property is
   * activated first because the write path binds to the active session — and
   * because landing in the home you just created is what the member expects.
   *
   * The first-home case is why this no longer assumes a session. Sign-up mints
   * nothing (see `decideWhatAnEmptyDeviceMayDo`), so on a brand-new account
   * there is no ledger for a property to be created INSIDE — this call is the
   * member asking for their first one, and `startNewHouseholdOnThisDevice` is
   * what opens the ledger, publishes the store and starts sync for it. Without
   * that branch onboarding's create form would throw `HouseLocalNotReadyError`
   * on the first tap of "Create Home".
   *
   * NOTE: the control plane does not learn about the new property here. That
   * registration reads the active ledger from `syncLocalHouseholdToControlPlane()`
   * and runs on the next sync; doing it inline would put a network call on a path
   * that must work in airplane mode.
   */
  create: async (data: HousePropertyFieldsInput & { name: string }) => {
    let householdId: string;
    if (isLocalHouseSessionOpen()) {
      const created = await createLocalHouseProperty({ displayName: data.name });
      householdId = created.household.id;
      await activateLocalHouseProperty(householdId);
    } else {
      await startNewHouseholdOnThisDevice(data.name);
      const active = getActiveHouseholdId();
      if (!active) throw new HouseLocalNotReadyError();
      householdId = active;
    }

    // `name` is already on the minted row and its HOUSEHOLD_CREATE op. A create
    // form that carried nothing else must not cost a second (empty) op.
    const domainFields: HousePropertyFieldsInput = { ...data };
    delete domainFields.name;
    if (Object.keys(domainFields).length > 0) {
      await writeLocal(
        (draft) => {
          const row = propertyRowFor(draft, householdId);
          if (applyPropertyFields(row, domainFields)) refreshBinding(draft, row);
        },
        {
          opType: 'HOUSEHOLD_UPDATE',
          entityType: 'household',
          entityId: householdId,
          payload: domainFields,
        },
      );
    }
    return { household: propertyView(ledger()) };
  },

  get: async (householdId: string): Promise<{ household: Household; members: HouseholdMember[] }> => {
    const source = await getLocalHouseLedgerFor(householdId);
    return { household: propertyView(source), members: membersOf(source) };
  },

  /**
   * Edit a property's domain fields.
   *
   * The write lands in the ledgered `households` row — encrypted, device
   * authoritative, converging under per-field LWW — and never on `lf_households`,
   * which stays metadata-only (plan §1.5 hazard S5). The local binding is
   * refreshed from the same row so the property switcher and a cold, unhydrated
   * read agree with it; the binding is a cache of the row, never the other way
   * round.
   */
  update: async (householdId: string, data: HousePropertyFieldsInput) =>
    withProperty(householdId, async () => {
      await writeLocal(
        (draft) => {
          const row = propertyRowFor(draft, householdId);
          if (applyPropertyFields(row, data)) refreshBinding(draft, row);
        },
        {
          opType: 'HOUSEHOLD_UPDATE',
          entityType: 'household',
          entityId: householdId,
          payload: data,
        },
      );
      return { household: propertyView(ledger()) };
    }),

  /**
   * Drop a property from this device (rows, sync cursors and index entry).
   *
   * H5 refuses to remove the last one — the engine has no "no property" state —
   * so that case is turned into copy a member can act on instead of an assertion.
   */
  delete: async (householdId: string): Promise<void> => {
    if (listLocalHouseProperties().length <= 1) unsupported('deleteLastProperty');
    await removeLocalHouseProperty(householdId);
  },

  /**
   * Leave a shared property: this device gives up its copy and its key material.
   *
   * The sole-owner refusal mirrors the server rule (`POST /households/:id/leave`)
   * on purpose — a sole owner leaving would strand a home nobody can administer,
   * and the local answer must not be more permissive than the remote one.
   *
   * The control plane still lists this device as enrolled; there is no self-revoke
   * route in the enrolment handshake, so the owner retires the membership with a
   * device revoke (which rotates the key epoch anyway).
   */
  leave: async (householdId: string): Promise<void> => {
    const source = await getLocalHouseLedgerFor(householdId);
    const others = membersOf(source).filter((member) => member.user_id !== source.memberId);
    const soleOwner =
      source.household.my_role === 'owner' && !others.some((member) => member.role === 'owner');
    if (soleOwner) {
      throw new Error(
        'You are the only owner of this home. Make someone else an owner, or delete the property instead of leaving it.',
      );
    }
    await removeLocalHouseProperty(householdId);
  },

  /**
   * Drop the photo — the pointer AND the descriptor, in one op.
   *
   * Both, always. Clearing only `photo_key` would leave a peer holding a
   * descriptor and rendering the picture the owner just removed, and clearing
   * only `photo_blob` would leave a key naming bytes nothing can open. They are
   * one fact about the property and they move together.
   *
   * The sealed bytes are deleted after the row, and separately: `deleteHouseBlob`
   * reaches the network, and a removal the member has confirmed must not fail
   * because the relay was unreachable. The row is what every screen reads, so
   * once it is clear the photo is gone as far as anyone can tell; an orphaned
   * object costs quota and nothing else.
   */
  deletePhoto: async (householdId: string): Promise<void> => {
    let removed: HouseBlobDescriptor | undefined;
    await withProperty(householdId, async () => {
      await writeLocal(
        (draft) => {
          const row = propertyRowFor(draft, householdId);
          removed = row.photo_blob;
          if (applyPropertyFields(row, { photo_key: null, photo_blob: null })) {
            refreshBinding(draft, row);
          }
        },
        {
          opType: 'HOUSEHOLD_UPDATE',
          entityType: 'household',
          entityId: householdId,
          payload: { photo_key: null, photo_blob: null },
        },
      );
    });
    if (removed) {
      await deleteHouseBlob(removed.blobId, householdId).catch((error: unknown) => {
        console.warn('[house.local] home photo bytes not deleted', householdId, error);
      });
    }
  },

  // ---------------------------------------------------------------------
  // 2. Membership + invites — the device-enrolment handshake (plan §5.1, Q14)
  // ---------------------------------------------------------------------

  /**
   * Issue an enrolment invite and shape it like the legacy invite link, so the
   * share sheet and the deep-link entry points keep working (§5.1 keeps the entry
   * points and changes what they resolve to).
   *
   * `max_uses` is deliberately ignored: an enrolment invite binds ONE device
   * keypair, and a reusable code would hand the household key to devices the
   * owner never approved.
   */
  createInviteLink: async (householdId: string, data: CreateInviteLinkRequest = {}) =>
    withProperty(householdId, async () => {
      const invite = await createLocalFirstInvite({
        role: enrolmentRole(data.role),
        ...(data.expires_in_days ? { ttlHours: data.expires_in_days * 24 } : {}),
      });
      const link =
        invite.universalLink ||
        buildHouseInviteLink({
          inviteId: invite.inviteId,
          shortCode: invite.shortCode,
          secret: invite.secret,
        });
      return {
        invite_link: {
          id: invite.inviteId,
          url: link,
          short_url: link,
          // The claim secret, not a bearer token: it proves possession of the
          // code and is useless without the owner's phrase check afterwards.
          token: invite.secret,
          short_code: invite.shortCode,
          role: data.role ?? 'member',
          expires_at: invite.expiresAt,
        },
      };
    }),

  /**
   * Resolve whatever the invitee pasted — full link, `code secret` pair, or bare
   * code — to the property it belongs to.
   */
  validateInviteLink: async (token: string) => {
    const { shortCode } = parseInviteInput(token);
    if (!shortCode) {
      return { valid: false, error: 'That invite code is not complete. Paste the whole link the owner sent you.' };
    }
    try {
      const invite = await lookupLocalFirstInvite(shortCode);
      const valid = invite.status === 'active';
      return {
        valid,
        household: { id: invite.householdId, name: UNAPPROVED_PROPERTY_NAME },
        expiresAt: invite.expiresAt,
        ...(valid ? {} : { error: `This invite is ${invite.status}. Ask the owner for a new code.` }),
      };
    } catch {
      return { valid: false, error: 'That invite code was not found. Ask the owner for a new one.' };
    }
  },

  /**
   * The invitee's side: claim the invite with this device's public keys and
   * rebind the local ledger to the joined property.
   *
   * Still "pending" on return, exactly as the legacy join request was — the
   * household key only arrives after the owner confirms the three-word phrase,
   * and writes stay paused until then (`HouseLocalEnrolmentPendingError`).
   */
  requestToJoin: async (token: string) => {
    const { shortCode, secret } = parseInviteInput(token);
    if (!shortCode || !secret) unsupported('requestToJoin');
    const joined = await joinLocalFirstHousehold({ shortCode, secret });
    return {
      status: 'pending' as const,
      request_id: joined.inviteId,
      household: { id: joined.householdId, name: getLocalHouseLedger().household.name },
    };
  },

  /**
   * This device's own pending joins.
   *
   * No network: a property whose session is awaiting keys IS a pending request,
   * and the ledger knows when this device adopted it. Answering locally means the
   * "waiting for approval" banner still renders on the flight home.
   */
  getMyJoinRequests: async (): Promise<{ requests: MyJoinRequest[] }> => {
    const pending = listLocalHouseProperties().filter((property) => property.awaitingEnrolment);
    const requests: MyJoinRequest[] = [];
    for (const property of pending) {
      // A property awaiting keys has no rows yet, so this hydration is a meta read.
      const source = await getLocalHouseLedgerFor(property.householdId);
      requests.push({
        id: property.householdId,
        household_id: property.householdId,
        household_name: property.name,
        requested_at: source.household.created_at,
      });
    }
    return { requests };
  },

  /** Owner-side pending approvals for ONE property. */
  getJoinRequests: async (householdId: string): Promise<{ requests: JoinRequest[] }> => {
    const invites = await pendingEnrolmentsFor(householdId);
    return { requests: invites.map(toJoinRequest) };
  },

  /**
   * Owner-side pending approvals across every property this device owns — the
   * home-feed alert. H5 makes the fan-out meaningful: an owner of three homes
   * gets requests from all three, each labelled with the home it belongs to.
   */
  getOwnerPendingJoinRequests: async (): Promise<{ requests: OwnerJoinRequest[] }> => {
    const owned = listLocalHouseProperties().filter((property) => property.role === 'owner');
    const perProperty = await Promise.all(
      owned.map(async (property) => {
        try {
          const invites = await pendingEnrolmentsFor(property.householdId);
          return invites.map((invite) => ({
            ...toJoinRequest(invite),
            household_id: property.householdId,
            household_name: property.name,
          }));
        } catch {
          // One property's control plane being unreachable must not blank the
          // alerts for the others (the H5 fan-out rule, plan §7 rule 4).
          return [] as OwnerJoinRequest[];
        }
      }),
    );
    return { requests: perProperty.flat() };
  },

  /**
   * Remove a member by revoking every device they enrolled.
   *
   * This is the enrolment model's answer to `DELETE /members/:userId`, and it is
   * strictly stronger: the revoke rotates the key epoch, so the removed devices
   * cannot open anything written afterwards. Deleting a membership row alone
   * would leave them holding a working household key.
   */
  removeMember: async (householdId: string, userId: string): Promise<void> => {
    await withProperty(householdId, async () => {
      const state = await fetchControlPlaneState(householdId);
      const devices = state.devices.filter(
        (device) => device.userId === userId && device.status === 'active',
      );
      for (const device of devices) {
        // Each revoke rotates the key epoch; concurrent revokes race the rotation.
        await revokeLocalFirstDevice(device.deviceId);
      }
      await writeLocal(
        (draft) => {
          draft.householdMembers = draft.householdMembers.filter(
            (member) => !(member.household_id === householdId && member.user_id === userId),
          );
        },
        {
          opType: 'HOUSEHOLD_MEMBER_REMOVE',
          entityType: 'householdMember',
          entityId: houseDeterministicIds.householdMember(householdId, userId),
          payload: { user_id: userId },
        },
      );
    });
  },

  // --- Replaced by the enrolment handshake: no equivalent, so throw ---
  invite: async (): Promise<never> => unsupported('invite'),
  getInvitations: async (): Promise<never> => unsupported('getInvitations'),
  cancelInvitation: async (): Promise<never> => unsupported('cancelInvitation'),
  validateInvitation: async (): Promise<never> => unsupported('validateInvitation'),
  acceptInvitation: async (): Promise<never> => unsupported('acceptInvitation'),
  acceptInvitationInApp: async (): Promise<never> => unsupported('acceptInvitationInApp'),
  declineInvitationInApp: async (): Promise<never> => unsupported('declineInvitationInApp'),
  searchUsers: async (): Promise<never> => unsupported('searchUsers'),

  /**
   * Approval carries the OOB phrase check, and the legacy signature
   * `(householdId, requestId)` cannot express it. Approving without the phrase
   * would defeat the one defence the handshake has against a relay-side
   * man-in-the-middle, so this refuses and points at `approveEnrolment`.
   */
  approveJoinRequest: async (): Promise<never> => unsupported('approveJoinRequest'),
  denyJoinRequest: async (): Promise<never> => unsupported('denyJoinRequest'),
  updateMemberRole: async (): Promise<never> => unsupported('updateMemberRole'),

  // ---------------------------------------------------------------------
  // 3. Photo bytes — H6, the encrypted blob channel (plan §8)
  // ---------------------------------------------------------------------

  /**
   * Seal the home photo to the household key and point the property row at it.
   *
   * This used to throw "photos sync in a later update". H6 had already shipped
   * by then — `localTasksApi`, `localAppliancesApi` and `localHomeProjectsApi`
   * were all sealing bytes through `uploadHouseBlob` — so the message was
   * describing a gap that no longer existed, in an Alert titled "Error", over a
   * save that had otherwise worked. The same correction `unsupportedCopy` records
   * for the three home-project photo methods.
   *
   * TWO FIELDS, ONE WRITE, and the descriptor is the load-bearing one.
   * `photo_key` is what the DTO and every legacy screen require, and under
   * local-first it names nothing: there is no R2 object and no signed
   * `photo_url`. So it takes the synthetic `lf-blob/<blobId>` form that
   * `blobKeyFor` gives a task photo — unique, stable across a re-save, and
   * recognisable at a glance as "the bytes are NOT at /files/<key>" — while
   * `photo_blob` carries what actually opens them. A peer that syncs this row
   * gets the descriptor and can decrypt the picture; a peer that got only the
   * key would hold a receipt for an object its Worker never wrote.
   *
   * The response is shaped like the remote's `PhotoUploadResponse` because the
   * facade is typed `typeof householdsApi` and the caller reads `image_key`.
   */
  uploadPhoto: async (
    householdId: string,
    imageUri: string,
    contentType = 'image/jpeg',
  ): Promise<{ success: boolean; image_key: string }> => {
    return withProperty(householdId, async () => {
      // Replacing a photo, not accumulating them: a property has exactly one, so
      // the outgoing descriptor is read before the write and its bytes dropped
      // after it. Without this every re-crop of the same picture would leave the
      // previous sealed copy on the relay, against the household's quota, with
      // nothing left pointing at it.
      const previous = (await getLocalHouseLedgerFor(householdId)).household.photo_blob;

      const descriptor = await uploadHouseBlob({
        sourceUri: imageUri,
        mime: contentType,
        householdId,
      });

      await writeLocal(
        (draft) => {
          const row = propertyRowFor(draft, householdId);
          const fields = { photo_key: blobKeyFor(descriptor), photo_blob: descriptor };
          if (applyPropertyFields(row, fields)) refreshBinding(draft, row);
        },
        {
          opType: 'HOUSEHOLD_UPDATE',
          entityType: 'household',
          entityId: householdId,
          payload: { photo_key: blobKeyFor(descriptor), photo_blob: descriptor },
        },
      );

      if (previous && previous.blobId !== descriptor.blobId) {
        await deleteHouseBlob(previous.blobId, householdId).catch((error: unknown) => {
          console.warn('[house.local] replaced home photo not deleted', householdId, error);
        });
      }

      return { success: true, image_key: blobKeyFor(descriptor) };
    });
  },
};

// ---------------------------------------------------------------------------
// Local-only surface (named exports, deliberately NOT on `localHouseholdsApi`)
//
// The property switcher and the rebuilt membership screen need operations the
// server has no concept of: H5 session management and the OOB approval step.
// They live outside the api object for two reasons. The Proxy is typed
// `typeof householdsApi`, so a method that is not on the remote module cannot be
// named through the facade at all — putting these there would make them
// unreachable, not available. And the H3 parity diff (`__tests__/apiParity.test.ts`)
// reads a local-only method on the mirrored object as a rename that landed on
// one side, which is exactly the mistake it exists to catch.
// ---------------------------------------------------------------------------

/** Every property this device holds, without hydrating any of them. */
export function listHouseProperties(): HousePropertySummary[] {
  return listLocalHouseProperties();
}

/** The property the ledger reads and writes right now. */
export function getActiveHousePropertyId(): string | null {
  return getActiveHouseholdId();
}

/** Switch the ledger the app reads and writes. Hydrates on first visit. */
export async function activateHouseProperty(householdId: string): Promise<Household> {
  return propertyView(await activateLocalHouseProperty(householdId));
}

/**
 * Claimed invites awaiting approval, WITH the claiming device's keys — what the
 * approval sheet needs to derive the verification digits, and what the legacy
 * `JoinRequest` shape cannot carry.
 */
export function listHousePendingEnrolments(householdId: string): Promise<PendingJoinRequest[]> {
  return pendingEnrolmentsFor(householdId);
}

/**
 * Approve a claimed invite whose digits the two people have just matched,
 * releasing the household key to the device those digits were derived from.
 */
export function approveHouseEnrolment(input: {
  householdId: string;
  request: PendingJoinRequest;
}) {
  return withProperty(input.householdId, () => approveLocalFirstInvite({ request: input.request }));
}
