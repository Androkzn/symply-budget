/**
 * Account deletion → household detachment.
 *
 * Deleting an account soft-deletes the `users` row, which on its own leaves
 * every `household_members` row of that user active: the deleted account keeps
 * showing up in the members list of each property, still counts as an owner for
 * permission checks, and still receives member notifications. This module is
 * the one place that severs those ties.
 *
 * Role does not change whether the user is detached — an owner leaves exactly
 * like a member does. It only changes what has to happen to the household the
 * user leaves behind, because the rest of the service layer assumes a household
 * always has at least one active owner (see `leaveHousehold`,
 * `removeMember`, `updateMemberRole`, which all refuse to remove the last one).
 * Account deletion must not become the back door around that invariant, so:
 *
 *   - members left, an owner remains → nothing more to do;
 *   - members left, no owner remains → promote the longest-tenured remaining
 *     member to owner, so the property stays manageable;
 *   - nobody left               → soft-delete the now-empty household.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';

import * as schema from '../db/schema';
import type { Database } from '../types';
import { now } from '../utils/id';

export interface HouseholdDetachSummary {
  /** Households the user was detached from, whatever their role was. */
  detachedHouseholdIds: string[];
  /** Members promoted to owner because the deleted user was the last one. */
  promotedOwners: Array<{ householdId: string; userId: string }>;
  /** Households soft-deleted because the deleted user was their last member. */
  emptiedHouseholdIds: string[];
  /** Pending join requests by this user that were withdrawn. */
  withdrawnJoinRequests: number;
}

/**
 * Remove `userId` from every household they belong to, owner or member alike.
 * Idempotent: a second call for the same user finds no active memberships and
 * does nothing.
 */
export async function detachUserFromAllHouseholds(
  db: Database,
  userId: string
): Promise<HouseholdDetachSummary> {
  const timestamp = now();
  const summary: HouseholdDetachSummary = {
    detachedHouseholdIds: [],
    promotedOwners: [],
    emptiedHouseholdIds: [],
    withdrawnJoinRequests: 0,
  };

  const memberships = await db
    .select({
      id: schema.householdMembers.id,
      household_id: schema.householdMembers.household_id,
      role: schema.householdMembers.role,
    })
    .from(schema.householdMembers)
    .where(
      and(
        eq(schema.householdMembers.user_id, userId),
        isNull(schema.householdMembers.deleted_at)
      )
    )
    .all();

  for (const membership of memberships) {
    await db
      .update(schema.householdMembers)
      .set({ deleted_at: timestamp, updated_at: timestamp })
      .where(eq(schema.householdMembers.id, membership.id));

    summary.detachedHouseholdIds.push(membership.household_id);

    // Ordered oldest-first so "longest-tenured member" is just the first row.
    const remaining = await db
      .select({
        id: schema.householdMembers.id,
        user_id: schema.householdMembers.user_id,
        role: schema.householdMembers.role,
      })
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.household_id, membership.household_id),
          isNull(schema.householdMembers.deleted_at)
        )
      )
      .orderBy(asc(schema.householdMembers.joined_at), asc(schema.householdMembers.id))
      .all();

    if (remaining.length === 0) {
      await db
        .update(schema.households)
        .set({ deleted_at: timestamp, updated_at: timestamp, updated_by: userId })
        .where(
          and(
            eq(schema.households.id, membership.household_id),
            isNull(schema.households.deleted_at)
          )
        );
      summary.emptiedHouseholdIds.push(membership.household_id);
      continue;
    }

    const successor = remaining.find((m) => m.role === 'owner') ? null : remaining[0];
    if (successor) {
      await db
        .update(schema.householdMembers)
        .set({ role: 'owner', updated_at: timestamp })
        .where(eq(schema.householdMembers.id, successor.id));
      summary.promotedOwners.push({
        householdId: membership.household_id,
        userId: successor.user_id,
      });
    }
  }

  // A pending request to join is an inbound tie to a household too: left
  // standing, an owner could approve a deleted account back into their
  // property. Withdraw them rather than leaving them decidable.
  const pending = await db
    .select({ id: schema.householdJoinRequests.id })
    .from(schema.householdJoinRequests)
    .where(
      and(
        eq(schema.householdJoinRequests.user_id, userId),
        eq(schema.householdJoinRequests.status, 'pending')
      )
    )
    .all();

  for (const request of pending) {
    await db
      .update(schema.householdJoinRequests)
      .set({ status: 'denied', decided_at: timestamp })
      .where(eq(schema.householdJoinRequests.id, request.id));
  }
  summary.withdrawnJoinRequests = pending.length;

  return summary;
}
