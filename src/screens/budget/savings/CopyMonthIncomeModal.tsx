import * as Crypto from 'expo-crypto';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { savingsApi, type SavingsIncomeEntry } from '@api/savings';
import {
  BottomSheet,
  GradientButton,
  MonthPickerSheet,
  Typography,
  formatMonthKey,
  monthKey,
  parseMonthKey,
} from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { resolveCurrency } from '@config/currencies';
import { useTheme } from '@contexts/ThemeContext';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

import { dateToYMD, parseYMD } from './CopyEntryModal';
import { INCOME_SOURCE_LABELS } from './incomeSourceMeta';

/** How far back and forward the month wheels reach around the viewed month. */
const YEARS_BACK = 5;
const YEARS_AHEAD = 1;

/** Shift a source `YYYY-MM-DD` onto the same day-of-month in a target year/month, clamped. */
function shiftToMonth(sourceYMD: string, targetYear: number, targetMonth: number): string {
  const day = parseYMD(sourceYMD).getDate();
  const lastDay = new Date(targetYear, targetMonth, 0).getDate();
  return dateToYMD(new Date(targetYear, targetMonth - 1, Math.min(day, lastDay), 12));
}

/** "Aug 15" — the row's own date, since every row in the sheet shares a month. */
function formatEntryDate(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface CopyMonthIncomeModalProps {
  visible: boolean;
  /** Empty when no household is resolved yet — the sheet no-ops until it is. */
  householdId: string;
  /** The currently viewed month — the copy destination. */
  targetYear: number;
  targetMonth: number;
  onClose: () => void;
  /** Called once entries are created (or the sheet found nothing to copy). */
  onCopied: (count: number) => void;
}

/**
 * "Copy income from another month" — pick a source month on wheels, then tick
 * exactly which of its entries to duplicate into the currently viewed month
 * (fresh ids, same day-of-month).
 *
 * Per-entry selection rather than the whole month: a month usually mixes income
 * that repeats (payroll, rent) with income that does not (a bonus, a refund),
 * and copying the one-offs forward is the mistake this sheet exists to avoid.
 * Everything starts ticked, so "copy the whole month" is still one tap.
 *
 * Client-composed like `CopyEntryModal`: no bulk backend endpoint, just
 * `listIncome` the source month then `createIncome` each picked row.
 */
export function CopyMonthIncomeModal({
  visible,
  householdId,
  targetYear,
  targetMonth,
  onClose,
  onCopied,
}: CopyMonthIncomeModalProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();

  /** The month before the one being viewed — the answer nearly every time. */
  const defaultSourceKey = useMemo(
    () =>
      targetMonth === 1
        ? monthKey(targetYear - 1, 12)
        : monthKey(targetYear, targetMonth - 1),
    [targetYear, targetMonth]
  );

  const [sourceKey, setSourceKey] = useState(defaultSourceKey);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [entries, setEntries] = useState<SavingsIncomeEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);

  const source = useMemo(
    () => parseMonthKey(sourceKey) ?? { year: targetYear, month: targetMonth },
    [sourceKey, targetYear, targetMonth]
  );

  // Copying a month into itself would duplicate every row it already holds —
  // never what the member meant, and only reachable by scrolling the wheels
  // back onto the month behind the sheet.
  const isSelfCopy = source.year === targetYear && source.month === targetMonth;

  // Re-seed to "previous month" each time the sheet opens.
  useEffect(() => {
    if (visible) setSourceKey(defaultSourceKey);
  }, [visible, defaultSourceKey]);

  useEffect(() => {
    if (!visible || !householdId) return;
    let cancelled = false;
    setLoading(true);
    savingsApi
      .listIncome(householdId, source.year, source.month)
      .then(({ entries: rows }) => {
        if (cancelled) return;
        setEntries(rows);
        // Everything ticked on arrival: the whole month is the common case, and
        // un-ticking the two rows you don't want beats ticking the ten you do.
        setSelectedIds(rows.map((row) => row.id));
      })
      .catch((error) => {
        console.error('Error loading source month income:', error);
        if (cancelled) return;
        setEntries([]);
        setSelectedIds([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, householdId, source.year, source.month]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]
    );
  }, []);

  const allSelected = entries.length > 0 && selectedIds.length === entries.length;

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => (prev.length === entries.length ? [] : entries.map((row) => row.id)));
  }, [entries]);

  const selectedCount = selectedIds.length;
  const selectedTotalCents = useMemo(
    () =>
      entries.reduce((sum, row) => (selectedIds.includes(row.id) ? sum + row.amount_cents : sum), 0),
    [entries, selectedIds]
  );

  const canCopy = !copying && !loading && !isSelfCopy && selectedCount > 0;

  const copy = async () => {
    if (!householdId || !canCopy) return;
    const picked = entries.filter((row) => selectedIds.includes(row.id));
    setCopying(true);
    try {
      await Promise.all(
        picked.map((row) =>
          savingsApi.createIncome(householdId, {
            id: Crypto.randomUUID(),
            member_id: row.member_id,
            source_type: row.source_type,
            label: row.label,
            amount_cents: row.amount_cents,
            income_date: shiftToMonth(row.income_date, targetYear, targetMonth),
            currency: resolveCurrency(row.currency).code,
            notes: row.notes,
          })
        )
      );
      onCopied(picked.length);
    } catch (error) {
      console.error('Error copying income from month:', error);
      Alert.alert('Error', 'Could not copy income from that month.');
    } finally {
      setCopying(false);
    }
  };

  const sourceLabel = formatMonthKey(sourceKey) || formatMonthKey(defaultSourceKey);
  const targetLabel = formatMonthKey(monthKey(targetYear, targetMonth));

  const confirmTitle = copying
    ? 'Copying…'
    : // A live count on a button that cannot fire reads as a bug; while the
      // wheels sit on the viewed month the button says why it is dead.
      isSelfCopy
      ? 'Pick another month'
      : selectedCount > 0
        ? `Copy ${selectedCount} ${selectedCount === 1 ? 'entry' : 'entries'}`
        : 'Nothing selected';

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.bodyCentered}>
          <ActivityIndicator size="small" color={theme.pastel.teal} />
        </View>
      );
    }
    if (isSelfCopy) {
      return (
        <View style={styles.bodyCentered}>
          <Typography variant="body" color={colors.textSecondary} align="center">
            {`${sourceLabel} is the month you're viewing. Pick a different month to copy from.`}
          </Typography>
        </View>
      );
    }
    if (entries.length === 0) {
      return (
        <View style={styles.bodyCentered}>
          <Typography variant="body" color={colors.textSecondary} align="center">
            {`No income recorded in ${sourceLabel}.`}
          </Typography>
        </View>
      );
    }
    return (
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {entries.map((row, index) => {
          const checked = selectedIds.includes(row.id);
          const subtitle = [INCOME_SOURCE_LABELS[row.source_type], formatEntryDate(row.income_date)]
            .filter(Boolean)
            .join(' · ');
          return (
            <Pressable
              key={row.id}
              onPress={() => toggleOne(row.id)}
              style={({ pressed }) => [
                styles.itemRow,
                { borderTopColor: colors.borderColor },
                index === 0 && styles.itemRowFirst,
                pressed && { backgroundColor: colors.backgroundSecondary },
              ]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              accessibilityLabel={`${row.label}. ${subtitle}. ${formatCurrency(row.amount_cents)}`}
              testID={`copy-month-income-row-${row.id}`}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    backgroundColor: checked ? colors.primary : 'transparent',
                    borderColor: checked ? colors.primary : colors.borderColor,
                  },
                ]}
              >
                {checked && <Icon name="checkmark" size={14} color={colors.white} />}
              </View>
              <View style={styles.itemContent}>
                <Typography variant="body" weight="medium" numberOfLines={1}>
                  {row.label}
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1}>
                  {subtitle}
                </Typography>
              </View>
              <Typography variant="subheadline" weight="semibold" color={theme.pastel.teal}>
                {formatCurrency(row.amount_cents)}
              </Typography>
            </Pressable>
          );
        })}
      </ScrollView>
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="tall"
      noPadding
      title="Copy income"
      showCloseButton
      closeTestID="copy-month-income-cancel"
    >
      <View style={styles.section}>
        <Typography variant="caption1" color={colors.textSecondary}>
          {`Pick a month, then choose which entries to copy into ${targetLabel}.`}
        </Typography>

        <Pressable
          onPress={() => setPickerOpen(true)}
          style={[styles.monthField, { borderColor: colors.borderColor, backgroundColor: colors.card }]}
          accessibilityRole="button"
          accessibilityLabel={`Copy from ${sourceLabel}. Change month`}
          testID="copy-month-income-month-field"
        >
          <Icon name="calendar-outline" size={18} color={colors.textSecondary} />
          <View style={styles.monthFieldText}>
            <Typography variant="caption2" color={colors.textSecondary}>
              Copy from
            </Typography>
            <Typography variant="body" weight="semibold" testID="copy-month-income-source-label">
              {sourceLabel}
            </Typography>
          </View>
          <Icon name="chevron-down" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      {!loading && !isSelfCopy && entries.length > 0 && (
        <View style={[styles.toolbar, { borderBottomColor: colors.borderColor }]}>
          <Pressable
            onPress={toggleAll}
            hitSlop={8}
            style={styles.selectAll}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allSelected }}
            testID="copy-month-income-select-all"
          >
            <View
              style={[
                styles.checkbox,
                {
                  backgroundColor: allSelected ? colors.primary : 'transparent',
                  borderColor: allSelected ? colors.primary : colors.borderColor,
                },
              ]}
            >
              {allSelected && <Icon name="checkmark" size={14} color={colors.white} />}
            </View>
            <Typography variant="caption1" weight="semibold">
              {allSelected ? 'Deselect all' : 'Select all'}
            </Typography>
          </Pressable>

          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID="copy-month-income-preview"
          >
            {`${selectedCount} of ${entries.length} selected · ${formatCurrency(selectedTotalCents)}`}
          </Typography>
        </View>
      )}

      {renderBody()}

      <View style={[styles.footer, { paddingBottom: Spacing.base + insets.bottom }]}>
        <GradientButton
          title={confirmTitle}
          variant="blue"
          onPress={copy}
          disabled={!canCopy}
          fullWidth
          testID="copy-month-income-confirm"
        />
      </View>

      {/* Nested inside this sheet's own Modal rather than beside it: two sibling
          Modals presented at once is the arrangement iOS handles worst, and the
          wheels have to open over a sheet that stays put behind them. */}
      <MonthPickerSheet
        visible={pickerOpen}
        value={sourceKey}
        title="Copy from month"
        minMonth={monthKey(targetYear - YEARS_BACK, 1)}
        maxMonth={monthKey(targetYear + YEARS_AHEAD, 12)}
        onConfirm={setSourceKey}
        onClose={() => setPickerOpen(false)}
        testID="copy-month-income-picker"
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: Spacing.base,
    gap: Spacing.md,
    paddingBottom: Spacing.base,
  },
  monthField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
  },
  monthFieldText: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  selectAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: CornerRadius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.base,
  },
  bodyCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.base,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  itemRowFirst: {
    borderTopWidth: 0,
  },
  itemContent: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
  },
});
