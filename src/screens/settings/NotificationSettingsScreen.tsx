import { NavigationContext } from 'expo-router/react-navigation';
import React, { useContext, useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { AppBackground, PermissionCard, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { FocusModeIndicator } from '@components/notifications/FocusModeIndicator';
import { Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ENV } from '@config/env';
import { useTheme } from '@contexts/ThemeContext';
import { useDismissiblePermissionBanner } from '@hooks/useDismissiblePermissionBanner';
import { useNotificationPermission } from '@hooks/useNotificationPermission';
import { useNotificationStore } from '@stores/notificationStore';
import {Layout, useAppColors } from '@theme';

import type { BackOnlyScreenProps } from './backOnlyScreenProps';

interface SettingRowProps {
  title: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

function SettingRow({ title, description, value, onValueChange, disabled }: SettingRowProps) {
  const colors = useAppColors();

  return (
    <View style={[styles.settingRow, { borderBottomColor: colors.borderColor }]}>
      <View style={styles.settingContent}>
        <Typography variant="body" weight="medium">
          {title}
        </Typography>
        {description && (
          <Typography variant="footnote" color={colors.textSecondary} style={styles.description}>
            {description}
          </Typography>
        )}
      </View>
      <Toggle value={value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  );
}

interface SettingSectionProps {
  title: string;
  children: React.ReactNode;
}

function SettingSection({ title, children }: SettingSectionProps) {
  const colors = useAppColors();

  return (
    <View style={styles.section}>
      <Typography
        variant="footnote"
        weight="semibold"
        color={colors.textSecondary}
        style={styles.sectionTitle}
      >
        {title.toUpperCase()}
      </Typography>
      <View style={[styles.sectionContent, { backgroundColor: colors.backgroundSecondary }]}>
        {children}
      </View>
    </View>
  );
}

export function NotificationSettingsScreen({ navigation }: BackOnlyScreenProps = {}) {
  // Falls back to the ambient navigator when no prop arrives — the root
  // expo-router routes render this screen directly, with no `component=`
  // to hand one over. `NavigationContext` rather than `useNavigation()`
  // because the latter throws outside a navigator, and these screens are
  // rendered bare in their own unit tests.
  const ambientNavigation = useContext(NavigationContext);
  const goBack = () => (navigation ?? ambientNavigation)?.goBack();
  const colors = useAppColors();
  const { theme } = useTheme();
  const { preferences, loadPreferences, updatePreferences } = useNotificationStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { state: pushPermission, busy: pushBusy, request: requestPushPermission } =
    useNotificationPermission();
  const notificationBanner = useDismissiblePermissionBanner(
    pushPermission !== 'granted' && pushPermission !== 'unavailable'
  );

  useEffect(() => {
    loadPreferences().finally(() => setIsLoading(false));
  }, [loadPreferences]);

  const handleToggle = async (key: string, value: boolean) => {
    if (!preferences) return;
    setIsSaving(true);
    try {
      await updatePreferences({ [key]: value });
    } catch (error) {
      console.error('Error updating preference:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <AppBackground>
        <SafeAreaView edges={[]}>
          <View style={[styles.loadingContainer, { backgroundColor: colors.backgroundMain }]}>
            <ActivityIndicator size="large" color={theme.pastel.teal} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  if (!preferences) {
    return (
      <AppBackground>
        <SafeAreaView edges={[]}>
          <View style={[styles.loadingContainer, { backgroundColor: colors.backgroundMain }]}>
            <Typography variant="body" color={colors.textSecondary}>
              Failed to load preferences
            </Typography>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground>
    <SafeAreaView edges={[]}>
      <ScreenHeader
        title="Notifications"
        showBackButton
        onBackPress={() => goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.container, { backgroundColor: colors.backgroundMain }]}
        contentContainerStyle={styles.content}
      >
        {/* Every toggle below only matters once the OS itself allows notifications —
            surfaced here rather than silently, since a toggle that is ON but blocked
            at the OS level looks identical to one that is actually delivering. */}
        {notificationBanner.visible ? (
          <View style={styles.permissionContainer}>
            <PermissionCard
              state={pushPermission}
              icon="notifications"
              title="Notifications are off"
              copy={{
                'not-requested': {
                  body: `Turn these on and ${ENV.APP_NAME} can remind you before things are due instead of you remembering on your own.`,
                },
                denied: {
                  body: `That's a fine choice — the toggles below just will not deliver anything until notifications are allowed again in Settings.`,
                },
              }}
              onRequest={() => void requestPushPermission()}
              onOpenSettings={() => void Linking.openSettings()}
              onDismiss={notificationBanner.dismiss}
              busy={pushBusy}
              layout="compact"
              testID="notification-permission-card"
            />
          </View>
        ) : null}

        {/* Focus Mode Indicator (2026 best practice) */}
        <View style={styles.focusModeContainer}>
          <FocusModeIndicator showWhenInactive={false} />
        </View>

        {/* Global Settings */}
        <SettingSection title="Notification Channels">
          <SettingRow
            title="Push Notifications"
            description="Receive alerts on your device"
            value={preferences.push_enabled}
            onValueChange={(value) => handleToggle('push_enabled', value)}
            disabled={isSaving}
          />
          <SettingRow
            title="Email Notifications"
            description="Receive updates via email"
            value={preferences.email_enabled}
            onValueChange={(value) => handleToggle('email_enabled', value)}
            disabled={isSaving}
          />
        </SettingSection>

        {/* Task Notifications */}
        <SettingSection title="Task Notifications">
          <SettingRow
            title="Task Reminders"
            description="Get reminded before tasks are due"
            value={preferences.task_reminders}
            onValueChange={(value) => handleToggle('task_reminders', value)}
            disabled={isSaving || !preferences.push_enabled}
          />
          <SettingRow
            title="Overdue Alerts"
            description="Alert when tasks become overdue"
            value={preferences.task_overdue}
            onValueChange={(value) => handleToggle('task_overdue', value)}
            disabled={isSaving || !preferences.push_enabled}
          />
          <SettingRow
            title="Task Assignments"
            description="When a task is assigned to you"
            value={preferences.task_assigned}
            onValueChange={(value) => handleToggle('task_assigned', value)}
            disabled={isSaving || !preferences.push_enabled}
          />
          <SettingRow
            title="Task Completions"
            description="When property members complete tasks"
            value={preferences.task_completed}
            onValueChange={(value) => handleToggle('task_completed', value)}
            disabled={isSaving || !preferences.push_enabled}
          />
        </SettingSection>

        {/* Home Maintenance */}
        <SettingSection title="Home Maintenance">
          <SettingRow
            title="Garbage Collection"
            description="Reminders for garbage, recycling & organics"
            value={preferences.garbage_collection ?? true}
            onValueChange={(value) => handleToggle('garbage_collection', value)}
            disabled={isSaving || !preferences.push_enabled}
          />
          <SettingRow
            title="Maintenance Suggestions"
            description="Smart suggestions based on your home features"
            value={preferences.maintenance_suggestions ?? true}
            onValueChange={(value) => handleToggle('maintenance_suggestions', value)}
            disabled={isSaving || !preferences.push_enabled}
          />
        </SettingSection>

        {/* Reports & Analysis */}
        <SettingSection title="Reports & Analysis">
          <SettingRow
            title="Task Drafts Ready"
            description="When task drafts are generated from reports"
            value={preferences.task_drafts_ready ?? true}
            onValueChange={(value) => handleToggle('task_drafts_ready', value)}
            disabled={isSaving || !preferences.push_enabled}
          />
          <SettingRow
            title="Critical Findings"
            description="Immediate alerts for critical issues found"
            value={preferences.critical_findings ?? true}
            onValueChange={(value) => handleToggle('critical_findings', value)}
            disabled={isSaving || !preferences.push_enabled}
          />
        </SettingSection>

        {/* Other Notifications */}
        <SettingSection title="Other Notifications">
          <SettingRow
            title="Property Updates"
            description="Member joins, invitations, etc."
            value={preferences.household_updates}
            onValueChange={(value) => handleToggle('household_updates', value)}
            disabled={isSaving || !preferences.push_enabled}
          />
          <SettingRow
            title="Report Ready"
            description="When your inspection report is processed"
            value={preferences.report_ready}
            onValueChange={(value) => handleToggle('report_ready', value)}
            disabled={isSaving || !preferences.push_enabled}
          />
          <SettingRow
            title="Weekly Summary"
            description="Weekly overview of tasks and progress"
            value={preferences.weekly_summary}
            onValueChange={(value) => handleToggle('weekly_summary', value)}
            disabled={isSaving || !preferences.push_enabled}
          />
        </SettingSection>

        {/* Quiet Hours Info */}
        <View style={styles.infoSection}>
          <Typography variant="footnote" color={colors.textSecondary} align="center">
            Notifications respect your device's Do Not Disturb settings
          </Typography>
        </View>
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: Layout.bottomTabBarClearance,
  },
  permissionContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  focusModeContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sectionContent: {
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingContent: {
    flex: 1,
    marginRight: 16,
  },
  description: {
    marginTop: 2,
  },
  infoSection: {
    marginTop: 32,
    paddingHorizontal: 32,
  },
});
