/**
 * Symply Life (brand `symply-kaizen`) — Avatar (feature-local port).
 *
 * The donor ProfileScreen relied on an Avatar with a numeric diameter plus `loading` and
 * `showEditBadge` affordances — a prop surface the shared `@components/ui` Avatar does not
 * expose. This is a faithful port of the donor component, sourcing the deterministic initials
 * backgrounds from the ecosystem theme (`AVATAR_HASH_BACKGROUNDS`) rather than forking colors.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import {AVATAR_HASH_BACKGROUNDS, useAppColors } from '@theme';

interface AvatarUser {
  display_name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
}

interface AvatarProps {
  user?: AvatarUser | null;
  /** Diameter in px. Default 96. */
  size?: number;
  onPress?: () => void;
  /** Show a spinner over the avatar (e.g. while uploading). */
  loading?: boolean;
  /** Show a camera badge overlay to signal the avatar is editable. */
  showEditBadge?: boolean;
  accessibilityLabel?: string;
}

/** Dark ink for initials drawn over pale hash backgrounds. */
const DARK_INK = '#1C1C1E';

/** WCAG relative luminance → pick readable ink over a given background. */
function readableInkFor(background: string): string {
  const hex = background.replace('#', '');
  if (hex.length !== 6) return '#FFFFFF';
  const channel = (start: number) => {
    const c = parseInt(hex.slice(start, start + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.6 ? DARK_INK : '#FFFFFF';
}

function getInitials(user?: AvatarUser | null): string {
  if (!user) return '?';
  const name = user.display_name?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  if (user.email) return user.email.slice(0, 2).toUpperCase();
  return '?';
}

function hashBackground(user?: AvatarUser | null): string {
  const source = user?.display_name || user?.email || '';
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = source.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_HASH_BACKGROUNDS[Math.abs(hash) % AVATAR_HASH_BACKGROUNDS.length];
}

export function Avatar({
  user,
  size = 96,
  onPress,
  loading = false,
  showEditBadge = false,
  accessibilityLabel,
}: AvatarProps) {
  const colors = useAppColors();  const [imageError, setImageError] = useState(false);

  const hasImage = Boolean(user?.avatar_url) && !imageError;
  const background = hashBackground(user);
  const badgeSize = Math.max(24, Math.round(size * 0.3));

  const body = (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: hasImage ? colors.backgroundSecondary : background,
            borderColor: colors.borderColor,
          },
        ]}
      >
        {hasImage ? (
          <Image
            source={{ uri: user!.avatar_url! }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            onError={() => setImageError(true)}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text
            style={{
              color: readableInkFor(background),
              fontSize: Math.round(size * 0.4),
              fontWeight: '700',
            }}
          >
            {getInitials(user)}
          </Text>
        )}

        {loading ? (
          <View style={[styles.overlay, { borderRadius: size / 2 }]}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : null}
      </View>

      {showEditBadge && !loading ? (
        <View
          style={[
            styles.badge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              backgroundColor: colors.primary,
              borderColor: colors.backgroundMain,
            },
          ]}
        >
          <Ionicons name="camera" size={Math.round(badgeSize * 0.55)} color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? 'Change profile photo'}
      hitSlop={8}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  circle: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  badge: {
    alignItems: 'center',
    borderWidth: 2,
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
  },
});
