/**
 * Name shortcut bubbles, shown directly under the Name field of a spending.
 *
 * Distinct from [[BudgetQuickAddRow]] above it: those chips prefill a whole new
 * spending (name, category, amount), while these only ever change the name, and
 * unlike quick-add they stay available while editing an existing spending —
 * which is exactly when someone notices they typed "Peanuts" again.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';

import { Typography } from '@components/ui';
import { useTheme } from '@contexts/ThemeContext';
import { useAppColors } from '@theme';

import type { NameSuggestion } from './budgetNameSuggestions';

interface Props {
  suggestions: NameSuggestion[];
  onSelect: (name: string) => void;
}

export function BudgetNameSuggestionRow({ suggestions, onSelect }: Props) {
  const { theme } = useTheme();
  const colors = useAppColors();

  if (suggestions.length === 0) return null;

  return (
    <View style={styles.root} testID="budget-name-suggestions">
      <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
        You usually call this
      </Typography>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        // The bubbles live under a focused field — without this a tap only
        // dismisses the keyboard and the name never changes.
        keyboardShouldPersistTaps="handled"
      >
        {suggestions.map((suggestion) => (
          <GHTouchableOpacity
            key={suggestion.name}
            style={[
              styles.bubble,
              { backgroundColor: colors.backgroundSecondary, borderColor: theme.pastel.teal },
            ]}
            onPress={() => onSelect(suggestion.name)}
            activeOpacity={0.85}
            testID={`budget-name-suggestion-${suggestion.name}`}
          >
            <Typography
              variant="caption1"
              weight="semibold"
              color={theme.pastel.teal}
              numberOfLines={1}
            >
              {suggestion.name}
            </Typography>
          </GHTouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 4,
    marginTop: -4,
  },
  hint: {
    marginLeft: 2,
  },
  row: {
    gap: 6,
    paddingHorizontal: 2,
  },
  bubble: {
    maxWidth: 180,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
});
