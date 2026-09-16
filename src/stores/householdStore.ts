import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

import { householdsApi, type Household, type HouseholdMember } from '@api/households';
import { asyncStorage } from '@services/storage';

// Property mode types
export type PropertyMode = 'single' | 'all';

interface HouseholdState {
  households: Household[];
  currentHousehold: Household | null;
  currentHouseholdMembers: HouseholdMember[];
  isLoading: boolean;
  error: string | null;
  // Multi-property mode settings
  propertyMode: PropertyMode;
  showPropertySwitcher: boolean;
}

interface HouseholdActions {
  fetchHouseholds: () => Promise<void>;
  setHouseholds: (households: Household[]) => void;
  addHousehold: (household: Household) => void;
  updateHousehold: (householdId: string, updates: Partial<Household>) => void;
  removeHousehold: (householdId: string) => void;
  setCurrentHousehold: (household: Household | null) => void;
  setCurrentHouseholdMembers: (members: HouseholdMember[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
  // Multi-property mode actions
  setPropertyMode: (mode: PropertyMode) => void;
  setShowPropertySwitcher: (show: boolean) => void;
  togglePropertySwitcher: () => void;
  // Helper to get active household IDs based on mode
  getActiveHouseholdIds: () => string[];
  // Helper to check if an item belongs to active context
  isInActiveContext: (householdId: string) => boolean;
}

type HouseholdStore = HouseholdState & HouseholdActions;

const initialState: HouseholdState = {
  households: [],
  currentHousehold: null,
  currentHouseholdMembers: [],
  isLoading: false,
  error: null,
  propertyMode: 'single',
  showPropertySwitcher: false,
};

export const useHouseholdStore = create<HouseholdStore>()(
  persist(
    immer<HouseholdStore>((set, get) => ({
    ...initialState,

    fetchHouseholds: async () => {
        try {
          set((state) => {
            state.isLoading = true;
            state.error = null;
          });

          // Budget V2 local-first: the on-device engine owns the household set,
          // and D1 has no row for an `hh_local_*` household at all — so the D1
          // list below is not merely redundant here, it is empty.
          {
            const { isBudgetLocalFirst } =
              require('@features/budget/local/flag') as typeof import('@features/budget/local/flag');
            if (isBudgetLocalFirst()) {
              const { ensureBudgetLocalSession, syncHouseholdStoreFromLocalLedger } =
                require('@features/budget/local/ensureSession') as typeof import('@features/budget/local/ensureSession');
              await ensureBudgetLocalSession();
              // Publish through the ONE engine→store publisher (BR-016 B4).
              //
              // This branch used to force `households = [ledger.household]` and
              // `currentHousehold = ledger.household` inline. That was true when
              // a device held exactly one ledger and is a lie now: it hid every
              // other household from the switcher, and — because screens call
              // `fetchHouseholds()` on focus — it deleted a just-created
              // household from the list moments after it appeared. That is the
              // exact failure `budget-households.yaml` and
              // `budget-household-switch.yaml` assert on.
              //
              // Delegating rather than re-deriving the list here is deliberate:
              // `startHouseholdSetWatch` publishes through the same function on
              // every ledger event, and two publishers with two mappings is how
              // a focus and a background op end up showing two different lists.
              // It selects whatever `ACTIVE_META` named, so the household the
              // member was last in survives a relaunch instead of being replaced
              // by "the one that happens to be open".
              syncHouseholdStoreFromLocalLedger();
              // The publisher clears `isLoading` itself, but it no-ops when no
              // session is open — signed out, or auth not yet rehydrated, in
              // which case `ensureBudgetLocalSession` returned without opening
              // one. Leaving the flag set there spins every household screen on
              // a spinner that nothing will ever clear. A no-op `set` under
              // immer produces the identical state object, so this costs no
              // render in the normal case.
              set((state) => {
                state.isLoading = false;
              });
              return;
            }
          }

          const { households } = await householdsApi.list();

          set((state) => {
            state.households = households;
            state.isLoading = false;

            // Update current household if it's in the list
            const currentId = state.currentHousehold?.id;
            if (currentId) {
              const updated = households.find((h) => h.id === currentId);
              if (updated) {
                state.currentHousehold = updated;
              } else {
                // Current household was removed (user was removed from it)
                state.currentHousehold = households.length > 0 ? households[0] : null;
              }
            } else if (households.length > 0 && !state.currentHousehold) {
              // Set first household as current if none selected
              state.currentHousehold = households[0];
            }
          });
        } catch (error) {
          set((state) => {
            state.error = error instanceof Error ? error.message : 'Failed to fetch households';
            state.isLoading = false;
          });
        }
      },

      setHouseholds: (households) =>
        set((state) => {
          state.households = households;
        }),

      addHousehold: (household) =>
        set((state) => {
          state.households.push(household);
        }),

      updateHousehold: (householdId, updates) =>
        set((state) => {
          const index = state.households.findIndex((h) => h.id === householdId);
          if (index !== -1) {
            state.households[index] = { ...state.households[index], ...updates };
          }
          if (state.currentHousehold?.id === householdId) {
            state.currentHousehold = { ...state.currentHousehold, ...updates };
          }
        }),

      removeHousehold: (householdId) =>
        set((state) => {
          state.households = state.households.filter((h) => h.id !== householdId);
          if (state.currentHousehold?.id === householdId) {
            // Mirror fetchHouseholds' fallback — leaving currentHousehold null
            // when another household remains strands every screen that reads
            // it (e.g. MortgageView bails out of loading data) until the next
            // full households refresh.
            state.currentHousehold = state.households.length > 0 ? state.households[0] : null;
            state.currentHouseholdMembers = [];
          }
        }),

      setCurrentHousehold: (household) => {
        // Optimistic first: activation is queued behind the engine's session
        // chain and hydrates the target household's rows on its first visit
        // (34–37 µs/row cold), so waiting for it would leave the tap looking
        // dead for up to a second. The engine's whole-ledger change event
        // republishes over this the moment the switch is real.
        set((state) => {
          state.currentHousehold = household;
        });
        if (!household) return;

        const { isBudgetLocalFirst } =
          require('@features/budget/local/flag') as typeof import('@features/budget/local/flag');
        if (!isBudgetLocalFirst()) return;

        // Under local-first the ENGINE owns which household is active, not this
        // store: the active household is what every op is sealed against and
        // what `localSavingsApi` / `localMortgageApi` / `localBudgetLoansApi`
        // check their `householdId` argument against. Moving the store alone
        // leaves the two disagreeing, and the disagreement is not cosmetic —
        // the header names household B while every domain facade still reads
        // and writes A, or throws a household mismatch and renders empty.
        const {
          activateLocalBudgetHousehold,
          getActiveBudgetHouseholdId,
          isLocalBudgetSessionOpen,
        } = require('@features/budget/local/engine') as typeof import('@features/budget/local/engine');
        // No session yet (signed out, or auth still rehydrating). The persisted
        // selection is all there is until `ensureBudgetLocalSession` opens one
        // and publishes the engine's own answer over it.
        if (!isLocalBudgetSessionOpen()) return;
        // Re-activating the household that is already active is free in the
        // engine but not silent: it rewrites both on-disk pointers and emits a
        // whole-ledger change, repainting every Budget screen. Screens call this
        // from focus effects, so the guard carries real weight.
        if (getActiveBudgetHouseholdId() === household.id) return;

        void activateLocalBudgetHousehold(household.id).catch((error: unknown) => {
          // Realistically only `BudgetLocalUnknownHouseholdError`: a household
          // this store still lists but the engine holds no ledger for — a D1 row
          // from before local-first, or a stale persisted entry that outlived a
          // sign-out. Republishing the engine's set IS the rollback: it drops
          // the phantom from the list and puts `currentHousehold` back on the
          // household the engine is actually writing to, which is the invariant
          // this branch exists to hold. Silently keeping the optimistic value
          // would be the one outcome worse than the failed switch.
          console.warn(
            '[BudgetLocal] activate failed; republishing engine set',
            household.id,
            error
          );
          const { syncHouseholdStoreFromLocalLedger } =
            require('@features/budget/local/ensureSession') as typeof import('@features/budget/local/ensureSession');
          syncHouseholdStoreFromLocalLedger();
        });
      },

      setCurrentHouseholdMembers: (members) =>
        set((state) => {
          state.currentHouseholdMembers = members;
        }),

      setLoading: (loading) =>
        set((state) => {
          state.isLoading = loading;
        }),

      setError: (error) =>
        set((state) => {
          state.error = error;
        }),

      reset: () => set(initialState),

      // Multi-property mode actions
      setPropertyMode: (mode) =>
        set((state) => {
          state.propertyMode = mode;
          // When switching to 'all' mode, hide the switcher
          if (mode === 'all') {
            state.showPropertySwitcher = false;
          }
        }),

      setShowPropertySwitcher: (show) =>
        set((state) => {
          state.showPropertySwitcher = show;
        }),

      togglePropertySwitcher: () =>
        set((state) => {
          state.showPropertySwitcher = !state.showPropertySwitcher;
        }),

      getActiveHouseholdIds: () => {
        const state = get();
        if (state.propertyMode === 'all') {
          return state.households.map((h) => h.id);
        }
        return state.currentHousehold ? [state.currentHousehold.id] : [];
      },

      isInActiveContext: (householdId) => {
        const state = get();
        if (state.propertyMode === 'all') {
          return state.households.some((h) => h.id === householdId);
        }
        return state.currentHousehold?.id === householdId;
      },
    })),
    {
      name: 'household-storage',
      storage: createJSONStorage(() => asyncStorage),
      // The store is otherwise in-memory only, so `currentHousehold` was null on
      // every cold start / JS reload — screens that need a household (Budget
      // chat rooms, dashboards) then dead-ended on their "No household selected"
      // empty state or a stuck loading spinner. Persist the selected household
      // (and the list + property mode) so it survives relaunches; transient
      // isLoading/error are intentionally NOT persisted.
      partialize: (state) => ({
        households: state.households,
        currentHousehold: state.currentHousehold,
        currentHouseholdMembers: state.currentHouseholdMembers,
        propertyMode: state.propertyMode,
      }),
    }
  )
);
