/**
 * Re-hydrate a Health screen when a HealthKit import lands while it is focused.
 *
 * `useFocusEffect` alone only refreshes on navigate-in. Background /
 * app-active catch-up syncs write new data while the member is already sitting
 * on a tab — this hook covers that case.
 *
 * Two guards keep the refresh from fighting the UI:
 *  1. `useIsFocused` — only the visible tab refetches. Visited-but-hidden tabs
 *     stay mounted under Expo Router; waking all of them at once stampeded
 *     MMKV + setState and starved the JS thread (scroll pans need that thread
 *     to hand off from Pressable → ScrollView).
 *  2. `InteractionManager.runAfterInteractions` — wait out the current
 *     gesture / animation frame so a sync toast does not collide with a drag.
 */
import { useIsFocused } from '@react-navigation/native';
import { useEffect } from 'react';
import { InteractionManager } from 'react-native';

import { useHealthSyncStore } from '@stores/healthSyncStore';

export function useHealthKitSyncHydration(hydrate: () => void | Promise<void>): void {
  const isFocused = useIsFocused();
  const lastHealthSyncedAt = useHealthSyncStore((state) => state.lastSyncedAt);

  useEffect(() => {
    if (lastHealthSyncedAt === null || !isFocused) return undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      void hydrate();
    });
    return () => task.cancel();
  }, [lastHealthSyncedAt, hydrate, isFocused]);
}
