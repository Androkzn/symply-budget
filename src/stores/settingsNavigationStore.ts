import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { create } from 'zustand';

import type { SettingsStackParamList } from '@navigation/types';

export type PendingSettingsScreen =
  | 'HouseholdMembers'
  | 'HouseholdManagement'
  | 'SpacesManagement'
  | 'FloorPlanPicker'
  /** House V2 enrolment — the hub, and the invitee's screen with an invite in hand. */
  | 'HouseInvite'
  | 'HouseJoin';

export interface PendingSettingsNavigation {
  screen: PendingSettingsScreen;
  householdId?: string;
  linkedEntityId?: string;
  /**
   * A tapped invite link's two halves, for `HouseJoin`.
   *
   * They travel in memory only — this store is never persisted — because a
   * secret in navigation state is a secret in anything that logs a route. The
   * link itself is parked in `inviteLinkStore` on the way in; this is the one
   * hop from "the app is ready" to "the screen that can act on it".
   */
  inviteCode?: string;
  inviteSecret?: string;
}

interface SettingsNavigationState {
  pending: PendingSettingsNavigation | null;
  queue: (nav: PendingSettingsNavigation) => void;
  take: () => PendingSettingsNavigation | null;
}

export const useSettingsNavigationStore = create<SettingsNavigationState>((set, get) => ({
  pending: null,
  queue: (nav) => set({ pending: nav }),
  take: () => {
    const pending = get().pending;
    if (pending) set({ pending: null });
    return pending;
  },
}));

let settingsStackNavigation: NativeStackNavigationProp<SettingsStackParamList> | null = null;

export function registerSettingsStackNavigation(
  navigation: NativeStackNavigationProp<SettingsStackParamList>
) {
  settingsStackNavigation = navigation;
}

/** Run a queued Settings-stack navigation (used after notification taps). */
export function flushPendingSettingsNavigation(): boolean {
  const pending = useSettingsNavigationStore.getState().take();
  if (!pending || !settingsStackNavigation) {
    if (pending) {
      // Navigator not ready yet — put the request back.
      useSettingsNavigationStore.getState().queue(pending);
    }
    return false;
  }

  if (pending.screen === 'HouseholdMembers' && pending.householdId) {
    settingsStackNavigation.navigate('HouseholdMembers', { householdId: pending.householdId });
    return true;
  }

  if (pending.screen === 'HouseholdManagement') {
    settingsStackNavigation.navigate('HouseholdManagement');
    return true;
  }

  if (pending.screen === 'SpacesManagement') {
    settingsStackNavigation.navigate('SpacesManagement', {
      householdId: pending.householdId,
    });
    return true;
  }

  if (pending.screen === 'HouseInvite') {
    settingsStackNavigation.navigate('HouseInvite');
    return true;
  }

  if (pending.screen === 'HouseJoin') {
    settingsStackNavigation.navigate('HouseJoin', {
      code: pending.inviteCode,
      secret: pending.inviteSecret,
    });
    return true;
  }

  if (pending.screen === 'FloorPlanPicker' && pending.linkedEntityId) {
    settingsStackNavigation.navigate('FloorPlanPicker', {
      linkedEntityType: 'task',
      linkedEntityId: pending.linkedEntityId,
    });
    return true;
  }

  return false;
}

export function queueSettingsNavigation(nav: PendingSettingsNavigation) {
  useSettingsNavigationStore.getState().queue(nav);
}
