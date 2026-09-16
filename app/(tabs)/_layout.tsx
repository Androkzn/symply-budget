import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from "expo-router/js-tabs";
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PersonaAvatar } from '@components/aihousekeeper';
import { BrandSymbol } from '@components/common';
import { SidebarTabBar } from '@components/navigation';
import { useTheme } from '@contexts/ThemeContext';
import { isBudgetBrand } from '@features/budget';
import { ChatFab, budgetChatConfig, houseChatConfig, selectTotalUnread } from '@features/chat';
import { isKaizenBrand } from '@features/kaizen';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useFeature } from '@hooks/useFeature';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { navigateToTabRoot } from '@navigation/navigateToTabRoot';
import { shouldHideTabBarForFocusedRoute } from '@navigation/tabBarVisibility';
import {
  getInitialTabRoute,
  getTabScreenBrandIcon,
  getTabScreenHref,
  getTabScreenIcon,
  getTabScreenSfSymbol,
  getTabScreenTitle,
  ROUTABLE_TAB_SCREENS,
} from '@navigation/tabRegistry';
import { useEffectiveTabs } from '@navigation/useEffectiveTabs';
import { useTabBarVisibilityStore } from '@stores/tabBarVisibilityStore';
import { hexToRgba, useAppColors } from '@theme';

// Tab configuration comes from the active brand pack (`brand.tabs`).
// Hidden routes stay registered via ROUTABLE_TAB_SCREENS with href: null.

const kaizenBrandActive = isKaizenBrand();

// Inner horizontal padding inside the capsule so the first/last tab slots (and
// the sliding indicator) sit clear of the rounded corners instead of touching
// the edge. Used in both the indicator math and the tabs row padding.
const TAB_BAR_H_PADDING = 3;

// Progressive blur for the backdrop BEHIND the floating capsule. This is the
// under-nav layer only — the capsule's own fill/blur/gradient are untouched.
//
// `expo-blur` cannot fade a BlurView's strength across its own height, and one
// band at a visible intensity leaves a hard "blur starts here" seam at its top
// edge (the reason the previous single band was pinned at a barely-visible 10).
// Stacking several bottom-anchored bands makes the blur RAMP instead: each
// shorter band composites on top of the ones below it, so strength compounds
// toward the home indicator while any single seam is only a small step. Heights
// are `insets.bottom + N` so the ramp keeps its shape on devices with and
// without a home indicator.
const BACKDROP_BLUR_BANDS = [
  { above: 104, intensity: 8 },
  { above: 74, intensity: 18 },
  { above: 48, intensity: 32 },
  { above: 26, intensity: 50 },
] as const;

// Always use custom tab bar on all platforms
function useCustomTabBar(): boolean {
  return true;
}

/**
 * Picks the right custom tab-bar implementation per device:
 *  - iPad regular widths (>= 768pt) → leading Liquid Glass sidebar
 *  - iPhone & compact iPad windows  → bottom floating capsule
 *
 * When falling back to the floating bar, mark the sidebar invisible in the
 * shared store so screens stop reserving leading inset for it.
 */
function AdaptiveTabBar(props: BottomTabBarProps) {
  const { shouldUseSidebar } = useDeviceType();
  const setSidebarVisible = useTabBarVisibilityStore(
    store => store.setSidebarVisible,
  );

  useEffect(() => {
    if (!shouldUseSidebar) {
      setSidebarVisible(false);
    }
  }, [shouldUseSidebar, setSidebarVisible]);

  if (shouldUseSidebar) {
    return <SidebarTabBar {...props} />;
  }
  return <FloatingTabBar {...props} />;
}

function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const containerRef = useRef<View>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const { content: containerPadding } = useLayoutPadding();
  const { theme } = useTheme();
  const colors = useAppColors();
  const showTasksTab = useFeature('smartTaskAssistant');
  // Effective bottom bar: the user-customized pinned tabs for brands that opt
  // into customizable tabs, else the static brand bar. Overflow lives in More.
  const { pinned: tabConfig } = useEffectiveTabs({ showTasks: showTasksTab });
  const { persona, name: housekeeperName } = useAihousekeeperPersona();
  const chatUnread = houseChatConfig.store(selectTotalUnread);
  const focusedGardeningRoute = useTabBarVisibilityStore(
    store => store.focusedRoutesByTab.Gardening,
  );
  const focusedBudgetRoute = useTabBarVisibilityStore(
    store => store.focusedRoutesByTab.Budget,
  );
  const blurTint = theme.dark ? 'dark' : 'light';
  const activeColor = colors.primaryDark;
  const inactiveColor = theme.dark
    ? 'rgba(242, 242, 247, 0.72)'
    : 'rgba(60, 60, 67, 0.6)';
  const labelColor = theme.dark ? '#F2F2F7' : '#1C1C1E';
  // Slightly gray glass tint — sourced from the theme's `surface` token
  // (secondarySystemBackground) rather than a hardcoded white/black, so the
  // capsule matches the app's grouped-background convention. Kept essentially
  // opaque (1→0.99) over a deep blur so scrolling content behind the capsule is
  // fully hidden and the tab labels never compete with bleed-through text; the
  // hair-thin top-edge falloff still preserves the frosted-glass feel.
  const gradientColors: [string, string] = [
    hexToRgba(theme.colors.surface, 1),
    hexToRgba(theme.colors.surface, 0.99),
  ];
  // Soft scrim behind the floating capsule — fades from the same surface
  // token to transparent further up, so content scrolling toward the tab bar
  // blends in instead of cutting off sharply in the gaps around the capsule.
  //
  // The bottom stop is 0.72, NOT 1. At full opacity this scrim was a solid
  // block of `surface` painted over `BACKDROP_BLUR_BANDS`, so the backdrop had
  // no visible blur at all — content simply vanished behind a flat wash. At
  // 0.72 the blurred content still reads through as frosted glass while the
  // tint keeps enough weight for the capsule to sit clearly on top of it.
  // Transparent at the TOP, tinted at the BOTTOM — ordered to match the
  // `start`/`end` pair on the gradient below (y:0 → y:1), the same shape
  // `ScreenFooterGlass` uses.
  //
  // Stops at 0.6, not 1. A fully-opaque bottom stop is a flat block of
  // `surface` that hides the blur bands entirely, which is what made the
  // backdrop read as a solid wash instead of frosted glass.
  const backdropColors: [string, string] = [
    hexToRgba(theme.colors.surface, 0),
    hexToRgba(theme.colors.surface, 0.6),
  ];

  // Authoritative focused-tab source: state.index from the Tabs navigator.
  // Map that active route's name back to a tabConfig entry so we know where
  // to position the sliding indicator. If the active route isn't listed in
  // tabConfig (e.g. the hidden Reports route has been pushed), fall back to
  // the first visible tab so the indicator doesn't jump off-screen.
  const activeRouteName = state.routes[state.index]?.name;
  // -1 when the focused route isn't one of the visible tabs — e.g. a pushed
  // drill-down like Utilities/Bills reached from Home or More. In that case no
  // tab should read as selected; without this the indicator falls back to the
  // first tab and Home looks active while you're on an unrelated screen.
  const matchedIndex = tabConfig.findIndex(t => t.route === activeRouteName);
  const hasActiveTab = matchedIndex >= 0;
  const currentIndex = Math.max(0, matchedIndex);

  // Animated value for sliding indicator
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Width of a single tab cell within the padded inner row. The indicator and
  // the tab items are both laid out inside TAB_BAR_H_PADDING, so the math here
  // mirrors the tabsRow padding to keep the highlight aligned with its label.
  const innerWidth = Math.max(0, containerWidth - TAB_BAR_H_PADDING * 2);
  const tabCellWidth = innerWidth / tabConfig.length;

  // Update animation when route changes
  useEffect(() => {
    if (containerWidth > 0) {
      const targetPosition = TAB_BAR_H_PADDING + currentIndex * tabCellWidth;
      Animated.spring(slideAnim, {
        toValue: targetPosition,
        useNativeDriver: true,
        tension: 68,
        friction: 8,
      }).start();
    }
  }, [currentIndex, containerWidth, tabCellWidth, slideAnim]);

  const handlePress = (routeName: string) => {
    // Switch tabs and reset the tapped tab's nested stack to its root so the
    // bottom nav never resurfaces a previously-visited child screen. Using the
    // Tabs navigator's own `navigate` (inside the helper) swaps the active tab
    // with proper state updates; Router.push would stack screens and leave the
    // selection indicator behind.
    navigateToTabRoot(navigation, state, routeName);
  };

  if (
    activeRouteName === 'gardening' &&
    shouldHideTabBarForFocusedRoute('Gardening', focusedGardeningRoute)
  ) {
    return null;
  }

  // Hide the floating tab bar on the wish detail (chat/feed) screen so its
  // bottom composer isn't covered by the capsule. WishDetail is reached from
  // the legacy `budget` tab (House) and, under the customizable-tabs model,
  // from the standalone `wishes` tab — both host the Budget stack.
  if (
    (activeRouteName === 'budget' || activeRouteName === 'wishes') &&
    shouldHideTabBarForFocusedRoute('Budget', focusedBudgetRoute)
  ) {
    return null;
  }

  return (
    <>
      {/* Frosted band filling the gap beneath the capsule so content scrolling
          past the bar is blurred out instead of peeking through. Its height
          stops near the capsule's bottom edge, hiding the blur's hard top seam
          under the capsule.
          WRAPPED IN A PLAIN VIEW, not just `pointerEvents="none"` on the
          BlurView/LinearGradient directly. Reproduced 2026-08-01 on Health's
          nutrition-meal-detail-tools: on a short screen (empty diary) the
          `health-meal-slot-*` row sits at y=[832,872], inside this backdrop's
          own bounds (height insets.bottom+18 ⇒ y≈[822,874] on this device) —
          taps there landed and were dispatched (confirmed via a screen-
          hierarchy dump + screenshot: bounds correct, tap "completed", state
          never changed) but never reached the Pressable underneath. `expo-blur`
          BlurView is a native wrapper around UIVisualEffectView; its own
          `pointerEvents="none"` prop is known to not always propagate to
          every internal layer on iOS. A plain RN `View` has no such
          uncertainty, so the outer touch-transparency now comes from core RN
          behaviour instead of a third-party native module's prop forwarding. */}
      <View
        pointerEvents="none"
        style={[styles.gradientBackdrop, { height: insets.bottom + 120 }]}
      >
        {/* `StyleSheet.absoluteFill`, NOT `StyleSheet.absoluteFillObject`.
            This whole backdrop was invisible for months because of that one
            word: with `absoluteFillObject` the native gradient/blur views get
            no drawable frame under the New Architecture (`newArchEnabled` in
            ios/Podfile.properties.json) and render NOTHING — silently, with no
            warning, while their wrapper `View` measures and paints correctly.
            Verified 2026-08-16 on Budget-B by A/B-filling this gradient with
            red: 0 red pixels with `absoluteFillObject`, ~156k with
            `absoluteFill`, every other prop identical. `locations` is NOT
            required (tested separately). Do not "tidy" this back to
            `absoluteFillObject`. */}
        <LinearGradient
          colors={backdropColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </View>
      {/* Blur bands sit ABOVE the gradient scrim (see the zIndex pair in
          `styles`), not below it. With the gradient on top its bottom stop
          washed straight over the frosted band, which is why the blur was
          invisible regardless of intensity. This way the gradient supplies the
          tint and the blur frosts the tinted result. */}
      {BACKDROP_BLUR_BANDS.map(band => (
        <View
          key={band.above}
          pointerEvents="none"
          style={[styles.blurBackdrop, { height: insets.bottom + band.above }]}
        >
          {/* `absoluteFill`, not `absoluteFillObject` — see the gradient
              above; the same silent no-render applies to BlurView. */}
          <BlurView
            intensity={band.intensity}
            tint={blurTint}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>
      ))}
      <View
        style={[
          styles.container,
          {
            paddingBottom: insets.bottom + 6,
            paddingHorizontal: containerPadding + 4,
          },
        ]}
      >
        {/* Glass effect container - capsule shape */}
        <View
          ref={containerRef}
          style={[
            styles.glassContainer,
            // Solid, fully-opaque capsule fill. The BlurView + gradient on top
            // add the frosted sheen, but this base guarantees scrolling content
            // can never bleed through the bar, in light OR dark mode.
            //
            // The outline is a faint brand tint, not a solid `activeColor` stroke —
            // full-strength `activeColor` reads fine as a hairline for House's teal,
            // but Health's red (`#D1383C`, a near-match for the app's own semantic
            // error color) turned the WHOLE capsule into what looks like a bright
            // red error ring around every tab, not just the active one.
            {
              borderColor: hexToRgba(activeColor, 0.3),
              backgroundColor: theme.colors.surface,
            },
          ]}
          onLayout={event => {
            const { width } = event.nativeEvent.layout;
            setContainerWidth(width);
          }}
        >
          <BlurView
            style={StyleSheet.absoluteFillObject}
            intensity={100}
            tint={blurTint}
            pointerEvents="none"
          />
          <LinearGradient
            colors={gradientColors}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />

          {/* Sliding indicator - green/teal color. Width = 100% / tabCount. */}
          <Animated.View
            style={[
              styles.slidingIndicator,
              {
                width: tabCellWidth,
                transform: [{ translateX: slideAnim }],
                opacity: hasActiveTab ? 1 : 0,
                backgroundColor: hexToRgba(colors.primary, 0.2),
              },
            ]}
          />

          {/* Tab items */}
          <View
            style={[styles.tabsRow, { paddingHorizontal: TAB_BAR_H_PADDING }]}
          >
            {tabConfig.map((tab, index) => {
              // Focused purely by index comparison against the authoritative
              // state.index from the Tabs navigator. `hasActiveTab` guards the
              // no-match case so nothing lights up on pushed drill-down screens.
              const isFocused = hasActiveTab && index === currentIndex;
              const label = getTabScreenTitle(tab.route, {
                showTasks: showTasksTab,
                housekeeperName,
              });

              return (
                <Pressable
                  key={tab.route}
                  testID={`tab-${tab.route}`}
                  style={[
                    styles.tabItem,
                    { width: `${100 / tabConfig.length}%` },
                  ]}
                  onPress={() => handlePress(tab.route)}
                  android_ripple={{ color: 'rgba(0,0,0,0.1)' }}
                >
                  <View style={styles.iconSlot}>
                    {/* Same symbol pipeline for every route — see SidebarTabBar. */}
                    <BrandSymbol
                      ionicon={tab.icon}
                      brandIcon={getTabScreenBrandIcon(tab.route)}
                      sfSymbol={tab.sfSymbol}
                      focused={isFocused}
                      size={24}
                      color={isFocused ? activeColor : inactiveColor}
                    />
                    {tab.route === 'chat' && chatUnread > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText} numberOfLines={1}>
                          {chatUnread > 99 ? '99+' : chatUnread}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.label,
                      {
                        color: isFocused ? activeColor : labelColor,
                        opacity: isFocused ? 1 : 0.88,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </>
  );
}

export default function TabsLayout() {
  const showCustomTabBar = useCustomTabBar();
  const { persona, name: housekeeperName } = useAihousekeeperPersona();
  const colors = useAppColors();
  const showTasksTab = useFeature('smartTaskAssistant');

  return (
    <>
      <Tabs
        initialRouteName={getInitialTabRoute()}
      tabBar={
        showCustomTabBar ? props => <AdaptiveTabBar {...props} /> : undefined
      }
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primaryDark,
        tabBarInactiveTintColor: 'rgba(60, 60, 67, 0.6)',
      }}
    >
      {ROUTABLE_TAB_SCREENS.map(({ route }) => {
        const href = getTabScreenHref(route, { showTasks: showTasksTab });
        const title = getTabScreenTitle(route, {
          showTasks: showTasksTab,
          housekeeperName,
        });
        const iconName = getTabScreenIcon(route);
        const brandIcon = getTabScreenBrandIcon(route);
        const sfSymbol = getTabScreenSfSymbol(route);

        return (
          <Tabs.Screen
            key={route}
            name={route}
            options={{
              title,
              href,
              tabBarIcon:
                href == null
                  ? undefined
                  : ({ color, size, focused }) => (
                      // Same symbol pipeline for every route — see SidebarTabBar.
                      <BrandSymbol
                        ionicon={iconName}
                        brandIcon={brandIcon}
                        sfSymbol={sfSymbol}
                        focused={focused}
                        size={size}
                        color={color}
                      />
                    ),
            }}
          />
        );
      })}
      </Tabs>
      {/* Budget-only floating chat button (bottom-right), overlaying every tab. */}
      {isBudgetBrand() && <ChatFab config={budgetChatConfig} />}
    </>
  );
}

const styles = StyleSheet.create({
  // Gradient BELOW, blur bands ABOVE (9997 < 9998) — the reverse of the
  // original pairing, which let the scrim's opaque bottom stop bury the blur.
  // Both stay under the capsule itself (`container`, 9999).
  gradientBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9997,
  },
  blurBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9998,
  },
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    zIndex: 9999,
    pointerEvents: 'box-none',
  },
  glassContainer: {
    width: '100%',
    maxWidth: 600,
    height: 68,
    borderRadius: 34, // Capsule shape
    borderWidth: 1, // 1px brand-tinted border (color set inline, see FloatingTabBar)
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  slidingIndicator: {
    position: 'absolute',
    // Concentric with the capsule using a uniform 3px gap on every side. With
    // the 1px border the inner content box is 66pt (68 - 2×1): top 3 + height
    // 60 + bottom 3 keeps the top/bottom gaps equal. Radius = innerRadius(33) -
    // gap(3) = 30 so the pill follows the rounded corners.
    top: 3,
    left: 0,
    // width set dynamically via inline style (measured tab cell width)
    height: 60,
    // backgroundColor set inline from brand primary (hexToRgba)
    borderRadius: 30,
    zIndex: 0,
    marginLeft: 0,
    marginRight: 0,
  },
  tabsRow: {
    flexDirection: 'row',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
    zIndex: 1,
    paddingHorizontal: 0,
    width: '100%',
  },
  tabItem: {
    // width set dynamically via inline style (100% / tabConfig.length)
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    minHeight: 48,
    zIndex: 2,
  },
  iconSlot: {
    // Fixed-height slot so the persona avatar and the icons share the same
    // baseline — keeps every tab's label aligned on one row.
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 13,
  },
  label: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: -0.2,
    maxWidth: 72,
    textAlign: 'center',
  },
});
