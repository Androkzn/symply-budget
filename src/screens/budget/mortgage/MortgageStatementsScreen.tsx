import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { mortgageApi, type MortgageStatement } from '@api/mortgage';
import {
  AppBackground,
  HeaderActionButton,
  SafeAreaView,
  ScreenHeader,
  screenScrollViewStyle,
} from '@components/common';
import { Button, Card, EmptyState, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useMortgageStore } from '@stores/mortgageStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors, type AppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

function fmtCents(cents: number): string {
  return formatMoney(cents);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// Turn a stored `YYYY-MM-DD` statement date into a "May 2026" month header.
// Parses the parts directly so it never shifts a day across timezones.
function fmtMonthYear(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  const name = MONTH_NAMES[(m ?? 0) - 1];
  return name && y ? `${name} ${y}` : dateStr;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  camera: 'Scanned',
  gallery: 'Imported',
  file: 'Imported',
  google_drive: 'Drive',
};

function hexToRgba(hex: string, alpha: number): string {
  const sanitized = hex.replace('#', '');
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// One hue per origin so the list scans by colour: hand-typed rows stay neutral
// gray, scans take the brand teal, imports indigo and Drive amber.
function sourceTone(colors: AppColors, source: string): string {
  switch (source) {
    case 'camera':
      return colors.primaryDark;
    case 'gallery':
    case 'file':
      return colors.info;
    case 'google_drive':
      return colors.warning;
    default:
      return colors.textSecondary;
  }
}

/**
 * Origin badge — a tinted pill (label in the hue, background at 14% of it).
 * Rolled locally rather than via the shared `Chip` because Chip's neutral
 * variant resolves to the very surface these pills sit on in the clean skin
 * (`groupedListBackground` === `backgroundSecondary` === #F7FAFA → invisible).
 */
function SourcePill({ source, testID }: { source: string; testID?: string }) {
  const colors = useAppColors();
  const tone = sourceTone(colors, source);
  return (
    <View style={[styles.pill, { backgroundColor: hexToRgba(tone, 0.14) }]} testID={testID}>
      <Typography variant="caption2" weight="semibold" color={tone}>
        {SOURCE_LABEL[source] ?? source}
      </Typography>
    </View>
  );
}

/**
 * Manage the statements that anchor a property's balance — the "clean / edit
 * any data manually" surface. Each committed statement RE-ANCHORS the mortgage
 * balance, so deleting one reverts the property to the theoretical projection
 * from the next-newest anchor. Add / edit route through the statement form;
 * "Clear all" wipes every anchor back to the pure amortization schedule.
 */
export function MortgageStatementsScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const route = useRoute<RouteProp<BudgetStackParamList, 'MortgageStatements'>>();
  const mortgageId = route.params?.mortgageId;
  const { currentHousehold } = useHouseholdStore();
  const dataRevision = useMortgageStore((s) => s.dataRevision);
  const markDirty = useMortgageStore((s) => s.markDirty);

  const [statements, setStatements] = useState<MortgageStatement[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentHousehold?.id || !mortgageId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const { statements: list } = await mortgageApi.listStatements(currentHousehold.id, mortgageId);
      setStatements(list);
    } catch {
      setStatements([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold?.id, mortgageId]);

  // A peer can update this property while the detail screen stays open.
  useEffect(() => {
    if (dataRevision > 0) load();
  }, [dataRevision, load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onDelete = (s: MortgageStatement) => {
    Alert.alert(
      'Delete statement?',
      `The statement dated ${s.statement_date} will be removed. Your balance re-anchors to the next-newest statement.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!currentHousehold?.id || !mortgageId) return;
            try {
              await mortgageApi.deleteStatement(currentHousehold.id, mortgageId, s.id);
              markDirty();
              await load();
            } catch {
              Alert.alert('Error', 'Could not delete that statement. Please try again.');
            }
          },
        },
      ]
    );
  };

  const onClearAll = () => {
    if (!statements || statements.length === 0) return;
    Alert.alert(
      'Clear all statements?',
      'Every statement for this property will be removed and its balance will fall back to the theoretical amortization schedule. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: async () => {
            if (!currentHousehold?.id || !mortgageId) return;
            try {
              for (const s of statements) {
                await mortgageApi.deleteStatement(currentHousehold.id, mortgageId, s.id);
              }
              markDirty();
              await load();
            } catch {
              Alert.alert('Error', 'Could not clear the statements. Please try again.');
              await load();
            }
          },
        },
      ]
    );
  };

  const goAdd = () => {
    if (mortgageId) navigation.navigate('MortgageStatementForm', { mortgageId });
  };
  const goEdit = (s: MortgageStatement) => {
    if (mortgageId) navigation.navigate('MortgageStatementForm', { mortgageId, statement: s });
  };

  // Primary action lives in the header (same slot as the Mortgage tab's "Add
  // statement"), so the list body starts at the first statement. Rendered in
  // the loading branch too, so it doesn't pop in once the fetch settles.
  const addAction = (
    <HeaderActionButton
      iconOnly
      onPress={goAdd}
      testID="mortgage-statements-add"
      accessibilityLabel="Add a statement"
    >
      <Icon name="add" size={IconSize.lg} active />
    </HeaderActionButton>
  );

  if (isLoading && statements === null) {
    return (
      <AppBackground>
        <SafeAreaView edges={[]} testID="mortgage-statements-screen">
          <ScreenHeader
            title="Statements"
            showBackButton
            onBackPress={() => navigation.goBack()}
            showNotificationBell={false}
            showAvatar={false}
            showPropertySwitcher={false}
            rightElement={addAction}
          />
          <View style={styles.center} testID="mortgage-statements-loading">
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  const isEmpty = !statements || statements.length === 0;

  return (
    <AppBackground>
    <SafeAreaView edges={[]} testID="mortgage-statements-screen">
      <ScreenHeader
        title="Statements"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
        rightElement={addAction}
      />
      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.flex]}
        contentContainerStyle={styles.content}
      >
        {isEmpty ? (
          <View testID="mortgage-statements-empty" style={styles.emptyWrap}>
            <EmptyState
              icon="document-text-outline"
              title="No statements yet"
              description="Add a statement to confirm your balance. Until then, figures come from the amortization schedule."
              action={{
                label: 'Add a statement',
                onPress: goAdd,
                testID: 'mortgage-statements-add-empty',
              }}
            />
          </View>
        ) : (
          <>
            <Typography variant="caption" color={colors.textSecondary} style={styles.intro}>
              Tap a statement to edit it, or remove one to re-anchor your balance.
            </Typography>

            {statements!.map((s) => (
              <Card key={s.id} variant="filled" style={styles.row}>
                <TouchableOpacity
                  style={styles.rowMain}
                  activeOpacity={0.7}
                  onPress={() => goEdit(s)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit statement dated ${s.statement_date}`}
                  testID={`mortgage-statement-edit-${s.id}`}
                >
                  <View style={styles.rowMeta}>
                    {/* Month + origin share the first line — the origin used to
                        cost the card a third line of its own. */}
                    <View style={styles.rowTop}>
                      <Typography variant="caption" weight="semibold" color={colors.textSecondary}>
                        {fmtMonthYear(s.statement_date)}
                      </Typography>
                      <SourcePill
                        source={s.source}
                        testID={`mortgage-statement-source-${s.id}`}
                      />
                    </View>
                    <Typography variant="body" weight="semibold">
                      {fmtCents(s.closing_balance_cents)}
                    </Typography>
                  </View>
                  <Icon name="pencil" size={IconSize.md} color={colors.textTertiary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  activeOpacity={0.7}
                  onPress={() => onDelete(s)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete statement dated ${s.statement_date}`}
                  testID={`mortgage-statement-delete-${s.id}`}
                >
                  <Icon name="trash-outline" size={IconSize.md} color={colors.destructive} />
                </TouchableOpacity>
              </Card>
            ))}

            <Button
              title="Clear all statements"
              variant="ghost"
              textColor={colors.destructive}
              onPress={onClearAll}
              testID="mortgage-statements-clear"
              style={styles.clearButton}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, paddingBottom: Layout.bottomTabBarClearance, gap: Spacing.sm },
  intro: { marginBottom: Spacing.xs },
  emptyWrap: { marginTop: Spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', padding: 0, overflow: 'hidden' },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.smd,
    paddingHorizontal: Spacing.base,
  },
  rowMeta: { flex: 1, gap: Spacing.xxs },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: CornerRadius.lg,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
  },
  deleteBtn: {
    paddingHorizontal: Spacing.base,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  clearButton: { marginTop: Spacing.xs },
});
