import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

import { Icon } from '@components/ui/Icon';
import {
  Chat,
  CornerRadius,
  Elevation,
  IconSize,
  LegacyTextVariant,
  Shadow,
  Spacing,
  TypographyTokens,
  useAppColors,
} from '@theme';
import type { AppColors } from '@theme';

interface AIRecommendationBadgeProps {
  confidence: number;
  reasoning?: string;
  onPress?: () => void;
}

function getConfidenceLevel(conf: number, colors: AppColors) {
  if (conf >= 0.8) return { label: 'High Confidence', color: colors.success };
  if (conf >= 0.6) return { label: 'Medium Confidence', color: colors.warning };
  return { label: 'Low Confidence', color: colors.error };
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.card,
      borderRadius: CornerRadius.md,
      padding: Spacing.base,
      marginBottom: Spacing.base,
      borderWidth: Spacing.xxs,
      shadowColor: colors.black,
      shadowOffset: { width: Shadow.light.offsetX, height: Shadow.light.offsetY },
      shadowOpacity: Shadow.medium.opacityLight,
      shadowRadius: Shadow.light.radius,
      elevation: Elevation.card,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    icon: {
      marginRight: Spacing.md,
    },
    headerText: {
      flex: 1,
    },
    title: {
      fontSize: LegacyTextVariant.callout.size,
      lineHeight: LegacyTextVariant.callout.lineHeight,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: Spacing.xs,
    },
    confidenceRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    confidenceDot: {
      width: Chat.assistantPriorityDotSize,
      height: Chat.assistantPriorityDotSize,
      borderRadius: Chat.assistantPriorityDotSize / 2,
      marginRight: Chat.compactGap,
    },
    confidenceText: {
      fontSize: LegacyTextVariant.footnote.size,
      lineHeight: LegacyTextVariant.footnote.lineHeight,
      fontWeight: '500',
    },
    divider: {
      height: 1,
      backgroundColor: colors.divider,
      marginVertical: Spacing.md,
    },
    reasoning: {
      fontSize: TypographyTokens.bodySmall.size,
      lineHeight: TypographyTokens.bodySmall.lineHeight,
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
    },
    viewMoreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xxs,
    },
    viewMore: {
      fontSize: LegacyTextVariant.footnote.size,
      lineHeight: LegacyTextVariant.footnote.lineHeight,
      color: colors.primary,
      fontWeight: '500',
    },
    confidenceBar: {
      height: Spacing.xs,
      backgroundColor: colors.divider,
      borderRadius: Spacing.xxs,
      marginTop: Spacing.md,
      overflow: 'hidden',
    },
    confidenceFill: {
      height: '100%',
      borderRadius: Spacing.xxs,
    },
  });
}

export function AIRecommendationBadge({ confidence, reasoning, onPress }: AIRecommendationBadgeProps) {
  const colors = useAppColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const confidenceInfo = getConfidenceLevel(confidence, colors);
  const confidencePercentage = Math.round(confidence * 100);

  return (
    <TouchableOpacity
      style={[styles.container, { borderColor: confidenceInfo.color }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.header}>
        <Icon
          name="sparkles"
          size={Chat.aiRecommendationIconSize}
          color={colors.primary}
          style={styles.icon}
        />
        <View style={styles.headerText}>
          <Text style={styles.title}>AI Recommendation</Text>
          <View style={styles.confidenceRow}>
            <View style={[styles.confidenceDot, { backgroundColor: confidenceInfo.color }]} />
            <Text style={[styles.confidenceText, { color: confidenceInfo.color }]}>
              {confidenceInfo.label} ({confidencePercentage}%)
            </Text>
          </View>
        </View>
      </View>

      {reasoning && (
        <>
          <View style={styles.divider} />
          <Text style={styles.reasoning} numberOfLines={3}>
            {reasoning}
          </Text>
          {onPress && (
            <View style={styles.viewMoreRow}>
              <Text style={styles.viewMore}>Tap to view full analysis</Text>
              <Icon name="chevron-forward" size={IconSize.sm} color={colors.primary} />
            </View>
          )}
        </>
      )}

      <View style={styles.confidenceBar}>
        <View
          style={[
            styles.confidenceFill,
            { width: `${confidencePercentage}%`, backgroundColor: confidenceInfo.color },
          ]}
        />
      </View>
    </TouchableOpacity>
  );
}
