import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import type {
  PropertyStatTile,
  PropertyInsightCard,
} from '@features/utilities/api/utilities';
import { Spacing, CornerRadius, useAppColors } from '@theme';
import { formatMoney as formatAmount, moneySymbol } from '@utils/money';

/** Cents → "CA$1,234.56" in the user's display currency. */
export function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return formatAmount(cents, { decimals: 2 });
}

/** Cents → compact "$1.18M" / "$925K" / "$5,053" for chart axes & tiles. */
export function formatMoneyShort(cents: number | null | undefined): string {
  if (cents == null) return '—';
  const dollars = Math.round(cents / 100);
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? '-' : '';
  const symbol = moneySymbol();
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}${symbol}${m.toFixed(abs % 1_000_000 === 0 ? 0 : 2)}M`;
  }
  if (abs >= 10_000) return `${sign}${symbol}${Math.round(abs / 1000)}K`;
  return formatAmount(dollars * 100);
}

/** "2026-07-02" → "Jul 2, 2026". */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime())
    ? dateStr
    : parsed.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

function toneColor(
  tone: PropertyStatTile['tone'] | PropertyInsightCard['severity'],
  colors: ReturnType<typeof useAppColors>
): string {
  switch (tone) {
    case 'positive':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'info':
      return colors.accent;
    default:
      return colors.primary;
  }
}

/** A 2-up grid of pre-formatted stat tiles from the backend. */
export function StatGrid({ stats, testID }: { stats: PropertyStatTile[]; testID?: string }) {
  const colors = useAppColors();
  if (!stats.length) return null;

  return (
    <View style={styles.grid} testID={testID}>
      {stats.map((s) => {
        const accent = toneColor(s.tone, colors);
        return (
          <Card key={s.id} variant="filled" style={[styles.tile, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="caption1" color={colors.textSecondary}>
              {s.label}
            </Typography>
            <Typography variant="title3" weight="bold" color={accent} style={styles.tileValue}>
              {s.value}
            </Typography>
            {!!s.subtitle && (
              <Typography variant="caption2" color={colors.textTertiary}>
                {s.subtitle}
              </Typography>
            )}
          </Card>
        );
      })}
    </View>
  );
}

/** A single insight card (severity dot + title + body). */
export function InsightCard({
  insight,
  testID,
}: {
  insight: PropertyInsightCard;
  testID?: string;
}) {
  const colors = useAppColors();
  const accent = toneColor(insight.severity, colors);

  return (
    <Card
      variant="filled"
      style={[styles.insight, { backgroundColor: colors.backgroundSecondary, borderLeftColor: accent }]}
      testID={testID}
    >
      <Typography variant="subheadline" weight="semibold" color={colors.textPrimary}>
        {insight.title}
      </Typography>
      <Typography variant="footnote" color={colors.textSecondary} style={styles.insightBody}>
        {insight.body}
      </Typography>
    </Card>
  );
}

/** Card wrapper with a section title used across the property tabs. */
export function SectionCard({
  title,
  right,
  children,
  testID,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}) {
  const colors = useAppColors();

  return (
    <Card
      variant="filled"
      style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}
      testID={testID}
    >
      <View style={styles.sectionHeader}>
        <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
          {title}
        </Typography>
        {right}
      </View>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 140,
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    gap: Spacing.xxs,
  },
  tileValue: {
    marginVertical: Spacing.xxs,
  },
  insight: {
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    borderLeftWidth: 3,
    gap: Spacing.xxs,
  },
  insightBody: {
    lineHeight: 18,
  },
  section: {
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    gap: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
