/**
 * Split a surface, or one of its areas, along a straight line.
 *
 * This is the gesture the feature leads with, because every finish boundary a
 * member actually describes is a straight line across a surface — chair rail,
 * wainscot cap, tile-to-paint, a flooring change at a threshold. Drawing that
 * as a polygon means placing four corners precisely enough that the two regions
 * meet with no gap; splitting means typing one number, and the two pieces are
 * exact by construction.
 *
 * The height presets are the ones that come up over and over in real rooms, and
 * they are labelled by what they *are* rather than by their measurement, since
 * "chair rail" is what a member is trying to say.
 */

import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetHeader } from '@components/common/SheetHeader';
import type { SplitAxis } from '@features/house/surfaces';
import {
  formatLength,
  lengthInputValue,
  lengthKeyboardType,
  lengthPlaceholder,
  parseLength,
  type LengthUnit,
} from '@features/house/surfaces/units';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { useAppColors } from '@theme';

/** Common finish heights, metres. Only offered for a horizontal split. */
const HEIGHT_PRESETS: Array<{ label: string; metres: number }> = [
  { label: 'Skirting', metres: 0.12 },
  { label: 'Wainscot', metres: 0.9 },
  { label: 'Chair rail', metres: 1.1 },
  { label: 'Splashback', metres: 1.2 },
  { label: 'Door head', metres: 2.1 },
];

export interface SplitSheetProps {
  visible: boolean;
  /** What is being cut — a surface label, or an area's. */
  targetLabel: string;
  axis: SplitAxis;
  onAxisChange: (axis: SplitAxis) => void;
  /** The usable range in surface coordinates, metres. */
  min: number;
  max: number;
  initial?: number;
  lengthUnit?: LengthUnit;
  onSplit: (at: number) => void;
  onClose: () => void;
  error?: string | null;
}

export function SplitSheet({
  visible,
  targetLabel,
  axis,
  onAxisChange,
  min,
  max,
  initial,
  lengthUnit = 'm',
  onSplit,
  onClose,
  error,
}: SplitSheetProps) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // The sheet is anchored to the bottom edge, so an open keypad lands on top of
  // the very field that summoned it. Lift the sheet by the inset, and cap its
  // height against what is LEFT above the keyboard so a short phone does not
  // push it off the top instead.
  const keyboardInset = useKeyboardInset();
  const sheetMaxHeight = Math.min(
    windowHeight * 0.8,
    windowHeight - keyboardInset - insets.top - 24,
  );
  const fallback = initial ?? (min + max) / 2;
  const [text, setText] = useState(() =>
    lengthInputValue(fallback, lengthUnit),
  );
  const [openedFor, setOpenedFor] = useState(`${targetLabel}:${axis}`);
  if (visible && openedFor !== `${targetLabel}:${axis}`) {
    setOpenedFor(`${targetLabel}:${axis}`);
    setText(lengthInputValue(fallback, lengthUnit));
  }

  const parsed = parseLength(text, lengthUnit);
  const inRange = parsed !== null && parsed > min && parsed < max;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { paddingBottom: keyboardInset }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.backgroundMain,
              maxHeight: sheetMaxHeight,
            },
          ]}
        >
          {/* The app-wide sheet header — ✕ left, title centred — rather than
              this sheet's old title-left / Cancel-right inversion. */}
          <SheetHeader
            title={`Split ${targetLabel}`}
            leftVariant="close"
            onLeftPress={onClose}
            leftTestID="split-close"
            style={styles.headerRow}
          />

          {/* No `automaticallyAdjustKeyboardInsets` here, and that is deliberate: the
              sheet is ALREADY lifted clear of the keypad by `keyboardInset` on the
              backdrop above. Letting the scroller offset by the keyboard height as
              well counts it twice and drives the focused field's own label off the
              top of the card. Verified on a device via ProjectionTargetModal. */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}
          >
            <View style={styles.chipRow}>
              <AxisChip
                label="Across (a band)"
                selected={axis === 'horizontal'}
                onPress={() => onAxisChange('horizontal')}
                testID="split-axis-horizontal"
              />
              <AxisChip
                label="Down (left / right)"
                selected={axis === 'vertical'}
                onPress={() => onAxisChange('vertical')}
                testID="split-axis-vertical"
              />
            </View>

            <Text style={[styles.label, { color: colors.textPrimary }]}>
              {axis === 'horizontal'
                ? 'Height above the floor'
                : 'Distance along the surface'}
            </Text>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Anywhere between {formatLength(min, lengthUnit)} and{' '}
              {formatLength(max, lengthUnit)}.
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              keyboardType={lengthKeyboardType(lengthUnit)}
              placeholder={lengthPlaceholder(lengthUnit)}
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              style={[
                styles.input,
                {
                  color: colors.textPrimary,
                  borderColor:
                    inRange || text === '' ? colors.borderColor : colors.error,
                  backgroundColor: colors.card,
                },
              ]}
              testID="split-at"
            />

            {axis === 'horizontal' ? (
              <View style={styles.chipRow}>
                {HEIGHT_PRESETS.filter(
                  preset => preset.metres > min && preset.metres < max,
                ).map(preset => (
                  <Pressable
                    key={preset.label}
                    onPress={() =>
                      setText(lengthInputValue(preset.metres, lengthUnit))
                    }
                    style={[
                      styles.presetChip,
                      {
                        borderColor: colors.borderColor,
                        backgroundColor: colors.card,
                      },
                    ]}
                    testID={`split-preset-${preset.label}`}
                  >
                    <Text
                      style={{
                        color: colors.textPrimary,
                        fontSize: 13,
                        fontWeight: '600',
                      }}
                    >
                      {preset.label}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
                      {formatLength(preset.metres, lengthUnit)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {error ? (
              <Text
                style={[styles.error, { color: colors.error }]}
                testID="split-error"
              >
                {error}
              </Text>
            ) : null}

            <Pressable
              style={[
                styles.cta,
                {
                  backgroundColor: inRange
                    ? colors.primary
                    : colors.borderColor,
                },
              ]}
              disabled={!inRange}
              onPress={() => parsed !== null && onSplit(parsed)}
              testID="split-confirm"
            >
              <Text style={styles.ctaText}>Split into two areas</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function AxisChip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={[
        styles.axisChip,
        {
          backgroundColor: selected ? colors.primary : colors.card,
          borderColor: selected ? colors.primary : colors.borderColor,
        },
      ]}
    >
      <Text
        style={{
          color: selected ? '#fff' : colors.textPrimary,
          fontWeight: '600',
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  // No `maxHeight` here: it is computed against the live keyboard inset above,
  // because a percentage measured before the keypad existed does not survive
  // the field being focused.
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  headerRow: { paddingTop: 8 },
  body: { padding: 16, paddingTop: 4, paddingBottom: 40 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  axisChip: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  presetChip: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  label: { fontSize: 14, fontWeight: '700' },
  hint: { fontSize: 12, marginTop: 2, marginBottom: 8, lineHeight: 16 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 17,
    marginBottom: 16,
  },
  error: { fontSize: 13, marginBottom: 12, lineHeight: 18 },
  cta: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
