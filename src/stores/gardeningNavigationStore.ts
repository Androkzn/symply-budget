import { create } from 'zustand';

type PendingGardenNavigation =
  | { screen: 'GardenPlanAddress'; initialAddressLine1?: string }
  | { screen: 'GardenPlanBoundaryConfirm'; draftId: string }
  | { screen: 'GardenPlanViewer'; gardenPlanId: string };

interface GardeningNavigationState {
  pendingNavigation: PendingGardenNavigation | null;
  setPendingNavigation: (navigation: PendingGardenNavigation | null) => void;
}

export const useGardeningNavigationStore = create<GardeningNavigationState>((set) => ({
  pendingNavigation: null,
  setPendingNavigation: (navigation) => set({ pendingNavigation: navigation }),
}));
