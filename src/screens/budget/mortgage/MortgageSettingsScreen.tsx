import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { mortgageApi, type MortgageListItem } from '@api/mortgage';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Button, Card, EmptyState, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useMortgageStore } from '@stores/mortgageStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

/** Whole-dollar balance for the property rows ($480,000 — no cents noise). */
function fmtCents(cents: number): string {
  return formatMoney(cents);
}

/**
 * Mortgage settings hub (Budget-only) — reached from the header gear while the
 * Mortgage tab is active. Lets the user MANAGE their properties (mortgages):
 * switch which one the dashboard shows, edit its details, clean/edit its
 * statement data, delete it, or add another. Owns no money math — the property
 * rows render the BE-computed list view model, and every mutation bumps the
 * store's `dataRevision` (via `markDirty`) so the dashboard reloads on return.
 */
export function MortgageSettingsScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold } = useHouseholdStore();
  const dataRevision = useMortgageStore((s) => s.dataRevision);
  const { selectedMortgageId, setSelectedMortgage, markDirty } = useMortgageStore();

  const [mortgages, setMortgages] = useState<MortgageListItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentHousehold?.id) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const { mortgages: list } = await mortgageApi.list(currentHousehold.id);
      setMortgages(list);
    } catch {
      setMortgages([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold?.id]);

  // A peer can update this property while the detail screen stays open.
  useEffect(() => {
    if (dataRevision > 0) load();
  }, [dataRevision, load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // The dashboard shows the selected mortgage, or the first when none is set —
  // mirror that here so the highlighted row matches what the tab renders.
  const activeId =
    mortgages?.find((m) => m.id === selectedMortgageId)?.id ?? mortgages?.[0]?.id ?? null;

  const onSelect = (id: string) => {
    setSelectedMortgage(id);
    markDirty();
  };

  const onDelete = (m: MortgageListItem) => {
    Alert.alert(
      'Delete property?',
      `“${m.nickname}” and all of its statements, terms and history will be permanently removed. This can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!currentHousehold?.id) return;
            try {
              await mortgageApi.remove(currentHousehold.id, m.id);
              // Drop the selection if we just removed it so the dashboard falls
              // back to the first remaining property (or the empty state).
              if (selectedMortgageId === m.id) setSelectedMortgage(null);
              markDirty();
              await load();
            } catch {
              Alert.alert('Error', 'Could not delete this property. Please try again.');
            }
          },
        },
      ]
    );
  };

  if (isLoading && mortgages === null) {
    return (
      <AppBackground>
        <SafeAreaView edges={[]} testID="mortgage-settings-screen">
          <ScreenHeader
            title="Mortgage settings"
            showBackButton
            onBackPress={() => navigation.goBack()}
            showNotificationBell={false}
            showAvatar={false}
            showPropertySwitcher={false}
          />
          <View style={styles.center} testID="mortgage-settings-loading">
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  const isEmpty = !mortgages || mortgages.length === 0;

  return (
    <AppBackground>
    <SafeAreaView edges={[]} testID="mortgage-settings-screen">
      <ScreenHeader
        title="Mortgage settings"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
      />
      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.flex]}
        contentContainerStyle={styles.content}
      >
        {isEmpty ? (
          <View testID="mortgage-settings-empty">
            <EmptyState
              icon="home"
              title="No properties yet"
              description="Add a mortgage to track its balance, equity and renewal. You can manage several properties from here."
              action={{
                label: 'Add a property',
                onPress: () => navigation.navigate('MortgageSetup'),
              }}
            />
          </View>
        ) : (
          <>
            <Typography variant="caption" color={colors.textSecondary} style={styles.intro}>
              Tap a property to switch to it on the dashboard. Edit its details, manage its
              statements, or remove it.
            </Typography>

            {mortgages!.map((m) => {
              const selected = m.id === activeId;
              const meta =
                (m.lender ? `${m.lender} · ` : '') +
                `${fmtCents(m.currentBalanceCents)} · ${Math.round(m.pctPaid * 100)}% paid`;
              return (
                <Card
                  key={m.id}
                  variant="filled"
                  style={StyleSheet.flatten([
                    styles.propertyCard,
                    selected ? { borderColor: colors.primary, borderWidth: 1 } : null,
                  ])}
                >
                  <TouchableOpacity
                    style={styles.propertyHeader}
                    activeOpacity={0.7}
                    onPress={() => onSelect(m.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Switch to ${m.nickname}`}
                    testID={`mortgage-property-row-${m.id}`}
                  >
                    <Icon
                      name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={IconSize.lg}
                      color={selected ? colors.primary : colors.textTertiary}
                      testID={selected ? `mortgage-property-selected-${m.id}` : undefined}
                    />
                    <View style={styles.propertyMeta}>
                      <Typography variant="body" weight="semibold">
                        {m.nickname}
                      </Typography>
                      <Typography variant="caption" color={colors.textSecondary}>
                        {meta}
                      </Typography>
                    </View>
                  </TouchableOpacity>

                  <View style={[styles.actionRow, { borderTopColor: colors.divider }]}>
                    <ActionButton
                      icon="pencil"
                      label="Edit"
                      onPress={() => navigation.navigate('MortgageEdit', { mortgageId: m.id })}
                      testID={`mortgage-property-edit-${m.id}`}
                    />
                    <ActionButton
                      icon="document-text-outline"
                      label="Statements"
                      onPress={() =>
                        navigation.navigate('MortgageStatements', { mortgageId: m.id })
                      }
                      testID={`mortgage-property-statements-${m.id}`}
                    />
                    <ActionButton
                      icon="trash-outline"
                      label="Delete"
                      tint={colors.destructive}
                      onPress={() => onDelete(m)}
                      testID={`mortgage-property-delete-${m.id}`}
                    />
                  </View>
                </Card>
              );
            })}

            <Button
              title="Add a property"
              variant="secondary"
              onPress={() => navigation.navigate('MortgageSetup')}
              testID="mortgage-settings-add"
              style={styles.addButton}
            />
          </>
        )}

        {/* Dashboard chrome, not a property — offered whether or not one exists. */}
        <Card variant="filled" style={styles.linkCard}>
          <TouchableOpacity
            style={styles.linkRow}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('MortgageTabs')}
            accessibilityRole="button"
            accessibilityLabel="Customize tabs"
            testID="mortgage-settings-customize-tabs"
          >
            <Icon name="reorder-three-outline" size={IconSize.lg} color={colors.primary} />
            <View style={styles.propertyMeta}>
              <Typography variant="body" weight="semibold">
                Customize tabs
              </Typography>
              <Typography variant="caption" color={colors.textSecondary}>
                Reorder or hide the tabs on the Mortgage screen
              </Typography>
            </View>
            <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
          </TouchableOpacity>
        </Card>
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  tint,
  testID,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  tint?: string;
  testID?: string;
}) {
  const colors = useAppColors();
  const color = tint ?? colors.textSecondary;
  return (
    <TouchableOpacity
      style={styles.actionBtn}
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Icon name={icon} size={IconSize.md} color={color} />
      <Typography variant="caption" color={color}>
        {label}
      </Typography>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, paddingBottom: Layout.bottomTabBarClearance, gap: Spacing.md },
  intro: { marginBottom: Spacing.xs },
  linkCard: { padding: 0, overflow: 'hidden' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.base,
  },
  propertyCard: { padding: 0, overflow: 'hidden' },
  propertyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.base,
  },
  propertyMeta: { flex: 1, gap: Spacing.xxs },
  actionRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xxs,
    paddingVertical: Spacing.md,
  },
  addButton: { marginTop: Spacing.sm, borderRadius: CornerRadius.md },
});
