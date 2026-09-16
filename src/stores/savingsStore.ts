import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

import type { ProjectionMethod } from '@api/savings';
import { asyncStorage } from '@services/storage';

/**
 * Client-only Savings state. Server-fetched resources (overview, income,
 * spending, categories, goals, registered accounts, recurring payments) are
 * loaded directly via `savingsApi` calls in each screen. This store holds UI
 * state and the household-scoped scenario preference, not forecast results.
 *
 * Plan IP3/IP8: no money math, no draft normalization, no member/category
 * resolution here. `dataRevision` is bumped (via `markDirty`) after EVERY
 * income / spending / category / goal / registered / recurring-payment /
 * import-commit mutation so every Savings view refetches its BE view model.
 * Scenario preferences are persisted per household on this device; period and
 * sub-tab remain transient. Scenario changes invalidate every forecast consumer.
 */

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export type SavingsSubTab = 'overview' | 'income' | 'monthly' | 'projection' | 'goals';

interface SavingsState {
  projectionMethods: Record<string, ProjectionMethod>;
  selectedYear: number;
  selectedMonth: number;
  activeSubTab: SavingsSubTab;
  /** Bumped on every savings mutation so all Savings views (and the Budget headroom card) reload. */
  dataRevision: number;
}

interface SavingsActions {
  setProjectionMethod: (householdId: string, method: ProjectionMethod) => void;
  setSelectedMonth: (year: number, month: number) => void;
  resetToCurrentMonth: () => void;
  setActiveSubTab: (tab: SavingsSubTab) => void;
  /** Call after any savings create / edit / delete / apply / import-commit. */
  markDirty: () => void;
  reset: () => void;
}

type SavingsStore = SavingsState & SavingsActions;

function initialSavingsState(): SavingsState {
  const { year, month } = currentYearMonth();
  return {
    selectedYear: year,
    selectedMonth: month,
    activeSubTab: 'overview',
    projectionMethods: {},
    dataRevision: 0,
  };
}

const initialState: SavingsState = initialSavingsState();

export const useSavingsStore = create<SavingsStore>()(
  persist(
    immer<SavingsStore>((set) => ({
      ...initialState,

      setProjectionMethod: (householdId, method) =>
        set((state) => {
          state.projectionMethods[householdId] = method === 'planned_budget' ? 'hybrid' : method;
          state.dataRevision += 1;
        }),

      setSelectedMonth: (year, month) =>
        set((state) => {
          state.selectedYear = year;
          state.selectedMonth = month;
        }),

      resetToCurrentMonth: () =>
        set((state) => {
          const { year, month } = currentYearMonth();
          state.selectedYear = year;
          state.selectedMonth = month;
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
          const { year, month } = currentYearMonth();
          state.selectedYear = year;
          state.selectedMonth = month;
          state.activeSubTab = 'overview';
          state.dataRevision = 0;
        }),
    })),
    {
      name: 'savings-storage',
      storage: createJSONStorage(() => asyncStorage),
      // Keep scenario selection across launches, independently for each household.
      partialize: (state) => ({ projectionMethods: state.projectionMethods }),
    }
  )
);

/** Wait for persisted preferences before the first forecast or preference write. */
export async function getSavedProjectionMethod(householdId: string): Promise<ProjectionMethod> {
  if (!useSavingsStore.persist.hasHydrated()) {
    await new Promise<void>((resolve) => {
      const unsubscribe = useSavingsStore.persist.onFinishHydration(() => {
        unsubscribe();
        resolve();
      });
      if (useSavingsStore.persist.hasHydrated()) {
        unsubscribe();
        resolve();
      }
    });
  }
  const method = useSavingsStore.getState().projectionMethods[householdId];
  return method === 'historical_average' || method === 'trend' || method === 'pessimistic' ? method : 'hybrid';
}
