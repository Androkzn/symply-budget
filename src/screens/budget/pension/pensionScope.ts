import type { HouseholdMember } from '@api/households';
import type { PensionAccountSummary, PensionOverview } from '@api/savings';

/**
 * One account row, flattened out of the BE's per-member groups and carrying the
 * member identity the groups held.
 */
export interface PensionLine extends PensionAccountSummary {
  memberId: string | null;
  memberAvatarUrl: string | null;
}

/**
 * Flattens `PensionOverview.groups` to rows, scoped to one member.
 *
 * `memberId === null` means "Everyone" — every row, which is what the Pension
 * tab showed before it had a scope. Contribution room is personal (it accrues
 * to an individual and can't be pooled between spouses), so scoping FILTERS
 * rows; nothing here ever sums across members.
 *
 * Rows whose `member_id` is null (the column is `on delete set null`, so a
 * departed member leaves its accounts behind) belong to no member and are
 * therefore only reachable under "Everyone" — which is why that is the default
 * scope, and why callers must not silently treat a missing member as a match.
 */
export function pensionLines(
  overview: PensionOverview | null | undefined,
  memberId: string | null,
): PensionLine[] {
  return (overview?.groups ?? [])
    .filter((group) => memberId === null || group.memberId === memberId)
    .flatMap((group) =>
      group.accounts.map((account) => ({
        ...account,
        // The group is the authority on identity: an account summary's own
        // `memberName` is a denormalized copy.
        memberName: group.memberName,
        memberId: group.memberId,
        memberAvatarUrl: group.memberAvatarUrl,
      })),
    );
}

/** One switchable scope: a household member who can hold pension rows. */
export interface PensionMemberOption {
  id: string;
  label: string;
}

/** Identity of a member seen in the overview, as the sub-views publish it. */
export interface PensionGroupIdentity {
  id: string | null;
  name: string | null;
}

/**
 * The member identities in a loaded overview, for the store to publish to the
 * header's switcher — so it offers exactly the people whose rows the list can
 * show. Every sub-view publishes after its own load; the store drops an
 * unchanged list, so whichever tab is open keeps the header current without
 * re-render churn.
 */
export function pensionMemberIdentities(
  overview: PensionOverview | null | undefined,
): PensionGroupIdentity[] {
  return (overview?.groups ?? []).map((group) => ({
    id: group.memberId,
    name: group.memberName,
  }));
}

/**
 * The members the Pension tab can scope to, newest source of truth first.
 *
 * Two rosters have to be merged because neither is complete on its own:
 *
 * - `roster` (the household store) names everyone, including members who have
 *   no pension rows yet — but it is EMPTY on a local-first budget except for
 *   this device's own member.
 * - `groups` (what the overview actually returned) covers everyone who holds
 *   rows, including peers a local-first ledger knows only by id, since the
 *   local projector returns `memberName: null` for every group.
 *
 * A group whose `memberId` is null is not a person — it is a row whose member
 * was cleared — so it is never offered as a scope; those rows stay reachable
 * under "Everyone".
 */
export function pensionMemberOptions(
  groups: PensionGroupIdentity[] | undefined,
  roster: HouseholdMember[] | undefined,
  localMemberId: string | null,
): PensionMemberOption[] {
  const options = new Map<string, PensionMemberOption>();

  // Both sources are persisted store slices, so a payload written before either
  // field existed rehydrates them as undefined.
  for (const member of roster ?? []) {
    options.set(member.id, {
      id: member.id,
      label: member.display_name?.trim() || member.email,
    });
  }

  for (const group of groups ?? []) {
    if (group.id === null || options.has(group.id)) continue;
    options.set(group.id, {
      id: group.id,
      // A peer a local-first ledger has never been told the name of: it is at
      // least worth saying which one is you.
      label: group.name?.trim() || (group.id === localMemberId ? 'You' : 'Household member'),
    });
  }

  return [...options.values()];
}

/**
 * Label for the current scope — the member's name, or `Everyone`.
 *
 * Falls back to `Everyone` for a member id that is no longer selectable (they
 * left the household while the tab was scoped to them), so the header can never
 * show a blank title.
 */
export function pensionScopeLabel(
  options: PensionMemberOption[],
  memberId: string | null,
): string {
  if (memberId === null) return 'Everyone';
  return options.find((o) => o.id === memberId)?.label ?? 'Everyone';
}

/**
 * True when the member name still has to be shown on each row — i.e. the rows
 * on screen can belong to different people. Scoped to one member, the name is
 * repeated on every row and only adds noise.
 */
export function showsMemberOnRows(memberId: string | null): boolean {
  return memberId === null;
}
