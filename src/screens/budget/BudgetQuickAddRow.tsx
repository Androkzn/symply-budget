import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';

import type { BudgetQuickAddSuggestion } from '@api/budget';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useTheme } from '@contexts/ThemeContext';
import { useAppColors } from '@theme';

import { formatQuickAddAmount } from './budgetQuickAddHelpers';

interface Props {
  kind: 'planned' | 'spent';
  /**
   * One flat, title-deduped strip. The API still answers with separate
   * Recent and Popular lists; the form folds them with
   * `mergeQuickAddSuggestions` before they get here — the strip itself has no
   * tabs any more.
   */
  suggestions: BudgetQuickAddSuggestion[];
  busyTitle: string | null;
  onSelect: (suggestion: BudgetQuickAddSuggestion) => void;
}

function QuickAddChip({
  suggestion,
  kind,
  disabled,
  onPress,
  testID,
}: {
  suggestion: BudgetQuickAddSuggestion;
  kind: 'planned' | 'spent';
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const amountLabel = formatQuickAddAmount(suggestion, kind);

  return (
    <GHTouchableOpacity
      style={[
        styles.chip,
        {
          backgroundColor: colors.backgroundSecondary,
          borderColor: colors.borderColor,
          opacity: disabled ? 0.6 : 1,
        },
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      testID={testID}
    >
      {disabled ? (
        <ActivityIndicator size="small" color={theme.pastel.teal} />
      ) : (
        <>
          <Typography variant="caption1" weight="semibold" numberOfLines={1}>
            {suggestion.title}
          </Typography>
          {amountLabel ? (
            <Typography variant="caption2" color={colors.textSecondary}>
              {amountLabel}
            </Typography>
          ) : null}
        </>
      )}
    </GHTouchableOpacity>
  );
}

export function BudgetQuickAddRow({ kind, suggestions, busyTitle, onSelect }: Props) {
  const colors = useAppColors();

  if (suggestions.length === 0) return null;

  return (
    <View style={styles.root} testID="budget-quick-add-row">
      {/* Heading disambiguates this row from the month's spending breakdown: the
          chips are household-wide tap-to-add shortcuts, NOT a per-month
          category summary, so their amounts stay constant across months. */}
      <Typography
        variant="footnote"
        weight="semibold"
        color={colors.textSecondary}
        style={styles.heading}
        testID="budget-quick-add-heading"
      >
        QUICK ADD
      </Typography>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        testID="budget-quick-add-section"
      >
        {suggestions.map((suggestion) => (
          <QuickAddChip
            key={suggestion.title}
            suggestion={suggestion}
            kind={kind}
            disabled={busyTitle === suggestion.title}
            onPress={() => onSelect(suggestion)}
            // `-chip-` keeps the title-derived ids out of the row/heading/section
            // namespace so Maestro can pick "any chip" with one regex.
            testID={`budget-quick-add-chip-${suggestion.title}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 6,
    marginTop: -4,
    marginBottom: 8,
  },
  heading: {
    marginLeft: 2,
    letterSpacing: 0.5,
  },
  chipRow: {
    gap: 6,
    paddingHorizontal: 2,
  },
  chip: {
    minWidth: 72,
    maxWidth: 140,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    gap: 1,
  },
});
