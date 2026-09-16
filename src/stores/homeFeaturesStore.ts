import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { HomeFeature } from '@api/home-features';

interface HomeFeaturesState {
  features: HomeFeature[];
  selectedFeature: HomeFeature | null;
  isLoading: boolean;
  error: string | null;
}

interface HomeFeaturesActions {
  setFeatures: (features: HomeFeature[]) => void;
  addFeature: (feature: HomeFeature) => void;
  updateFeature: (featureId: string, updates: Partial<HomeFeature>) => void;
  removeFeature: (featureId: string) => void;
  setSelectedFeature: (feature: HomeFeature | null) => void;
  getFeaturesByType: (featureType: string) => HomeFeature[];
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type HomeFeaturesStore = HomeFeaturesState & HomeFeaturesActions;

const initialState: HomeFeaturesState = {
  features: [],
  selectedFeature: null,
  isLoading: false,
  error: null,
};

export const useHomeFeaturesStore = create<HomeFeaturesStore>()(
  immer((set, get) => ({
    ...initialState,

      setFeatures: (features) =>
        set((state) => {
          state.features = features;
        }),

      addFeature: (feature) =>
        set((state) => {
          state.features.push(feature);
        }),

      updateFeature: (featureId, updates) =>
        set((state) => {
          const index = state.features.findIndex((f) => f.id === featureId);
          if (index !== -1) {
            state.features[index] = { ...state.features[index], ...updates };
          }
          if (state.selectedFeature?.id === featureId) {
            state.selectedFeature = { ...state.selectedFeature, ...updates };
          }
        }),

      removeFeature: (featureId) =>
        set((state) => {
          state.features = state.features.filter((f) => f.id !== featureId);
          if (state.selectedFeature?.id === featureId) {
            state.selectedFeature = null;
          }
        }),

      setSelectedFeature: (feature) =>
        set((state) => {
          state.selectedFeature = feature;
        }),

      getFeaturesByType: (featureType) => {
        return get().features.filter((f) => f.feature_type === featureType);
      },

      setLoading: (loading) =>
        set((state) => {
          state.isLoading = loading;
        }),

      setError: (error) =>
        set((state) => {
          state.error = error;
        }),

      reset: () => set(initialState),
    }))
);
