/**
 * Full-screen viewer for House photo attachments.
 *
 * ## Why this exists
 *
 * A project's photos were a LIST and nothing more: a 64pt thumbnail, a filename
 * and a tag line. A member could attach five renovation photos and never look
 * at one of them at a size that shows anything — which is most of the point of
 * attaching a photo of a stud bay, a damp patch or a finished wall. The list
 * answers "is it there"; this answers "what does it show".
 *
 * ## It has to serve BOTH byte channels
 *
 * The two backends address photo bytes differently and neither can render the
 * other's. A server-backed attachment carries a URL an `<Image>` can point at;
 * a local-first attachment carries a sealed-blob descriptor that only
 * `resolveHouseBlobUri` can open, after fetching every chunk, decrypting it and
 * checking the file hash. So a viewer that took a `uri[]` would silently be a
 * viewer for half the households we ship to — the item type below is the union,
 * and each page picks its renderer from which field is present.
 *
 * Blob pages are opened with `fetchPolicy="always"`: the download-on-cellular
 * question (plan §8) is asked by the THUMBNAIL, on a screen the member merely
 * scrolled past. Once they have tapped a specific photo to look at it, asking
 * again is asking someone to confirm the thing they just chose.
 *
 * ## Zoom, and why the pager yields to it
 *
 * `contain` fits the whole photo on screen, which is right for orientation and
 * useless for detail — the crack, the label on the pipe, the finish on a joint.
 * Pinch, pan and double-tap follow `SmartProjectPhotoEditor`'s composition
 * exactly (`Simultaneous(Race(doubleTap, pan), pinch)`), so there is one gesture
 * idiom for photos in this app rather than two.
 *
 * The one thing the editor does not have to solve is that this lives inside a
 * horizontal pager. A one-finger drag is BOTH "pan the zoomed photo" and "go to
 * the next photo", so the two are separated by state rather than by feel: pan is
 * enabled only while zoomed, and while zoomed the pager stops scrolling. A page
 * that scrolls out of view resets, so swiping back never lands on a photo left
 * magnified into a corner from a previous visit.
 */
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
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

import { Icon, Typography } from '@components/ui';
import type { HouseBlobDescriptor } from '@features/house/local/blobs';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

import { HouseBlobImage } from './HouseBlobImage';

/** How far a photo may be magnified. Past this, JPEG artefacts are the subject. */
const MAX_ZOOM = 4;
/** Where a double tap lands — enough to read a label, still recognisably the photo. */
const DOUBLE_TAP_ZOOM = 2.5;
/** Float noise makes `=== 1` a lie after a pinch that ended back at the bottom. */
const ZOOM_EPSILON = 0.01;

export type HousePhotoViewerItem = {
  id: string;
  /** Local-first bytes. Takes precedence over `url` when both are present. */
  blob?: HouseBlobDescriptor | null;
  /** Server-backed bytes. */
  url?: string | null;
  /** Filename or caption, shown under the photo. */
  title?: string | null;
  /** Second caption line — tags, dates, whatever names the photo. */
  subtitle?: string | null;
};

export type HousePhotoViewerProps = {
  photos: readonly HousePhotoViewerItem[];
  /** Index of the photo to open. `null` keeps the viewer closed. */
  index: number | null;
  onClose: () => void;
  /** Fires when the member swipes to another photo. */
  onIndexChange?: (index: number) => void;
  householdId?: string;
  /** Prefix for this instance's testIDs — defaults to `house-photo-viewer`. */
  testID?: string;
};

type PageProps = {
  photo: HousePhotoViewerItem;
  width: number;
  height: number;
  householdId?: string;
  /** The page the member is actually looking at. Inactive pages give up zoom. */
  active: boolean;
  onZoomChange: (zoomed: boolean) => void;
  accessibilityLabel: string;
  testID: string;
};

function HousePhotoViewerPage({
  photo,
  width,
  height,
  householdId,
  active,
  onZoomChange,
  accessibilityLabel,
  testID,
}: PageProps) {
  const colors = useAppColors();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  const applyZoom = useCallback(
    (next: boolean) => {
      setZoomed(next);
      onZoomChange(next);
    },
    [onZoomChange],
  );

  const reset = useCallback(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    applyZoom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyZoom]);

  useEffect(() => {
    if (!active) reset();
  }, [active, reset]);

  /*
    The clamp is written out in each handler rather than shared, exactly as in
    `SmartProjectPhotoEditor`: everything a worklet touches has to be a worklet
    too, and four lines of arithmetic are cheaper than that contract.

    It bounds against the PAGE box, not the rendered photo. Under `contain` a
    photo narrower than the screen has letterbox either side, so this allows a
    little dead space to be dragged into view at high zoom — the alternative is
    measuring the laid-out image on every page, for a bound that is invisible in
    the direction that actually matters (the long edge, which fills).
  */
  const pinch = Gesture.Pinch()
    .onUpdate(event => {
      'worklet';
      const next = Math.min(MAX_ZOOM, Math.max(1, savedScale.value * event.scale));
      scale.value = next;
      const maxX = Math.max(0, (width * next - width) / 2);
      const maxY = Math.max(0, (height * next - height) / 2);
      translateX.value = Math.min(maxX, Math.max(-maxX, translateX.value));
      translateY.value = Math.min(maxY, Math.max(-maxY, translateY.value));
    })
    .onEnd(() => {
      'worklet';
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(applyZoom)(scale.value > 1 + ZOOM_EPSILON);
    });

  // Only while zoomed: unzoomed, a one-finger drag belongs to the pager.
  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate(event => {
      'worklet';
      const maxX = Math.max(0, (width * scale.value - width) / 2);
      const maxY = Math.max(0, (height * scale.value - height) / 2);
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
    });

  /** Double tap zooms in, and — from any zoom — is the one-gesture way back out. */
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      'worklet';
      const zoomIn = scale.value <= 1 + ZOOM_EPSILON;
      const next = zoomIn ? DOUBLE_TAP_ZOOM : 1;
      scale.value = withTiming(next, { duration: 180 });
      savedScale.value = next;
      translateX.value = withTiming(0, { duration: 180 });
      translateY.value = withTiming(0, { duration: 180 });
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
      runOnJS(applyZoom)(zoomIn);
    });

  const gesture = Gesture.Simultaneous(Gesture.Race(doubleTap, pan), pinch);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.page, { width, height }, imageStyle]} testID={testID}>
        {photo.blob ? (
          <HouseBlobImage
            descriptor={photo.blob}
            householdId={householdId}
            fetchPolicy="always"
            width={width}
            height={height}
            contentFit="contain"
            style={styles.squareCorners}
            accessibilityLabel={accessibilityLabel}
            testID={`${testID}-blob`}
          />
        ) : photo.url ? (
          <Image
            source={{ uri: photo.url }}
            style={{ width, height }}
            contentFit="contain"
            accessible
            accessibilityLabel={accessibilityLabel}
            testID={`${testID}-remote`}
          />
        ) : (
          /*
            An attachment row with neither channel is a broken record, not an
            empty screen — say so rather than showing black and letting the
            member decide whether the viewer failed or the photo is blank.
          */
          <View style={styles.missing} testID={`${testID}-missing`}>
            <Icon name="image-outline" size={IconSize.xl} color={colors.white} />
            <Typography variant="caption" color={colors.white} align="center">
              This photo is not available on this device.
            </Typography>
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

export function HousePhotoViewer({
  photos,
  index,
  onClose,
  onIndexChange,
  householdId,
  testID = 'house-photo-viewer',
}: HousePhotoViewerProps) {
  const colors = useAppColors();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const positioned = useRef(false);

  const open = index !== null && photos.length > 0;
  const start = open ? Math.min(Math.max(index ?? 0, 0), photos.length - 1) : 0;
  const [current, setCurrent] = useState(start);
  const [zoomed, setZoomed] = useState(false);

  // Opening is what resets the pager, not every render: `start` follows the
  // caller's state, which a wired `onIndexChange` keeps equal to `current`.
  useEffect(() => {
    if (!open) {
      positioned.current = false;
      setZoomed(false);
      return;
    }
    setCurrent(start);
  }, [open, start]);

  /*
    The pager cannot be scrolled before it has laid out its pages, so opening on
    photo 4 of 5 is done on the first content-size callback rather than in an
    effect — an effect fires while `contentSize` is still zero and the scroll is
    silently dropped, leaving every member on photo 1 whatever they tapped.
  */
  const handleContentSizeChange = useCallback(() => {
    if (positioned.current) return;
    positioned.current = true;
    scrollRef.current?.scrollTo({ x: start * width, animated: false });
  }, [start, width]);

  // Rotation changes the page width under a pager already scrolled to a
  // multiple of the OLD one, which lands the member between two photos.
  useEffect(() => {
    if (!open || !positioned.current) return;
    scrollRef.current?.scrollTo({ x: current * width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const page = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
      const next = Math.min(Math.max(page, 0), photos.length - 1);
      if (next === current) return;
      setCurrent(next);
      onIndexChange?.(next);
    },
    [current, onIndexChange, photos.length, width],
  );

  if (!open) return null;

  const photo = photos[current];
  const caption = photo?.title?.trim() || '';
  const subtitle = photo?.subtitle?.trim() || '';

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      testID={testID}
    >
      {/*
        A `Modal` mounts its own native view tree, OUTSIDE the app's root — so
        the pinch and pan below reach no gesture handler root unless one is put
        here (the same reason `SmartProjectPhotoEditor` wraps its modal). Miss
        it and zoom silently does nothing on Android.
      */}
      <GestureHandlerRootView style={[styles.backdrop, { backgroundColor: colors.black }]}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          // Zoomed, a drag pans the photo; unzoomed with one photo, there is
          // nowhere to go and a rubber-banding screen only reads as broken.
          scrollEnabled={!zoomed && photos.length > 1}
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={handleContentSizeChange}
          onMomentumScrollEnd={handleMomentumEnd}
          testID={`${testID}-pager`}
        >
          {photos.map((p, i) => (
            <HousePhotoViewerPage
              key={p.id}
              photo={p}
              width={width}
              height={height}
              householdId={householdId}
              active={i === current}
              onZoomChange={setZoomed}
              accessibilityLabel={
                p.title?.trim()
                  ? `${p.title.trim()}, photo ${i + 1} of ${photos.length}`
                  : `Photo ${i + 1} of ${photos.length}`
              }
              testID={`${testID}-page-${i}`}
            />
          ))}
        </ScrollView>

        <View
          style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={[styles.chrome, { backgroundColor: colors.overlayDim }]}
            accessibilityRole="button"
            accessibilityLabel="Close photo viewer"
            testID={`${testID}-close`}
          >
            <Icon name="close" size={IconSize.lg} color={colors.white} />
          </Pressable>
          {photos.length > 1 ? (
            <View
              style={[styles.chrome, { backgroundColor: colors.overlayDim }]}
              testID={`${testID}-counter`}
            >
              <Typography variant="captionSmall" weight="semibold" color={colors.white}>
                {`${current + 1} of ${photos.length}`}
              </Typography>
            </View>
          ) : null}
        </View>

        {caption || subtitle ? (
          <View
            style={[
              styles.captionBar,
              {
                paddingBottom: insets.bottom + Spacing.md,
                backgroundColor: colors.overlayDim,
              },
            ]}
            pointerEvents="none"
            testID={`${testID}-caption`}
          >
            {caption ? (
              <Typography
                variant="caption"
                weight="semibold"
                color={colors.white}
                numberOfLines={2}
              >
                {caption}
              </Typography>
            ) : null}
            {subtitle ? (
              <Typography variant="captionSmall" color={colors.white} style={styles.subtitle}>
                {subtitle}
              </Typography>
            ) : null}
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  /*
    Black in BOTH themes (`colors.black` is the same constant either way, unlike
    a surface token). A photo is judged against what surrounds it, and a light
    panel around a dark renovation shot is why every photo viewer looks like
    this. The chrome sits on `overlayDim` for the same reason white-on-white
    would otherwise vanish over a bright photo.
  */
  backdrop: { flex: 1 },
  page: { alignItems: 'center', justifyContent: 'center' },
  /** Undoes `HouseBlobImage`'s thumbnail rounding — nothing to round full-bleed. */
  squareCorners: { borderRadius: 0 },
  missing: { alignItems: 'center', gap: Spacing.sm, padding: Spacing.lg },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  /** A pill behind the chrome — white-on-white is invisible over a bright photo. */
  chrome: {
    minWidth: 36,
    height: 36,
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  /** The tag line is secondary to the filename it sits under. */
  subtitle: { opacity: 0.75 },
});
