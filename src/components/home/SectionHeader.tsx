import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';

import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { useAppColors } from '@theme';

interface SectionHeaderProps {
  title: string;
  count?: number;
  onSeeAll?: () => void;
}

export function SectionHeader({ title, count, onSeeAll }: SectionHeaderProps) {
  const colors = useAppColors();
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Typography variant="title3" weight="bold">
          {title}
        </Typography>
        {count !== undefined && count > 3 && (
          <View style={[styles.countBadge, { backgroundColor: colors.primaryLight }]}>
            <Typography variant="caption2" weight="semibold" color={colors.primary}>
              {count}
            </Typography>
          </View>
        )}
      </View>
      {onSeeAll && (
        <TouchableOpacity
          onPress={onSeeAll}
          style={styles.seeAllButton}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`See all ${title.toLowerCase()}`}
          accessibilityHint="Navigate to the full list"
        >
          <Typography variant="subheadline" weight="medium" color={colors.primary}>
            See All
          </Typography>
          <Icon name="chevron-forward" size={16} color={colors.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    minHeight: 44, // Accessibility touch target
  },
});
