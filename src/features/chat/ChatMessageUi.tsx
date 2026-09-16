/**
 * Renders rich UI blocks the AI assistant attaches to a chat reply — charts,
 * stat cards, tables, insights, and simple flow diagrams — from `metadata.ui`.
 *
 * App-agnostic: brand colors come from {@link useAppColors} so Budget/House/etc.
 * each paint with their own tokens. Never trusts hex from the payload.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { LineChart, PieChart } from 'react-native-gifted-charts';

import { AppBarChart, formatChartCurrencyShort } from '@components/ui/AppBarChart';
import { Typography } from '@components/ui/Typography';
import { useAppColors } from '@theme';
import { chatSliceColor } from '@theme/chartPalette';
import { Chart, Spacing, CornerRadius } from '@theme/designTokens';
import { formatMoneyUnits, useDisplayCurrency } from '@utils/money';

import type {
  ChatChartSpec,
  ChatDiagramSpec,
  ChatInsightSpec,
  ChatStatSpec,
  ChatTableSpec,
  ChatUiBlock,
} from './types';

const MIN_CHART_WIDTH = 200;

function formatValue(value: number, format: ChatChartSpec['valueFormat']): string {
  if (format === 'percent') return `${Math.round(value)}%`;
  if (format === 'number') return `${value}`;
  return formatMoneyUnits(value, { decimals: 2 });
}

function toneColor(
  tone: ChatStatSpec['tone'] | ChatInsightSpec['tone'],
  colors: ReturnType<typeof useAppColors>
): string {
  switch (tone) {
    case 'positive':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'negative':
      return colors.error;
    default:
      return colors.textPrimary;
  }
}

function ChartBlock({ chart }: { chart: ChatChartSpec }) {
  const colors = useAppColors();
  const [width, setWidth] = useState(0);
  const chartWidth = Math.max(MIN_CHART_WIDTH, width);

  const format = (v: number) =>
    chart.valueFormat === 'currency' || chart.valueFormat === undefined
      ? formatChartCurrencyShort(v)
      : formatValue(v, chart.valueFormat);

  return (
    <View
      style={styles.chartWrap}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      testID="chat-ui-chart"
    >
      {!!chart.title && (
        <Typography variant="footnote" weight="semibold" color={colors.textPrimary} style={styles.blockTitle}>
          {chart.title}
        </Typography>
      )}
      {/* Pie/donut use a fixed radius and a text legend — no measured width
          needed, so they render immediately (no layout flash). Bar and line
          need the measured container width, so they wait for onLayout. */}
      {chart.type === 'pie' || chart.type === 'donut' ? (
        <View style={styles.pieRow}>
          <PieChart
            data={chart.data.map((d, i) => ({
              value: Math.max(0, d.value),
              color: chatSliceColor(colors, i),
            }))}
            donut={chart.type === 'donut'}
            radius={64}
            innerRadius={chart.type === 'donut' ? 40 : 0}
            innerCircleColor={colors.backgroundSecondary}
          />
          <View style={styles.legend}>
            {chart.data.map((d, i) => (
              <View key={`${d.label}-${i}`} style={styles.legendRow}>
                <View
                  style={[styles.legendDot, { backgroundColor: chatSliceColor(colors, i) }]}
                />
                <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1} style={styles.legendLabel}>
                  {d.label}
                </Typography>
                <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
                  {formatValue(d.value, chart.valueFormat)}
                </Typography>
              </View>
            ))}
          </View>
        </View>
      ) : width > 0 && chart.type === 'bar' ? (
        <AppBarChart
          data={chart.data.map((d, i) => ({
            value: d.value,
            label: d.label,
            frontColor: chatSliceColor(colors, i),
          }))}
          width={chartWidth}
          formatValue={format}
        />
      ) : width > 0 ? (
        <LineChart
          data={chart.data.map((d) => ({
            value: d.value,
            label: d.label,
            dataPointText: format(d.value),
          }))}
          width={chartWidth - 24}
          height={Chart.height}
          color={colors.primary}
          thickness={2}
          dataPointsColor={colors.primary}
          startFillColor={colors.primary}
          endFillColor={colors.primary}
          startOpacity={0.2}
          endOpacity={0.02}
          areaChart
          yAxisColor={colors.chartNeutral}
          xAxisColor={colors.chartNeutral}
          yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
          xAxisLabelTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
          noOfSections={4}
          rulesColor={colors.borderColor}
          formatYLabel={(v) => format(Number(v))}
        />
      ) : null}
    </View>
  );
}

function StatsBlock({ stats }: { stats: ChatStatSpec[] }) {
  const colors = useAppColors();
  return (
    <View style={styles.statsRow} testID="chat-ui-stats">
      {stats.map((s, i) => (
        <View
          key={`${s.label}-${i}`}
          style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.borderColor }]}
        >
          <Typography variant="caption2" color={colors.textSecondary} numberOfLines={1}>
            {s.label}
          </Typography>
          <Typography variant="headline" weight="bold" color={toneColor(s.tone, colors)} numberOfLines={1}>
            {s.value}
          </Typography>
          {!!s.caption && (
            <Typography variant="caption2" color={colors.textSecondary} numberOfLines={2}>
              {s.caption}
            </Typography>
          )}
        </View>
      ))}
    </View>
  );
}

function TableBlock({ table }: { table: ChatTableSpec }) {
  const colors = useAppColors();
  const cols = table.columns.slice(0, 6);
  const rows = table.rows.slice(0, 20).map((r) => r.slice(0, cols.length));
  return (
    <View
      style={[styles.tableWrap, { borderColor: colors.borderColor, backgroundColor: colors.card }]}
      testID="chat-ui-table"
    >
      {!!table.title && (
        <Typography variant="footnote" weight="semibold" color={colors.textPrimary} style={styles.blockTitle}>
          {table.title}
        </Typography>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[styles.tableRow, styles.tableHeader, { borderBottomColor: colors.borderColor }]}>
            {cols.map((c, i) => (
              <Typography
                key={`h-${i}`}
                variant="caption2"
                weight="semibold"
                color={colors.textSecondary}
                style={styles.tableCell}
                numberOfLines={2}
              >
                {c}
              </Typography>
            ))}
          </View>
          {rows.map((row, ri) => (
            <View
              key={`r-${ri}`}
              style={[styles.tableRow, { borderBottomColor: colors.borderColor }]}
            >
              {cols.map((_, ci) => (
                <Typography
                  key={`c-${ri}-${ci}`}
                  variant="caption1"
                  color={ci === 0 ? colors.textPrimary : colors.textSecondary}
                  weight={ci === 0 ? 'semibold' : 'regular'}
                  style={styles.tableCell}
                  numberOfLines={2}
                >
                  {row[ci] ?? ''}
                </Typography>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function InsightBlock({ insight }: { insight: ChatInsightSpec }) {
  const colors = useAppColors();
  const accent = toneColor(insight.tone, colors);
  return (
    <View
      style={[
        styles.insightCard,
        { backgroundColor: colors.card, borderColor: colors.borderColor, borderLeftColor: accent },
      ]}
      testID="chat-ui-insight"
    >
      <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
        {insight.title}
      </Typography>
      <Typography variant="caption1" color={colors.textSecondary} style={styles.insightBody}>
        {insight.body}
      </Typography>
      {(insight.bullets ?? []).slice(0, 6).map((b, i) => (
        <Typography key={i} variant="caption1" color={colors.textPrimary}>
          • {b}
        </Typography>
      ))}
    </View>
  );
}

function DiagramBlock({ diagram }: { diagram: ChatDiagramSpec }) {
  const colors = useAppColors();
  const nodeById = new Map(diagram.nodes.map((n) => [n.id, n]));
  return (
    <View
      style={[styles.diagramWrap, { backgroundColor: colors.card, borderColor: colors.borderColor }]}
      testID="chat-ui-diagram"
    >
      {!!diagram.title && (
        <Typography variant="footnote" weight="semibold" color={colors.textPrimary} style={styles.blockTitle}>
          {diagram.title}
        </Typography>
      )}
      <View style={styles.diagramNodes}>
        {diagram.nodes.slice(0, 12).map((n) => (
          <View
            key={n.id}
            style={[styles.diagramNode, { backgroundColor: colors.backgroundSecondary, borderColor: colors.primary }]}
          >
            <Typography variant="caption1" weight="semibold" color={colors.textPrimary} numberOfLines={2}>
              {n.label}
            </Typography>
            {!!n.value && (
              <Typography variant="caption2" color={colors.primary}>
                {n.value}
              </Typography>
            )}
          </View>
        ))}
      </View>
      {diagram.edges.slice(0, 16).map((e, i) => {
        const from = nodeById.get(e.from)?.label ?? e.from;
        const to = nodeById.get(e.to)?.label ?? e.to;
        return (
          <Typography key={i} variant="caption2" color={colors.textSecondary} style={styles.edgeLine}>
            {from} → {to}
            {e.label ? ` (${e.label})` : ''}
          </Typography>
        );
      })}
    </View>
  );
}

export function ChatMessageUi({ blocks }: { blocks: ChatUiBlock[] }) {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  if (blocks.length === 0) return null;
  return (
    <View style={styles.container}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'chart':
            return <ChartBlock key={i} chart={block.chart} />;
          case 'stats':
            return <StatsBlock key={i} stats={block.stats} />;
          case 'table':
            return <TableBlock key={i} table={block.table} />;
          case 'insight':
            return <InsightBlock key={i} insight={block.insight} />;
          case 'diagram':
            return <DiagramBlock key={i} diagram={block.diagram} />;
          default:
            return null;
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  blockTitle: {
    marginBottom: Spacing.xs,
  },
  chartWrap: {
    width: '100%',
  },
  pieRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  legend: {
    flex: 1,
    gap: Spacing.xxs,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    padding: Spacing.sm,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  tableWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.md,
    padding: Spacing.sm,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.xs,
  },
  tableHeader: {
    paddingBottom: Spacing.xs,
  },
  tableCell: {
    width: 96,
    marginRight: Spacing.sm,
  },
  insightCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    borderRadius: CornerRadius.md,
    padding: Spacing.sm,
    gap: Spacing.xxs,
  },
  insightBody: {
    marginBottom: Spacing.xxs,
  },
  diagramWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.md,
    padding: Spacing.sm,
    gap: Spacing.xs,
  },
  diagramNodes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  diagramNode: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    maxWidth: '48%',
  },
  edgeLine: {
    marginLeft: Spacing.xs,
  },
});
