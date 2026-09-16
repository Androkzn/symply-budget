import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

import type { BudgetInsights } from '@api/budget';
import { asyncStorage } from '@services/storage';

/**
 * Client-only Smart Budget state. Server-fetched resources (monthly
 * overview, items, categories) are loaded directly via budgetApi calls in
 * each screen — only UI-only state and an offline insights cache live here,
 * mirroring aihousekeeperStore's lastBriefingPayloadByHid pattern.
 *
 * `selectedYear`/`selectedMonth` are shared by the Home, Planning and
 * Spending tabs (all three render off this one store) and persist across
 * app restarts, so leaving the dashboard on a past/future month and
 * relaunching lands back on that month instead of snapping to today.
 */

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export interface CachedInsights extends BudgetInsights {
  householdId: string;
  period: string; // 'YYYY-MM'
  /**
   * Fingerprint of the month the answer was generated from
   * (`budgetInsightsFingerprint`). The dashboard reuses a cached answer for as
   * long as this still matches the month on screen — that is the whole reason
   * the card no longer regenerates itself while the member reads it.
   */
  inputHash: string;
}

/**
 * Cached months kept across ALL households. Insights are read on the month
 * they belong to, so a handful of recent periods covers every realistic
 * back-and-forth; without a cap this map is written to AsyncStorage forever.
 */
const MAX_CACHED_PERIODS = 12;

/** Cache key — one entry per household AND period (not per household). */
function insightsKey(householdId: string, period: string): string {
  return `${householdId}|${period}`;
}

interface BudgetState {
  selectedYear: number;
  selectedMonth: number;
  activeView: 'dashboard' | 'planned' | 'spendings' | 'savings' | 'pension' | 'wishes' | 'mortgage';
  /** `${householdId}|${period}` → the answer generated for that month. */
  insightsCache: Record<string, CachedInsights>;
  /** Bumped when spendings change so all budget views reload. */
  dataRevision: number;
  /**
   * Households the member changed budget data in since insights were last
   * looked at. Kept as a coarse local-edit signal (and cleared by the
   * dashboard so it stays bounded); it no longer FORCES a regeneration —
   * `CachedInsights.inputHash` decides that, and it decides it correctly for
   * peer syncs and restores too.
   */
  insightsDirtyHids: Record<string, true>;
}

interface BudgetActions {
  setSelectedMonth: (year: number, month: number) => void;
  resetToCurrentMonth: () => void;
  setActiveView: (view: BudgetState['activeView']) => void;
  cacheInsights: (
    householdId: string,
    period: string,
    insights: BudgetInsights,
    inputHash: string,
  ) => void;
  getCachedInsights: (householdId: string, period: string) => CachedInsights | null;
  /** Call after any budget-cap / spending create / edit / delete. */
  markInsightsDirty: (householdId: string) => void;
  /**
   * Bump `dataRevision` alone, without flagging insights stale. Used when a
   * household PEER's change lands via local-first sync: the views must reload,
   * but the change was not made on this device so forcing an insights
   * regeneration here would fire an AI call per incoming op.
   */
  markDirty: () => void;
  clearInsightsDirty: (householdId: string) => void;
  reset: () => void;
}

type BudgetStore = BudgetState & BudgetActions;

function initialBudgetState(): BudgetState {
  const { year, month } = currentYearMonth();
  return {
    selectedYear: year,
    selectedMonth: month,
    activeView: 'dashboard',
    insightsCache: {},
    dataRevision: 0,
    insightsDirtyHids: {},
  };
}

const initialState: BudgetState = initialBudgetState();

export const useBudgetStore = create<BudgetStore>()(
  persist(
    immer<BudgetStore>((set, get) => ({
      ...initialState,

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

      setActiveView: (view) =>
        set((state) => {
          state.activeView = view;
        }),

      cacheInsights: (householdId, period, insights, inputHash) =>
        set((state) => {
          state.insightsCache[insightsKey(householdId, period)] = {
            ...insights,
            householdId,
            period,
            inputHash,
          };
          // Evict the oldest generations once the map outgrows its cap. Sorted
          // by `generatedAt` rather than insertion order so a rehydrated map
          // (object key order is not a timeline) is trimmed sensibly too.
          const keys = Object.keys(state.insightsCache);
          if (keys.length > MAX_CACHED_PERIODS) {
            keys
              .sort(
                (a, b) =>
                  Date.parse(state.insightsCache[a]!.generatedAt ?? '') -
                  Date.parse(state.insightsCache[b]!.generatedAt ?? ''),
              )
              .slice(0, keys.length - MAX_CACHED_PERIODS)
              .forEach((stale) => {
                delete state.insightsCache[stale];
              });
          }
        }),

      getCachedInsights: (householdId, period) =>
        get().insightsCache[insightsKey(householdId, period)] ?? null,

      markInsightsDirty: (householdId) =>
        set((state) => {
          state.insightsDirtyHids[householdId] = true;
          state.dataRevision += 1;
        }),

      markDirty: () =>
        set((state) => {
          state.dataRevision += 1;
        }),

      clearInsightsDirty: (householdId) =>
        set((state) => {
          delete state.insightsDirtyHids[householdId];
        }),

      reset: () =>
        set((state) => {
          const { year, month } = currentYearMonth();
          state.selectedYear = year;
          state.selectedMonth = month;
          state.activeView = 'dashboard';
          state.insightsCache = {};
          state.dataRevision = 0;
          state.insightsDirtyHids = {};
        }),
    })),
    {
      name: 'budget-storage',
      storage: createJSONStorage(() => asyncStorage),
      // v1 replaced the one-entry-per-household insights cache
      // (`lastInsightsByHid`, no input hash) with a period-keyed, fingerprinted
      // one. Old entries can't be scored against a fingerprint, so they are
      // dropped rather than shown as if they were still current.
      version: 1,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version < 1) {
          delete state.lastInsightsByHid;
          state.insightsCache = {};
        }
        return state as unknown as BudgetStore;
      },
      // Home/Planning/Spending's month nav survives a relaunch; `activeView`
      // stays session-only (each of those tabs is its own route, so which one
      // was open isn't meaningful to restore) and neither is the insights
      // dirty-flag bookkeeping, which only matters within a live session.
      partialize: (state) => ({
        insightsCache: state.insightsCache,
        selectedYear: state.selectedYear,
        selectedMonth: state.selectedMonth,
      }),
    }
  )
);
