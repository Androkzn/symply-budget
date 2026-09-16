import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  bodyRatios,
  bodySideDifferences,
  formatMeasurement,
  summarizeBodyComposition,
  type BodyEntry,
} from '../healthBodyStorage';
import type { WeightUnit } from '../healthLocalStorage';
import { formatAxisDate } from '../healthTrends';
import { ACTIVITY_LABELS } from '../healthWeightAnalytics';
import { weightInUnit, type HealthActivityLevel, type HealthGender } from '../healthWeightStorage';

import { HealthStatTiles } from './HealthStatTiles';

/**
 * Body tab — the donor's `bodyInsightsCard` + `bodyCompositionCard`, rebuilt.
 *
 * Three cards, all read-only, all derived from figures the app already holds:
 *
 *   · RATIOS — the donor's four `BodyMeasurement` ratio fields, computed rather
 *     than stored (see the 0131 migration header for why a stored ratio is a
 *     copy that goes stale);
 *   · BODY COMPOSITION — BMI, BMR, TDEE, fat mass and lean mass, from the 0125
 *     biometrics `healthWeightStorage` already reads plus this tab's own
 *     body-fat percentage. The maths is imported from `healthWeightAnalytics`,
 *     never re-implemented: the Weight tab shows the same numbers and two
 *     copies of Mifflin–St Jeor is how two tabs come to disagree;
 *   · LEFT AND RIGHT — the donor's symmetry scores as a plain difference.
 *
 * NOTHING HERE GRADES. The donor colours its waist-to-hip ratio green or orange
 * against a threshold and labels it "Healthy range" / "Above average", and its
 * symmetry rows score `min ÷ max` as a percentage. A body measurement rendered
 * as a verdict is a clinical judgement this app does not make — so the numbers
 * are stated, the direction of travel is stated, and the reader draws the
 * conclusion. The one exception is the direction arrow on a CHANGE, which
 * reports which way a figure moved and says nothing about whether that is good.
 */

export interface HealthBodyDashboardProps {
  entries: BodyEntry[];
  /** Latest weight in canonical kilograms; null when nothing is logged. */
  weightKg: number | null;
  /** 0125 biometrics, read from the weight goal — never re-collected here. */
  heightCm: number | null;
  gender: HealthGender | null;
  birthYear: number | null;
  activityLevel: HealthActivityLevel | null;
  /** Display unit for lean/fat mass — the SAME global switch the Weight tab uses. */
  weightUnit?: WeightUnit;
  idPrefix?: string;
}

/** `2026-07-13` → `13 Jul`; the full key stays in the accessibility label. */
function shortDate(dateKey: string | null): string {
  return dateKey ? formatAxisDate(dateKey) : '—';
}

function signed(value: number, digits: number): string {
  const text = digits === 2 ? Math.abs(value).toFixed(2) : formatMeasurement(Math.abs(value));
  return `${value > 0 ? '+' : '−'}${text}`;
}

/** "Height and Sex" / "Height, Sex and Birth year" — a list a person can read. */
function joinMissing(missing: string[]): string {
  if (missing.length === 1) return missing[0];
  return `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
}

export function HealthBodyDashboard({
  entries,
  weightKg,
  heightCm,
  gender,
  birthYear,
  activityLevel,
  weightUnit = 'kg',
  idPrefix = 'health-body-dashboard',
}: HealthBodyDashboardProps) {
  const colors = useAppColors();

  const ratios = React.useMemo(() => bodyRatios(entries, heightCm), [entries, heightCm]);
  const sides = React.useMemo(() => bodySideDifferences(entries), [entries]);

  // The body-fat percentage feeding fat/lean mass is the LATEST one this tab
  // collected — the same reading its own trend chart plots. There is no scale
  // integration, so this number is whatever the member measured, and the card
  // says so rather than implying a device produced it.
  const latestBodyFat = React.useMemo(() => {
    const fat = entries.filter((entry) => entry.metric === 'bodyFat');
    return fat.length > 0 ? fat[0].value : null;
  }, [entries]);

  const composition = React.useMemo(
    () =>
      summarizeBodyComposition({
        weightKg,
        heightCm,
        gender,
        birthYear,
        activityLevel,
        bodyFatPercent: latestBodyFat,
      }),
    [weightKg, heightCm, gender, birthYear, activityLevel, latestBodyFat],
  );

  const knownRatios = ratios.filter((ratio) => ratio.latest !== null);
  const unknownRatios = ratios.filter((ratio) => ratio.latest === null);

  return (
    <>
      {/* ------------------------------- Ratios ------------------------------ */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          RATIOS
        </Typography>

        {knownRatios.length === 0 ? (
          <Typography variant="body" color={colors.textSecondary} testID={`${idPrefix}-ratios-empty`}>
            A ratio needs both of its sites measured on the same day. Log a waist and a hips reading
            in one session to see waist-to-hip.
          </Typography>
        ) : null}

        {knownRatios.map((ratio) => (
          <View
            key={ratio.key}
            style={[styles.row, { borderTopColor: colors.borderColor }]}
            testID={`${idPrefix}-ratio-${ratio.key}`}
            accessible
            accessibilityLabel={`${ratio.label}: ${ratio.latest?.toFixed(2)} on ${
              ratio.latestDate
            }${
              ratio.change === null
                ? ', no earlier day to compare with'
                : `, ${signed(ratio.change, 2)} against ${ratio.previousDate}`
            }`}
          >
            <View style={styles.rowMain}>
              <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                {ratio.label}
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                {ratio.description}
              </Typography>
            </View>
            <View style={styles.rowValue}>
              <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                {ratio.latest?.toFixed(2)}
              </Typography>
              {/* The date matters: a ratio belongs to the day BOTH sites were
                  taped, which is often not the most recent day in the log. */}
              <Typography variant="caption1" color={colors.textSecondary}>
                {shortDate(ratio.latestDate)}
              </Typography>
              {ratio.change !== null && ratio.change !== 0 ? (
                <View style={styles.deltaRow}>
                  <Icon
                    name={ratio.change < 0 ? 'arrow-down' : 'arrow-up'}
                    size={12}
                    color={colors.primary}
                  />
                  <Typography variant="caption1" color={colors.primary}>
                    {signed(ratio.change, 2)} since {shortDate(ratio.previousDate)}
                  </Typography>
                </View>
              ) : null}
            </View>
          </View>
        ))}

        {unknownRatios.length > 0 ? (
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID={`${idPrefix}-ratios-missing`}
          >
            {unknownRatios
              .map((ratio) => `${ratio.label} needs ${joinMissing(ratio.missing).toLowerCase()}`)
              .join('. ')}
            .
          </Typography>
        ) : null}

        <Typography variant="caption1" color={colors.textSecondary}>
          A ratio compares two of your own measurements, so it stays meaningful whatever your size.
          Symply Health shows the number and which way it moved — it does not score it.
        </Typography>
      </Card>

      {/* --------------------------- Body composition ------------------------ */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          BODY COMPOSITION
        </Typography>

        <HealthStatTiles
          stats={[
            {
              label: 'BMI',
              value: composition.bmi !== null ? composition.bmi.toFixed(1) : '—',
              icon: 'height',
              testID: `${idPrefix}-bmi`,
            },
            {
              label: 'BMR',
              value: composition.bmr !== null ? `${composition.bmr} kcal` : '—',
              icon: 'calories',
              testID: `${idPrefix}-bmr`,
            },
            {
              label: 'Lean mass',
              value:
                composition.leanMassKg !== null
                  ? `${formatMeasurement(weightInUnit(composition.leanMassKg, weightUnit))} ${weightUnit}`
                  : '—',
              icon: 'strength',
              testID: `${idPrefix}-lean-mass`,
            },
          ]}
        />
        <HealthStatTiles
          stats={[
            {
              label: 'Fat mass',
              value:
                composition.fatMassKg !== null
                  ? `${formatMeasurement(weightInUnit(composition.fatMassKg, weightUnit))} ${weightUnit}`
                  : '—',
              icon: 'body-measurements',
              testID: `${idPrefix}-fat-mass`,
            },
            {
              label: 'Body fat',
              value:
                composition.bodyFatPercent !== null
                  ? `${formatMeasurement(composition.bodyFatPercent)} %`
                  : '—',
              icon: 'insights',
              testID: `${idPrefix}-body-fat`,
            },
            {
              label: 'Daily burn',
              value: composition.tdee !== null ? `${composition.tdee} kcal` : '—',
              icon: 'energy-burned',
              testID: `${idPrefix}-tdee`,
            },
          ]}
        />

        {composition.missing.length > 0 ? (
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID={`${idPrefix}-composition-missing`}
          >
            {joinMissing(composition.missing)}{' '}
            {composition.missing.length === 1 ? 'is' : 'are'} still needed. Height, sex, birth year
            and activity level live on your weight goal; body fat is logged on this tab.
          </Typography>
        ) : null}

        {/* The donor puts these explanations in a separate info sheet. They ride
            beside the figures instead, because a formula the reader has to go
            looking for is one they will not read. */}
        <Typography variant="caption1" color={colors.textSecondary}>
          BMI is weight ÷ height², a population screening ratio — it knows nothing about how much of
          you is muscle. BMR is the Mifflin–St Jeor estimate of what your body uses at rest; daily
          burn multiplies it by your activity level
          {activityLevel ? ` (${ACTIVITY_LABELS[activityLevel].toLowerCase()})` : ''}. Fat and lean
          mass come from the body-fat percentage you measured and logged here, not from a scale.
        </Typography>
      </Card>

      {/* ----------------------------- Left / right -------------------------- */}
      {sides.length > 0 ? (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            LEFT AND RIGHT
          </Typography>
          {sides.map((side) => (
            <View
              key={side.label}
              style={[styles.row, { borderTopColor: colors.borderColor }]}
              testID={`${idPrefix}-side-${side.label.replace(/[^a-zA-Z]/g, '')}`}
              accessible
              accessibilityLabel={`${side.label}: left ${formatMeasurement(side.left.value)} ${
                side.left.unit
              }, right ${formatMeasurement(side.right.value)} ${side.right.unit}${
                side.difference === null
                  ? ', logged in different units so there is no difference to show'
                  : side.difference === 0
                    ? ', the same'
                    : `, ${signed(side.difference, 1)} ${side.unit} on the left`
              }`}
            >
              <Typography variant="body" color={colors.textPrimary} style={styles.rowMain}>
                {side.label}
              </Typography>
              <Typography variant="footnote" color={colors.textSecondary}>
                {formatMeasurement(side.left.value)} / {formatMeasurement(side.right.value)}{' '}
                {side.left.unit}
              </Typography>
              <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                {side.unitMismatch
                  ? 'unit changed'
                  : side.difference === 0
                    ? 'even'
                    : `${signed(side.difference as number, 1)} ${side.unit}`}
              </Typography>
            </View>
          ))}
          <Typography variant="caption1" color={colors.textSecondary}>
            Left minus right, in the unit you measured. Small differences between sides are ordinary
            — this is here so you can watch the gap rather than judge it.
          </Typography>
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
    borderRadius: CornerRadius.md,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  rowValue: {
    alignItems: 'flex-end',
    gap: 2,
  },
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
});
