import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import type { Household } from '@api/households';
import { Card, Typography } from '@components/ui';
import { CornerRadius, Spacing, useAppColors } from '@theme';

type HouseholdPickerProps = {
  label: string;
  households: Household[];
  selectedId: string | null;
  onSelect: (householdId: string) => void;
  testID?: string;
};

export function HouseholdPicker({
  label,
  households,
  selectedId,
  onSelect,
  testID = 'household-picker',
}: HouseholdPickerProps) {  const colors = useAppColors();

  if (households.length === 0) {
    return (
      <Card variant="filled" style={styles.emptyCard} testID={testID}>
        <Typography variant="body" weight="medium">
          {label}
        </Typography>
        <Typography variant="footnote" color={colors.textSecondary}>
          No households available. Create one first, then return here.
        </Typography>
      </Card>
    );
  }

  return (
    <View style={styles.wrap} testID={testID}>
      <Typography variant="body" weight="semibold" style={styles.label}>
        {label}
      </Typography>
      {households.map((household) => {
        const selected = household.id === selectedId;
        return (
          <TouchableOpacity
            key={household.id}
            onPress={() => onSelect(household.id)}
            activeOpacity={0.8}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            testID={`${testID}-option-${household.id}`}
          >
            <Card
              variant="filled"
              style={[
                styles.option,
                {
                  borderColor: selected ? colors.primary : colors.divider,
                  backgroundColor: selected ? colors.primary + '14' : colors.card,
                },
              ]}
            >
              <Typography variant="body" weight="medium">
                {household.name}
              </Typography>
              {household.city ? (
                <Typography variant="footnote" color={colors.textSecondary}>
                  {household.city}
                  {household.state_province ? `, ${household.state_province}` : ''}
                </Typography>
              ) : null}
            </Card>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.sm,
  },
  label: {
    marginBottom: Spacing.xxs,
  },
  option: {
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    gap: Spacing.xxs,
  },
  emptyCard: {
    padding: Spacing.md,
    gap: Spacing.xs,
  },
});
