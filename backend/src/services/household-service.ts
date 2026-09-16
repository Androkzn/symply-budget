import { eq, and, or, isNull, sql, desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import type {
  Database,
  Env,
  HouseholdResponse,
  HouseholdMemberResponse,
  HouseholdRole,
  Permission,
} from '../types';
import { resolveAvatarUrl } from '../utils/avatar-url';
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '../utils/errors';
import { generateId, now, addTime, isExpired } from '../utils/id';
import { generateToken, hashToken } from '../utils/password';
import type {
  CreateHouseholdInput,
  UpdateHouseholdInput,
  InviteMemberInput,
  CreateInviteLinkInput,
} from '../utils/validation';

// Short, URL-friendly invite code. Crockford-ish alphabet (no 0/O/1/I/l) to
// avoid ambiguity. 10 chars over a 55-symbol set ≈ 57 bits — ample for a
// request-to-join link that an owner still has to approve.
function generateShortCode(length = 10): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// Role permissions
const ROLE_PERMISSIONS: Record<HouseholdRole, Permission[]> = {
  owner: [
    { action: 'read', resource: '*' },
    { action: 'write', resource: '*' },
    { action: 'delete', resource: '*' },
    { action: 'manage', resource: 'members' },
    { action: 'manage', resource: 'invitations' },
    { action: 'delete', resource: 'household' },
  ],
  member: [
    { action: 'read', resource: '*' },
    { action: 'write', resource: 'reports' },
    { action: 'write', resource: 'action_items' },
    { action: 'write', resource: 'maintenance_tasks' },
  ],
};

export class HouseholdService {
  private db: Database;
  private d1: D1Database;
  private env: Env;

  constructor(
    env: Env,
    d1: D1Database
  ) {
    this.env = env;
    this.d1 = d1;
    this.db = drizzle(d1, { schema });
  }

  /**
   * Build a public, cacheable URL for a household photo from its stored R2
   * key. The `/api/household-photos/...` proxy is public, so the URL works on
   * the web invite page and in-app alike. Returns null when no photo is set.
   */
  private buildPhotoUrl(photoKey: string | null): string | null {
    if (!photoKey || !this.env.API_URL) return null;
    return `${this.env.API_URL}/api/household-photos/${photoKey}`;
  }

  /**
   * Create a new household
   */
  async createHousehold(
    userId: string,
    input: CreateHouseholdInput
  ): Promise<HouseholdResponse> {
    const householdId = generateId();
    const timestamp = now();

    // Create household
    await this.db.insert(schema.households).values({
      id: householdId,
      name: input.name,
      address_line1: input.address_line1 || null,
      address_line2: input.address_line2 || null,
      city: input.city || null,
      state_province: input.state_province || null,
      postal_code: input.postal_code || null,
      country: input.country || null,
      unit_system: input.unit_system || null,
      created_at: timestamp,
      updated_at: timestamp,
      updated_by: userId,
    });

    // Add creator as owner
    await this.db.insert(schema.householdMembers).values({
      id: generateId(),
      household_id: householdId,
      user_id: userId,
      role: 'owner',
      joined_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    });

    // Aihousekeeper (Proactive Layer) §A1 — seed the household's Aihousekeeper persona row.
    // All other defaults (name, tone, briefing_time, quiet hours, channels,
    // daily_interrupt_budget) come from the migration's DEFAULT clauses so
    // the plan's canonical values stay authoritative in one place.
    // `timezone` is optional on input; the column's DEFAULT 'UTC' handles
    // the omitted case. Aihousekeeper's `PATCH /aihousekeeper/identity` route updates it
    // later (session 4).
    const insertIdentity: schema.NewAssistantIdentity = {
      household_id: householdId,
      created_at: timestamp,
      updated_at: timestamp,
    };
    if (input.timezone) {
      insertIdentity.timezone = input.timezone;
    }
    await this.db.insert(schema.assistantIdentity).values(insertIdentity);

    return this.getHousehold(householdId, userId);
  }

  /**
   * Get household by ID (with user's role)
   */
  async getHousehold(householdId: string, userId: string): Promise<HouseholdResponse> {
    const membership = await this.getMembership(householdId, userId);
    if (!membership) {
      throw new ForbiddenError('Not a member of this household');
    }

    const household = await this.db
      .select()
      .from(schema.households)
      .where(
        and(
          eq(schema.households.id, householdId),
          isNull(schema.households.deleted_at)
        )
      )
      .get();

    if (!household) {
      throw new NotFoundError('Household');
    }

    // Get member count
    const memberCount = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.household_id, householdId),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .get();

    // Get floor plan count (raw query - floor_plans table lives in separate schema)
    const fpRow = await this.d1
      .prepare('SELECT COUNT(*) as count FROM floor_plans WHERE household_id = ?')
      .bind(householdId)
      .first<{ count: number }>();
    const rawCount = fpRow && ('count' in fpRow ? fpRow.count : (fpRow as Record<string, unknown>).count);
    const floorPlanCount = rawCount != null ? Number(rawCount) : 0;

    return {
      id: household.id,
      name: household.name,
      address_line1: household.address_line1,
      address_line2: household.address_line2,
      city: household.city,
      state_province: household.state_province,
      postal_code: household.postal_code,
      country: household.country as 'CA' | 'US' | null,
      unit_system: household.unit_system as 'metric' | 'imperial' | null,
      photo_key: household.photo_key,
      photo_url: this.buildPhotoUrl(household.photo_key),
      purchase_price: household.purchase_price ?? null,
      purchase_date: household.purchase_date ?? null,
      created_at: household.created_at,
      updated_at: household.updated_at,
      member_count: memberCount?.count || 0,
      my_role: membership.role as HouseholdRole,
      floor_plan_count: floorPlanCount,
    };
  }

  /**
   * Get all households for a user
   */
  async getUserHouseholds(userId: string): Promise<HouseholdResponse[]> {
    const memberships = await this.db
      .select()
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.user_id, userId),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .all();

    const households: HouseholdResponse[] = [];

    for (const membership of memberships) {
      try {
        const household = await this.getHousehold(membership.household_id, userId);
        households.push(household);
      } catch {
        // Household may have been deleted
      }
    }

    return households;
  }

  /**
   * Update household
   */
  async updateHousehold(
    householdId: string,
    userId: string,
    input: UpdateHouseholdInput
  ): Promise<HouseholdResponse> {
    await this.requirePermission(householdId, userId, { action: 'write', resource: 'household' });

    await this.db
      .update(schema.households)
      .set({
        ...input,
        updated_at: now(),
        updated_by: userId,
      })
      .where(eq(schema.households.id, householdId));

    return this.getHousehold(householdId, userId);
  }

  /**
   * Delete household (soft delete)
   */
  async deleteHousehold(householdId: string, userId: string): Promise<void> {
    await this.requirePermission(householdId, userId, { action: 'delete', resource: 'household' });

    const timestamp = now();

    await this.db
      .update(schema.households)
      .set({
        deleted_at: timestamp,
        updated_at: timestamp,
        updated_by: userId,
      })
      .where(eq(schema.households.id, householdId));

    // Detach every member so the deleted property drops out of all their
    // household lists — not just the owner who deleted it.
    await this.db
      .update(schema.householdMembers)
      .set({ deleted_at: timestamp, updated_at: timestamp })
      .where(
        and(
          eq(schema.householdMembers.household_id, householdId),
          isNull(schema.householdMembers.deleted_at)
        )
      );
  }

  /**
   * Leave a household. Any member may leave their own membership. The sole
   * owner cannot leave — they must transfer ownership to another member or
   * delete the property instead. Soft-deletes the caller's membership row.
   */
  async leaveHousehold(
    householdId: string,
    userId: string
  ): Promise<{ householdName: string; ownerUserIds: string[]; leaverName: string }> {
    const membership = await this.getMembership(householdId, userId);
    if (!membership) {
      throw new NotFoundError('Member');
    }

    if (membership.role === 'owner') {
      const owners = await this.db
        .select()
        .from(schema.householdMembers)
        .where(
          and(
            eq(schema.householdMembers.household_id, householdId),
            eq(schema.householdMembers.role, 'owner'),
            isNull(schema.householdMembers.deleted_at)
          )
        )
        .all();

      if (owners.length === 1) {
        throw new ForbiddenError(
          'You are the only owner. Transfer ownership to another member or delete the property instead.'
        );
      }
    }

    // Capture who to notify *before* removing the membership. Exclude the
    // leaver themselves (a departing co-owner shouldn't notify their own
    // device).
    const ownerUserIds = (await this.getOwnerUserIds(householdId)).filter(
      (id) => id !== userId
    );

    const household = await this.db
      .select({ name: schema.households.name })
      .from(schema.households)
      .where(eq(schema.households.id, householdId))
      .get();

    const leaver = await this.db
      .select({ display_name: schema.users.display_name, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    await this.db
      .update(schema.householdMembers)
      .set({ deleted_at: now(), updated_at: now() })
      .where(eq(schema.householdMembers.id, membership.id));

    return {
      householdName: household?.name ?? 'your property',
      ownerUserIds,
      leaverName: leaver?.display_name || leaver?.email || 'A member',
    };
  }

  /**
   * Get household members
   */
  async getMembers(householdId: string, userId: string): Promise<HouseholdMemberResponse[]> {
    await this.requirePermission(householdId, userId, { action: 'read', resource: 'members' });

    const members = await this.db
      .select({
        id: schema.householdMembers.id,
        user_id: schema.householdMembers.user_id,
        role: schema.householdMembers.role,
        joined_at: schema.householdMembers.joined_at,
        display_name: schema.users.display_name,
        avatar_url: schema.users.avatar_url,
        email: schema.users.email,
      })
      .from(schema.householdMembers)
      .innerJoin(schema.users, eq(schema.householdMembers.user_id, schema.users.id))
      .where(
        and(
          eq(schema.householdMembers.household_id, householdId),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .orderBy(desc(schema.householdMembers.joined_at))
      .all();

    return members.map((m) => ({
      id: m.id,
      user_id: m.user_id,
      display_name: m.display_name,
      // `users.avatar_url` stores a bucket KEY, not a URL (see
      // `utils/avatar-url.ts`) — resolved per request by whichever Worker owns
      // the object. Handed over raw it renders as a broken image, and a member
      // list of initials looks like nobody has ever set a picture.
      avatar_url: resolveAvatarUrl(m.avatar_url, this.env.API_URL),
      email: m.email,
      role: m.role as HouseholdRole,
      joined_at: m.joined_at,
    }));
  }

  /**
   * Invite a member to household
   */
  async inviteMember(
    householdId: string,
    userId: string,
    input: InviteMemberInput
  ): Promise<{ token: string; invitation_id: string }> {
    await this.requirePermission(householdId, userId, { action: 'manage', resource: 'invitations' });

    // Check if user is already a member
    const existingMember = await this.db
      .select()
      .from(schema.householdMembers)
      .innerJoin(schema.users, eq(schema.householdMembers.user_id, schema.users.id))
      .where(
        and(
          eq(schema.householdMembers.household_id, householdId),
          eq(schema.users.email, input.email.toLowerCase()),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .get();

    if (existingMember) {
      throw new ConflictError('User is already a member of this household');
    }

    // Check for existing pending invitation
    const existingInvite = await this.db
      .select()
      .from(schema.householdInvitations)
      .where(
        and(
          eq(schema.householdInvitations.household_id, householdId),
          eq(schema.householdInvitations.email, input.email.toLowerCase()),
          isNull(schema.householdInvitations.accepted_at),
          isNull(schema.householdInvitations.declined_at)
        )
      )
      .get();

    if (existingInvite && !isExpired(existingInvite.expires_at)) {
      throw new ConflictError('An invitation has already been sent to this email');
    }

    const token = generateToken();
    const tokenHash = await hashToken(token);
    const invitationId = generateId();

    await this.db.insert(schema.householdInvitations).values({
      id: invitationId,
      household_id: householdId,
      email: input.email.toLowerCase(),
      role: input.role,
      invited_by: userId,
      token_hash: tokenHash,
      expires_at: addTime(7 * 24 * 60 * 60), // 7 days
      created_at: now(),
    });

    return { token, invitation_id: invitationId };
  }

  /**
   * Get pending invitations for a household
   */
  async getInvitations(
    householdId: string,
    userId: string
  ): Promise<
    {
      id: string;
      email: string;
      role: HouseholdRole;
      expires_at: string;
      created_at: string;
    }[]
  > {
    await this.requirePermission(householdId, userId, { action: 'manage', resource: 'invitations' });

    const invitations = await this.db
      .select()
      .from(schema.householdInvitations)
      .where(
        and(
          eq(schema.householdInvitations.household_id, householdId),
          isNull(schema.householdInvitations.accepted_at),
          isNull(schema.householdInvitations.declined_at)
        )
      )
      .orderBy(desc(schema.householdInvitations.created_at))
      .all();

    return invitations
      .filter((inv) => !isExpired(inv.expires_at))
      .map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role as HouseholdRole,
        expires_at: inv.expires_at,
        created_at: inv.created_at,
      }));
  }

  /**
   * Cancel an invitation
   */
  async cancelInvitation(
    householdId: string,
    invitationId: string,
    userId: string
  ): Promise<void> {
    await this.requirePermission(householdId, userId, { action: 'manage', resource: 'invitations' });

    const invitation = await this.db
      .select()
      .from(schema.householdInvitations)
      .where(
        and(
          eq(schema.householdInvitations.id, invitationId),
          eq(schema.householdInvitations.household_id, householdId)
        )
      )
      .get();

    if (!invitation) {
      throw new NotFoundError('Invitation');
    }

    await this.db
      .update(schema.householdInvitations)
      .set({ declined_at: now() })
      .where(eq(schema.householdInvitations.id, invitationId));
  }

  /**
   * Validate an invitation token and return invitation details
   */
  async validateInvitation(token: string, userId: string): Promise<{
    valid: boolean;
    household?: { id: string; name: string };
    invitedBy?: string;
    role?: string;
    expiresAt?: string;
    error?: string;
  }> {
    try {
      const tokenHash = await hashToken(token);

      const invitation = await this.db
        .select()
        .from(schema.householdInvitations)
        .where(
          and(
            eq(schema.householdInvitations.token_hash, tokenHash),
            isNull(schema.householdInvitations.accepted_at),
            isNull(schema.householdInvitations.declined_at)
          )
        )
        .get();

      if (!invitation) {
        return { valid: false, error: 'Invitation not found or already used' };
      }

      if (isExpired(invitation.expires_at)) {
        return { valid: false, error: 'Invitation has expired' };
      }

      // Check if user is already a member
      const existingMember = await this.getMembership(invitation.household_id, userId);
      if (existingMember) {
        return { valid: false, error: 'You are already a member of this household' };
      }

      // Get household details
      const household = await this.db
        .select({
          id: schema.households.id,
          name: schema.households.name,
        })
        .from(schema.households)
        .where(eq(schema.households.id, invitation.household_id))
        .get();

      if (!household) {
        return { valid: false, error: 'Household not found' };
      }

      return {
        valid: true,
        household: { id: household.id, name: household.name },
        invitedBy: invitation.invited_by,
        role: invitation.role,
        expiresAt: invitation.expires_at,
      };
    } catch (error) {
      console.error('Error validating invitation:', error);
      return { valid: false, error: 'Failed to validate invitation' };
    }
  }

  /**
   * Accept an invitation
   */
  async acceptInvitation(
    token: string,
    userId: string,
    userEmail: string
  ): Promise<HouseholdResponse> {
    const tokenHash = await hashToken(token);

    const invitation = await this.db
      .select()
      .from(schema.householdInvitations)
      .where(
        and(
          eq(schema.householdInvitations.token_hash, tokenHash),
          isNull(schema.householdInvitations.accepted_at),
          isNull(schema.householdInvitations.declined_at)
        )
      )
      .get();

    if (!invitation) {
      throw new NotFoundError('Invitation');
    }

    return this.acceptInvitationRow(invitation, userId, userEmail);
  }

  /**
   * Accept a household invitation by its id (in-app flow — no emailed token
   * required). Used when an existing app user taps the "you've been invited"
   * notification. Email-matching still enforced for security.
   */
  async acceptInvitationById(
    invitationId: string,
    userId: string,
    userEmail: string
  ): Promise<HouseholdResponse> {
    const invitation = await this.db
      .select()
      .from(schema.householdInvitations)
      .where(
        and(
          eq(schema.householdInvitations.id, invitationId),
          isNull(schema.householdInvitations.accepted_at),
          isNull(schema.householdInvitations.declined_at)
        )
      )
      .get();

    if (!invitation) {
      throw new NotFoundError('Invitation');
    }

    return this.acceptInvitationRow(invitation, userId, userEmail);
  }

  /**
   * Decline a household invitation by its id (in-app flow). Email-matching
   * enforced so a user can only decline invitations addressed to them.
   */
  async declineInvitationById(
    invitationId: string,
    userEmail: string
  ): Promise<void> {
    const invitation = await this.db
      .select()
      .from(schema.householdInvitations)
      .where(
        and(
          eq(schema.householdInvitations.id, invitationId),
          isNull(schema.householdInvitations.accepted_at),
          isNull(schema.householdInvitations.declined_at)
        )
      )
      .get();

    if (!invitation) {
      throw new NotFoundError('Invitation');
    }

    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenError('This invitation was sent to a different email address');
    }

    await this.db
      .update(schema.householdInvitations)
      .set({ declined_at: now() })
      .where(eq(schema.householdInvitations.id, invitation.id));
  }

  /**
   * Shared accept logic — validates expiry/email/household/membership, inserts
   * the member, and marks the invitation accepted.
   */
  private async acceptInvitationRow(
    invitation: schema.HouseholdInvitation,
    userId: string,
    userEmail: string
  ): Promise<HouseholdResponse> {
    if (isExpired(invitation.expires_at)) {
      throw new ForbiddenError('Invitation has expired');
    }

    // Security: Verify the invitation was sent to the accepting user's email
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenError('This invitation was sent to a different email address');
    }

    // Verify the household exists and is not deleted
    const household = await this.db
      .select()
      .from(schema.households)
      .where(
        and(
          eq(schema.households.id, invitation.household_id),
          isNull(schema.households.deleted_at)
        )
      )
      .get();

    if (!household) {
      throw new NotFoundError('Household');
    }

    // Check if user is already a member
    const existingMember = await this.getMembership(invitation.household_id, userId);
    if (existingMember) {
      throw new ConflictError('You are already a member of this household');
    }

    const timestamp = now();

    // Add user as member
    await this.db.insert(schema.householdMembers).values({
      id: generateId(),
      household_id: invitation.household_id,
      user_id: userId,
      role: invitation.role,
      invited_by: invitation.invited_by,
      joined_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    });

    // Mark invitation as accepted
    await this.db
      .update(schema.householdInvitations)
      .set({ accepted_at: timestamp })
      .where(eq(schema.householdInvitations.id, invitation.id));

    return this.getHousehold(invitation.household_id, userId);
  }

  /**
   * Search registered users by name or email so an owner can invite an
   * existing app user directly. Excludes the household's current active
   * members. Returns a minimal public profile only.
   */
  async searchInvitableUsers(
    householdId: string,
    requesterId: string,
    query: string
  ): Promise<{ id: string; display_name: string | null; avatar_url: string | null; email: string }[]> {
    await this.requirePermission(householdId, requesterId, { action: 'manage', resource: 'invitations' });

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return [];
    }

    // Current active members are not invitable.
    const memberRows = await this.db
      .select({ user_id: schema.householdMembers.user_id })
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.household_id, householdId),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .all();
    const memberIds = new Set(memberRows.map((m) => m.user_id));

    const pattern = `%${trimmed.toLowerCase()}%`;
    const rows = await this.db
      .select({
        id: schema.users.id,
        display_name: schema.users.display_name,
        avatar_url: schema.users.avatar_url,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(
        or(
          sql`lower(${schema.users.email}) like ${pattern}`,
          sql`lower(${schema.users.display_name}) like ${pattern}`
        )
      )
      .limit(20)
      .all();

    return rows
      .filter((u) => !memberIds.has(u.id))
      .map((u) => ({ ...u, avatar_url: resolveAvatarUrl(u.avatar_url, this.env.API_URL) }));
  }

  /**
   * Remove a member from household
   */
  async removeMember(
    householdId: string,
    memberUserId: string,
    requestingUserId: string
  ): Promise<void> {
    await this.requirePermission(householdId, requestingUserId, { action: 'manage', resource: 'members' });

    // Can't remove yourself if you're the sole owner
    if (memberUserId === requestingUserId) {
      const owners = await this.db
        .select()
        .from(schema.householdMembers)
        .where(
          and(
            eq(schema.householdMembers.household_id, householdId),
            eq(schema.householdMembers.role, 'owner'),
            isNull(schema.householdMembers.deleted_at)
          )
        )
        .all();

      if (owners.length === 1) {
        throw new ForbiddenError('Cannot remove yourself as the sole owner. Transfer ownership first.');
      }
    }

    const membership = await this.getMembership(householdId, memberUserId);
    if (!membership) {
      throw new NotFoundError('Member');
    }

    await this.db
      .update(schema.householdMembers)
      .set({ deleted_at: now(), updated_at: now() })
      .where(eq(schema.householdMembers.id, membership.id));
  }

  /**
   * Update member role
   */
  async updateMemberRole(
    householdId: string,
    memberUserId: string,
    requestingUserId: string,
    newRole: HouseholdRole
  ): Promise<HouseholdMemberResponse> {
    await this.requirePermission(householdId, requestingUserId, { action: 'manage', resource: 'members' });

    const membership = await this.getMembership(householdId, memberUserId);
    if (!membership) {
      throw new NotFoundError('Member');
    }

    // If demoting from owner, ensure there's another owner
    if (membership.role === 'owner' && newRole === 'member') {
      const owners = await this.db
        .select()
        .from(schema.householdMembers)
        .where(
          and(
            eq(schema.householdMembers.household_id, householdId),
            eq(schema.householdMembers.role, 'owner'),
            isNull(schema.householdMembers.deleted_at)
          )
        )
        .all();

      if (owners.length === 1) {
        throw new ForbiddenError('Cannot demote the sole owner. Promote another member first.');
      }
    }

    await this.db
      .update(schema.householdMembers)
      .set({ role: newRole, updated_at: now() })
      .where(eq(schema.householdMembers.id, membership.id));

    // Get updated member info
    const members = await this.getMembers(householdId, requestingUserId);
    const updatedMember = members.find((m) => m.user_id === memberUserId);

    if (!updatedMember) {
      throw new NotFoundError('Member');
    }

    return updatedMember;
  }

  // ============ SHAREABLE INVITE LINKS ============

  /**
   * Create a shareable, non-email-bound invite link. Owners only. Returns the
   * raw token (only the SHA-256 hash is stored) so the caller can build the URL.
   */
  async createInviteLink(
    householdId: string,
    userId: string,
    input: CreateInviteLinkInput
  ): Promise<{
    token: string;
    short_code: string;
    link_id: string;
    expires_at: string;
    role: HouseholdRole;
  }> {
    await this.requirePermission(householdId, userId, { action: 'manage', resource: 'invitations' });

    const token = generateToken();
    const tokenHash = await hashToken(token);
    const shortCode = generateShortCode();
    const linkId = generateId();
    const role = (input.role ?? 'member') as HouseholdRole;
    const expiresAt = addTime((input.expires_in_days ?? 7) * 24 * 60 * 60);

    await this.db.insert(schema.householdInviteLinks).values({
      id: linkId,
      household_id: householdId,
      role,
      created_by: userId,
      token_hash: tokenHash,
      short_code: shortCode,
      expires_at: expiresAt,
      max_uses: input.max_uses ?? null,
      use_count: 0,
      created_at: now(),
    });

    return { token, short_code: shortCode, link_id: linkId, expires_at: expiresAt, role };
  }

  /**
   * Public, unauthenticated preview of an invite link (by token OR short code),
   * for rendering rich link previews (Open Graph) on the web landing page.
   * Exposes only what the Join screen already shows — household name/address,
   * household photo, and the inviter's name/avatar — never anything sensitive.
   */
  async getInviteLinkPreview(identifier: string): Promise<{
    household_name: string;
    address: string | null;
    photo_key: string | null;
    household_id: string;
    inviter_name: string | null;
    inviter_avatar_url: string | null;
  } | null> {
    const link = await this.getActiveLinkByToken(identifier);
    if ('error' in link) return null;

    const household = await this.db
      .select({
        id: schema.households.id,
        name: schema.households.name,
        city: schema.households.city,
        state_province: schema.households.state_province,
        photo_key: schema.households.photo_key,
      })
      .from(schema.households)
      .where(and(eq(schema.households.id, link.household_id), isNull(schema.households.deleted_at)))
      .get();
    if (!household) return null;

    const inviter = await this.db
      .select({ display_name: schema.users.display_name, avatar_url: schema.users.avatar_url })
      .from(schema.users)
      .where(eq(schema.users.id, link.created_by))
      .get();

    const address = [household.city, household.state_province].filter(Boolean).join(', ') || null;

    return {
      household_name: household.name,
      address,
      photo_key: household.photo_key,
      household_id: household.id,
      inviter_name: inviter?.display_name ?? null,
      inviter_avatar_url: resolveAvatarUrl(inviter?.avatar_url, this.env.API_URL),
    };
  }

  /**
   * Look up an invite link by token without mutating anything. Used by the Join
   * screen to render household details before the user commits to joining.
   */
  async validateInviteLink(
    token: string,
    userId: string
  ): Promise<{
    valid: boolean;
    household?: { id: string; name: string };
    role?: HouseholdRole;
    expiresAt?: string;
    alreadyMember?: boolean;
    homePhotoUrl?: string | null;
    inviter?: { displayName: string | null; avatarUrl: string | null; email: string | null };
    error?: string;
  }> {
    try {
      const link = await this.getActiveLinkByToken(token);
      if ('error' in link) {
        return { valid: false, error: link.error };
      }

      const household = await this.db
        .select({
          id: schema.households.id,
          name: schema.households.name,
          photo_key: schema.households.photo_key,
        })
        .from(schema.households)
        .where(and(eq(schema.households.id, link.household_id), isNull(schema.households.deleted_at)))
        .get();

      if (!household) {
        return { valid: false, error: 'Household not found' };
      }

      const existingMember = await this.getMembership(link.household_id, userId);

      const inviter = await this.db
        .select({
          displayName: schema.users.display_name,
          avatarUrl: schema.users.avatar_url,
          email: schema.users.email,
        })
        .from(schema.users)
        .where(eq(schema.users.id, link.created_by))
        .get();

      return {
        valid: true,
        household: { id: household.id, name: household.name },
        role: link.role as HouseholdRole,
        expiresAt: link.expires_at,
        alreadyMember: !!existingMember,
        homePhotoUrl: this.buildPhotoUrl(household.photo_key),
        inviter: inviter
          ? { ...inviter, avatarUrl: resolveAvatarUrl(inviter.avatarUrl, this.env.API_URL) }
          : undefined,
      };
    } catch (error) {
      console.error('Error validating invite link:', error);
      return { valid: false, error: 'Failed to validate invite link' };
    }
  }

  /**
   * Submit a "request to join" for a link. Idempotent: if the user already has a
   * pending request, the same request is returned. Returns the household summary
   * and the owner user IDs so the route can notify them.
   */
  async requestToJoin(
    token: string,
    userId: string
  ): Promise<{
    status: 'pending' | 'already_member';
    request_id?: string;
    created?: boolean;
    household: { id: string; name: string };
    ownerUserIds: string[];
  }> {
    const link = await this.getActiveLinkByToken(token);
    if ('error' in link) {
      throw new ForbiddenError(link.error);
    }

    const household = await this.db
      .select({ id: schema.households.id, name: schema.households.name })
      .from(schema.households)
      .where(and(eq(schema.households.id, link.household_id), isNull(schema.households.deleted_at)))
      .get();

    if (!household) {
      throw new NotFoundError('Household');
    }

    const existingMember = await this.getMembership(link.household_id, userId);
    if (existingMember) {
      return { status: 'already_member', household, ownerUserIds: [] };
    }

    const existingRequest = await this.db
      .select()
      .from(schema.householdJoinRequests)
      .where(
        and(
          eq(schema.householdJoinRequests.household_id, link.household_id),
          eq(schema.householdJoinRequests.user_id, userId),
          eq(schema.householdJoinRequests.status, 'pending')
        )
      )
      .get();

    let requestId = existingRequest?.id;
    let created = false;
    if (!requestId) {
      created = true;
      requestId = generateId();
      await this.db.insert(schema.householdJoinRequests).values({
        id: requestId,
        household_id: link.household_id,
        invite_link_id: link.id,
        user_id: userId,
        status: 'pending',
        requested_at: now(),
      });
    }

    const ownerUserIds = await this.getOwnerUserIds(link.household_id);
    return { status: 'pending', request_id: requestId, created, household, ownerUserIds };
  }

  /**
   * Pending join requests across all households the user owns (for home feed / alerts).
   */
  async getOwnerPendingJoinRequests(
    userId: string
  ): Promise<
    {
      id: string;
      household_id: string;
      household_name: string;
      user_id: string;
      display_name: string | null;
      avatar_url: string | null;
      email: string;
      requested_at: string;
    }[]
  > {
    return this.db
      .select({
        id: schema.householdJoinRequests.id,
        household_id: schema.householdJoinRequests.household_id,
        household_name: schema.households.name,
        user_id: schema.householdJoinRequests.user_id,
        requested_at: schema.householdJoinRequests.requested_at,
        display_name: schema.users.display_name,
        avatar_url: schema.users.avatar_url,
        email: schema.users.email,
      })
      .from(schema.householdJoinRequests)
      .innerJoin(
        schema.households,
        eq(schema.householdJoinRequests.household_id, schema.households.id)
      )
      .innerJoin(
        schema.householdMembers,
        and(
          eq(schema.householdMembers.household_id, schema.householdJoinRequests.household_id),
          eq(schema.householdMembers.user_id, userId),
          eq(schema.householdMembers.role, 'owner'),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .innerJoin(schema.users, eq(schema.householdJoinRequests.user_id, schema.users.id))
      .where(
        and(
          eq(schema.householdJoinRequests.status, 'pending'),
          isNull(schema.households.deleted_at)
        )
      )
      .orderBy(desc(schema.householdJoinRequests.requested_at))
      .all()
      .then((rows) =>
        rows.map((r) => ({ ...r, avatar_url: resolveAvatarUrl(r.avatar_url, this.env.API_URL) }))
      );
  }

  /**
   * List pending join requests for a household (owners only).
   */
  async getJoinRequests(
    householdId: string,
    userId: string
  ): Promise<
    {
      id: string;
      user_id: string;
      display_name: string | null;
      avatar_url: string | null;
      email: string;
      requested_at: string;
    }[]
  > {
    await this.requirePermission(householdId, userId, { action: 'manage', resource: 'members' });

    return this.db
      .select({
        id: schema.householdJoinRequests.id,
        user_id: schema.householdJoinRequests.user_id,
        requested_at: schema.householdJoinRequests.requested_at,
        display_name: schema.users.display_name,
        avatar_url: schema.users.avatar_url,
        email: schema.users.email,
      })
      .from(schema.householdJoinRequests)
      .innerJoin(schema.users, eq(schema.householdJoinRequests.user_id, schema.users.id))
      .where(
        and(
          eq(schema.householdJoinRequests.household_id, householdId),
          eq(schema.householdJoinRequests.status, 'pending')
        )
      )
      .orderBy(desc(schema.householdJoinRequests.requested_at))
      .all()
      .then((rows) =>
        rows.map((r) => ({ ...r, avatar_url: resolveAvatarUrl(r.avatar_url, this.env.API_URL) }))
      );
  }

  /**
   * List the *current user's* own pending "request to join" submissions, with
   * the target household's name. Used to show requesters a "your request is
   * pending — you'll be notified" state instead of a generic empty screen.
   */
  async getMyPendingJoinRequests(
    userId: string
  ): Promise<{ id: string; household_id: string; household_name: string; requested_at: string }[]> {
    const rows = await this.db
      .select({
        id: schema.householdJoinRequests.id,
        household_id: schema.householdJoinRequests.household_id,
        household_name: schema.households.name,
        requested_at: schema.householdJoinRequests.requested_at,
      })
      .from(schema.householdJoinRequests)
      .innerJoin(
        schema.households,
        eq(schema.householdJoinRequests.household_id, schema.households.id)
      )
      .where(
        and(
          eq(schema.householdJoinRequests.user_id, userId),
          eq(schema.householdJoinRequests.status, 'pending')
        )
      )
      .orderBy(desc(schema.householdJoinRequests.requested_at))
      .all();

    return rows;
  }

  /**
   * Approve a pending join request — inserts the member row (role from the
   * originating link), marks the request approved, and bumps the link's use
   * count. Owners only.
   */
  async approveJoinRequest(
    householdId: string,
    requestId: string,
    deciderUserId: string
  ): Promise<{ household: HouseholdResponse; member_user_id: string; requester_name: string }> {
    await this.requirePermission(householdId, deciderUserId, { action: 'manage', resource: 'members' });

    const request = await this.db
      .select()
      .from(schema.householdJoinRequests)
      .where(
        and(
          eq(schema.householdJoinRequests.id, requestId),
          eq(schema.householdJoinRequests.household_id, householdId)
        )
      )
      .get();

    if (!request) {
      throw new NotFoundError('Join request');
    }
    if (request.status !== 'pending') {
      throw new ConflictError('This request has already been handled');
    }

    const timestamp = now();
    let role: HouseholdRole = 'member';

    if (request.invite_link_id) {
      const link = await this.db
        .select()
        .from(schema.householdInviteLinks)
        .where(eq(schema.householdInviteLinks.id, request.invite_link_id))
        .get();
      if (link) {
        role = link.role as HouseholdRole;
        if (link.max_uses != null && link.use_count >= link.max_uses) {
          throw new ForbiddenError('This invite link has reached its limit');
        }
        await this.db
          .update(schema.householdInviteLinks)
          .set({ use_count: link.use_count + 1 })
          .where(eq(schema.householdInviteLinks.id, link.id));
      }
    }

    // Add or reactivate the member. A previously removed member can submit a
    // new join request, but the household_id+user_id row still exists with
    // deleted_at set — inserting again would violate the unique index.
    const activeMember = await this.getMembership(householdId, request.user_id);
    if (!activeMember) {
      const priorMembership = await this.db
        .select()
        .from(schema.householdMembers)
        .where(
          and(
            eq(schema.householdMembers.household_id, householdId),
            eq(schema.householdMembers.user_id, request.user_id)
          )
        )
        .get();

      if (priorMembership?.deleted_at) {
        await this.db
          .update(schema.householdMembers)
          .set({
            deleted_at: null,
            role,
            invited_by: deciderUserId,
            joined_at: timestamp,
            updated_at: timestamp,
          })
          .where(eq(schema.householdMembers.id, priorMembership.id));
      } else if (!priorMembership) {
        await this.db.insert(schema.householdMembers).values({
          id: generateId(),
          household_id: householdId,
          user_id: request.user_id,
          role,
          invited_by: deciderUserId,
          joined_at: timestamp,
          created_at: timestamp,
          updated_at: timestamp,
        });
      }
    }

    await this.db
      .update(schema.householdJoinRequests)
      .set({ status: 'approved', decided_by: deciderUserId, decided_at: timestamp })
      .where(eq(schema.householdJoinRequests.id, requestId));

    const requester = await this.db
      .select({ display_name: schema.users.display_name, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, request.user_id))
      .get();

    const household = await this.getHousehold(householdId, deciderUserId);

    return {
      household,
      member_user_id: request.user_id,
      requester_name: requester?.display_name || requester?.email || 'A new member',
    };
  }

  /**
   * Deny a pending join request (owners only). Returns who to notify.
   */
  async denyJoinRequest(
    householdId: string,
    requestId: string,
    deciderUserId: string
  ): Promise<{ requester_user_id: string; household_name: string }> {
    await this.requirePermission(householdId, deciderUserId, { action: 'manage', resource: 'members' });

    const request = await this.db
      .select()
      .from(schema.householdJoinRequests)
      .where(
        and(
          eq(schema.householdJoinRequests.id, requestId),
          eq(schema.householdJoinRequests.household_id, householdId)
        )
      )
      .get();

    if (!request) {
      throw new NotFoundError('Join request');
    }
    if (request.status !== 'pending') {
      throw new ConflictError('This request has already been handled');
    }

    await this.db
      .update(schema.householdJoinRequests)
      .set({ status: 'denied', decided_by: deciderUserId, decided_at: now() })
      .where(eq(schema.householdJoinRequests.id, requestId));

    const household = await this.db
      .select({ name: schema.households.name })
      .from(schema.households)
      .where(eq(schema.households.id, householdId))
      .get();

    return { requester_user_id: request.user_id, household_name: household?.name ?? 'a household' };
  }

  /**
   * Resolve an invite link by its raw token OR its short code, applying all
   * validity gates. The `identifier` is whatever the client extracted from the
   * link path — a 64-hex token (`/join/<token>`) or a short code (`/j/<code>`) —
   * and we match either, so callers don't need to know which form it is.
   * Returns the link row or an `{ error }` describing why it's unusable.
   */
  private async getActiveLinkByToken(
    identifier: string
  ): Promise<schema.HouseholdInviteLink | { error: string }> {
    const tokenHash = await hashToken(identifier);
    const link = await this.db
      .select()
      .from(schema.householdInviteLinks)
      .where(
        or(
          eq(schema.householdInviteLinks.token_hash, tokenHash),
          eq(schema.householdInviteLinks.short_code, identifier)
        )
      )
      .get();

    if (!link) {
      return { error: 'Invite link not found or no longer valid' };
    }
    if (link.revoked_at) {
      return { error: 'This invite link has been revoked' };
    }
    if (isExpired(link.expires_at)) {
      return { error: 'This invite link has expired' };
    }
    if (link.max_uses != null && link.use_count >= link.max_uses) {
      return { error: 'This invite link has reached its usage limit' };
    }
    return link;
  }

  /**
   * User IDs of all active owners of a household.
   */
  private async getOwnerUserIds(householdId: string): Promise<string[]> {
    const owners = await this.db
      .select({ user_id: schema.householdMembers.user_id })
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.household_id, householdId),
          eq(schema.householdMembers.role, 'owner'),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .all();
    return owners.map((o) => o.user_id);
  }

  /**
   * Get user's membership in a household
   */
  private async getMembership(
    householdId: string,
    userId: string
  ): Promise<schema.HouseholdMember | null> {
    const result = await this.db
      .select()
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.household_id, householdId),
          eq(schema.householdMembers.user_id, userId),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .get();
    return result ?? null;
  }

  /**
   * Check if user has required permission
   */
  private async requirePermission(
    householdId: string,
    userId: string,
    requiredPermission: Permission
  ): Promise<void> {
    const membership = await this.getMembership(householdId, userId);

    if (!membership) {
      throw new ForbiddenError('Not a member of this household');
    }

    const permissions = ROLE_PERMISSIONS[membership.role as HouseholdRole] || [];
    const hasPermission = permissions.some(
      (p) =>
        p.action === requiredPermission.action &&
        (p.resource === requiredPermission.resource || p.resource === '*')
    );

    if (!hasPermission) {
      throw new ForbiddenError('Insufficient permissions');
    }
  }

  /**
   * Verify user has access to a household (is a member)
   */
  async verifyAccess(householdId: string, userId: string): Promise<void> {
    const membership = await this.getMembership(householdId, userId);
    if (!membership) {
      throw new ForbiddenError('Not a member of this household');
    }
  }
}
