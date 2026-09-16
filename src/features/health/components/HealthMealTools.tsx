import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors, useIsDarkMode } from '@theme';

import { todayDateKey } from '../healthLocalStorage';
import {
  formatDayKey,
  MEAL_SLOT_LABELS,
  MEAL_SLOTS,
  shiftDateKey,
  type MealSlot,
} from '../healthNutritionStorage';

/**
 * Symply Health — the diary's COPY and MULTI-SELECT verbs.
 *
 * Copying is presented as a BOTTOM SHEET (`@components/ui/BottomSheet`, the
 * one shared sheet primitive) rather than an inline expanding card — the
 * inline panel this replaced grew a source stepper, a slot picker and a
 * destination when it gained a second direction, which is exactly the kind
 * of transient, single-purpose surface a sheet is for.
 *
 * TWO DIRECTIONS, TWO SHEETS, ONE REQUEST SHAPE:
 *
 *  - `HealthCopyMealSheet` — PULL. Anchored on the meal you are about to add
 *    to; you pick the SOURCE (a day, and a meal on it, or "whole day").
 *    Reached from the Add Food card, before anything may even be logged yet.
 *
 *  - `HealthCopyToSheet` — PUSH. Anchored on a meal that already has food in
 *    it; you pick the DESTINATION (a day and a meal), with two shortcut
 *    chips for the moves this is actually for ("send today's lunch to
 *    tomorrow", "put breakfast on tonight's plate too"). Reached from a
 *    populated meal-group card's Copy button.
 *
 * Both resolve to the same `CopyRequest` and the same
 * `/nutrition/copy-day` request the screen already knew how to send — only
 * which side of `{fromDate, fromSlot, toDate, toSlot}` is fixed differs.
 */

/** Sentinel for "every slot", kept out of `MealSlot` so it cannot reach the wire. */
export const WHOLE_DAY_SOURCE = 'whole-day' as const;
export type CopySource = MealSlot | typeof WHOLE_DAY_SOURCE;

export interface CopyRequest {
  fromDate: string;
  /** Omitted when the whole source day is being copied. */
  fromSlot?: MealSlot;
  toDate: string;
  /** Omitted when each row should keep the slot it came from. */
  toSlot?: MealSlot;
}

/** The furthest a source/destination day picker goes — a year of diary is plenty. */
const MAX_LOOKBACK_DAYS = 365;

/** Local `YYYY-MM-DD` (never UTC — avoids the off-by-one-day shift `toISOString` gives). */
function dateToYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` into a local `Date`; blank/garbage falls back to today. */
function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) return new Date(y, m - 1, d);
  return new Date();
}

/**
 * A day stepper with a fast escape hatch to a native calendar — stepping one
 * day at a time is fine for "yesterday" or "tomorrow", but a copy two months
 * back or forward deserves a real date picker, not sixty taps.
 */
function DateStepField({
  date,
  onChange,
  min,
  max,
  testID,
}: {
  date: string;
  onChange: (next: string) => void;
  min?: string;
  max?: string;
  testID: string;
}) {
  const colors = useAppColors();
  const isDark = useIsDarkMode();
  const [pickerOpen, setPickerOpen] = useState(false);
  const canGoBack = !min || date > min;
  const canGoForward = !max || date < max;

  const handlePicked = (_event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setPickerOpen(false);
    if (selected) onChange(dateToYmd(selected));
  };

  return (
    <View style={styles.dateFieldWrap}>
      <View style={styles.stepperRow}>
        <Pressable
          onPress={() => onChange(shiftDateKey(date, -1))}
          disabled={!canGoBack}
          accessibilityRole="button"
          accessibilityLabel="An earlier day"
          accessibilityState={{ disabled: !canGoBack }}
          testID={`${testID}-prev`}
          style={[styles.stepBtn, { borderColor: colors.borderColor, opacity: canGoBack ? 1 : 0.4 }]}
        >
          <Icon name="chevron-back" size={16} color={colors.textPrimary} />
        </Pressable>
        <Pressable
          onPress={() => setPickerOpen((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={`Pick a date, currently ${formatDayKey(date)}`}
          accessibilityState={{ expanded: pickerOpen }}
          testID={`${testID}-label`}
          style={styles.dateLabelBtn}
        >
          <Typography variant="body" weight="semibold" color={colors.textPrimary}>
            {formatDayKey(date)}
          </Typography>
          <Icon name="calendar-outline" size={16} color={colors.primary} />
        </Pressable>
        <Pressable
          onPress={() => onChange(shiftDateKey(date, 1))}
          disabled={!canGoForward}
          accessibilityRole="button"
          accessibilityLabel="A later day"
          accessibilityState={{ disabled: !canGoForward }}
          testID={`${testID}-next`}
          style={[styles.stepBtn, { borderColor: colors.borderColor, opacity: canGoForward ? 1 : 0.4 }]}
        >
          <Icon name="chevron-forward" size={16} color={colors.textPrimary} />
        </Pressable>
      </View>

      {pickerOpen && Platform.OS === 'ios' ? (
        <View style={[styles.datePanel, { borderColor: colors.borderColor }]}>
          <DateTimePicker
            value={ymdToDate(date)}
            mode="date"
            display="spinner"
            minimumDate={min ? ymdToDate(min) : undefined}
            maximumDate={max ? ymdToDate(max) : undefined}
            themeVariant={isDark ? 'dark' : 'light'}
            onChange={handlePicked}
            testID={`${testID}-picker`}
          />
          <Pressable
            onPress={() => setPickerOpen(false)}
            style={styles.dateDone}
            testID={`${testID}-done`}
          >
            <Typography variant="footnote" weight="semibold" color={colors.primary}>
              Done
            </Typography>
          </Pressable>
        </View>
      ) : null}
      {pickerOpen && Platform.OS === 'android' ? (
        <DateTimePicker
          value={ymdToDate(date)}
          mode="date"
          display="default"
          minimumDate={min ? ymdToDate(min) : undefined}
          maximumDate={max ? ymdToDate(max) : undefined}
          onChange={handlePicked}
          testID={`${testID}-picker`}
        />
      ) : null}
    </View>
  );
}

function SlotChips({
  value,
  onChange,
  testID,
}: {
  value: MealSlot;
  onChange: (slot: MealSlot) => void;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.chipRow}>
      {MEAL_SLOTS.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="button"
            accessibilityLabel={MEAL_SLOT_LABELS[option]}
            accessibilityState={{ selected: active }}
            testID={`${testID}-${option}`}
            style={[
              styles.chip,
              {
                borderColor: active ? colors.primary : colors.borderColor,
                backgroundColor: active ? `${colors.primary}1F` : 'transparent',
              },
            ]}
          >
            <Typography
              variant="caption1"
              weight="semibold"
              color={active ? colors.primary : colors.textSecondary}
            >
              {MEAL_SLOT_LABELS[option]}
            </Typography>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface HealthCopyMealSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The day AND meal being added to — fixed; only the source is picked. */
  toDate: string;
  toSlot: MealSlot;
  busy: boolean;
  onCopy: (request: CopyRequest) => void;
  testID: string;
}

/**
 * PULL: bring another day's food — or another meal of THIS day — into the
 * meal on screen. The donor's `CopyMealFromDateSheet`, `CopyMealToMealSheet`
 * and "copy the whole day" folded into one sheet, because `/copy-day` takes
 * both slot arguments.
 */
export function HealthCopyMealSheet({
  visible,
  onClose,
  toDate,
  toSlot,
  busy,
  onCopy,
  testID,
}: HealthCopyMealSheetProps) {
  const colors = useAppColors();
  // Donor `CopyMealFromDateSheet` opens on yesterday; so does this.
  const [fromDate, setFromDate] = useState(() => shiftDateKey(toDate, -1));
  const [source, setSource] = useState<CopySource>(toSlot);

  // Re-seed the defaults every time the sheet opens fresh, rather than
  // carrying a stale pick from the last time it was closed.
  useEffect(() => {
    if (visible) {
      setFromDate(shiftDateKey(toDate, -1));
      setSource(toSlot);
    }
  }, [visible, toDate, toSlot]);

  const earliest = shiftDateKey(todayDateKey(), -MAX_LOOKBACK_DAYS);
  const sameSlot = source === toSlot;
  const isSelfCopy = fromDate === toDate && sameSlot;
  const options: CopySource[] = [...MEAL_SLOTS, WHOLE_DAY_SOURCE];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="content"
      title={`Copy into ${MEAL_SLOT_LABELS[toSlot]}`}
      showCloseButton
    >
      <View style={styles.sheetBody} testID={`${testID}-body`}>
        <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
          FROM
        </Typography>
        <DateStepField
          date={fromDate}
          onChange={setFromDate}
          min={earliest}
          max={toDate}
          testID={`${testID}-from`}
        />

        <View style={styles.chipRow}>
          {options.map((option) => {
            const active = option === source;
            const label = option === WHOLE_DAY_SOURCE ? 'Whole day' : MEAL_SLOT_LABELS[option];
            return (
              <Pressable
                key={option}
                onPress={() => setSource(option)}
                accessibilityRole="button"
                accessibilityLabel={`Copy ${label.toLowerCase()} from ${formatDayKey(fromDate)}`}
                accessibilityState={{ selected: active }}
                testID={`${testID}-source-${option}`}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? colors.primary : colors.borderColor,
                    backgroundColor: active ? `${colors.primary}1F` : 'transparent',
                  },
                ]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.primary : colors.textSecondary}
                >
                  {label}
                </Typography>
              </Pressable>
            );
          })}
        </View>

        <Typography variant="caption1" color={colors.textSecondary}>
          Copies are added to {MEAL_SLOT_LABELS[toSlot]} — nothing already there is replaced.
        </Typography>

        <Pressable
          onPress={() =>
            onCopy({
              fromDate,
              ...(source !== WHOLE_DAY_SOURCE ? { fromSlot: source } : {}),
              toDate,
              toSlot,
            })
          }
          disabled={busy || isSelfCopy}
          accessibilityRole="button"
          accessibilityLabel={`Copy from ${formatDayKey(fromDate)} into ${MEAL_SLOT_LABELS[toSlot]}`}
          accessibilityState={{ disabled: busy || isSelfCopy }}
          testID={`${testID}-confirm`}
          style={[
            styles.primaryButton,
            { backgroundColor: busy || isSelfCopy ? colors.borderColor : colors.primary },
          ]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.white}>
            {isSelfCopy ? 'Pick a different day or meal' : 'Copy'}
          </Typography>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

export interface HealthCopyToSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The meal being copied FROM — fixed; only the destination is picked. */
  fromDate: string;
  fromSlot: MealSlot;
  busy: boolean;
  onCopy: (request: CopyRequest) => void;
  testID: string;
}

/**
 * PUSH: send a meal that already has food in it forward onto another day, or
 * sideways onto another meal of today. The two shortcuts are the moves this
 * button actually gets used for — everything else is one date field and one
 * row of chips away.
 */
export function HealthCopyToSheet({
  visible,
  onClose,
  fromDate,
  fromSlot,
  busy,
  onCopy,
  testID,
}: HealthCopyToSheetProps) {
  const colors = useAppColors();
  const [toDate, setToDate] = useState(() => shiftDateKey(fromDate, 1));
  const [toSlot, setToSlot] = useState<MealSlot>(fromSlot);

  useEffect(() => {
    if (visible) {
      setToDate(shiftDateKey(fromDate, 1));
      setToSlot(fromSlot);
    }
  }, [visible, fromDate, fromSlot]);

  const farthest = shiftDateKey(fromDate, MAX_LOOKBACK_DAYS);
  const isSelfCopy = toDate === fromDate && toSlot === fromSlot;

  const shortcuts: Array<{ key: string; label: string; date: string; slot: MealSlot }> = [
    { key: 'tomorrow-lunch', label: `Tomorrow · ${MEAL_SLOT_LABELS.lunch}`, date: shiftDateKey(fromDate, 1), slot: 'lunch' },
    { key: 'today-dinner', label: `Today · ${MEAL_SLOT_LABELS.dinner}`, date: fromDate, slot: 'dinner' },
  ];

  const fire = (target: { date: string; slot: MealSlot }) => {
    onCopy({ fromDate, fromSlot, toDate: target.date, toSlot: target.slot });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="content"
      title={`Copy ${MEAL_SLOT_LABELS[fromSlot]}`}
      showCloseButton
    >
      <View style={styles.sheetBody} testID={`${testID}-body`}>
        <Typography variant="footnote" color={colors.textSecondary}>
          From {MEAL_SLOT_LABELS[fromSlot]} on {formatDayKey(fromDate)}
        </Typography>

        <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
          SHORTCUTS
        </Typography>
        <View style={styles.chipRow}>
          {shortcuts.map((shortcut) => {
            const disabled = busy || (shortcut.date === fromDate && shortcut.slot === fromSlot);
            return (
              <Pressable
                key={shortcut.key}
                onPress={() => fire(shortcut)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Copy to ${shortcut.label}`}
                accessibilityState={{ disabled }}
                testID={`${testID}-shortcut-${shortcut.key}`}
                style={[
                  styles.shortcutChip,
                  { borderColor: colors.primary, opacity: disabled ? 0.4 : 1 },
                ]}
              >
                <Typography variant="footnote" weight="semibold" color={colors.primary}>
                  {shortcut.label}
                </Typography>
              </Pressable>
            );
          })}
        </View>

        <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
          OR CHOOSE A DAY AND MEAL
        </Typography>
        <DateStepField
          date={toDate}
          onChange={setToDate}
          min={fromDate}
          max={farthest}
          testID={`${testID}-to`}
        />
        <SlotChips value={toSlot} onChange={setToSlot} testID={`${testID}-to-slot`} />

        <Typography variant="caption1" color={colors.textSecondary}>
          Copies are added — nothing already logged that day is replaced.
        </Typography>

        <Pressable
          onPress={() => fire({ date: toDate, slot: toSlot })}
          disabled={busy || isSelfCopy}
          accessibilityRole="button"
          accessibilityLabel={`Copy to ${MEAL_SLOT_LABELS[toSlot]} on ${formatDayKey(toDate)}`}
          accessibilityState={{ disabled: busy || isSelfCopy }}
          testID={`${testID}-confirm`}
          style={[
            styles.primaryButton,
            { backgroundColor: busy || isSelfCopy ? colors.borderColor : colors.primary },
          ]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.white}>
            {isSelfCopy ? 'Pick a different day or meal' : `Copy to ${MEAL_SLOT_LABELS[toSlot]}`}
          </Typography>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

export interface HealthMealSelectionBarProps {
  slot: MealSlot;
  /** The day the selection lives on — the copy target defaults one day ahead. */
  fromDate: string;
  selectedCount: number;
  /** Required: a stale bar would let the same rows be deleted twice. */
  busy: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onCopy: (target: { toDate: string; toSlot: MealSlot }) => void;
  testID: string;
}

/**
 * The donor's multi-select action bar, with the two verbs it lacked.
 *
 * The donor offered Cancel and Delete only; copying a SUBSET of a meal meant
 * leaving multi-select and using a per-row sheet. `/nutrition/entries/bulk`
 * takes an arbitrary set of rows, so the same selection can be copied.
 */
export function HealthMealSelectionBar({
  slot,
  fromDate,
  selectedCount,
  busy,
  onCancel,
  onDelete,
  onCopy,
  testID,
}: HealthMealSelectionBarProps) {
  const colors = useAppColors();
  const [copying, setCopying] = useState(false);
  const [toDate, setToDate] = useState(fromDate);
  const [toSlot, setToSlot] = useState<MealSlot>(slot);

  const none = selectedCount === 0;
  const isSelfCopy = toDate === fromDate && toSlot === slot;

  return (
    <View style={[styles.panel, { borderColor: colors.borderColor }]} testID={testID}>
      <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
        {selectedCount === 0
          ? 'Nothing selected'
          : `${selectedCount} ${selectedCount === 1 ? 'item' : 'items'} selected`}
      </Typography>

      <View style={styles.barRow}>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={`Stop selecting ${MEAL_SLOT_LABELS[slot]} items`}
          testID={`${testID}-cancel`}
          style={[styles.barButton, { borderColor: colors.borderColor }]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
            Cancel
          </Typography>
        </Pressable>
        <Pressable
          onPress={() => setCopying((current) => !current)}
          disabled={none || busy}
          accessibilityRole="button"
          accessibilityLabel={`Copy the ${selectedCount} selected items somewhere else`}
          accessibilityState={{ disabled: none || busy, expanded: copying }}
          testID={`${testID}-copy`}
          style={[
            styles.barButton,
            { borderColor: none || busy ? colors.borderColor : colors.primary },
          ]}
        >
          <Typography
            variant="footnote"
            weight="semibold"
            color={none || busy ? colors.textSecondary : colors.primary}
          >
            Copy to…
          </Typography>
        </Pressable>
        <Pressable
          onPress={onDelete}
          disabled={none || busy}
          accessibilityRole="button"
          accessibilityLabel={`Delete the ${selectedCount} selected items`}
          accessibilityState={{ disabled: none || busy }}
          testID={`${testID}-delete`}
          style={[
            styles.barButton,
            {
              borderColor: none || busy ? colors.borderColor : colors.error,
              backgroundColor: none || busy ? 'transparent' : `${colors.error}14`,
            },
          ]}
        >
          <Typography
            variant="footnote"
            weight="semibold"
            color={none || busy ? colors.textSecondary : colors.error}
          >
            Delete ({selectedCount})
          </Typography>
        </Pressable>
      </View>

      {copying ? (
        <View style={styles.copyTarget} testID={`${testID}-copy-target`}>
          <View style={styles.stepperRow}>
            <Pressable
              onPress={() => setToDate(shiftDateKey(toDate, -1))}
              accessibilityRole="button"
              accessibilityLabel="Copy to an earlier day"
              testID={`${testID}-copy-prev`}
              style={[styles.stepBtn, { borderColor: colors.borderColor }]}
            >
              <Icon name="chevron-back" size={16} color={colors.textPrimary} />
            </Pressable>
            <Typography
              variant="footnote"
              weight="semibold"
              color={colors.textPrimary}
              testID={`${testID}-copy-to-label`}
              accessibilityLabel={`Copying to ${formatDayKey(toDate)}`}
            >
              To {formatDayKey(toDate)}
            </Typography>
            <Pressable
              onPress={() => setToDate(shiftDateKey(toDate, 1))}
              accessibilityRole="button"
              accessibilityLabel="Copy to a later day"
              testID={`${testID}-copy-next`}
              style={[styles.stepBtn, { borderColor: colors.borderColor }]}
            >
              <Icon name="chevron-forward" size={16} color={colors.textPrimary} />
            </Pressable>
          </View>
          <View style={styles.chipRow}>
            {MEAL_SLOTS.map((option) => {
              const active = option === toSlot;
              return (
                <Pressable
                  key={option}
                  onPress={() => setToSlot(option)}
                  accessibilityRole="button"
                  accessibilityLabel={`Copy into ${MEAL_SLOT_LABELS[option]}`}
                  accessibilityState={{ selected: active }}
                  testID={`${testID}-copy-slot-${option}`}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? colors.primary : colors.borderColor,
                      backgroundColor: active ? `${colors.primary}1F` : 'transparent',
                    },
                  ]}
                >
                  <Typography
                    variant="caption1"
                    weight="semibold"
                    color={active ? colors.primary : colors.textSecondary}
                  >
                    {MEAL_SLOT_LABELS[option]}
                  </Typography>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            onPress={() => {
              setCopying(false);
              onCopy({ toDate, toSlot });
            }}
            disabled={busy || isSelfCopy}
            accessibilityRole="button"
            accessibilityLabel={`Copy ${selectedCount} items into ${
              MEAL_SLOT_LABELS[toSlot]
            } on ${formatDayKey(toDate)}`}
            accessibilityState={{ disabled: busy || isSelfCopy }}
            testID={`${testID}-copy-confirm`}
            style={[
              styles.primaryButton,
              { backgroundColor: busy || isSelfCopy ? colors.borderColor : colors.primary },
            ]}
          >
            <Typography variant="footnote" weight="semibold" color={colors.white}>
              {isSelfCopy
                ? 'Pick a different day or meal'
                : `Copy ${selectedCount} to ${MEAL_SLOT_LABELS[toSlot]}`}
            </Typography>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheetBody: {
    gap: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  panel: {
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  dateFieldWrap: {
    gap: Spacing.xs,
  },
  dateLabelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  datePanel: {
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  dateDone: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  chip: {
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
  },
  shortcutChip: {
    borderWidth: 1.5,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  barRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  barButton: {
    flex: 1,
    height: 38,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyTarget: {
    gap: Spacing.sm,
  },
  primaryButton: {
    height: 40,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
