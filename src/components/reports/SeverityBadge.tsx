import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { Typography } from '@components/ui';
import { CornerRadius, Spacing, REPORT_SEVERITY } from '@theme';

type Severity = 'critical' | 'major' | 'minor' | 'informational';

interface SeverityBadgeProps {
  severity: Severity;
  style?: ViewStyle;
}

const LABEL: Record<Severity, string> = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
  informational: 'Info',
};

export function SeverityBadge({ severity, style }: SeverityBadgeProps) {
  const cfg = REPORT_SEVERITY[severity];

  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }, style]}>
      <Typography variant="caption2" weight="semibold" color={cfg.text} style={styles.text}>
        {LABEL[severity]}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.xs,
    alignSelf: 'flex-start',
  },
  text: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
