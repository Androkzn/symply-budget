import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, IconSize, Spacing, hexToRgba, useAppColors } from '@theme';

/**
 * "Which home?" — the first question both House backup screens have to answer.
 *
 * H5 says a member can hold up to three properties on one device, each with its
 * own key epoch and membership, so the property is a choice the member makes
 * explicitly rather than something the screen infers. The alternative — quietly
 * archiving "whatever is active" — produces files that all look alike and a
 * restore that puts the cabin's rows into the house.
 *
 * The list can also offer "All homes": one file holding every property, each in
 * its own section. That is a pseudo-property as far as this component is
 * concerned — an id, a name and a subtitle like any other row — because
 * everything downstream (settings, phrase, file name, history) is keyed by
 * household id and needs no special case for it.
 */

export type HousePropertyOption = {
  householdId: string;
  name: string;
  isActive: boolean;
  awaitingEnrolment: boolean;
  /**
   * Overrides the derived "Open on this device" line. Used by the "All homes"
   * row, whose state has nothing to do with which property is open.
   */
  subtitle?: string;
};

type HousePropertyPickerProps = {
  /** `house-backup` or `house-restore` — rows become `<prefix>-property-<id>`. */
  testIDPrefix: string;
  title: string;
  hint: string;
  emptyMessage: string;
  properties: HousePropertyOption[];
  selectedId: string | null;
  onSelect: (householdId: string) => void;
  disabled?: boolean;
};

export function HousePropertyPicker({
  testIDPrefix,
  title,
  hint,
  emptyMessage,
  properties,
  selectedId,
  onSelect,
  disabled = false,
}: HousePropertyPickerProps) {
  const colors = useAppColors();

  return (
    <View testID={`${testIDPrefix}-property-picker`}>
      <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
        {title}
      </Typography>

      {properties.length === 0 ? (
        <Card style={styles.emptyCard} testID={`${testIDPrefix}-property-empty`}>
          <Typography variant="footnote" color={colors.textSecondary}>
            {emptyMessage}
          </Typography>
        </Card>
      ) : (
        <Card style={styles.group}>
          {properties.map((property, index) => {
            const selected = property.householdId === selectedId;
            const last = index === properties.length - 1;
            return (
              <Pressable
                key={property.householdId}
                onPress={() => onSelect(property.householdId)}
                disabled={disabled}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled }}
                accessibilityLabel={`${property.name}${property.isActive ? ', open now' : ''}`}
                testID={`${testIDPrefix}-property-${property.householdId}`}
                style={[
                  styles.row,
                  !last && {
                    borderBottomColor: colors.borderColor,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                  disabled && styles.rowDisabled,
                ]}
              >
                <View
                  style={[
                    styles.radio,
                    {
                      borderColor: selected ? colors.primary : colors.borderColor,
                      backgroundColor: selected ? hexToRgba(colors.primary, 0.14) : 'transparent',
                    },
                  ]}
                >
                  {selected ? (
                    <Icon
                      name="checkmark"
                      forceIonicons
                      size={IconSize.sm}
                      color={colors.primary}
                    />
                  ) : null}
                </View>
                <View style={styles.rowLabel}>
                  <Typography variant="body" accessible={false}>
                    {property.name || 'Untitled home'}
                  </Typography>
                  <Typography variant="caption2" color={colors.textSecondary} accessible={false}>
                    {property.subtitle ??
                      (property.awaitingEnrolment
                        ? 'Waiting to be let in — nothing to back up yet'
                        : property.isActive
                          ? 'Open on this device'
                          : 'Not open right now')}
                  </Typography>
                </View>
              </Pressable>
            );
          })}
        </Card>
      )}

      <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
        {hint}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  groupLabel: { marginBottom: Spacing.sm, letterSpacing: 0.6 },
  group: { padding: 0, overflow: 'hidden' },
  emptyCard: { padding: Spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    minHeight: 56,
  },
  rowDisabled: { opacity: 0.5 },
  rowLabel: { flex: 1, gap: 2 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: CornerRadius.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { marginTop: Spacing.sm },
});

export default HousePropertyPicker;
