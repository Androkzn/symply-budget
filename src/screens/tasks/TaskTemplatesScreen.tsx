import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, ScrollView, RefreshControl, Platform } from 'react-native';

import { tasksApi } from '@api/tasks';
import { templatesApi, MaintenanceTemplate, TemplateCategory } from '@api/templates';
import { SafeAreaView, AppBackground, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, screenScrollViewStyle } from '@components/common';
import { Typography, SearchBar, Card, Chip, Button } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { TasksStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { useTaskStore } from '@stores/taskStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';
import { formatMoneyUnits, useDisplayCurrency } from '@utils/money';

type TemplatesNavigationProp = NativeStackNavigationProp<TasksStackParamList>;

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'DIY Easy',
  moderate: 'DIY Moderate',
  hard: 'DIY Difficult',
  professional: 'Professional',
};

export function TaskTemplatesScreen() {  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const navigation = useNavigation<TemplatesNavigationProp>();

  const DIFFICULTY_COLORS: Record<string, string> = {
    easy: colors.success,
    moderate: colors.warning,
    hard: colors.error,
    professional: colors.info,
  };

  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);
  const { addMaintenanceTask } = useTaskStore();

  const [templates, setTemplates] = useState<MaintenanceTemplate[]>([]);
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [templatesRes, categoriesRes] = await Promise.all([
        templatesApi.list({ category: selectedCategory || undefined, search: searchQuery || undefined }),
        templatesApi.getCategories(),
      ]);
      setTemplates(templatesRes.templates);
      setCategories(categoriesRes.categories);
    } catch (error) {
      showToast('error', 'Failed to load templates');
    } finally {
      setIsLoading(false);
    }
  }, [selectedCategory, searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleImportTemplate = async (template: MaintenanceTemplate) => {
    if (!currentHousehold) {
      showToast('error', 'No property selected');
      return;
    }

    try {
      setImportingId(template.id);

      // Calculate initial due date based on frequency
      const now = new Date();
      const nextDueDate = new Date();
      
      switch (template.frequency) {
        case 'daily':
          nextDueDate.setDate(now.getDate() + 1);
          break;
        case 'weekly':
          nextDueDate.setDate(now.getDate() + 7);
          break;
        case 'monthly':
          nextDueDate.setMonth(now.getMonth() + 1);
          break;
        case 'quarterly':
          nextDueDate.setMonth(now.getMonth() + 3);
          break;
        case 'yearly':
          nextDueDate.setFullYear(now.getFullYear() + 1);
          break;
        default:
          if (template.custom_interval_days) {
            nextDueDate.setDate(now.getDate() + template.custom_interval_days);
          } else {
            nextDueDate.setMonth(now.getMonth() + 1);
          }
      }

      const result = await tasksApi.create(currentHousehold.id, {
        title: template.name,
        description: template.description,
        system_category: template.category,
        frequency: template.frequency,
        custom_interval_days: template.custom_interval_days,
        next_due_date: nextDueDate.toISOString(),
      });

      addMaintenanceTask(result.task);
      showToast('success', 'Task added to your list');
    } catch (error) {
      showToast('error', 'Failed to add task');
    } finally {
      setImportingId(null);
    }
  };

  const formatDuration = (minutes?: number): string => {
    if (!minutes) return '';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const formatCost = (cost?: { diy: number; professional: number }): string => {
    if (!cost) return '';
    if (cost.diy === 0 && cost.professional === 0) return 'Free';
    if (cost.diy === 0) return `Pro: ${formatMoneyUnits(cost.professional)}`;
    return `DIY: ${formatMoneyUnits(cost.diy)}`;
  };

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView edges={[]}>
        <View style={styles.container} testID="task-templates-screen">
          {/* Header */}
          <ScreenHeader
        title="Task Templates"
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
              placeholder="Search templates..."
            />
          </View>

          {/* Category Filter */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[screenScrollViewStyle.scroll, styles.categoryScroll]}
            contentContainerStyle={styles.categoryContent}
          >
            <Chip
              label="All"
              variant={selectedCategory === null ? 'primary' : 'secondary'}
              onPress={() => setSelectedCategory(null)}
            />
            {categories.map((cat) => (
              <Chip
                key={cat.id}
                label={`${cat.label} (${cat.count})`}
                variant={selectedCategory === cat.id ? 'primary' : 'secondary'}
                onPress={() => setSelectedCategory(cat.id)}
              />
            ))}
          </ScrollView>

          {/* Templates List */}
          <ScrollView
            style={[screenScrollViewStyle.scroll, styles.scrollView]}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
          >
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : templates.length === 0 ? (
              <View style={styles.emptyState}>
                <Typography variant="body" color={colors.textSecondary} align="center">
                  {searchQuery ? 'No templates match your search' : 'No templates available'}
                </Typography>
              </View>
            ) : (
              templates.map((template) => (
                <Card
                  key={template.id}
                  variant="filled"
                  style={[
                    styles.templateCard,
                    { backgroundColor: colors.backgroundSecondary, shadowColor: colors.black },
                  ]}
                >
                  <View style={styles.templateHeader}>
                    <View style={styles.templateInfo}>
                      <Typography variant="headline" weight="semibold" numberOfLines={2}>
                        {template.name}
                      </Typography>
                      <Typography variant="caption1" color={colors.textSecondary}>
                        {template.category_label}
                      </Typography>
                    </View>
                    <Button
                      title={importingId === template.id ? '' : 'Add'}
                      variant="primary"
                      size="sm"
                      onPress={() => handleImportTemplate(template)}
                      disabled={importingId !== null}
                      loading={importingId === template.id}
                    />
                  </View>

                  {template.description && (
                    <Typography
                      variant="footnote"
                      color={colors.textSecondary}
                      numberOfLines={2}
                      style={styles.description}
                    >
                      {template.description}
                    </Typography>
                  )}

                  <View style={styles.templateMeta}>
                    {template.difficulty && (
                      <View style={[styles.badge, { backgroundColor: `${DIFFICULTY_COLORS[template.difficulty]}20` }]}>
                        <Typography
                          variant="caption2"
                          color={DIFFICULTY_COLORS[template.difficulty]}
                          weight="medium"
                        >
                          {DIFFICULTY_LABELS[template.difficulty]}
                        </Typography>
                      </View>
                    )}
                    {template.estimated_duration && (
                      <View style={[styles.badge, styles.badgeRow, { backgroundColor: colors.backgroundMain }]}>
                        <Icon name="time" size={12} color={colors.textSecondary} />
                        <Typography variant="caption2" color={colors.textSecondary}>
                          {formatDuration(template.estimated_duration)}
                        </Typography>
                      </View>
                    )}
                    {template.estimated_cost && (
                      <View style={[styles.badge, styles.badgeRow, { backgroundColor: colors.backgroundMain }]}>
                        <Icon name="cash" size={12} color={colors.textSecondary} />
                        <Typography variant="caption2" color={colors.textSecondary}>
                          {formatCost(template.estimated_cost)}
                        </Typography>
                      </View>
                    )}
                    {template.gva_specific && (
                      <View style={[styles.badge, { backgroundColor: `${colors.accent}20` }]}>
                        <Typography variant="caption2" color={colors.primary}>
                          🍁 GVA
                        </Typography>
                      </View>
                    )}
                  </View>

                  {template.tools_required && template.tools_required.length > 0 && (
                    <Typography variant="caption2" color={colors.textTertiary} style={styles.tools}>
                      Tools: {template.tools_required.join(', ')}
                    </Typography>
                  )}
                </Card>
              ))
            )}
            <ScreenScrollEnd testID={screenScrollEndTestId('task-templates-screen')} />
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
    marginBottom: Spacing.md,
  },
  categoryScroll: {
    maxHeight: Spacing.xxl + Spacing.md,
    marginBottom: Spacing.md,
  },
  categoryContent: {
    paddingHorizontal: Spacing.base,
    gap: Spacing.sm,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
  },
  loadingContainer: {
    padding: Spacing.xxl + Spacing.sm,
    alignItems: 'center',
  },
  emptyState: {
    padding: Spacing.xxl + Spacing.sm,
    alignItems: 'center',
  },
  templateCard: {
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
  templateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  templateInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  description: {
    marginTop: Spacing.sm,
  },
  templateMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.xs + Spacing.xxs,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  tools: {
    marginTop: Spacing.sm,
  },
});

export default TaskTemplatesScreen;
