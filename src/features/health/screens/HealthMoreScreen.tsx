import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Linking } from 'react-native';

import type { HealthWidgetPreferences } from '@api/healthAssets';
import { useAIAccessEntry } from '@components/ai/useAIAccessEntry';
import {
  AppBackground,
  ProcessingOverlay,
  ScreenHeader,
  ScreenScrollEnd,
  screenScrollEndTestId,
} from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { TabOverflowSection } from '@components/navigation/TabOverflowSection';
import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { HEALTH_FEATURES } from '@config/healthFeatures';
import { useDeviceType } from '@hooks/useDeviceType';
import { useDismissiblePermissionBanner } from '@hooks/useDismissiblePermissionBanner';
import { useHealthFeatures } from '@hooks/useHealthFeature';
import { useIsAdmin } from '@hooks/useIsAdmin';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useAuthStore } from '@stores/authStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';

import { HealthKitConnectCard } from '../components/HealthKitConnectCard';
import { HealthKitSyncProgressModal } from '../components/HealthKitSyncProgressModal';
import { clearAllHealthData, HEALTH_CLEAR_DELETES, HEALTH_CLEAR_KEPT } from '../healthDataReset';
import { exportHealthData } from '../healthExport';
import {
  DEFAULT_HEALTH_PREFS,
  HEALTH_UNIT_SYSTEMS,
  loadHealthPrefs,
  setUnitSystem,
  type HealthPrefs,
  type HealthUnitSystem,
} from '../healthLocalStorage';
import {
  DEFAULT_HEALTH_NOTIFICATION_PREFERENCES,
  describeNotificationPreferences,
  loadNotificationPreferences,
  type HealthNotificationPreferences,
} from '../healthSettingsStorage';
import {
  DEFAULT_HEALTH_WIDGET_PREFERENCES,
  describeWidgetPreferences,
  loadWidgetPreferences,
} from '../healthWidgetStorage';
import { isHealthLocalFirst } from '../local/flag';
import { useHealthKitConnection } from '../useHealthKitConnection';

const UNIT_SYSTEM_LABELS: Record<HealthUnitSystem, string> = {
  metric: 'Metric (kg, cm, km)',
  imperial: 'Imperial (lb, ft/in, mi)',
};

interface SettingItemProps {
  icon: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  showChevron?: boolean;
  /** `forward` for navigation; `down`/`up` for a row that expands in place. */
  chevron?: 'forward' | 'down' | 'up';
  danger?: boolean;
  testID?: string;
}

function SettingItem({ icon, title, subtitle, onPress, showChevron = true, chevron = 'forward', danger, testID }: SettingItemProps) {  const colors = useAppColors();
  const tint = danger ? colors.error : colors.primary;

  return (
    <Card
      variant="filled"
      pressable={!!onPress}
      onPress={onPress}
      style={[styles.settingItem, { backgroundColor: colors.backgroundSecondary }]}
      testID={testID}
    >
      <View style={styles.settingIcon}>
            <View style={[styles.iconTile, { backgroundColor: tint + '1F' }]}>
              <Icon name={icon} size={18} color={danger ? colors.error : colors.textPrimary} />
            </View>
      </View>
      <View style={styles.settingContent}>
        <Typography variant="body" weight="medium" color={danger ? colors.error : colors.textPrimary}>
          {title}
        </Typography>
        {subtitle && (
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID={testID ? `${testID}-subtitle` : undefined}
          >
            {subtitle}
          </Typography>
        )}
      </View>
      {showChevron && onPress && (
        <View style={styles.chevronContainer}>
          <Icon name={`chevron-${chevron}`} size={20} color={colors.textSecondary} />
        </View>
      )}
    </Card>
  );
}

export function HealthMoreScreen() {
  const aiEntry = useAIAccessEntry();
  const colors = useAppColors();
  const router = useRouter();
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const logout = useAuthStore((state) => state.logout);
  // The switchboard is staff tooling — a common user never sees the row, and
  // `HealthFeaturesScreen` redirects them anyway if they reach the route by
  // some other path.
  const isAdmin = useIsAdmin();
  const features = useHealthFeatures();
  const featuresOnCount = HEALTH_FEATURES.filter((f) => features[f.key]).length;
  // Bundle-time constant (`EXPO_PUBLIC_HEALTH_LOCAL_FIRST`), so it never
  // changes under a mounted screen — read inline rather than held in state.
  const localFirstOn = isHealthLocalFirst();

  const [prefs, setPrefs] = useState<HealthPrefs>(DEFAULT_HEALTH_PREFS);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [notifyPrefs, setNotifyPrefs] = useState<HealthNotificationPreferences>(
    DEFAULT_HEALTH_NOTIFICATION_PREFERENCES
  );
  const [widgetPrefs, setWidgetPrefs] = useState<HealthWidgetPreferences>(
    DEFAULT_HEALTH_WIDGET_PREFERENCES
  );
  const [confirmingClear, setConfirmingClear] = useState(false);
  /** Which blocking data job is running, if any — drives `ProcessingOverlay`. */
  const [dataBusy, setDataBusy] = useState<'export' | 'clear' | null>(null);
  // Apple Health lives here (and, per donor parity, on Activity) rather than
  // on Home: it is a one-time setup choice, and the card carries the scope
  // disclosure the user should read before granting.
  const {
    status: healthKitStatus,
    busy: healthKitBusy,
    syncing: healthKitSyncing,
    progress: healthKitProgress,
    connectOrSync: handleHealthKit,
  } = useHealthKitConnection();
  const healthKitBanner = useDismissiblePermissionBanner(healthKitStatus !== null);

  useEffect(() => {
    void loadHealthPrefs().then(setPrefs);
    // Both preference reads go through the read-through cache and cannot
    // reject: a network failure resolves the cached (or documented default)
    // value, so these subtitles always say something true rather than nothing.
    void loadNotificationPreferences().then(setNotifyPrefs);
    void loadWidgetPreferences().then(setWidgetPrefs);
  }, []);

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  /**
   * A REAL picker, not an Alert.
   *
   * The Alert this replaces could not show which unit was already chosen (an
   * iOS alert has no selected state), so the member had to close it, read the
   * subtitle, and open it again to be sure. Both options and the current one are
   * on screen together here, and the row stays put after a change.
   */
  const chooseUnitSystem = useCallback(async (system: HealthUnitSystem) => {
    setUnitsOpen(false);
    // Optimistic, then authoritative: `setUnitSystem` writes through and
    // returns the stored prefs, so a failed write can never leave the row
    // claiming a unit the rest of the app is not using.
    setPrefs((current) => ({ ...current, unitSystem: system }));
    setPrefs(await setUnitSystem(system));
  }, []);

  /** Export runs to completion or says why not — never a raw error string. */
  const handleExport = useCallback(async () => {
    setDataBusy('export');
    const result = await exportHealthData();
    setDataBusy(null);
    Alert.alert(result.status === 'shared' ? 'Export ready' : 'Export', result.message);
  }, []);

  /**
   * THE destructive verb, and the second of its two deliberate steps.
   *
   * Step one is the row expanding into a panel that enumerates exactly what
   * goes and what stays; only the button inside that panel reaches this system
   * confirmation, and only its destructive choice does any deleting.
   */
  const handleClearAll = useCallback(() => {
    Alert.alert(
      'Delete all health data?',
      'This deletes your entries from your Symply Health account and from this device. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDataBusy('clear');
              const result = await clearAllHealthData();
              setDataBusy(null);
              setConfirmingClear(false);
              // Re-read: the caches were dropped, so this falls back to the
              // documented defaults instead of showing the deleted state back.
              void loadHealthPrefs().then(setPrefs);
              Alert.alert(
                result.status === 'cleared' ? 'Health data deleted' : 'Not everything was deleted',
                result.message
              );
            })();
          },
        },
      ]
    );
  }, []);

  const showInfo = (title: string, message: string) => Alert.alert(title, message);

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="health-more-screen">
        <ScreenHeader
          title="More"
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        <AdaptiveContainer maxWidth={isTablet ? 1000 : undefined} padding={containerPadding}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            testID="health-more-scroll"
          >
            {/* Health uses the customizable-tabs model (donor parity), so the
                unpinned section tabs and "Customize Tabs" live at the top. */}
            <TabOverflowSection />

            <View style={styles.section}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                ACCOUNT
              </Typography>
              <SettingItem
                icon="person-outline"
                title="Profile"
                subtitle="Name, photo, and account"
                onPress={() => router.push('/profile')}
                testID="health-setting-profile"
              />
            </View>

            <View style={styles.section}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                PREFERENCES
              </Typography>
              <SettingItem
                icon="options-outline"
                title="Units"
                subtitle={UNIT_SYSTEM_LABELS[prefs.unitSystem]}
                onPress={() => setUnitsOpen((open) => !open)}
                chevron={unitsOpen ? 'up' : 'down'}
                testID="health-setting-units"
              />
              {unitsOpen && (
                <Card
                  variant="filled"
                  style={[styles.panel, { backgroundColor: colors.backgroundSecondary }]}
                  testID="health-units-picker"
                >
                  {HEALTH_UNIT_SYSTEMS.map((system) => {
                    const active = prefs.unitSystem === system;
                    return (
                      <Pressable
                        key={system}
                        onPress={() => void chooseUnitSystem(system)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        testID={`health-unit-system-${system}`}
                        style={styles.optionRow}
                      >
                        <Typography
                          variant="body"
                          weight={active ? 'semibold' : 'regular'}
                          color={active ? colors.primary : colors.textPrimary}
                        >
                          {UNIT_SYSTEM_LABELS[system]}
                        </Typography>
                        {active && <Icon name="complete" size={18} color={colors.primary} />}
                      </Pressable>
                    );
                  })}
                </Card>
              )}
              {/* The Goals tab is a full section screen (`/health-goals`); this
                  is the settings-shaped way in, so a member looking for their
                  targets under Preferences finds them. */}
              <SettingItem
                icon="goals"
                title="Goals and targets"
                subtitle="Calories, macros, water, steps and your weight goal"
                onPress={() => router.push('/health-goals')}
                testID="health-setting-goals"
              />
              <SettingItem
                icon="notifications"
                title="Notifications"
                subtitle={describeNotificationPreferences(notifyPrefs)}
                onPress={() => router.push('/health-notifications')}
                testID="health-setting-notifications"
              />
              <SettingItem
                icon="widget-mark"
                title="Widget"
                subtitle={describeWidgetPreferences(widgetPrefs)}
                onPress={() => router.push('/health-widget')}
                testID="health-setting-widget"
              />
            </View>

            {isAdmin && (
              <View style={styles.section}>
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  style={styles.sectionHeader}
                >
                  ADMIN
                </Typography>
                <SettingItem
                  icon="settings-outline"
                  title="Health features"
                  subtitle={`${featuresOnCount} of ${HEALTH_FEATURES.length} trackers on`}
                  onPress={() => router.push('/health-features')}
                  testID="health-setting-features"
                />
              </View>
            )}

            {/* Second-device enrolment (plan §6 / He5). Hidden entirely on a
                flag-0 build: without the local ledger there is no key to hand
                over and nothing to pair, so a row here would offer a setup that
                cannot complete.

                Placed ABOVE "PRIVACY & DATA" on purpose. `td-40` scrolls More
                to the bottom and asserts the "Where your data lives" subtitle is
                still on screen; a row inserted below it shifts that row up
                within the bottom-anchored viewport, while one inserted above
                moves the row and the viewport by the same amount and changes
                nothing. */}
            {localFirstOn && (
              <View style={styles.section}>
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  style={styles.sectionHeader}
                >
                  YOUR DEVICES
                </Typography>
                <SettingItem
                  icon="phone-portrait-outline"
                  // Health has one user and N devices — never a member to
                  // invite (plan §1.2). The wording is `HEALTH_ENROLMENT_COPY`'s
                  // and `td-40` sweeps every screen for the alternative.
                  title="Add your other device"
                  subtitle="Set up Symply Health on your phone or tablet too"
                  onPress={() => router.push('/health-other-device')}
                  testID="health-setting-other-device"
                />
              </View>
            )}

            <View style={styles.section}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                PRIVACY &amp; DATA
              </Typography>
              <SettingItem
                icon="local-only"
                title="Where your data lives"
                subtitle="Private to your account, synced across your devices"
                onPress={() =>
                  showInfo(
                    'Where your data lives',
                    'Your health entries are stored in your own private Symply Health account so they stay in step across your devices. They are never shared with other Symply apps, never shown to anyone else, and never sent to an AI provider. Signing out clears the copy cached on this device.',
                  )
                }
                testID="health-setting-on-device-storage"
              />
              {/* Replaces the old static "not connected" row. The card owns every
                  state (unavailable / not-requested / denied / connected); the
                  data-type list and manual-entry promise are one (i) tap away
                  via `layout="compact"` rather than filling the settings list. */}
              {healthKitBanner.visible && healthKitStatus ? (
                <HealthKitConnectCard
                  state={healthKitStatus.state}
                  lastSyncedAt={healthKitStatus.lastSyncedAt}
                  onConnect={() => void handleHealthKit()}
                  onOpenSettings={() => void Linking.openSettings()}
                  onDismiss={healthKitBanner.dismiss}
                  busy={healthKitBusy}
                  layout="compact"
                  testID="health-setting-apple-health"
                />
              ) : null}
              {aiEntry.show && (
                <SettingItem
                  icon={aiEntry.icon}
                  title={aiEntry.title}
                  subtitle={aiEntry.subtitle}
                  onPress={() => router.push(aiEntry.route)}
                  testID="health-setting-ai-assistance"
                />
              )}
              <SettingItem
                icon="export-data"
                title="Export my data"
                subtitle="Save everything in your account as one file"
                onPress={() => void handleExport()}
                testID="health-setting-export"
              />
              <SettingItem
                icon="delete-data"
                title="Clear all health data"
                subtitle="Delete every entry from your account and this device"
                onPress={() => setConfirmingClear((open) => !open)}
                chevron={confirmingClear ? 'up' : 'down'}
                danger
                testID="health-setting-clear-data"
              />
              {confirmingClear && (
                <Card
                  variant="filled"
                  style={[styles.panel, { backgroundColor: colors.backgroundSecondary }]}
                  testID="health-clear-data-panel"
                >
                  <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                    This deletes
                  </Typography>
                  {HEALTH_CLEAR_DELETES.map((line) => (
                    <Typography key={line} variant="footnote" color={colors.textSecondary}>
                      {`•  ${line}`}
                    </Typography>
                  ))}
                  <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                    This is kept
                  </Typography>
                  {HEALTH_CLEAR_KEPT.map((line) => (
                    <Typography key={line} variant="footnote" color={colors.textSecondary}>
                      {`•  ${line}`}
                    </Typography>
                  ))}
                  <Typography variant="footnote" color={colors.textSecondary}>
                    It cannot be undone, and it applies to every device you use Symply Health on.
                  </Typography>
                  <Pressable
                    onPress={handleClearAll}
                    accessibilityRole="button"
                    testID="health-clear-data-confirm"
                    style={[styles.dangerButton, { borderColor: colors.error }]}
                  >
                    <Typography variant="body" weight="semibold" color={colors.error}>
                      Delete everything
                    </Typography>
                  </Pressable>
                </Card>
              )}
            </View>

            <View style={styles.section}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                MORE SYMPLY APPS
              </Typography>
              <SettingItem
                icon="apps-outline"
                title="Symply apps"
                subtitle="Install the rest of the family and share your profile"
                onPress={() => router.push('/symply-apps')}
                testID="health-setting-symply-apps"
              />
            </View>

            <View style={styles.section}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionHeader}>
                COMING SOON
              </Typography>
              {/* The "Apple Health sync" roadmap row that used to sit here is
                  gone: `HealthKitConnectCard` above IS that feature, shipped and
                  connectable, so the row was telling the member a working
                  capability had not been built yet. */}
              <SettingItem
                icon="body-photos"
                title="Body photos &amp; progress compare"
                subtitle="Needs its own storage and deletion review first"
                showChevron={false}
              />
            </View>

            <View style={styles.section}>
              <SettingItem icon="log-out-outline" title="Sign out" onPress={handleSignOut} showChevron={false} danger testID="health-sign-out" />
            </View>
            <ScreenScrollEnd testID={screenScrollEndTestId('health-more-screen')} />
          </ScrollView>
        </AdaptiveContainer>

        {/* Both jobs walk the WHOLE account, so they are the two places on this
            screen a second tap must not start a second run. The shared overlay
            blocks the screen rather than each row inventing its own spinner. */}
        <ProcessingOverlay
          visible={dataBusy !== null}
          message={dataBusy === 'clear' ? 'Deleting your health data…' : 'Preparing your export…'}
          caption={
            dataBusy === 'clear'
              ? 'Removing every entry from your account'
              : 'Collecting every entry in your account'
          }
          testID="health-data-overlay"
        />

        <HealthKitSyncProgressModal
          visible={healthKitSyncing}
          progress={healthKitProgress}
          testID="health-setting-apple-health-sync-progress"
        />
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
  section: {
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    letterSpacing: 0.6,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  settingIcon: {
    marginRight: Spacing.md,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingContent: {
    flex: 1,
  },
  chevronContainer: {
    marginLeft: Spacing.sm,
  },
  /** The in-place expansion under a row (units picker, erase confirmation). */
  panel: {
    padding: Spacing.base,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  dangerButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: CornerRadius.xxl,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
  },
});
