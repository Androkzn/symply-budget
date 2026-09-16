import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Concrete path, not the @components/common barrel: that barrel re-exports
// screens' headers which import from @components/ui, so reaching SheetHeader
// through it closes a ui <-> common circular require and the component
// arrives undefined at render (see the same note in ui/BottomSheet).
import { SheetHeader } from '@components/common/SheetHeader';
import { GradientButton, TextInput, Toggle, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { formatBudgetCurrency as formatCurrency } from '../budgetFormat';

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** One tappable "start from this figure" shortcut in the editor. */
export interface TargetSuggestion {
  label: string;
  cents: number;
}

/**
 * Parse the dollars field into cents. Accepts "1,200", "1200.50", "$1200" and a
 * leading minus (a planned deficit month is a legitimate target). Returns null
 * for anything that isn't a number, so an empty/garbage field never silently
 * writes a 0 target.
 */
export function parseTargetDollars(input: string): number | null {
  const cleaned = input.replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Cents → the plain editable dollars string the field starts from ("1200.5"). */
export function targetCentsToInput(cents: number | null): string {
  if (cents == null) return '';
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

/**
 * Flip the field between a surplus and a planned deficit.
 *
 * The field runs on `decimal-pad`, which has no minus key on iOS — and the
 * letters-capable `numbers-and-punctuation` keypad that used to buy one is
 * exactly what let a member type "abc" into a currency field. So the sign gets
 * its own control and the keypad stays numeric.
 *
 * Operates on the raw string (rather than a separate sign flag) so
 * `parseTargetDollars` / `targetCentsToInput` keep their existing contract.
 */
export function toggleTargetSign(input: string): string {
  return input.startsWith('-') ? input.slice(1) : `-${input}`;
}

interface ProjectionTargetModalProps {
  visible: boolean;
  year: number;
  /** Month being edited (1–12). */
  month: number;
  /** Existing target on that month, or null when none is set. */
  initialTarget: number | null;
  /** How many months (incl. this one) "apply to all remaining" would write. */
  remainingCount: number;
  /** Shortcut figures (current pace, best month, monthly goal) — already filtered. */
  suggestions: TargetSuggestion[];
  /** Opens with "apply to all remaining months" already on (the plan-the-year entry point). */
  initialApplyToAll?: boolean;
  saving?: boolean;
  onClose: () => void;
  /** `null` cents clears the target. `applyToAll` writes every remaining month. */
  onSubmit: (targetCents: number | null, applyToAll: boolean) => void;
}

/**
 * "What do you want to save in {month}?" — the single editor behind BOTH
 * Projection write paths: one month, or (with the toggle on) every remaining
 * month of the year. Keeping them in one sheet means the household sets a
 * whole-year plan in one gesture without a second screen.
 */
export function ProjectionTargetModal({
  visible,
  year,
  month,
  initialTarget,
  remainingCount,
  suggestions,
  initialApplyToAll = false,
  saving = false,
  onClose,
  onSubmit,
}: ProjectionTargetModalProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // The sheet is anchored to the bottom edge, so an open keypad lands on top of
  // the very field that summoned it — the member could not see what they were
  // typing. Lift the sheet by the inset, and cap its height against what is LEFT
  // above the keyboard so a short phone doesn't push it off the top instead.
  const keyboardInset = useKeyboardInset();
  const [amount, setAmount] = useState(() => targetCentsToInput(initialTarget));
  const [applyToAll, setApplyToAll] = useState(initialApplyToAll);

  // Re-seed each time the sheet opens (or the anchor month changes) so it never
  // shows the previous month's figure.
  useEffect(() => {
    if (!visible) return;
    setAmount(targetCentsToInput(initialTarget));
    setApplyToAll(initialApplyToAll);
  }, [visible, month, initialTarget, initialApplyToAll]);

  const parsed = useMemo(() => parseTargetDollars(amount), [amount]);
  const canSave = parsed != null && !saving;
  const monthName = MONTHS_LONG[month - 1] ?? `Month ${month}`;
  const bulkCount = Math.max(1, remainingCount);
  const isNegative = amount.startsWith('-');
  const contentMaxHeight = windowHeight - keyboardInset - insets.top - Spacing.xxl;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, { paddingBottom: keyboardInset }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.backgroundMain,
              maxHeight: contentMaxHeight,
              // The home indicator sits under the sheet only while the keyboard
              // is down; once it is up the keypad owns that strip.
              paddingBottom: Spacing.base + (keyboardInset > 0 ? 0 : insets.bottom),
            },
          ]}
        >
          {/* The app's one sheet header — glass ✕ on the left, centred title —
              instead of the teal "Cancel" plus a hand-measured spacer this sheet
              used to balance the title with. */}
          <SheetHeader
            title={`${monthName} ${year}`}
            leftVariant="close"
            onLeftPress={onClose}
            leftTestID="projection-target-cancel"
            leftAccessibilityLabel="Cancel"
            style={styles.header}
          />

          {/* Everything between the header and the pinned CTA scrolls, so a short
              phone with the keypad up can still reach the suggestion chips.

              No `automaticallyAdjustKeyboardInsets` here, and that is deliberate:
              the sheet is ALREADY lifted clear of the keypad by `keyboardInset`
              above. Letting the scroller offset by the keyboard height as well
              counts it twice — verified on a device, it drove the caption and the
              "Savings goal ($)" label off the top of the card and left the member
              typing into an unlabelled box. */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Typography variant="caption1" color={colors.textSecondary}>
              How much do you want to keep this month? It feeds your projected year-end total — you
              can change it any time.
            </Typography>

            <TextInput
              label="Savings goal ($)"
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              keyboardType="decimal-pad"
              testID="projection-target-amount"
              rightIcon={
                <TouchableOpacity
                  onPress={() => setAmount(toggleTargetSign)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isNegative ? 'Switch to a saving goal' : 'Switch to a planned shortfall'
                  }
                  accessibilityState={{ selected: isNegative }}
                  testID="projection-target-sign"
                >
                  <Typography
                    variant="body"
                    weight="semibold"
                    color={isNegative ? colors.error : colors.textTertiary}
                  >
                    ±
                  </Typography>
                </TouchableOpacity>
              }
            />

            {suggestions.length > 0 && (
              <View style={styles.chipRow}>
                {suggestions.map((s) => (
                  <TouchableOpacity
                    key={s.label}
                    onPress={() => setAmount(targetCentsToInput(s.cents))}
                    activeOpacity={0.8}
                    testID={`projection-target-suggestion-${s.label}`}
                    style={[
                      styles.chip,
                      { borderColor: colors.borderColor, backgroundColor: colors.card },
                    ]}
                  >
                    <Typography variant="caption2" color={colors.textSecondary}>
                      {s.label}
                    </Typography>
                    <Typography variant="subheadline" weight="semibold" color={theme.pastel.teal}>
                      {formatCurrency(s.cents)}
                    </Typography>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {remainingCount > 1 && (
              <TouchableOpacity
                style={[styles.bulkRow, { borderColor: colors.borderColor }]}
                activeOpacity={0.8}
                onPress={() => setApplyToAll((v) => !v)}
                testID="projection-target-apply-all-row"
              >
                <View style={styles.bulkText}>
                  <Typography variant="body" weight="medium">
                    Apply to all {bulkCount} remaining months
                  </Typography>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    Sets the same goal for {monthName}–December {year}.
                  </Typography>
                </View>
                <Toggle
                  value={applyToAll}
                  onValueChange={setApplyToAll}
                  testID="projection-target-apply-all"
                />
              </TouchableOpacity>
            )}
          </ScrollView>

          <GradientButton
            title={
              saving
                ? 'Saving…'
                : applyToAll
                  ? `Set goal for ${bulkCount} months`
                  : `Set ${monthName} goal`
            }
            variant="blue"
            onPress={() => canSave && onSubmit(parsed, applyToAll)}
            disabled={!canSave}
            fullWidth
            testID="projection-target-save"
          />

          {initialTarget != null && (
            <TouchableOpacity
              onPress={() => !saving && onSubmit(null, applyToAll)}
              style={styles.clearBtn}
              testID="projection-target-clear"
            >
              <Icon name="trash-outline" size={16} color={colors.error} />
              <Typography variant="body" color={colors.error}>
                {applyToAll ? 'Clear all remaining goals' : 'Clear this goal'}
              </Typography>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: CornerRadius.xl,
    borderTopRightRadius: CornerRadius.xl,
    padding: Spacing.base,
    gap: Spacing.md,
  },
  // The sheet already pads its own edges, so the header drops the horizontal
  // padding it carries by default rather than indenting the ✕ twice.
  header: { paddingHorizontal: 0 },
  // `flexShrink` is what lets the scroller give up height to the keyboard: the
  // sheet's `maxHeight` bounds the column, and without this the ScrollView would
  // hold its content height and push the CTA below the screen instead.
  scroll: { flexShrink: 1 },
  scrollContent: { gap: Spacing.md, paddingBottom: Spacing.xs },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    flexGrow: 1,
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
  },
  bulkText: { flex: 1, gap: Spacing.xxs },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
});
