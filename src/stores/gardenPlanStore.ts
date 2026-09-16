import { create } from 'zustand';

import type { GardenPlan, GardenPlanMarker } from '@api/garden-plans';

type MarkersUpdater = GardenPlanMarker[] | ((prev: GardenPlanMarker[]) => GardenPlanMarker[]);

interface GardenPlanStore {
  gardenPlans: GardenPlan[];
  currentGardenPlan: GardenPlan | null;
  markers: GardenPlanMarker[];
  isLoading: boolean;
  uploadProgress: number;

  setGardenPlans: (plans: GardenPlan[]) => void;
  addGardenPlan: (plan: GardenPlan) => void;
  updateGardenPlan: (id: string, updates: Partial<GardenPlan>) => void;
  removeGardenPlan: (id: string) => void;
  setCurrentGardenPlan: (plan: GardenPlan | null) => void;
  setMarkers: (markersOrUpdater: MarkersUpdater) => void;
  addMarker: (marker: GardenPlanMarker) => void;
  updateMarker: (markerId: string, updates: Partial<GardenPlanMarker>) => void;
  removeMarker: (markerId: string) => void;
  setLoading: (isLoading: boolean) => void;
  setUploadProgress: (progress: number) => void;
  reset: () => void;
}

const initialState = {
  gardenPlans: [],
  currentGardenPlan: null,
  markers: [],
  isLoading: false,
  uploadProgress: 0,
};

export const useGardenPlanStore = create<GardenPlanStore>((set) => ({
  ...initialState,

  setGardenPlans: (gardenPlans) => set({ gardenPlans }),

  addGardenPlan: (plan) => set((state) => ({ gardenPlans: [plan, ...state.gardenPlans] })),

  updateGardenPlan: (id, updates) =>
    set((state) => ({
      gardenPlans: state.gardenPlans.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      currentGardenPlan:
        state.currentGardenPlan?.id === id
          ? { ...state.currentGardenPlan, ...updates }
          : state.currentGardenPlan,
    })),

  removeGardenPlan: (id) =>
    set((state) => ({
      gardenPlans: state.gardenPlans.filter((p) => p.id !== id),
      currentGardenPlan:
        state.currentGardenPlan?.id === id ? null : state.currentGardenPlan,
    })),

  setCurrentGardenPlan: (plan) => set({ currentGardenPlan: plan }),

  setMarkers: (markersOrUpdater) =>
    set((state) => ({
      markers:
        typeof markersOrUpdater === 'function'
          ? markersOrUpdater(state.markers)
          : markersOrUpdater,
    })),

  addMarker: (marker) => set((state) => ({ markers: [...state.markers, marker] })),

  updateMarker: (markerId, updates) =>
    set((state) => ({
      markers: state.markers.map((m) => (m.id === markerId ? { ...m, ...updates } : m)),
    })),

  removeMarker: (markerId) =>
    set((state) => ({ markers: state.markers.filter((m) => m.id !== markerId) })),

  setLoading: (isLoading) => set({ isLoading }),
  setUploadProgress: (progress) => set({ uploadProgress: progress }),
  reset: () => set(initialState),
}));
