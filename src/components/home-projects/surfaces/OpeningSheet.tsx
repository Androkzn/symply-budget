/**
 * Doors, windows and other holes in a surface.
 *
 * Openings are what turn a wall's *gross* area into the area a member actually
 * pays to finish, and on a real room the difference is large — a bedroom wall
 * with a window and a door is easily a fifth smaller than its outline. Leaving
 * them out does not produce a slightly generous estimate; it produces one that
 * is wrong in the direction of over-ordering on every wall at once.
 *
 * ## `deducts` is a switch, not a consequence of the type
 *
 * A door comes out of the paint. A niche is a recess that still gets tiled — in
 * fact it usually gets *more* tile than the flat wall it replaced. A radiator
 * is painted behind by some people and not by others. Guessing from the type
 * would silently change a quantity a member is ordering against, so the type
 * sets a sensible default and the switch stays visible.
 *
 * Sizes are typed rather than dragged. A door is 2032 × 813 mm because that is
 * what was fitted, not because that is where a finger landed, and the presets
 * cover the sizes that recur.
 */

import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetHeader } from '@components/common/SheetHeader';
import { createOpening } from '@features/house/surfaces';
import {
  lengthInputValue,
  lengthKeyboardType,
  parseLength,
  type LengthUnit,
} from '@features/house/surfaces/units';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import type { Opening, OpeningType } from '@symply/contracts';
import { useAppColors } from '@theme';

const TYPE_LABELS: Record<OpeningType, string> = {
  door: 'Door',
  window: 'Window',
  passage: 'Opening',
  niche: 'Niche',
  fixture: 'Fixture',
  other: 'Other',
};

/** Width × height × sill, metres. The sizes that recur in real rooms. */
const PRESETS: Array<{
  type: OpeningType;
  label: string;
  w: number;
  h: number;
  y: number;
}> = [
  { type: 'door', label: 'Standard door', w: 0.813, h: 2.032, y: 0 },
  { type: 'door', label: 'Wide door', w: 0.914, h: 2.032, y: 0 },
  { type: 'window', label: 'Window', w: 1.2, h: 1.2, y: 0.9 },
  { type: 'window', label: 'Tall window', w: 0.9, h: 1.5, y: 0.6 },
  { type: 'passage', label: 'Cased opening', w: 1.0, h: 2.1, y: 0 },
];

export interface OpeningSheetProps {
  visible: boolean;
  surfaceLabel: string;
  /** Absent for a create. */
  opening?: Opening | null;
  /** The surface's usable extent, metres — used to keep the hole inside it. */
  maxX: number;
  maxY: number;
  lengthUnit?: LengthUnit;
  onSave: (opening: Opening) => void;
  onDelete?: (openingId: string) => void;
  onClose: () => void;
}

export function OpeningSheet({
  visible,
  surfaceLabel,
  opening,
  maxX,
  maxY,
  lengthUnit = 'm',
  onSave,
  onDelete,
  onClose,
}: OpeningSheetProps) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Four length fields in a sheet pinned to the bottom edge: the keypad opened
  // on top of whichever one the member had just tapped. Lift the sheet by the
  // inset and cap its height against what is left above the keyboard.
  const keyboardInset = useKeyboardInset();
  const sheetMaxHeight = Math.min(
    windowHeight * 0.88,
    windowHeight - keyboardInset - insets.top - 24,
  );
  const [draft, setDraft] = useState<Opening>(
    () => opening ?? createOpening('window', 0.4, 0.9, 1.2, 1.2),
  );
  const [openedFor, setOpenedFor] = useState(opening?.id ?? 'new');
  if (visible && openedFor !== (opening?.id ?? 'new')) {
    setOpenedFor(opening?.id ?? 'new');
    setDraft(opening ?? createOpening('window', 0.4, 0.9, 1.2, 1.2));
  }

  const patch = (next: Partial<Opening>) =>
    setDraft(current => ({ ...current, ...next }));

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    patch({
      type: preset.type,
      width: Math.min(preset.w, maxX),
      height: Math.min(preset.h, maxY),
      y: Math.min(preset.y, Math.max(0, maxY - preset.h)),
    });
  };

  // The hole has to end up inside the surface: `validateSubArea` does not
  // police openings (they are rectangles, not regions), so the clamp is here.
  const fits =
    draft.width > 0 &&
    draft.height > 0 &&
    draft.x >= -0.001 &&
    draft.y >= -0.001 &&
    draft.x + draft.width <= maxX + 0.001 &&
    draft.y + draft.height <= maxY + 0.001;

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
            title={opening ? 'Edit opening' : `Add to ${surfaceLabel}`}
            leftVariant="close"
            onLeftPress={onClose}
            leftTestID="opening-close"
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
              {(Object.keys(TYPE_LABELS) as OpeningType[]).map(type => (
                <Pressable
                  key={type}
                  onPress={() => patch({ type })}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        draft.type === type ? colors.primary : colors.card,
                      borderColor:
                        draft.type === type
                          ? colors.primary
                          : colors.borderColor,
                    },
                  ]}
                  testID={`opening-type-${type}`}
                >
                  <Text
                    style={{
                      color: draft.type === type ? '#fff' : colors.textPrimary,
                      fontWeight: '600',
                      fontSize: 13,
                    }}
                  >
                    {TYPE_LABELS[type]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {!opening ? (
              <View style={styles.chipRow}>
                {PRESETS.map(preset => (
                  <Pressable
                    key={preset.label}
                    onPress={() => applyPreset(preset)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.borderColor,
                      },
                    ]}
                    testID={`opening-preset-${preset.label}`}
                  >
                    <Text
                      style={{
                        color: colors.textPrimary,
                        fontWeight: '600',
                        fontSize: 13,
                      }}
                    >
                      {preset.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <LengthField
              label="Width"
              value={draft.width}
              unit={lengthUnit}
              onChange={width => patch({ width })}
              testID="opening-width"
            />
            <LengthField
              label="Height"
              value={draft.height}
              unit={lengthUnit}
              onChange={height => patch({ height })}
              testID="opening-height"
            />
            <LengthField
              label="From the left edge"
              value={draft.x}
              unit={lengthUnit}
              onChange={x => patch({ x })}
              testID="opening-x"
            />
            <LengthField
              label="From the floor"
              value={draft.y}
              unit={lengthUnit}
              onChange={y => patch({ y })}
              testID="opening-y"
            />

            <View
              style={[styles.switchRow, { borderColor: colors.borderColor }]}
            >
              <View style={styles.switchText}>
                <Text style={[styles.label, { color: colors.textPrimary }]}>
                  Take this out of the finished area
                </Text>
                <Text style={[styles.hint, { color: colors.textSecondary }]}>
                  On for anything you finish around. Off for a niche you tile
                  inside.
                </Text>
              </View>
              <Switch
                value={draft.deducts}
                onValueChange={deducts => patch({ deducts })}
                testID="opening-deducts"
              />
            </View>

            {!fits ? (
              <Text
                style={[styles.error, { color: colors.error }]}
                testID="opening-error"
              >
                That does not fit on this surface. Reduce the size or move it
                in.
              </Text>
            ) : null}

            <Pressable
              style={[
                styles.cta,
                { backgroundColor: fits ? colors.primary : colors.borderColor },
              ]}
              disabled={!fits}
              onPress={() => onSave(draft)}
              testID="opening-save"
            >
              <Text style={styles.ctaText}>
                {opening ? 'Save opening' : 'Add opening'}
              </Text>
            </Pressable>

            {opening && onDelete ? (
              <Pressable
                style={[styles.dangerBtn, { borderColor: colors.error }]}
                onPress={() => onDelete(opening.id)}
                testID="opening-delete"
              >
                <Text style={{ color: colors.error, fontWeight: '600' }}>
                  Remove opening
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function LengthField({
  label,
  value,
  unit,
  onChange,
  testID,
}: {
  label: string;
  value: number;
  unit: LengthUnit;
  onChange: (metres: number) => void;
  testID: string;
}) {
  const colors = useAppColors();
  const [text, setText] = useState(() => lengthInputValue(value, unit));
  const [lastValue, setLastValue] = useState(value);
  if (Math.abs(value - lastValue) > 0.0005) {
    setLastValue(value);
    setText(lengthInputValue(value, unit));
  }
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
      <TextInput
        value={text}
        onChangeText={next => {
          setText(next);
          const parsed = parseLength(next, unit);
          if (parsed !== null && parsed >= 0) {
            setLastValue(parsed);
            onChange(Math.round(parsed * 10000) / 10000);
          }
        }}
        keyboardType={lengthKeyboardType(unit)}
        autoCapitalize="none"
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: colors.borderColor,
            backgroundColor: colors.card,
          },
        ]}
        testID={testID}
      />
    </View>
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  field: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  hint: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
    marginTop: 4,
  },
  switchText: { flex: 1 },
  error: { fontSize: 13, marginTop: 14, lineHeight: 18 },
  cta: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  dangerBtn: {
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
  },
});
