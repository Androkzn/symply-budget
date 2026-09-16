import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import type { OwnerJoinRequest } from '@api/households';
import { Typography, IconBackgroundChip, Icon } from '@components/ui';
import { navigateToHouseholdMembers } from '@services/navigation';
import { useAppColors } from '@theme';

interface JoinRequestsAlertBannerProps {
  requests: OwnerJoinRequest[];
}

export function JoinRequestsAlertBanner({ requests }: JoinRequestsAlertBannerProps) {
  const colors = useAppColors();
  if (requests.length === 0) {
    return null;
  }

  const first = requests[0];
  const who = first.display_name || first.email || 'Someone';
  const title =
    requests.length === 1
      ? `${who} wants to join ${first.household_name}`
      : `${requests.length} join requests need your approval`;

  const subtitle =
    requests.length === 1
      ? 'Tap to review and approve or decline'
      : `Latest: ${who} · ${first.household_name}`;

  const handlePress = () => {
    navigateToHouseholdMembers(first.household_id);
  };

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={handlePress}
      style={[
        styles.banner,
        {
          backgroundColor: colors.primary + '14',
          borderColor: colors.primary + '40',
        },
      ]}
    >
      <IconBackgroundChip name="person-add" size={20} backgroundColor={colors.primary + '22'} style={styles.iconWrap} />
      <View style={styles.textWrap}>
        <Typography variant="subheadline" weight="semibold">
          {title}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} style={styles.subtitle}>
          {subtitle}
        </Typography>
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  subtitle: {
    marginTop: 2,
  },
});
