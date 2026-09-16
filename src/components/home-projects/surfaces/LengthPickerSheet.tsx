/**
 * A wheel for entering a length, with columns that follow the selected unit.
 *
 * ## Why a picker and not just a field
 *
 * Room dimensions are the one place in this feature where a typo is expensive
 * and invisible: every area, tile count, litre of paint and cost downstream is
 * derived from three numbers typed at the very start. A keyboard lets a member
 * enter `36` when they meant `3.6`, and nothing on the screen looks wrong
 * afterwards — the room is simply ten times too big. A bounded wheel cannot
 * produce that value at all.
 *
 * It also removes the unit ambiguity a text field cannot: `7 10` in a box could
 * be seven-foot-ten or two numbers, while two labelled wheels reading **7 ft**
 * and **10 in** are unambiguous before anything is parsed.
 *
 * ## The columns come from the unit, the value never does
 *
 * `value` and `onConfirm` are **metres**, always — the same canonical-value /
 * display-unit split the rest of the feature uses. Only the wheels change:
 *
 * | Unit | Wheels |
 * |---|---|
 * | `ft` | feet + inches (0–11) |
 * | `in` | inches |
 * | `m`  | metres + centimetres (0–99) |
 * | `cm` | centimetres |
 *
 * Because the value is metres on both sides, switching units mid-edit
 * re-expresses the same length rather than reinterpreting the digits — the
 * property `units.test.ts` guards for typing, holding here for free.
 *
 * ## The wheel expresses exactly the legal range
 *
 * Rather than letting a member land on 4′0″ for a ceiling whose minimum is
 * 1.5 m and then silently clamping, the second column shortens on the last row
 * of the first. Clamping after the fact changes a number someone deliberately
 * chose; a wheel that cannot reach it never lies.
 *
 * "Enter manually" is kept because a laser measure gives 3.617 m and no wheel
 * has that row — the same escape hatch `NumberWheelPickerSheet` established,
 * for the same reason.
 */

import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet, Icon, Typography } from '@components/ui';
import { useTheme } from '@contexts/ThemeContext';
import {
  M_PER_FT,
  M_PER_IN,
  formatLength,
  type LengthUnit,
} from '@features/house/surfaces/units';
import { CornerRadius, Spacing, useAppColors } from '@theme';

/** How one unit's wheels are built. All sizes in metres. */
interface WheelSpec {
  /** Metres per row of the first wheel. */
  primaryM: number;
  primaryLabel: string;
  /** Absent for a single-wheel unit. */
  secondaryM?: number;
  secondaryLabel?: string;
  /** Rows in the second wheel before it carries into the first. */
  secondaryCount?: number;
}

const WHEEL_SPECS: Record<LengthUnit, WheelSpec> = {
  ft: {
    primaryM: M_PER_FT,
    primaryLabel: 'ft',
    secondaryM: M_PER_IN,
    secondaryLabel: 'in',
    secondaryCount: 12,
  },
  in: { primaryM: M_PER_IN, primaryLabel: 'in' },
  m: {
    primaryM: 1,
    primaryLabel: 'm',
    secondaryM: 0.01,
    secondaryLabel: 'cm',
    secondaryCount: 100,
  },
  cm: { primaryM: 0.01, primaryLabel: 'cm' },
};

export function wheelSpecFor(unit: LengthUnit): WheelSpec {
  return WHEEL_SPECS[unit];
}

/**
 * The first wheel's rows.
 *
 * `ceil` on the low end and `floor` on the high end, so the wheel never offers
 * a whole value that cannot be reached inside the bounds — a ceiling limited to
 * 1.5 m starts at 5 ft, not 4.
 */
export function primaryWheelValues(
  spec: WheelSpec,
  minM: number,
  maxM: number,
): number[] {
  const from = Math.ceil(minM / spec.primaryM - 1e-9);
  const to = Math.floor(maxM / spec.primaryM + 1e-9);
  const rows: number[] = [];
  for (let i = from; i <= Math.max(from, to); i += 1) rows.push(i);
  return rows;
}

/**
 * The second wheel's rows, shortened on the last row of the first.
 *
 * This is what lets the wheel express the legal range exactly instead of being
 * clamped afterwards — see the module header.
 */
export function secondaryWheelValues(
  spec: WheelSpec,
  primary: number,
  maxM: number,
): number[] {
  if (!spec.secondaryM || !spec.secondaryCount) return [];
  const headroom = maxM - primary * spec.primaryM;
  const fits = Math.floor(headroom / spec.secondaryM + 1e-9);
  const count = Math.min(spec.secondaryCount, Math.max(0, fits) + 1);
  return Array.from({ length: Math.max(1, count) }, (_, index) => index);
}

/**
 * Put a length onto the wheels.
 *
 * Rounds to the FINEST row first and then splits. Flooring the primary and
 * rounding the remainder separately loses a row at every carry — 2.399 m would
 * open on 2 m 39 cm instead of 2 m 40 cm.
 */
export function splitToWheels(
  spec: WheelSpec,
  metres: number,
  rows: number[],
): { primary: number; secondary: number } {
  const first = rows[0] ?? 0;
  const last = rows[rows.length - 1] ?? first;
  const bounded = (value: number) => Math.min(last, Math.max(first, value));

  if (!spec.secondaryM || !spec.secondaryCount) {
    return {
      primary: bounded(Math.round(metres / spec.primaryM)),
      secondary: 0,
    };
  }
  const totalSecondaryRows = Math.round(metres / spec.secondaryM);
  const perPrimary = spec.secondaryCount;
  const wholePart = Math.floor(totalSecondaryRows / perPrimary);
  return {
    primary: bounded(wholePart),
    secondary: totalSecondaryRows - wholePart * perPrimary,
  };
}

/** Read the wheels back as metres. */
export function wheelsToMetres(
  spec: WheelSpec,
  primary: number,
  secondary: number,
): number {
  return (
    primary * spec.primaryM +
    (spec.secondaryM ? secondary * spec.secondaryM : 0)
  );
}

export type { WheelSpec };

export interface LengthPickerSheetProps {
  visible: boolean;
  title: string;
  /** Current length, metres. */
  value: number;
  /** Bounds, metres. The wheels are built so every row sits inside them. */
  minM: number;
  maxM: number;
  unit: LengthUnit;
  onConfirm: (metres: number) => void;
  onClose: () => void;
  /** The caller switches its field to keyboard entry. */
  onManualEntry: () => void;
  /**
   * Rendered above the wheels, with the value the wheels are *currently* on.
   *
   * A render prop rather than a node, because the whole point is that it moves
   * as the wheel does — and the draft lives in here. Lifting it to the parent
   * would mean a state round-trip on every tick, and the sheet covers the
   * screen's own preview anyway, which is exactly why this slot exists: without
   * it, "highlight what I am editing" is invisible for as long as the member is
   * editing it.
   */
  preview?: (draftMetres: number) => React.ReactNode;
  testID?: string;
}

export function LengthPickerSheet({
  visible,
  title,
  value,
  minM,
  maxM,
  unit,
  onConfirm,
  onClose,
  onManualEntry,
  preview,
  testID = 'length-picker',
}: LengthPickerSheetProps) {
  const colors = useAppColors();
  const { isDark } = useTheme();
  const spec = wheelSpecFor(unit);

  const primaryValues = useMemo(
    () => primaryWheelValues(spec, minM, maxM),
    [spec, minM, maxM],
  );

  /**
   * Seeded from the value, not from zero.
   *
   * Starting at 0 and letting the effect below correct it renders one frame of
   * a wheel on its first row — and, because the sheet hands its draft to the
   * live preview, one frame of a room collapsed to nothing. It is brief and it
   * is visible, and a lazy initialiser costs nothing to avoid.
   */
  const initial = () =>
    splitToWheels(
      spec,
      Math.min(maxM, Math.max(minM, value)),
      primaryWheelValues(spec, minM, maxM),
    );
  const [primary, setPrimary] = useState(() => initial().primary);
  const [secondary, setSecondary] = useState(() => initial().secondary);

  // Re-snap when the sheet is reopened on a different value, or the unit
  // changes under it. The mount case is already handled above.
  useEffect(() => {
    if (!visible) return;
    const clamped = Math.min(maxM, Math.max(minM, value));
    const next = splitToWheels(spec, clamped, primaryValues);
    setPrimary(next.primary);
    setSecondary(next.secondary);
  }, [visible, value, minM, maxM, spec, primaryValues]);

  const secondaryValues = useMemo(
    () => secondaryWheelValues(spec, primary, maxM),
    [spec, primary, maxM],
  );

  // A shortened second wheel can strand the current selection past its end.
  const boundedSecondary = Math.min(
    secondary,
    secondaryValues[secondaryValues.length - 1] ?? 0,
  );

  const metres = wheelsToMetres(spec, primary, boundedSecondary);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="standard"
      noPadding
      title={title}
      showCloseButton
      headerAction={{
        label: 'Done',
        onPress: () => {
          onConfirm(metres);
          onClose();
        },
        testID: `${testID}-done`,
      }}
    >
      <View style={[styles.body, { backgroundColor: colors.backgroundMain }]}>
        {preview ? (
          <View style={styles.preview} testID={`${testID}-preview`}>
            {preview(metres)}
          </View>
        ) : null}

        {/* The live value in the member's own unit, so the wheels are read as
            one measurement rather than two unrelated numbers. */}
        <Typography
          variant="title3"
          weight="semibold"
          style={styles.readout}
          testID={`${testID}-readout`}
        >
          {formatLength(metres, unit)}
        </Typography>

        <View style={styles.wheelRow}>
          <View style={styles.wheelColumn}>
            <Picker
              selectedValue={primary}
              onValueChange={picked => setPrimary(Number(picked))}
              itemStyle={styles.pickerItem}
              style={styles.picker}
              testID={`${testID}-primary`}
            >
              {primaryValues.map(row => (
                <Picker.Item
                  key={row}
                  value={row}
                  label={String(row)}
                  color={isDark ? colors.textPrimary : undefined}
                />
              ))}
            </Picker>
            <Typography
              variant="subheadline"
              color={colors.textSecondary}
              style={styles.wheelLabel}
            >
              {spec.primaryLabel}
            </Typography>
          </View>

          {spec.secondaryM ? (
            <View style={styles.wheelColumn}>
              <Picker
                selectedValue={boundedSecondary}
                onValueChange={picked => setSecondary(Number(picked))}
                itemStyle={styles.pickerItem}
                style={styles.picker}
                testID={`${testID}-secondary`}
              >
                {secondaryValues.map(row => (
                  <Picker.Item
                    key={row}
                    value={row}
                    label={String(row)}
                    color={isDark ? colors.textPrimary : undefined}
                  />
                ))}
              </Picker>
              <Typography
                variant="subheadline"
                color={colors.textSecondary}
                style={styles.wheelLabel}
              >
                {spec.secondaryLabel}
              </Typography>
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={onManualEntry}
          accessibilityRole="button"
          accessibilityLabel="Type an exact measurement"
          testID={`${testID}-manual`}
          style={[styles.manualRow, { borderTopColor: colors.borderColor }]}
        >
          <Icon name="keypad-outline" size={18} color={colors.primary} />
          <Typography
            variant="footnote"
            weight="semibold"
            color={colors.primary}
          >
            Type an exact measurement
          </Typography>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: Spacing.base },
  preview: { alignItems: 'center', paddingBottom: Spacing.xs },
  readout: { textAlign: 'center', paddingBottom: Spacing.xs },
  wheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // A native `UIPickerView` reports no intrinsic size to Yoga, so a row that
    // only hugs its content collapses to nothing and the wheels vanish while
    // every label around them still renders — which is exactly what it looked
    // like. The row has to state a height, and each picker a width.
    minHeight: 200,
  },
  wheelColumn: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  picker: { flex: 1 },
  wheelLabel: { paddingLeft: Spacing.xs, minWidth: 26 },
  pickerItem: { fontSize: 22 },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.sm,
  },
});
