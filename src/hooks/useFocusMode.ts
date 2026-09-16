import * as Notifications from 'expo-notifications';
import { useState, useEffect } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';

interface FocusModeState {
  isActive: boolean;
  notificationsAllowed: boolean;
  alertStyle: 'none' | 'banner' | 'alert';
  isLoading: boolean;
}

/**
 * Hook to detect Focus Mode / Do Not Disturb status (2026 best practice)
 * 
 * On iOS, this checks notification settings which reflect Focus Mode restrictions.
 * When Focus Mode is active, notifications may be silenced or hidden.
 * 
 * Note: iOS doesn't directly expose Focus Mode status to apps, but we can infer
 * it from notification settings changes.
 */
export function useFocusMode(): FocusModeState {
  const [state, setState] = useState<FocusModeState>({
    isActive: false,
    notificationsAllowed: true,
    alertStyle: 'banner',
    isLoading: true,
  });

  useEffect(() => {
    let isMounted = true;

    const checkNotificationSettings = async () => {
      if (Platform.OS !== 'ios') {
        // Android handles DND differently, and we can't easily detect it
        if (isMounted) {
          setState({
            isActive: false,
            notificationsAllowed: true,
            alertStyle: 'banner',
            isLoading: false,
          });
        }
        return;
      }

      try {
        const settings = await Notifications.getPermissionsAsync();
        
        if (!isMounted) return;

        // Check if notifications are fully allowed
        const notificationsAllowed = settings.status === 'granted';
        
        // On iOS, when Focus Mode restricts an app:
        // - alerts might be disabled
        // - sounds might be disabled  
        // - badges might still work
        
        // We consider Focus Mode "active" if alerts are restricted
        // Note: This is a heuristic since iOS doesn't expose Focus state directly
        const alertsEnabled = settings.ios?.alertStyle !== undefined && 
                             settings.ios.alertStyle !== Notifications.IosAlertStyle.NONE;
        
        const isActive = notificationsAllowed && !alertsEnabled;
        
        setState({
          isActive,
          notificationsAllowed,
          alertStyle: settings.ios?.alertStyle === Notifications.IosAlertStyle.BANNER 
            ? 'banner' 
            : settings.ios?.alertStyle === Notifications.IosAlertStyle.ALERT 
              ? 'alert' 
              : 'none',
          isLoading: false,
        });
      } catch (error) {
        console.error('Error checking notification settings:', error);
        if (isMounted) {
          setState((prev) => ({ ...prev, isLoading: false }));
        }
      }
    };

    // Check on mount
    checkNotificationSettings();

    // Re-check when app becomes active (user might have changed Focus Mode)
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        checkNotificationSettings();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  return state;
}

/**
 * Get a user-friendly message about Focus Mode status
 */
export function getFocusModeMessage(state: FocusModeState): string | null {
  if (state.isLoading) return null;
  
  if (!state.notificationsAllowed) {
    return 'Notifications are disabled. Enable them in Settings to receive reminders.';
  }
  
  if (state.isActive) {
    return 'Focus Mode may be active. Some notifications might be silenced.';
  }
  
  if (state.alertStyle === 'none') {
    return 'Notification banners are disabled. You\'ll only see badges.';
  }
  
  return null;
}
