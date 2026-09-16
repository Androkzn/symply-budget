import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

import type { PensionGroupIdentity } from '@screens/budget/pension/pensionScope';
import { asyncStorage } from '@services/storage';

/**
 * Client-only Pension-tab state. Mirrors `savingsStore`: server-fetched resources
 * (the registered-account overview, per-account room + goals) are loaded directly
 * via `savingsApi` in each sub-view — only UI-transient state lives here.
 *
 * Pension is an ANNUAL view (contribution room and goals are per tax year), so this
 * store tracks a `selectedYear` (no month). `dataRevision` is bumped via `markDirty`
 * after every account / transaction / import mutation so all Pension sub-views
 * refetch their BE view models. Nothing is persisted (year/sub-tab are transient).
 */

// 'accounts' is retained (PensionAccountsView code is kept) but intentionally NOT shown
// as a tab — the simple flow (Room/Goals/Contributions) has no account setup.
export type PensionSubTab = 'room' | 'goals' | 'contributions' | 'accounts';

interface PensionState {
  selectedYear: number;
  /**
   * Whose pension is on screen — a `household_members.id`, or `null` for
   * "Everyone" (every member's rows, which is what the tab always showed).
   *
   * Contribution room is PERSONAL — it accrues to an individual, penalties are
   * assessed per person and spouses cannot pool it — so this scopes the rows
   * shown and never sums across members. `null` stays the default so nothing is
   * hidden until the user opts into a member, including rows whose `member_id`
   * was cleared when a member left the household.
   */
  selectedMemberId: string | null;
  /**
   * Member identities seen in the last loaded overview, published by whichever
   * sub-view fetched it. The header's member switcher needs them because the
   * household roster alone is not enough: a local-first ledger holds only this
   * device's member, so peers are known only by the ids on their rows.
   */
  memberGroups: PensionGroupIdentity[];
  activeSubTab: PensionSubTab;
  dataRevision: number;
}

interface PensionActions {
  setSelectedYear: (year: number) => void;
  /** `null` = every member (the default scope). */
  setSelectedMember: (memberId: string | null) => void;
  /** Called by each sub-view after it loads an overview. No-ops when unchanged. */
  setMemberGroups: (groups: PensionGroupIdentity[]) => void;
  setActiveSubTab: (tab: PensionSubTab) => void;
  /** Call after any account / transaction / import-commit mutation. */
  markDirty: () => void;
  reset: () => void;
}

type PensionStore = PensionState & PensionActions;

function initialPensionState(): PensionState {
  return {
    selectedYear: new Date().getFullYear(),
    selectedMemberId: null,
    memberGroups: [],
    activeSubTab: 'room',
    dataRevision: 0,
  };
}

/** Same members, same order → skip the write so publishing can't loop renders. */
function sameGroups(a: PensionGroupIdentity[], b: PensionGroupIdentity[]): boolean {
  return (
    a.length === b.length && a.every((g, i) => g.id === b[i].id && g.name === b[i].name)
  );
}

const initialState: PensionState = initialPensionState();

export const usePensionStore = create<PensionStore>()(
  persist(
    immer<PensionStore>((set) => ({
      ...initialState,

      setSelectedYear: (year) =>
        set((state) => {
          state.selectedYear = year;
        }),

      setSelectedMember: (memberId) =>
        set((state) => {
          state.selectedMemberId = memberId;
        }),

      // Deliberately does NOT touch `selectedMemberId`: a member with no rows in
      // the selected year is still a valid scope (an empty list under their name
      // is the honest answer). Only the switcher, which also sees the household
      // roster, can tell a row-less member from one who is gone entirely.
      setMemberGroups: (groups) =>
        set((state) => {
          if (sameGroups(state.memberGroups, groups)) return;
          state.memberGroups = groups;
        }),

      setActiveSubTab: (tab) =>
        set((state) => {
          state.activeSubTab = tab;
        }),

      markDirty: () =>
        set((state) => {
          state.dataRevision += 1;
        }),

      reset: () =>
        set((state) => {
          state.selectedYear = new Date().getFullYear();
          state.selectedMemberId = null;
          state.memberGroups = [];
          state.activeSubTab = 'room';
          state.dataRevision = 0;
        }),
    })),
    {
      name: 'pension-storage',
      storage: createJSONStorage(() => asyncStorage),
      // Nothing UI-transient is persisted (matches savingsStore).
      partialize: () => ({}),
    }
  )
);
