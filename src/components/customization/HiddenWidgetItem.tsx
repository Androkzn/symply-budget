import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, TouchableOpacity, View, Platform } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useAppColors } from '@theme';

interface HiddenWidgetItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  onPress: () => void;
}

export function HiddenWidgetItem({ icon, title, onPress }: HiddenWidgetItemProps) {  const colors = useAppColors();

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>
        <Icon name={icon} size={34} color={colors.primary} />
      </View>
      <Typography variant="caption1" weight="medium" color={colors.textPrimary} align="center" style={styles.title}>
        {title}
      </Typography>
      <View style={styles.addButton}>
        <Icon name="add" size={18} color={colors.primary} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    aspectRatio: 1,
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
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
  iconContainer: {
    marginBottom: 8,
  },
  title: {
    marginTop: 4,
    paddingHorizontal: 4,
  },
  addButton: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
});
