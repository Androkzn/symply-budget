/**
 * The takeoff — what to buy, and what it costs.
 *
 * This panel is the reason the geometry is worth entering, and its whole job is
 * to be *checkable*. Every row shows the net area it came from beside the
 * quantity it produced, so a member can multiply it out on the back of an
 * envelope and see that the app agrees with them. A number that cannot be
 * traced back to a surface is a number nobody orders against.
 *
 * Three things are deliberately not hidden:
 *
 *  - **Area still undecided** is its own line. At the start of a project it is
 *    the whole room, and watching it fall is the actual progress bar for
 *    specifying a renovation.
 *  - **A material with no price says so**, rather than contributing zero to the
 *    total. Zero and unknown look identical in a sum and mean opposite things.
 *  - **A material whose quantity cannot be computed** carries the prompt that
 *    would fix it, right where the missing number would have been.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  computeTakeoff,
  describeQuantity,
  quantityGap,
} from '@features/house/surfaces';
import {
  formatSurfaceArea,
  type LengthUnit,
} from '@features/house/surfaces/units';
import type { RoomSurfaceModel } from '@symply/contracts';
import { useAppColors } from '@theme';

export interface TakeoffPanelProps {
  model: RoomSurfaceModel;
  lengthUnit?: LengthUnit;
  currency?: string;
  /**
   * Puts every line into the project's materials and its budget.
   *
   * The button says "budget" rather than "materials" because the budget is what
   * changes for a member who has already attached the finishes from their own
   * materials list — nothing is added in that case, and a button promising to
   * add things would look like it had done nothing. See `surfaceBudget.ts`.
   */
  onSendToBudget?: () => void;
  sending?: boolean;
  testID?: string;
}

export function TakeoffPanel({
  model,
  lengthUnit = 'm',
  currency = 'USD',
  onSendToBudget,
  sending = false,
  testID,
}: TakeoffPanelProps) {
  const colors = useAppColors();
  const takeoff = useMemo(() => computeTakeoff(model), [model]);
  const materialsById = useMemo(
    () => new Map(model.materials.map(material => [material.id, material])),
    [model.materials],
  );

  const specifiedPct =
    takeoff.totalNetM2 > 0
      ? Math.round(
          ((takeoff.totalNetM2 - takeoff.unassignedM2) / takeoff.totalNetM2) *
            100,
        )
      : 0;

  return (
    <View style={styles.wrap} testID={testID}>
      <View
        style={[
          styles.summary,
          { backgroundColor: colors.card, borderColor: colors.borderColor },
        ]}
      >
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            Finished area
          </Text>
          <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>
            {formatSurfaceArea(takeoff.totalNetM2, lengthUnit)}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            Specified
          </Text>
          <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>
            {specifiedPct}%
          </Text>
        </View>
        {takeoff.unassignedM2 > 0 ? (
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.warning }]}>
              Still to decide
            </Text>
            <Text style={[styles.summaryValue, { color: colors.warning }]}>
              {formatSurfaceArea(takeoff.unassignedM2, lengthUnit)}
            </Text>
          </View>
        ) : null}
        <View
          style={[
            styles.summaryRow,
            styles.totalRow,
            { borderTopColor: colors.borderColor },
          ]}
        >
          <Text
            style={[
              styles.summaryLabel,
              { color: colors.textPrimary, fontWeight: '700' },
            ]}
          >
            Materials estimate
          </Text>
          <Text
            style={[
              styles.summaryValue,
              { color: colors.textPrimary, fontWeight: '700' },
            ]}
          >
            {takeoff.totalEstimateCents === null
              ? 'No prices yet'
              : formatMoney(takeoff.totalEstimateCents, currency)}
          </Text>
        </View>
      </View>

      {takeoff.lines.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          Assign a material to a surface and its quantities appear here.
        </Text>
      ) : (
        takeoff.lines.map(line => {
          const material = materialsById.get(line.materialId);
          const gap = material ? quantityGap(material) : null;
          return (
            <View
              key={line.materialId}
              style={[
                styles.line,
                {
                  borderColor: colors.borderColor,
                  backgroundColor: colors.card,
                },
              ]}
              testID={`takeoff-line-${line.materialId}`}
            >
              <View style={[styles.dot, { backgroundColor: line.colorHex }]} />
              <View style={styles.lineBody}>
                <Text
                  style={[styles.lineTitle, { color: colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {line.name}
                </Text>
                <Text
                  style={[styles.lineMeta, { color: colors.textSecondary }]}
                  numberOfLines={2}
                >
                  {formatSurfaceArea(line.netM2, lengthUnit)} net
                  {line.withWasteM2 > line.netM2
                    ? ` · ${formatSurfaceArea(
                        line.withWasteM2,
                        lengthUnit,
                      )} with waste`
                    : ''}
                </Text>
                <Text
                  style={[styles.lineMeta, { color: colors.textSecondary }]}
                  numberOfLines={2}
                >
                  {line.surfaceLabels.join(', ')}
                </Text>
                {gap ? (
                  <Text style={[styles.lineGap, { color: colors.warning }]}>
                    {gap}
                  </Text>
                ) : null}
              </View>
              <View style={styles.lineRight}>
                <Text style={[styles.lineQty, { color: colors.textPrimary }]}>
                  {describeQuantity(line)}
                </Text>
                <Text
                  style={[styles.linePrice, { color: colors.textSecondary }]}
                >
                  {line.estimateCents === null
                    ? 'no price'
                    : formatMoney(line.estimateCents, currency)}
                </Text>
              </View>
            </View>
          );
        })
      )}

      {onSendToBudget && takeoff.lines.length > 0 ? (
        <Pressable
          style={[
            styles.cta,
            { backgroundColor: colors.primary, opacity: sending ? 0.6 : 1 },
          ]}
          onPress={onSendToBudget}
          disabled={sending}
          testID="takeoff-send-to-budget"
        >
          <Text style={styles.ctaText}>
            {sending ? 'Adding…' : 'Put these quantities in the budget'}
          </Text>
        </Pressable>
      ) : null}

      <Text style={[styles.disclaimer, { color: colors.textSecondary }]}>
        Quantities come from the measurements you entered, plus each material’s
        waste allowance. Check them against a supplier’s own calculator before
        ordering.
      </Text>
    </View>
  );
}

function formatMoney(cents: number, currency: string): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // An unknown currency code should not take the panel down — `Intl` throws
    // on one, and the figure still means something without the symbol.
    return `${Math.round(amount).toLocaleString()} ${currency}`;
  }
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  summary: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: { fontSize: 13 },
  summaryValue: { fontSize: 14, fontWeight: '600' },
  totalRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    marginTop: 2,
  },
  empty: { fontSize: 13, lineHeight: 18, paddingVertical: 12 },
  line: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  lineBody: { flex: 1 },
  lineTitle: { fontSize: 15, fontWeight: '700' },
  lineMeta: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  lineGap: { fontSize: 12, marginTop: 4, lineHeight: 16 },
  lineRight: { alignItems: 'flex-end', minWidth: 92 },
  lineQty: { fontSize: 14, fontWeight: '700' },
  linePrice: { fontSize: 12, marginTop: 3 },
  cta: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disclaimer: { fontSize: 11, lineHeight: 16, marginTop: 4 },
});
