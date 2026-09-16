import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

/**
 * A labelled 1–N rating row — the shared control behind every self-report scale
 * in the Health tabs (libido, energy, mood, stress, sleep, flow, severity).
 *
 * Rendered as discrete tappable segments rather than a continuous slider: a
 * slider is near-impossible to drive reliably from UI automation and hard to
 * hit accurately one-handed, and these values are ordinal anyway.
 */
interface HealthScaleRowProps {
  label: string;
  /** Current value, or null when the day has not been rated yet. */
  value: number | null;
  onChange: (next: number) => void;
  /** Highest selectable value (default 10). */
  max?: number;
  /** Brand icon-kit name shown beside the label. */
  icon?: string;
  /** Caption under the row (e.g. "High drive"). */
  hint?: string;
  /** Base testID; each segment gets `${testID}-<n>`. */
  testID: string;
}

export function HealthScaleRow({
  label,
  value,
  onChange,
  max = 10,
  icon,
  hint,
  testID,
}: HealthScaleRowProps) {
  const colors = useAppColors();
  const steps = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.head}>
        <View style={styles.labelGroup}>
          {icon ? <Icon name={icon} size={16} color={colors.textSecondary} /> : null}
          <Typography variant="footnote" color={colors.textSecondary}>
            {label}
          </Typography>
        </View>
        <Typography
          variant="footnote"
          weight="semibold"
          color={colors.textPrimary}
          testID={`${testID}-value`}
        >
          {value === null ? '—' : `${value}/${max}`}
        </Typography>
      </View>
      <View style={styles.track}>
        {steps.map((step) => {
          const active = value !== null && step <= value;
          return (
            <Pressable
              key={step}
              onPress={() => onChange(step)}
              accessibilityRole="adjustable"
              accessibilityLabel={`${label}: ${step} of ${max}`}
              accessibilityState={{ selected: value === step }}
              testID={`${testID}-${step}`}
              hitSlop={{ top: 8, bottom: 8 }}
              style={[
                styles.segment,
                { backgroundColor: active ? colors.primary : colors.borderColor },
              ]}
            />
          );
        })}
      </View>
      {hint ? (
        <Typography variant="caption1" color={colors.textSecondary}>
          {hint}
        </Typography>
      ) : null}
    </View>
  );
}

/**
 * A yes/no row — the other half of these logs. Kept beside the scale so both
 * report their state to assistive tech the same way.
 */
interface HealthToggleRowProps {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  icon?: string;
  testID: string;
}

export function HealthToggleRow({ label, value, onChange, icon, testID }: HealthToggleRowProps) {
  const colors = useAppColors();

  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, selected: value }}
      testID={testID}
      style={styles.toggleRow}
    >
      <View
        style={[
          styles.checkbox,
          {
            borderColor: value ? colors.primary : colors.borderColor,
            backgroundColor: value ? colors.primary : 'transparent',
          },
        ]}
      >
        {value ? <Icon name="checkmark" size={15} color={colors.white} /> : null}
      </View>
      {icon ? <Icon name={icon} size={16} color={colors.textSecondary} /> : null}
      <Typography variant="body" color={colors.textPrimary} style={styles.toggleLabel}>
        {label}
      </Typography>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.xs,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  track: {
    flexDirection: 'row',
    gap: 3,
  },
  segment: {
    flex: 1,
    height: 10,
    borderRadius: 5,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: CornerRadius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleLabel: {
    flex: 1,
  },
});
