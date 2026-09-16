import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';

import {
  AVATAR_HASH_BACKGROUNDS,
  Avatar as AvatarTokens,
  EmptyState,
  TypographyTokens,
  useAppColors,
} from '@theme';

import { Typography as Typo } from './Typography';

interface AvatarProps {
  user?: {
    display_name?: string | null;
    avatar_url?: string | null;
    email?: string;
  };
  /** Named ramp step, or an explicit pixel diameter (e.g. header controls). */
  size?: 'sm' | 'md' | 'lg' | number;
  onPress?: () => void;
  badge?: React.ReactNode;
  /** Optional ring around the avatar (e.g. the header profile control). */
  borderColor?: string;
  /** Ring width in points; defaults to 1 when `borderColor` is set. */
  borderWidth?: number;
}

const SIZES = {
  sm: AvatarTokens.inlineSize,
  md: AvatarTokens.memberListSize,
  lg: EmptyState.iconSize,
} as const;

const FONT_SIZES = {
  sm: TypographyTokens.bodySmallSemibold.size,
  md: TypographyTokens.bodyLarge.size,
  lg: TypographyTokens.title.size,
} as const;

// Initials are drawn over a hash-picked background that ranges from dark teal to
// pale mint/lavender. Pure-white text vanishes on the light ones, so pick the
// foreground from the background's perceived luminance (WCAG relative luminance).
const DARK_INK = '#1C1C1E';

function readableInkFor(background: string): string {
  const hex = background.replace('#', '');
  if (hex.length !== 6) return '#FFFFFF';
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.6 ? DARK_INK : '#FFFFFF';
}

export function Avatar({ user, size = 'md', onPress, badge, borderColor, borderWidth }: AvatarProps) {  const colors = useAppColors();
  const avatarSize = typeof size === 'number' ? size : SIZES[size];
  // Scale initials to ~40% of the diameter for numeric sizes (matches the
  // named ramp's proportions).
  const fontSize = typeof size === 'number' ? Math.round(size * 0.4) : FONT_SIZES[size];
  // WHICH url failed, not merely THAT one did. A plain boolean latched for the
  // lifetime of the component, so a member whose avatar 404'd once — a stale
  // url out of a persisted roster, and every upload mints a new filename — kept
  // rendering initials even after they set a new picture and it synced. Keying
  // the failure to the url makes the recovery automatic: a new url has not
  // failed yet.
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);

  const avatarUri =
    user?.avatar_url && failedAvatarUrl !== user.avatar_url ? user.avatar_url : null;
  const hasValidAvatar = avatarUri !== null;

  const getInitials = () => {
    if (!user) return '?';

    if (user.display_name) {
      const names = user.display_name.trim().split(' ');
      if (names.length >= 2) {
        return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase();
      }
      return user.display_name.substring(0, 2).toUpperCase();
    }

    if (user.email) {
      return user.email.substring(0, 2).toUpperCase();
    }

    return '?';
  };

  const getBackgroundColor = () => {
    if (!user) return colors.groupedListBackground;

    const str = user.display_name || user.email || '';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    return AVATAR_HASH_BACKGROUNDS[Math.abs(hash) % AVATAR_HASH_BACKGROUNDS.length];
  };

  const backgroundColor = getBackgroundColor();

  const content = (
    <View
      style={[
        styles.container,
        {
          width: avatarSize,
          height: avatarSize,
          borderRadius: avatarSize / 2,
          backgroundColor: hasValidAvatar ? 'transparent' : backgroundColor,
          ...(borderColor ? { borderColor, borderWidth: borderWidth ?? 1 } : null),
        },
      ]}
    >
      {avatarUri !== null ? (
        <Image
          source={{ uri: avatarUri }}
          style={[
            styles.image,
            {
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarSize / 2,
            },
          ]}
          onError={() => setFailedAvatarUrl(avatarUri)}
        />
      ) : (
        <Typo variant="body" weight="semibold" color={readableInkFor(backgroundColor)} style={{ fontSize }}>
          {getInitials()}
        </Typo>
      )}

      {badge && (
        <View
          style={[
            styles.badge,
            {
              width: avatarSize * 0.3,
              height: avatarSize * 0.3,
              borderRadius: avatarSize * 0.15,
              borderWidth: AvatarTokens.borderWidth,
              borderColor: colors.backgroundMain,
              backgroundColor: colors.success,
            },
          ]}
        >
          {badge}
        </View>
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    resizeMode: 'cover',
  },
  badge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
