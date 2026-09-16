import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl, Animated } from 'react-native';

import {
  checklistsApi,
  type ChecklistProgress,
} from '@api/checklists';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography, GradientButton } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import type { RootStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// Progress ring component
interface ProgressRingProps {
  progress: number;
  size: number;
  strokeWidth: number;
  color: string;
  backgroundColor: string;
}

function ProgressRing({ progress, size, strokeWidth, color, backgroundColor }: ProgressRingProps) {
  return (
    <View style={{ width: size, height: size }}>
      {/* Background circle */}
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: backgroundColor,
        }}
      />
      {/* Progress circle - simplified without SVG */}
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: color,
          borderRightColor: 'transparent',
          borderBottomColor: progress < 50 ? 'transparent' : color,
          transform: [{ rotate: '-90deg' }],
        }}
      />
      {/* Center content */}
      <View style={styles.progressRingCenter}>
        <Typography variant="headline" weight="bold">
          {progress}%
        </Typography>
      </View>
    </View>
  );
}

// Checklist card component
interface ChecklistCardProps {
  progress: ChecklistProgress;
  onPress: () => void;
  onToggleItem: (itemId: string, isCompleted: boolean) => void;
}

function ChecklistCard({ progress, onPress, onToggleItem }: ChecklistCardProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const { checklist, currentInstance, completionRate, streak } = progress;

  const items = checklist.items;
  const completedItemIds = new Set(currentInstance?.completedItemIds || []);
  const currentProgress = currentInstance
    ? Math.round((currentInstance.completed_items / currentInstance.total_items) * 100)
    : 0;

  const frequencyLabels: Record<string, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    seasonal: 'Seasonal',
    yearly: 'Yearly',
    custom: 'Custom',
  };

  return (
    <View style={[styles.checklistCard, { backgroundColor: colors.backgroundSecondary }]}>
      {/* Header */}
      <TouchableOpacity style={styles.cardHeader} onPress={onPress} activeOpacity={0.7}>
        <View
          style={[
            styles.checklistIcon,
            { backgroundColor: checklist.color || theme.pastel.teal },
          ]}
        >
          {checklist.icon ? (
            <Typography variant="title2">{checklist.icon}</Typography>
          ) : (
            <Icon name="list" size={24} color={colors.white} />
          )}
        </View>
        <View style={styles.checklistInfo}>
          <Typography variant="headline" weight="semibold">
            {checklist.name}
          </Typography>
          <Typography variant="footnote" color={colors.textSecondary}>
            {frequencyLabels[checklist.frequency]} • {currentInstance?.period_label || 'Current Period'}
          </Typography>
        </View>
        <View style={styles.progressContainer}>
          <ProgressRing
            progress={currentProgress}
            size={56}
            strokeWidth={4}
            color={checklist.color || theme.pastel.teal}
            backgroundColor={colors.borderColor}
          />
        </View>
      </TouchableOpacity>

      {/* Progress bar */}
      <View style={[styles.progressBar, { backgroundColor: colors.borderColor }]}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              backgroundColor: checklist.color || theme.pastel.teal,
              width: `${currentProgress}%`,
            },
          ]}
        />
      </View>

      {/* Items list */}
      <View style={styles.itemsList}>
        {items.slice(0, 5).map((item) => {
          const isCompleted = completedItemIds.has(item.id);
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.itemRow}
              onPress={() => onToggleItem(item.id, isCompleted)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    backgroundColor: isCompleted
                      ? checklist.color || theme.pastel.teal
                      : 'transparent',
                    borderColor: isCompleted
                      ? checklist.color || theme.pastel.teal
                      : colors.borderColor,
                  },
                ]}
              >
                {isCompleted && (
                  <Icon name="checkmark" size={14} color={colors.white} />
                )}
              </View>
              <Typography
                variant="body"
                style={[
                  styles.itemText,
                  isCompleted && {
                    textDecorationLine: 'line-through',
                    color: colors.textTertiary,
                  },
                ]}
                numberOfLines={1}
              >
                {item.title}
              </Typography>
            </TouchableOpacity>
          );
        })}
        {items.length > 5 && (
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            style={styles.moreItems}
          >
            +{items.length - 5} more items
          </Typography>
        )}
      </View>

      {/* Stats */}
      <View style={[styles.statsRow, { borderTopColor: colors.borderColor }]}>
        <View style={styles.statItem}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Completion Rate
          </Typography>
          <Typography variant="subheadline" weight="semibold">
            {completionRate}%
          </Typography>
        </View>
        <View style={styles.statItem}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Current Streak
          </Typography>
          <View style={styles.streakValue}>
            <Icon name="flame" size={14} color={theme.status.complete} />
            <Typography variant="subheadline" weight="semibold" color={theme.status.complete}>
              {streak}
            </Typography>
          </View>
        </View>
        <View style={styles.statItem}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Status
          </Typography>
          {(() => {
            const statusColor =
              currentInstance?.status === 'completed'
                ? theme.status.complete
                : currentInstance?.status === 'in_progress'
                ? theme.status.soon
                : colors.textSecondary;
            const statusIcon: React.ComponentProps<typeof Ionicons>['name'] =
              currentInstance?.status === 'completed'
                ? 'checkmark-circle'
                : currentInstance?.status === 'in_progress'
                ? 'refresh'
                : 'hourglass';
            const statusLabel =
              currentInstance?.status === 'completed'
                ? 'Done'
                : currentInstance?.status === 'in_progress'
                ? 'In Progress'
                : 'Not Started';
            return (
              <View style={styles.statusValue}>
                <Icon name={statusIcon} size={14} color={statusColor} />
                <Typography variant="subheadline" weight="semibold" color={statusColor}>
                  {statusLabel}
                </Typography>
              </View>
            );
          })()}
        </View>
      </View>
    </View>
  );
}

export function ChecklistsScreen() {
  const colors = useAppColors();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const { currentHousehold } = useHouseholdStore();
  const [progressList, setProgressList] = useState<ChecklistProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!currentHousehold?.id) return;

    try {
      const { progress } = await checklistsApi.getProgress(currentHousehold.id);
      setProgressList(progress);
    } catch (error) {
      console.error('Error loading checklists:', error);
    }
  }, [currentHousehold?.id]);

  useEffect(() => {
    setIsLoading(true);
    loadData().finally(() => setIsLoading(false));
  }, [loadData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleToggleItem = async (
    progress: ChecklistProgress,
    itemId: string,
    isCompleted: boolean
  ) => {
    if (!currentHousehold?.id || !progress.currentInstance) return;

    try {
      if (isCompleted) {
        await checklistsApi.uncompleteItem(
          currentHousehold.id,
          progress.currentInstance.id,
          itemId
        );
      } else {
        await checklistsApi.completeItem(
          currentHousehold.id,
          progress.currentInstance.id,
          itemId
        );
      }
      await loadData();
    } catch (error) {
      console.error('Error toggling item:', error);
    }
  };

  const handleCreateDefaults = async () => {
    if (!currentHousehold?.id) return;

    try {
      await checklistsApi.createDefaults(currentHousehold.id);
      await loadData();
    } catch (error) {
      console.error('Error creating defaults:', error);
    }
  };

  if (isLoading) {
    return (
      <AppBackground>
        <ScreenHeader
          title="Checklists"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />
        <SafeAreaView edges={[]}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.pastel.teal} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground>
      <ScreenHeader
        title="Checklists"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      <SafeAreaView edges={[]}>
        <ScrollView
          style={[screenScrollViewStyle.scroll, styles.container]}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={theme.pastel.teal}
            />
          }
        >
          <Typography variant="body" color={colors.textSecondary} style={styles.subtitle}>
            Track your routine maintenance tasks
          </Typography>

        {/* Empty state */}
        {progressList.length === 0 && (
          <View style={[styles.emptyState, { backgroundColor: colors.backgroundSecondary }]}>
            <Icon
              name="list"
              size={48}
              color={colors.textSecondary}
              style={styles.emptyIcon}
            />
            <Typography variant="headline" weight="semibold" align="center">
              No checklists yet
            </Typography>
            <Typography
              variant="body"
              color={colors.textSecondary}
              align="center"
              style={styles.emptyText}
            >
              Create checklists to track daily, weekly, and monthly home maintenance tasks
            </Typography>
            <GradientButton
              title="Create Default Checklists"
              variant="teal"
              onPress={handleCreateDefaults}
              style={styles.emptyButton}
              fullWidth
            />
          </View>
        )}

        {/* Checklist cards */}
        {progressList.map((progress) => (
          <ChecklistCard
            key={progress.checklist.id}
            progress={progress}
            onPress={() => {}}
            onToggleItem={(itemId, isCompleted) => handleToggleItem(progress, itemId, isCompleted)}
          />
        ))}

        {/* Add checklist button */}
        {progressList.length > 0 && (
          <GradientButton
            title="Create New Checklist"
            variant="blue"
            onPress={() => {}}
            style={styles.addButton}
            fullWidth
          />
        )}
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 120,
  },
  subtitle: {
    marginBottom: 20,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyText: {
    marginTop: 8,
    marginBottom: 24,
  },
  emptyButton: {
    width: '100%',
  },
  checklistCard: {
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  checklistIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checklistInfo: {
    flex: 1,
  },
  progressContainer: {
    marginLeft: 12,
  },
  progressRingCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressBar: {
    height: 4,
    marginHorizontal: 16,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  itemsList: {
    padding: 16,
    paddingTop: 12,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  itemText: {
    flex: 1,
  },
  moreItems: {
    marginTop: 8,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statItem: {
    alignItems: 'center',
  },
  streakValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addButton: {
    marginTop: 8,
  },
});
