import { create } from 'zustand';

import type { FloorPlan, FloorPlanMarker } from '@api/floor-plans';

// Type for functional update
type MarkersUpdater = FloorPlanMarker[] | ((prev: FloorPlanMarker[]) => FloorPlanMarker[]);

interface FloorPlanStore {
  // State
  floorPlans: FloorPlan[];
  currentFloorPlan: FloorPlan | null;
  markers: FloorPlanMarker[];
  isLoading: boolean;
  uploadProgress: number;

  // Actions
  setFloorPlans: (floorPlans: FloorPlan[]) => void;
  addFloorPlan: (floorPlan: FloorPlan) => void;
  updateFloorPlan: (floorPlanId: string, updates: Partial<FloorPlan>) => void;
  removeFloorPlan: (floorPlanId: string) => void;
  setCurrentFloorPlan: (floorPlan: FloorPlan | null) => void;
  setMarkers: (markersOrUpdater: MarkersUpdater) => void;
  addMarker: (marker: FloorPlanMarker) => void;
  updateMarker: (markerId: string, updates: Partial<FloorPlanMarker>) => void;
  removeMarker: (markerId: string) => void;
  setLoading: (isLoading: boolean) => void;
  setUploadProgress: (progress: number) => void;
  reset: () => void;
}

const initialState = {
  floorPlans: [],
  currentFloorPlan: null,
  markers: [],
  isLoading: false,
  uploadProgress: 0,
};

export const useFloorPlanStore = create<FloorPlanStore>((set) => ({
  ...initialState,

  setFloorPlans: (floorPlans) => set({ floorPlans }),

  addFloorPlan: (floorPlan) =>
    set((state) => ({
      floorPlans: [floorPlan, ...state.floorPlans],
    })),

  updateFloorPlan: (floorPlanId, updates) =>
    set((state) => ({
      floorPlans: state.floorPlans.map((fp) =>
        fp.id === floorPlanId ? { ...fp, ...updates } : fp
      ),
      currentFloorPlan:
        state.currentFloorPlan?.id === floorPlanId
          ? { ...state.currentFloorPlan, ...updates }
          : state.currentFloorPlan,
    })),

  removeFloorPlan: (floorPlanId) =>
    set((state) => ({
      floorPlans: state.floorPlans.filter((fp) => fp.id !== floorPlanId),
      currentFloorPlan:
        state.currentFloorPlan?.id === floorPlanId
          ? null
          : state.currentFloorPlan,
    })),

  setCurrentFloorPlan: (floorPlan) => set({ currentFloorPlan: floorPlan }),

  // Support both direct array and functional updater
  setMarkers: (markersOrUpdater) => 
    set((state) => ({
      markers: typeof markersOrUpdater === 'function' 
        ? markersOrUpdater(state.markers)
        : markersOrUpdater,
    })),

  addMarker: (marker) =>
    set((state) => ({
      markers: [...state.markers, marker],
    })),

  updateMarker: (markerId, updates) =>
    set((state) => ({
      markers: state.markers.map((m) =>
        m.id === markerId ? { ...m, ...updates } : m
      ),
    })),

  removeMarker: (markerId) =>
    set((state) => ({
      markers: state.markers.filter((m) => m.id !== markerId),
    })),

  setLoading: (isLoading) => set({ isLoading }),

  setUploadProgress: (progress) => set({ uploadProgress: progress }),

  reset: () => set(initialState),
}));
