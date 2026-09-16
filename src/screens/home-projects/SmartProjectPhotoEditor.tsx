/**
 * The photo editor behind step 3 of Smart Project.
 *
 * Crop, straighten, flip — and a note about what the planner should look at.
 *
 * ## Why an editor exists at all on a "describe it" flow
 *
 * The photos on this step are read by a model, and a phone camera is bad at the
 * job the member is using it for. They stand back to fit the whole wall in, and
 * the thing they actually meant — the damp patch, the bare stud bay, the old
 * consumer unit — ends up as an eighth of the frame with a kitchen doorway and
 * half a garden beside it. A model given that photo describes the kitchen. So
 * the crop is not a nicety here: it is how the member says "this bit", and it
 * measurably changes what comes back.
 *
 * Rotation is the same argument at a lower level. A sideways photo is a photo a
 * vision model reads sideways, and iOS EXIF orientation does not survive every
 * path a picked file can take to us.
 *
 * ## The frame is fixed and the image moves
 *
 * Not draggable corner handles. Every member has already learned this gesture
 * in their camera roll, and — the part that matters — an image clamped to
 * always cover the frame cannot produce an empty corner, whereas a handle
 * dragged past the edge can. The mapping from what is on screen to what is
 * written to the file lives in `photoCrop.ts`, under test, because it is the
 * one part of this screen that can be wrong while looking completely right.
 *
 * ## Rotate and flip are applied to the BYTES immediately
 *
 * The tempting design is to accumulate `{rotation, flipH, flipV}` and apply it
 * once at save, preserving quality. It also means the crop rectangle has to be
 * mapped back through that transform, and that is the version of this file with
 * a bug in it — a crop that is correct until the member rotates, and then
 * silently off by a quarter turn. Applying each tap costs one JPEG round-trip
 * at 0.92 (visually free, and the result is re-encoded downstream anyway) and
 * buys a crop that always runs against an upright image.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@components/ui/Icon';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import {
  CROP_ASPECTS,
  coverScale,
  cropRect,
  frameForAspect,
  isFullFrameCrop,
  MAX_CROP_ZOOM,
  type CropAspect,
  type CropView,
  type Size,
} from './photoCrop';
import type { DraftPhoto } from './smartProjectPhotos';

/**
 * Quality for the intermediate renders a rotate or a flip produces.
 *
 * Higher than anything downstream stores (`normalizeAttachmentImage` saves at
 * 0.85, `toVisionSafeAttachment` at 0.8) precisely because it is intermediate:
 * a member who taps rotate four times must not be able to see the generation
 * loss they paid for by changing their mind.
 */
const EDIT_JPEG_QUALITY = 0.92;

const NOTE_MAX_CHARS = 180;

export interface PhotoEdit {
  uri: string;
  width: number;
  height: number;
  note?: string;
}

interface Props {
  /** The photo to edit; `null` keeps the modal closed. */
  photo: DraftPhoto | null;
  /** Position in the grid, so the header can say which one this is. */
  index: number;
  total: number;
  onCancel: () => void;
  onSave: (edit: PhotoEdit) => void;
  onDelete: () => void;
}

export function SmartProjectPhotoEditor({
  photo,
  index,
  total,
  onCancel,
  onSave,
  onDelete,
}: Props) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();

  /** The bytes as they stand — replaced by every rotate and flip. */
  const [working, setWorking] = useState<Size & { uri: string }>({
    uri: '',
    width: 0,
    height: 0,
  });
  const [aspect, setAspect] = useState<CropAspect>(null);
  const [aspectKey, setAspectKey] = useState('original');
  const [note, setNote] = useState('');
  const [bounds, setBounds] = useState<Size>({ width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  /** JS mirror of the gesture, committed on every gesture end. */
  const [view, setView] = useState<CropView>({ scale: 1, translateX: 0, translateY: 0 });
  const [touched, setTouched] = useState(false);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const resetView = useCallback(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    setView({ scale: 1, translateX: 0, translateY: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset everything when a different photo is opened. Keyed on `photo?.id`
  // rather than on the object: a re-render that produces an equal-but-new photo
  // must not throw away a crop the member is halfway through framing.
  const photoId = photo?.id;
  useEffect(() => {
    if (!photo) return;
    setWorking({ uri: photo.uri, width: photo.width, height: photo.height });
    setNote(photo.note ?? '');
    setAspect(null);
    setAspectKey('original');
    setTouched(false);
    resetView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoId]);

  const frame = useMemo(
    () => frameForAspect(bounds, aspect, working),
    [bounds, aspect, working],
  );

  /** Size the image renders at before the member's own zoom. */
  const base = useMemo(() => {
    const cover = coverScale(working, frame);
    return { width: working.width * cover, height: working.height * cover };
  }, [working, frame]);

  const commitView = useCallback((s: number, x: number, y: number) => {
    setView({ scale: s, translateX: x, translateY: y });
    setTouched(true);
  }, []);

  /**
   * Bounds are captured as plain numbers rather than calling into
   * `photoCrop.ts` — a worklet cannot reach an imported function that is not
   * itself a worklet, and duplicating four lines of arithmetic beats marking a
   * pure module as UI-thread code.
   */
  const baseW = base.width;
  const baseH = base.height;
  const frameW = frame.width;
  const frameH = frame.height;

  const pinch = Gesture.Pinch()
    .onUpdate(event => {
      'worklet';
      const next = Math.min(
        MAX_CROP_ZOOM,
        Math.max(1, savedScale.value * event.scale),
      );
      scale.value = next;
      const maxX = Math.max(0, (baseW * next - frameW) / 2);
      const maxY = Math.max(0, (baseH * next - frameH) / 2);
      translateX.value = Math.min(maxX, Math.max(-maxX, translateX.value));
      translateY.value = Math.min(maxY, Math.max(-maxY, translateY.value));
    })
    .onEnd(() => {
      'worklet';
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(commitView)(scale.value, translateX.value, translateY.value);
    });

  const pan = Gesture.Pan()
    .onUpdate(event => {
      'worklet';
      const maxX = Math.max(0, (baseW * scale.value - frameW) / 2);
      const maxY = Math.max(0, (baseH * scale.value - frameH) / 2);
      translateX.value = Math.min(
        maxX,
        Math.max(-maxX, savedTranslateX.value + event.translationX),
      );
      translateY.value = Math.min(
        maxY,
        Math.max(-maxY, savedTranslateY.value + event.translationY),
      );
    })
    .onEnd(() => {
      'worklet';
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(commitView)(scale.value, translateX.value, translateY.value);
    });

  /** Double tap zooms back out — the way out of a zoom that went too far. */
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      'worklet';
      scale.value = withTiming(1, { duration: 180 });
      savedScale.value = 1;
      translateX.value = withTiming(0, { duration: 180 });
      translateY.value = withTiming(0, { duration: 180 });
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
      runOnJS(commitView)(1, 0, 0);
    });

  const gesture = Gesture.Simultaneous(Gesture.Race(doubleTap, pan), pinch);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  /**
   * Run one transform against the current bytes and adopt the result.
   *
   * The view resets because the dimensions it was clamped against no longer
   * exist — a rotate swaps width and height, and a pan that was legal before it
   * would leave a corner of the frame empty after.
   */
  const applyTransform = async (
    build: (ctx: ReturnType<typeof ImageManipulator.manipulate>) => unknown,
    label: string,
  ) => {
    if (busy || !working.uri) return;
    setBusy(true);
    try {
      const ctx = ImageManipulator.manipulate(working.uri);
      build(ctx);
      const rendered = await ctx.renderAsync();
      const saved = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: EDIT_JPEG_QUALITY,
      });
      setWorking({
        uri: saved.uri,
        width: rendered.width,
        height: rendered.height,
      });
      setTouched(true);
      resetView();
    } catch (err) {
      if (__DEV__) console.warn(`[smart-project] photo ${label} failed`, err);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (busy || !photo) return;
    const rect = cropRect(working, frame, view);
    const trimmed = note.trim().slice(0, NOTE_MAX_CHARS);

    // A member who opened the editor to add a note and touched nothing else
    // pays for no re-encode at all: `isFullFrameCrop` is what keeps a
    // full-frame "crop" from costing a needless generation of JPEG loss.
    if (isFullFrameCrop(working, rect)) {
      onSave({
        uri: working.uri,
        width: working.width,
        height: working.height,
        note: trimmed || undefined,
      });
      return;
    }

    setBusy(true);
    try {
      const rendered = await ImageManipulator.manipulate(working.uri)
        .crop(rect)
        .renderAsync();
      const saved = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: EDIT_JPEG_QUALITY,
      });
      onSave({
        uri: saved.uri,
        width: rendered.width,
        height: rendered.height,
        note: trimmed || undefined,
      });
    } catch (err) {
      if (__DEV__) console.warn('[smart-project] photo crop failed', err);
      // Keep the note, lose the crop. The alternative is discarding both over a
      // manipulator error the member can do nothing about.
      onSave({
        uri: working.uri,
        width: working.width,
        height: working.height,
        note: trimmed || undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRevert = () => {
    if (!photo) return;
    setWorking({ uri: photo.uri, width: photo.width, height: photo.height });
    setAspect(null);
    setAspectKey('original');
    setTouched(false);
    resetView();
  };

  const tools: Array<{ icon: string; label: string; onPress: () => void }> = [
    {
      icon: 'return-up-back-outline',
      label: 'Rotate left',
      onPress: () => applyTransform(ctx => ctx.rotate(-90), 'rotate'),
    },
    {
      icon: 'return-up-forward-outline',
      label: 'Rotate right',
      onPress: () => applyTransform(ctx => ctx.rotate(90), 'rotate'),
    },
    {
      icon: 'swap-horizontal-outline',
      label: 'Flip horizontally',
      onPress: () => applyTransform(ctx => ctx.flip('horizontal'), 'flip'),
    },
    {
      icon: 'swap-vertical-outline',
      label: 'Flip vertically',
      onPress: () => applyTransform(ctx => ctx.flip('vertical'), 'flip'),
    },
    { icon: 'refresh-outline', label: 'Undo my edits', onPress: handleRevert },
  ];

  return (
    <Modal
      visible={!!photo}
      animationType="slide"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      {/* Gestures inside an RN Modal live in a separate native hierarchy, so the
          root view at the app level does not reach them. */}
      {/* No `KeyboardAvoidingView` here. It only SHRINKS the viewport — the note
          field kept its position and ended up behind the keypad anyway, with
          nothing scrolling it back. The scroller's
          `automaticallyAdjustKeyboardInsets` (in `keyboardDismissScrollProps`)
          is the half that actually reveals the focused field, and a KAV around
          it cancels that by making the overlap zero. See `@utils/keyboard`. */}
      <GestureHandlerRootView style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Pressable
            onPress={onCancel}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Discard changes to this photo"
            testID="smart-photo-editor-cancel"
          >
            <Text style={styles.headerAction}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>
            Photo {index + 1} of {total}
          </Text>
          <Pressable
            onPress={handleSave}
            disabled={busy}
            hitSlop={10}
            accessibilityRole="button"
            testID="smart-photo-editor-save"
          >
            <Text
              style={[
                styles.headerAction,
                styles.headerSave,
                busy && styles.headerDisabled,
              ]}
            >
              Done
            </Text>
          </Pressable>
        </View>

        <ScrollView
          {...keyboardDismissScrollProps}
          contentContainerStyle={styles.body}
        >
          <View
            style={styles.canvas}
            onLayout={e =>
              setBounds({
                width: e.nativeEvent.layout.width,
                height: e.nativeEvent.layout.height,
              })
            }
          >
            {frame.width > 0 && working.uri ? (
              <GestureDetector gesture={gesture}>
                <View
                  style={[
                    styles.frame,
                    { width: frame.width, height: frame.height },
                  ]}
                  testID="smart-photo-editor-frame"
                >
                  <Animated.View style={imageStyle}>
                    <Image
                      source={{ uri: working.uri }}
                      style={{ width: base.width, height: base.height }}
                      resizeMode="cover"
                    />
                  </Animated.View>

                  {/* Rule of thirds, only while the frame is being used. It is
                      a composition aid, and left on permanently it reads as
                      chrome the member cannot turn off. */}
                  <View style={styles.gridOverlay} pointerEvents="none">
                    <View style={[styles.gridLine, styles.gridV, { left: '33.33%' }]} />
                    <View style={[styles.gridLine, styles.gridV, { left: '66.66%' }]} />
                    <View style={[styles.gridLine, styles.gridH, { top: '33.33%' }]} />
                    <View style={[styles.gridLine, styles.gridH, { top: '66.66%' }]} />
                  </View>
                  <View style={styles.corners} pointerEvents="none">
                    <View style={[styles.corner, styles.cornerTL]} />
                    <View style={[styles.corner, styles.cornerTR]} />
                    <View style={[styles.corner, styles.cornerBL]} />
                    <View style={[styles.corner, styles.cornerBR]} />
                  </View>
                </View>
              </GestureDetector>
            ) : (
              <ActivityIndicator color="#fff" />
            )}

            {busy && (
              <View style={styles.busy} pointerEvents="none">
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </View>

          <Text style={styles.hint}>
            {touched
              ? 'Pinch to zoom · drag to choose what is inside the frame'
              : 'Pinch to zoom · drag to frame · double-tap to fit'}
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.aspectRow}
          >
            {CROP_ASPECTS.map(option => {
              const active = option.key === aspectKey;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => {
                    setAspectKey(option.key);
                    setAspect(option.ratio);
                    // The old pan was clamped against the old frame; keeping
                    // it would leave a band of empty canvas down one side.
                    resetView();
                    if (option.ratio !== null) setTouched(true);
                  }}
                  style={[styles.aspectChip, active && styles.aspectChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  testID={`smart-photo-aspect-${option.key}`}
                >
                  <Text
                    style={[
                      styles.aspectLabel,
                      active && styles.aspectLabelActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.toolRow}>
            {tools.map(tool => (
              <Pressable
                key={tool.label}
                onPress={tool.onPress}
                disabled={busy}
                style={styles.tool}
                accessibilityRole="button"
                accessibilityLabel={tool.label}
                testID={`smart-photo-tool-${tool.icon}`}
              >
                <Icon name={tool.icon} size={22} color="#fff" />
              </Pressable>
            ))}
          </View>

          {/* The note. This is the part that is not an image editor: it is
              how the member tells the planner which of the eleven things in
              frame they meant. See `composeSmartDraftDescription`. */}
          <View style={styles.noteBlock}>
            <View style={styles.noteHeader}>
              <Icon name="sparkles-outline" size={15} color={colors.primary} />
              <Text style={[styles.noteTitle, { color: colors.primary }]}>
                Tell the planner what to look at
              </Text>
            </View>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={t => setNote(t.slice(0, NOTE_MAX_CHARS))}
              placeholder="e.g. damp patch under the window, bare studs on this wall"
              placeholderTextColor="rgba(255,255,255,0.4)"
              multiline
              maxLength={NOTE_MAX_CHARS}
              accessibilityLabel="What to look at in this photo"
              testID="smart-photo-note"
            />
            <Text style={styles.noteHelp}>
              Optional. It is read alongside the photo, so it is the fastest
              way to stop a plan describing the wrong wall.
            </Text>
          </View>

          <Pressable
            onPress={onDelete}
            style={styles.remove}
            accessibilityRole="button"
            testID="smart-photo-editor-remove"
          >
            <Icon name="trash-outline" size={16} color="#ff6b6b" />
            <Text style={styles.removeText}>Remove this photo</Text>
          </Pressable>
        </ScrollView>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * Deliberately NOT themed.
 *
 * Every photo editor a member has used is dark, and for a reason that is not
 * fashion: a light chrome around a photograph shifts how its exposure and
 * colour read, and this is a screen where the member is judging exactly that.
 * The one themed element is the note block's accent, which ties it back to the
 * app.
 */
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d0d0f' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  headerAction: { color: 'rgba(255,255,255,0.75)', fontSize: 16 },
  headerSave: { color: '#fff', fontWeight: '700' },
  headerDisabled: { opacity: 0.4 },
  body: { paddingBottom: 32 },
  canvas: {
    height: 380,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  frame: { overflow: 'hidden', borderRadius: 6, backgroundColor: '#000' },
  gridOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.28)' },
  gridV: { top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridH: { left: 0, right: 0, height: StyleSheet.hairlineWidth },
  corners: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  corner: { position: 'absolute', width: 20, height: 20, borderColor: '#fff' },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  busy: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  hint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
  aspectRow: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  aspectChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  aspectChipActive: { backgroundColor: '#fff' },
  aspectLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
  aspectLabelActive: { color: '#111' },
  toolRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  tool: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  noteBlock: { paddingHorizontal: 16, marginTop: 24 },
  noteHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteTitle: { fontSize: 13, fontWeight: '700' },
  noteInput: {
    marginTop: 8,
    minHeight: 72,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: '#fff',
    padding: 12,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  noteHelp: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 6,
  },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
    paddingVertical: 12,
  },
  removeText: { color: '#ff6b6b', fontSize: 14, fontWeight: '600' },
});
