import { Ionicons } from '@expo/vector-icons';
import { NavigationContext } from 'expo-router/react-navigation';
import React, { useContext } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppBackground, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, Toggle, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useAppStore } from '@stores/appStore';
import {
  ACCENT_SCHEME_ORDER,
  ACCENT_SCHEMES,
  hasMultipleAccentSchemes,
  useAppColors,
  type AccentSchemeId,
} from '@theme';

import type { BackOnlyScreenProps } from './backOnlyScreenProps';

interface SettingItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
}

function SettingItem({ icon, title, subtitle, rightElement, onPress, showChevron }: SettingItemProps) {
  const colors = useAppColors();
  return (
    <Card
      variant="filled"
      pressable={!!onPress}
      onPress={onPress}
      style={[styles.settingItem, { backgroundColor: colors.backgroundSecondary }]}
    >
      <View style={styles.settingIcon}>
        <Icon name={icon} size={20} color={colors.textPrimary} />
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
        <View style={styles.chevronContainer}>
          <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
        </View>
      )}
    </Card>
  );
}

interface ColorSchemeRowProps {
  schemeId: AccentSchemeId;
  selected: boolean;
  onSelect: (schemeId: AccentSchemeId) => void;
}

function ColorSchemeRow({ schemeId, selected, onSelect }: ColorSchemeRowProps) {
  const colors = useAppColors();
  const scheme = ACCENT_SCHEMES[schemeId];
  return (
    <Card
      variant="filled"
      pressable
      onPress={() => onSelect(schemeId)}
      style={[styles.settingItem, { backgroundColor: colors.backgroundSecondary }]}
      testID={`color-scheme-${schemeId}`}
    >
      <View style={styles.swatchPair}>
        <View style={[styles.swatchDot, { backgroundColor: scheme.primary }]} />
        <View style={[styles.swatchDot, styles.swatchDotSecond, { backgroundColor: scheme.secondaryAccent }]} />
      </View>
      <View style={styles.settingContent}>
        <Typography variant="body" weight="medium" color={colors.textPrimary}>
          {scheme.label}
        </Typography>
      </View>
      {selected && (
        <View style={styles.settingRight}>
          <Icon name="checkmark-circle" size={22} color={colors.primary} />
        </View>
      )}
    </Card>
  );
}

export function AppearanceScreen({ navigation }: BackOnlyScreenProps = {}) {
  // Falls back to the ambient navigator when no prop arrives — the root
  // expo-router routes render this screen directly, with no `component=`
  // to hand one over. `NavigationContext` rather than `useNavigation()`
  // because the latter throws outside a navigator, and these screens are
  // rendered bare in their own unit tests.
  const ambientNavigation = useContext(NavigationContext);
  const goBack = () => (navigation ?? ambientNavigation)?.goBack();
  const colors = useAppColors();
  const { isDark, setThemeMode } = useTheme();
  const themeMode = useAppStore((state) => state.themeMode);
  const accentScheme = useAppStore((state) => state.accentScheme);
  const setAccentScheme = useAppStore((state) => state.setAccentScheme);
  const { isTablet } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title="Appearance"
        showBackButton
        onBackPress={() => goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      <View style={styles.container} testID="appearance-screen">
        <AdaptiveContainer maxWidth={isTablet ? 1000 : undefined} padding={containerPadding}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.section}>
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionHeader}
              >
                THEME
              </Typography>

              <SettingItem
                icon="moon"
                title="Dark Mode"
                subtitle={
                  themeMode === 'system'
                    ? 'Following system'
                    : isDark
                    ? 'On'
                    : 'Off'
                }
                rightElement={
                  <Toggle
                    value={isDark}
                    onValueChange={(value) => setThemeMode(value ? 'dark' : 'light')}
                  />
                }
              />

              <SettingItem
                icon="phone-portrait"
                title="Use System Theme"
                subtitle="Match device appearance"
                rightElement={
                  <Toggle
                    value={themeMode === 'system'}
                    onValueChange={(value) =>
                      setThemeMode(value ? 'system' : isDark ? 'dark' : 'light')
                    }
                  />
                }
              />
            </View>

            {hasMultipleAccentSchemes() && (
              <View style={styles.section}>
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  style={styles.sectionHeader}
                >
                  COLOR SCHEME
                </Typography>

                {ACCENT_SCHEME_ORDER.map((schemeId) => (
                  <ColorSchemeRow
                    key={schemeId}
                    schemeId={schemeId}
                    selected={accentScheme === schemeId}
                    onSelect={setAccentScheme}
                  />
                ))}
              </View>
            )}

            <ScreenScrollEnd testID={screenScrollEndTestId('appearance-screen')} />
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
    paddingBottom: 100,
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
  chevronContainer: {
    marginLeft: 8,
  },
  swatchPair: {
    flexDirection: 'row',
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  swatchDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  swatchDotSecond: {
    marginLeft: -8,
  },
});
