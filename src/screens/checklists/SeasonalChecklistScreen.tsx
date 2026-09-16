import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, RefreshControl, Platform } from 'react-native';

import { 
  seasonalChecklistsApi, 
  SeasonalChecklist, 
  SeasonalChecklistItem,
  Season,
  SEASONS,
  getCurrentSeason,
} from '@api/seasonal-checklists';
import { SafeAreaView, AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography, Card, FilterTabs } from '@components/ui';
import type { FilterTab } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useData } from '@contexts/DataContext';
import type { RootStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface SeasonalChecklistScreenProps {
  onClose?: () => void;
}

export function SeasonalChecklistScreen({ onClose }: SeasonalChecklistScreenProps) {  const colors = useAppColors();
  const navigation = useNavigation<NavigationProp>();
  const { isLoading: isDataLoading } = useData();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);

  const [checklist, setChecklist] = useState<SeasonalChecklist | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<Season>(getCurrentSeason());
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!currentHousehold) return;

    try {
      setIsLoading(true);
      const result = await seasonalChecklistsApi.getCurrent(currentHousehold.id, {
        season: selectedSeason,
        year: new Date().getFullYear(),
      });
      setChecklist(result.checklist);
    } catch (error) {
      showToast('error', 'Failed to load checklist');
    } finally {
      setIsLoading(false);
    }
  }, [currentHousehold, selectedSeason]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleToggleItem = async (item: SeasonalChecklistItem) => {
    if (!currentHousehold || !checklist) return;

    try {
      setUpdatingItemId(item.id);
      const result = await seasonalChecklistsApi.updateItem(
        currentHousehold.id,
        checklist.id,
        item.id,
        { is_completed: !item.is_completed }
      );

      // Update local state
      setChecklist((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((i) => (i.id === item.id ? result.item : i)),
          progress: {
            ...prev.progress,
            completed: prev.progress.completed + (result.item.is_completed ? 1 : -1),
            percentage: Math.round(
              ((prev.progress.completed + (result.item.is_completed ? 1 : -1)) / prev.progress.total) * 100
            ),
          },
        };
      });
    } catch (error) {
      showToast('error', 'Failed to update item');
    } finally {
      setUpdatingItemId(null);
    }
  };

  const getSeasonIcon = (season: Season): keyof typeof Ionicons.glyphMap => {
    return (SEASONS.find((s) => s.id === season)?.icon || 'leaf') as keyof typeof Ionicons.glyphMap;
  };

  const getSeasonLabel = (season: Season): string => {
    return SEASONS.find((s) => s.id === season)?.label || season;
  };

  // Convert SEASONS to FilterTab format
  const seasonFilterTabs: FilterTab[] = SEASONS.map((season) => ({
    id: season.id,
    label: season.label,
    icon: season.icon,
  }));

  // Group items by category
  const groupedItems = checklist?.items.reduce((acc, item) => {
    const category = item.category || 'General';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, SeasonalChecklistItem[]>) || {};

  const handleBack = () => {
    if (onClose) onClose();
    else navigation.goBack();
  };

  const header = (
    <ScreenHeader
      title="Seasonal Checklist"
      showBackButton
      onBackPress={handleBack}
      showNotificationBell={false}
      showAvatar={false}
    />
  );

  // Show loading state while data is being fetched
  if (isDataLoading) {
    return (
      <AppBackground opacity={0.5}>
        {header}
        <SafeAreaView edges={[]}>
          <View style={styles.container}>
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Typography variant="body" color={colors.textSecondary} style={{ marginTop: 12 }}>
                Loading...
              </Typography>
            </View>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  if (!currentHousehold) {
    return (
      <AppBackground opacity={0.5}>
        {header}
        <SafeAreaView edges={[]}>
          <View style={styles.container}>
            <View style={styles.emptyState}>
              <Typography variant="title3" weight="semibold" align="center">
                No Home Selected
              </Typography>
            </View>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      {header}
      <SafeAreaView edges={[]}>
        <View style={styles.container}>
          {/* Season Selector */}
          <View style={styles.seasonSelector}>
            <FilterTabs
              tabs={seasonFilterTabs}
              activeTab={selectedSeason}
              onTabChange={(tabId) => setSelectedSeason(tabId as Season)}
              showActiveIndicator={false}
            />
          </View>

          {/* Progress Card */}
          {checklist && (
            <View style={styles.progressContainer}>
              <Card
                variant="filled"
                style={[styles.progressCard, { backgroundColor: colors.backgroundSecondary }]}
              >
                <View style={styles.progressHeader}>
                  <Icon name={getSeasonIcon(selectedSeason)} size={28} color={colors.primary} />
                  <View style={styles.progressInfo}>
                    <Typography variant="title3" weight="bold">
                      {getSeasonLabel(selectedSeason)} {checklist.year}
                    </Typography>
                    <Typography variant="footnote" color={colors.textSecondary}>
                      Pacific Northwest
                    </Typography>
                  </View>
                  <View style={styles.progressBadge}>
                    <Typography variant="headline" weight="bold" color={colors.success}>
                      {checklist.progress.percentage}%
                    </Typography>
                  </View>
                </View>

                <View style={styles.progressBarContainer}>
                  <View
                    style={[
                      styles.progressBar,
                      { width: `${checklist.progress.percentage}%`, backgroundColor: colors.success },
                    ]}
                  />
                </View>

                <Typography variant="caption1" color={colors.textSecondary}>
                  {checklist.progress.completed} of {checklist.progress.total} tasks completed
                </Typography>
              </Card>
            </View>
          )}

          {/* Checklist Items */}
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
            ) : Object.keys(groupedItems).length === 0 ? (
              <View style={styles.emptyState}>
                <Typography variant="body" color={colors.textSecondary} align="center">
                  No checklist items for this season yet.
                </Typography>
              </View>
            ) : (
              Object.entries(groupedItems).map(([category, items]) => (
                <View key={category} style={styles.categorySection}>
                  <Typography
                    variant="subheadline"
                    weight="semibold"
                    color={colors.textSecondary}
                    style={styles.categoryTitle}
                  >
                    {category.toUpperCase()}
                  </Typography>

                  <Card
                    variant="filled"
                    style={[styles.itemsCard, { backgroundColor: colors.backgroundSecondary }]}
                  >
                    {items.map((item, index) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[
                          styles.checklistItem,
                          index < items.length - 1 && styles.itemBorder,
                        ]}
                        onPress={() => handleToggleItem(item)}
                        disabled={updatingItemId === item.id}
                        activeOpacity={0.7}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            item.is_completed && {
                              backgroundColor: colors.success,
                              borderColor: colors.success,
                            },
                          ]}
                        >
                          {item.is_completed && (
                            <Icon name="checkmark" size={12} color={colors.white} />
                          )}
                          {updatingItemId === item.id && (
                            <ActivityIndicator size="small" color={colors.primary} />
                          )}
                        </View>
                        <View style={styles.itemContent}>
                          <Typography
                            variant="body"
                            style={item.is_completed && styles.completedText}
                          >
                            {item.title}
                          </Typography>
                          {item.notes && (
                            <Typography
                              variant="caption1"
                              color={colors.textSecondary}
                              numberOfLines={1}
                            >
                              {item.notes}
                            </Typography>
                          )}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </Card>
                </View>
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
  seasonSelector: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  progressContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  progressCard: {
    padding: 20,
    borderRadius: 20,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(0,0,0,1)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  progressInfo: {
    flex: 1,
    marginLeft: 12,
  },
  progressBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderRadius: 12,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    borderRadius: 4,
    marginBottom: 8,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  categorySection: {
    marginBottom: 20,
  },
  categoryTitle: {
    marginBottom: 8,
    marginLeft: 4,
  },
  itemsCard: {
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(0,0,0,1)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  itemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 0, 0, 0.08)',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(0, 0, 0, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  itemContent: {
    flex: 1,
  },
  completedText: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
});

export default SeasonalChecklistScreen;
