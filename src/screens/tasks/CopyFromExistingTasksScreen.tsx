import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';

import { Task } from '@api/tasks';
import { SafeAreaView, AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography, SearchBar, Card } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import type { TasksStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useTaskStore } from '@stores/taskStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';
import { getSystemCategoryIcon, type IoniconName } from '@utils/categoryIcons';

type CopyTasksNavigationProp = NativeStackNavigationProp<TasksStackParamList>;

/** Apply an alpha channel to a solid `#RRGGBB` color. */
function withAlpha(hex: string, alpha: number): string {
  const sanitized = hex.replace('#', '');
  if (sanitized.length !== 6) return hex;
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const CATEGORY_LABELS: Record<string, string> = {
  hvac: 'HVAC',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  drainage: 'Drainage',
  exterior: 'Exterior',
  safety: 'Safety',
  general: 'General',
};

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  one_time: 'One-time',
};

export function CopyFromExistingTasksScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<CopyTasksNavigationProp>();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);
  const { maintenanceTasks, upcomingTasks } = useTaskStore();

  const [searchQuery, setSearchQuery] = useState('');

  // Combine all tasks and remove duplicates
  const allTasks = useMemo(() => {
    const combined = [...(upcomingTasks || []), ...(maintenanceTasks || [])];
    return combined.filter((task, index, self) =>
      index === self.findIndex(t => t.id === task.id)
    );
  }, [upcomingTasks, maintenanceTasks]);

  // Filter tasks by search query
  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return allTasks;

    const query = searchQuery.toLowerCase();
    return allTasks.filter(task =>
      task.title.toLowerCase().includes(query) ||
      (task.description && task.description.toLowerCase().includes(query)) ||
      (task.system_category && CATEGORY_LABELS[task.system_category]?.toLowerCase().includes(query))
    );
  }, [allTasks, searchQuery]);

  const handleTaskSelect = (task: Task) => {
    // Navigate to ScheduleTask screen with the task data pre-filled
    navigation.navigate('ScheduleTask', {
      task: {
        title: `${task.title} (Copy)`,
        description: task.description,
        system_category: task.system_category,
        frequency: task.frequency,
        custom_interval_days: task.custom_interval_days,
        priority_severity: task.priority_severity,
      },
    });
  };

  const getCategoryIcon = (category?: string): IoniconName => getSystemCategoryIcon(category);

  const getCategoryLabel = (category?: string): string => {
    if (!category) return CATEGORY_LABELS.general;
    return CATEGORY_LABELS[category] || CATEGORY_LABELS.general;
  };

  const getFrequencyLabel = (frequency?: string): string => {
    if (!frequency) return 'Not set';
    return FREQUENCY_LABELS[frequency] || frequency;
  };

  if (!currentHousehold) {
    return (
      <AppBackground opacity={0.5}>
        <SafeAreaView edges={[]}>
          <View style={styles.container}>
            <ScreenHeader
        title="Copy Task"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
            <View style={styles.emptyState}>
              <Typography variant="body" color={colors.textSecondary} align="center">
                No property selected
              </Typography>
            </View>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView edges={[]}>
        <View style={styles.container}>
          {/* Header */}
          <ScreenHeader
        title="Copy Task"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

          {/* Search */}
          <View style={styles.searchContainer}>
            <SearchBar
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search tasks..."
            />
          </View>

          {/* Instructions */}
          <View style={styles.instructionsContainer}>
            <Typography variant="caption1" color={colors.textSecondary} align="center">
              Select a task to create a copy
            </Typography>
          </View>

          {/* Tasks List */}
          <ScrollView
            style={[screenScrollViewStyle.scroll, styles.scrollView]}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {filteredTasks.length === 0 ? (
              <View style={styles.emptyState}>
                <Typography variant="body" color={colors.textSecondary} align="center">
                  {searchQuery ? 'No tasks match your search' : 'No tasks available to copy'}
                </Typography>
              </View>
            ) : (
              filteredTasks.map((task) => (
                <TouchableOpacity
                  key={task.id}
                  onPress={() => handleTaskSelect(task)}
                  activeOpacity={0.7}
                >
                  <Card
                    variant="filled"
                    style={[styles.taskCard, { backgroundColor: colors.backgroundSecondary, shadowColor: colors.black }]}
                  >
                    <View style={styles.taskHeader}>
                      <View
                        style={[
                          styles.iconContainer,
                          { backgroundColor: withAlpha(theme.pastel.teal, 0.15) },
                        ]}
                      >
                        <Icon
                          name={getCategoryIcon(task.system_category ?? undefined)}
                          size={IconSize.md}
                          color={colors.textPrimary}
                        />
                      </View>
                      <View style={styles.taskInfo}>
                        <Typography variant="subheadline" weight="semibold" numberOfLines={2}>
                          {task.title}
                        </Typography>
                        {task.description && (
                          <Typography
                            variant="footnote"
                            color={colors.textSecondary}
                            numberOfLines={2}
                            style={styles.description}
                          >
                            {task.description}
                          </Typography>
                        )}
                        <View style={styles.taskMeta}>
                          <View style={[styles.badge, { backgroundColor: colors.backgroundMain }]}>
                            <Typography variant="caption2" color={colors.textSecondary}>
                              {getCategoryLabel(task.system_category ?? undefined)}
                            </Typography>
                          </View>
                          <View style={[styles.badge, { backgroundColor: colors.backgroundMain }]}>
                            <Typography variant="caption2" color={colors.textSecondary}>
                              {getFrequencyLabel(task.frequency ?? undefined)}
                            </Typography>
                          </View>
                        </View>
                      </View>
                      <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
                    </View>
                  </Card>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: Spacing.base,
    marginBottom: Spacing.sm,
  },
  instructionsContainer: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
  },
  emptyState: {
    padding: Spacing.xxl + Spacing.sm,
    alignItems: 'center',
  },
  taskCard: {
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
    marginBottom: Spacing.md,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: Spacing.xxl + Spacing.sm,
    height: Spacing.xxl + Spacing.sm,
    borderRadius: CornerRadius.sm + Spacing.xxs,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  taskInfo: {
    flex: 1,
  },
  description: {
    marginTop: Spacing.xs,
  },
  taskMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.xs + Spacing.xxs,
  },
});

export default CopyFromExistingTasksScreen;
