import { useNavigation } from "expo-router/react-navigation";
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


import { visitChecklistsApi, type ChecklistWithItems, type ChecklistItem, type ChecklistTemplate } from '@api/visit-checklists';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography, IconBackgroundChip } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

// Format date for display
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const diffTime = today.getTime() - date.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

type TabType = 'my-checklists' | 'templates';

// Checklist Card Component
interface ChecklistCardProps {
  checklist: ChecklistWithItems;
  onPress: () => void;
  onDelete: () => void;
}

function ChecklistCard({ checklist, onPress, onDelete }: ChecklistCardProps) {
  const colors = useAppColors();
  const items: ChecklistItem[] = checklist.items || [];
  const completedCount = items.filter((item: ChecklistItem) => item.checked).length;
  const progressPercent = items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <IconBackgroundChip
          name="document-text"
          size={22}
          backgroundColor={colors.primary + '20'}
          style={styles.iconCircle}
        />
        <TouchableOpacity onPress={onDelete} style={styles.deleteButton}>
          <Icon name="trash-outline" size={18} color={colors.error} />
        </TouchableOpacity>
      </View>

      <Typography variant="headline" weight="semibold" numberOfLines={1} style={{ marginTop: 12 }}>
        {checklist.title}
      </Typography>

      <Typography variant="caption1" color="secondary">
        Created {formatDate(checklist.created_at)}
      </Typography>

      {items.length > 0 && (
        <View style={styles.progressSection}>
          <View style={styles.progressRow}>
            <Typography variant="caption2" color="secondary">
              Progress
            </Typography>
            <Typography variant="caption2" weight="medium">
              {completedCount}/{items.length} items
            </Typography>
          </View>
          <View style={[styles.progressBar, { backgroundColor: colors.groupedListBackground }]}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progressPercent}%`,
                  backgroundColor: progressPercent === 100 ? colors.success : colors.primary,
                },
              ]}
            />
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

// Template Card Component
interface TemplateCardProps {
  template: ChecklistTemplate;
  onUse: () => void;
}

function TemplateCard({ template, onUse }: TemplateCardProps) {
  const colors = useAppColors();
  const items = template.items || [];

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      onPress={onUse}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.iconCircle, { backgroundColor: colors.warning + '20' }]}>
          <Icon name="document-text-outline" size={22} color={colors.warning} />
        </View>
        <View style={[styles.specialtyBadge, { backgroundColor: colors.groupedListBackground }]}>
          <Typography variant="caption2" weight="medium" color="secondary">
            {template.specialty || 'General'}
          </Typography>
        </View>
      </View>

      <Typography variant="headline" weight="semibold" numberOfLines={1} style={{ marginTop: 12 }}>
        {template.title}
      </Typography>

      {template.description && (
        <Typography variant="caption1" color="secondary" numberOfLines={2}>
          {template.description}
        </Typography>
      )}

      <View style={styles.templateFooter}>
        <Typography variant="caption2" color="secondary">
          {items.length} items
        </Typography>
        <TouchableOpacity
          style={[styles.useButton, { backgroundColor: colors.primary }]}
          onPress={onUse}
        >
          <Typography variant="caption1" weight="semibold" color="onPrimary">
            Use Template
          </Typography>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// Tab Component
interface TabProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  count?: number;
}

function Tab({ label, isActive, onPress, count }: TabProps) {
  const colors = useAppColors();

  return (
    <TouchableOpacity
      style={[
        styles.tab,
        {
          backgroundColor: isActive ? colors.primary : 'transparent',
          borderColor: isActive ? colors.primary : colors.borderColor,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Typography variant="subheadline" weight="medium" color={isActive ? 'onPrimary' : 'secondary'}>
        {label}
      </Typography>
      {count !== undefined && count > 0 && (
        <View
          style={[
            styles.tabBadge,
            { backgroundColor: isActive ? 'rgba(255,255,255,0.3)' : colors.groupedListBackground },
          ]}
        >
          <Typography
            variant="caption2"
            weight="semibold"
            color={isActive ? 'onPrimary' : 'secondary'}
          >
            {count}
          </Typography>
        </View>
      )}
    </TouchableOpacity>
  );
}

// Empty State Component
function EmptyState({ message, icon, action, actionLabel }: {
  message: string;
  icon: IoniconName;
  action?: () => void;
  actionLabel?: string;
}) {
  const colors = useAppColors();

  return (
    <View style={styles.emptyState}>
      <Icon name={icon} size={40} color={colors.textSecondary} style={{ opacity: 0.5 }} />
      <Typography variant="subheadline" color="secondary" style={{ marginTop: 8, textAlign: 'center' }}>
        {message}
      </Typography>
      {action && actionLabel && (
        <TouchableOpacity
          style={[styles.emptyAction, { backgroundColor: colors.primary }]}
          onPress={action}
        >
          <Typography variant="caption1" weight="semibold" color="onPrimary">
            {actionLabel}
          </Typography>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Main Screen Component
export function ChecklistsScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();

  const [checklists, setChecklists] = useState<ChecklistWithItems[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('my-checklists');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const householdId = currentHousehold?.id;

  const fetchData = useCallback(async () => {
    if (!householdId) return;

    setIsLoading(true);
    try {
      const [checklistsRes, templatesRes] = await Promise.all([
        visitChecklistsApi.getAll(householdId),
        visitChecklistsApi.getTemplates(householdId),
      ]);

      setChecklists(checklistsRes.checklists);
      setTemplates(templatesRes.templates);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const handleCreateNew = () => {
    navigation.navigate('ChecklistEditor', {});
  };

  const handleChecklistPress = (checklist: ChecklistWithItems) => {
    navigation.navigate('ChecklistEditor', { checklistId: checklist.id });
  };

  const handleDeleteChecklist = async (checklist: ChecklistWithItems) => {
    if (!householdId) return;

    Alert.alert(
      'Delete Checklist',
      `Delete "${checklist.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await visitChecklistsApi.delete(householdId, checklist.id);
              setChecklists((prev) => prev.filter((c) => c.id !== checklist.id));
            } catch (error) {
              Alert.alert('Error', 'Failed to delete checklist');
            }
          },
        },
      ]
    );
  };

  const handleUseTemplate = async (template: ChecklistTemplate) => {
    if (!householdId) return;

    try {
      const response = await visitChecklistsApi.createFromTemplate(householdId, template.id, {});
      setChecklists((prev) => [response.checklist, ...prev]);
      navigation.navigate('ChecklistEditor', { checklistId: response.checklist.id });
    } catch (error) {
      Alert.alert('Error', 'Failed to create checklist from template');
    }
  };

  return (
    <AppBackground>
      <ScreenHeader
        title="Checklists"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={
          <TouchableOpacity onPress={handleCreateNew} style={styles.headerButton}>
            <Icon name="add-circle" size={28} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      <View style={styles.container}>
        {/* Tabs */}
        <View style={styles.tabsContainer}>
          <Tab
            label="My Checklists"
            isActive={activeTab === 'my-checklists'}
            onPress={() => setActiveTab('my-checklists')}
            count={checklists.length}
          />
          <Tab
            label="Templates"
            isActive={activeTab === 'templates'}
            onPress={() => setActiveTab('templates')}
            count={templates.length}
          />
        </View>

        {isLoading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            style={[screenScrollViewStyle.scroll, styles.scrollView]}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <AdaptiveContainer style={styles.stack}>
              {activeTab === 'my-checklists' ? (
                checklists.length > 0 ? (
                  checklists.map((checklist) => (
                    <ChecklistCard
                      key={checklist.id}
                      checklist={checklist}
                      onPress={() => handleChecklistPress(checklist)}
                      onDelete={() => handleDeleteChecklist(checklist)}
                    />
                  ))
                ) : (
                  <EmptyState
                    message="No checklists yet. Create one to prepare for your next contractor visit."
                    icon="list"
                    action={handleCreateNew}
                    actionLabel="Create Checklist"
                  />
                )
              ) : templates.length > 0 ? (
                templates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onUse={() => handleUseTemplate(template)}
                  />
                ))
              ) : (
                <EmptyState message="No templates available" icon="document-text-outline" />
              )}
            </AdaptiveContainer>
          </ScrollView>
        )}
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  // The ScrollView has a single child (AdaptiveContainer), so the vertical
  // rhythm has to live here — otherwise every card stacks flush.
  stack: {
    gap: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerButton: {
    padding: 4,
  },
  // Tabs
  tabsContainer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  tabBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  // Card
  card: {
    borderRadius: 20,
    padding: 16,
    shadowColor: 'rgba(0,0,0,1)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    padding: 4,
  },
  specialtyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  // Progress
  progressSection: {
    marginTop: 12,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  // Template
  templateFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  useButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyAction: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
});

export default ChecklistsScreen;
