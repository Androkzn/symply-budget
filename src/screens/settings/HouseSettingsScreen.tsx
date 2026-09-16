/**
 * SETTINGS — House's own settings hub, reached from the gear.
 *
 * House's More tab used to be this screen: overflow tabs at the top and then
 * ten sections of settings below them, which meant every preference was three
 * taps and a scroll away from wherever the member actually was, and "More" named
 * two unrelated things at once. Full Budget answered that by putting a gear on
 * every tab header and moving its settings behind it; this is the same move for
 * House, and it is why the sections below are a MOVE rather than new surface —
 * each one is the JSX that used to render on `SettingsScreen`, gated there on
 * `isHouseBrand()`.
 *
 * What did NOT come here, and why:
 *  - MORE TABS / Customization / Insights stay on More. They are what the tab is
 *    for: the tabs that did not fit the bar, the screen that changes which ones
 *    do, and the read-only dashboard that is not a setting.
 *  - Household & Members, Invite & home, Device sync, Backup & Restore and quick
 *    sign-in moved to PROFILE (`@components/house/HouseSyncSharingSection`).
 *    Which copies of this home exist, who is let in and how you sign in are
 *    facts about the account and the device; this screen is what shapes the app.
 *  - Terms and Privacy moved to Profile for the same reason — account-level
 *    documents, not app preferences.
 *
 * The screen is House-only by construction (nothing else navigates to
 * `HouseSettings`), so the rows below carry no brand gate — only the data gates
 * they always had (`households.length > 1`, an active household, the AI entry's
 * own gate).
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Alert, ScrollView, StyleSheet, View, TouchableOpacity } from 'react-native';

import { householdsApi, type HouseUnitSystem } from '@api/households';
import { useAIAccessEntry } from '@components/ai/useAIAccessEntry';
import { PersonaAvatar } from '@components/aihousekeeper';
import { AppBackground, AppVersionFooter, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, Typography, IconBackgroundChip } from '@components/ui';
import { Icon, hasBrandIcon } from '@components/ui/Icon';
import { resolveCurrency } from '@config/currencies';
import { formatRegionLabel } from '@config/regions';
import { useData } from '@contexts/DataContext';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { SettingsStackScreenProps } from '@navigation/types';
import { settingsSync } from '@services/settings-sync';
import { useAppStore } from '@stores/appStore';
import { useHouseholdStore, type PropertyMode } from '@stores/householdStore';
import { useSettingsStore } from '@stores/settingsStore';
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

/**
 * The row primitive, identical to `SettingsScreen`'s.
 *
 * Deliberately a copy rather than a shared export: these rows MOVED off that
 * screen, and a member should not be able to tell that the gear opened a
 * different file. Every screen in this app owns its own `SettingItem` (see the
 * note on `@components/ai/useAIAccessEntry`) — what must not diverge is the
 * row's DATA, which is why the AI entry comes from a hook and not from here.
 */
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

export function HouseSettingsScreen({ navigation }: SettingsStackScreenProps<'HouseSettings'>) {
  const colors = useAppColors();
  const router = useRouter();
  const { isTablet } = useDeviceType();
  const { refreshActivePropertyData } = useData();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);
  const households = useHouseholdStore((state) => state.households);
  const propertyMode = useHouseholdStore((state) => state.propertyMode);
  const setPropertyMode = useHouseholdStore((state) => state.setPropertyMode);
  const updateHousehold = useHouseholdStore((state) => state.updateHousehold);
  const { persona, name: personaName } = useAihousekeeperPersona();
  const currency = useAppStore((state) => state.currency);
  const taxCountry = useAppStore((state) => state.taxCountry);
  const taxRegion = useAppStore((state) => state.taxRegion);
  // Shared AI-access entry — identical gate, destination, and copy for every
  // brand (see @components/ai/useAIAccessEntry). Never re-derive this per brand.
  const aiEntry = useAIAccessEntry();
  const measurementUnit = useSettingsStore((state) =>
    (state.settings['garden.measurementUnit'] as 'feet' | 'meters' | undefined) ?? 'meters'
  );
  const setSetting = useSettingsStore((state) => state.setSetting);

  const { content: containerPadding } = useLayoutPadding();

  /**
   * Back leaves the HUB, which is usually the bottom of its own stack.
   *
   * `/house-settings` mounts this navigator with `HouseSettings` as the initial
   * route, so there is nothing beneath it to pop and `goBack()` is a silent
   * no-op — the member taps a live-looking chevron and stays put. The route
   * ABOVE the tabs is the thing to pop in that case, which is `router.back()`.
   * The stack's own `goBack` still wins when this screen was pushed onto one
   * (the same shape `ProfileScreen.handleBack` uses).
   */
  const handleBack = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    router.back();
  };

  const handlePropertyModeChange = async (mode: PropertyMode) => {
    setPropertyMode(mode);
    await refreshActivePropertyData();
  };

  /**
   * Default to metric when missing — it travels with the toggle it defaults.
   *
   * It used to run whenever the More tab mounted, which was earlier but no more
   * correct: both readers of `garden.measurementUnit` already fall back to a
   * default of their own (`GardenPlanVectorEditor`, `useBoundaryEditor`), so
   * what this actually does is PERSIST and sync the implicit answer. Doing that
   * next to the control is enough, and it stops a tab the member opened for
   * something else from writing a setting they never touched.
   */
  useEffect(() => {
    const store = useSettingsStore.getState();
    const existing = store.settings['garden.measurementUnit'] as 'feet' | 'meters' | undefined;
    if (!existing) {
      setSetting('garden.measurementUnit', 'meters');
      settingsSync.queueSync('garden.measurementUnit', 'meters');
    }
  }, [setSetting]);

  const setMeasurementUnit = (unit: 'feet' | 'meters') => {
    setSetting('garden.measurementUnit', unit);
    settingsSync.queueSync('garden.measurementUnit', unit);
  };

  /**
   * Room/space AREA units (sqft/sqm) — household-wide, server-synced on
   * `households.unit_system` (0142), distinct from `garden.measurementUnit`
   * above (a per-user, device-synced LINEAR ft/m preference for plan/garden
   * object size labels only).
   */
  const chooseAreaUnitSystem = async (system: HouseUnitSystem) => {
    if (!currentHousehold || currentHousehold.unit_system === system) return;
    const householdId = currentHousehold.id;
    updateHousehold(householdId, { unit_system: system });
    try {
      const response = await householdsApi.update(householdId, { unit_system: system });
      updateHousehold(householdId, response.household);
    } catch {
      updateHousehold(householdId, { unit_system: currentHousehold.unit_system });
      Alert.alert('Error', 'Could not update units. Please try again.');
    }
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="house-settings-screen">
        <ScreenHeader
          title="Settings"
          showBackButton
          onBackPress={handleBack}
          showNotificationBell={false}
          showAvatar={false}
        />

        <AdaptiveContainer maxWidth={isTablet ? 1000 : undefined} padding={containerPadding}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.section} testID="house-settings-section-home">
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                HOME
              </Typography>

              {/*
                Floor Plans is the only House home feature that still lives in a
                settings list. Spaces, Garden and Projects are tab-pool entries,
                so they are reached from "MORE TABS" (or the bottom bar once
                pinned) — listing them here as well is what made Garden appear
                twice on the old screen.
              */}
              <SettingItem
                icon="grid-outline"
                iconColor={colors.info}
                title="Floor Plans"
                subtitle="View and manage property floor plans"
                onPress={() => navigation.navigate('FloorPlansMain')}
                showChevron
                testID="settings-row-floor-plans"
              />
            </View>

            {/* Multi-Property Mode — House-only, and it STAYS House-only now
                that BR-016 has given Budget a household switcher.

                The two are different features that happen to share a store
                field. Switching is SELECTION — "which one household am I looking
                at" — and every brand that can hold several can serve it; that is
                what `PropertySwitcher` in the header does. This section is
                AGGREGATION — "show me all of them combined" — and only House can
                serve that: `DataContext.fetchPropertyData` fans out over
                `getActiveHouseholdIds()` and merges N households' reports and
                tasks from the server. */}
            {households.length > 1 && (
              <View style={styles.section}>
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  style={styles.sectionHeader}
                >
                  MULTI-PROPERTY
                </Typography>

                <Card
                  variant="filled"
                  style={[styles.propertyModeCard, { backgroundColor: colors.backgroundSecondary }]}
                >
                  <View style={styles.propertyModeHeader}>
                    <IconBackgroundChip name="business-outline" size={22} style={styles.propertyModeIcon} />
                    <View style={styles.propertyModeInfo}>
                      <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                        Property View Mode
                      </Typography>
                      <Typography variant="caption1" color={colors.textSecondary}>
                        Choose how to display data from your {households.length} properties
                      </Typography>
                    </View>
                  </View>

                  <View style={styles.propertyModeButtons}>
                    <TouchableOpacity
                      style={[
                        styles.modeButton,
                        {
                          backgroundColor: propertyMode === 'single'
                            ? colors.primary
                            : colors.groupedListBackground,
                          borderColor: propertyMode === 'single'
                            ? colors.primary
                            : colors.borderColor,
                        },
                      ]}
                      onPress={() => handlePropertyModeChange('single')}
                    >
                      <Icon
                        name="home-outline"
                        size={20}
                        color={propertyMode === 'single' ? colors.white : colors.textPrimary}
                        style={styles.modeButtonIcon}
                      />
                      <View style={styles.modeButtonContent}>
                        <Typography
                          variant="footnote"
                          weight="semibold"
                          color={propertyMode === 'single' ? colors.white : colors.textPrimary}
                        >
                          Single Property
                        </Typography>
                        <Typography
                          variant="caption2"
                          color={propertyMode === 'single' ? colors.white : colors.textSecondary}
                          style={propertyMode === 'single' ? { opacity: 0.8 } : undefined}
                        >
                          Focus on one property at a time
                        </Typography>
                      </View>
                      {propertyMode === 'single' && (
                        <Icon name="checkmark-circle" size={20} color={colors.white} />
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.modeButton,
                        {
                          backgroundColor: propertyMode === 'all'
                            ? colors.primary
                            : colors.groupedListBackground,
                          borderColor: propertyMode === 'all'
                            ? colors.primary
                            : colors.borderColor,
                        },
                      ]}
                      onPress={() => handlePropertyModeChange('all')}
                    >
                      <Icon
                        name="business-outline"
                        size={20}
                        color={propertyMode === 'all' ? colors.white : colors.textPrimary}
                        style={styles.modeButtonIcon}
                      />
                      <View style={styles.modeButtonContent}>
                        <Typography
                          variant="footnote"
                          weight="semibold"
                          color={propertyMode === 'all' ? colors.white : colors.textPrimary}
                        >
                          All Properties
                        </Typography>
                        <Typography
                          variant="caption2"
                          color={propertyMode === 'all' ? colors.white : colors.textSecondary}
                          style={propertyMode === 'all' ? { opacity: 0.8 } : undefined}
                        >
                          View combined data from all properties
                        </Typography>
                      </View>
                      {propertyMode === 'all' && (
                        <Icon name="checkmark-circle" size={20} color={colors.white} />
                      )}
                    </TouchableOpacity>
                  </View>

                  {propertyMode === 'single' && currentHousehold && (
                    <View style={[styles.currentPropertyBadge, { backgroundColor: colors.primary + '15' }]}>
                      <Typography variant="caption1" color={colors.primary}>
                        Currently viewing: {currentHousehold.name}
                      </Typography>
                    </View>
                  )}

                  {propertyMode === 'all' && (
                    <View style={[styles.currentPropertyBadge, { backgroundColor: colors.success + '15' }]}>
                      <Typography variant="caption1" color={colors.success}>
                        Viewing all {households.length} properties combined
                      </Typography>
                    </View>
                  )}
                </Card>
              </View>
            )}

            <View style={styles.section} testID="house-settings-section-preferences">
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

              {/* Measurement units label floor-plan / garden object sizes. */}
              <SettingItem
                icon="resize-outline"
                iconColor={colors.primary}
                title="Measurement units"
                subtitle="Used for plan/object size labels"
                rightElement={
                  <View style={styles.inlineUnitToggle}>
                    <TouchableOpacity
                      style={[
                        styles.inlineUnitOption,
                        {
                          borderColor:
                            measurementUnit === 'feet' ? colors.primary : colors.borderColor,
                          backgroundColor:
                            measurementUnit === 'feet'
                              ? colors.primaryLight
                              : colors.backgroundSecondary,
                        },
                      ]}
                      onPress={() => setMeasurementUnit('feet')}
                      activeOpacity={0.75}
                    >
                      <Typography
                        variant="caption2"
                        weight={measurementUnit === 'feet' ? 'semibold' : 'regular'}
                        color={measurementUnit === 'feet' ? colors.primary : colors.textPrimary}
                      >
                        Ft
                      </Typography>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.inlineUnitOption,
                        {
                          borderColor:
                            measurementUnit === 'meters' ? colors.primary : colors.borderColor,
                          backgroundColor:
                            measurementUnit === 'meters'
                              ? colors.primaryLight
                              : colors.backgroundSecondary,
                        },
                      ]}
                      onPress={() => setMeasurementUnit('meters')}
                      activeOpacity={0.75}
                    >
                      <Typography
                        variant="caption2"
                        weight={measurementUnit === 'meters' ? 'semibold' : 'regular'}
                        color={measurementUnit === 'meters' ? colors.primary : colors.textPrimary}
                      >
                        M
                      </Typography>
                    </TouchableOpacity>
                  </View>
                }
              />

              {/* Room/space AREA units (sqft/sqm) — household-wide, server-synced;
                  distinct from the per-user LINEAR ft/m toggle above. */}
              {currentHousehold && (
                <SettingItem
                  icon="resize-outline"
                  iconColor={colors.primary}
                  title="Room & space units"
                  subtitle="Used for room and space sizes (sq ft / sq m)"
                  testID="settings-row-area-units"
                  rightElement={
                    <View style={styles.inlineUnitToggle}>
                      <TouchableOpacity
                        style={[
                          styles.inlineUnitOption,
                          {
                            borderColor:
                              (currentHousehold.unit_system ?? 'imperial') === 'imperial'
                                ? colors.primary
                                : colors.borderColor,
                            backgroundColor:
                              (currentHousehold.unit_system ?? 'imperial') === 'imperial'
                                ? colors.primaryLight
                                : colors.backgroundSecondary,
                          },
                        ]}
                        onPress={() => void chooseAreaUnitSystem('imperial')}
                        activeOpacity={0.75}
                        testID="settings-area-unit-imperial"
                      >
                        <Typography
                          variant="caption2"
                          weight={
                            (currentHousehold.unit_system ?? 'imperial') === 'imperial'
                              ? 'semibold'
                              : 'regular'
                          }
                          color={
                            (currentHousehold.unit_system ?? 'imperial') === 'imperial'
                              ? colors.primary
                              : colors.textPrimary
                          }
                        >
                          Sq ft
                        </Typography>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.inlineUnitOption,
                          {
                            borderColor:
                              currentHousehold.unit_system === 'metric'
                                ? colors.primary
                                : colors.borderColor,
                            backgroundColor:
                              currentHousehold.unit_system === 'metric'
                                ? colors.primaryLight
                                : colors.backgroundSecondary,
                          },
                        ]}
                        onPress={() => void chooseAreaUnitSystem('metric')}
                        activeOpacity={0.75}
                        testID="settings-area-unit-metric"
                      >
                        <Typography
                          variant="caption2"
                          weight={currentHousehold.unit_system === 'metric' ? 'semibold' : 'regular'}
                          color={
                            currentHousehold.unit_system === 'metric'
                              ? colors.primary
                              : colors.textPrimary
                          }
                        >
                          Sq m
                        </Typography>
                      </TouchableOpacity>
                    </View>
                  }
                />
              )}
            </View>

            {/* AI — ONE section for every AI surface that CONFIGURES something.
                The AI Insights Dashboard is not one of them: it reads the home
                and shows suggestions, so it lives in More's INSIGHTS group, the
                same place Budget's year-scale views went. */}
            <View style={styles.section} testID="house-settings-section-ai">
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                AI
              </Typography>

              <SettingItem
                icon="sparkles-outline"
                iconColor={colors.purple}
                title="AI Housekeeper Settings"
                subtitle="Customize your AI assistant preferences"
                onPress={() => navigation.navigate('AIHousekeeperSettings')}
                showChevron
                testID="settings-row-ai-housekeeper-settings"
              />

              <SettingItem
                iconElement={<PersonaAvatar persona={persona} size={32} />}
                title={personaName}
                subtitle="Morning briefings, memory, and trust ledger"
                onPress={() => navigation.navigate('AihousekeeperSettings')}
                showChevron
                testID="settings-row-persona-settings"
              />

              {aiEntry.show && (
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
              )}
            </View>

            <View style={styles.section}>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                NOTIFICATIONS & CALENDAR
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

              <SettingItem
                icon="calendar-outline"
                iconColor={colors.primary}
                title="Calendar Sync"
                subtitle="Export tasks and events to your calendar"
                onPress={() => navigation.navigate('CalendarSync')}
                showChevron
                testID="settings-row-calendar-sync"
              />
            </View>

            <View style={styles.section}>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                DATA SHARING
              </Typography>

              <SettingItem
                icon="link-outline"
                iconColor={colors.primary}
                title="Connect Symply apps"
                subtitle="Share with Budget, Health, or Language"
                onPress={() => navigation.navigate('SoftTransferConnect')}
                showChevron
                testID="settings-row-connect-budget"
              />

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

            {/* The rest of the Symply family — install status + baseline data
                sharing. Available in every brand (each lists the other four). */}
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

            <AppVersionFooter testID="house-settings-version-footer" />
            <ScreenScrollEnd testID={screenScrollEndTestId('house-settings-screen')} />
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
