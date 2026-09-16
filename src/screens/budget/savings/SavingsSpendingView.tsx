import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Crypto from 'expo-crypto';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';

import {
  savingsApi,
  type SavingsCategory,
  type SavingsSpendingEntry,
} from '@api/savings';
import {
  NativeSwipeAction,
  NativeSwipeActions,
  NativeSwipeable,
  Typography,
  type SwipeableMethods,
} from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { resolveCurrency } from '@config/currencies';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore } from '@stores/savingsStore';
import { CornerRadius, EmptyState, Spacing, useAppColors } from '@theme';

import { BUDGET_CTA_ROW_STYLES } from '../budgetCtaLayout';
import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { CopyEntryModal } from './CopyEntryModal';

function formatDate(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function SavingsSpendingView() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, selectedMonth, dataRevision, markDirty } = useSavingsStore();

  const [entries, setEntries] = useState<SavingsSpendingEntry[]>([]);
  const [categories, setCategories] = useState<SavingsCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copyRow, setCopyRow] = useState<SavingsSpendingEntry | null>(null);
  const swipeableRefs = useRef<Map<string, React.RefObject<SwipeableMethods | null>>>(new Map());

  const getSwipeableRef = useCallback((id: string) => {
    let ref = swipeableRefs.current.get(id);
    if (!ref) {
      ref = React.createRef<SwipeableMethods>();
      swipeableRefs.current.set(id, ref);
    }
    return ref;
  }, []);

  const categoryById = useMemo(() => {
    const map = new Map<string, SavingsCategory>();
    for (const cat of categories) map.set(cat.id, cat);
    return map;
  }, [categories]);

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    try {
      const [spending, cats] = await Promise.all([
        savingsApi.listSpending(currentHousehold.id, selectedYear, selectedMonth),
        savingsApi.listCategories(currentHousehold.id),
      ]);
      setEntries(spending.entries);
      setCategories(cats.categories);
    } catch (error) {
      console.error('Error loading savings spending:', error);
    }
  }, [currentHousehold?.id, selectedYear, selectedMonth]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load])
  );

  // Skips only the very first run (useFocusEffect above already covers the
  // initial load) — every later change, including a bare month-nav tap with
  // no mutation, must still refetch.
  const didMountRef = React.useRef(false);
  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    void load();
  }, [currentHousehold?.id, selectedYear, selectedMonth, dataRevision, load]);

  const openCopy = useCallback(
    (row: SavingsSpendingEntry) => {
      getSwipeableRef(row.id).current?.close();
      setCopyRow(row);
    },
    [getSwipeableRef]
  );

  const handleCopyTo = useCallback(
    async (targetDate: string) => {
      const row = copyRow;
      if (!currentHousehold?.id || !row) return;
      setBusyId(row.id);
      try {
        await savingsApi.createSpending(currentHousehold.id, {
          id: Crypto.randomUUID(),
          category_id: row.category_id,
          label: row.label,
          amount_cents: row.amount_cents,
          spending_date: targetDate,
          currency: resolveCurrency(row.currency).code,
          notes: row.notes,
        });
        setCopyRow(null);
        markDirty();
        await load();
      } catch (error) {
        console.error('Error copying spending:', error);
        Alert.alert('Error', 'Could not copy this spending.');
      } finally {
        setBusyId(null);
      }
    },
    [copyRow, currentHousehold?.id, load, markDirty]
  );

  const openEdit = useCallback(
    (row: SavingsSpendingEntry) => {
      getSwipeableRef(row.id).current?.close();
      navigation.navigate('SavingsEntryForm', { mode: 'spending', entryId: row.id });
    },
    [getSwipeableRef, navigation]
  );

  const handleDelete = useCallback(
    (row: SavingsSpendingEntry) => {
      if (!currentHousehold?.id) return;
      getSwipeableRef(row.id).current?.close();
      Alert.alert('Delete spending', `Delete "${row.label}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyId(row.id);
            try {
              await savingsApi.deleteSpending(currentHousehold.id, row.id);
              markDirty();
              await load();
            } catch (error) {
              console.error('Error deleting spending:', error);
              Alert.alert('Error', 'Could not delete this spending.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]);
    },
    [currentHousehold?.id, getSwipeableRef, load, markDirty]
  );

  const renderActions = useCallback(
    (row: SavingsSpendingEntry) => {
      const isBusy = busyId === row.id;
      return (
        <NativeSwipeActions>
          <NativeSwipeAction
            backgroundColor={theme.pastel.teal}
            onPress={() => openEdit(row)}
            disabled={isBusy}
            label="Edit"
            testID="savings-spending-edit"
          >
            <Icon name="pencil" size={20} color={colors.white} />
          </NativeSwipeAction>
          {/* Saturated blue, not the near-white `pastel.skyBlue`: a white glyph
              on that pastel fill was effectively invisible in the open row. */}
          <NativeSwipeAction
            backgroundColor={colors.blue}
            onPress={() => openCopy(row)}
            disabled={isBusy}
            label="Copy"
            testID="savings-spending-copy"
          >
            {isBusy ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Icon name="copy-outline" size={20} color={colors.white} />
            )}
          </NativeSwipeAction>
          <NativeSwipeAction
            backgroundColor={colors.error}
            onPress={() => handleDelete(row)}
            disabled={isBusy}
            label="Delete"
            testID="savings-spending-delete"
          >
            {isBusy ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Icon name="trash-outline" size={20} color={colors.white} />
            )}
          </NativeSwipeAction>
        </NativeSwipeActions>
      );
    },
    [
      busyId,
      colors.blue,
      colors.error,
      colors.white,
      handleDelete,
      openCopy,
      openEdit,
      theme.pastel.teal,
    ]
  );

  const totalCents = useMemo(
    () => entries.reduce((sum, e) => sum + e.amount_cents, 0),
    [entries]
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.pastel.teal} />
      </View>
    );
  }

  return (
    <View testID="savings-spending" style={styles.root}>
      <View style={styles.ctaRow}>
        <TouchableOpacity
          onPress={() => navigation.navigate('SavingsEntryForm', { mode: 'spending' })}
          activeOpacity={0.85}
          style={[styles.addCta, { backgroundColor: theme.pastel.teal }]}
          testID="savings-add-spending"
        >
          <Icon name="add" size={18} color={colors.white} />
          <Typography variant="body" weight="semibold" color={colors.white}>
            Add spending
          </Typography>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.navigate('SavingsRecurringPayments')}
          activeOpacity={0.85}
          style={[styles.addCta, styles.addCtaOutline, { borderColor: theme.pastel.teal }]}
          testID="savings-monthly-payments"
        >
          <Icon name="repeat" size={16} color={theme.pastel.teal} />
          <Typography variant="caption1" weight="semibold" color={theme.pastel.teal}>
            Monthly Payments
          </Typography>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={() => navigation.navigate('SavingsImport', { scope: 'spending' })}
        activeOpacity={0.85}
        style={[styles.aiCta, { borderColor: theme.pastel.teal }]}
        testID="savings-spending-ai-import"
      >
        <Icon name="sparkles-outline" size={18} color={theme.pastel.teal} />
        <Typography variant="body" weight="semibold" color={theme.pastel.teal}>
          Import spending (AI)
        </Typography>
      </TouchableOpacity>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Typography variant="body" color={colors.textSecondary} align="center">
            No spending recorded for this month yet.
          </Typography>
        </View>
      ) : (
        <>
          <View style={[styles.totalRow, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="body" weight="semibold">
              Total spending
            </Typography>
            <Typography
              variant="headline"
              weight="bold"
              color={theme.pastel.teal}
              testID="savings-spending-total"
            >
              {formatCurrency(totalCents)}
            </Typography>
          </View>
          <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
          {entries.map((row, index) => {
            const category = row.category_id ? categoryById.get(row.category_id) : null;
            const subtitleParts = [category?.name, formatDate(row.spending_date)].filter(Boolean);
            return (
              <NativeSwipeable
                key={row.id}
                ref={getSwipeableRef(row.id)}
                renderRightActions={() => renderActions(row)}
              >
                <TouchableOpacity
                  style={[
                    styles.itemRow,
                    { backgroundColor: colors.backgroundSecondary, borderTopColor: colors.borderColor },
                    index === 0 && styles.itemRowFirst,
                  ]}
                  onPress={() =>
                    navigation.navigate('SavingsEntryForm', { mode: 'spending', entryId: row.id })
                  }
                  activeOpacity={0.7}
                  testID="savings-spending-item"
                >
                  <View style={styles.itemContent}>
                    <Typography variant="body" weight="medium" numberOfLines={1}>
                      {row.label}
                    </Typography>
                    <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1}>
                      {subtitleParts.join(' · ')}
                    </Typography>
                  </View>
                  <Typography variant="subheadline" weight="semibold" color={theme.pastel.teal}>
                    {formatCurrency(row.amount_cents)}
                  </Typography>
                </TouchableOpacity>
              </NativeSwipeable>
            );
          })}
          </View>
        </>
      )}

      <CopyEntryModal
        visible={copyRow !== null}
        title="Copy spending"
        entryLabel={copyRow?.label ?? ''}
        sourceDateYMD={(copyRow?.spending_date ?? '').slice(0, 10)}
        busy={busyId !== null}
        onClose={() => setCopyRow(null)}
        onConfirm={(targetDate) => void handleCopyTo(targetDate)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignSelf: 'stretch',
  },
  loadingContainer: {
    paddingVertical: EmptyState.blockPaddingVertical,
    alignItems: 'center',
  },
  ctaRow: {
    ...BUDGET_CTA_ROW_STYLES.addRow,
    marginBottom: Spacing.base,
  },
  addCta: {
    ...BUDGET_CTA_ROW_STYLES.addCta,
  },
  aiCta: {
    ...BUDGET_CTA_ROW_STYLES.addCta,
    flex: 0,
    alignSelf: 'stretch',
    borderWidth: 1.5,
    marginTop: Spacing.smd,
    marginBottom: Spacing.sm,
  },
  addCtaOutline: {
    borderWidth: 1.5,
  },
  card: {
    borderRadius: CornerRadius.lg,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.lg,
    marginBottom: Spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    paddingLeft: Spacing.base,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  itemRowFirst: {
    borderTopWidth: 0,
  },
  itemContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  empty: {
    paddingVertical: Spacing.xxl,
  },
});
