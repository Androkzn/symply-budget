import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, Platform } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useAppColors, type AppColors } from '@theme';

interface DraggableWidgetItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  drag: () => void;
  isActive: boolean;
}

export function DraggableWidgetItem({
  icon,
  title,
  subtitle,
  drag,
  isActive,
}: DraggableWidgetItemProps) {  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.backgroundSecondary },
        isActive && styles.containerActive,
      ]}
    >
      <View style={styles.iconContainer}>
        <Icon name={icon} size={24} color={colors.primary} />
      </View>
      <View style={styles.content}>
        <Typography variant="body" weight="semibold" color={colors.textPrimary}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="footnote" color={colors.textSecondary}>
            {subtitle}
          </Typography>
        )}
      </View>
      <TouchableOpacity
        onPressIn={drag}
        style={styles.dragHandle}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Icon name="reorder-three" size={22} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  containerActive: {
    opacity: 0.7,
    ...Platform.select({
      ios: {
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.cardSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  dragHandle: {
    padding: 8,
    marginLeft: 8,
  },
});
