import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

interface PropertyBadgeProps {
  householdId?: string;
  householdName?: string;
  size?: 'sm' | 'md';
  showInSingleMode?: boolean;
}

/**
 * PropertyBadge - Displays which property an item belongs to
 * 
 * Only shows in multi-property mode by default.
 * Use when displaying items that could belong to different properties.
 */
export function PropertyBadge({ 
  householdId, 
  householdName,
  size = 'sm',
  showInSingleMode = false,
}: PropertyBadgeProps) {
  const colors = useAppColors();  const propertyMode = useHouseholdStore((state) => state.propertyMode);
  const households = useHouseholdStore((state) => state.households);

  // Only show in multi-property mode (unless explicitly requested)
  if (propertyMode !== 'all' && !showInSingleMode) {
    return null;
  }

  // Only show if we have multiple properties
  if (households.length <= 1) {
    return null;
  }

  // Get household name from ID if not provided
  let displayName = householdName;
  if (!displayName && householdId) {
    const household = households.find((h) => h.id === householdId);
    displayName = household?.name;
  }

  if (!displayName) {
    return null;
  }

  // Truncate long names
  const truncatedName = displayName.length > 15 
    ? `${displayName.substring(0, 12)}...` 
    : displayName;

  const isSmall = size === 'sm';

  return (
    <View
      style={[
        styles.badge,
        isSmall ? styles.badgeSmall : styles.badgeMedium,
        { backgroundColor: colors.primary + '15' },
      ]}
    >
      <Icon
        name="home"
        size={isSmall ? 12 : 14}
        color={colors.primary}
      />
      <Typography
        variant={isSmall ? 'caption2' : 'caption1'}
        color={colors.primary}
        weight="medium"
      >
        {truncatedName}
      </Typography>
    </View>
  );
}

/**
 * usePropertyBadgeInfo - Hook to get property badge information
 * 
 * Returns null if badge shouldn't be shown, or the household info if it should.
 */
export function usePropertyBadgeInfo(householdId?: string) {
  const propertyMode = useHouseholdStore((state) => state.propertyMode);
  const households = useHouseholdStore((state) => state.households);

  if (propertyMode !== 'all' || households.length <= 1 || !householdId) {
    return null;
  }

  const household = households.find((h) => h.id === householdId);
  return household ? { id: household.id, name: household.name } : null;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  badgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeMedium: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
