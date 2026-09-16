import React, { useMemo } from 'react';
import { View, Image, StyleSheet } from 'react-native';

import { Typography } from '@components/ui';
import { useAppColors } from '@theme';
import type { AppColors } from '@theme';

interface SpaceIconProps {
  emoji?: string | null;
  imageUrl?: string | null;
  backgroundColor?: string;
  size?: 'small' | 'medium' | 'large';
  badge?: {
    count?: number;
    color?: string;
  };
}

const SIZES = {
  small: { outer: 40, inner: 28, emoji: 20, badge: 16 },
  medium: { outer: 56, inner: 40, emoji: 28, badge: 20 },
  large: { outer: 80, inner: 60, emoji: 40, badge: 24 },
};

export function SpaceIcon({
  emoji,
  imageUrl,
  backgroundColor = '#F5F5F5',
  size = 'medium',
  badge,
}: SpaceIconProps) {  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const sizes = SIZES[size];

  return (
    <View
      style={[
        styles.container,
        {
          width: sizes.outer,
          height: sizes.outer,
          backgroundColor: backgroundColor,
        },
      ]}
    >
      <View
        style={[
          styles.inner,
          {
            width: sizes.inner,
            height: sizes.inner,
            backgroundColor: colors.backgroundSecondary,
          },
        ]}
      >
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <Typography variant="body" style={{ fontSize: sizes.emoji }}>
            {emoji || '📦'}
          </Typography>
        )}
      </View>

      {badge && badge.count !== undefined && badge.count > 0 && (
        <View
          style={[
            styles.badge,
            {
              backgroundColor: badge.color || colors.primary,
              width: sizes.badge,
              height: sizes.badge,
            },
          ]}
        >
          <Typography
            variant="caption2"
            weight="semibold"
            color={colors.white}
            style={{ fontSize: sizes.badge * 0.6 }}
          >
            {badge.count > 99 ? '99+' : badge.count}
          </Typography>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: {
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inner: {
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    image: {
      width: '100%',
      height: '100%',
    },
    badge: {
      position: 'absolute',
      top: -4,
      right: -4,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.white,
    },
  });
