/**
 * SidebarTabBar — iPadOS 26 Liquid Glass leading sidebar.
 *
 * Rendered on iPad regular widths (>= Layout.sidebarBreakpoint = 768pt) in
 * place of the bottom floating tab bar. Layout follows Apple's iPadOS 26
 * sidebar guidance:
 *   - 320pt wide on regular landscape, 84pt icons-only when compact.
 *   - Liquid Glass (frosted) background with subtle inner border and shadow.
 *   - Vertical icon + label rows with a teal pill highlight on the active tab.
 *
 * The component re-uses the same tab metadata (icons, labels, persona avatar)
 * that the bottom `FloatingTabBar` ships, so the two stay 1:1 in behaviour.
 */
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from "expo-router/js-tabs";
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PersonaAvatar } from '@components/aihousekeeper';
import { BrandSymbol } from '@components/common';
import { Typography } from '@components/ui';
import { useTheme } from '@contexts/ThemeContext';
import { houseChatConfig, selectTotalUnread } from '@features/chat';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useFeature } from '@hooks/useFeature';
import { navigateToTabRoot } from '@navigation/navigateToTabRoot';
import { shouldHideTabBarForFocusedRoute } from '@navigation/tabBarVisibility';
import { getTabScreenBrandIcon } from '@navigation/tabRegistry';
import { useEffectiveTabs } from '@navigation/useEffectiveTabs';
import { useTabBarVisibilityStore } from '@stores/tabBarVisibilityStore';
import { CornerRadius, hexToRgba, Layout, Spacing, useAppColors } from '@theme';

/** Compact width: only icons; full width: icons + labels. */
const SIDEBAR_FULL_WIDTH = Layout.sidebarWidth; // 320
const SIDEBAR_COMPACT_WIDTH = 92;
const SIDEBAR_ROW_HEIGHT = 64;

/**
 * Width returned by `getSidebarWidth` so screen layout can reserve the same
 * left inset as the sidebar consumes.
 */
export function getSidebarWidth(windowWidth: number): number {
  // A full sidebar looks heavy in portrait even on large iPads. Keep labels
  // for wide landscape/fullscreen layouts and use compact rail elsewhere.
  return windowWidth >= 1180 ? SIDEBAR_FULL_WIDTH : SIDEBAR_COMPACT_WIDTH;
}

export function SidebarTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useDeviceType();
  const { theme } = useTheme();
  const colors = useAppColors();
  const { persona, name: housekeeperName } = useAihousekeeperPersona();
  const focusedGardeningRoute = useTabBarVisibilityStore(
    store => store.focusedRoutesByTab.Gardening,
  );
  const setSidebarVisible = useTabBarVisibilityStore(
    store => store.setSidebarVisible,
  );
  const showTasksTab = useFeature('smartTaskAssistant');
  // Stay 1:1 with FloatingTabBar: render the same effective pinned tab set.
  const { pinned: TAB_CONFIG } = useEffectiveTabs({ showTasks: showTasksTab });

  const sidebarWidth = getSidebarWidth(width);
  const showLabels = sidebarWidth >= SIDEBAR_FULL_WIDTH;
  const blurTint = theme.dark ? 'dark' : 'light';
  const baseTextColor = colors.textPrimary;
  const secondaryTextColor = colors.textSecondary;
  const unfocusedIconColor = colors.textSecondary;
  const dividerColor = colors.divider;
  const activePillColor = colors.primary + '2E';
  // Slightly gray glass tint — sourced from the theme's `surface` token
  // (secondarySystemBackground), the SAME token FloatingTabBar and the shared
  // ScreenFooterGlass use, so the iPad leading rail, the iPhone bottom capsule,
  // and every sticky footer read as one material. Kept a hair more translucent
  // than the compact bar (0.9/0.82 dark · 0.92/0.85 light) since the sidebar is
  // a much larger surface, but still opaque enough that content scrolling behind
  // it stays blurred out and labels never compete with bleed-through text.
  const surface = theme.colors.surface;
  const gradientColors: [string, string] = theme.dark
    ? [hexToRgba(surface, 0.9), hexToRgba(surface, 0.82)]
    : [hexToRgba(surface, 0.92), hexToRgba(surface, 0.85)];

  const chatUnread = houseChatConfig.store(selectTotalUnread);
  const activeRouteName = state.routes[state.index]?.name;
  const currentIndex = Math.max(
    0,
    TAB_CONFIG.findIndex(t => t.route === activeRouteName),
  );

  // Vertical sliding pill (matches FloatingTabBar's animated indicator).
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: currentIndex * SIDEBAR_ROW_HEIGHT,
      useNativeDriver: true,
      tension: 68,
      friction: 9,
    }).start();
  }, [currentIndex, slideAnim]);

  // Honour the same hide-rules the floating bar uses (e.g. fullscreen
  // garden editor pushes the tab bar away). Publish *actual* visibility
  // through the store so screens can stop reserving leading inset when the
  // sidebar is hidden by a nested route.
  const hidden =
    activeRouteName === 'gardening' &&
    shouldHideTabBarForFocusedRoute('Gardening', focusedGardeningRoute);

  useEffect(() => {
    setSidebarVisible(!hidden);
    return () => setSidebarVisible(false);
  }, [hidden, setSidebarVisible]);

  if (hidden) {
    return null;
  }

  const handlePress = (routeName: string) => {
    // Switch tabs and reset the tapped tab's nested stack to its root so the
    // sidebar never resurfaces a previously-visited child screen (kept 1:1
    // with FloatingTabBar).
    navigateToTabRoot(navigation, state, routeName);
  };

  return (
    <View
      style={[
        styles.container,
        {
          width: sidebarWidth,
          paddingTop: insets.top + Spacing.base,
          paddingBottom: insets.bottom + Spacing.base,
          paddingLeft: insets.left + Spacing.sm,
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.glass}>
        <BlurView
          style={StyleSheet.absoluteFill}
          intensity={Platform.OS === 'ios' ? 70 : 40}
          tint={blurTint}
        />
        <LinearGradient
          colors={gradientColors}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* Brand row: full sidebar only. Compact rail uses the first tab avatar. */}
        {showLabels && (
          <>
            <View style={styles.brandRow}>
              <View style={styles.brandAvatar}>
                <PersonaAvatar
                  persona={persona}
                  size={36}
                  backgroundColor="transparent"
                />
              </View>
              <View style={styles.brandText}>
                <Typography variant="caption2" color={secondaryTextColor}>
                  Welcome back
                </Typography>
                <Typography
                  variant="headline"
                  weight="semibold"
                  color={baseTextColor}
                >
                  {housekeeperName}
                </Typography>
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: dividerColor }]} />
          </>
        )}

        {/* Tab rows */}
        <View style={styles.rows}>
          {/* Animated active pill (positions to the focused row) */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.activePill,
              {
                backgroundColor: activePillColor,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          />

          {TAB_CONFIG.map((tab, index) => {
            const isFocused = index === currentIndex;
            const label =
              tab.labelKey === 'housekeeper' || tab.route === 'mira'
                ? housekeeperName
                : tab.label ?? tab.route;
            return (
              <Pressable
                key={tab.route}
                testID={`tab-${tab.route}`}
                onPress={() => handlePress(tab.route)}
                accessibilityRole="tab"
                accessibilityState={{ selected: isFocused }}
                accessibilityLabel={label}
                style={({ pressed }) => [
                  styles.row,
                  {
                    paddingHorizontal: showLabels ? Spacing.base : 0,
                    justifyContent: showLabels ? 'flex-start' : 'center',
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                {/*
                  Every tab draws through the SAME symbol pipeline — no route
                  gets its own artwork.

                  Mira used to render its persona avatar here: a full-colour
                  illustration sitting in a column of monochrome line icons that
                  tint with focus. It read as a foreign object rather than a
                  sibling, and it did not tint, so the rail had no consistent
                  "this one is selected" signal. The persona still appears where
                  it means something — the brand row above ("Welcome back,
                  <name>") and inside the housekeeper itself.

                  `brandIcon` is passed here for the same reason: the bottom bar
                  and the More hub both resolve it, and omitting it on the
                  sidebar was why the iPad rail's glyphs did not match the
                  artwork on the very list they came from.
                */}
                <View style={styles.iconSlot}>
                  <BrandSymbol
                      ionicon={tab.icon}
                      brandIcon={getTabScreenBrandIcon(tab.route)}
                      sfSymbol={tab.sfSymbol}
                      focused={isFocused}
                      size={24}
                      color={
                        isFocused ? colors.primaryDark : unfocusedIconColor
                      }
                    />
                    {tab.route === 'chat' && chatUnread > 0 && (
                      <View style={styles.badge}>
                        <Typography variant="caption2" weight="bold" color={colors.white}>
                          {chatUnread > 99 ? '99+' : chatUnread}
                        </Typography>
                      </View>
                    )}
                </View>
                {showLabels && (
                  <Typography
                    variant="body"
                    weight={isFocused ? 'semibold' : 'medium'}
                    color={isFocused ? colors.primaryDark : baseTextColor}
                    style={styles.rowLabel}
                  >
                    {label}
                  </Typography>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 9999,
  },
  glass: {
    flex: 1,
    borderRadius: CornerRadius.xl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.45)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 8,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.base,
    paddingBottom: Spacing.md,
    gap: Spacing.md,
  },
  brandAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
  },
  brandText: {
    flex: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.base,
    marginBottom: Spacing.sm,
  },
  rows: {
    position: 'relative',
    paddingTop: Spacing.xs,
  },
  activePill: {
    position: 'absolute',
    left: Spacing.sm,
    right: Spacing.sm,
    height: SIDEBAR_ROW_HEIGHT - Spacing.xs,
    borderRadius: CornerRadius.lg,
    top: Spacing.xs / 2,
  },
  row: {
    height: SIDEBAR_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconSlot: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: 6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
  },
});
