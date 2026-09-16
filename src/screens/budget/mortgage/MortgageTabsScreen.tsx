import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import DraggableFlatList, {
  type RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';

import {
  AppBackground,
  HeaderActionButton,
  SafeAreaView,
  ScreenHeader,
  screenScrollViewStyle,
} from '@components/common';
import { Button, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import type { BudgetStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useMortgageStore } from '@stores/mortgageStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';

import {
  mortgageTabIcon,
  mortgageTabsSignature,
  resolveMortgageTabs,
  type MortgageTabDef,
} from './mortgageTabs';

/** Single-line row height — nine tabs have to fit without endless scrolling. */
const ROW_HEIGHT = 48;

/**
 * Customize the Mortgage strip (Budget-only) — reached from Mortgage settings.
 * Drag to reorder the shown tabs, remove ones you don't use, add them back from
 * "Hidden". Overview is locked: it's the fallback the dashboard falls back to,
 * so the strip can never end up empty. Nothing here is server state — the
 * layout lives in `mortgageStore` (persisted) and the dashboard reads it
 * through `resolveMortgageTabs`.
 */
export function MortgageTabsScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { subTabOrder, hiddenSubTabs, setSubTabLayout, resetSubTabLayout } = useMortgageStore();

  const initial = useMemo(
    () => resolveMortgageTabs(subTabOrder, hiddenSubTabs),
    // Snapshot the persisted layout once — edits below are local until Save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [shown, setShown] = useState<MortgageTabDef[]>(initial.shown);
  const [hidden, setHidden] = useState<MortgageTabDef[]>(initial.hidden);
  const [baseline, setBaseline] = useState(() =>
    mortgageTabsSignature(initial.shown, initial.hidden)
  );

  const isDirty = mortgageTabsSignature(shown, hidden) !== baseline;

  const hideTab = (id: string) => {
    const tab = shown.find((t) => t.id === id);
    if (!tab || tab.locked) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShown(shown.filter((t) => t.id !== id));
    setHidden([tab, ...hidden]);
  };

  const showTab = (id: string) => {
    const tab = hidden.find((t) => t.id === id);
    if (!tab) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHidden(hidden.filter((t) => t.id !== id));
    setShown([...shown, tab]);
  };

  const handleSave = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Persist the full order (shown first, then hidden) so re-showing a tab
    // later restores it near where the user last had it.
    setSubTabLayout(
      [...shown, ...hidden].map((t) => t.id),
      hidden.map((t) => t.id)
    );
    setBaseline(mortgageTabsSignature(shown, hidden));
    showToast('success', 'Mortgage tabs updated');
    navigation.goBack();
  };

  const handleReset = () => {
    Alert.alert('Reset tabs?', 'Show every mortgage tab again, in the default order.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          resetSubTabLayout();
          const fresh = resolveMortgageTabs(null, []);
          setShown(fresh.shown);
          setHidden(fresh.hidden);
          setBaseline(mortgageTabsSignature(fresh.shown, fresh.hidden));
        },
      },
    ]);
  };

  const renderShownItem = ({ item, drag, isActive }: RenderItemParams<MortgageTabDef>) => (
    <ScaleDecorator>
      <View
        testID={`mortgage-tab-row-${item.id}`}
        style={[
          styles.row,
          { backgroundColor: colors.backgroundSecondary, borderColor: colors.divider },
          isActive && styles.rowDragging,
        ]}
      >
        <Icon
          name={mortgageTabIcon(item)}
          size={IconSize.md}
          color={colors.primary}
          forceIonicons
          style={styles.rowIcon}
        />
        <Typography variant="body" weight="semibold" color={colors.textPrimary} numberOfLines={1}>
          {item.label}
        </Typography>
        {item.locked ? (
          <Typography variant="caption" color={colors.textTertiary} style={styles.rowNote}>
            Always shown
          </Typography>
        ) : null}
        <View style={styles.rowSpacer} />
        {!item.locked ? (
          <TouchableOpacity
            testID={`mortgage-tab-hide-${item.id}`}
            style={styles.rowAction}
            onPress={() => hideTab(item.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Hide ${item.label}`}
          >
            <Icon name="remove-circle-outline" size={IconSize.md} color={colors.destructive} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          testID={`mortgage-tab-drag-${item.id}`}
          onPressIn={drag}
          style={styles.rowAction}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Reorder ${item.label}`}
        >
          <Icon name="reorder-three" size={IconSize.lg} color={colors.textSecondary} forceIonicons />
        </TouchableOpacity>
      </View>
    </ScaleDecorator>
  );

  return (
    <AppBackground>
    <SafeAreaView edges={[]} testID="mortgage-tabs-screen">
      <ScreenHeader
        title="Customize tabs"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
        rightElement={
          <HeaderActionButton
            label="Save"
            testID="mortgage-tabs-save"
            onPress={handleSave}
            disabled={!isDirty}
          />
        }
      />
      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.flex]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Typography variant="caption" color={colors.textSecondary} style={styles.intro}>
          Drag to reorder the Mortgage tabs, or hide the ones you don’t use.
        </Typography>

        <Typography
          variant="footnote"
          weight="semibold"
          color={colors.textSecondary}
          style={styles.sectionHeader}
        >
          SHOWN ({shown.length}/{shown.length + hidden.length})
        </Typography>
        <DraggableFlatList
          data={shown}
          renderItem={renderShownItem}
          keyExtractor={(item) => item.id}
          onDragBegin={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          onDragEnd={({ data }) => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setShown(data);
          }}
          scrollEnabled={false}
          testID="mortgage-tabs-shown"
        />

        {hidden.length > 0 ? (
          <View style={styles.section} testID="mortgage-tabs-hidden">
            <Typography
              variant="footnote"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.sectionHeader}
            >
              HIDDEN
            </Typography>
            {hidden.map((tab) => (
              <TouchableOpacity
                key={tab.id}
                testID={`mortgage-tab-show-${tab.id}`}
                style={[
                  styles.row,
                  { backgroundColor: colors.backgroundSecondary, borderColor: colors.divider },
                ]}
                onPress={() => showTab(tab.id)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Show ${tab.label}`}
              >
                <Icon
                  name={mortgageTabIcon(tab)}
                  size={IconSize.md}
                  color={colors.textTertiary}
                  forceIonicons
                  style={styles.rowIcon}
                />
                <Typography variant="body" color={colors.textSecondary} numberOfLines={1}>
                  {tab.label}
                </Typography>
                <View style={styles.rowSpacer} />
                <Icon name="add-circle-outline" size={IconSize.md} color={colors.primary} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <Button
          title="Reset to default"
          variant="outline"
          onPress={handleReset}
          testID="mortgage-tabs-reset"
          style={styles.resetButton}
        />
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Layout.bottomTabBarClearance },
  intro: { marginBottom: Spacing.md },
  section: { marginTop: Spacing.base },
  sectionHeader: { marginBottom: Spacing.sm, marginLeft: Spacing.xxs, letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.sm,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
  },
  rowDragging: { opacity: 0.85 },
  rowIcon: { marginRight: Spacing.md },
  rowNote: { marginLeft: Spacing.sm },
  rowSpacer: { flex: 1 },
  rowAction: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  resetButton: { marginTop: Spacing.base },
});
