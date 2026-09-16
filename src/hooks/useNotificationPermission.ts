import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { subscribeNotificationPermission } from '@services/notificationPermissionEvents';
import { notificationService } from '@services/notifications';
import { permissionStateFrom, type PermissionState } from '@utils/permissionState';

export interface UseNotificationPermissionResult {
  state: PermissionState;
  busy: boolean;
  /** True once the first `getPermissionsAsync` read has resolved — `state` is real, not the `unavailable` default. */
  checked: boolean;
  /** Fires the native permission sheet. No-op once `granted` or `denied`. */
  request: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * OS-level push permission, normalised to the shared four-state model.
 *
 * Deliberately reads `Notifications.getPermissionsAsync()` directly rather
 * than `notificationService.getPermissionStatus()` — the service methods
 * early-return on `!Device.isDevice` for the push-TOKEN path (which
 * genuinely needs a real device), but permission STATUS is answerable on the
 * Simulator too, and folding the two together would report `unavailable` on
 * every simulator regardless of what was actually granted.
 */
export function useNotificationPermission(): UseNotificationPermissionResult {
  const [state, setState] = useState<PermissionState>('unavailable');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);

  const readVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++readVersion.current;
    try {
      const response = await Notifications.getPermissionsAsync();
      if (version === readVersion.current) setState(permissionStateFrom(response));
    } catch {
      if (version === readVersion.current) setState('unavailable');
    } finally {
      if (version === readVersion.current) setChecked(true);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeNotificationPermission(response => {
      // Ignore an older initial read finishing after the system prompt.
      ++readVersion.current;
      setState(permissionStateFrom(response));
      setChecked(true);
    });
    const appState = AppState.addEventListener('change', next => {
      if (next === 'active') void refresh();
    });
    void refresh();
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- This counter invalidates pending reads; it is not a DOM ref.
      ++readVersion.current;
      unsubscribe();
      appState.remove();
    };
  }, [refresh]);

  const request = useCallback(async () => {
    setBusy(true);
    try {
      const granted = await notificationService.requestPermission();
      await refresh();
      if (granted) {
        // Network/token work must not keep a granted permission banner visible.
        void notificationService.registerWithServer().catch(error => {
          console.warn('[Notifications] Push registration failed after permission grant', error);
        });
      }
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { state, busy, checked, request, refresh };
}
