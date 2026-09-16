import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import {
  isFullBudget,
  isHealthCapableBrand,
  isHouseBrand,
  isLanguageCapableBrand,
  isSmartEngineCapableBrand,
} from '@brand';
import { useAIAccessEntry } from '@components/ai/useAIAccessEntry';
import { AppBackground, AppVersionFooter, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, SettingsGearButton } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { TabOverflowSection } from '@components/navigation/TabOverflowSection';
import { Card, Toggle, Typography } from '@components/ui';
import { Icon, hasBrandIcon } from '@components/ui/Icon';
import { resolveCurrency } from '@config/currencies';
import { formatRegionLabel } from '@config/regions';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { SettingsStackScreenProps } from '@navigation/types';
import { biometricService } from '@services/biometric';
import { useAppStore } from '@stores/appStore';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { Layout, useAppColors } from '@theme';

interface SettingItemProps {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconElement?: React.ReactNode;
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
  iconElement,
  title,
  subtitle,
  rightElement,
  onPress,
  showChevron = false,
  testID,
}: SettingItemProps) {
  const colors = useAppColors();  const tint = iconColor ?? colors.primary;

  return (
    <Card
      variant="filled"
      pressable={!!onPress}
      onPress={onPress}
      testID={testID}
      style={[styles.settingItem, { backgroundColor: colors.backgroundSecondary }]}
    >
      <View style={styles.settingIcon}>
        {iconElement ??
          (icon && (
            <View style={styles.iconTile}>
              <Icon
                name={icon}
                size={28}
                color={tint}
                active={hasBrandIcon(icon)}
              />
            </View>
          ))}
      </View>
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
        <View style={styles.chevron}>
          <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
        </View>
      )}
    </Card>
  );
}

export function SettingsScreen({ navigation }: SettingsStackScreenProps<'SettingsMain'>) {
  const colors = useAppColors();
  const router = useRouter();
  const { isTablet } = useDeviceType();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);
  const currency = useAppStore((state) => state.currency);
  const taxCountry = useAppStore((state) => state.taxCountry);
  const taxRegion = useAppStore((state) => state.taxRegion);
  // Shared AI-access entry — identical gate, destination, and copy for every
  // brand (see @components/ai/useAIAccessEntry). Never re-derive this per brand.
  const aiEntry = useAIAccessEntry();

  /**
   * True when this brand's More tab is the OVERFLOW HUB and nothing else: the
   * tabs that did not fit the bottom bar, the screen that changes which ones do,
   * and the read-only Insights view. Its settings live behind the gear that now
   * sits on every tab header — `/house-settings` for House, `BudgetSettings` for
   * full Budget — because a settings list reached only from a tab called "More"
   * put every preference three taps and a scroll from wherever the member was,
   * and made one tab name mean two unrelated things.
   *
   * Everything below that this hides was MOVED, not deleted:
   *  - preferences, units, AI config, notifications, data sharing → the gear;
   *  - household, invites, device sync, backup, quick sign-in, Terms/Privacy →
   *    Profile, which is where the account already lived (Sign out is there).
   */
  const moreIsOverflowHub = isHouseBrand();

  /**
   * Open a screen on the Budget STACK from this tab.
   *
   * `router.push` is NOT the door. An imperative push to `/` re-focuses a tab
   * that is already mounted without delivering the new params, so the stack
   * never sees `screen` and you land on the Budget dashboard — the same finding
   * as the Profile gear and `app/_layout.tsx`. `navNonce` is required on top of
   * it because NavigationHandler dedupes on `screen:itemId:navNonce`, so
   * without a fresh one every visit after the first is swallowed.
   */
  const openBudgetStackScreen = (screen: string) => {
    const url = Linking.createURL('/', {
      queryParams: { screen, navNonce: String(Date.now()) },
    });
    Linking.openURL(url).catch((error) => {
      console.warn('[more] could not open', screen, error);
    });
  };

  // Consistent layout padding
  const { content: containerPadding } = useLayoutPadding();

  // Biometric state
  const user = useAuthStore((state) => state.user);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const logout = useAuthStore((state) => state.logout);
  const biometricEnabled = useAuthStore((state) => state.biometricEnabled);
  const setBiometricEnabled = useAuthStore((state) => state.setBiometricEnabled);

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState<string>('Biometrics');
  const [biometricLoading, setBiometricLoading] = useState(false);

  // Check biometric availability
  useEffect(() => {
    const checkBiometric = async () => {
      const available = await biometricService.isAvailable();
      setBiometricAvailable(available);
      if (available) {
        const typeName = await biometricService.getBiometricTypeName();
        setBiometricType(typeName);
      }
    };
    checkBiometric();
  }, []);

  const handleBiometricToggle = async (enabled: boolean) => {
    if (!user || !refreshToken) return;

    setBiometricLoading(true);
    try {
      if (enabled) {
        const success = await biometricService.enableBiometric({
          email: user.email,
          refreshToken: refreshToken,
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

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="settings-screen">
        <ScreenHeader
          rightElement={<SettingsGearButton />}
          onNotificationPress={() => router.push('/notifications')}
          onProfilePress={() => router.push('/profile')}
        />

        <AdaptiveContainer maxWidth={isTablet ? 1000 : undefined} padding={containerPadding}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
          {/* Customizable-tabs model: overflow tabs + "Customize Tabs" at the
              top of the More hub. No-op for brands without customizable tabs.

              House's own Customization row (home-screen widgets + navigation
              layout) rides in the same group rather than in PREFERENCES, where
              it used to sit: it is the other half of "change what this app shows
              me", and PREFERENCES moved behind the gear. */}
          <TabOverflowSection
            extraCustomizationRows={
              moreIsOverflowHub ? (
                <SettingItem
                  icon="options-outline"
                  iconColor={colors.blue}
                  title="Customization"
                  subtitle="Home screen, navigation layout"
                  onPress={() => navigation.navigate('Customization')}
                  showChevron
                  testID="settings-row-customization"
                />
              ) : undefined
            }
          />

          {/*
            INSIGHTS — the read-only view of what the app has worked out.

            The AI Insights Dashboard is not a setting: nothing on it configures
            the home, it only reads it and shows suggestions and predictions. It
            used to be the middle row of the AI section, between two screens that
            DO configure things, so it was both hard to find and mis-filed. More
            is the hub for everything that is not a pinned tab, which is where a
            read-only view belongs — the same move full Budget made with its
            year-scale views.
          */}
          {(moreIsOverflowHub || isFullBudget()) && (
            <View style={styles.section} testID="settings-section-insights">
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                INSIGHTS
              </Typography>

              {/* House's own reason for this group. Kept behind its own gate so
                  the two brands' rows do not depend on each other. */}
              {moreIsOverflowHub && (
                <SettingItem
                  icon="bulb-outline"
                  iconColor={colors.warning}
                  title="AI Insights Dashboard"
                  subtitle="View suggestions, predictions, and insights"
                  onPress={() => navigation.navigate('AIInsightsDashboard')}
                  showChevron
                  testID="settings-row-ai-insights"
                />
              )}

              {/*
                BUDGET'S YEAR-SCALE VIEWS — the only door to three screens.
                Long-term plan, Previous years and Compare years are registered
                on the Budget stack and reachable from nowhere else: removing
                these rows did not hide a feature, it orphaned three built and
                tested screens (only SavingsYearHistory -> SavingsCompareYears
                survived, and nothing reaches YearHistory). They are not
                settings — nothing on them configures anything, they READ the
                budget over a longer horizon than the dashboard — which is why
                they belong in this hub rather than in a settings group.
              */}
              {isFullBudget() && (
                <>
                  <SettingItem
                    icon="trending-up-outline"
                    iconColor={colors.primary}
                    title="Long-term plan"
                    subtitle="1–10 year timeline"
                    onPress={() => openBudgetStackScreen('BudgetLongTermTimeline')}
                    showChevron
                    testID="settings-row-budget-timeline"
                  />

                  <SettingItem
                    icon="calendar-outline"
                    iconColor={colors.primary}
                    title="Previous years"
                    subtitle="Import & monthly history"
                    onPress={() => openBudgetStackScreen('SavingsYearHistory')}
                    showChevron
                    testID="settings-row-budget-year-history"
                  />

                  <SettingItem
                    icon="stats-chart-outline"
                    iconColor={colors.primary}
                    title="Compare years"
                    subtitle="Year-over-year"
                    onPress={() => openBudgetStackScreen('SavingsCompareYears')}
                    showChevron
                    testID="settings-row-budget-compare-years"
                  />
                </>
              )}
            </View>
          )}

          {/*
            ACCOUNT — every brand whose More tab is still a settings list.

            House's rows all have a better home on PROFILE (see
            `@components/house/HouseSyncSharingSection`): who shares this home,
            which devices hold it, where the backups are and how you sign in are
            facts about the account and the device, and Profile is already the
            account screen — Sign out and Delete account are on it.
          */}
          {!moreIsOverflowHub && (
          <View style={styles.section}>
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              style={styles.sectionHeader}
            >
              ACCOUNT
            </Typography>

            {/* Budget's household lives entirely on Invite & Household now —
                who is in it, the invite and join flows, and the households on
                this device. This row used to open the household MANAGER, which
                was one screen away from every other household question and left
                the answer split across two navigation trees. Every other brand
                keeps the property-oriented manager, which is a different model
                (server roles, emailed invitations, addresses).

                House's copy of this row is on Profile now, with the rest of the
                enrolment rows (Invite & home, Device sync, Backup & Restore)
                that used to follow it here — see `HouseSyncSharingSection`. */}
            <SettingItem
              icon="home-outline"
              iconColor={colors.primary}
              title={isFullBudget() ? 'Invite & Household' : 'Household & Members'}
              subtitle={
                currentHousehold
                  ? `${currentHousehold.name} • ${
                      isFullBudget() ? 'members, invites and households' : 'manage members'
                    }`
                  : 'No household yet'
              }
              // Two calls rather than a ternary inside one: `navigate` is typed
              // per route name, and a union of two names widens the params to
              // the intersection — which is `never`.
              onPress={() => {
                if (isFullBudget()) navigation.navigate('BudgetInvite');
                else navigation.navigate('HouseholdManagement');
              }}
              showChevron
              testID="settings-row-household-members"
            />

            {biometricAvailable && (
              <SettingItem
                icon={
                  biometricType === 'Face ID' || biometricType === 'Face Recognition'
                    ? 'scan-outline'
                    : 'finger-print-outline'
                }
                iconColor={colors.primary}
                title={biometricType}
                subtitle={biometricEnabled ? 'Enabled for quick sign in' : 'Enable for faster login'}
                testID="settings-row-biometric"
                rightElement={
                  <Toggle
                    value={biometricEnabled}
                    onValueChange={handleBiometricToggle}
                    disabled={biometricLoading}
                    testID="settings-toggle-biometric"
                    accessibilityLabel={`${biometricType} quick sign in`}
                  />
                }
              />
            )}
          </View>
          )}

          {/* Preferences moved behind the gear on every tab header for the
              overflow-hub brands, so More is exactly what its name says there:
              the tabs that did not fit the bottom bar, and nothing else. */}
          {!moreIsOverflowHub && (
          <View style={styles.section}>
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              style={styles.sectionHeader}
            >
              PREFERENCES
            </Typography>

            <SettingItem
              icon="color-palette-outline"
              iconColor={colors.purple}
              title="Appearance"
              subtitle="Dark mode, theme settings"
              onPress={() => navigation.navigate('Appearance')}
              showChevron
              testID="settings-row-appearance"
            />

            <SettingItem
              icon="cash-outline"
              iconColor={colors.success}
              title="Currency"
              subtitle={`${resolveCurrency(currency).label} (${currency})`}
              onPress={() => navigation.navigate('Currency')}
              showChevron
              testID="settings-row-currency"
            />

            <SettingItem
              icon="location-outline"
              iconColor={colors.blue}
              title="Region"
              subtitle={
                formatRegionLabel(taxCountry, taxRegion) ??
                'Set for accurate receipt sales tax'
              }
              onPress={() => navigation.navigate('Region')}
              showChevron
              testID="settings-row-region"
            />
          </View>
          )}

          {/* AI — the shared AI-access entry. It is the SAME row for every brand
              (identical gate, destination, copy and icon, no per-brand fork) and
              the app's only "Manage AI access" affordance since the Profile
              subscription card's duplicate was removed. Source of truth:
              @components/ai/useAIAccessEntry.

              House's own AI rows are not here any more: the two that CONFIGURE
              the housekeeper moved behind the gear, and the Insights dashboard —
              which configures nothing, it only reads the home — moved up to the
              INSIGHTS group at the top of this screen. */}
          {!moreIsOverflowHub && aiEntry.show && (
            <View style={styles.section}>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                AI
              </Typography>

              <SettingItem
                icon={aiEntry.icon}
                // Brand teal, not iOS blue. Half these rows draw the brand PNG
                // (always teal) and half fall back to an Ionicons glyph tinted
                // with this value, so a leftover system hue only ever shows up
                // as one odd-coloured row in an otherwise teal column.
                iconColor={colors.primary}
                title={aiEntry.title}
                subtitle={aiEntry.subtitle}
                onPress={() => router.push(aiEntry.route)}
                showChevron
                testID="settings-row-ai-providers"
              />
            </View>
          )}

          {/* Notifications live behind the gear for the overflow-hub brands,
              next to Calendar Sync, which is the other half of "when does this
              app interrupt me". */}
          {!moreIsOverflowHub && (
          <View style={styles.section}>
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              style={styles.sectionHeader}
            >
              NOTIFICATIONS
            </Typography>

            <SettingItem
              icon="notifications-outline"
              iconColor={colors.red}
              title="Notification Settings"
              subtitle="Manage push and email notifications"
              onPress={() => navigation.navigate('NotificationSettings')}
              showChevron
              testID="settings-row-notification-settings"
            />
          </View>
          )}

          {/* Data sharing sits with "Connect Symply apps" behind the gear for
              the overflow-hub brands — the pair is one subject. */}
          {!moreIsOverflowHub &&
            isSmartEngineCapableBrand() &&
            (isFullBudget() || isHealthCapableBrand() || isLanguageCapableBrand()) && (
            <View style={styles.section}>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                DATA SHARING
              </Typography>

              {isHealthCapableBrand() ? (
                <SettingItem
                  icon="link-outline"
                  iconColor={colors.primary}
                  title="Import from Symply House"
                  subtitle="Profile basics for Health onboarding"
                  onPress={() =>
                    navigation.navigate('SoftTransferFlow', {
                      preset: 'house-to-health',
                      title: 'Import from Symply House',
                      fixedPackageId: 'profile.core.health.v1',
                    })
                  }
                  showChevron
                  testID="settings-row-health-soft-transfer"
                />
              ) : null}

              {isHealthCapableBrand() ? (
                <SettingItem
                  icon="arrow-up-outline"
                  iconColor={colors.primary}
                  title="Share with Symply House"
                  subtitle="High-level health check-in summary"
                  onPress={() =>
                    navigation.navigate('SoftTransferFlow', {
                      preset: 'health-to-house',
                      title: 'Share with Symply House',
                      fixedPackageId: 'health.summary.v1',
                    })
                  }
                  showChevron
                  testID="settings-row-health-soft-transfer-export"
                />
              ) : null}

              {isLanguageCapableBrand() ? (
                <SettingItem
                  icon="link-outline"
                  iconColor={colors.primary}
                  title="Import from Symply House"
                  subtitle="Profile basics for Language onboarding"
                  onPress={() =>
                    navigation.navigate('SoftTransferFlow', {
                      preset: 'house-to-language',
                      title: 'Import from Symply House',
                      fixedPackageId: 'profile.core.language.v1',
                    })
                  }
                  showChevron
                  testID="settings-row-language-soft-transfer"
                />
              ) : null}

              {isLanguageCapableBrand() ? (
                <SettingItem
                  icon="arrow-up-outline"
                  iconColor={colors.primary}
                  title="Share with Symply House"
                  subtitle="High-level learning summary"
                  onPress={() =>
                    navigation.navigate('SoftTransferFlow', {
                      preset: 'language-to-house',
                      title: 'Share with Symply House',
                      fixedPackageId: 'language.summary.v1',
                    })
                  }
                  showChevron
                  testID="settings-row-language-soft-transfer-export"
                />
              ) : null}

              <SettingItem
                icon="shield-checkmark-outline"
                iconColor={colors.primary}
                title="Data sharing"
                subtitle="View or revoke Soft Transfer permissions"
                onPress={() => navigation.navigate('DataSharing')}
                showChevron
                testID="settings-row-data-sharing"
              />
            </View>
          )}

          {/* The rest of the Symply family — install status + baseline data
              sharing. Available in every brand (each lists the other four); the
              overflow-hub brands carry it behind the gear. */}
          {!moreIsOverflowHub && (
          <View style={styles.section}>
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              style={styles.sectionHeader}
            >
              MORE SYMPLY APPS
            </Typography>

            <SettingItem
              icon="apps-outline"
              iconColor={colors.primary}
              title="Symply apps"
              subtitle="Install the rest of the family and share your profile"
              onPress={() => router.push('/symply-apps')}
              showChevron
              testID="settings-row-symply-apps"
            />
          </View>
          )}

          {isFullBudget() && (
            <View style={styles.section}>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                ACCOUNT
              </Typography>
              <SettingItem
                icon="log-out-outline"
                iconColor={colors.error}
                title="Sign out"
                onPress={handleSignOut}
                showChevron={false}
                testID="settings-row-sign-out"
              />
            </View>
          )}

          {/* ABOUT moved to Profile for the overflow-hub brands: Terms and
              Privacy are account-level documents, not app preferences, and
              Profile is the account screen. */}
          {!moreIsOverflowHub && (
          <View style={styles.section}>
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              style={styles.sectionHeader}
            >
              ABOUT
            </Typography>

            <SettingItem
              icon="document-text-outline"
              iconColor={colors.textSecondary}
              title="Terms of Service"
              onPress={() => navigation.navigate('TermsOfService')}
              showChevron
            />

            <SettingItem
              icon="lock-closed-outline"
              iconColor={colors.textSecondary}
              title="Privacy Policy"
              onPress={() => navigation.navigate('PrivacyPolicy')}
              showChevron
            />
          </View>
          )}

          <AppVersionFooter testID="settings-version-footer" />
          <ScreenScrollEnd testID={screenScrollEndTestId('settings-screen')} />
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
    paddingTop: 16,
    paddingBottom: Layout.bottomTabBarClearance,
    backgroundColor: 'transparent',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    marginBottom: 12,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  settingIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  iconTile: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingContent: {
    flex: 1,
  },
  settingRight: {
    marginLeft: 12,
  },
  chevron: {
    marginLeft: 8,
  },
  inlineUnitToggle: {
    flexDirection: 'row',
    gap: 6,
  },
  inlineUnitOption: {
    minWidth: 38,
    minHeight: 30,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  propertyModeCard: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 8,
  },
  propertyModeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  propertyModeIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  propertyModeInfo: {
    flex: 1,
  },
  propertyModeButtons: {
    gap: 10,
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  modeButtonIcon: {
    marginRight: 12,
  },
  modeButtonContent: {
    flex: 1,
  },
  currentPropertyBadge: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
});
