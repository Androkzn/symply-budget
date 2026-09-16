/**
 * HomeAttentionCards — conditional "Needs attention" rows on the Home dashboard.
 *
 * Each card renders ONLY when there's something actionable behind it (drafts to
 * review, warranties expiring, quotes/projects in flight). When everything is
 * quiet the whole block disappears — the opposite of a fixed grid of always-on
 * launcher tiles. Every card is a one-line status + a tap that goes straight to
 * the thing that needs you.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

interface AttentionItem {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}

interface HomeAttentionCardsProps {
  draftsTotal: number;
  draftsCritical: number;
  warrantiesExpiring: number;
  quotesPending: number;
  projectsActive: number;
  onDrafts: () => void;
  onWarranties: () => void;
  onQuotes: () => void;
  onProjects: () => void;
}

export function HomeAttentionCards({
  draftsTotal,
  draftsCritical,
  warrantiesExpiring,
  quotesPending,
  projectsActive,
  onDrafts,
  onWarranties,
  onQuotes,
  onProjects,
}: HomeAttentionCardsProps) {  const colors = useAppColors();

  const items: AttentionItem[] = [];

  if (draftsTotal > 0) {
    items.push({
      key: 'drafts',
      icon: 'document-text',
      tint: draftsCritical > 0 ? colors.error : colors.accent,
      title: `${draftsTotal} task draft${draftsTotal === 1 ? '' : 's'} to review`,
      subtitle:
        draftsCritical > 0
          ? `${draftsCritical} critical from your inspection report`
          : 'From your inspection report',
      onPress: onDrafts,
    });
  }

  if (quotesPending > 0) {
    items.push({
      key: 'quotes',
      icon: 'reader',
      tint: colors.warning,
      title: `${quotesPending} quote${quotesPending === 1 ? '' : 's'} awaiting review`,
      subtitle: 'From contractors',
      onPress: onQuotes,
    });
  }

  if (projectsActive > 0) {
    items.push({
      key: 'projects',
      icon: 'construct',
      tint: colors.accentTeal,
      title: `${projectsActive} active project${projectsActive === 1 ? '' : 's'}`,
      subtitle: 'Home improvement in progress',
      onPress: onProjects,
    });
  }

  if (warrantiesExpiring > 0) {
    items.push({
      key: 'warranties',
      icon: 'shield-checkmark',
      tint: colors.warning,
      title: `${warrantiesExpiring} warrant${warrantiesExpiring === 1 ? 'y' : 'ies'} expiring soon`,
      subtitle: 'Check your appliances',
      onPress: onWarranties,
    });
  }

  if (items.length === 0) return null;

  return (
    <View style={styles.container} testID="home-attention-cards">
      <Typography
        variant="caption"
        weight="semibold"
        color={colors.textSecondary}
        style={styles.heading}
      >
        NEEDS ATTENTION
      </Typography>

      {items.map((item) => (
        <TouchableOpacity
          key={item.key}
          style={[styles.card, { backgroundColor: colors.backgroundSecondary, borderColor: colors.divider }]}
          onPress={item.onPress}
          activeOpacity={0.7}
          testID={`home-attention-${item.key}`}
        >
          <View style={[styles.iconCircle, { backgroundColor: item.tint + '22' }]}>
            <Icon name={item.icon} size={IconSize.md} color={item.tint} />
          </View>
          <View style={styles.text}>
            <Typography variant="subheadline" weight="semibold" color={colors.textPrimary} numberOfLines={1}>
              {item.title}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1}>
              {item.subtitle}
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.lg,
  },
  heading: {
    letterSpacing: 0.6,
    marginBottom: Spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: Spacing.xxs,
  },
});
