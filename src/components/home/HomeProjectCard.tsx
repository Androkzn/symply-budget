import React, { useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Animated, Platform } from 'react-native';

import type { ProjectWithDetails } from '@api/projects';
import { PROJECT_STATUS_INFO } from '@api/projects';
import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { useAppColors } from '@theme';

interface HomeProjectCardProps {
  project: ProjectWithDetails;
  onPress: () => void;
}

export function HomeProjectCard({ project, onPress }: HomeProjectCardProps) {
  const colors = useAppColors();  const scaleAnim = useRef(new Animated.Value(1)).current;
  const statusInfo = PROJECT_STATUS_INFO[project.status];

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  // Calculate progress percentage
  const progressPercentage =
    project.progress.totalMilestones > 0
      ? (project.progress.completedMilestones / project.progress.totalMilestones) * 100
      : 0;

  // Calculate budget percentage
  const budgetPercentage =
    project.progress.totalAmount > 0
      ? (project.progress.paidAmount / project.progress.totalAmount) * 100
      : 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`Project: ${project.title} by ${project.contractor.name}`}
      accessibilityHint="Tap to view project details"
    >
      <Animated.View
        style={[
          styles.card,
          {
            backgroundColor: colors.backgroundSecondary,
            borderColor: colors.borderColor,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Top Row: Icon + Status */}
        <View style={styles.topRow}>
          <View style={[styles.iconContainer, { backgroundColor: `${statusInfo.color}15` }]}>
            <Icon name="construct" size={24} color={statusInfo.color} />
          </View>
          <View style={[styles.statusBadge, { backgroundColor: `${statusInfo.color}20` }]}>
            <Typography variant="caption2" weight="semibold" color={statusInfo.color}>
              {statusInfo.label}
            </Typography>
          </View>
        </View>

        {/* Title + Contractor */}
        <Typography variant="headline" weight="semibold" numberOfLines={2} color={colors.textPrimary} style={styles.title}>
          {project.title}
        </Typography>
        <Typography variant="subheadline" color={colors.textSecondary} numberOfLines={1} style={styles.contractor}>
          {project.contractor.name}
        </Typography>

        {/* Progress Bar + Milestone Count */}
        <View style={styles.progressSection}>
          <View style={styles.progressHeader}>
            <Typography variant="caption1" color={colors.textSecondary}>
              Progress
            </Typography>
            <Typography variant="caption1" weight="semibold" color={colors.textPrimary}>
              {project.progress.completedMilestones}/{project.progress.totalMilestones} milestones
            </Typography>
          </View>
          <View style={[styles.progressBar, { backgroundColor: colors.groupedListBackground }]}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progressPercentage}%`,
                  backgroundColor: statusInfo.color,
                },
              ]}
            />
          </View>
        </View>

        {/* Budget Display */}
        {project.progress.totalAmount > 0 && (
          <View style={styles.budgetSection}>
            <Typography variant="caption1" color={colors.textSecondary}>
              Budget
            </Typography>
            <Typography variant="callout" weight="semibold" color={colors.textPrimary}>
              ${(project.progress.paidAmount / 100).toLocaleString()} / $
              {(project.progress.totalAmount / 100).toLocaleString()}
              <Typography variant="caption1" color={colors.textSecondary}>
                {' '}
                ({Math.round(budgetPercentage)}%)
              </Typography>
            </Typography>
          </View>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 0.5,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  title: {
    fontSize: 17,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  contractor: {
    marginBottom: 12,
  },
  progressSection: {
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  budgetSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
