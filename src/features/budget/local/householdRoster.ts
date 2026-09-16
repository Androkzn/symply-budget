/**
 * The people in a local-first Budget household — by name and face, not by id.
 *
 * Budget V2 keeps the budget on the device, so nothing about a household lives
 * in D1 except identity: who is a member, which devices they hold, and what
 * they are called. Everything else on the client used to read
 * `householdStore.currentHouseholdMembers`, which under local-first held EXACTLY
 * ONE row — this device's own account, seeded by `ensureSession`. The result was
 * visible everywhere a peer had to be named:
 *
 *  - the pension member switcher offered "Household member" for anyone who was
 *    not you (`pensionScope.pensionMemberOptions`);
 *  - the savings member map fell back to the literal "Member";
 *  - no surface anywhere showed a peer's avatar, because no roster carried one.
 *
 * This module is the missing half: it turns control-plane state — which now
 * carries each member's display name and avatar (see
 * `backend/src/services/local-first-control-service.ts`) — into the same
 * `HouseholdMember[]` shape the rest of the app already renders, and publishes
 * it into the store every existing consumer reads. No screen has to learn a new
 * type; they simply stop seeing one row.
 *
 * **The id is the user id, and that is load-bearing.** A local ledger's
 * `memberId` IS the user id (`engine.ts` — `memberId: input.userId`), and every
 * savings / pension row is stamped with it. `ensureSession` used to seed the
 * roster with `mem_<uid>`, which matched nothing: the row was in the list and
 * still nothing resolved to a name. Keying on the user id is what makes the
 * roster line up with the ledger's own rows.
 *
 * **BR-016: one roster per household, not one roster.** This module used to
 * hold exactly one, because the device used to hold exactly one household, and
 * `publishBudgetRoster` DISCARDED any control-plane answer whose household was
 * not the active one. That guard was right when "not active" meant "not ours";
 * with a session registry it means "the background sync for household B", which
 * is the only trip that ever fetches B's members — so B's roster was thrown
 * away every single time and B's member list was empty for as long as B was not
 * the household on screen. The answer is to KEEP each household's roster under
 * its own key and mirror only the active one into `householdStore`, which is
 * still a single-household surface. Nothing may ever be published across
 * households: A's names under B read, on screen, exactly like B's members.
 */
import type { HouseholdMember } from '@api/households';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';

import { fetchControlPlaneState, type ControlPlaneState } from './controlPlaneClient';
import { getLocalLedger, isLocalBudgetSessionOpen } from './engine';
import { isBudgetLocalFirst } from './flag';

/**
 * What to call someone when the roster has a row for them.
 *
 * Ordered by how much the member chose it: their own display name, then the
 * local part of their address (`ada@example.com` → `ada`, which people do
 * recognise each other by), then a neutral noun. Never an opaque id — a name
 * nobody can read is worse than an honest "Household member".
 */
export function budgetMemberName(
  member: Pick<HouseholdMember, 'display_name' | 'email'> | null | undefined,
  fallback = 'Household member',
): string {
  const name = member?.display_name?.trim();
  if (name) return name;
  const email = member?.email?.trim();
  if (email) {
    const local = email.split('@')[0]?.trim();
    if (local) return local;
  }
  return fallback;
}

/** V2 roles (`OWNER` / `ADULT` / …) mapped onto the shared two-role shape. */
function toLegacyRole(role: string | null | undefined): 'owner' | 'member' {
  return (role ?? '').toUpperCase() === 'OWNER' ? 'owner' : 'member';
}

/**
 * Coordinator state → the roster the app renders.
 *
 * Revoked members are dropped: they cannot read the household any more, and a
 * greyed-out row in a member list reads as "still here". Revoked DEVICES are a
 * different question and stay on the Device Sync screen, which is about copies
 * of the budget rather than about people.
 */
export function buildBudgetRoster(
  state: ControlPlaneState,
  options?: { fallbackJoinedAt?: string },
): HouseholdMember[] {
  // A member joins by enrolling a device, and the membership record carries no
  // timestamp of its own — so the earliest device this person enrolled is the
  // closest honest answer to "since when".
  const earliestEnrolment = new Map<string, string>();
  for (const device of state.devices ?? []) {
    const at = device.enrolledAt;
    if (!at) continue;
    const current = earliestEnrolment.get(device.userId);
    if (!current || at < current) earliestEnrolment.set(device.userId, at);
  }

  const fallbackJoinedAt = options?.fallbackJoinedAt ?? new Date(0).toISOString();

  return (state.members ?? [])
    .filter((member) => member.status === 'active')
    .map((member) => ({
      // The ledger's member id — see the file header. NOT a synthesised one.
      id: member.userId,
      user_id: member.userId,
      display_name: member.displayName ?? null,
      avatar_url: member.avatarUrl ?? null,
      email: member.email ?? '',
      role: toLegacyRole(member.role),
      joined_at: earliestEnrolment.get(member.userId) ?? fallbackJoinedAt,
    }));
}

/** Owner first, then everyone else by name — a stable order across refreshes. */
export function sortBudgetRoster(members: HouseholdMember[]): HouseholdMember[] {
  return [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
    return budgetMemberName(a).localeCompare(budgetMemberName(b));
  });
}

/**
 * Every household's last known roster, keyed by household id.
 *
 * In-memory only, and deliberately: a roster is a projection of control-plane
 * state that any sync re-fetches for free, and persisting it would add a second
 * place for a stale name to survive a member being revoked.
 */
const rostersByHousehold = new Map<string, HouseholdMember[]>();

/**
 * The household whose members the screens are currently showing.
 *
 * Read off the active ledger rather than through `getActiveBudgetHouseholdId()`:
 * it is the same id by construction — the active session's ledger IS the active
 * household — and this path needs that ledger anyway for `created_at`, so one
 * accessor answers both questions and the two can never disagree.
 */
function activeBudgetHouseholdId(): string | null {
  return isLocalBudgetSessionOpen() ? getLocalLedger().household.id : null;
}

/**
 * The roster this device already knows for one household, without a fetch.
 *
 * The active household falls back to `householdStore` because that is where the
 * self-row seed lands (`ensureSession.syncHouseholdStoreFromLocalLedger`) — a
 * roster that was never published through here but is nonetheless on screen,
 * and must count as "populated" for the empty-answer guard below.
 */
export function getBudgetRoster(householdId: string | null): HouseholdMember[] {
  const cached = householdId ? rostersByHousehold.get(householdId) : undefined;
  if (cached) return cached;
  if (householdId !== null && householdId !== activeBudgetHouseholdId()) return [];
  return useHouseholdStore.getState().currentHouseholdMembers ?? [];
}

/**
 * Record a fetched state as one household's roster, and mirror it into the
 * store every member-facing screen reads when that household is the active one.
 *
 * A background sync for B lands under B and a switch that raced a fetch cannot
 * cross-contaminate: only the household currently on screen is ever written to
 * `householdStore`, which is still a one-member-list surface. Callers that
 * fetched about a specific household should NAME it — `state.householdId` is a
 * server field, and if an older Worker ever answers without it, attributing a
 * background household's members to the active one is precisely the bleed this
 * guards against.
 *
 * Never publishes an EMPTY roster over a populated one. A control plane that
 * answers with no members is either mid-bootstrap or answering about a
 * household this device has not registered yet, and blanking the list on that
 * would make peers flicker out of the pension switcher on every transient
 * hiccup — which is indistinguishable, on screen, from someone having left.
 */
export function publishBudgetRoster(
  state: ControlPlaneState,
  forHouseholdId?: string,
): HouseholdMember[] {
  const activeId = activeBudgetHouseholdId();
  // The caller's id wins: it asked the question, so it knows whose answer this
  // is. An unattributable answer is treated as being about the active household
  // — the pre-BR-016 behaviour, and the only household a caller without an id
  // can mean.
  const householdId = forHouseholdId || state.householdId || activeId;
  const isActive = householdId !== null && householdId === activeId;

  const roster = sortBudgetRoster(
    buildBudgetRoster(state, {
      // `created_at` is only reachable for the active household without
      // hydrating one, and joined_at is a display detail — not worth paying a
      // cold open (34–37 µs/row) on a background household to refine.
      ...(isActive ? { fallbackJoinedAt: getLocalLedger().household.created_at } : {}),
    }),
  );

  const existing = getBudgetRoster(householdId);
  if (roster.length === 0 && existing.length > 0) return existing;

  if (householdId) rostersByHousehold.set(householdId, roster);
  if (isActive) useHouseholdStore.getState().setCurrentHouseholdMembers(roster);
  return roster;
}

/**
 * Point `householdStore` at the roster of whichever household is now active.
 *
 * Called after a switch: the store still holds the household the member just
 * left, and leaving it there would put A's names under B's data until B's next
 * sync answers — the one form of cross-household bleed a user can actually see.
 * Falls back to the self row rather than to an empty list, so the switch lands
 * on "just you" (true, and momentary) instead of on a blank member list.
 */
export function republishActiveBudgetRoster(): HouseholdMember[] {
  const activeId = activeBudgetHouseholdId();
  if (!activeId) return [];
  const roster = rostersByHousehold.get(activeId) ?? selfBudgetRoster();
  useHouseholdStore.getState().setCurrentHouseholdMembers(roster);
  return roster;
}

/**
 * Drop one household's roster — for the remove path, which is the only one that
 * ends a membership. Keeping it would let a household the device no longer
 * holds answer `getBudgetRoster` after a re-join under the same id.
 */
export function forgetBudgetRoster(householdId: string): void {
  rostersByHousehold.delete(householdId);
}

/** Drop every roster. Sign-out: names from one account must not outlive it. */
export function resetBudgetRosters(): void {
  rostersByHousehold.clear();
}

/**
 * The roster for this device's own account, before the control plane answers.
 *
 * Used on a cold, offline start so the member list is never empty — you are
 * always in your own household, and the app already knows your name and avatar
 * from the auth store.
 */
export function selfBudgetRoster(): HouseholdMember[] {
  const { user } = useAuthStore.getState();
  if (!user?.id || !isLocalBudgetSessionOpen()) return [];
  const ledger = getLocalLedger();
  return [
    {
      id: ledger.memberId,
      user_id: user.id,
      display_name: user.display_name ?? null,
      avatar_url: user.avatar_url ?? null,
      email: user.email,
      // Still a constant, and deliberately not `ledger.household.my_role`.
      // Reading the ledger looks more honest and is not: the value goes stale —
      // observed 2026-08-19 on a device the control plane called OWNER of the
      // household its own ledger recorded as 'member' — so badging from it
      // labelled somebody a Member of the budget they own, for the length of
      // one roster fetch. The case this was reaching for, a household CLAIMED
      // but not yet joined, never reaches this seed any more: the members card
      // holds the list back entirely while enrolment is pending, because such a
      // household has no roster this device is entitled to read.
      role: 'owner',
      joined_at: ledger.household.created_at,
    },
  ];
}

/**
 * Pull one household's roster from the control plane and publish it.
 * Offline-safe. Defaults to the active household, which is what every UI
 * trigger means; a caller that has a household in hand (a switcher row, a
 * background refresh) names it and gets that one instead.
 *
 * Returns whatever this device ends up knowing for that household, so a caller
 * can render the result without a second read. Failures are silent by design:
 * this is a display concern, and a household that cannot reach the network
 * keeps showing the last roster it knew rather than emptying itself.
 */
export async function refreshBudgetHouseholdRoster(
  householdId?: string,
): Promise<HouseholdMember[]> {
  const target = householdId ?? activeBudgetHouseholdId();
  if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen() || !target) {
    return getBudgetRoster(target);
  }
  try {
    return publishBudgetRoster(await fetchControlPlaneState(target), target);
  } catch (error) {
    console.warn('[BudgetLocal] roster refresh skipped', target, error);
    return getBudgetRoster(target);
  }
}
