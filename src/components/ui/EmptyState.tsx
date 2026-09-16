import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View, StyleSheet } from 'react-native';

import { Icon } from '@components/ui/Icon';
import {EmptyState as EmptyTokens, Spacing, useAppColors } from '@theme';

import { Button } from './Button';
import { Typography } from './Typography';

type IoniconName = keyof typeof Ionicons.glyphMap;

interface EmptyStateProps {
  /** Ionicon glyph name (preferred) or an emoji string (legacy). */
  icon?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    onPress: () => void;
    testID?: string;
  };
}

/** Treat the prop as an Ionicon when it matches a known glyph name. */
function isIoniconName(icon: string): icon is IoniconName {
  return icon in Ionicons.glyphMap;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  const colors = useAppColors();
  return (
    <View style={styles.container}>
      {icon &&
        (isIoniconName(icon) ? (
          <Icon
            name={icon}
            size={EmptyTokens.iconSize}
            color={colors.textSecondary}
            style={styles.iconGlyph}
          />
        ) : (
          <Typography variant="largeTitle" style={styles.icon}>
            {icon}
          </Typography>
        ))}

      <Typography variant="headline" weight="semibold" style={styles.title}>
        {title}
      </Typography>

      {description && (
        <Typography variant="body" color={colors.textSecondary} style={styles.description}>
          {description}
        </Typography>
      )}

      {action && (
        <View style={styles.actionContainer}>
          <Button
            title={action.label}
            variant="primary"
            size="md"
            onPress={action.onPress}
            testID={action.testID}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
  },
  icon: {
    fontSize: EmptyTokens.iconSize,
    lineHeight: EmptyTokens.iconSize * 1.2,
    textAlign: 'center',
    marginBottom: Spacing.base,
  },
  iconGlyph: {
    textAlign: 'center',
    marginBottom: Spacing.base,
    opacity: EmptyTokens.iconOpacity,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  description: {
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  actionContainer: {
    marginTop: Spacing.sm,
  },
});
