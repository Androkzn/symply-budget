/**
 * The people in a local-first House property — by name and face, not by id.
 *
 * House V2 keeps the home on the device, so nothing about a property lives in
 * D1 except identity: who is a member, which devices they hold, and what they
 * are called. Everything else on the client read
 * `householdStore.currentHouseholdMembers`, which under local-first held EXACTLY
 * ONE row — this device's own account, seeded by `ensureSession` — so every
 * surface that had to name a peer said "Household member", and no surface
 * anywhere showed a peer's avatar.
 *
 * This module is the missing half: it turns control-plane state — which carries
 * each member's display name and avatar (see
 * `backend/src/services/local-first-control-service.ts`) — into the same
 * `HouseholdMember[]` shape the rest of the app already renders, and publishes
 * it into the store every existing consumer reads. No screen has to learn a new
 * type; they simply stop seeing one row.
 *
 * **The id is the user id, and that is load-bearing.** A local ledger's
 * `memberId` IS the user id (`engine.ts` — `memberId: input.userId`), and every
 * task / project row is stamped with it. A roster keyed on `mem_<uid>` matches
 * nothing: the row is in the list and still nothing resolves to a name.
 *
 * **One roster per property, not one roster.** A device holds several
 * properties, and the only trip that ever fetches property B's members is B's
 * background sync — so discarding any answer whose household is not the active
 * one throws B's roster away every single time. Each property's roster is kept
 * under its own key and only the active one is mirrored into `householdStore`,
 * which is still a single-property surface. Nothing may ever be published across
 * properties: A's names under B read, on screen, exactly like B's members.
 */
import type { HouseholdMember } from '@api/households';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';

// TYPE-ONLY, deliberately. `import type` is erased by the compiler, so it
// creates no runtime edge and cannot participate in a require cycle. The VALUE
// import that used to sit here (`fetchControlPlaneState`) closed one:
//
//   controlPlaneClient → ensureSession → householdRoster → controlPlaneClient
//
// which Metro warned about on every launch. A cycle is not itself fatal, but
// this one is entered from `authStore`'s module-initialisation path
// (`authStore.ts` dynamically imports `ensureSession` in its hydrate `finally`),
// and `householdRoster` reads `useAuthStore.getState()` — so the re-entry
// landed on an `authStore` that had not finished binding `useAuthStore` yet and
// threw `ReferenceError: Property 'useAuthStore' doesn't exist`, taking House's
// cold-start session open with it. Budget survives the structurally identical
// cycle only by evaluation order, which is luck, not design.
//
// The one value this module needs is now required lazily at its single call
// site — the rule `localApiProxy.ts` already states for the same reason.
import type { ControlPlaneState } from './controlPlaneClient';
import { getLocalHouseLedger, isLocalHouseSessionOpen } from './engine';
import { isHouseLocalFirst } from './flag';

/**
 * What to call someone when the roster has a row for them.
 *
 * Ordered by how much the member chose it: their own display name, then the
 * local part of their address (`ada@example.com` → `ada`, which people do
 * recognise each other by), then a neutral noun. Never an opaque id — a name
 * nobody can read is worse than an honest "Home member".
 */
export function houseMemberName(
  member: Pick<HouseholdMember, 'display_name' | 'email'> | null | undefined,
  fallback = 'Home member',
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
 * Revoked members are dropped: they cannot read the home any more, and a
 * greyed-out row in a member list reads as "still here". Revoked DEVICES are a
 * different question and stay on the Device sync screen, which is about copies
 * of the home rather than about people.
 */
export function buildHouseRoster(
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
export function sortHouseRoster(members: HouseholdMember[]): HouseholdMember[] {
  return [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
    return houseMemberName(a).localeCompare(houseMemberName(b));
  });
}

/**
 * Every property's last known roster, keyed by household id.
 *
 * In-memory only, and deliberately: a roster is a projection of control-plane
 * state that any sync re-fetches for free, and persisting it would add a second
 * place for a stale name to survive a member being revoked.
 */
const rostersByHousehold = new Map<string, HouseholdMember[]>();

/**
 * The property whose members the screens are currently showing.
 *
 * Read off the active ledger rather than through `getActiveHouseholdId()`: it is
 * the same id by construction — the active session's ledger IS the active
 * property — and this path needs that ledger anyway for `created_at`, so one
 * accessor answers both questions and the two can never disagree.
 */
function activeHouseHouseholdId(): string | null {
  return isLocalHouseSessionOpen() ? getLocalHouseLedger().household.id : null;
}

/**
 * The roster this device already knows for one property, without a fetch.
 *
 * The active property falls back to `householdStore` because that is where the
 * self-row seed lands (`ensureSession.syncHouseholdStoreFromLocalLedger`) — a
 * roster that was never published through here but is nonetheless on screen,
 * and must count as "populated" for the empty-answer guard below.
 */
export function getHouseRoster(householdId: string | null): HouseholdMember[] {
  const cached = householdId ? rostersByHousehold.get(householdId) : undefined;
  if (cached) return cached;
  if (householdId !== null && householdId !== activeHouseHouseholdId()) return [];
  return useHouseholdStore.getState().currentHouseholdMembers ?? [];
}

/**
 * Record a fetched state as one property's roster, and mirror it into the store
 * every member-facing screen reads when that property is the active one.
 *
 * A background sync for B lands under B and a switch that raced a fetch cannot
 * cross-contaminate: only the property currently on screen is ever written to
 * `householdStore`, which is still a one-member-list surface. Callers that
 * fetched about a specific property should NAME it — `state.householdId` is a
 * server field, and if an older Worker ever answers without it, attributing a
 * background property's members to the active one is precisely the bleed this
 * guards against.
 *
 * Never publishes an EMPTY roster over a populated one. A control plane that
 * answers with no members is either mid-bootstrap or answering about a property
 * this device has not registered yet, and blanking the list on that would make
 * peers flicker out of every assignee picker on a transient hiccup — which is
 * indistinguishable, on screen, from someone having left.
 */
export function publishHouseRoster(
  state: ControlPlaneState,
  forHouseholdId?: string,
): HouseholdMember[] {
  const activeId = activeHouseHouseholdId();
  // The caller's id wins: it asked the question, so it knows whose answer this
  // is. An unattributable answer is treated as being about the active property
  // — the only one a caller without an id can mean.
  const householdId = forHouseholdId || state.householdId || activeId;
  const isActive = householdId !== null && householdId === activeId;

  const roster = sortHouseRoster(
    buildHouseRoster(state, {
      // `created_at` is only reachable for the active property without
      // hydrating one, and `joined_at` is a display detail — not worth paying a
      // cold open on a background property to refine.
      ...(isActive ? { fallbackJoinedAt: getLocalHouseLedger().household.created_at } : {}),
    }),
  );

  const existing = getHouseRoster(householdId);
  if (roster.length === 0 && existing.length > 0) return existing;

  if (householdId) rostersByHousehold.set(householdId, roster);
  if (isActive) useHouseholdStore.getState().setCurrentHouseholdMembers(roster);
  return roster;
}

/**
 * Point `householdStore` at the roster of whichever property is now active.
 *
 * Called after a switch: the store still holds the property the member just
 * left, and leaving it there would put A's names under B's data until B's next
 * sync answers — the one form of cross-property bleed a user can actually see.
 * Falls back to the self row rather than to an empty list, so the switch lands
 * on "just you" (true, and momentary) instead of on a blank member list.
 */
export function republishActiveHouseRoster(): HouseholdMember[] {
  const activeId = activeHouseHouseholdId();
  if (!activeId) return [];
  const roster = rostersByHousehold.get(activeId) ?? selfHouseRoster();
  useHouseholdStore.getState().setCurrentHouseholdMembers(roster);
  return roster;
}

/**
 * Drop one property's roster — for the remove path, which is the only one that
 * ends a membership. Keeping it would let a property the device no longer holds
 * answer `getHouseRoster` after a re-join under the same id.
 */
export function forgetHouseRoster(householdId: string): void {
  rostersByHousehold.delete(householdId);
}

/** Drop every roster. Sign-out: names from one account must not outlive it. */
export function resetHouseRosters(): void {
  rostersByHousehold.clear();
}

/**
 * The roster for this device's own account, before the control plane answers.
 *
 * Used on a cold, offline start so the member list is never empty — you are
 * always in your own home, and the app already knows your name and avatar from
 * the auth store.
 */
export function selfHouseRoster(): HouseholdMember[] {
  const { user } = useAuthStore.getState();
  if (!user?.id || !isLocalHouseSessionOpen()) return [];
  const ledger = getLocalHouseLedger();
  return [
    {
      id: ledger.memberId,
      user_id: user.id,
      display_name: user.display_name ?? null,
      avatar_url: user.avatar_url ?? null,
      email: user.email,
      // A constant, and deliberately not `ledger.household.my_role`: reading the
      // ledger looks more honest and is not, because that value goes stale and
      // would badge somebody a Member of the home they own for the length of one
      // roster fetch. The case this reaches for — a property CLAIMED but not yet
      // joined — never gets here: the members card holds the list back entirely
      // while enrolment is pending, because such a property has no roster this
      // device is entitled to read.
      role: 'owner',
      joined_at: ledger.household.created_at,
    },
  ];
}

/**
 * Pull one property's roster from the control plane and publish it.
 *
 * Offline-safe. Defaults to the active property, which is what every UI trigger
 * means; a caller that has a property in hand (a switcher row, a background
 * refresh) names it and gets that one instead.
 *
 * Returns whatever this device ends up knowing for that property, so a caller
 * can render the result without a second read. Failures are silent by design:
 * this is a display concern, and a property that cannot reach the network keeps
 * showing the last roster it knew rather than emptying itself.
 */
export async function refreshHouseHouseholdRoster(
  householdId?: string,
): Promise<HouseholdMember[]> {
  const target = householdId ?? activeHouseHouseholdId();
  if (!isHouseLocalFirst() || !isLocalHouseSessionOpen() || !target) {
    return getHouseRoster(target ?? null);
  }
  try {
    // Narrow, lazy require — see the import block at the top of this file. By
    // the time this runs, module initialisation is long finished, so the edge
    // costs nothing and closes no cycle.
     
    const { fetchControlPlaneState } =
      require('./controlPlaneClient') as typeof import('./controlPlaneClient');
    return publishHouseRoster(await fetchControlPlaneState(target), target);
  } catch (error) {
    console.warn('[HouseLocal] roster refresh skipped', target, error);
    return getHouseRoster(target);
  }
}
