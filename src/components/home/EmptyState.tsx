import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';

import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import {Avatar, ButtonMetrics, Chat, CornerRadius, Layout, Spacing, useAppColors } from '@theme';

type IoniconName = keyof typeof Ionicons.glyphMap;

interface EmptyStateProps {
  /** Ionicon glyph name (preferred) or an emoji string (legacy). */
  icon: string;
  title: string;
  message: string;
  action?: {
    label: string;
    onPress: () => void;
  };
}

/** Treat the prop as an Ionicon when it matches a known glyph name. */
function isIoniconName(icon: string): icon is IoniconName {
  return icon in Ionicons.glyphMap;
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  const colors = useAppColors();
  return (
    <View style={styles.container}>
      {isIoniconName(icon) ? (
        <Icon
          name={icon}
          size={Avatar.memberListSize}
          color={colors.textSecondary}
          style={styles.iconGlyph}
        />
      ) : (
        <Typography variant="largeTitle" style={styles.icon}>
          {icon}
        </Typography>
      )}
      <Typography variant="headline" weight="semibold" align="center">
        {title}
      </Typography>
      <Typography
        variant="subheadline"
        color={colors.textSecondary}
        align="center"
        style={styles.message}
      >
        {message}
      </Typography>
      {action && (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.primaryLight }]}
          onPress={action.onPress}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Typography variant="subheadline" weight="semibold" color={colors.primary}>
            {action.label}
          </Typography>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: Layout.sectionSpacing,
    paddingHorizontal: Layout.pageMargin,
    alignItems: 'center',
  },
  icon: {
    fontSize: Avatar.memberListSize,
    marginBottom: Spacing.md,
  },
  iconGlyph: {
    marginBottom: Spacing.md,
  },
  message: {
    marginTop: Chat.compactGap,
    marginBottom: Spacing.base,
    maxWidth: Layout.emptyStateCopyMaxWidth,
  },
  actionButton: {
    paddingVertical: Spacing.smd,
    paddingHorizontal: Layout.pageMargin,
    borderRadius: CornerRadius.md,
    minHeight: ButtonMetrics.minTapTarget,
  },
});
