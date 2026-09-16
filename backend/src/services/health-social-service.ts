import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import { users } from '../db/schema';
import {
  habitLogs,
  healthEntries,
  nutritionEntries,
  userHabits,
  waterEntries,
  weightEntries,
} from '../db/schema-health';
import {
  healthBuddies,
  healthChallengeParticipants,
  healthChallengeProgress,
  healthChallenges,
  healthCommunityMessages,
  healthCommunityParticipants,
  healthCommunityTopics,
  healthFamilies,
  healthFamilyInvitations,
  healthFamilyMembers,
  healthMetricShares,
} from '../db/schema-health-social';

/**
 * Symply Health SOCIAL domain service — the ported donor `family` / `buddies` /
 * `communityChats` / `challenges` routes (parity P4).
 *
 * THIN CLIENT, same contract as HealthService / HealthFoodService: the routes
 * validate a shape and pass it here; every authorisation decision, every
 * cascade and every derived figure is computed in this file.
 *
 * ======================= THE FIVE PRIVACY RULES =========================
 * Health data is the most sensitive in the ecosystem. This service exists to
 * make five statements true, and each one is enforced in exactly one place:
 *
 *  1. NOTHING IS SHARED BY DEFAULT. Creating a family, accepting an invite and
 *     accepting a buddy all write a relationship row and NOTHING else. A
 *     relationship conveys zero read access. The only thing that ever makes a
 *     metric readable is a `health_metric_shares` row — see `grantScopes`.
 *     (The donor did the opposite: `family_dashboard_preferences` defaulted
 *     calories / macros / water / workouts to shared on join. Not ported.)
 *
 *  2. SCOPES ARE PER-METRIC-GROUP AND THE SENSITIVE DOMAINS ARE UNGRANTABLE.
 *     `SHAREABLE_SCOPES` is the entire universe of what a grant may name.
 *     `NEVER_SHAREABLE_SCOPES` (cycle, vitality, body photos, body
 *     measurements) is rejected by name with a distinct error code, and is not
 *     even representable in SQL — migration 0121 puts the same allowlist in a
 *     CHECK constraint. `assertScopeSetsAreDisjoint()` runs at module load so a
 *     future edit that adds a sensitive scope to the grantable list fails the
 *     deploy rather than silently shipping.
 *
 *  3. REVOCATION IS IMMEDIATE. `revokeGrant` stamps `revoked_at` in place; every
 *     read goes through `activeGrantsFor`, which filters on it. There is no
 *     cache, no materialised view and no denormalised copy of shared data
 *     anywhere — so the very next request after a revoke reads nothing.
 *
 *  4. LOSING THE RELATIONSHIP REVOKES THE GRANTS, BOTH DIRECTIONS. Leaving a
 *     family, being removed from one, and removing a buddy all call
 *     `revokeGrantsBetween`, which is symmetric by construction.
 *     `readSharedMetrics` additionally RE-VERIFIES the relationship live, so a
 *     grant row that somehow outlived its cascade still reads nothing.
 *
 *  5. AN INVITE NEVER LEAKS WHETHER AN EMAIL IS REGISTERED. `inviteToFamily`
 *     and `requestBuddy` resolve the address internally but their result is
 *     byte-identical either way, and neither ever runs an existence check that
 *     could change a status code. (The donor answered 404 "Recipient not found"
 *     and 400 "already a member of a family". Both are account oracles.)
 * ========================================================================
 *
 * Everything here is additionally behind the CONFIG_KV `health_social_enabled`
 * kill switch in `routes/health-social.ts`, which ships OFF.
 *
 * Other deliberate deviations from the donor:
 *  - No user directory search (`/family/invitations/search`, `/buddies/search`).
 *    Those enumerate accounts by email/name substring. Invites go to a typed
 *    address instead.
 *  - This surface returns OPAQUE USER IDS, never another user's email or
 *    display name. Name/avatar resolution belongs to the platform profile API,
 *    so the social tables never become a directory of who uses Symply Health.
 *    The one exception is the SENT invite list, which echoes the address the
 *    caller typed themselves.
 *  - Delete is SOFT everywhere (same reason as P1/P2: the sync cursor carries
 *    tombstones). Grants are never deleted at all, only revoked.
 */

/* ==================================================================== */
/* Scopes — rule 2                                                       */
/* ==================================================================== */

/**
 * The COMPLETE set of metric groups a share grant may name. Anything outside
 * this list is refused. Adding to it is a privacy decision, not a refactor.
 */
export const SHAREABLE_SCOPES = [
  'activity',
  'nutrition',
  'weight',
  'water',
  'habits',
  'sleep',
] as const;

export type ShareScope = (typeof SHAREABLE_SCOPES)[number];

/**
 * The sensitive domains. These are NOT "not implemented yet" — they are
 * permanently ungrantable through this surface, and a request naming one is
 * refused with `forbidden_scope` rather than the generic unknown-scope error so
 * the refusal is unmistakable in logs and in tests.
 *
 * cycle              → cycle_settings / period_entries / cycle_symptom_entries
 * vitality           → mens_health_entries / mens_health_settings
 * body_photos        → user_files(body_photo) / body_photo_insights /
 *                      body_comprehensive_insights
 * body_measurements  → body_measurements
 */
export const NEVER_SHAREABLE_SCOPES = [
  'cycle',
  'vitality',
  'body_photos',
  'body_measurements',
] as const;

export type NeverShareableScope = (typeof NEVER_SHAREABLE_SCOPES)[number];

/**
 * Module-load invariant: the two lists must never intersect. This can only fire
 * if someone edits the constants above, and when it does it must break the
 * deploy — a sensitive scope silently becoming grantable is the single worst
 * failure this file can have.
 */
export function assertScopeSetsAreDisjoint(): void {
  const forbidden = new Set<string>(NEVER_SHAREABLE_SCOPES);
  const overlap = SHAREABLE_SCOPES.filter((s) => forbidden.has(s));
  if (overlap.length > 0) {
    throw new Error(
      `health-social: sensitive scope(s) ${overlap.join(', ')} are marked shareable — refusing to load`
    );
  }
}

assertScopeSetsAreDisjoint();

export function isShareableScope(value: string): value is ShareScope {
  return (SHAREABLE_SCOPES as readonly string[]).includes(value);
}

/** True for cycle / vitality / body photos / body measurements. */
export function isPermanentlyExcludedScope(value: string): value is NeverShareableScope {
  return (NEVER_SHAREABLE_SCOPES as readonly string[]).includes(value);
}

export type RelationshipType = 'family' | 'buddy';

/* ==================================================================== */
/* Result envelope                                                       */
/* ==================================================================== */

export interface Failure {
  ok: false;
  code: string;
  message: string;
  /** Carried so the route stays a pass-through instead of re-deriving it. */
  status: 400 | 403 | 404 | 409;
}

export type Result<T> = ({ ok: true } & T) | Failure;

function fail(status: Failure['status'], code: string, message: string): Failure {
  return { ok: false, code, message, status };
}

/**
 * The only "does that exist?" answer this surface ever gives. Used for a row
 * owned by someone else, a relationship that is not the caller's, and an
 * invitation addressed to another email — a 403 would confirm the target
 * exists, which is exactly the oracle rules 1 and 5 forbid.
 */
function notFound(what: string): Failure {
  return fail(404, 'not_found', `${what} not found`);
}

/* ==================================================================== */
/* Small helpers                                                         */
/* ==================================================================== */

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 8 chars, no I/O/0/1 — read aloud and typed by hand from a deep link. */
export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = '';
  for (const b of bytes) out += INVITE_CODE_ALPHABET[b % INVITE_CODE_ALPHABET.length];
  return out;
}

/** Donor default: an invite is good for 14 days. */
export const INVITE_TTL_DAYS = 14;

export function inviteExpiryFrom(iso: string, days = INVITE_TTL_DAYS): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ==================================================================== */
/* Public row shapes — what leaves the Worker                            */
/* ==================================================================== */

export interface PublicInvitation {
  id: string;
  family_id: string;
  /** The address the INVITER typed. Never used to confirm registration. */
  invitee_email: string;
  status: string;
  message: string | null;
  invite_code: string;
  expires_at: string;
  created_at: string;
}

export interface ReceivedInvitation {
  id: string;
  family_id: string;
  family_name: string;
  inviter_id: string;
  message: string | null;
  expires_at: string;
  created_at: string;
}

export interface BuddyRow {
  id: string;
  buddy_user_id: string;
  since: string;
}

export interface MetricSnapshot {
  activity?: { steps: number; workout_minutes: number; workout_count: number };
  nutrition?: { calories: number; proteins: number; carbohydrates: number; fats: number };
  weight?: { value: number; unit: string; date: string } | null;
  water?: { total_ml: number };
  habits?: { completed: number; total: number };
  sleep?: { hours: number };
}

export class HealthSocialService {
  private db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  /* ---------------------------------------------------------------- */
  /* Identity                                                          */
  /* ---------------------------------------------------------------- */

  /** The caller's own address — needed to match invites addressed to them. */
  private async emailOf(userId: string): Promise<string | null> {
    const row = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    return row ? normaliseEmail(row.email) : null;
  }

  /**
   * Resolve an address to an account id — INTERNAL ONLY. The return value must
   * never reach a response body or change a status code (rule 5).
   */
  private async userIdForEmail(email: string): Promise<string | null> {
    const row = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deleted_at)))
      .get();
    return row?.id ?? null;
  }

  /* ================================================================== */
  /* FAMILY                                                             */
  /* ================================================================== */

  private async activeMembership(userId: string) {
    return this.db
      .select()
      .from(healthFamilyMembers)
      .where(
        and(eq(healthFamilyMembers.user_id, userId), isNull(healthFamilyMembers.deleted_at))
      )
      .get();
  }

  private async activeMembers(familyId: string) {
    return this.db
      .select()
      .from(healthFamilyMembers)
      .where(
        and(
          eq(healthFamilyMembers.family_id, familyId),
          isNull(healthFamilyMembers.deleted_at)
        )
      )
      .orderBy(healthFamilyMembers.joined_at)
      .all();
  }

  /**
   * The caller's family, or null. Members are OPAQUE IDS + role + joined_at —
   * no email, no display name (see the header).
   */
  async getFamily(userId: string) {
    const membership = await this.activeMembership(userId);
    if (!membership) return null;
    const family = await this.db
      .select()
      .from(healthFamilies)
      .where(and(eq(healthFamilies.id, membership.family_id), isNull(healthFamilies.deleted_at)))
      .get();
    if (!family) return null;
    const members = await this.activeMembers(family.id);
    return {
      family: { id: family.id, name: family.name, owner_id: family.owner_id },
      role: membership.role,
      members: members.map((m) => ({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
      })),
    };
  }

  /** Creates a family and NOTHING else — no grants, by rule 1. */
  async createFamily(userId: string, name: string): Promise<Result<{ family: unknown }>> {
    if (await this.activeMembership(userId)) {
      return fail(409, 'already_in_family', 'You already belong to a family');
    }
    const ts = nowIso();
    const familyId = newId('hfam');
    await this.db
      .insert(healthFamilies)
      .values({
        id: familyId,
        name: name.trim(),
        owner_id: userId,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      .run();
    await this.db
      .insert(healthFamilyMembers)
      .values({
        id: newId('hfm'),
        family_id: familyId,
        user_id: userId,
        role: 'owner',
        joined_at: ts,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      .run();
    const created = await this.getFamily(userId);
    return { ok: true, family: created };
  }

  /**
   * Rule 5. The response is IDENTICAL whether `email` belongs to an account, to
   * an account already in another family, or to nobody at all.
   *
   * Two donor checks are deliberately NOT ported because each is an account
   * oracle: "Recipient not found" (404) and "This user is already a member of a
   * family" (400). Both conditions are instead detected at ACCEPT time, where
   * the person answering is the account holder themselves.
   */
  async inviteToFamily(
    userId: string,
    rawEmail: string,
    message?: string
  ): Promise<Result<{ invitation: PublicInvitation }>> {
    const membership = await this.activeMembership(userId);
    if (!membership) {
      return fail(400, 'not_in_family', 'You must belong to a family to invite others');
    }
    const email = normaliseEmail(rawEmail);
    const own = await this.emailOf(userId);
    // Safe to answer precisely: the caller already knows their own address.
    if (own && email === own) {
      return fail(400, 'invalid_email', 'You cannot invite yourself');
    }

    const ts = nowIso();
    // Re-sending to the same address refreshes the SAME invite instead of
    // colliding on the unique code index — an error there would be a timing /
    // status oracle for "this address was already invited by someone".
    const existing = await this.db
      .select()
      .from(healthFamilyInvitations)
      .where(
        and(
          eq(healthFamilyInvitations.family_id, membership.family_id),
          eq(healthFamilyInvitations.invitee_email, email),
          eq(healthFamilyInvitations.status, 'pending'),
          isNull(healthFamilyInvitations.deleted_at)
        )
      )
      .get();

    // Resolved for the recipient's inbox query only; never serialised back.
    const inviteeId = await this.userIdForEmail(email);

    if (existing) {
      const expires = inviteExpiryFrom(ts);
      await this.db
        .update(healthFamilyInvitations)
        .set({
          message: message ?? existing.message,
          invitee_id: inviteeId,
          expires_at: expires,
          updated_at: ts,
        })
        .where(eq(healthFamilyInvitations.id, existing.id))
        .run();
      return {
        ok: true,
        invitation: {
          id: existing.id,
          family_id: existing.family_id,
          invitee_email: email,
          status: 'pending',
          message: message ?? existing.message,
          invite_code: existing.invite_code,
          expires_at: expires,
          created_at: existing.created_at,
        },
      };
    }

    const code = await this.uniqueInviteCode();
    const row = {
      id: newId('hfi'),
      family_id: membership.family_id,
      inviter_id: userId,
      invitee_id: inviteeId,
      invitee_email: email,
      status: 'pending',
      message: message ?? null,
      invite_code: code,
      responded_at: null,
      expires_at: inviteExpiryFrom(ts),
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(healthFamilyInvitations).values(row).run();
    return {
      ok: true,
      invitation: {
        id: row.id,
        family_id: row.family_id,
        invitee_email: row.invitee_email,
        status: row.status,
        message: row.message,
        invite_code: row.invite_code,
        expires_at: row.expires_at,
        created_at: row.created_at,
      },
    };
  }

  private async uniqueInviteCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateInviteCode();
      const clash = await this.db
        .select({ id: healthFamilyInvitations.id })
        .from(healthFamilyInvitations)
        .where(eq(healthFamilyInvitations.invite_code, code))
        .get();
      if (!clash) return code;
    }
    // 32^8 keyspace — five collisions in a row means something is very wrong.
    return `${generateInviteCode()}${generateInviteCode()}`;
  }

  /** Pending invites addressed to the caller's own address. */
  async listReceivedInvitations(userId: string): Promise<ReceivedInvitation[]> {
    const email = await this.emailOf(userId);
    if (!email) return [];
    const rows = await this.db
      .select({
        id: healthFamilyInvitations.id,
        family_id: healthFamilyInvitations.family_id,
        inviter_id: healthFamilyInvitations.inviter_id,
        message: healthFamilyInvitations.message,
        expires_at: healthFamilyInvitations.expires_at,
        created_at: healthFamilyInvitations.created_at,
        family_name: healthFamilies.name,
      })
      .from(healthFamilyInvitations)
      .innerJoin(healthFamilies, eq(healthFamilies.id, healthFamilyInvitations.family_id))
      .where(
        and(
          eq(healthFamilyInvitations.invitee_email, email),
          eq(healthFamilyInvitations.status, 'pending'),
          gte(healthFamilyInvitations.expires_at, nowIso()),
          isNull(healthFamilyInvitations.deleted_at),
          isNull(healthFamilies.deleted_at)
        )
      )
      .orderBy(desc(healthFamilyInvitations.created_at))
      .all();
    return rows;
  }

  /** Invites the caller sent — echoes back only the address they typed. */
  async listSentInvitations(userId: string): Promise<PublicInvitation[]> {
    const rows = await this.db
      .select()
      .from(healthFamilyInvitations)
      .where(
        and(
          eq(healthFamilyInvitations.inviter_id, userId),
          isNull(healthFamilyInvitations.deleted_at)
        )
      )
      .orderBy(desc(healthFamilyInvitations.created_at))
      .all();
    return rows.map((r) => ({
      id: r.id,
      family_id: r.family_id,
      invitee_email: r.invitee_email,
      status: r.status,
      message: r.message,
      invite_code: r.invite_code,
      expires_at: r.expires_at,
      created_at: r.created_at,
    }));
  }

  /**
   * Deep-link resolution. Only the ADDRESSEE may turn a code into an invitation
   * — otherwise a guessed 8-char code would reveal a family's name.
   */
  async resolveInviteCode(userId: string, code: string): Promise<Result<{ invitation: ReceivedInvitation }>> {
    const email = await this.emailOf(userId);
    if (!email) return notFound('Invitation');
    const row = await this.db
      .select({
        id: healthFamilyInvitations.id,
        family_id: healthFamilyInvitations.family_id,
        inviter_id: healthFamilyInvitations.inviter_id,
        invitee_email: healthFamilyInvitations.invitee_email,
        message: healthFamilyInvitations.message,
        status: healthFamilyInvitations.status,
        expires_at: healthFamilyInvitations.expires_at,
        created_at: healthFamilyInvitations.created_at,
        family_name: healthFamilies.name,
      })
      .from(healthFamilyInvitations)
      .innerJoin(healthFamilies, eq(healthFamilies.id, healthFamilyInvitations.family_id))
      .where(
        and(
          eq(healthFamilyInvitations.invite_code, code),
          isNull(healthFamilyInvitations.deleted_at)
        )
      )
      .get();
    if (!row || row.invitee_email !== email || row.status !== 'pending') {
      return notFound('Invitation');
    }
    return {
      ok: true,
      invitation: {
        id: row.id,
        family_id: row.family_id,
        family_name: row.family_name,
        inviter_id: row.inviter_id,
        message: row.message,
        expires_at: row.expires_at,
        created_at: row.created_at,
      },
    };
  }

  private async pendingInvitationFor(userId: string, invitationId: string) {
    const email = await this.emailOf(userId);
    if (!email) return null;
    const row = await this.db
      .select()
      .from(healthFamilyInvitations)
      .where(
        and(
          eq(healthFamilyInvitations.id, invitationId),
          isNull(healthFamilyInvitations.deleted_at)
        )
      )
      .get();
    // Addressed to somebody else, already answered, or gone: all 404.
    if (!row || row.invitee_email !== email || row.status !== 'pending') return null;
    return row;
  }

  /**
   * Joining a family conveys NO read access (rule 1) — it writes a membership
   * row and nothing else. The new member must still be named in an explicit
   * `/social/shares` grant before they can read a single metric.
   */
  async acceptInvitation(
    userId: string,
    invitationId: string
  ): Promise<Result<{ family: unknown }>> {
    const invite = await this.pendingInvitationFor(userId, invitationId);
    if (!invite) return notFound('Invitation');
    const ts = nowIso();
    if (invite.expires_at < ts) {
      await this.db
        .update(healthFamilyInvitations)
        .set({ status: 'expired', updated_at: ts })
        .where(eq(healthFamilyInvitations.id, invite.id))
        .run();
      return fail(400, 'invitation_expired', 'This invitation has expired');
    }
    if (await this.activeMembership(userId)) {
      return fail(409, 'already_in_family', 'You already belong to a family');
    }
    const family = await this.db
      .select()
      .from(healthFamilies)
      .where(and(eq(healthFamilies.id, invite.family_id), isNull(healthFamilies.deleted_at)))
      .get();
    if (!family) return notFound('Family');

    await this.db
      .insert(healthFamilyMembers)
      .values({
        id: newId('hfm'),
        family_id: invite.family_id,
        user_id: userId,
        role: 'member',
        joined_at: ts,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      .run();
    await this.db
      .update(healthFamilyInvitations)
      .set({ status: 'accepted', invitee_id: userId, responded_at: ts, updated_at: ts })
      .where(eq(healthFamilyInvitations.id, invite.id))
      .run();
    return { ok: true, family: await this.getFamily(userId) };
  }

  async declineInvitation(userId: string, invitationId: string): Promise<Result<object>> {
    const invite = await this.pendingInvitationFor(userId, invitationId);
    if (!invite) return notFound('Invitation');
    const ts = nowIso();
    await this.db
      .update(healthFamilyInvitations)
      .set({ status: 'declined', invitee_id: userId, responded_at: ts, updated_at: ts })
      .where(eq(healthFamilyInvitations.id, invite.id))
      .run();
    return { ok: true };
  }

  /**
   * Rule 4. Leaving revokes every FAMILY grant between the leaver and every
   * remaining member, in BOTH directions.
   *
   * Ownership transfers to the earliest remaining member (the donor instead
   * refused, stranding a family whose owner deleted the app). With nobody left
   * the family itself is soft-deleted.
   */
  async leaveFamily(userId: string): Promise<Result<{ revoked: number }>> {
    const membership = await this.activeMembership(userId);
    if (!membership) return fail(400, 'not_in_family', 'You do not belong to a family');
    const ts = nowIso();
    const others = (await this.activeMembers(membership.family_id)).filter(
      (m) => m.user_id !== userId
    );

    await this.db
      .update(healthFamilyMembers)
      .set({ deleted_at: ts, updated_at: ts })
      .where(eq(healthFamilyMembers.id, membership.id))
      .run();

    const revoked = await this.revokeGrantsBetweenMany(
      userId,
      others.map((m) => m.user_id),
      'family',
      ts
    );

    if (others.length === 0) {
      await this.db
        .update(healthFamilies)
        .set({ deleted_at: ts, updated_at: ts })
        .where(eq(healthFamilies.id, membership.family_id))
        .run();
    } else if (membership.role === 'owner') {
      const heir = others[0];
      await this.db
        .update(healthFamilies)
        .set({ owner_id: heir.user_id, updated_at: ts })
        .where(eq(healthFamilies.id, membership.family_id))
        .run();
      await this.db
        .update(healthFamilyMembers)
        .set({ role: 'owner', updated_at: ts })
        .where(eq(healthFamilyMembers.id, heir.id))
        .run();
    }
    return { ok: true, revoked };
  }

  /** Owner-only. Same symmetric revocation as `leaveFamily` (rule 4). */
  async removeMember(
    ownerId: string,
    memberUserId: string
  ): Promise<Result<{ revoked: number }>> {
    const membership = await this.activeMembership(ownerId);
    if (!membership || membership.role !== 'owner') {
      return notFound('Member');
    }
    if (memberUserId === ownerId) {
      return fail(400, 'cannot_remove_self', 'Use leave to exit your own family');
    }
    const members = await this.activeMembers(membership.family_id);
    const target = members.find((m) => m.user_id === memberUserId);
    if (!target) return notFound('Member');

    const ts = nowIso();
    await this.db
      .update(healthFamilyMembers)
      .set({ deleted_at: ts, updated_at: ts })
      .where(eq(healthFamilyMembers.id, target.id))
      .run();
    const revoked = await this.revokeGrantsBetweenMany(
      memberUserId,
      members.filter((m) => m.user_id !== memberUserId).map((m) => m.user_id),
      'family',
      ts
    );
    return { ok: true, revoked };
  }

  /* ================================================================== */
  /* BUDDIES                                                            */
  /* ================================================================== */

  /**
   * Rule 5 again — addressed to an EMAIL, and the response never varies with
   * whether that address is registered. The donor's `recipient_id` + 404
   * "Recipient not found" is an account-existence oracle and is not ported.
   */
  async requestBuddy(
    userId: string,
    rawEmail: string,
    message?: string
  ): Promise<Result<{ request: { id: string; recipient_email: string; status: string; created_at: string } }>> {
    const email = normaliseEmail(rawEmail);
    const own = await this.emailOf(userId);
    if (own && email === own) {
      return fail(400, 'invalid_email', 'You cannot add yourself as a buddy');
    }
    const ts = nowIso();
    const existing = await this.db
      .select()
      .from(healthBuddies)
      .where(
        and(
          eq(healthBuddies.requester_id, userId),
          eq(healthBuddies.recipient_email, email),
          isNull(healthBuddies.deleted_at)
        )
      )
      .get();
    if (existing) {
      // Idempotent: re-asking refreshes the same row rather than 409-ing, so a
      // repeated request cannot be used to probe state either.
      await this.db
        .update(healthBuddies)
        .set({
          status: existing.status === 'declined' ? 'pending' : existing.status,
          message: message ?? existing.message,
          recipient_id: existing.recipient_id ?? (await this.userIdForEmail(email)),
          updated_at: ts,
        })
        .where(eq(healthBuddies.id, existing.id))
        .run();
      return {
        ok: true,
        request: {
          id: existing.id,
          recipient_email: email,
          status: existing.status === 'declined' ? 'pending' : existing.status,
          created_at: existing.created_at,
        },
      };
    }
    const row = {
      id: newId('hbud'),
      requester_id: userId,
      recipient_email: email,
      recipient_id: await this.userIdForEmail(email),
      status: 'pending',
      message: message ?? null,
      responded_at: null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(healthBuddies).values(row).run();
    return {
      ok: true,
      request: {
        id: row.id,
        recipient_email: row.recipient_email,
        status: row.status,
        created_at: row.created_at,
      },
    };
  }

  /** Accepted connections, from either side. Opaque ids only. */
  async listBuddies(userId: string): Promise<BuddyRow[]> {
    const rows = await this.db
      .select()
      .from(healthBuddies)
      .where(
        and(
          eq(healthBuddies.status, 'accepted'),
          isNull(healthBuddies.deleted_at),
          or(eq(healthBuddies.requester_id, userId), eq(healthBuddies.recipient_id, userId))
        )
      )
      .all();
    const seen = new Set<string>();
    const out: BuddyRow[] = [];
    for (const r of rows) {
      const other = r.requester_id === userId ? r.recipient_id : r.requester_id;
      if (!other || seen.has(other)) continue;
      seen.add(other);
      out.push({ id: r.id, buddy_user_id: other, since: r.responded_at ?? r.updated_at });
    }
    return out;
  }

  async listBuddyRequests(userId: string) {
    const email = await this.emailOf(userId);
    const received = email
      ? await this.db
          .select({
            id: healthBuddies.id,
            requester_id: healthBuddies.requester_id,
            message: healthBuddies.message,
            created_at: healthBuddies.created_at,
          })
          .from(healthBuddies)
          .where(
            and(
              eq(healthBuddies.recipient_email, email),
              eq(healthBuddies.status, 'pending'),
              isNull(healthBuddies.deleted_at)
            )
          )
          .orderBy(desc(healthBuddies.created_at))
          .all()
      : [];
    const sent = await this.db
      .select({
        id: healthBuddies.id,
        // The address the caller typed themselves — no leak.
        recipient_email: healthBuddies.recipient_email,
        status: healthBuddies.status,
        created_at: healthBuddies.created_at,
      })
      .from(healthBuddies)
      .where(
        and(
          eq(healthBuddies.requester_id, userId),
          eq(healthBuddies.status, 'pending'),
          isNull(healthBuddies.deleted_at)
        )
      )
      .orderBy(desc(healthBuddies.created_at))
      .all();
    return { received, sent };
  }

  private async pendingBuddyFor(userId: string, id: string) {
    const email = await this.emailOf(userId);
    if (!email) return null;
    const row = await this.db
      .select()
      .from(healthBuddies)
      .where(and(eq(healthBuddies.id, id), isNull(healthBuddies.deleted_at)))
      .get();
    if (!row || row.recipient_email !== email || row.status !== 'pending') return null;
    return row;
  }

  /** Accepting conveys NO read access (rule 1). */
  async acceptBuddy(userId: string, id: string): Promise<Result<{ buddy: BuddyRow }>> {
    const row = await this.pendingBuddyFor(userId, id);
    if (!row) return notFound('Buddy request');
    const ts = nowIso();
    await this.db
      .update(healthBuddies)
      .set({ status: 'accepted', recipient_id: userId, responded_at: ts, updated_at: ts })
      .where(eq(healthBuddies.id, row.id))
      .run();
    return { ok: true, buddy: { id: row.id, buddy_user_id: row.requester_id, since: ts } };
  }

  async declineBuddy(userId: string, id: string): Promise<Result<object>> {
    const row = await this.pendingBuddyFor(userId, id);
    if (!row) return notFound('Buddy request');
    const ts = nowIso();
    await this.db
      .update(healthBuddies)
      .set({ status: 'declined', recipient_id: userId, responded_at: ts, updated_at: ts })
      .where(eq(healthBuddies.id, row.id))
      .run();
    return { ok: true };
  }

  /** Rule 4: removing a buddy revokes every BUDDY grant both ways. */
  async removeBuddy(userId: string, id: string): Promise<Result<{ revoked: number }>> {
    const row = await this.db
      .select()
      .from(healthBuddies)
      .where(and(eq(healthBuddies.id, id), isNull(healthBuddies.deleted_at)))
      .get();
    if (!row || (row.requester_id !== userId && row.recipient_id !== userId)) {
      return notFound('Buddy');
    }
    const other = row.requester_id === userId ? row.recipient_id : row.requester_id;
    const ts = nowIso();
    await this.db
      .update(healthBuddies)
      .set({ deleted_at: ts, updated_at: ts })
      .where(eq(healthBuddies.id, row.id))
      .run();
    const revoked = other
      ? await this.revokeGrantsBetweenMany(userId, [other], 'buddy', ts)
      : 0;
    return { ok: true, revoked };
  }

  /** True when an ACCEPTED, non-deleted connection exists — either direction. */
  private async buddyLinkBetween(a: string, b: string) {
    return this.db
      .select()
      .from(healthBuddies)
      .where(
        and(
          eq(healthBuddies.status, 'accepted'),
          isNull(healthBuddies.deleted_at),
          or(
            and(eq(healthBuddies.requester_id, a), eq(healthBuddies.recipient_id, b)),
            and(eq(healthBuddies.requester_id, b), eq(healthBuddies.recipient_id, a))
          )
        )
      )
      .get();
  }

  /** The family both users are ACTIVE members of right now, or null. */
  private async sharedFamilyId(a: string, b: string): Promise<string | null> {
    const [ma, mb] = await Promise.all([this.activeMembership(a), this.activeMembership(b)]);
    if (!ma || !mb || ma.family_id !== mb.family_id) return null;
    return ma.family_id;
  }

  /* ================================================================== */
  /* COMMUNITY                                                          */
  /* ================================================================== */

  /**
   * Discovery only: title, description, category, counts. A room's MESSAGES
   * require joining, so browsing the directory never exposes what people wrote.
   */
  async listTopics(userId: string, opts: { category?: string; limit?: number } = {}) {
    const conds = [isNull(healthCommunityTopics.deleted_at)];
    if (opts.category) conds.push(eq(healthCommunityTopics.category, opts.category));
    const topics = await this.db
      .select()
      .from(healthCommunityTopics)
      .where(and(...conds))
      .orderBy(desc(healthCommunityTopics.last_message_at), desc(healthCommunityTopics.created_at))
      .limit(Math.min(opts.limit ?? 50, 100))
      .all();
    const mine = await this.db
      .select({ topic_id: healthCommunityParticipants.topic_id })
      .from(healthCommunityParticipants)
      .where(
        and(
          eq(healthCommunityParticipants.user_id, userId),
          isNull(healthCommunityParticipants.deleted_at)
        )
      )
      .all();
    const joined = new Set(mine.map((m) => m.topic_id));
    return topics.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      category: t.category,
      icon: t.icon,
      color: t.color,
      is_locked: t.is_locked,
      message_count: t.message_count,
      participant_count: t.participant_count,
      last_message_at: t.last_message_at,
      created_at: t.created_at,
      joined: joined.has(t.id),
    }));
  }

  async createTopic(
    userId: string,
    input: {
      title: string;
      description?: string | null;
      category: string;
      icon?: string | null;
      color?: string | null;
    }
  ) {
    const ts = nowIso();
    const topicId = newId('htop');
    await this.db
      .insert(healthCommunityTopics)
      .values({
        id: topicId,
        title: input.title.trim(),
        description: input.description ?? null,
        category: input.category,
        icon: input.icon ?? null,
        color: input.color ?? null,
        creator_id: userId,
        is_locked: false,
        message_count: 0,
        participant_count: 1,
        last_message_at: null,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      .run();
    await this.db
      .insert(healthCommunityParticipants)
      .values({
        id: newId('htp'),
        topic_id: topicId,
        user_id: userId,
        role: 'creator',
        last_read_at: ts,
        joined_at: ts,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      .run();
    return {
      id: topicId,
      title: input.title.trim(),
      description: input.description ?? null,
      category: input.category,
      icon: input.icon ?? null,
      color: input.color ?? null,
      is_locked: false,
      message_count: 0,
      participant_count: 1,
      last_message_at: null,
      created_at: ts,
      joined: true,
    };
  }

  private async activeTopic(topicId: string) {
    return this.db
      .select()
      .from(healthCommunityTopics)
      .where(and(eq(healthCommunityTopics.id, topicId), isNull(healthCommunityTopics.deleted_at)))
      .get();
  }

  private async participation(userId: string, topicId: string) {
    return this.db
      .select()
      .from(healthCommunityParticipants)
      .where(
        and(
          eq(healthCommunityParticipants.topic_id, topicId),
          eq(healthCommunityParticipants.user_id, userId),
          isNull(healthCommunityParticipants.deleted_at)
        )
      )
      .get();
  }

  async joinTopic(userId: string, topicId: string): Promise<Result<{ joined: boolean }>> {
    const topic = await this.activeTopic(topicId);
    if (!topic) return notFound('Topic');
    if (await this.participation(userId, topicId)) return { ok: true, joined: true };
    const ts = nowIso();
    await this.db
      .insert(healthCommunityParticipants)
      .values({
        id: newId('htp'),
        topic_id: topicId,
        user_id: userId,
        role: 'member',
        last_read_at: ts,
        joined_at: ts,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      .run();
    await this.db
      .update(healthCommunityTopics)
      .set({ participant_count: topic.participant_count + 1, updated_at: ts })
      .where(eq(healthCommunityTopics.id, topicId))
      .run();
    return { ok: true, joined: true };
  }

  async leaveTopic(userId: string, topicId: string): Promise<Result<{ left: boolean }>> {
    const topic = await this.activeTopic(topicId);
    if (!topic) return notFound('Topic');
    const seat = await this.participation(userId, topicId);
    if (!seat) return notFound('Topic membership');
    const ts = nowIso();
    await this.db
      .update(healthCommunityParticipants)
      .set({ deleted_at: ts, updated_at: ts })
      .where(eq(healthCommunityParticipants.id, seat.id))
      .run();
    await this.db
      .update(healthCommunityTopics)
      .set({ participant_count: Math.max(0, topic.participant_count - 1), updated_at: ts })
      .where(eq(healthCommunityTopics.id, topicId))
      .run();
    return { ok: true, left: true };
  }

  /** Participation is required to READ, not just to write (see `listTopics`). */
  async listMessages(
    userId: string,
    topicId: string,
    opts: { limit?: number } = {}
  ): Promise<Result<{ messages: unknown[] }>> {
    const topic = await this.activeTopic(topicId);
    if (!topic) return notFound('Topic');
    if (!(await this.participation(userId, topicId))) {
      return fail(403, 'not_a_participant', 'Join this room to read it');
    }
    const rows = await this.db
      .select()
      .from(healthCommunityMessages)
      .where(
        and(
          eq(healthCommunityMessages.topic_id, topicId),
          isNull(healthCommunityMessages.deleted_at)
        )
      )
      .orderBy(desc(healthCommunityMessages.created_at))
      .limit(Math.min(opts.limit ?? 50, 200))
      .all();
    return {
      ok: true,
      messages: rows.map((m) => ({
        id: m.id,
        topic_id: m.topic_id,
        // Opaque id: a public room must not expose addresses or names.
        user_id: m.user_id,
        content: m.content,
        reply_to_id: m.reply_to_id,
        is_edited: m.is_edited,
        created_at: m.created_at,
      })),
    };
  }

  /**
   * TEXT ONLY. There is no attachment parameter by design — the donor's
   * `recipe_share` / `workout_share` / `achievement` message types would have
   * carried health payloads into a PUBLIC room, around the grant table.
   */
  async postMessage(
    userId: string,
    topicId: string,
    content: string,
    replyToId?: string
  ): Promise<Result<{ message: unknown }>> {
    const topic = await this.activeTopic(topicId);
    if (!topic) return notFound('Topic');
    if (!(await this.participation(userId, topicId))) {
      return fail(403, 'not_a_participant', 'Join this room to post in it');
    }
    if (topic.is_locked) return fail(403, 'topic_locked', 'This room is locked');
    if (replyToId) {
      const parent = await this.db
        .select({ id: healthCommunityMessages.id })
        .from(healthCommunityMessages)
        .where(
          and(
            eq(healthCommunityMessages.id, replyToId),
            eq(healthCommunityMessages.topic_id, topicId),
            isNull(healthCommunityMessages.deleted_at)
          )
        )
        .get();
      if (!parent) return notFound('Message');
    }
    const ts = nowIso();
    const row = {
      id: newId('hmsg'),
      topic_id: topicId,
      user_id: userId,
      content: content.trim(),
      reply_to_id: replyToId ?? null,
      is_edited: false,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(healthCommunityMessages).values(row).run();
    await this.db
      .update(healthCommunityTopics)
      .set({
        message_count: topic.message_count + 1,
        last_message_at: ts,
        updated_at: ts,
      })
      .where(eq(healthCommunityTopics.id, topicId))
      .run();
    return { ok: true, message: row };
  }

  /** Own message only; soft delete so the room's cursor keeps a tombstone. */
  async deleteMessage(userId: string, messageId: string): Promise<Result<object>> {
    const row = await this.db
      .select()
      .from(healthCommunityMessages)
      .where(
        and(
          eq(healthCommunityMessages.id, messageId),
          eq(healthCommunityMessages.user_id, userId),
          isNull(healthCommunityMessages.deleted_at)
        )
      )
      .get();
    if (!row) return notFound('Message');
    const ts = nowIso();
    await this.db
      .update(healthCommunityMessages)
      .set({ deleted_at: ts, updated_at: ts })
      .where(eq(healthCommunityMessages.id, row.id))
      .run();
    await this.db
      .update(healthCommunityTopics)
      .set({ message_count: sql`max(0, ${healthCommunityTopics.message_count} - 1)`, updated_at: ts })
      .where(eq(healthCommunityTopics.id, row.topic_id))
      .run();
    return { ok: true };
  }

  /* ================================================================== */
  /* CHALLENGES                                                         */
  /* ================================================================== */

  /** Who may see a challenge at all: its creator, its participants, + visibility. */
  private async canSeeChallenge(
    userId: string,
    challenge: { id: string; creator_id: string; visibility: string }
  ): Promise<boolean> {
    if (challenge.creator_id === userId) return true;
    if (await this.challengeSeat(userId, challenge.id)) return true;
    if (challenge.visibility === 'public') return true;
    if (challenge.visibility === 'family') {
      return (await this.sharedFamilyId(userId, challenge.creator_id)) !== null;
    }
    return Boolean(await this.buddyLinkBetween(userId, challenge.creator_id));
  }

  private async challengeSeat(userId: string, challengeId: string) {
    return this.db
      .select()
      .from(healthChallengeParticipants)
      .where(
        and(
          eq(healthChallengeParticipants.challenge_id, challengeId),
          eq(healthChallengeParticipants.user_id, userId),
          isNull(healthChallengeParticipants.deleted_at)
        )
      )
      .get();
  }

  /** Every challenge the caller may see, each tagged with whether they joined. */
  async listChallenges(userId: string, opts: { limit?: number } = {}) {
    const rows = await this.db
      .select()
      .from(healthChallenges)
      .where(and(isNull(healthChallenges.deleted_at), eq(healthChallenges.is_active, true)))
      .orderBy(desc(healthChallenges.created_at))
      .limit(Math.min(opts.limit ?? 50, 100))
      .all();
    const seats = await this.db
      .select({ challenge_id: healthChallengeParticipants.challenge_id })
      .from(healthChallengeParticipants)
      .where(
        and(
          eq(healthChallengeParticipants.user_id, userId),
          isNull(healthChallengeParticipants.deleted_at)
        )
      )
      .all();
    const joined = new Set(seats.map((s) => s.challenge_id));
    const visible = [];
    for (const c of rows) {
      if (!(await this.canSeeChallenge(userId, c))) continue;
      visible.push({
        id: c.id,
        creator_id: c.creator_id,
        name: c.name,
        description: c.description,
        metric: c.metric,
        target_value: c.target_value,
        unit: c.unit,
        frequency: c.frequency,
        visibility: c.visibility,
        start_date: c.start_date,
        end_date: c.end_date,
        participant_count: c.participant_count,
        joined: joined.has(c.id),
      });
    }
    return visible;
  }

  /**
   * `metric` must be a GRANTABLE scope. A challenge built on cycle or vitality
   * data could not be shown to anyone anyway (no grant can name those), and
   * allowing it would create a second, weaker path to the same figures.
   */
  async createChallenge(
    userId: string,
    input: {
      name: string;
      description?: string | null;
      metric: string;
      target_value: number;
      unit?: string;
      frequency?: 'daily' | 'weekly';
      visibility?: 'public' | 'family' | 'buddies';
      start_date: string;
      end_date?: string | null;
    }
  ): Promise<Result<{ challenge: unknown }>> {
    const scopeCheck = validateScopes([input.metric]);
    if (!scopeCheck.ok) return scopeCheck;
    const ts = nowIso();
    const id = newId('hchl');
    const row = {
      id,
      creator_id: userId,
      name: input.name.trim(),
      description: input.description ?? null,
      metric: input.metric,
      target_value: input.target_value,
      unit: input.unit ?? 'unit',
      frequency: input.frequency ?? 'daily',
      visibility: input.visibility ?? 'family',
      start_date: input.start_date,
      end_date: input.end_date ?? null,
      is_active: true,
      participant_count: 1,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(healthChallenges).values(row).run();
    await this.db
      .insert(healthChallengeParticipants)
      .values({
        id: newId('hcp'),
        challenge_id: id,
        user_id: userId,
        joined_at: ts,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      .run();
    return { ok: true, challenge: { ...row, joined: true } };
  }

  async joinChallenge(userId: string, challengeId: string): Promise<Result<{ joined: boolean }>> {
    const challenge = await this.db
      .select()
      .from(healthChallenges)
      .where(and(eq(healthChallenges.id, challengeId), isNull(healthChallenges.deleted_at)))
      .get();
    // 404 rather than 403: a challenge the caller may not see must not be
    // distinguishable from one that does not exist.
    if (!challenge || !(await this.canSeeChallenge(userId, challenge))) {
      return notFound('Challenge');
    }
    if (await this.challengeSeat(userId, challengeId)) return { ok: true, joined: true };
    const ts = nowIso();
    await this.db
      .insert(healthChallengeParticipants)
      .values({
        id: newId('hcp'),
        challenge_id: challengeId,
        user_id: userId,
        joined_at: ts,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      .run();
    await this.db
      .update(healthChallenges)
      .set({ participant_count: challenge.participant_count + 1, updated_at: ts })
      .where(eq(healthChallenges.id, challengeId))
      .run();
    return { ok: true, joined: true };
  }

  /**
   * Leaving hides the caller's numbers from the leaderboard immediately: the
   * progress rows are soft-deleted along with the seat, so nothing survives to
   * be read by a peer who still holds a grant.
   */
  async leaveChallenge(userId: string, challengeId: string): Promise<Result<{ left: boolean }>> {
    const seat = await this.challengeSeat(userId, challengeId);
    if (!seat) return notFound('Challenge');
    const ts = nowIso();
    await this.db
      .update(healthChallengeParticipants)
      .set({ deleted_at: ts, updated_at: ts })
      .where(eq(healthChallengeParticipants.id, seat.id))
      .run();
    await this.db
      .update(healthChallengeProgress)
      .set({ deleted_at: ts, updated_at: ts })
      .where(
        and(
          eq(healthChallengeProgress.challenge_id, challengeId),
          eq(healthChallengeProgress.user_id, userId),
          isNull(healthChallengeProgress.deleted_at)
        )
      )
      .run();
    await this.db
      .update(healthChallenges)
      .set({
        participant_count: sql`max(0, ${healthChallenges.participant_count} - 1)`,
        updated_at: ts,
      })
      .where(eq(healthChallenges.id, challengeId))
      .run();
    return { ok: true, left: true };
  }

  async recordProgress(
    userId: string,
    challengeId: string,
    input: { date: string; value: number }
  ): Promise<Result<{ progress: unknown }>> {
    const challenge = await this.db
      .select()
      .from(healthChallenges)
      .where(and(eq(healthChallenges.id, challengeId), isNull(healthChallenges.deleted_at)))
      .get();
    if (!challenge) return notFound('Challenge');
    if (!(await this.challengeSeat(userId, challengeId))) return notFound('Challenge');

    const ts = nowIso();
    const existing = await this.db
      .select()
      .from(healthChallengeProgress)
      .where(
        and(
          eq(healthChallengeProgress.challenge_id, challengeId),
          eq(healthChallengeProgress.user_id, userId),
          eq(healthChallengeProgress.date, input.date),
          isNull(healthChallengeProgress.deleted_at)
        )
      )
      .get();
    const value = round2(input.value);
    const isCompleted = value >= challenge.target_value;
    if (existing) {
      await this.db
        .update(healthChallengeProgress)
        .set({
          value,
          target_value: challenge.target_value,
          is_completed: isCompleted,
          updated_at: ts,
        })
        .where(eq(healthChallengeProgress.id, existing.id))
        .run();
      return {
        ok: true,
        progress: { ...existing, value, target_value: challenge.target_value, is_completed: isCompleted },
      };
    }
    const row = {
      id: newId('hcpr'),
      challenge_id: challengeId,
      user_id: userId,
      date: input.date,
      value,
      target_value: challenge.target_value,
      is_completed: isCompleted,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(healthChallengeProgress).values(row).run();
    return { ok: true, progress: row };
  }

  /**
   * The caller's own progress, plus a leaderboard that contains ONLY the
   * participants who granted the caller the challenge's metric scope.
   *
   * Everyone else is invisible — not even their user id appears, because "user
   * X is in a weight-loss challenge" is itself health information. They are
   * summarised as an anonymous `hidden_participants` count so the UI can still
   * say "and 4 others you don't have access to".
   */
  async challengeProgress(
    userId: string,
    challengeId: string,
    opts: { from?: string; to?: string } = {}
  ): Promise<
    Result<{
      challenge: unknown;
      mine: unknown[];
      leaderboard: Array<{ user_id: string; total: number; completed_days: number }>;
      hidden_participants: number;
    }>
  > {
    const challenge = await this.db
      .select()
      .from(healthChallenges)
      .where(and(eq(healthChallenges.id, challengeId), isNull(healthChallenges.deleted_at)))
      .get();
    if (!challenge || !(await this.canSeeChallenge(userId, challenge))) {
      return notFound('Challenge');
    }

    const conds = [
      eq(healthChallengeProgress.challenge_id, challengeId),
      isNull(healthChallengeProgress.deleted_at),
    ];
    if (opts.from) conds.push(gte(healthChallengeProgress.date, opts.from));
    if (opts.to) conds.push(lte(healthChallengeProgress.date, opts.to));
    const rows = await this.db
      .select()
      .from(healthChallengeProgress)
      .where(and(...conds))
      .orderBy(healthChallengeProgress.date)
      .all();

    const mine = rows.filter((r) => r.user_id === userId);
    const participants = await this.db
      .select({ user_id: healthChallengeParticipants.user_id })
      .from(healthChallengeParticipants)
      .where(
        and(
          eq(healthChallengeParticipants.challenge_id, challengeId),
          isNull(healthChallengeParticipants.deleted_at)
        )
      )
      .all();
    const others = participants.map((p) => p.user_id).filter((id) => id !== userId);

    // Rule 1 in its sharpest form: joining the same challenge grants nothing.
    const visible = await this.filterByGrant(userId, others, challenge.metric as ShareScope);
    const leaderboard = [userId, ...visible].map((uid) => {
      const own = rows.filter((r) => r.user_id === uid);
      return {
        user_id: uid,
        total: round2(own.reduce((sum, r) => sum + r.value, 0)),
        completed_days: own.filter((r) => r.is_completed).length,
      };
    });

    return {
      ok: true,
      challenge: {
        id: challenge.id,
        name: challenge.name,
        metric: challenge.metric,
        target_value: challenge.target_value,
        unit: challenge.unit,
        frequency: challenge.frequency,
        visibility: challenge.visibility,
      },
      mine,
      leaderboard,
      hidden_participants: others.length - visible.length,
    };
  }

  /** Of `ownerIds`, the ones who currently share `scope` with `viewerId`. */
  private async filterByGrant(
    viewerId: string,
    ownerIds: string[],
    scope: ShareScope
  ): Promise<string[]> {
    if (ownerIds.length === 0) return [];
    const rows = await this.db
      .select({
        owner_id: healthMetricShares.owner_id,
        relationship_type: healthMetricShares.relationship_type,
      })
      .from(healthMetricShares)
      .where(
        and(
          eq(healthMetricShares.viewer_id, viewerId),
          inArray(healthMetricShares.owner_id, ownerIds),
          eq(healthMetricShares.scope, scope),
          isNull(healthMetricShares.revoked_at),
          isNull(healthMetricShares.deleted_at)
        )
      )
      .all();
    // Defence in depth (rule 4): a grant that outlived its relationship reads
    // nothing, even if a cascade somewhere failed to stamp `revoked_at`. Check
    // the RELATIONSHIP THE GRANT ITSELF NAMES, not "family OR buddy" — a pair
    // who are both family and buddies must not have a stale FAMILY grant kept
    // alive by an unrelated live BUDDY link. Matches `readSharedMetrics`.
    const out: string[] = [];
    for (const { owner_id, relationship_type } of rows) {
      if (out.includes(owner_id)) continue;
      if (await this.relationshipStillLive(owner_id, viewerId, relationship_type)) {
        out.push(owner_id);
      }
    }
    return out;
  }

  private async relationshipStillLive(
    ownerId: string,
    viewerId: string,
    relationshipType: string
  ): Promise<boolean> {
    if (relationshipType === 'family') return (await this.sharedFamilyId(ownerId, viewerId)) !== null;
    return Boolean(await this.buddyLinkBetween(ownerId, viewerId));
  }

  /* ================================================================== */
  /* SHARES — the scoped grant                                          */
  /* ================================================================== */

  /** What the client may offer, and what it may never offer. */
  scopeCatalogue() {
    return {
      shareable: [...SHAREABLE_SCOPES],
      /** Permanently excluded — not a "coming soon" list. */
      never_shareable: [...NEVER_SHAREABLE_SCOPES],
    };
  }

  /** Grants the caller has GIVEN, revoked ones included so the UI can show history. */
  async listGrants(userId: string) {
    const rows = await this.db
      .select()
      .from(healthMetricShares)
      .where(and(eq(healthMetricShares.owner_id, userId), isNull(healthMetricShares.deleted_at)))
      .orderBy(desc(healthMetricShares.granted_at))
      .all();
    return rows.map(publicGrant);
  }

  /** Grants the caller HOLDS — active only; a revoked grant is not a thing you have. */
  async listReceivedGrants(userId: string) {
    const rows = await this.db
      .select()
      .from(healthMetricShares)
      .where(
        and(
          eq(healthMetricShares.viewer_id, userId),
          isNull(healthMetricShares.revoked_at),
          isNull(healthMetricShares.deleted_at)
        )
      )
      .orderBy(desc(healthMetricShares.granted_at))
      .all();
    return rows.map(publicGrant);
  }

  /**
   * The ONE place read access is created.
   *
   * `ownerId` is always the authenticated caller — there is no parameter for
   * granting on someone else's behalf, so "A cannot grant on B's behalf" is
   * structural rather than a check that could be forgotten.
   */
  async grantScopes(
    ownerId: string,
    input: { viewer_id: string; relationship_type: RelationshipType; scopes: string[] }
  ): Promise<Result<{ grants: unknown[] }>> {
    if (input.viewer_id === ownerId) {
      return fail(400, 'invalid_viewer', 'You cannot grant access to yourself');
    }
    const scopeCheck = validateScopes(input.scopes);
    if (!scopeCheck.ok) return scopeCheck;

    // The relationship must exist RIGHT NOW; 404 (not 403) so a probe cannot
    // confirm that `viewer_id` is even an account.
    const relationshipId =
      input.relationship_type === 'family'
        ? await this.sharedFamilyId(ownerId, input.viewer_id)
        : (await this.buddyLinkBetween(ownerId, input.viewer_id))?.id ?? null;
    if (!relationshipId) return notFound('Relationship');

    const ts = nowIso();
    for (const scope of scopeCheck.scopes) {
      await this.db
        .insert(healthMetricShares)
        .values({
          id: newId('hms'),
          owner_id: ownerId,
          viewer_id: input.viewer_id,
          relationship_type: input.relationship_type,
          relationship_id: relationshipId,
          scope,
          granted_at: ts,
          revoked_at: null,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        })
        // Re-granting a revoked scope revives the SAME row (clearing
        // `revoked_at`) so "is this readable?" stays a single-row question.
        .onConflictDoUpdate({
          target: [
            healthMetricShares.owner_id,
            healthMetricShares.viewer_id,
            healthMetricShares.relationship_type,
            healthMetricShares.scope,
          ],
          set: {
            relationship_id: relationshipId,
            granted_at: ts,
            revoked_at: null,
            deleted_at: null,
            updated_at: ts,
          },
        })
        .run();
    }
    const grants = await this.db
      .select()
      .from(healthMetricShares)
      .where(
        and(
          eq(healthMetricShares.owner_id, ownerId),
          eq(healthMetricShares.viewer_id, input.viewer_id),
          eq(healthMetricShares.relationship_type, input.relationship_type),
          isNull(healthMetricShares.revoked_at),
          isNull(healthMetricShares.deleted_at)
        )
      )
      .all();
    return { ok: true, grants: grants.map(publicGrant) };
  }

  /**
   * Rule 3. Stamps `revoked_at` in place; there is no cache or copy of shared
   * data anywhere, so the next read by that viewer already fails.
   * Owner-only — the viewer cannot revoke, and nobody else can see the row.
   */
  async revokeGrant(ownerId: string, grantId: string): Promise<Result<{ grant: unknown }>> {
    const row = await this.db
      .select()
      .from(healthMetricShares)
      .where(
        and(
          eq(healthMetricShares.id, grantId),
          eq(healthMetricShares.owner_id, ownerId),
          isNull(healthMetricShares.deleted_at)
        )
      )
      .get();
    if (!row) return notFound('Grant');
    const ts = nowIso();
    if (!row.revoked_at) {
      await this.db
        .update(healthMetricShares)
        .set({ revoked_at: ts, updated_at: ts })
        .where(eq(healthMetricShares.id, row.id))
        .run();
    }
    return { ok: true, grant: publicGrant({ ...row, revoked_at: row.revoked_at ?? ts }) };
  }

  /**
   * Rule 4, the symmetric cascade. Revokes every grant of `type` between
   * `userId` and each of `others`, in BOTH directions, and answers how many
   * rows it touched so a caller (and a test) can assert the cascade ran.
   */
  private async revokeGrantsBetweenMany(
    userId: string,
    others: string[],
    type: RelationshipType,
    ts: string
  ): Promise<number> {
    if (others.length === 0) return 0;
    const doomed = await this.db
      .select({ id: healthMetricShares.id })
      .from(healthMetricShares)
      .where(
        and(
          eq(healthMetricShares.relationship_type, type),
          isNull(healthMetricShares.revoked_at),
          isNull(healthMetricShares.deleted_at),
          or(
            and(
              eq(healthMetricShares.owner_id, userId),
              inArray(healthMetricShares.viewer_id, others)
            ),
            and(
              eq(healthMetricShares.viewer_id, userId),
              inArray(healthMetricShares.owner_id, others)
            )
          )
        )
      )
      .all();
    if (doomed.length === 0) return 0;
    await this.db
      .update(healthMetricShares)
      .set({ revoked_at: ts, updated_at: ts })
      .where(
        inArray(
          healthMetricShares.id,
          doomed.map((d) => d.id)
        )
      )
      .run();
    return doomed.length;
  }

  /** Active grants from `ownerId` to `viewerId`. The single read gate. */
  private async activeGrantsFor(viewerId: string, ownerId: string) {
    return this.db
      .select()
      .from(healthMetricShares)
      .where(
        and(
          eq(healthMetricShares.owner_id, ownerId),
          eq(healthMetricShares.viewer_id, viewerId),
          isNull(healthMetricShares.revoked_at),
          isNull(healthMetricShares.deleted_at)
        )
      )
      .all();
  }

  /**
   * Read another user's shared metrics for one day.
   *
   * Returns null — which the route turns into a 404 — when the caller holds no
   * active grant, when the relationship behind every grant is gone, or when the
   * owner does not exist. All three are indistinguishable on purpose.
   *
   * The returned object carries ONLY the granted scopes. There is no "all" and
   * no default: an ungranted group is absent from the payload entirely, so a
   * client bug cannot render a figure it was never given.
   */
  async readSharedMetrics(
    viewerId: string,
    ownerId: string,
    date: string
  ): Promise<{ owner_id: string; date: string; scopes: ShareScope[]; metrics: MetricSnapshot } | null> {
    if (viewerId === ownerId) return null;
    const grants = await this.activeGrantsFor(viewerId, ownerId);
    if (grants.length === 0) return null;

    // Rule 4 defence in depth: the relationship each grant names must still be
    // live, checked against the relationship tables rather than the grant row.
    const familyLive = (await this.sharedFamilyId(ownerId, viewerId)) !== null;
    const buddyLive = Boolean(await this.buddyLinkBetween(ownerId, viewerId));
    const scopes = grants
      .filter((g) => (g.relationship_type === 'family' ? familyLive : buddyLive))
      .map((g) => g.scope)
      // A scope that has since been removed from the allowlist stops reading
      // immediately, without needing a data migration.
      .filter((s): s is ShareScope => isShareableScope(s));
    const unique = [...new Set(scopes)];
    if (unique.length === 0) return null;

    return {
      owner_id: ownerId,
      date,
      scopes: unique,
      metrics: await this.metricsFor(ownerId, date, unique),
    };
  }

  /**
   * Build the snapshot. One branch per grantable group — and there is
   * deliberately NO branch for cycle, vitality, body photos or body
   * measurements, so even a forged scope string could not produce them.
   */
  private async metricsFor(
    ownerId: string,
    date: string,
    scopes: ShareScope[]
  ): Promise<MetricSnapshot> {
    const out: MetricSnapshot = {};
    for (const scope of scopes) {
      switch (scope) {
        case 'activity':
          out.activity = await this.activityFor(ownerId, date);
          break;
        case 'nutrition':
          out.nutrition = await this.nutritionFor(ownerId, date);
          break;
        case 'weight':
          out.weight = await this.weightFor(ownerId, date);
          break;
        case 'water':
          out.water = await this.waterFor(ownerId, date);
          break;
        case 'habits':
          out.habits = await this.habitsFor(ownerId, date);
          break;
        case 'sleep':
          out.sleep = await this.sleepFor(ownerId, date);
          break;
      }
    }
    return out;
  }

  private async entriesOfType(ownerId: string, date: string, type: string) {
    return this.db
      .select()
      .from(healthEntries)
      .where(
        and(
          eq(healthEntries.user_id, ownerId),
          eq(healthEntries.date, date),
          eq(healthEntries.entry_type, type),
          isNull(healthEntries.deleted_at)
        )
      )
      .all();
  }

  private async activityFor(ownerId: string, date: string) {
    const [steps, workouts] = await Promise.all([
      this.entriesOfType(ownerId, date, 'steps'),
      this.entriesOfType(ownerId, date, 'workout'),
    ]);
    return {
      steps: steps.reduce((sum, r) => sum + num(safeJson(r.data).steps), 0),
      workout_minutes: workouts.reduce((sum, r) => sum + num(safeJson(r.data).minutes), 0),
      workout_count: workouts.length,
    };
  }

  private async nutritionFor(ownerId: string, date: string) {
    const rows = await this.db
      .select()
      .from(nutritionEntries)
      .where(
        and(
          eq(nutritionEntries.user_id, ownerId),
          eq(nutritionEntries.date, date),
          isNull(nutritionEntries.deleted_at)
        )
      )
      .all();
    return {
      calories: round2(rows.reduce((s, r) => s + r.calories, 0)),
      proteins: round2(rows.reduce((s, r) => s + r.proteins, 0)),
      carbohydrates: round2(rows.reduce((s, r) => s + r.carbohydrates, 0)),
      fats: round2(rows.reduce((s, r) => s + r.fats, 0)),
    };
  }

  private async weightFor(ownerId: string, date: string) {
    const row = await this.db
      .select()
      .from(weightEntries)
      .where(
        and(
          eq(weightEntries.user_id, ownerId),
          lte(weightEntries.date, date),
          isNull(weightEntries.deleted_at)
        )
      )
      .orderBy(desc(weightEntries.date))
      .get();
    return row ? { value: row.weight, unit: row.unit, date: row.date } : null;
  }

  private async waterFor(ownerId: string, date: string) {
    const rows = await this.db
      .select()
      .from(waterEntries)
      .where(
        and(
          eq(waterEntries.user_id, ownerId),
          eq(waterEntries.date, date),
          isNull(waterEntries.deleted_at)
        )
      )
      .all();
    return { total_ml: round2(rows.reduce((s, r) => s + r.amount_ml, 0)) };
  }

  private async habitsFor(ownerId: string, date: string) {
    const [habits, logs] = await Promise.all([
      this.db
        .select({ id: userHabits.id })
        .from(userHabits)
        .where(
          and(
            eq(userHabits.user_id, ownerId),
            eq(userHabits.is_archived, false),
            isNull(userHabits.deleted_at)
          )
        )
        .all(),
      this.db
        .select({ habit_id: habitLogs.habit_id })
        .from(habitLogs)
        .where(
          and(
            eq(habitLogs.user_id, ownerId),
            eq(habitLogs.date, date),
            isNull(habitLogs.deleted_at)
          )
        )
        .all(),
    ]);
    const ids = new Set(habits.map((h) => h.id));
    return {
      completed: logs.filter((l) => ids.has(l.habit_id)).length,
      total: habits.length,
    };
  }

  private async sleepFor(ownerId: string, date: string) {
    const rows = await this.entriesOfType(ownerId, date, 'sleep');
    return {
      hours: round2(
        rows.reduce((sum, r) => {
          const data = safeJson(r.data);
          return sum + (data.hours !== undefined ? num(data.hours) : num(data.minutes) / 60);
        }, 0)
      ),
    };
  }
}

/* ==================================================================== */
/* Pure helpers — exported for unit tests                                */
/* ==================================================================== */

/** Serialised grant. `relationship_id` stays internal (it names a family/row). */
export function publicGrant(row: {
  id: string;
  owner_id: string;
  viewer_id: string;
  relationship_type: string;
  scope: string;
  granted_at: string;
  revoked_at: string | null;
}) {
  return {
    id: row.id,
    owner_id: row.owner_id,
    viewer_id: row.viewer_id,
    relationship_type: row.relationship_type,
    scope: row.scope,
    granted_at: row.granted_at,
    revoked_at: row.revoked_at,
    active: row.revoked_at === null,
  };
}

/**
 * Rule 2, in one function. Splits a requested scope list into "fine" and two
 * distinct refusals:
 *
 *   `forbidden_scope` — a SENSITIVE domain (cycle / vitality / body photos /
 *                       body measurements). Named explicitly so the refusal is
 *                       unmistakable in a log, a test and a support ticket.
 *   `unknown_scope`   — a typo or a client that is ahead of the server.
 *
 * Exported so the service test can drive it directly with no D1 at all.
 */
export function validateScopes(scopes: string[]): Result<{ scopes: ShareScope[] }> {
  if (scopes.length === 0) {
    return fail(400, 'bad_request', 'At least one scope is required');
  }
  const forbidden = scopes.filter(isPermanentlyExcludedScope);
  if (forbidden.length > 0) {
    return fail(
      400,
      'forbidden_scope',
      `These health domains can never be shared: ${[...new Set(forbidden)].join(', ')}`
    );
  }
  const unknown = scopes.filter((s) => !isShareableScope(s));
  if (unknown.length > 0) {
    return fail(400, 'unknown_scope', `Unknown scope(s): ${[...new Set(unknown)].join(', ')}`);
  }
  return { ok: true, scopes: [...new Set(scopes as ShareScope[])] };
}

/** Re-exported so a route can build a 404 with the same wording as the service. */
export { fail as failResult, notFound as notFoundResult };
