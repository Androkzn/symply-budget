/**
 * Home dashboard entry for Home Projects (House brand).
 * Always visible — not an attention-only card — so renovations stay discoverable.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { useHomeProjects } from '@api/home-projects';
import { isHouseBrand } from '@brand';
import { Typography } from '@components/ui';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

export function HomeProjectsHomeCard() {
  const colors = useAppColors();
  const router = useRouter();
  const householdId = useHouseholdStore((s) => s.currentHousehold?.id);
  const { data } = useHomeProjects(householdId);

  const active = useMemo(
    () => (data || []).filter((p) => p.status !== 'archived' && p.status !== 'done'),
    [data]
  );

  if (!isHouseBrand()) return null;

  const title =
    active.length > 0
      ? `${active.length} project${active.length === 1 ? '' : 's'}`
      : 'Projects';
  const subtitle =
    active.length > 0
      ? active
          .slice(0, 2)
          .map((p) => p.title)
          .join(' · ')
      : 'Plan renovations, materials, and budgets';

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.borderColor }]}
      onPress={() => router.push('/projects')}
      testID="home-projects-card"
      accessibilityRole="button"
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.pillBackground }]}>
        <Ionicons name="construct-outline" size={IconSize.md} color={colors.primary} />
      </View>
      <View style={styles.copy}>
        <Typography variant="subheadline" weight="semibold" color={colors.textPrimary}>
          {title}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} numberOfLines={2}>
          {subtitle}
        </Typography>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 2 },
});
