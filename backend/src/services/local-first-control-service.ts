import { isPersonalHouseholdBrand } from '../config/local-first-household-policy';
import type { CoordinatorState } from '../durable-objects/household-coordinator';
import type { Env } from '../types';
import { resolveAvatarUrl } from '../utils/avatar-url';
import { PersonalHouseholdViolationError } from '../utils/errors';

function coordinatorStub(env: Env, householdId: string) {
  if (!env.HOUSEHOLD_COORDINATOR) {
    throw new Error('HOUSEHOLD_COORDINATOR binding missing — local-first Worker only');
  }
  const id = env.HOUSEHOLD_COORDINATOR.idFromName(householdId);
  return env.HOUSEHOLD_COORDINATOR.get(id);
}

async function callCoordinator<T>(
  env: Env,
  householdId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const stub = coordinatorStub(env, householdId);
  const res = await stub.fetch(`https://do${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    body: init?.body,
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `coordinator_${res.status}`);
  }
  return data;
}

/**
 * Mirror a V2 local-first household + membership into the LEGACY
 * `households` / `household_members` tables.
 *
 * V2 keeps its own coordinator tables (`lf_households`, `lf_memberships`), and
 * the app rebinds `currentHousehold` to the local ledger id (`hh_local_…`) as
 * soon as the encrypted session opens. Every server feature that is still scoped
 * as `/households/:householdId/...` — household chat above all — authorises
 * against the legacy tables, so without this mirror a V2 user is "not a member"
 * of their own household and chat 403s on list, create and send.
 *
 * The mirror carries NO financial data: it is an identity/ACL row only (id, a
 * display name, and who may act in it), which is exactly what those endpoints
 * authorise on. The confidentiality guarantee that the backend cannot read
 * budget contents is untouched — financial state stays in the encrypted ledger.
 *
 * Best-effort and idempotent: a failure here must never break household
 * creation or an invite approval, which are the operations the user actually
 * asked for. Chat degrades; the ledger does not.
 */
async function mirrorLegacyMembership(
  env: Env,
  input: { householdId: string; displayName: string; userId: string; role: string },
): Promise<void> {
  const now = new Date().toISOString();
  // V2 roles are OWNER / ADULT / TEEN…; legacy only knows 'owner' | 'member'.
  const legacyRole = input.role.toUpperCase() === 'OWNER' ? 'owner' : 'member';
  try {
    // `deleted_at = NULL` here for the same reason the membership upsert below
    // clears it: the control plane is the authority on whether this membership
    // is live, and it has just told us it is.
    //
    // Without it the two rows heal apart, which is worse than either extreme.
    // Observed on a real device: the household row was soft-deleted while the
    // V2 membership survived, so `ensureLegacyMirror` restored the member and
    // left the household deleted. Every `/households/:id/...` endpoint then
    // moved from 403 (no membership) to 404 (no household) and stayed there —
    // authorised for a household the legacy tier insists does not exist. No
    // retry can escape that, because the only row the re-post touched was
    // already correct.
    await env.DB.prepare(
      `INSERT INTO households (id, name, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, deleted_at = NULL, updated_at = excluded.updated_at`,
    )
      .bind(input.householdId, input.displayName, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, joined_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(household_id, user_id) DO UPDATE SET
         role = excluded.role, deleted_at = NULL, updated_at = excluded.updated_at`,
    )
      .bind(crypto.randomUUID(), input.householdId, input.userId, legacyRole, now, now, now)
      .run();
  } catch (error) {
    console.error('[local-first] legacy household mirror failed', {
      householdId: input.householdId,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Withdraw the legacy mirror row when a membership ends.
 *
 * The counterpart to `mirrorLegacyMembership`, and not optional: the mirror is
 * what authorises household chat and every other `/households/:householdId/...`
 * feature, so a member removed from the V2 coordinator but left in
 * `household_members` keeps posting in the household they were just removed
 * from. Soft delete rather than DELETE, because that is what the legacy tier
 * itself does (`HouseholdService.removeMember`) and what the re-join path undoes
 * (`deleted_at = NULL` in the upsert above).
 *
 * Best-effort for the same reason as the mirror it undoes: the ledger-side
 * revocation has already happened and must not be reported as failed because a
 * secondary table did not move. It is retried on the member's next re-join.
 */
async function withdrawLegacyMembership(
  env: Env,
  input: { householdId: string; userId: string },
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `UPDATE household_members SET deleted_at = ?, updated_at = ?
        WHERE household_id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
      .bind(now, now, input.householdId, input.userId)
      .run();
  } catch (error) {
    console.error('[local-first] legacy membership withdrawal failed', {
      householdId: input.householdId,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The ONE device upsert. Both registration and invite-approval go through it.
 *
 * Keyed on `(household_id, id)` since migration 0156. That composite key is what
 * lets a single device be an active member of SEVERAL households at once —
 * required by House V2 multi-property, where one phone holds 1-3 properties.
 *
 * Before 0156 the PK was `id` alone, so a device row was globally unique and
 * joining a second household conflicted on `id`. The interim fix re-homed the
 * row (moved `household_id`/`user_id`), which is right for one-household-per-
 * device but would silently evict a House user from property A the moment they
 * activated property B. The composite key removes the conflict entirely, so
 * **the upsert must NOT touch `household_id` or `user_id`** — a conflict here now
 * means "this device re-registering in THIS household", nothing more.
 *
 * `device_label` uses COALESCE because approval has no label to offer and must
 * not blank the one registration already set.
 *
 * Binds: id, household_id, user_id, device_label, signing_pk, agreement_pk,
 * last_seen_at, created_at.
 */
export const LF_DEVICE_UPSERT_SQL = `INSERT INTO lf_devices
        (id, household_id, user_id, device_label, signing_public_key, agreement_public_key,
         status, last_seen_at, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)
       ON CONFLICT(household_id, id) DO UPDATE SET
         signing_public_key = excluded.signing_public_key,
         agreement_public_key = excluded.agreement_public_key,
         device_label = COALESCE(excluded.device_label, lf_devices.device_label),
         status = 'active',
         revoked_at = NULL,
         last_seen_at = excluded.last_seen_at`;

/**
 * Who a member IS, as opposed to what they may do.
 *
 * The coordinator holds user ids, roles and key material and nothing else —
 * deliberately, because it is the security authority and a display name has no
 * business in it. But a roster of `usr_9f2c…` is not a roster: every Budget
 * surface that names a peer (the pension member switcher, the savings member
 * map, the household list) fell back to the literal string "Household member"
 * because the id was all it ever had.
 *
 * So the profile is joined ON TOP of coordinator state, in the tier that can do
 * it — exactly the split `listPendingInvites` already uses for the claimant.
 */
export type MemberProfile = {
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  /**
   * `users.updated_at`, so a client can tell "they renamed themselves" from
   * "we re-fetched" without diffing strings.
   */
  profileUpdatedAt: string | null;
};

/** Coordinator state with every member and device resolved to a person. */
export type HouseholdState = Omit<CoordinatorState, 'members' | 'devices'> & {
  members: Array<CoordinatorState['members'][number] & MemberProfile>;
  devices: Array<CoordinatorState['devices'][number] & MemberProfile>;
};

const BLANK_PROFILE: MemberProfile = {
  displayName: null,
  avatarUrl: null,
  email: null,
  profileUpdatedAt: null,
};

/**
 * One invite, described well enough to write a sentence about it to a human.
 *
 * Both parties are here because both need telling, and they are different
 * people: `createdByUserId` is the only account whose device holds the invite
 * secret and can therefore approve the claim, and `claimedByUserId` is the one
 * left staring at "Waiting for approval…" until somebody does.
 */
export type InviteNotificationContext = {
  inviteId: string;
  shortCode: string;
  householdId: string;
  householdName: string | null;
  status: string;
  expiresAt: string;
  createdByUserId: string;
  claimedByUserId: string | null;
  /** Display name or email of the claimant, for "X is waiting to join". */
  claimedByName: string | null;
  /**
   * Whoever performed the act being announced, when a person performed it.
   *
   * Present on revoke (an owner tapped Cancel) and absent on the cron sweep
   * (nobody did anything; time passed). It exists so a notification is never
   * delivered to the account that caused it: one person enrolling their own
   * second device is BOTH parties to the invite, and without this they get
   * "Invite cancelled — the invite was cancelled before your device was
   * approved" a second after tapping Cancel themselves.
   */
  actorUserId?: string | null;
};

export class LocalFirstControlService {
  constructor(private readonly env: Env) {}

  async createHousehold(input: {
    householdId: string;
    ownerUserId: string;
    displayName: string;
    device: {
      deviceId: string;
      signingPublicKey: string;
      agreementPublicKey: string;
      label?: string | null;
    };
  }): Promise<{ householdId: string; state: CoordinatorState }> {
    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `INSERT INTO lf_households
        (id, owner_user_id, display_name, key_epoch, security_revision, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1, ?, ?)`,
    )
      .bind(input.householdId, input.ownerUserId, input.displayName, now, now)
      .run();

    await this.env.DB.prepare(
      `INSERT INTO lf_memberships (id, household_id, user_id, role, status, created_at, revoked_at)
       VALUES (?, ?, ?, 'OWNER', 'active', ?, NULL)`,
    )
      .bind(crypto.randomUUID(), input.householdId, input.ownerUserId, now)
      .run();

    // Shared upsert, not a bare INSERT: household creation is retried from the
    // client on every session open, and a bare INSERT would raise a constraint
    // error on the second attempt instead of being idempotent.
    await this.env.DB.prepare(LF_DEVICE_UPSERT_SQL)
      .bind(
        input.device.deviceId,
        input.householdId,
        input.ownerUserId,
        input.device.label ?? null,
        input.device.signingPublicKey,
        input.device.agreementPublicKey,
        now,
        now,
      )
      .run();

    const state = await callCoordinator<CoordinatorState>(this.env, input.householdId, '/bootstrap', {
      method: 'POST',
      body: JSON.stringify({
        householdId: input.householdId,
        ownerUserId: input.ownerUserId,
        device: {
          deviceId: input.device.deviceId,
          userId: input.ownerUserId,
          signingPublicKey: input.device.signingPublicKey,
          agreementPublicKey: input.device.agreementPublicKey,
          label: input.device.label ?? null,
        },
      }),
    });

    // Keep `/households/:id/...` features (chat) resolvable for the owner.
    await mirrorLegacyMembership(this.env, {
      householdId: input.householdId,
      displayName: input.displayName,
      userId: input.ownerUserId,
      role: 'OWNER',
    });

    return { householdId: input.householdId, state };
  }

  /**
   * Re-assert the legacy `households` / `household_members` mirror for a caller
   * who is already an active V2 member.
   *
   * `createHousehold` only runs on the FIRST registration, so every household
   * created before the mirror existed — and every member who joined then — would
   * stay invisible to `/households/:id/...` forever. The client re-registers on
   * every session open and gets a 409 for an existing household; that 409 path
   * calls this, so those users self-heal on their next launch instead of needing
   * a one-shot backfill migration.
   */
  async ensureLegacyMirror(householdId: string, userId: string): Promise<void> {
    const row = await this.env.DB.prepare(
      `SELECT h.display_name AS display_name, m.role AS role
         FROM lf_households h
         JOIN lf_memberships m ON m.household_id = h.id
        WHERE h.id = ? AND m.user_id = ? AND m.status = 'active'`,
    )
      .bind(householdId, userId)
      .first<{ display_name: string; role: string }>();
    if (!row) return; // not an active V2 member — nothing to mirror
    await mirrorLegacyMembership(this.env, {
      householdId,
      displayName: row.display_name,
      userId,
      role: row.role,
    });
  }

  async getState(householdId: string, userId: string): Promise<HouseholdState> {
    await this.assertMember(householdId, userId);
    const state = await callCoordinator<CoordinatorState>(this.env, householdId, '/state');
    return this.withMemberProfiles(state);
  }

  /**
   * Resolve every user id in a coordinator state to a person.
   *
   * Best-effort by design: a household that cannot read `users` still has to
   * sync. The profile is what a roster is drawn from, not what a device is
   * authorised by, so a failed lookup degrades to ids-and-initials rather than
   * failing the call that carries the device keys.
   */
  private async withMemberProfiles(state: CoordinatorState): Promise<HouseholdState> {
    const userIds = [
      ...new Set([
        ...state.members.map((m) => m.userId),
        ...state.devices.map((d) => d.userId),
      ]),
    ].filter((id): id is string => Boolean(id));

    const profiles = await this.loadMemberProfiles(userIds);
    return {
      ...state,
      members: state.members.map((m) => ({ ...m, ...(profiles.get(m.userId) ?? BLANK_PROFILE) })),
      devices: state.devices.map((d) => ({ ...d, ...(profiles.get(d.userId) ?? BLANK_PROFILE) })),
    };
  }

  private async loadMemberProfiles(userIds: string[]): Promise<Map<string, MemberProfile>> {
    const profiles = new Map<string, MemberProfile>();
    if (userIds.length === 0) return profiles;

    try {
      const placeholders = userIds.map(() => '?').join(', ');
      const { results } = await this.env.DB.prepare(
        `SELECT id, email, display_name, avatar_url, updated_at
           FROM users WHERE id IN (${placeholders})`,
      )
        .bind(...userIds)
        .all<{
          id: string;
          email: string | null;
          display_name: string | null;
          avatar_url: string | null;
          updated_at: string | null;
        }>();

      for (const row of results ?? []) {
        profiles.set(row.id, {
          displayName: row.display_name,
          // `users.avatar_url` stores a BUCKET KEY (`avatars/x.jpg`), not a
          // URL — see `utils/avatar-url.ts`. Handing that to a client renders
          // as a broken image, which falls back to initials: the whole
          // household loses its faces and nothing in the app says why. Resolved
          // here, on the Worker that owns the object, exactly as `/auth/me`
          // resolves the caller's own.
          avatarUrl: resolveAvatarUrl(row.avatar_url, this.env.API_URL),
          email: row.email,
          profileUpdatedAt: row.updated_at,
        });
      }
    } catch (error) {
      console.error('[local-first] member profile lookup failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return profiles;
  }

  async registerDevice(input: {
    householdId: string;
    userId: string;
    deviceId: string;
    signingPublicKey: string;
    agreementPublicKey: string;
    label?: string | null;
  }): Promise<HouseholdState> {
    await this.assertMember(input.householdId, input.userId);
    // Belt and braces: a foreign user is already `not_a_member` here, but a
    // stale/legacy membership row must not be enough to attach a device to a
    // personal ledger.
    await this.assertPersonalHouseholdUser(input.householdId, input.userId);
    const now = new Date().toISOString();
    await this.env.DB.prepare(LF_DEVICE_UPSERT_SQL)
      .bind(
        input.deviceId,
        input.householdId,
        input.userId,
        input.label ?? null,
        input.signingPublicKey,
        input.agreementPublicKey,
        now,
        now,
      )
      .run();

    const state = await callCoordinator<CoordinatorState>(
      this.env,
      input.householdId,
      '/devices',
      { method: 'POST', body: JSON.stringify(input) },
    );
    // Enriched like `getState`, because the client renders THIS response
    // directly after a device rename — returning a bare state there would blank
    // every name and avatar in the list until the next refresh.
    return this.withMemberProfiles(state);
  }

  /**
   * Record that a device just reached this household.
   *
   * Best-effort and deliberately swallowing: this rides along on the sync poll,
   * and a liveness stamp failing must never turn a working sync into an error
   * the member sees. The coordinator throttles the write itself.
   */
  async touchDevice(householdId: string, deviceId: string): Promise<void> {
    try {
      await callCoordinator(this.env, householdId, '/devices/seen', {
        method: 'POST',
        body: JSON.stringify({ deviceId }),
      });
    } catch (error) {
      console.warn('[local-first] device liveness stamp failed', error);
    }
  }

  async revokeDevice(input: {
    householdId: string;
    actorUserId: string;
    deviceId: string;
  }): Promise<HouseholdState> {
    const state = await callCoordinator<CoordinatorState>(
      this.env,
      input.householdId,
      '/devices/revoke',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );

    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `UPDATE lf_devices SET status = 'revoked', revoked_at = ?, expo_push_token = NULL, push_platform = NULL, push_updated_at = NULL WHERE household_id = ? AND id = ?`,
    )
      .bind(now, input.householdId, input.deviceId)
      .run();
    await this.env.DB.prepare(
      `UPDATE lf_households SET key_epoch = ?, security_revision = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(state.keyEpoch, state.securityRevision, now, input.householdId)
      .run();

    return this.withMemberProfiles(state);
  }

  /**
   * Delete an already-revoked device row for good.
   *
   * The coordinator holds the authority (owner, or the actor's own hardware) and
   * refuses anything still active — this tier only mirrors the result into D1,
   * which is what every other authz lookup in the Worker reads.
   *
   * The `status = 'revoked'` guard on the DELETE is not redundant with the
   * coordinator's: the two stores can disagree (a mirror write that failed, a
   * household restored from an older D1), and between them the coordinator is
   * the authority on trust. If they ever do disagree, refusing to delete an
   * active-looking row here is the safe direction — a stale row in the list, not
   * a device silently dropped out of an authz check it should still fail.
   *
   * Mailbox blobs still addressed to the device are left alone: they hold R2
   * objects that the expiry sweep owns, and deleting the rows here would orphan
   * the bytes behind them.
   */
  async forgetDevice(input: {
    householdId: string;
    actorUserId: string;
    deviceId: string;
  }): Promise<HouseholdState> {
    const state = await callCoordinator<CoordinatorState>(
      this.env,
      input.householdId,
      '/devices/forget',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );

    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `DELETE FROM lf_devices WHERE household_id = ? AND id = ? AND status = 'revoked'`,
    )
      .bind(input.householdId, input.deviceId)
      .run();
    await this.env.DB.prepare(
      `UPDATE lf_households SET security_revision = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(state.securityRevision, now, input.householdId)
      .run();

    return this.withMemberProfiles(state);
  }

  /**
   * Promote a member to owner, or hand a former owner back to ADULT.
   *
   * Authorisation is the coordinator's, not this tier's: it holds the
   * membership state these rules are about, and a second D1 check here could
   * only disagree with it. What this tier adds is everything the coordinator
   * cannot see — the D1 mirror the rest of the Worker authorises against, and
   * the legacy `household_members` row household chat reads.
   *
   * No key rotation: a role is a permission, not key material, and rotating on
   * it would lock every peer out of the household to record a promotion.
   */
  async updateMemberRole(input: {
    householdId: string;
    actorUserId: string;
    memberUserId: string;
    role: 'OWNER' | 'ADULT';
  }): Promise<HouseholdState> {
    const state = await callCoordinator<CoordinatorState>(
      this.env,
      input.householdId,
      '/members',
      {
        method: 'POST',
        body: JSON.stringify({
          userId: input.memberUserId,
          role: input.role,
          actorUserId: input.actorUserId,
        }),
      },
    );

    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `UPDATE lf_memberships SET role = ? WHERE household_id = ? AND user_id = ? AND status = 'active'`,
    )
      .bind(input.role, input.householdId, input.memberUserId)
      .run();
    await this.env.DB.prepare(
      `UPDATE lf_households SET security_revision = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(state.securityRevision, now, input.householdId)
      .run();

    // Legacy roles are `owner` / `member`, and household chat authorises on
    // them — a new owner who cannot moderate the household chat has only half
    // the role they were given.
    const household = await this.env.DB.prepare(
      `SELECT display_name FROM lf_households WHERE id = ?`,
    )
      .bind(input.householdId)
      .first<{ display_name: string }>();
    await mirrorLegacyMembership(this.env, {
      householdId: input.householdId,
      displayName: household?.display_name ?? 'Household',
      userId: input.memberUserId,
      role: input.role,
    });

    return this.withMemberProfiles(state);
  }

  /**
   * End a membership: the person, and with them every device they hold here.
   *
   * The device-shaped sibling of this is `revokeDevice`, and the difference is
   * the point. Revoking devices one by one leaves the membership standing, so
   * the removed person can enrol a fresh device and walk straight back in —
   * their `lf_memberships` row still says `active`. This closes the membership
   * first and lets the coordinator cut the devices as a consequence.
   *
   * The D1 mirror follows the same order as `revokeDevice`: the coordinator
   * decides, then D1 records what it decided, then the epoch it minted is
   * published so `/state` and every list agree with the household key the
   * remaining devices are about to rotate to.
   */
  async removeMember(input: {
    householdId: string;
    actorUserId: string;
    memberUserId: string;
  }): Promise<HouseholdState> {
    const state = await callCoordinator<CoordinatorState>(
      this.env,
      input.householdId,
      '/members',
      {
        method: 'POST',
        body: JSON.stringify({
          userId: input.memberUserId,
          status: 'revoked',
          actorUserId: input.actorUserId,
        }),
      },
    );

    await this.mirrorEndedMembership(input.householdId, input.memberUserId, state);
    return this.withMemberProfiles(state);
  }

  /**
   * Leave a household of your own accord — the door `removeMember` is not.
   *
   * Same consequences, different authority: the coordinator refuses an owner
   * who would strand the household without one, and refuses nothing else.
   * Everything after the decision is identical, which is the point — a member
   * who left and a member who was removed must leave the same household behind.
   */
  async leaveHousehold(input: {
    householdId: string;
    actorUserId: string;
  }): Promise<HouseholdState> {
    const state = await callCoordinator<CoordinatorState>(
      this.env,
      input.householdId,
      '/members/leave',
      {
        method: 'POST',
        body: JSON.stringify({ actorUserId: input.actorUserId }),
      },
    );

    await this.mirrorEndedMembership(input.householdId, input.actorUserId, state);
    return this.withMemberProfiles(state);
  }

  /**
   * Write an ended membership into D1, in the coordinator's own order: it
   * decides, D1 records what it decided, then the epoch it minted is published
   * so `/state` and every list agree with the household key the remaining
   * devices are about to rotate to.
   *
   * The person's devices are DELETED rather than revoked, matching the
   * coordinator (see `endMembership` there). A revoked row is the memory of a
   * device whose owner stayed; once they are gone it keeps their hardware,
   * labels and enrolment dates on the household's record forever, and it keeps
   * `deviceBelongsToUser` — which matches the row, not its status — answering
   * yes for a phone that no longer belongs to anybody here. The push tokens go
   * with the rows, so the household's sync wake stops reaching a phone that has
   * no business hearing that something changed.
   */
  private async mirrorEndedMembership(
    householdId: string,
    memberUserId: string,
    state: CoordinatorState,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `UPDATE lf_memberships SET status = 'revoked', revoked_at = ?
        WHERE household_id = ? AND user_id = ?`,
    )
      .bind(now, householdId, memberUserId)
      .run();
    await this.env.DB.prepare(`DELETE FROM lf_devices WHERE household_id = ? AND user_id = ?`)
      .bind(householdId, memberUserId)
      .run();
    await this.env.DB.prepare(
      `UPDATE lf_households SET key_epoch = ?, security_revision = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(state.keyEpoch, state.securityRevision, now, householdId)
      .run();
    await withdrawLegacyMembership(this.env, { householdId, userId: memberUserId });
  }

  /**
   * What a household is called, for a sentence addressed to a human about it.
   * Null when the row is gone — the caller says "your shared budget" rather
   * than inventing a name.
   */
  async getHouseholdName(householdId: string): Promise<string | null> {
    const row = await this.env.DB.prepare(`SELECT display_name FROM lf_households WHERE id = ?`)
      .bind(householdId)
      .first<{ display_name: string }>();
    return row?.display_name ?? null;
  }

  async listHouseholdsForUser(userId: string): Promise<
    Array<{ id: string; display_name: string; role: string; key_epoch: number }>
  > {
    const { results } = await this.env.DB.prepare(
      `SELECT h.id, h.display_name, m.role, h.key_epoch
       FROM lf_households h
       JOIN lf_memberships m ON m.household_id = h.id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY h.created_at ASC`,
    )
      .bind(userId)
      .all<{ id: string; display_name: string; role: string; key_epoch: number }>();
    return results ?? [];
  }

  async createInvite(input: {
    householdId: string;
    createdByUserId: string;
    role: 'OWNER' | 'ADULT';
    inviteId: string;
    shortCode: string;
    secretHash: string;
    expiresAt: string;
    inviteeEmail?: string | null;
  }): Promise<{ invite: unknown }> {
    await this.assertMember(input.householdId, input.createdByUserId);
    const result = await callCoordinator<{ invite: unknown }>(
      this.env,
      input.householdId,
      '/invites',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );

    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `INSERT INTO lf_invites
        (id, household_id, short_code, secret_hash, role, created_by_user_id, status,
         expires_at, invitee_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
      .bind(
        input.inviteId,
        input.householdId,
        input.shortCode,
        input.secretHash,
        input.role,
        input.createdByUserId,
        input.expiresAt,
        input.inviteeEmail ?? null,
        now,
        now,
      )
      .run();

    return result;
  }

  async claimInvite(input: {
    householdId: string;
    inviteId: string;
    secretHash: string;
    userId: string;
    deviceId: string;
    signingPublicKey: string;
    agreementPublicKey: string;
  }): Promise<unknown> {
    // THE door. Claim is the only `/v2` route that authorises no membership —
    // by design, since the claimant is not a member yet — so it is where a
    // second `user_id` would enter a Health household. Checked before the
    // coordinator so a rejected claim never marks the invite `claimed`.
    await this.assertPersonalHouseholdUser(input.householdId, input.userId);
    await this.assertInviteeAddressMatches(input.householdId, input.inviteId, input.userId);
    const result = await callCoordinator<unknown>(this.env, input.householdId, '/invites/claim', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `UPDATE lf_invites SET status = 'claimed', claimed_by_user_id = ?, claimed_device_id = ?,
        claimed_signing_public_key = ?, claimed_agreement_public_key = ?, updated_at = ?
       WHERE id = ? AND household_id = ?`,
    )
      .bind(
        input.userId,
        input.deviceId,
        input.signingPublicKey,
        input.agreementPublicKey,
        now,
        input.inviteId,
        input.householdId,
      )
      .run();
    return result;
  }

  /**
   * Claimed-but-unapproved invites, with the claimant resolved to a person.
   *
   * The keys come back too: the owner's device needs them to derive the
   * enrolment SAS it shows the human, and — once confirmed — to wrap the
   * household key to the key it verified rather than to whatever a later
   * response happens to carry.
   */
  async listPendingInvites(
    householdId: string,
    actorUserId: string,
  ): Promise<
    Array<{
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
    }>
  > {
    await this.assertMember(householdId, actorUserId);
    const { results } = await this.env.DB.prepare(
      `SELECT i.id AS invite_id, i.short_code, i.role, i.expires_at,
              i.claimed_by_user_id, i.claimed_device_id,
              i.claimed_signing_public_key, i.claimed_agreement_public_key,
              u.email AS claimed_by_email, u.display_name AS claimed_by_display_name,
              d.device_label AS claimed_device_label
         FROM lf_invites i
         LEFT JOIN users u ON u.id = i.claimed_by_user_id
         LEFT JOIN lf_devices d
                ON d.id = i.claimed_device_id AND d.household_id = i.household_id
        WHERE i.household_id = ? AND i.status = 'claimed'
        ORDER BY i.updated_at DESC`,
    )
      .bind(householdId)
      .all<{
        invite_id: string;
        short_code: string;
        role: string;
        expires_at: string;
        claimed_by_user_id: string | null;
        claimed_device_id: string | null;
        claimed_signing_public_key: string | null;
        claimed_agreement_public_key: string | null;
        claimed_by_email: string | null;
        claimed_by_display_name: string | null;
        claimed_device_label: string | null;
      }>();

    return (results ?? []).map((row) => ({
      inviteId: row.invite_id,
      shortCode: row.short_code,
      role: row.role,
      expiresAt: row.expires_at,
      claimedByUserId: row.claimed_by_user_id,
      claimedByEmail: row.claimed_by_email,
      claimedByDisplayName: row.claimed_by_display_name,
      claimedDeviceId: row.claimed_device_id,
      claimedDeviceLabel: row.claimed_device_label,
      claimedSigningPublicKey: row.claimed_signing_public_key,
      claimedAgreementPublicKey: row.claimed_agreement_public_key,
    }));
  }

  /**
   * Refuse a claim from anyone other than the account the invite names.
   *
   * An invite link is a bearer credential in whatever messenger carried it —
   * forwarded, screenshotted, synced to a shared desktop. Binding it to one
   * address means a copy in the wrong hands claims nothing, which is the
   * property that keeps the owner's approval from being the only thing standing
   * between a leaked link and the household.
   *
   * Silent no-op when the invite names no address: an owner sharing a QR code
   * in person has nobody to name, and that path is still covered by the SAS the
   * two of them compare.
   */
  private async assertInviteeAddressMatches(
    householdId: string,
    inviteId: string,
    claimantUserId: string,
  ): Promise<void> {
    const row = await this.env.DB.prepare(
      `SELECT invitee_email FROM lf_invites WHERE id = ? AND household_id = ?`,
    )
      .bind(inviteId, householdId)
      .first<{ invitee_email: string | null }>();
    const expected = row?.invitee_email?.trim().toLowerCase();
    if (!expected) return;

    const claimant = await this.env.DB.prepare(`SELECT email FROM users WHERE id = ?`)
      .bind(claimantUserId)
      .first<{ email: string | null }>();
    const actual = claimant?.email?.trim().toLowerCase();
    // An unresolvable claimant fails closed: a bound invite that cannot prove
    // who is holding it is exactly the case this check exists for.
    if (!actual || actual !== expected) {
      throw new Error('invitee_mismatch');
    }
  }

  async approveInvite(input: {
    householdId: string;
    inviteId: string;
    actorUserId: string;
    confirmedSigningPublicKey: string;
    confirmedAgreementPublicKey: string;
  }): Promise<{
    state: CoordinatorState;
    approved: { userId: string; deviceId: string; agreementPublicKey: string };
  }> {
    // Approve is what actually writes `lf_memberships`, so it gets its own
    // check rather than trusting that the claim was guarded — the DO's claim
    // state and D1 can diverge if `claimInvite` half-failed, and approving a
    // foreign claimant is the mutation that would make a Health household
    // multi-user. The claimant is read from D1 (`claimed_by_user_id`, written by
    // `claimInvite`) so this runs before the coordinator mutates its state.
    //
    // A NULL claimant is left alone: nobody has claimed yet and the coordinator
    // answers `invite_not_claimed` (409), which is the truthful error.
    await this.assertPersonalHouseholdApproval(input.householdId, input.inviteId);

    const result = await callCoordinator<{
      state: CoordinatorState;
      approved: { userId: string; deviceId: string; agreementPublicKey: string };
    }>(this.env, input.householdId, '/invites/approve', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `UPDATE lf_invites SET status = 'approved', sas_verified_at = ?, updated_at = ?
       WHERE id = ? AND household_id = ?`,
    )
      .bind(now, now, input.inviteId, input.householdId)
      .run();

    await this.env.DB.prepare(
      `INSERT INTO lf_memberships (id, household_id, user_id, role, status, created_at, revoked_at)
       VALUES (?, ?, ?, ?, 'active', ?, NULL)
       ON CONFLICT(household_id, user_id) DO UPDATE SET status = 'active', revoked_at = NULL`,
    )
      .bind(
        crypto.randomUUID(),
        input.householdId,
        result.approved.userId,
        result.state.members.find((m) => m.userId === result.approved.userId)?.role ?? 'ADULT',
        now,
      )
      .run();

    await this.env.DB.prepare(
      LF_DEVICE_UPSERT_SQL,
    )
      .bind(
        result.approved.deviceId,
        input.householdId,
        result.approved.userId,
        null, // approval has no label; COALESCE keeps whatever registration set
        result.state.devices.find((d) => d.deviceId === result.approved.deviceId)?.signingPublicKey ??
          '',
        result.approved.agreementPublicKey,
        now,
        now,
      )
      .run();

    // The approved member must also be able to use `/households/:id/...`
    // features (chat) in the household they just joined.
    const household = await this.env.DB.prepare(
      `SELECT display_name FROM lf_households WHERE id = ?`,
    )
      .bind(input.householdId)
      .first<{ display_name: string }>();
    await mirrorLegacyMembership(this.env, {
      householdId: input.householdId,
      displayName: household?.display_name ?? 'Household',
      userId: result.approved.userId,
      role: result.state.members.find((m) => m.userId === result.approved.userId)?.role ?? 'ADULT',
    });

    return result;
  }

  /**
   * Resolve an invite, and say WHOSE household it opens.
   *
   * The name is the point. Joining rebinds the invitee's device and replaces
   * the budget on it, and until now this carried nothing but an opaque
   * `hh_local_…` id — so the person tapping "confirm" could not tell which
   * household they were about to be moved into, nor which one they were about
   * to lose. LEFT JOIN, not INNER: a household row that has gone missing must
   * still resolve the invite (and fail later, honestly) rather than read as
   * "invite not found".
   */
  async lookupInviteByShortCode(shortCode: string): Promise<{
    inviteId: string;
    householdId: string;
    householdName: string | null;
    status: string;
    expiresAt: string;
  } | null> {
    const row = await this.env.DB.prepare(
      `SELECT i.id, i.household_id, i.status, i.expires_at, h.display_name AS household_name
         FROM lf_invites i
         LEFT JOIN lf_households h ON h.id = i.household_id
        WHERE i.short_code = ?`,
    )
      .bind(shortCode.toUpperCase())
      .first<{
        id: string;
        household_id: string;
        status: string;
        expires_at: string;
        household_name: string | null;
      }>();
    if (!row) return null;
    return {
      inviteId: row.id,
      householdId: row.household_id,
      householdName: row.household_name ?? null,
      status: row.status,
      expiresAt: row.expires_at,
    };
  }

  async lookupInviteById(inviteId: string): Promise<{
    inviteId: string;
    householdId: string;
    householdName: string | null;
    status: string;
    expiresAt: string;
  } | null> {
    const row = await this.env.DB.prepare(
      `SELECT i.id, i.household_id, i.status, i.expires_at, h.display_name AS household_name
         FROM lf_invites i
         LEFT JOIN lf_households h ON h.id = i.household_id
        WHERE i.id = ?`,
    )
      .bind(inviteId)
      .first<{
        id: string;
        household_id: string;
        status: string;
        expires_at: string;
        household_name: string | null;
      }>();
    if (!row) return null;
    return {
      inviteId: row.id,
      householdId: row.household_id,
      householdName: row.household_name ?? null,
      status: row.status,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Everything a notification about an invite needs to name the people and the
   * household, in one read.
   *
   * Read AFTER the mutation that triggers the notification, never before: the
   * point of the message is to describe what is now true (claimed / approved /
   * revoked), and a row read beforehand describes what was true.
   */
  async getInviteNotificationContext(
    householdId: string,
    inviteId: string,
  ): Promise<InviteNotificationContext | null> {
    const row = await this.env.DB.prepare(
      `SELECT i.id, i.short_code, i.status, i.expires_at, i.created_by_user_id,
              i.claimed_by_user_id, h.display_name AS household_name,
              cu.display_name AS claimed_display_name, cu.email AS claimed_email
         FROM lf_invites i
         LEFT JOIN lf_households h ON h.id = i.household_id
         LEFT JOIN users cu ON cu.id = i.claimed_by_user_id
        WHERE i.id = ? AND i.household_id = ?`,
    )
      .bind(inviteId, householdId)
      .first<{
        id: string;
        short_code: string;
        status: string;
        expires_at: string;
        created_by_user_id: string;
        claimed_by_user_id: string | null;
        household_name: string | null;
        claimed_display_name: string | null;
        claimed_email: string | null;
      }>();
    if (!row) return null;
    return {
      inviteId: row.id,
      shortCode: row.short_code,
      householdId,
      householdName: row.household_name ?? null,
      status: row.status,
      expiresAt: row.expires_at,
      createdByUserId: row.created_by_user_id,
      claimedByUserId: row.claimed_by_user_id,
      claimedByName: row.claimed_display_name ?? row.claimed_email ?? null,
    };
  }

  /**
   * Every invite still in play — active (nobody has claimed) and claimed
   * (someone is waiting).
   *
   * `listPendingInvites` deliberately answers only the second, because it feeds
   * the approval ceremony and an unclaimed invite has nothing to approve. But
   * an owner who minted an invite yesterday, closed the app, and now wants it
   * dead has nothing to point at without this: the code lived only in the
   * screen's memory. Revocation without a list is a feature only the owner who
   * never closed the app can use.
   */
  async listOutstandingInvites(
    householdId: string,
    actorUserId: string,
  ): Promise<
    Array<{
      inviteId: string;
      shortCode: string;
      status: string;
      role: string;
      expiresAt: string;
      inviteeEmail: string | null;
      createdByUserId: string;
      createdAt: string;
      claimedByUserId: string | null;
      claimedByEmail: string | null;
      claimedByDisplayName: string | null;
    }>
  > {
    await this.assertMember(householdId, actorUserId);
    const { results } = await this.env.DB.prepare(
      `SELECT i.id AS invite_id, i.short_code, i.status, i.role, i.expires_at,
              i.invitee_email, i.created_by_user_id, i.created_at, i.claimed_by_user_id,
              u.email AS claimed_by_email, u.display_name AS claimed_by_display_name
         FROM lf_invites i
         LEFT JOIN users u ON u.id = i.claimed_by_user_id
        WHERE i.household_id = ? AND i.status IN ('active', 'claimed')
        ORDER BY i.created_at DESC`,
    )
      .bind(householdId)
      .all<{
        invite_id: string;
        short_code: string;
        status: string;
        role: string;
        expires_at: string;
        invitee_email: string | null;
        created_by_user_id: string;
        created_at: string;
        claimed_by_user_id: string | null;
        claimed_by_email: string | null;
        claimed_by_display_name: string | null;
      }>();
    return (results ?? []).map((row) => ({
      inviteId: row.invite_id,
      shortCode: row.short_code,
      status: row.status,
      role: row.role,
      expiresAt: row.expires_at,
      inviteeEmail: row.invitee_email,
      createdByUserId: row.created_by_user_id,
      createdAt: row.created_at,
      claimedByUserId: row.claimed_by_user_id,
      claimedByEmail: row.claimed_by_email,
      claimedByDisplayName: row.claimed_by_display_name,
    }));
  }

  /**
   * Take an outstanding invite out of play.
   *
   * Only `active` and `claimed` rows move: an `approved` invite has already
   * enrolled a device, and undoing that is device revocation
   * (`revokeDevice`) — a different act with different consequences, which this
   * must not quietly perform. Returns the context so the caller can tell the
   * person who was waiting, who otherwise sits on "Waiting for approval…"
   * forever with no way to learn it will never come.
   */
  async revokeInvite(input: {
    householdId: string;
    inviteId: string;
    actorUserId: string;
  }): Promise<InviteNotificationContext> {
    await this.assertMember(input.householdId, input.actorUserId);
    const before = await this.getInviteNotificationContext(input.householdId, input.inviteId);
    if (!before) throw new Error('not_found');
    if (before.status === 'approved') throw new Error('invite_already_approved');
    if (before.status !== 'active' && before.status !== 'claimed') {
      // Already revoked or expired: nothing to do, and no second notification.
      return { ...before, actorUserId: input.actorUserId };
    }
    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `UPDATE lf_invites SET status = 'revoked', updated_at = ?
        WHERE id = ? AND household_id = ? AND status IN ('active', 'claimed')`,
    )
      .bind(now, input.inviteId, input.householdId)
      .run();
    return { ...before, status: 'revoked', actorUserId: input.actorUserId };
  }

  /**
   * Retire invites nobody acted on in time.
   *
   * `expires_at` was until now purely advisory on this tier — the claim path
   * rejects a stale invite, but the ROW stayed `active`/`claimed` forever, so a
   * device that claimed and was never approved kept showing "Waiting for
   * approval…" indefinitely and the owner's list kept offering a dead code.
   * Returns the rows that had a claimant, which are the only ones with somebody
   * to tell.
   */
  async sweepExpiredInvites(nowIso: string = new Date().toISOString()): Promise<
    InviteNotificationContext[]
  > {
    const { results } = await this.env.DB.prepare(
      `SELECT i.id, i.short_code, i.household_id, i.status, i.expires_at,
              i.created_by_user_id, i.claimed_by_user_id, h.display_name AS household_name
         FROM lf_invites i
         LEFT JOIN lf_households h ON h.id = i.household_id
        WHERE i.status IN ('active', 'claimed') AND i.expires_at <= ?
        LIMIT 200`,
    )
      .bind(nowIso)
      .all<{
        id: string;
        short_code: string;
        household_id: string;
        status: string;
        expires_at: string;
        created_by_user_id: string;
        claimed_by_user_id: string | null;
        household_name: string | null;
      }>();
    const rows = results ?? [];
    if (rows.length === 0) return [];
    await this.env.DB.batch(
      rows.map((row) =>
        this.env.DB.prepare(
          `UPDATE lf_invites SET status = 'expired', updated_at = ?
            WHERE id = ? AND status IN ('active', 'claimed')`,
        ).bind(nowIso, row.id),
      ),
    );
    return rows
      .filter((row) => row.claimed_by_user_id !== null)
      .map((row) => ({
        inviteId: row.id,
        shortCode: row.short_code,
        householdId: row.household_id,
        householdName: row.household_name ?? null,
        status: 'expired',
        expiresAt: row.expires_at,
        createdByUserId: row.created_by_user_id,
        claimedByUserId: row.claimed_by_user_id,
        claimedByName: null,
      }));
  }

  getCoordinatorStub(householdId: string) {
    return coordinatorStub(this.env, householdId);
  }

  /**
   * Public because the H6 blob routes authorise on membership alone and must
   * NOT go through `getState`: that adds a Durable Object round trip, and a
   * 100-chunk attachment upload would make 100 of them to learn something D1
   * already knows.
   */
  async assertMember(householdId: string, userId: string): Promise<void> {
    const row = await this.env.DB.prepare(
      `SELECT id FROM lf_memberships
       WHERE household_id = ? AND user_id = ? AND status = 'active'`,
    )
      .bind(householdId, userId)
      .first();
    if (!row) {
      throw new Error('not_a_member');
    }
  }

  /**
   * The He5 / He0 control: on a **personal-household brand** (Health), the only
   * `user_id` a household will ever accept is the one recorded in
   * `lf_households.owner_user_id` at mint time.
   *
   * No-op on House/Budget — their households are multi-member by design, and
   * this must never touch their enrolment. The brand comes from `APP_BRAND`
   * (per-Worker), never from a client header, so the caller cannot choose which
   * rule they are judged under.
   *
   * Called BEFORE any Durable Object round trip on every path that attaches a
   * device or a membership, so a rejected join leaves no half-written
   * coordinator state behind.
   *
   * Fails CLOSED on a missing `lf_households` row: on a personal brand the row
   * is written by `createHousehold` before any invite can exist, so its absence
   * means the household cannot be authorised rather than that anyone may join.
   */
  async assertPersonalHouseholdUser(householdId: string, userId: string): Promise<void> {
    if (!isPersonalHouseholdBrand(this.env)) return;
    const row = await this.env.DB.prepare(
      `SELECT owner_user_id FROM lf_households WHERE id = ?`,
    )
      .bind(householdId)
      .first<{ owner_user_id: string }>();
    if (!row || row.owner_user_id !== userId) {
      throw new PersonalHouseholdViolationError();
    }
  }

  /**
   * Same rule as `assertPersonalHouseholdUser`, applied to the party an invite
   * approval is about to admit rather than to the caller. Silent on
   * House/Budget, and silent on an unclaimed invite.
   */
  private async assertPersonalHouseholdApproval(
    householdId: string,
    inviteId: string,
  ): Promise<void> {
    if (!isPersonalHouseholdBrand(this.env)) return;
    const invite = await this.env.DB.prepare(
      `SELECT claimed_by_user_id FROM lf_invites WHERE id = ? AND household_id = ?`,
    )
      .bind(inviteId, householdId)
      .first<{ claimed_by_user_id: string | null }>();
    if (!invite?.claimed_by_user_id) return;
    await this.assertPersonalHouseholdUser(householdId, invite.claimed_by_user_id);
  }

  async assertOwner(householdId: string, userId: string): Promise<void> {
    const row = await this.env.DB.prepare(
      `SELECT id FROM lf_memberships
       WHERE household_id = ? AND user_id = ? AND status = 'active' AND role = 'OWNER'`,
    )
      .bind(householdId, userId)
      .first();
    if (!row) {
      throw new Error('not_owner');
    }
  }
}

// Re-export type for callers
export type { CoordinatorState } from '../durable-objects/household-coordinator';
