import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { HouseBlobImage } from '@components/house-v2';
import { Typography } from '@components/ui';
import type { HouseBlobDescriptor } from '@features/house/local/blobs';
import { useAppColors } from '@theme';
import { initialsOf } from '@utils/neighbourGeo';

/**
 * A face, or the initials standing in for one.
 *
 * Used at four sizes across this feature — inside a map bubble, in the avatar
 * stack on a card, beside a person row, and as the header on a detail screen —
 * which is why the size is a number rather than a `'sm' | 'md'` union: the map
 * bubble's inner circle is derived from the bubble's own geometry and is not one
 * of three blessed values.
 *
 * ## Why this is not `<Avatar>`
 *
 * `@components/ui/Avatar` takes a `user` — a household member with a `photo_url`
 * on a server the app can fetch from. A neighbour's photo is an H6 blob: sealed
 * with the household key, addressed by descriptor rather than URL, and fetched
 * through a lazy, cache-aware, cellular-aware component. Passing one to `Avatar`
 * would mean minting a URL that does not exist.
 *
 * ## The initials fallback is the common case, not the error case
 *
 * Most neighbours will never have a photo, because taking one requires either
 * asking them or photographing their house. So the fallback is designed rather
 * than tolerated: a stable per-name colour from the palette, so the same family
 * is the same colour on every screen and a member can recognise the stack of
 * avatars on a card before reading a single letter.
 */

/** Deterministic tint per name — the same person is the same colour everywhere. */
const AVATAR_TINTS = [
  '#4CAF50',
  '#2196F3',
  '#7E57C2',
  '#FF9800',
  '#00BCD4',
  '#EC407A',
  '#8D6E63',
  '#5C6BC0',
] as const;

export function avatarTintFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    // Cheap, stable, and — unlike `name.length % n` — actually varies between
    // two names of the same length, which on one street is most of them.
    hash = (hash * 31 + name.charCodeAt(index)) % 100_000;
  }
  return AVATAR_TINTS[hash % AVATAR_TINTS.length]!;
}

export type NeighbourAvatarProps = {
  name: string;
  photo?: HouseBlobDescriptor | null;
  size?: number;
  householdId?: string;
  /** Ring around the circle — used on the map, where pins sit on photography. */
  ringColor?: string;
  ringWidth?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function NeighbourAvatar({
  name,
  photo,
  size = 40,
  householdId,
  ringColor,
  ringWidth = 0,
  style,
  testID,
}: NeighbourAvatarProps) {
  const colors = useAppColors();
  const tint = avatarTintFor(name);
  const frame: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: ringWidth,
    borderColor: ringColor ?? 'transparent',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tint,
  };

  if (photo) {
    return (
      <View style={[frame, style]} testID={testID}>
        <HouseBlobImage
          descriptor={photo}
          householdId={householdId}
          // `auto` — the plan's default. A screen of neighbour photos on
          // cellular would otherwise spend the member's data allowance without
          // being asked; the component renders its own "tap to load" instead.
          fetchPolicy="auto"
          width={size}
          height={size}
          accessibilityLabel={`Photo of ${name}`}
          testID={testID ? `${testID}-photo` : undefined}
        />
      </View>
    );
  }

  return (
    <View style={[frame, style]} testID={testID}>
      <Typography
        variant={size >= 56 ? 'title3' : size >= 36 ? 'subheadline' : 'caption2'}
        weight="semibold"
        style={{ color: colors.white }}
      >
        {initialsOf(name)}
      </Typography>
    </View>
  );
}
