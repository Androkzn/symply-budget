import React from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { AppBarChart } from '@components/ui/AppBarChart';
import type { PropertyInsights } from '@features/utilities/api/utilities';
import { Spacing, CornerRadius, useAppColors } from '@theme';
import { useDisplayCurrency } from '@utils/money';

import {
  StatGrid,
  InsightCard,
  SectionCard,
  formatMoneyShort,
} from './PropertyInsightWidgets';

interface Props {
  insights: PropertyInsights | null;
  /** Jump to the tax / assessment tab from an empty-state prompt. */
  onGoToTax: () => void;
  onGoToAssessment: () => void;
}

export function PropertyOverviewTab({ insights, onGoToTax, onGoToAssessment }: Props) {
  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const chartWidth = Dimensions.get('window').width - Spacing.xl * 2 - Spacing.base * 2;

  if (!insights || !insights.hasData) {
    return (
      <Card
        variant="filled"
        style={[styles.empty, { backgroundColor: colors.backgroundSecondary }]}
        testID="property-overview-empty"
      >
        <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.emptyTitle}>
          Start tracking this property
        </Typography>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.emptyBody}>
          {/* Stays generic on purpose: this tab has no household, so it cannot
              name the right authority. The Assessment and Tax tabs do, and they
              name it there. */}
          Upload your assessment and property tax notices to unlock value trends, tax history and insights.
        </Typography>
        <View style={styles.emptyActions}>
          <TouchableOpacity
            style={[styles.emptyButton, { backgroundColor: colors.primary }]}
            onPress={onGoToAssessment}
            activeOpacity={0.85}
            testID="property-overview-add-assessment"
          >
            <Typography variant="footnote" weight="semibold" color={colors.white}>
              Add assessment
            </Typography>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.emptyButton, { backgroundColor: colors.primary }]}
            onPress={onGoToTax}
            activeOpacity={0.85}
            testID="property-overview-add-tax"
          >
            <Typography variant="footnote" weight="semibold" color={colors.white}>
              Add tax notice
            </Typography>
          </TouchableOpacity>
        </View>
      </Card>
    );
  }

  const assessmentSeries = insights.assessment.history.map((h) => ({
    value: h.assessedValue / 100,
    label: `'${String(h.year).slice(2)}`,
  }));
  const taxSeries = insights.propertyTax.history.map((h) => ({
    value: h.taxAmount / 100,
    label: `'${String(h.year).slice(2)}`,
  }));

  return (
    <View style={styles.container}>
      <StatGrid stats={insights.stats} testID="property-overview-stats" />

      {assessmentSeries.length >= 2 && (
        <SectionCard title="Assessed value trend" testID="property-overview-assessment-chart">
          <AppBarChart
            data={assessmentSeries}
            width={chartWidth}
            formatValue={(v) => formatMoneyShort(v * 100)}
          />
        </SectionCard>
      )}

      {taxSeries.length >= 2 && (
        <SectionCard title="Property tax trend" testID="property-overview-tax-chart">
          <AppBarChart data={taxSeries} width={chartWidth} />
        </SectionCard>
      )}

      {insights.insights.length > 0 && (
        <View style={styles.insights} testID="property-overview-insights">
          <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
            Insights
          </Typography>
          {insights.insights.map((i) => (
            <InsightCard key={i.id} insight={i} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.base },
  insights: { gap: Spacing.sm },
  empty: {
    padding: Spacing.lg,
    borderRadius: CornerRadius.md,
    gap: Spacing.md,
    alignItems: 'center',
  },
  emptyTitle: { textAlign: 'center' },
  emptyBody: { textAlign: 'center', lineHeight: 18 },
  emptyActions: { flexDirection: 'row', gap: Spacing.md },
  emptyButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.md,
  },
});
