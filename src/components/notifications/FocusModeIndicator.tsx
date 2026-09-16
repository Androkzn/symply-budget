import * as Linking from 'expo-linking';
import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useFocusMode, getFocusModeMessage } from '@hooks/useFocusMode';
import { useAppColors } from '@theme';

interface FocusModeIndicatorProps {
  compact?: boolean;
  showWhenInactive?: boolean;
}

/**
 * FocusModeIndicator (2026 best practice)
 * 
 * Shows the user when Focus Mode or Do Not Disturb might be affecting
 * their notification delivery. Helps users understand why they might
 * not be receiving expected notifications.
 */
export function FocusModeIndicator({ 
  compact = false,
  showWhenInactive = false,
}: FocusModeIndicatorProps) {
  const colors = useAppColors();  const focusState = useFocusMode();
  const message = getFocusModeMessage(focusState);

  // Don't show anything if loading
  if (focusState.isLoading) {
    return null;
  }

  // Don't show if notifications are working normally (unless showWhenInactive)
  if (!message && !showWhenInactive) {
    return null;
  }

  // Determine the indicator type
  const isWarning = focusState.isActive || focusState.alertStyle === 'none';
  const isError = !focusState.notificationsAllowed;

  const backgroundColor = isError
    ? colors.error + '15'
    : isWarning
    ? colors.warning + '15'
    : colors.success + '15';

  const iconColor = isError
    ? colors.error
    : isWarning
    ? colors.warning
    : colors.success;

  const iconName = isError
    ? 'notifications-off'
    : isWarning
    ? 'moon'
    : 'notifications';

  const handleOpenSettings = async () => {
    try {
      // expo-linking openSettings opens the app's settings page directly
      await Linking.openSettings();
    } catch (error) {
      console.error('Failed to open settings:', error);
      // Fallback: try opening app-settings URL directly
      try {
        await Linking.openURL('app-settings:');
      } catch {
        console.error('Fallback also failed');
      }
    }
  };

  if (compact) {
    return (
      <TouchableOpacity 
        onPress={handleOpenSettings}
        style={[styles.compactContainer, { backgroundColor }]}
      >
        <Icon name={iconName} size={16} color={iconColor} />
        {focusState.isActive && (
          <Typography variant="caption1" style={{ color: iconColor, marginLeft: 4 }}>
            Focus
          </Typography>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity 
      onPress={handleOpenSettings}
      style={[styles.container, { backgroundColor }]}
    >
      <View style={styles.iconContainer}>
        <Icon name={iconName} size={20} color={iconColor} />
      </View>
      
      <View style={styles.textContainer}>
        <Typography 
          variant="body" 
          weight="medium"
          style={{ color: iconColor }}
        >
          {focusState.isActive 
            ? 'Focus Mode Active'
            : !focusState.notificationsAllowed
            ? 'Notifications Disabled'
            : focusState.alertStyle === 'none'
            ? 'Banners Disabled'
            : 'Notifications Active'
          }
        </Typography>
        
        {message && (
          <Typography 
            variant="caption1" 
            color={colors.textSecondary}
            style={styles.message}
          >
            {message}
          </Typography>
        )}
      </View>

      <Icon 
        name="chevron-forward" 
        size={16} 
        color={colors.textSecondary} 
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginVertical: 8,
  },
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  iconContainer: {
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  message: {
    marginTop: 2,
  },
});
