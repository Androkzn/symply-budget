import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

import type { MortgageListItem } from '@api/mortgage';
import type { MortgageTabId } from '@screens/budget/mortgage/mortgageTabs';
import { asyncStorage } from '@services/storage';

/**
 * Client-only Mortgage UI state. Server-fetched resources (list, summary,
 * schedule, terms) are loaded directly via `mortgageApi` in each screen — only
 * UI-transient state lives here, mirroring `savingsStore`/`budgetStore`.
 *
 * `dataRevision` is bumped (via `markDirty`) after EVERY mortgage mutation
 * (create / update / delete / statement commit / renewal) so every Mortgage
 * view refetches its BE view model. The selected mortgage id, the active
 * sub-tab and the user's custom tab layout are persisted so returning to the
 * tab restores context.
 */

export type MortgageSubTab =
  | 'overview'
  | 'payments'
  | 'equity'
  | 'forecast'
  | 'schedule'
  | 'renewal';

interface MortgageState {
  /** The mortgage currently focused on the dashboard (null → default to active). */
  selectedMortgageId: string | null;
  /**
   * The household's properties, republished by `MortgageView` on every load.
   * The ONLY server data cached here, and for one reason: the header's mortgage
   * switcher renders outside the view that fetches the list, so mirroring it
   * lets the title dropdown label + list itself without a second `list()` call.
   * Transient (never persisted) — a stale list would outlive a delete.
   */
  mortgages: MortgageListItem[];
  activeSubTab: MortgageSubTab;
  /**
   * The user's custom order for the Mortgage strip (`null` → factory order).
   * Holds ids only; `resolveMortgageTabs` reconciles it with the live catalog.
   */
  subTabOrder: MortgageTabId[] | null;
  /** Tabs the user removed from the strip. Never contains the locked tab. */
  hiddenSubTabs: MortgageTabId[];
  /** Bumped on every mortgage mutation so all Mortgage views reload. */
  dataRevision: number;
}

interface MortgageActions {
  setSelectedMortgage: (id: string | null) => void;
  /** Publish the freshly fetched property list for the header switcher. */
  setMortgages: (mortgages: MortgageListItem[]) => void;
  setActiveSubTab: (tab: MortgageSubTab) => void;
  /** Persist a customized strip (order of the shown tabs + the hidden ones). */
  setSubTabLayout: (order: MortgageTabId[], hidden: MortgageTabId[]) => void;
  /** Back to the factory strip — every tab shown, in catalog order. */
  resetSubTabLayout: () => void;
  /** Call after any mortgage create / edit / delete / statement / renewal. */
  markDirty: () => void;
  reset: () => void;
}

type MortgageStore = MortgageState & MortgageActions;

const initialState: MortgageState = {
  selectedMortgageId: null,
  mortgages: [],
  activeSubTab: 'overview',
  subTabOrder: null,
  hiddenSubTabs: [],
  dataRevision: 0,
};

export const useMortgageStore = create<MortgageStore>()(
  persist(
    immer<MortgageStore>((set) => ({
      ...initialState,

      setSelectedMortgage: (id) =>
        set((state) => {
          state.selectedMortgageId = id;
        }),

      setMortgages: (mortgages) =>
        set((state) => {
          state.mortgages = mortgages;
        }),

      setActiveSubTab: (tab) =>
        set((state) => {
          state.activeSubTab = tab;
        }),

      setSubTabLayout: (order, hidden) =>
        set((state) => {
          state.subTabOrder = order;
          state.hiddenSubTabs = hidden;
        }),

      resetSubTabLayout: () =>
        set((state) => {
          state.subTabOrder = null;
          state.hiddenSubTabs = [];
        }),

      markDirty: () =>
        set((state) => {
          state.dataRevision += 1;
        }),

      reset: () =>
        set((state) => {
          state.selectedMortgageId = null;
          state.mortgages = [];
          state.activeSubTab = 'overview';
          state.subTabOrder = null;
          state.hiddenSubTabs = [];
          state.dataRevision = 0;
        }),
    })),
    {
      name: 'mortgage-storage',
      storage: createJSONStorage(() => asyncStorage),
      // Persist which mortgage + tab the user was on and their strip layout;
      // dataRevision is transient.
      partialize: (state) => ({
        selectedMortgageId: state.selectedMortgageId,
        activeSubTab: state.activeSubTab,
        subTabOrder: state.subTabOrder,
        hiddenSubTabs: state.hiddenSubTabs,
      }),
    }
  )
);
