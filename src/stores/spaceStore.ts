import { create } from 'zustand';

import { householdSpacesApi } from '@api/household-spaces';
import type { HouseholdSpace, PresetSpaceTemplate } from '@api/household-spaces';

interface SpaceState {
  spaces: HouseholdSpace[];
  currentSpace: HouseholdSpace | null;
  presetTemplates: PresetSpaceTemplate[];
  isLoading: boolean;
  error: string | null;
}

interface SpaceActions {
  fetchSpaces: (householdId: string) => Promise<HouseholdSpace[]>;
  setSpaces: (spaces: HouseholdSpace[]) => void;
  addSpace: (space: HouseholdSpace) => void;
  updateSpace: (spaceId: string, updates: Partial<HouseholdSpace>) => void;
  removeSpace: (spaceId: string) => void;
  setCurrentSpace: (space: HouseholdSpace | null) => void;
  setPresetTemplates: (templates: PresetSpaceTemplate[]) => void;
  reorderSpaces: (
    spaceOrders: Array<{ space_id: string; display_order: number }>
  ) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState: SpaceState = {
  spaces: [],
  currentSpace: null,
  presetTemplates: [],
  isLoading: false,
  error: null,
};

export const useSpaceStore = create<SpaceState & SpaceActions>((set) => ({
  ...initialState,

  fetchSpaces: async (householdId) => {
    set({ isLoading: true, error: null });
    try {
      const { spaces } = await householdSpacesApi.list(householdId);
      set({ spaces, isLoading: false });
      return spaces;
    } catch (err) {
      set({ error: 'Failed to load spaces', isLoading: false });
      throw err;
    }
  },

  setSpaces: (spaces) => set({ spaces }),

  addSpace: (space) =>
    set((state) => ({
      spaces: [...state.spaces, space].sort(
        (a, b) => a.display_order - b.display_order
      ),
    })),

  updateSpace: (spaceId, updates) =>
    set((state) => ({
      spaces: state.spaces.map((s) =>
        s.id === spaceId ? { ...s, ...updates } : s
      ),
      currentSpace:
        state.currentSpace?.id === spaceId
          ? { ...state.currentSpace, ...updates }
          : state.currentSpace,
    })),

  removeSpace: (spaceId) =>
    set((state) => ({
      spaces: state.spaces.filter((s) => s.id !== spaceId),
      currentSpace:
        state.currentSpace?.id === spaceId ? null : state.currentSpace,
    })),

  setCurrentSpace: (space) => set({ currentSpace: space }),

  setPresetTemplates: (templates) => set({ presetTemplates: templates }),

  reorderSpaces: (spaceOrders) =>
    set((state) => {
      const orderMap = new Map(
        spaceOrders.map((o) => [o.space_id, o.display_order])
      );
      return {
        spaces: state.spaces
          .map((s) => ({
            ...s,
            display_order: orderMap.get(s.id) ?? s.display_order,
          }))
          .sort((a, b) => a.display_order - b.display_order),
      };
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));
