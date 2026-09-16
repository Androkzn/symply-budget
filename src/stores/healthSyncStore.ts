import { create } from 'zustand';

/**
 * Signals "a HealthKit import just wrote something" to every mounted Health
 * screen — not persisted, in-memory only, reset each app session.
 *
 * `useFocusEffect` alone only refreshes a screen the member NAVIGATES to
 * after a sync. It does nothing for a sync that lands while they are already
 * sitting on a tab (the common case for the background observer / app-active
 * catch-up paths) — that screen would show stale data until they left and
 * came back. Screens that show HealthKit-derived data subscribe to
 * `lastSyncedAt` and refetch when it changes, on top of `useFocusEffect`.
 */
interface HealthSyncState {
  lastSyncedAt: number | null;
  markSynced: () => void;
}

export const useHealthSyncStore = create<HealthSyncState>((set) => ({
  lastSyncedAt: null,
  markSynced: () => set({ lastSyncedAt: Date.now() }),
}));
