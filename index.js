/**
 * @format
 *
 * NOTE: This file is no longer the runtime entry point — `package.json#main`
 * points to `expo-router/entry`. The expo-router entry mounts
 * `app/_layout.tsx` directly. We keep this file around purely so the
 * `__DEV__` block below still runs at startup (some dev-only setup that
 * runs in the Metro bundle's first import order).
 */

import 'react-native-get-random-values';
import { Platform, NativeModules } from 'react-native';

// CRITICAL: Disable remote debugger to enable MMKV/JSI
// Remote debugger breaks JSI which MMKV requires for synchronous operations
if (__DEV__ && Platform.OS !== 'web') {
  try {
    const DevSettings = NativeModules.DevSettings || NativeModules.DevMenu;
    if (DevSettings) {
      // Disable remote debugging if it's enabled
      DevSettings.setIsDebuggingRemotely && DevSettings.setIsDebuggingRemotely(false);
      console.log('[DevSettings] Remote debugging disabled to enable MMKV/JSI');
    }
  } catch (error) {
    console.warn('[DevSettings] Could not disable remote debugging:', error);
  }
}
