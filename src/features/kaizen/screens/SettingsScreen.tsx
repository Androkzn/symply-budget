import type { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';

import { brandId } from '@brand';
import {
  AppBackground,
  PermissionCard,
  ScreenHeader,
  ScreenScrollEnd,
  screenScrollEndTestId,
} from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Button, Card, Toggle, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { getNotificationBenefit } from '@config/brandContent';
import { ThemeModeControl } from '@features/kaizen/components/ThemeModeControl';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useNotificationStore } from '@features/kaizen/stores/notificationStore';
import { useDeviceType } from '@hooks/useDeviceType';
import { useDismissiblePermissionBanner } from '@hooks/useDismissiblePermissionBanner';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useNotificationPermission } from '@hooks/useNotificationPermission';
import { biometricService } from '@services/biometric';
import { useAuthStore } from '@stores/authStore';
import { Layout, Spacing, useAppColors } from '@theme';

import { KAIZEN_SCREEN_SCROLL_TEST_ID, parseSystems } from './common';

/**
 * App-level controls only (appearance, sync, notifications, systems entry,
 * AI). No daily activity / check-in recording — that lives on Today per system.
 *
 * Built on the same shared primitives (Card/Typography/Icon/AppBackground)
 * as every other brand's Settings/More screen — see src/screens/main/SettingsScreen.tsx.
 */

interface SettingItemProps {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  testID?: string;
}

function SettingItem({
  icon,
  iconColor,
  title,
  subtitle,
  rightElement,
  onPress,
  showChevron = false,
  testID,
}: SettingItemProps) {
  const colors = useAppColors();
  const tint = iconColor ?? colors.primary;

  return (
    <Card
      variant="filled"
      pressable={!!onPress}
      onPress={onPress}
      testID={testID}
      style={[styles.settingItem, { backgroundColor: colors.backgroundSecondary }]}
    >
      {icon && (
        <View style={styles.iconTile}>
          <Icon name={icon} size={22} color={tint} />
        </View>
      )}
      <View style={styles.settingContent}>
        <Typography variant="body" weight="medium" color={colors.textPrimary}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="footnote" color={colors.textSecondary}>
            {subtitle}
          </Typography>
        )}
      </View>
      {rightElement && <View style={styles.settingRight}>{rightElement}</View>}
      {showChevron && (
        <Icon name="chevron-forward" size={20} color={colors.textTertiary} />
      )}
    </Card>
  );
}

export function SettingsScreen() {
  const colors = useAppColors();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const profile = useKaizenStore(state => state.profile);
  const isSyncing = useKaizenStore(state => state.isSyncing);
  const sync = useKaizenStore(state => state.sync);
  const user = useAuthStore(state => state.user);
  const refreshToken = useAuthStore(state => state.refreshToken);
  const logout = useAuthStore(state => state.logout);
  const biometricEnabled = useAuthStore(state => state.biometricEnabled);
  const setBiometricEnabled = useAuthStore(state => state.setBiometricEnabled);
  const scheduleDailyReminders = useKaizenStore(state => state.scheduleDailyReminders);
  const initializeNotifications = useNotificationStore(state => state.initialize);
  const {
    state: pushState,
    busy: pushBusy,
    request: requestPush,
    refresh: refreshPushState,
  } = useNotificationPermission();
  const notificationBanner = useDismissiblePermissionBanner(
    pushState !== 'granted' && pushState !== 'unavailable'
  );
  const hasAIDisclosureAck = useKaizenStore(state => state.hasAIDisclosureAck);
  const setAIDisclosureAck = useKaizenStore(state => state.setAIDisclosureAck);
  const resetOnboarding = useKaizenStore(state => state.resetOnboarding);

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState('Biometrics');
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [aiDisclosureAck, setAiDisclosureAck] = useState(() => hasAIDisclosureAck());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const available = await biometricService.isAvailable();
      if (cancelled) return;
      setBiometricAvailable(available);
      if (available) {
        setBiometricType(await biometricService.getBiometricTypeName());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBiometricToggle = async (enabled: boolean) => {
    if (!user || !refreshToken) return;
    setBiometricLoading(true);
    try {
      if (enabled) {
        const success = await biometricService.enableBiometric({
          email: user.email,
          refreshToken,
        });
        if (success) {
          setBiometricEnabled(true);
        } else {
          Alert.alert('Failed', `Could not enable ${biometricType}. Please try again.`);
        }
      } else {
        await biometricService.disableBiometric();
        setBiometricEnabled(false);
      }
    } catch (error) {
      console.error('Biometric toggle error:', error);
      Alert.alert('Error', 'An error occurred. Please try again.');
    } finally {
      setBiometricLoading(false);
    }
  };

  const rerunOnboarding = async () => {
    await resetOnboarding();
    router.replace('/kaizen/onboarding');
  };

  const systems = parseSystems(profile?.enabled_systems ?? null);

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="kaizen-settings-screen">
        <ScreenHeader
          title="Settings"
          showBackButton
          onBackPress={() => router.back()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <AdaptiveContainer maxWidth={isTablet ? 1000 : undefined} padding={containerPadding}>
          <ScrollView
            testID={KAIZEN_SCREEN_SCROLL_TEST_ID}
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Typography variant="footnote" color={colors.textSecondary} style={styles.intro}>
              Control how Kaizen supports you.
            </Typography>

            <View style={styles.section}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                APPEARANCE
              </Typography>
              <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
                <ThemeModeControl />
              </Card>
            </View>

            <View style={styles.section}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                PROFILE
              </Typography>
              <SettingItem
                icon="checkmark-done-outline"
                title="Onboarding"
                rightElement={
                  <Typography variant="body" color={colors.textSecondary}>
                    {profile?.onboarding_complete ? 'Complete' : 'Not started'}
                  </Typography>
                }
              />
              <SettingItem
                icon="layers-outline"
                title="Enabled systems"
                rightElement={
                  <Typography variant="body" color={colors.textSecondary}>
                    {systems.length}
                  </Typography>
                }
              />
              <SettingItem
                icon="time-outline"
                title="Timezone"
                rightElement={
                  <Typography variant="body" color={colors.textSecondary}>
                    {profile?.timezone ?? 'Automatic'}
                  </Typography>
                }
              />
            </View>

            <View style={styles.section}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                DATA
              </Typography>
              <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
                <Button title="Sync Kaizen" variant="outline" loading={isSyncing} onPress={() => void sync()} fullWidth />
              </Card>
            </View>

            <View style={styles.section}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                CONNECTIONS
              </Typography>
              {notificationBanner.visible ? (
                <PermissionCard
                  state={pushState}
                  icon="notifications-outline"
                  title="Notifications"
                  copy={{
                    'not-requested': { body: getNotificationBenefit(brandId) },
                    denied: {
                      body: "That's a fine choice — everything still works without them. If you change your mind, notifications live in Settings.",
                    },
                  }}
                  onRequest={() =>
                    void (async () => {
                      await requestPush();
                      await initializeNotifications();
                      await scheduleDailyReminders();
                      await refreshPushState();
                    })()
                  }
                  onOpenSettings={() => void Linking.openSettings()}
                  onDismiss={notificationBanner.dismiss}
                  busy={pushBusy}
                  layout="compact"
                  testID="kaizen-settings-notification-permission-card"
                />
              ) : null}
              <SettingItem
                icon="options-outline"
                title="Manage systems"
                onPress={() => router.push('/kaizen-systems')}
                showChevron
              />
              <SettingItem
                icon="file-tray-full-outline"
                title="Notification inbox"
                onPress={() => router.push('/kaizen/notifications')}
                showChevron
              />
            </View>

            <View style={styles.section}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                AI
              </Typography>
              <SettingItem
                icon="sparkles-outline"
                title="AI disclosure"
                subtitle="Allow your approved context to be sent with AI requests."
                rightElement={
                  <Toggle
                    value={aiDisclosureAck}
                    onValueChange={value => {
                      setAiDisclosureAck(value);
                      setAIDisclosureAck(value);
                    }}
                  />
                }
              />
              <SettingItem
                icon="document-text-outline"
                title="Manage memory"
                onPress={() => router.push('/kaizen/memory')}
                showChevron
              />
            </View>

            {biometricAvailable && (
              <View style={styles.section}>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                  SECURITY
                </Typography>
                <SettingItem
                  icon={
                    biometricType === 'Face ID' || biometricType === 'Face Recognition'
                      ? 'scan-outline'
                      : 'finger-print-outline'
                  }
                  title={biometricType}
                  subtitle={biometricEnabled ? 'Enabled for quick sign in' : 'Enable for faster login'}
                  testID="settings-row-biometric"
                  rightElement={
                    <Toggle
                      value={biometricEnabled}
                      onValueChange={value => void handleBiometricToggle(value)}
                      disabled={biometricLoading}
                      testID="settings-toggle-biometric"
                      accessibilityLabel={`${biometricType} quick sign in`}
                    />
                  }
                />
              </View>
            )}

            <View style={styles.footer}>
              <Button
                title="Re-run onboarding"
                variant="outline"
                fullWidth
                onPress={() => void rerunOnboarding()}
              />
            </View>
            <View style={styles.logoutButton}>
              <Button
                title="Log out"
                variant="secondary"
                fullWidth
                onPress={() => void logout()}
                testID="kaizen-settings-logout"
              />
            </View>
            <ScreenScrollEnd testID={screenScrollEndTestId('kaizen-settings-screen')} />
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    paddingTop: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
  },
  intro: {
    marginBottom: Spacing.md,
    marginLeft: Spacing.xs,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    letterSpacing: 0.5,
  },
  card: {
    padding: Spacing.base,
    marginBottom: Spacing.sm,
    borderRadius: 12,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  iconTile: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  settingContent: {
    flex: 1,
  },
  settingRight: {
    marginLeft: 12,
  },
  footer: {
    marginTop: 8,
  },
  logoutButton: {
    marginTop: 12,
  },
});
