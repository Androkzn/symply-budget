import React, { useState } from 'react';
import { Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';

import { NumberWheelPickerSheet, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';
import { formatMoney, moneySymbol, useDisplayCurrency } from '@utils/money';

import {
  TAX_PERCENT_MAX,
  TAX_PERCENT_MIN,
  TAX_PERCENT_STEP,
  formatTaxPercent,
  taxLineCents,
  totalTaxCents,
  type TaxLineDraft,
} from './budgetTaxEntry';

interface BudgetTaxSectionProps {
  /** Whether the spending carries sales tax at all (the checkbox). */
  enabled: boolean;
  onToggle: (next: boolean) => void;
  lines: TaxLineDraft[];
  onChangeLines: (lines: TaxLineDraft[]) => void;
  /** The pre-tax amount typed into the form, in cents (0 while blank). */
  subtotalCents: number;
  /** "British Columbia, Canada", or null when Settings → Region is unset. */
  regionLabel: string | null;
}

/**
 * The sales-tax block of the manual spending form: one row per tax the region
 * charges (Canada = GST + PST), each switchable between a RATE — picked on a
 * wheel, applied to the amount for you — and a dollar amount typed straight off
 * the receipt. The rows are summed into one total that is added on top of the
 * amount, and the running Subtotal / Total taxes / Total is shown so the figure
 * about to be recorded is never a surprise.
 *
 * Kept out of `BudgetItemFormScreen` (already the largest budget screen) but
 * deliberately stateless apart from which wheel is open — the form owns the
 * rows so they take part in its dirty tracking and its save payload.
 */
export function BudgetTaxSection({
  enabled,
  onToggle,
  lines,
  onChangeLines,
  subtotalCents,
  regionLabel,
}: BudgetTaxSectionProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  // Subscribes the section to Settings → Currency so every figure below
  // re-renders with the chosen symbol.
  useDisplayCurrency();
  const [openPickerKey, setOpenPickerKey] = useState<string | null>(null);

  const money = (cents: number) => formatMoney(cents, { decimals: 2 });
  // Labels the "type the amount" chip in whatever currency is being displayed.
  const symbol = moneySymbol();

  const updateLine = (key: string, patch: Partial<TaxLineDraft>) => {
    onChangeLines(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const setMode = (line: TaxLineDraft, mode: TaxLineDraft['mode']) => {
    if (line.mode === mode) return;
    if (mode === 'amount') {
      // Carry the rate's dollars over so switching to typing starts from the
      // figure already on screen rather than an empty box.
      const cents = taxLineCents(line, subtotalCents);
      updateLine(line.key, { mode, amount: cents > 0 ? (cents / 100).toFixed(2) : '' });
      return;
    }
    updateLine(line.key, { mode });
  };

  const totalCents = totalTaxCents(lines, subtotalCents);

  if (!enabled) {
    return (
      <View style={styles.section}>
        <TaxToggle enabled={false} onToggle={onToggle} colors={colors} accent={theme.pastel.teal} />
      </View>
    );
  }

  return (
    // One block inside the form's 16pt field rhythm — the rows belong to the
    // toggle above them, and spacing them like peer fields broke that reading.
    <View style={styles.section}>
      <TaxToggle enabled onToggle={onToggle} colors={colors} accent={theme.pastel.teal} />
      <Typography variant="caption2" color={colors.textSecondary}>
        {regionLabel
          ? `Rates for ${regionLabel}. Tax is added to the amount above.`
          : 'Set Settings → Region for the right default rates. Tax is added to the amount above.'}
      </Typography>

      {lines.map((line) => {
        const lineCents = taxLineCents(line, subtotalCents);
        return (
          <View key={line.key} style={styles.taxRow} testID={`budget-item-tax-row-${line.key}`}>
            <View style={styles.taxRowHeader}>
              <Typography variant="body" weight="semibold">
                {line.label}
              </Typography>
              <View style={styles.modeSwitch}>
                <TouchableOpacity
                  style={[
                    styles.modeChip,
                    {
                      borderColor: theme.pastel.teal,
                      backgroundColor: line.mode === 'percent' ? theme.pastel.teal : 'transparent',
                    },
                  ]}
                  onPress={() => setMode(line, 'percent')}
                  testID={`budget-item-tax-${line.key}-mode-percent`}
                >
                  <Typography
                    variant="caption1"
                    weight="semibold"
                    color={line.mode === 'percent' ? colors.white : theme.pastel.teal}
                  >
                    %
                  </Typography>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modeChip,
                    {
                      borderColor: theme.pastel.teal,
                      backgroundColor: line.mode === 'amount' ? theme.pastel.teal : 'transparent',
                    },
                  ]}
                  onPress={() => setMode(line, 'amount')}
                  testID={`budget-item-tax-${line.key}-mode-amount`}
                >
                  <Typography
                    variant="caption1"
                    weight="semibold"
                    color={line.mode === 'amount' ? colors.white : theme.pastel.teal}
                  >
                    {symbol}
                  </Typography>
                </TouchableOpacity>
              </View>
            </View>

            {line.mode === 'percent' ? (
              <View style={styles.taxRowBody}>
                <Pressable
                  style={[
                    styles.percentWell,
                    { borderColor: colors.borderColor, backgroundColor: colors.groupedListBackground },
                  ]}
                  onPress={() => setOpenPickerKey(line.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${line.label} rate, ${formatTaxPercent(line.percent)}`}
                  testID={`budget-item-tax-${line.key}-percent`}
                >
                  <Typography variant="body">{formatTaxPercent(line.percent)}</Typography>
                  <Icon name="chevron-down" size={14} color={colors.textSecondary} />
                </Pressable>
                <Typography
                  variant="body"
                  weight="semibold"
                  color={lineCents > 0 ? colors.textPrimary : colors.textTertiary}
                  testID={`budget-item-tax-${line.key}-computed`}
                >
                  {money(lineCents)}
                </Typography>
              </View>
            ) : (
              <TextInput
                placeholder="0.00"
                value={line.amount}
                onChangeText={(text) => updateLine(line.key, { amount: text })}
                keyboardType="decimal-pad"
                testID={`budget-item-tax-${line.key}-amount`}
              />
            )}

            <NumberWheelPickerSheet
              visible={openPickerKey === line.key}
              title={`${line.label} rate`}
              value={line.percent}
              min={TAX_PERCENT_MIN}
              max={TAX_PERCENT_MAX}
              step={TAX_PERCENT_STEP}
              unitLabel="%"
              splitDecimal
              onConfirm={(picked) => updateLine(line.key, { percent: picked })}
              onClose={() => setOpenPickerKey(null)}
              // The wheel's escape hatch is this row's other mode: a rate that
              // isn't on the wheel is one the receipt already prints in dollars.
              onManualEntry={() => {
                setOpenPickerKey(null);
                setMode(line, 'amount');
              }}
              manualEntryLabel="Enter the tax amount instead"
              testID={`budget-item-tax-${line.key}-picker`}
            />
          </View>
        );
      })}

      <View
        style={[styles.totals, { borderTopColor: colors.borderColor }]}
        testID="budget-item-tax-total"
      >
        <TotalRow label="Subtotal" value={money(subtotalCents)} colors={colors} />
        <TotalRow label="Total taxes" value={money(totalCents)} colors={colors} />
        <TotalRow label="Total" value={money(subtotalCents + totalCents)} colors={colors} emphasis />
      </View>
    </View>
  );
}

/** The checkbox row, rendered identically whether or not the section is open. */
function TaxToggle({
  enabled,
  onToggle,
  colors,
  accent,
}: {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  colors: ReturnType<typeof useAppColors>;
  accent: string;
}) {
  return (
    <TouchableOpacity
      style={styles.toggle}
      onPress={() => onToggle(!enabled)}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: enabled }}
      testID="budget-item-tax-toggle"
    >
      <View
        style={[
          styles.checkbox,
          { borderColor: enabled ? accent : colors.borderColor },
          enabled && { backgroundColor: accent },
        ]}
      >
        {enabled && <Icon name="checkmark" size={IconSize.sm} color={colors.white} />}
      </View>
      <Typography variant="body">Sales tax</Typography>
    </TouchableOpacity>
  );
}

function TotalRow({
  label,
  value,
  colors,
  emphasis,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useAppColors>;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.totalRow}>
      <Typography
        variant={emphasis ? 'body' : 'subheadline'}
        weight={emphasis ? 'semibold' : 'regular'}
        color={emphasis ? colors.textPrimary : colors.textSecondary}
      >
        {label}
      </Typography>
      <Typography variant={emphasis ? 'body' : 'subheadline'} weight="semibold">
        {value}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.md,
  },
  // Matches the "On sale / discount" toggle directly above it, to the pixel —
  // two checkboxes in one form that differ by a couple of points read as a bug.
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taxRow: {
    gap: Spacing.xs,
  },
  taxRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modeSwitch: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  modeChip: {
    minWidth: 40,
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    borderRadius: CornerRadius.full,
    borderWidth: 1,
  },
  taxRowBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  percentWell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
  },
  totals: {
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
