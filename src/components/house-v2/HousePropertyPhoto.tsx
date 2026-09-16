/**
 * A property's photo, from whichever of the three places it actually lives.
 *
 * A home photo can reach a screen by three routes, and before this component
 * only one of them rendered:
 *
 *   **a signed URL** (`photo_url`) — a server-backed household. The Worker
 *   derives it from `photo_key` on read.
 *   **an H6 descriptor** (`photo_blob`) — a local-first home. There is no URL
 *   and there cannot be one: the bytes are AES-GCM sealed in R2 and only
 *   `resolveHouseBlobUri` can open them, which is what `HouseBlobImage` does.
 *   **a local file** — a picture the member has just chosen and not saved yet.
 *
 * The order below is the priority, and it is not arbitrary. A freshly picked
 * file wins because it is what the member is looking at right now and has not
 * saved. The descriptor beats the URL because on a local-first property the URL
 * is a leftover: `photo_url` is signed from `photo_key`, and under H6 that key
 * is the synthetic `lf-blob/<blobId>` form, so any URL derived from it points at
 * an object the Worker never wrote. Falling back to it would render a broken
 * image over a photo that is present and openable.
 *
 * Renders the fallback icon when there is nothing at all, so callers place it
 * unconditionally.
 */
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Household } from '@api/households';
import { Icon } from '@components/ui';
import { useAppColors } from '@theme';

import { HouseBlobImage, type HouseBlobFetchPolicy } from './HouseBlobImage';

export type HousePropertyPhotoProps = {
  /** The property, or undefined while a form is creating one. */
  household?: Pick<Household, 'id' | 'photo_url' | 'photo_blob'> | null;
  /**
   * A file the member just picked and has not saved. Wins over everything —
   * it is the only one of the three they are actively looking at.
   */
  pickedUri?: string | null;
  /**
   * The box to fill. A number is a square; the card uses 64, the edit sheet's
   * banner passes its own width and height.
   *
   * `HouseBlobImage` needs real numbers — it lays its four error states out
   * against them — so a caller that wants a percentage width must measure and
   * pass the result rather than handing a string through.
   */
  width: number;
  height?: number;
  borderRadius?: number;
  /** Fallback glyph size. Defaults to 40% of the smaller side. */
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
  /**
   * Passed to `HouseBlobImage`. A card in a list stays on the plan's metered
   * default; a large preview the member opened deliberately can be 'always'.
   */
  fetchPolicy?: HouseBlobFetchPolicy;
  testID?: string;
};

export function HousePropertyPhoto({
  household,
  pickedUri,
  width,
  height,
  borderRadius,
  iconSize,
  style,
  fetchPolicy = 'auto',
  testID,
}: HousePropertyPhotoProps) {
  const colors = useAppColors();
  const boxHeight = height ?? width;
  const radius = borderRadius ?? Math.min(width, boxHeight) / 8;
  const frame: StyleProp<ViewStyle> = [
    styles.frame,
    {
      width,
      height: boxHeight,
      borderRadius: radius,
      backgroundColor: colors.groupedListBackground,
    },
    style,
  ];

  if (pickedUri) {
    return (
      <View style={frame} testID={testID}>
        <Image source={{ uri: pickedUri }} style={[styles.image, { borderRadius: radius }]} />
      </View>
    );
  }

  if (household?.photo_blob) {
    return (
      <View style={frame} testID={testID}>
        {/* The rounding is on the frame's `overflow: hidden`, not passed down:
            `HouseBlobImage` owns its own corner radius and its four error
            states are laid out against it. */}
        <HouseBlobImage
          descriptor={household.photo_blob}
          householdId={household.id}
          fetchPolicy={fetchPolicy}
          width={width}
          height={boxHeight}
          accessibilityLabel="Home photo"
          testID={testID ? `${testID}-blob` : undefined}
        />
      </View>
    );
  }

  if (household?.photo_url) {
    return (
      <View style={frame} testID={testID}>
        <Image
          source={{ uri: household.photo_url }}
          style={[styles.image, { borderRadius: radius }]}
        />
      </View>
    );
  }

  return (
    <View style={frame} testID={testID}>
      <Icon
        name="home"
        size={iconSize ?? Math.round(Math.min(width, boxHeight) * 0.4)}
        color={colors.textSecondary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
});
