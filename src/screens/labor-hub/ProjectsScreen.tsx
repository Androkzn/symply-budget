import { useNavigation } from "expo-router/react-navigation";
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  projectsApi,
  type ProjectWithDetails,
  type ProjectStatus,
  PROJECT_STATUSES,
  PROJECT_STATUS_INFO,
} from '@api/projects';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useHouseholdStore } from '@stores/householdStore';
import { useProjectStore } from '@stores/projectStore';
import { useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';
import { formatMoney, useDisplayCurrency } from '@utils/money';

// Format currency from cents, compactly ("CA$1.2k") in the display currency.
function formatCurrency(cents: number): string {
  return formatMoney(cents, { abbreviate: true });
}

// Format date for display
function formatDate(dateString: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type FilterStatus = 'all' | ProjectStatus;

// Project Card Component
interface ProjectCardProps {
  project: ProjectWithDetails;
  onPress: () => void;
}

function ProjectCard({ project, onPress }: ProjectCardProps) {
  const colors = useAppColors();
  const statusInfo = PROJECT_STATUS_INFO[project.status] || PROJECT_STATUS_INFO.planning;
  const progress = project.progress;

  const progressPercent =
    progress.totalMilestones > 0
      ? Math.round((progress.completedMilestones / progress.totalMilestones) * 100)
      : 0;

  const budgetPercent =
    progress.totalAmount > 0 ? Math.round((progress.paidAmount / progress.totalAmount) * 100) : 0;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.iconCircle, { backgroundColor: statusInfo.color + '20' }]}>
          <Icon name="hammer" size={22} color={statusInfo.color} />
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '20' }]}>
          <Typography variant="caption2" weight="medium" style={{ color: statusInfo.color }}>
            {statusInfo.label}
          </Typography>
        </View>
      </View>

      <Typography variant="headline" weight="bold" numberOfLines={1} style={{ marginTop: 12 }}>
        {project.title}
      </Typography>

      <Typography variant="caption1" color="secondary" numberOfLines={1}>
        {project.contractor.name}
        {project.contractor.company_name && ` - ${project.contractor.company_name}`}
      </Typography>

      {/* Progress Section */}
      <View style={styles.progressSection}>
        <View style={styles.progressRow}>
          <Typography variant="caption2" color="secondary">
            Progress
          </Typography>
          <Typography variant="caption2" weight="medium">
            {progress.completedMilestones}/{progress.totalMilestones} milestones
          </Typography>
        </View>
        <View style={[styles.progressBar, { backgroundColor: colors.groupedListBackground }]}>
          <View
            style={[styles.progressFill, { width: `${progressPercent}%`, backgroundColor: statusInfo.color }]}
          />
        </View>
      </View>

      {/* Budget Section */}
      <View style={styles.budgetSection}>
        <View style={styles.budgetRow}>
          <View>
            <Typography variant="caption2" color="secondary">
              Budget
            </Typography>
            <Typography variant="subheadline" weight="semibold">
              {formatCurrency(progress.totalAmount)}
            </Typography>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Typography variant="caption2" color="secondary">
              Paid
            </Typography>
            <Typography
              variant="subheadline"
              weight="semibold"
              style={{ color: colors.success }}
            >
              {formatCurrency(progress.paidAmount)} ({budgetPercent}%)
            </Typography>
          </View>
        </View>
      </View>

      {/* Timeline */}
      {(project.start_date || project.estimated_end_date) && (
        <View style={styles.timeline}>
          {project.start_date && (
            <View style={styles.timelineItem}>
              <Icon name="flag" size={14} color={colors.textSecondary} />
              <Typography variant="caption2" color="secondary" style={{ marginLeft: 4 }}>
                Start: {formatDate(project.start_date)}
              </Typography>
            </View>
          )}
          {project.estimated_end_date && (
            <View style={styles.timelineItem}>
              <Icon name="checkmark-circle" size={14} color={colors.textSecondary} />
              <Typography variant="caption2" color="secondary" style={{ marginLeft: 4 }}>
                Est. End: {formatDate(project.estimated_end_date)}
              </Typography>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

// Filter Chip Component
interface FilterChipProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  color?: string;
  count?: number;
}

function FilterChip({ label, isActive, onPress, color, count }: FilterChipProps) {
  const colors = useAppColors();

  return (
    <TouchableOpacity
      style={[
        styles.filterChip,
        {
          backgroundColor: isActive
            ? color || colors.primary
            : colors.groupedListBackground,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Typography
        variant="caption1"
        weight="medium"
        color={isActive ? 'onPrimary' : 'secondary'}
      >
        {label}
      </Typography>
      {count !== undefined && count > 0 && (
        <View
          style={[
            styles.countBadge,
            { backgroundColor: isActive ? 'rgba(255,255,255,0.3)' : colors.borderColor },
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
function EmptyState({ message, icon }: { message: string; icon: IoniconName }) {
  const colors = useAppColors();
  return (
    <View style={styles.emptyState}>
      <Icon name={icon} size={40} color={colors.textSecondary} style={{ opacity: 0.5 }} />
      <Typography variant="subheadline" color="secondary" style={{ marginTop: 8 }}>
        {message}
      </Typography>
    </View>
  );
}

// Main Screen Component
export function ProjectsScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();

  const { projects, setProjects, isLoading, setLoading } = useProjectStore();

  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  const householdId = currentHousehold?.id;

  const fetchData = useCallback(async () => {
    if (!householdId) return;

    setLoading(true);
    try {
      const response = await projectsApi.getAll(householdId);
      setProjects(response.projects);
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  }, [householdId, setProjects, setLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  // Filter projects
  const filteredProjects = useMemo(() => {
    let filtered = projects;

    if (filterStatus !== 'all') {
      filtered = filtered.filter((p) => p.status === filterStatus);
    }

    // Sort by start date / created date, most recent first
    return [...filtered].sort((a, b) => {
      const dateA = a.start_date || a.created_at;
      const dateB = b.start_date || b.created_at;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });
  }, [projects, filterStatus]);

  // Count by status
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: projects.length };
    PROJECT_STATUSES.forEach((status) => {
      counts[status] = projects.filter((p) => p.status === status).length;
    });
    return counts;
  }, [projects]);

  const handleProjectPress = (project: ProjectWithDetails) => {
    navigation.navigate('ProjectDetail', { projectId: project.id });
  };

  const handleAddProject = () => {
    navigation.navigate('AddEditProject', {});
  };

  return (
    <AppBackground>
      <ScreenHeader
        title="Projects"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={
          <TouchableOpacity onPress={handleAddProject} style={styles.headerButton}>
            <Icon name="add-circle" size={28} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      <View style={styles.container}>
        {/* Status Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[screenScrollViewStyle.scroll, styles.filterContainer]}
          contentContainerStyle={styles.filterContent}
        >
          <FilterChip
            label="All"
            isActive={filterStatus === 'all'}
            onPress={() => setFilterStatus('all')}
            count={statusCounts.all}
          />
          {PROJECT_STATUSES.map((status) => {
            const info = PROJECT_STATUS_INFO[status];
            return (
              <FilterChip
                key={status}
                label={info.label}
                isActive={filterStatus === status}
                onPress={() => setFilterStatus(status)}
                color={info.color}
                count={statusCounts[status]}
              />
            );
          })}
        </ScrollView>

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
              {filteredProjects.length > 0 ? (
                filteredProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onPress={() => handleProjectPress(project)}
                  />
                ))
              ) : (
                <EmptyState message="No projects found" icon="hammer" />
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
  // Filter
  filterContainer: {
    maxHeight: 50,
    marginTop: 8,
  },
  filterContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  // Card
  card: {
    borderRadius: 20,
    padding: 16,
    shadowColor: 'rgba(0, 0, 0, 1)',
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
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  // Progress
  progressSection: {
    marginTop: 16,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  // Budget
  budgetSection: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // Timeline
  timeline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
});

export default ProjectsScreen;
