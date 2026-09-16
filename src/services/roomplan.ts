/**
 * RoomPlan native bridge (modules/roomplan). Soft-degrades when unavailable.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface RoomPlanNativeModule {
  isSupported(): boolean;
  scanRoom(): Promise<unknown>;
}

const Native = requireOptionalNativeModule<RoomPlanNativeModule>('RoomPlan');

export const roomPlan = {
  isAvailable(): boolean {
    return Platform.OS === 'ios' && Native != null;
  },

  isSupported(): boolean {
    if (!this.isAvailable() || !Native) return false;
    try {
      return Native.isSupported();
    } catch {
      return false;
    }
  },

  async scanRoom(): Promise<unknown> {
    if (!Native) throw new Error('RoomPlan module not linked');
    return Native.scanRoom();
  },
};
