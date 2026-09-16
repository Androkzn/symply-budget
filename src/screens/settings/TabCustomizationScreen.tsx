import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';

import { BrandSymbol, screenScrollViewStyle } from '@components/common';
import { AppBackground, HeaderActionButton, ScreenHeader } from '@components/common';
import { DraggableTabItem, WidgetOrderSection } from '@components/customization';
import { AdaptiveContainer } from '@components/layout';
import { Button, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { isHealthBrand } from '@features/health/brandGuard';
import {
  DEFAULT_HOME_WIDGETS,
  HOME_WIDGET_KEYS,
  HOME_WIDGETS,
} from '@features/health/components/HealthHomeWidgets';
import { DEFAULT_WEIGHT_WIDGETS, WEIGHT_WIDGETS } from '@features/health/components/HealthWeightWidgets';
import {
  ACTIVITY_WIDGETS,
  DEFAULT_ACTIVITY_WIDGETS,
  loadActivityLayout,
  saveActivityLayout,
} from '@features/health/healthActivityStorage';
import { loadHomeLayout, saveHomeLayout } from '@features/health/healthHomeStorage';
import { loadWeightLayout, saveWeightLayout, toggleWidget } from '@features/health/healthWeightStorage';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDeviceType } from '@hooks/useDeviceType';
import { useFeature } from '@hooks/useFeature';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import {
  buildTabConfig,
  getTabScreenBrandIcon,
  type TabConfigEntry,
} from '@navigation/tabRegistry';
import { resolveEffectiveTabs, useMaxVisibleTabs } from '@navigation/useEffectiveTabs';
import { showToast } from '@services/toastManager';
import {
  useTabCustomizationStore,
  type TabOverride,
} from '@stores/tabCustomizationStore';
import { useAppColors } from '@theme';

const MORE_ROUTE = 'settings';

/** Ordered route list → a stable signature for dirty-detection. */
function signature(shown: TabConfigEntry[], hidden: TabConfigEntry[]): string {
  return `${shown.map((t) => t.route).join(',')}|${hidden.map((t) => t.route).join(',')}`;
}

/**
 * User-facing editor for the customizable bottom bar. Drag to reorder the pinned
 * tabs, add hidden tabs (from "More"), or remove pinned ones. Reachable at
 * `/customize-tabs`. Only meaningful for brands with `customizableTabs`.
 */
export function TabCustomizationScreen() {
  const router = useRouter();  const colors = useAppColors();
  // `shouldUseSidebar` alongside `isTablet`: the former is what decides the tab
  // DEFAULTS (see `resolveEffectiveTabs`), and this screen has to resolve them
  // the same way the sidebar does or "Reset" would hand back a layout the bar
  // then disagrees with.
  const { isTablet, shouldUseSidebar } = useDeviceType();
  const { content: containerPadding } = useLayoutPadding();
  const showTasks = useFeature('smartTaskAssistant');
  // Only the NAME now: the persona avatar no longer renders as a tab icon.
  const { name: housekeeperName } = useAihousekeeperPersona();

  const overrides = useTabCustomizationStore((s) => s.overrides);
  const setOverrides = useTabCustomizationStore((s) => s.setOverrides);
  const resetToDefaults = useTabCustomizationStore((s) => s.resetToDefaults);

  const pool = useMemo(() => buildTabConfig({ showTasks }), [showTasks]);
  // Device-aware, so the editor's "pinned" section holds exactly what the bar
  // it is editing can hold. A fixed phone cap here would have let an iPad member
  // pin a tab the sidebar then showed anyway, or refused one it had room for.
  const maxVisible = useMaxVisibleTabs();
  const moreEntry = pool.find((t) => t.route === MORE_ROUTE);
  // Reserve the final slot for "More" so the editable "shown" list is capped one
  // below the visible max.
  const maxShown = moreEntry ? maxVisible - 1 : maxVisible;

  const initial = useMemo(
    () => resolveEffectiveTabs(pool, overrides, maxVisible, shouldUseSidebar),
    [pool, overrides, maxVisible, shouldUseSidebar],
  );

  const [shown, setShown] = useState<TabConfigEntry[]>(() =>
    initial.pinned.filter((t) => t.route !== MORE_ROUTE),
  );
  const [hidden, setHidden] = useState<TabConfigEntry[]>(() => initial.overflow);
  const [baseline, setBaseline] = useState(() =>
    signature(
      initial.pinned.filter((t) => t.route !== MORE_ROUTE),
      initial.overflow,
    ),
  );

  const isDirty = signature(shown, hidden) !== baseline;
  const canAdd = shown.length < maxShown;

  // `labelKey: 'housekeeper'` entries carry no static label — their name is the
  // member's persona, resolved at render everywhere else. Falling through to
  // `t.route` printed the raw route ("mira") once the housekeeper stopped being
  // pinned by default and started appearing in this editor's "In More" list.
  const label = (t: TabConfigEntry) => {
    if (t.labelKey === 'housekeeper' && housekeeperName) return housekeeperName;
    return t.label ?? t.route;
  };

  // Same symbol the row carries in the More hub and the bar — the rule still
  // holds, the answer changed: every tab now draws through `BrandSymbol`,
  // housekeeper included. Editing tabs beside a different picture than the one
  // you tap reads as a different feature, which is exactly why this must not
  // special-case a route the bar no longer special-cases either.
  const rowIcon = (t: TabConfigEntry) => (
    <BrandSymbol
      ionicon={t.icon}
      brandIcon={t.brandIcon ?? getTabScreenBrandIcon(t.route)}
      sfSymbol={t.sfSymbol}
      size={28}
      color={colors.primary}
    />
  );

  // Health-only: per-screen dashboard widget layouts (Home / Weight / Activity),
  // consolidated here so "Customize Tabs" is the one place for all tab-related
  // customization. Gated below via `isHealthBrand()`; the hooks themselves stay
  // unconditional so the rules of hooks hold regardless of brand.
  const [homeOrder, setHomeOrder] = useState<string[]>(() => [...DEFAULT_HOME_WIDGETS]);
  const [weightOrder, setWeightOrder] = useState<string[]>(() => [...DEFAULT_WEIGHT_WIDGETS]);
  const [activityOrder, setActivityOrder] = useState<string[]>(() => [...DEFAULT_ACTIVITY_WIDGETS]);

  useEffect(() => {
    if (!isHealthBrand()) return;
    let cancelled = false;
    void loadHomeLayout(HOME_WIDGET_KEYS).then((layout) => {
      if (!cancelled) setHomeOrder(layout.widgets);
    });
    void loadWeightLayout().then((layout) => {
      if (!cancelled) setWeightOrder(layout.widgets);
    });
    void loadActivityLayout().then((layout) => {
      if (!cancelled) setActivityOrder(layout.widgets);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleHomeToggle = (key: string) => {
    const next = toggleWidget(homeOrder, key);
    setHomeOrder(next);
    void saveHomeLayout({ widgets: next }, HOME_WIDGET_KEYS);
  };
  const handleHomeReorder = (next: string[]) => {
    setHomeOrder(next);
    void saveHomeLayout({ widgets: next }, HOME_WIDGET_KEYS);
  };
  const handleHomeSelectAll = () => {
    const next = HOME_WIDGETS.map((widget) => widget.key);
    setHomeOrder(next);
    void saveHomeLayout({ widgets: next }, HOME_WIDGET_KEYS);
  };
  const handleHomeDeselectAll = () => {
    const next = homeOrder.slice(0, 1);
    setHomeOrder(next);
    void saveHomeLayout({ widgets: next }, HOME_WIDGET_KEYS);
  };
  const handleHomeReset = () => {
    const next = [...DEFAULT_HOME_WIDGETS];
    setHomeOrder(next);
    void saveHomeLayout({ widgets: next }, HOME_WIDGET_KEYS);
  };

  const handleWeightToggle = (key: string) => {
    const next = toggleWidget(weightOrder, key);
    setWeightOrder(next);
    void saveWeightLayout({ widgets: next });
  };
  const handleWeightReorder = (next: string[]) => {
    setWeightOrder(next);
    void saveWeightLayout({ widgets: next });
  };
  const handleWeightSelectAll = () => {
    const next = WEIGHT_WIDGETS.map((widget) => widget.key);
    setWeightOrder(next);
    void saveWeightLayout({ widgets: next });
  };
  const handleWeightDeselectAll = () => {
    const next = weightOrder.slice(0, 1);
    setWeightOrder(next);
    void saveWeightLayout({ widgets: next });
  };
  const handleWeightReset = () => {
    const next = [...DEFAULT_WEIGHT_WIDGETS];
    setWeightOrder(next);
    void saveWeightLayout({ widgets: next });
  };

  const handleActivityToggle = (key: string) => {
    const next = toggleWidget(activityOrder, key);
    setActivityOrder(next);
    void saveActivityLayout({ widgets: next });
  };
  const handleActivityReorder = (next: string[]) => {
    setActivityOrder(next);
    void saveActivityLayout({ widgets: next });
  };
  const handleActivitySelectAll = () => {
    const next = ACTIVITY_WIDGETS.map((widget) => widget.key);
    setActivityOrder(next);
    void saveActivityLayout({ widgets: next });
  };
  const handleActivityDeselectAll = () => {
    const next = activityOrder.slice(0, 1);
    setActivityOrder(next);
    void saveActivityLayout({ widgets: next });
  };
  const handleActivityReset = () => {
    const next = [...DEFAULT_ACTIVITY_WIDGETS];
    setActivityOrder(next);
    void saveActivityLayout({ widgets: next });
  };

  const addTab = (route: string) => {
    if (!canAdd) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert('Bar is full', `You can pin up to ${maxShown} tabs plus More. Remove one first.`);
      return;
    }
    const tab = hidden.find((h) => h.route === route);
    if (!tab) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHidden(hidden.filter((h) => h.route !== route));
    setShown([...shown, tab]);
  };

  const removeTab = (route: string) => {
    const tab = shown.find((s) => s.route === route);
    if (!tab || tab.locked) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShown(shown.filter((s) => s.route !== route));
    setHidden([tab, ...hidden]);
  };

  const handleSave = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const next: TabOverride[] = [];
    let order = 0;
    shown.forEach((t) => next.push({ route: t.route, order: order++, visible: true }));
    if (moreEntry) next.push({ route: MORE_ROUTE, order: order++, visible: true } as TabOverride);
    hidden.forEach((t) => next.push({ route: t.route, order: order++, visible: false }));
    setOverrides(next);
    setBaseline(signature(shown, hidden));
    showToast('success', 'Tabs updated');
    router.back();
  };

  const handleReset = () => {
    Alert.alert(
      'Reset tabs?',
      'Restore the default tab layout for this app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            resetToDefaults();
            const fresh = resolveEffectiveTabs(pool, null, maxVisible, shouldUseSidebar);
            const nextShown = fresh.pinned.filter((t) => t.route !== MORE_ROUTE);
            const nextHidden = fresh.overflow;
            setShown(nextShown);
            setHidden(nextHidden);
            setBaseline(signature(nextShown, nextHidden));
          },
        },
      ],
    );
  };

  const renderShownItem = ({ item, drag, isActive }: RenderItemParams<TabConfigEntry>) => (
    <ScaleDecorator>
      <View style={styles.shownRow}>
        <View style={styles.shownRowMain}>
          <DraggableTabItem
            iconName={item.icon}
            brandIcon={item.brandIcon ?? getTabScreenBrandIcon(item.route)}
            iconElement={rowIcon(item)}
            title={label(item)}
            isRequired={item.locked}
            drag={drag}
            isActive={isActive}
          />
        </View>
        {!item.locked && (
          <TouchableOpacity
            testID={`tab-customize-remove-${item.route}`}
            style={styles.removeButton}
            onPress={() => removeTab(item.route)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Remove"
          >
            <Icon name="remove-circle-outline" size={22} color={colors.error} />
          </TouchableOpacity>
        )}
      </View>
    </ScaleDecorator>
  );

  return (
    <AppBackground opacity={0.5}>
      <ScreenHeader
        title="Customize Tabs"
        showBackButton
        onBackPress={() => router.back()}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={
          <HeaderActionButton
            label="Save"
            testID="customize-tabs-save"
            onPress={handleSave}
            disabled={!isDirty}
          />
        }
      />
      <View style={styles.container} testID="customize-tabs-screen">
        <AdaptiveContainer maxWidth={isTablet ? 1000 : undefined} padding={containerPadding}>
          <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}>
            <Typography
              variant="footnote"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.sectionHeader}
            >
              SHOWN TABS ({shown.length}/{maxShown})
            </Typography>
            <DraggableFlatList
              data={shown}
              renderItem={renderShownItem}
              keyExtractor={(item) => item.route}
              onDragBegin={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
              onDragEnd={({ data }) => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShown(data);
              }}
              scrollEnabled={false}
            />
            <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
              Home and More are always shown. Drag to reorder.
            </Typography>

            {hidden.length > 0 && (
              <View style={styles.section}>
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={colors.textSecondary}
                  style={styles.sectionHeader}
                >
                  IN MORE
                </Typography>
                {hidden.map((tab) => (
                  <TouchableOpacity
                    key={tab.route}
                    testID={`tab-customize-add-${tab.route}`}
                    style={[
                      styles.hiddenRow,
                      { backgroundColor: colors.backgroundSecondary },
                      !canAdd && styles.hiddenRowDisabled,
                    ]}
                    onPress={() => addTab(tab.route)}
                    disabled={!canAdd}
                    activeOpacity={0.7}
                  >
                    <View style={styles.hiddenIcon}>{rowIcon(tab)}</View>
                    <Typography
                      variant="body"
                      weight="semibold"
                      color={colors.textPrimary}
                      style={styles.hiddenLabel}
                    >
                      {label(tab)}
                    </Typography>
                    <Icon
                      name="add"
                      size={20}
                      color={canAdd ? colors.success : colors.textTertiary}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.resetSection}>
              <Button title="Reset to Defaults" onPress={handleReset} variant="outline" />
            </View>

            {isHealthBrand() && (
              <View style={[styles.section, styles.widgetLayoutsSection]}>
                <Typography
                  variant="footnote"
                  weight="semibold"
                  color={colors.textSecondary}
                  style={styles.sectionHeader}
                >
                  SCREEN LAYOUTS
                </Typography>
                <WidgetOrderSection
                  testIDPrefix="customize-tabs-home"
                  title="HOME SCREEN WIDGETS"
                  hint="Pick the cards you want and drag to reorder. At least one stays on."
                  widgets={HOME_WIDGETS}
                  order={homeOrder}
                  onToggle={handleHomeToggle}
                  onReorder={handleHomeReorder}
                  onSelectAll={handleHomeSelectAll}
                  onDeselectAll={handleHomeDeselectAll}
                  onReset={handleHomeReset}
                />
                <WidgetOrderSection
                  testIDPrefix="customize-tabs-weight"
                  title="WEIGHT SCREEN WIDGETS"
                  hint="Pick the cards you want and drag to reorder. At least one stays on."
                  widgets={WEIGHT_WIDGETS}
                  order={weightOrder}
                  onToggle={handleWeightToggle}
                  onReorder={handleWeightReorder}
                  onSelectAll={handleWeightSelectAll}
                  onDeselectAll={handleWeightDeselectAll}
                  onReset={handleWeightReset}
                />
                <WidgetOrderSection
                  testIDPrefix="customize-tabs-activity"
                  title="ACTIVITY SCREEN WIDGETS"
                  hint="Pick the cards you want and drag to reorder. At least one stays on."
                  widgets={ACTIVITY_WIDGETS}
                  order={activityOrder}
                  onToggle={handleActivityToggle}
                  onReorder={handleActivityReorder}
                  onSelectAll={handleActivitySelectAll}
                  onDeselectAll={handleActivityDeselectAll}
                  onReset={handleActivityReset}
                />
              </View>
            )}
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingTop: 16, paddingBottom: 100, backgroundColor: 'transparent' },
  section: { marginTop: 24 },
  widgetLayoutsSection: { gap: 12 },
  sectionHeader: { marginBottom: 12, marginLeft: 4, letterSpacing: 0.5 },
  hint: { marginTop: 8, marginLeft: 4 },
  shownRow: { position: 'relative' },
  shownRowMain: { flex: 1 },
  removeButton: {
    position: 'absolute',
    right: 56,
    top: 0,
    bottom: 12,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  hiddenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  hiddenRowDisabled: { opacity: 0.5 },
  hiddenIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  hiddenLabel: { flex: 1 },
  resetSection: { marginTop: 32, marginBottom: 16 },
});
