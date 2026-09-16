/**
 * Which units the member is typing and reading in.
 *
 * A display choice, never a stored one: the document is metres and stays metres
 * (see `units.ts`), so switching this re-renders the same room in different
 * words and changes nothing that syncs. Two members of one household can hold
 * different pickers and still be looking at the same wall.
 *
 * It defaults from `households.unit_system` and is offered anyway, because that
 * setting is a binary and this screen needs four answers: someone measuring a
 * splashback works in centimetres even though their house is in metres, and a
 * niche gets quoted in inches even in a house measured in feet. Making them
 * convert in their head is how a wrong number gets typed into a field that
 * later becomes a tile order.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LENGTH_UNIT_OPTIONS, type LengthUnit } from '@features/house/surfaces';
import { useAppColors } from '@theme';

export interface UnitPickerProps {
  value: LengthUnit;
  onChange: (unit: LengthUnit) => void;
  label?: string;
  testID?: string;
}

export function UnitPicker({
  value,
  onChange,
  label = 'Units',
  testID,
}: UnitPickerProps) {
  const colors = useAppColors();

  return (
    <View style={styles.wrap} testID={testID}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <View
        style={[
          styles.track,
          { borderColor: colors.borderColor, backgroundColor: colors.card },
        ]}
        accessibilityRole="radiogroup"
      >
        {LENGTH_UNIT_OPTIONS.map(option => {
          const selected = option.unit === value;
          return (
            <Pressable
              key={option.unit}
              onPress={() => onChange(option.unit)}
              style={[
                styles.segment,
                selected && { backgroundColor: colors.primary },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.accessibilityLabel}
              testID={`unit-${option.unit}`}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: selected ? '#fff' : colors.textPrimary },
                ]}
                numberOfLines={1}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 12, fontWeight: '600' },
  track: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
    alignSelf: 'flex-start',
  },
  segment: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 54,
    alignItems: 'center',
  },
  segmentText: { fontWeight: '700', fontSize: 13 },
});
