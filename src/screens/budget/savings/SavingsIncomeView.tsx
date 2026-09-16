import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Crypto from 'expo-crypto';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';

import { savingsApi, type SavingsIncomeEntry, type SavingsIncomeSourceType } from '@api/savings';
import {
  IconBackgroundChip,
  NativeSwipeAction,
  NativeSwipeActions,
  NativeSwipeable,
  Typography,
  type SwipeableMethods,
} from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon, hasBrandIcon } from '@components/ui/Icon';
import { resolveCurrency } from '@config/currencies';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore } from '@stores/savingsStore';
import {
  CornerRadius,
  EmptyState,
  IconSize,
  Spacing,
  hexToRgba,
  useAppColors,
  type AppColors,
} from '@theme';

import {
  BUDGET_CTA_ROW_STYLES,
  budgetCtaFill,
  budgetCtaOutline,
  budgetCtaTint,
} from '../budgetCtaLayout';
import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { CopyEntryModal } from './CopyEntryModal';
import { CopyMonthIncomeModal } from './CopyMonthIncomeModal';
import { INCOME_SOURCE_LABELS } from './incomeSourceMeta';

const SOURCE_LABELS = INCOME_SOURCE_LABELS;

/** Brand-kit slug per income source, shown in a tinted leading bubble. */
const SOURCE_ICONS: Record<SavingsIncomeSourceType, string> = {
  payroll: 'income',
  rental: 'housing',
  rrsp_matching: 'savings',
  tax_refund: 'receipt',
  insurance: 'insurance',
  other: 'other',
  marketplace_sale: 'marketplace',
  gift: 'gift',
  refund: 'refund',
  bonus: 'bonus',
  freelance: 'freelance',
};

/** Distinct semantic accent per source — all pulled from theme tokens. */
function sourceAccent(type: SavingsIncomeSourceType, colors: AppColors): string {
  switch (type) {
    case 'payroll':
      return colors.blue;
    case 'rental':
      return colors.orange;
    case 'rrsp_matching':
      return colors.purple;
    case 'tax_refund':
      return colors.success;
    case 'insurance':
      return colors.info;
    // Irregular sources share the warm accent so one-off income reads as a
    // visually distinct group from predictable income in the list.
    case 'marketplace_sale':
    case 'gift':
    case 'refund':
    case 'bonus':
    case 'freelance':
      return colors.warning;
    case 'other':
    default:
      return colors.textSecondary;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function SavingsIncomeView() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold, currentHouseholdMembers } = useHouseholdStore();
  const { selectedYear, selectedMonth, dataRevision, markDirty } = useSavingsStore();

  const [entries, setEntries] = useState<SavingsIncomeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [copyRow, setCopyRow] = useState<SavingsIncomeEntry | null>(null);
  const [copyMonthVisible, setCopyMonthVisible] = useState(false);
  const swipeableRefs = useRef<Map<string, React.RefObject<SwipeableMethods | null>>>(new Map());

  const getSwipeableRef = useCallback((id: string) => {
    let ref = swipeableRefs.current.get(id);
    if (!ref) {
      ref = React.createRef<SwipeableMethods>();
      swipeableRefs.current.set(id, ref);
    }
    return ref;
  }, []);

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of currentHouseholdMembers) {
      // Income entries store member_id as the membership id (HouseholdMember.id),
      // which is the backend's canonical member key — not user_id.
      map.set(member.id, member.display_name ?? 'Member');
    }
    return map;
  }, [currentHouseholdMembers]);

  const load = useCallback(async () => {
    if (!currentHousehold?.id) return;
    try {
      const { entries: rows } = await savingsApi.listIncome(
        currentHousehold.id,
        selectedYear,
        selectedMonth
      );
      setEntries(rows);
    } catch (error) {
      console.error('Error loading savings income:', error);
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
    (row: SavingsIncomeEntry) => {
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
        await savingsApi.createIncome(currentHousehold.id, {
          id: Crypto.randomUUID(),
          member_id: row.member_id,
          source_type: row.source_type,
          label: row.label,
          amount_cents: row.amount_cents,
          income_date: targetDate,
          currency: resolveCurrency(row.currency).code,
          notes: row.notes,
        });
        setCopyRow(null);
        markDirty();
        await load();
      } catch (error) {
        console.error('Error copying income:', error);
        Alert.alert('Error', 'Could not copy this income.');
      } finally {
        setBusyId(null);
      }
    },
    [copyRow, currentHousehold?.id, load, markDirty]
  );

  const handleCopiedFromMonth = useCallback(
    (count: number) => {
      setCopyMonthVisible(false);
      if (count > 0) {
        markDirty();
        void load();
      }
    },
    [load, markDirty]
  );

  const openEdit = useCallback(
    (row: SavingsIncomeEntry) => {
      getSwipeableRef(row.id).current?.close();
      navigation.navigate('SavingsEntryForm', { mode: 'income', entryId: row.id });
    },
    [getSwipeableRef, navigation]
  );

  const handleConfirm = useCallback(
    async (row: SavingsIncomeEntry) => {
      if (!currentHousehold?.id) return;
      getSwipeableRef(row.id).current?.close();
      setBusyId(row.id);
      try {
        await savingsApi.confirmIncome(currentHousehold.id, row.id);
        markDirty();
        await load();
      } catch (error) {
        console.error('Error confirming income:', error);
        Alert.alert('Error', 'Could not confirm this income.');
      } finally {
        setBusyId(null);
      }
    },
    [currentHousehold?.id, getSwipeableRef, load, markDirty]
  );

  const handleConfirmAll = useCallback(async () => {
    if (!currentHousehold?.id) return;
    setConfirmingAll(true);
    try {
      await savingsApi.confirmAllDraftIncome(currentHousehold.id, selectedYear, selectedMonth);
      markDirty();
      await load();
    } catch (error) {
      console.error('Error confirming all income:', error);
      Alert.alert('Error', 'Could not confirm these income entries.');
    } finally {
      setConfirmingAll(false);
    }
  }, [currentHousehold?.id, selectedYear, selectedMonth, load, markDirty]);

  const handleDelete = useCallback(
    (row: SavingsIncomeEntry) => {
      if (!currentHousehold?.id) return;
      getSwipeableRef(row.id).current?.close();
      Alert.alert('Delete income', `Delete "${row.label}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyId(row.id);
            try {
              await savingsApi.deleteIncome(currentHousehold.id, row.id);
              markDirty();
              await load();
            } catch (error) {
              console.error('Error deleting income:', error);
              Alert.alert('Error', 'Could not delete this income.');
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
    (row: SavingsIncomeEntry) => {
      const isBusy = busyId === row.id;
      return (
        <NativeSwipeActions>
          {row.status === 'draft' && (
            <NativeSwipeAction
              backgroundColor={colors.success}
              onPress={() => void handleConfirm(row)}
              disabled={isBusy}
              label="Confirm"
              testID="savings-income-confirm"
            >
              {isBusy ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Icon name="checkmark" size={20} color={colors.white} />
              )}
            </NativeSwipeAction>
          )}
          <NativeSwipeAction
            backgroundColor={theme.pastel.teal}
            onPress={() => openEdit(row)}
            disabled={isBusy}
            label="Edit"
            testID="savings-income-edit"
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
            testID="savings-income-copy"
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
            testID="savings-income-delete"
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
      colors.success,
      colors.white,
      handleConfirm,
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

  const draftEntries = useMemo(() => entries.filter((e) => e.status === 'draft'), [entries]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.pastel.teal} />
      </View>
    );
  }

  return (
    <View testID="savings-income" style={styles.root}>
      <View style={styles.ctaRow}>
        <TouchableOpacity
          onPress={() => navigation.navigate('SavingsEntryForm', { mode: 'income' })}
          activeOpacity={0.85}
          style={[styles.addCta, budgetCtaOutline(colors.primary)]}
          testID="savings-add-income"
        >
          <Icon name="add" size={16} color={budgetCtaTint('outline', colors)} />
          <Typography variant="caption1" weight="semibold" color={budgetCtaTint('outline', colors)}>
            Add
          </Typography>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setCopyMonthVisible(true)}
          activeOpacity={0.85}
          style={[styles.addCta, budgetCtaOutline(colors.primary)]}
          testID="savings-income-copy-month"
        >
          <Icon name="copy-outline" size={16} color={budgetCtaTint('outline', colors)} />
          <Typography variant="caption1" weight="semibold" color={budgetCtaTint('outline', colors)}>
            Copy
          </Typography>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.navigate('SavingsImport', { scope: 'income' })}
          activeOpacity={0.85}
          style={[styles.addCta, budgetCtaFill(colors.primary)]}
          testID="savings-income-ai-import"
        >
          <Icon name="sparkles" size={16} color={budgetCtaTint('primary', colors)} />
          <Typography variant="caption1" weight="semibold" color={budgetCtaTint('primary', colors)}>
            Import (AI)
          </Typography>
        </TouchableOpacity>
      </View>

      {draftEntries.length > 0 && (
        <View
          style={[styles.draftBanner, { backgroundColor: hexToRgba(colors.warning, 0.14) }]}
          testID="savings-income-draft-banner"
        >
          <View style={styles.draftBannerText}>
            <Typography variant="subheadline" weight="semibold">
              {draftEntries.length === 1
                ? '1 income entry needs confirming'
                : `${draftEntries.length} income entries need confirming`}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              Carried over from last month — review and confirm before month end.
            </Typography>
          </View>
          <TouchableOpacity
            onPress={() => void handleConfirmAll()}
            disabled={confirmingAll}
            activeOpacity={0.85}
            style={[styles.draftBannerCta, { backgroundColor: colors.warning }]}
            testID="savings-income-confirm-all"
          >
            {confirmingAll ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Typography variant="caption1" weight="semibold" color={colors.white}>
                Confirm all
              </Typography>
            )}
          </TouchableOpacity>
        </View>
      )}

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Typography variant="body" color={colors.textSecondary} align="center">
            No income recorded for this month yet.
          </Typography>
          {/* An empty month is exactly when copying last month forward is the
              answer, but the only way in was the "Copy" chip at the top of the
              screen — a word that does not say copy WHAT, from WHERE, and which
              reads as belonging to the row of add/import actions rather than to
              the empty month below it. Same sheet, stated in full, where someone
              actually looks when the month is blank. */}
          <TouchableOpacity
            onPress={() => setCopyMonthVisible(true)}
            activeOpacity={0.85}
            style={[styles.emptyCta, budgetCtaOutline(colors.primary)]}
            testID="savings-income-empty-copy-month"
          >
            <Icon name="copy-outline" size={16} color={budgetCtaTint('outline', colors)} />
            <Typography variant="caption1" weight="semibold" color={budgetCtaTint('outline', colors)}>
              Copy from another month
            </Typography>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={[styles.totalRow, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="body" weight="semibold">
              Total income
            </Typography>
            <Typography
              variant="headline"
              weight="bold"
              color={theme.pastel.teal}
              testID="savings-income-total"
            >
              {formatCurrency(totalCents)}
            </Typography>
          </View>
          <View style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
          {entries.map((row, index) => {
            const memberName = row.member_id ? memberNameById.get(row.member_id) : null;
            const subtitleParts = [SOURCE_LABELS[row.source_type], memberName, formatDate(row.income_date)].filter(
              Boolean
            );
            const accent = sourceAccent(row.source_type, colors);
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
                    navigation.navigate('SavingsEntryForm', { mode: 'income', entryId: row.id })
                  }
                  activeOpacity={0.7}
                  testID="savings-income-item"
                  accessibilityLabel={`${row.label}. ${subtitleParts.join(' · ')}. ${formatCurrency(
                    row.amount_cents
                  )}`}
                >
                  <IconBackgroundChip
                    name={SOURCE_ICONS[row.source_type]}
                    // Use the current palette for the brand artwork.
                    active={hasBrandIcon(SOURCE_ICONS[row.source_type])}
                    // Hero glyph in a 40pt bubble — the source PNGs are normalized
                    // to a uniform ink fill so every row reads the same size.
                    size={IconSize.xl}
                    backgroundColor={hexToRgba(accent, 0.14)}
                    style={styles.iconCircle}
                  />
                  <View style={styles.itemContent} testID={`savings-income-source-${row.source_type}`}>
                    <View style={styles.itemTitleRow}>
                      <Typography variant="body" weight="medium" numberOfLines={1} style={styles.itemTitleText}>
                        {row.label}
                      </Typography>
                      {row.status === 'draft' && (
                        <View
                          style={[styles.draftBadge, { backgroundColor: hexToRgba(colors.warning, 0.14) }]}
                          testID="savings-income-draft-badge"
                        >
                          <Typography variant="caption2" weight="semibold" color={colors.warning}>
                            Draft
                          </Typography>
                        </View>
                      )}
                    </View>
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
        title="Copy income"
        entryLabel={copyRow?.label ?? ''}
        sourceDateYMD={(copyRow?.income_date ?? '').slice(0, 10)}
        busy={busyId !== null}
        onClose={() => setCopyRow(null)}
        onConfirm={(targetDate) => void handleCopyTo(targetDate)}
      />

      <CopyMonthIncomeModal
        visible={copyMonthVisible}
        householdId={currentHousehold?.id ?? ''}
        targetYear={selectedYear}
        targetMonth={selectedMonth}
        onClose={() => setCopyMonthVisible(false)}
        onCopied={handleCopiedFromMonth}
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
  addCta: BUDGET_CTA_ROW_STYLES.addCta,
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
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  itemContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemTitleText: {
    flexShrink: 1,
  },
  draftBadge: {
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    marginLeft: Spacing.xs,
  },
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: CornerRadius.lg,
    padding: Spacing.base,
    marginBottom: Spacing.base,
  },
  draftBannerText: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  draftBannerCta: {
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.base,
  },
  emptyCta: {
    ...BUDGET_CTA_ROW_STYLES.addCta,
    flex: undefined,
    paddingHorizontal: Spacing.base,
  },
});
