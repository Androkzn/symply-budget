import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useTheme } from '@contexts/ThemeContext';
import {Spacing, useAppColors } from '@theme';

import { BottomSheet } from './BottomSheet';
import { Typography } from './Typography';

interface SingleProps {
  mode?: 'single';
  value: string; // 'HH:MM'
  onConfirm: (value: string) => void;
}

interface RangeProps {
  mode: 'range';
  startValue: string;
  endValue: string;
  startLabel?: string;
  endLabel?: string;
  onConfirm: (start: string, end: string) => void;
}

type TimePickerSheetProps = (SingleProps | RangeProps) & {
  visible: boolean;
  title?: string;
  onClose: () => void;
  /** Optional background override for the sheet. */
  backgroundColor?: string;
};

function parseHHMM(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

function formatHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
}

/** Light, subtly teal/green backdrop so the sheet stands out from the dimmed page. */
const DEFAULT_SHEET_BG = 'rgba(232, 248, 244, 0.98)';

/** iOS spinner's intrinsic wheel height — see the note on `styles.picker`. */
const WHEEL_HEIGHT = 216;

export function TimePickerSheet(props: TimePickerSheetProps) {
  const colors = useAppColors();
  const { visible, title = 'Select time', onClose, backgroundColor } = props;
  const { isDark } = useTheme();

  const isRange = props.mode === 'range';
  const initialStart = isRange ? props.startValue : props.value;
  const initialEnd = isRange ? props.endValue : '00:00';

  const [startDraft, setStartDraft] = useState<Date>(() => parseHHMM(initialStart));
  const [endDraft, setEndDraft] = useState<Date>(() => parseHHMM(initialEnd));

  useEffect(() => {
    if (visible) {
      setStartDraft(parseHHMM(initialStart));
      setEndDraft(parseHHMM(initialEnd));
    }
  }, [visible, initialStart, initialEnd]);

  const headerBg =
    backgroundColor ?? (isDark ? 'rgba(30, 58, 52, 0.98)' : DEFAULT_SHEET_BG);

  // Android: skip the custom sheet and use the native dialog(s).
  if (Platform.OS === 'android') {
    if (!visible) return null;
    if (isRange) {
      // Chain: start → end. Use React state to flip after start is picked.
      return (
        <AndroidRangePicker
          start={parseHHMM(props.startValue)}
          end={parseHHMM(props.endValue)}
          onClose={onClose}
          onConfirm={props.onConfirm}
        />
      );
    }
    const p = props; // SingleProps
    return (
      <DateTimePicker
        value={parseHHMM(p.value)}
        mode="time"
        display="default"
        onChange={(event: DateTimePickerEvent, date?: Date) => {
          onClose();
          if (event.type === 'dismissed' || !date) return;
          p.onConfirm(formatHHMM(date));
        }}
      />
    );
  }

  const handleDone = () => {
    if (isRange) {
      props.onConfirm(formatHHMM(startDraft), formatHHMM(endDraft));
    } else {
      props.onConfirm(formatHHMM(startDraft));
    }
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="content"
      noPadding
      backgroundColor={headerBg}
      title={title}
      showCloseButton
      headerAction={{ label: 'Done', onPress: handleDone, testID: 'time-picker-done' }}
    >
      {isRange ? (
        <View style={[styles.body, { backgroundColor: colors.backgroundMain }]}>
          <View style={styles.rangeRow}>
            <Typography
              variant="footnote"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.rangeRowLabel}
            >
              {props.startLabel ?? 'Start'}
            </Typography>
            <DateTimePicker
              value={startDraft}
              mode="time"
              display="compact"
              onChange={(_e: DateTimePickerEvent, date?: Date) => {
                if (date) setStartDraft(date);
              }}
              themeVariant={isDark ? 'dark' : 'light'}
            />
          </View>
          <View style={styles.rowDivider} />
          <View style={styles.rangeRow}>
            <Typography
              variant="footnote"
              weight="semibold"
              color={colors.textSecondary}
              style={styles.rangeRowLabel}
            >
              {props.endLabel ?? 'End'}
            </Typography>
            <DateTimePicker
              value={endDraft}
              mode="time"
              display="compact"
              onChange={(_e: DateTimePickerEvent, date?: Date) => {
                if (date) setEndDraft(date);
              }}
              themeVariant={isDark ? 'dark' : 'light'}
            />
          </View>
        </View>
      ) : (
        <View style={[styles.body, { backgroundColor: colors.backgroundMain }]}>
          <DateTimePicker
            value={startDraft}
            mode="time"
            display="spinner"
            onChange={(_event: DateTimePickerEvent, date?: Date) => {
              if (date) setStartDraft(date);
            }}
            themeVariant={isDark ? 'dark' : 'light'}
            style={styles.picker}
          />
        </View>
      )}
    </BottomSheet>
  );
}

/**
 * On Android we chain two native time dialogs (start, then end) — the user
 * sees one dialog after another, which matches platform conventions.
 */
function AndroidRangePicker({
  start,
  end,
  onClose,
  onConfirm,
}: {
  start: Date;
  end: Date;
  onClose: () => void;
  onConfirm: (start: string, end: string) => void;
}) {
  const [phase, setPhase] = useState<'start' | 'end'>('start');
  const [startPicked, setStartPicked] = useState<string | null>(null);

  if (phase === 'start') {
    return (
      <DateTimePicker
        value={start}
        mode="time"
        display="default"
        onChange={(event: DateTimePickerEvent, date?: Date) => {
          if (event.type === 'dismissed' || !date) {
            onClose();
            return;
          }
          setStartPicked(formatHHMM(date));
          setPhase('end');
        }}
      />
    );
  }
  return (
    <DateTimePicker
      value={end}
      mode="time"
      display="default"
      onChange={(event: DateTimePickerEvent, date?: Date) => {
        onClose();
        if (event.type === 'dismissed' || !date || !startPicked) return;
        onConfirm(startPicked, formatHHMM(date));
      }}
    />
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
  },
  /**
   * The wheel's intrinsic height, stated rather than flexed. The sheet hugs its
   * content now, so a `flex: 1` picker resolves against nothing and measures to
   * zero — the same collapse `DatePickerSheet` documents.
   */
  picker: {
    width: '100%',
    height: WHEEL_HEIGHT,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
  },
  rangeRowLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
});
