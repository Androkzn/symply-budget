import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { AdaptiveModal, SheetHeader } from '@components/common';
import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import type { BudgetStackParamList } from '@navigation/types';
import { useMortgageStore } from '@stores/mortgageStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';

import { fmtCents } from './mortgageFormat';

/**
 * The Mortgage tab's header title, doubled as the property picker. Households
 * with two properties had to detour through the settings gear to switch; here
 * the title itself names the property on screen and opens the list.
 *
 * Reads the list the dashboard already fetched (`mortgageStore.mortgages`) —
 * the header must not issue its own `list()` on every Mortgage render. Falls
 * back to a plain "Mortgage" title before the first load / with no properties,
 * where `MortgageView` owns the set-up CTA.
 *
 * Selecting only sets `selectedMortgageId`: that alone re-runs `MortgageView`'s
 * focus effect, so `markDirty()` here would load the dashboard twice.
 */
export function MortgageSwitcher() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const mortgages = useMortgageStore((s) => s.mortgages);
  const selectedMortgageId = useMortgageStore((s) => s.selectedMortgageId);
  const setSelectedMortgage = useMortgageStore((s) => s.setSelectedMortgage);

  const [isOpen, setIsOpen] = useState(false);

  // Same fallback as the dashboard: no explicit selection → the first property.
  const active = mortgages.find((m) => m.id === selectedMortgageId) ?? mortgages[0] ?? null;

  if (!active) {
    return (
      <Typography
        variant="headline"
        weight="semibold"
        numberOfLines={1}
        align="center"
        testID="mortgage-switcher-title"
      >
        Mortgage
      </Typography>
    );
  }

  const onSelect = (id: string) => {
    setIsOpen(false);
    if (id !== active.id) setSelectedMortgage(id);
  };

  return (
    <>
      <TouchableOpacity
        style={styles.trigger}
        activeOpacity={0.7}
        onPress={() => setIsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Mortgage: ${active.nickname}. Switch property`}
        testID="mortgage-switcher-trigger"
      >
        <Typography
          variant="headline"
          weight="semibold"
          numberOfLines={1}
          style={styles.triggerLabel}
          testID="mortgage-switcher-title"
        >
          {active.nickname}
        </Typography>
        <Icon name="chevron-down" size={IconSize.sm} color={colors.textSecondary} />
      </TouchableOpacity>

      <AdaptiveModal visible={isOpen} onClose={() => setIsOpen(false)}>
        <View
          style={[styles.sheet, { backgroundColor: colors.backgroundMain }]}
          testID="mortgage-switcher-sheet"
        >
          <SheetHeader
            title="Your properties"
            leftVariant="close"
            onLeftPress={() => setIsOpen(false)}
            leftTestID="mortgage-switcher-close"
            leftAccessibilityLabel="Close"
          />
          <ScrollView contentContainerStyle={styles.sheetContent}>
            {mortgages.map((m) => {
              const selected = m.id === active.id;
              const meta =
                (m.lender ? `${m.lender} · ` : '') +
                `${fmtCents(m.currentBalanceCents)} · ${Math.round(m.pctPaid * 100)}% paid`;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={StyleSheet.flatten([
                    styles.row,
                    {
                      backgroundColor: colors.backgroundSecondary,
                      // Reserve the ring's width on every row so selecting one
                      // doesn't nudge the list.
                      borderColor: selected ? colors.primary : 'transparent',
                    },
                  ])}
                  activeOpacity={0.7}
                  onPress={() => onSelect(m.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Switch to ${m.nickname}`}
                  testID={`mortgage-switcher-row-${m.id}`}
                >
                  <Icon
                    name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={IconSize.lg}
                    color={selected ? colors.primary : colors.textTertiary}
                    testID={selected ? `mortgage-switcher-selected-${m.id}` : undefined}
                  />
                  <View style={styles.rowMeta}>
                    <Typography variant="body" weight="semibold">
                      {m.nickname}
                    </Typography>
                    <Typography variant="caption" color={colors.textSecondary}>
                      {meta}
                    </Typography>
                  </View>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={StyleSheet.flatten([
                styles.row,
                { backgroundColor: colors.backgroundSecondary, borderColor: 'transparent' },
              ])}
              activeOpacity={0.7}
              onPress={() => {
                setIsOpen(false);
                navigation.navigate('MortgageSetup');
              }}
              accessibilityRole="button"
              accessibilityLabel="Add a property"
              testID="mortgage-switcher-add"
            >
              <Icon name="add-circle-outline" size={IconSize.lg} color={colors.primary} />
              <View style={styles.rowMeta}>
                <Typography variant="body" weight="semibold" color={colors.primary}>
                  Add a property
                </Typography>
              </View>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </AdaptiveModal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    maxWidth: '100%',
    gap: Spacing.xxs,
  },
  triggerLabel: {
    flexShrink: 1,
  },
  sheet: {
    flex: 1,
  },
  sheetContent: {
    padding: Spacing.base,
    gap: Spacing.sm,
    maxWidth: Layout.readingMaxWidth,
    width: '100%',
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
  },
  rowMeta: {
    flex: 1,
    gap: Spacing.xxs,
  },
});
