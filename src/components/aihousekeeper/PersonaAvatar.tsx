/**
 * Renders a Aihousekeeper persona avatar in a circle. Falls back to the persona's
 * `fallbackEmoji` when no PNG is available, so the app runs before the
 * artwork PNGs are dropped into src/assets/aihousekeeper/personas/.
 */

import React from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { PersonaMeta } from '@assets/aihousekeeper/personas';
import { Typography } from '@components/ui';
import { useAppColors } from '@theme';

interface PersonaAvatarProps {
  persona: PersonaMeta;
  size: number;
  style?: StyleProp<ViewStyle>;
  backgroundColor?: string;
}

export function PersonaAvatar({
  persona,
  size,
  style,
  backgroundColor: backgroundColorProp,
}: PersonaAvatarProps) {
  const colors = useAppColors();
  const backgroundColor =
    backgroundColorProp ?? colors.personaVideoPlaceholder;
  const radius = size / 2;
  const containerStyle: StyleProp<ViewStyle> = [
    styles.base,
    {
      width: size,
      height: size,
      borderRadius: radius,
      backgroundColor,
    },
    style,
  ];

  return (
    <View
      style={containerStyle}
      accessibilityLabel={`${persona.displayName} avatar`}
    >
      {persona.image ? (
        <Image
          source={persona.image}
          style={{ width: size, height: size }}
          resizeMode="cover"
        />
      ) : (
        <Typography
          variant="title1"
          style={{ fontSize: Math.round(size * 0.55), lineHeight: size }}
        >
          {persona.fallbackEmoji}
        </Typography>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});

export default PersonaAvatar;
