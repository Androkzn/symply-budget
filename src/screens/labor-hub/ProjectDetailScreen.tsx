import { useNavigation, useRoute, type RouteProp } from "expo-router/react-navigation";
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  projectsApi,
  type ProjectWithDetails,
  type ProjectMilestone,
  type ProjectPayment,
  type ProjectStatus,
  type MilestoneStatus,
  type PaymentType,
  type PaymentStatus,
  PROJECT_STATUS_INFO,
} from '@api/projects';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { ContractorsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useProjectStore } from '@stores/projectStore';
import { useAppColors, type AppColors } from '@theme';
import { getContractorCategoryIcon, type IoniconName } from '@utils/categoryIcons';
import { formatMoney, useDisplayCurrency } from '@utils/money';

// Define status info objects locally since they're not exported from the API.
// Built as functions of the theme color set so colors come from useAppColors().
function getMilestoneStatusInfo(
  colors: AppColors
): Record<MilestoneStatus, { label: string; color: string }> {
  return {
    pending: { label: 'Pending', color: colors.warning },
    in_progress: { label: 'In Progress', color: colors.accent },
    completed: { label: 'Completed', color: colors.success },
  };
}

function getPaymentStatusInfo(
  colors: AppColors
): Record<PaymentStatus, { label: string; color: string }> {
  return {
    pending: { label: 'Pending', color: colors.warning },
    paid: { label: 'Paid', color: colors.success },
  };
}

function getPaymentTypeInfo(
  colors: AppColors
): Record<PaymentType, { label: string; color: string }> {
  return {
    deposit: { label: 'Deposit', color: colors.info },
    progress: { label: 'Progress', color: colors.accent },
    final: { label: 'Final', color: colors.success },
    change_order: { label: 'Change Order', color: colors.warning },
  };
}

type ProjectDetailRoute = RouteProp<ContractorsStackParamList, 'ProjectDetail'>;

// Format currency from cents in the user's display currency.
function formatCurrency(cents: number): string {
  return formatMoney(cents);
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

// Milestone Card Component
interface MilestoneCardProps {
  milestone: ProjectMilestone;
  onToggle: () => void;
  disabled?: boolean;
}

function MilestoneCard({ milestone, onToggle, disabled }: MilestoneCardProps) {  const colors = useAppColors();
  const milestoneStatusInfo = getMilestoneStatusInfo(colors);
  const statusInfo = milestoneStatusInfo[milestone.status] || milestoneStatusInfo.pending;
  const isCompleted = milestone.status === 'completed';

  return (
    <TouchableOpacity
      style={[styles.milestoneCard, { backgroundColor: colors.groupedListBackground }]}
      onPress={onToggle}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <View
        style={[
          styles.milestoneCheckbox,
          {
            backgroundColor: isCompleted ? statusInfo.color : 'transparent',
            borderColor: statusInfo.color,
          },
        ]}
      >
        {isCompleted && <Icon name="checkmark" size={16} color={colors.white} />}
      </View>
      <View style={styles.milestoneContent}>
        <Typography
          variant="subheadline"
          weight="medium"
          style={isCompleted ? { textDecorationLine: 'line-through', opacity: 0.7 } : undefined}
        >
          {milestone.title}
        </Typography>
        {milestone.due_date && (
          <Typography variant="caption2" color="secondary">
            Due: {formatDate(milestone.due_date)}
          </Typography>
        )}
      </View>
      <View style={[styles.milestoneBadge, { backgroundColor: statusInfo.color + '20' }]}>
        <Typography variant="caption2" weight="medium" style={{ color: statusInfo.color }}>
          {statusInfo.label}
        </Typography>
      </View>
    </TouchableOpacity>
  );
}

// Payment Card Component
interface PaymentCardProps {
  payment: ProjectPayment;
  onMarkPaid?: () => void;
}

function PaymentCard({ payment, onMarkPaid }: PaymentCardProps) {
  const colors = useAppColors();
  const paymentTypeInfo = getPaymentTypeInfo(colors);
  const paymentStatusInfo = getPaymentStatusInfo(colors);
  const typeInfo = paymentTypeInfo[payment.type] || paymentTypeInfo.progress;
  const statusInfo = paymentStatusInfo[payment.status] || paymentStatusInfo.pending;
  const isPaid = payment.status === 'paid';

  return (
    <View style={[styles.paymentCard, { backgroundColor: colors.groupedListBackground }]}>
      <View style={styles.paymentHeader}>
        <View style={[styles.paymentType, { backgroundColor: typeInfo.color + '20' }]}>
          <Typography variant="caption2" weight="medium" style={{ color: typeInfo.color }}>
            {typeInfo.label}
          </Typography>
        </View>
        <View style={[styles.paymentStatus, { backgroundColor: statusInfo.color + '20' }]}>
          <Typography variant="caption2" weight="medium" style={{ color: statusInfo.color }}>
            {statusInfo.label}
          </Typography>
        </View>
      </View>

      <View style={styles.paymentAmount}>
        <Typography variant="headline" weight="bold">
          {formatCurrency(payment.amount_cents)}
        </Typography>
        {payment.due_date && !isPaid && (
          <Typography variant="caption2" color="secondary">
            Due: {formatDate(payment.due_date)}
          </Typography>
        )}
        {payment.paid_date && (
          <Typography variant="caption2" color="success">
            Paid: {formatDate(payment.paid_date)}
          </Typography>
        )}
      </View>

      {!isPaid && onMarkPaid && (
        <TouchableOpacity
          style={[styles.markPaidButton, { backgroundColor: colors.success }]}
          onPress={onMarkPaid}
        >
          <Icon name="checkmark" size={18} color={colors.white} />
          <Typography variant="caption1" weight="semibold" color="onPrimary" style={{ marginLeft: 4 }}>
            Mark Paid
          </Typography>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Section Header Component
interface SectionHeaderProps {
  title: string;
  icon: IoniconName;
  count?: number;
  onAdd?: () => void;
}

function SectionHeader({ title, icon, count, onAdd }: SectionHeaderProps) {
  const colors = useAppColors();

  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitle}>
        <Icon name={icon} size={18} color={colors.textSecondary} />
        <Typography variant="headline" weight="semibold" style={{ marginLeft: 8 }}>
          {title}
        </Typography>
        {count !== undefined && (
          <View style={[styles.sectionCount, { backgroundColor: colors.primary }]}>
            <Typography variant="caption2" weight="semibold" color="onPrimary">
              {count}
            </Typography>
          </View>
        )}
      </View>
      {onAdd && (
        <TouchableOpacity onPress={onAdd}>
          <Icon name="add-circle" size={24} color={colors.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// Main Screen Component
export function ProjectDetailScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  const navigation = useNavigation<any>();
  const route = useRoute<ProjectDetailRoute>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();
  const { updateProject, updateMilestone, updatePayment, removeProject } = useProjectStore();

  const [project, setProject] = useState<ProjectWithDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const { projectId } = route.params;
  const householdId = currentHousehold?.id;

  const fetchProject = useCallback(async () => {
    if (!householdId) return;

    setIsLoading(true);
    try {
      const response = await projectsApi.getOne(householdId, projectId);
      setProject(response.project);
    } catch (error) {
      console.error('Error fetching project:', error);
      Alert.alert('Error', 'Failed to load project details');
    } finally {
      setIsLoading(false);
    }
  }, [householdId, projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  const handleStatusChange = async (newStatus: ProjectStatus) => {
    if (!householdId || !project) return;

    setIsUpdating(true);
    try {
      const response = await projectsApi.update(householdId, projectId, { status: newStatus });
      setProject(response.project);
      updateProject(projectId, response.project);
    } catch (error) {
      console.error('Error updating project:', error);
      Alert.alert('Error', 'Failed to update project status');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleMilestone = async (milestone: ProjectMilestone) => {
    if (!householdId || !project) return;

    const newStatus = milestone.status === 'completed' ? 'pending' : 'completed';
    const completedDate = newStatus === 'completed' ? new Date().toISOString() : undefined;

    setIsUpdating(true);
    try {
      const response = await projectsApi.updateMilestone(householdId, projectId, milestone.id, {
        status: newStatus,
        completed_date: completedDate,
      });
      // Update local project state with the updated milestone
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          milestones: prev.milestones.map((m) =>
            m.id === milestone.id ? response.milestone : m
          ),
        };
      });
      updateMilestone(projectId, milestone.id, {
        status: newStatus,
        completed_date: completedDate,
      });
    } catch (error) {
      console.error('Error updating milestone:', error);
      Alert.alert('Error', 'Failed to update milestone');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleMarkPaymentPaid = async (payment: ProjectPayment) => {
    if (!householdId || !project) return;

    Alert.alert(
      'Mark as Paid',
      `Mark ${formatCurrency(payment.amount_cents)} payment as paid?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Paid',
          onPress: async () => {
            setIsUpdating(true);
            try {
              const paidDate = new Date().toISOString();
              const response = await projectsApi.updatePayment(householdId, projectId, payment.id, {
                status: 'paid',
                paid_date: paidDate,
              });
              // Update local project state with the updated payment
              setProject((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  payments: prev.payments.map((p) =>
                    p.id === payment.id ? response.payment : p
                  ),
                };
              });
              updatePayment(projectId, payment.id, {
                status: 'paid',
                paid_date: paidDate,
              });
            } catch (error) {
              console.error('Error updating payment:', error);
              Alert.alert('Error', 'Failed to update payment');
            } finally {
              setIsUpdating(false);
            }
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    if (!householdId) return;

    Alert.alert(
      'Delete Project',
      'Are you sure you want to delete this project? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await projectsApi.delete(householdId, projectId);
              removeProject(projectId);
              navigation.goBack();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete project');
            }
          },
        },
      ]
    );
  };

  const handleViewContractor = () => {
    if (project) {
      navigation.navigate('ContractorDetail', { contractorId: project.contractor_id });
    }
  };

  const handleCallContractor = () => {
    if (project?.contractor.phone) {
      Linking.openURL(`tel:${project.contractor.phone}`);
    }
  };

  const handleScheduleAppointment = () => {
    if (project) {
      navigation.navigate('AddEditAppointment', {
        contractorId: project.contractor_id,
        linkedProjectId: project.id,
      });
    }
  };

  const renderScreenHeader = (rightElement?: React.ReactNode) => (
    <ScreenHeader
      title="Project"
      showBackButton
      onBackPress={() => navigation.goBack()}
      showNotificationBell={false}
      showAvatar={false}
      rightElement={rightElement}
    />
  );

  if (isLoading) {
    return (
      <AppBackground>
        {renderScreenHeader()}
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  if (!project) {
    return (
      <AppBackground>
        {renderScreenHeader()}
        <View style={styles.errorContainer}>
          <Typography variant="headline" color="secondary">
            Project not found
          </Typography>
        </View>
      </AppBackground>
    );
  }

  const statusInfo = PROJECT_STATUS_INFO[project.status] || PROJECT_STATUS_INFO.planning;
  const progress = project.progress;
  const progressPercent =
    progress.totalMilestones > 0
      ? Math.round((progress.completedMilestones / progress.totalMilestones) * 100)
      : 0;
  const budgetPercent =
    progress.totalAmount > 0 ? Math.round((progress.paidAmount / progress.totalAmount) * 100) : 0;

  const isActive = ['planning', 'in_progress', 'on_hold'].includes(project.status);

  return (
    <AppBackground>
      {renderScreenHeader(
        <TouchableOpacity onPress={handleDelete} style={styles.deleteButton}>
          <Icon name="trash-outline" size={24} color={colors.error} />
        </TouchableOpacity>
      )}

      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.scrollView]}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
      >
        <AdaptiveContainer style={styles.stack}>
          {/* Header Card */}
          <View style={[styles.headerCard, { backgroundColor: colors.backgroundSecondary }]}>
            <View style={styles.headerRow}>
              <View style={[styles.typeIcon, { backgroundColor: statusInfo.color + '20' }]}>
                <Icon name="hammer" size={26} color={statusInfo.color} />
              </View>
              <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '20' }]}>
                <Typography variant="caption1" weight="semibold" style={{ color: statusInfo.color }}>
                  {statusInfo.label}
                </Typography>
              </View>
            </View>

            <Typography variant="title2" weight="bold" style={{ marginTop: 16 }}>
              {project.title}
            </Typography>

            {project.description && (
              <Typography variant="body" color="secondary" style={{ marginTop: 8 }}>
                {project.description}
              </Typography>
            )}

            {/* Progress Overview */}
            <View style={styles.progressOverview}>
              <View style={styles.progressItem}>
                <Typography variant="caption1" color="secondary">
                  Progress
                </Typography>
                <Typography variant="title3" weight="bold" style={{ color: statusInfo.color }}>
                  {progressPercent}%
                </Typography>
                <Typography variant="caption2" color="secondary">
                  {progress.completedMilestones}/{progress.totalMilestones} milestones
                </Typography>
              </View>
              <View style={[styles.progressDivider, { backgroundColor: colors.borderColor }]} />
              <View style={styles.progressItem}>
                <Typography variant="caption1" color="secondary">
                  Budget
                </Typography>
                <Typography variant="title3" weight="bold" style={{ color: colors.success }}>
                  {budgetPercent}%
                </Typography>
                <Typography variant="caption2" color="secondary">
                  {formatCurrency(progress.paidAmount)} / {formatCurrency(progress.totalAmount)}
                </Typography>
              </View>
            </View>
          </View>

          {/* Quick Actions */}
          {isActive && (
            <View style={[styles.actionsCard, { backgroundColor: colors.backgroundSecondary }]}>
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: colors.primary + '15' }]}
                  onPress={handleScheduleAppointment}
                >
                  <Icon name="calendar" size={20} color={colors.primary} />
                  <Typography variant="caption1" weight="medium" color="primary" style={{ marginTop: 4 }}>
                    Schedule
                  </Typography>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: colors.success + '15' }]}
                  onPress={handleCallContractor}
                >
                  <Icon name="call" size={20} color={colors.success} />
                  <Typography variant="caption1" weight="medium" style={{ color: colors.success, marginTop: 4 }}>
                    Call
                  </Typography>
                </TouchableOpacity>
                {project.status === 'planning' && (
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: colors.accent + '15' }]}
                    onPress={() => handleStatusChange('in_progress')}
                    disabled={isUpdating}
                  >
                    <Icon name="play" size={20} color={colors.primary} />
                    <Typography variant="caption1" weight="medium" style={{ color: colors.primary, marginTop: 4 }}>
                      Start
                    </Typography>
                  </TouchableOpacity>
                )}
                {project.status === 'in_progress' && (
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: colors.success + '15' }]}
                    onPress={() => handleStatusChange('completed')}
                    disabled={isUpdating}
                  >
                    <Icon name="checkmark" size={20} color={colors.success} />
                    <Typography variant="caption1" weight="medium" style={{ color: colors.success, marginTop: 4 }}>
                      Complete
                    </Typography>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* Milestones */}
          <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
            <SectionHeader
              title="Milestones"
              icon="list"
              count={project.milestones.length}
            />
            {project.milestones.length > 0 ? (
              project.milestones
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((milestone) => (
                  <MilestoneCard
                    key={milestone.id}
                    milestone={milestone}
                    onToggle={() => handleToggleMilestone(milestone)}
                    disabled={isUpdating}
                  />
                ))
            ) : (
              <Typography variant="caption1" color="secondary" style={{ textAlign: 'center', paddingVertical: 20 }}>
                No milestones added yet
              </Typography>
            )}
          </View>

          {/* Payments */}
          <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
            <SectionHeader
              title="Payments"
              icon="card"
              count={project.payments.length}
            />
            {project.payments.length > 0 ? (
              project.payments.map((payment) => (
                <PaymentCard
                  key={payment.id}
                  payment={payment}
                  onMarkPaid={() => handleMarkPaymentPaid(payment)}
                />
              ))
            ) : (
              <Typography variant="caption1" color="secondary" style={{ textAlign: 'center', paddingVertical: 20 }}>
                No payments recorded yet
              </Typography>
            )}
          </View>

          {/* Contractor */}
          <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
            <SectionHeader title="Contractor" icon="construct" />
            <TouchableOpacity
              style={styles.contractorCard}
              onPress={handleViewContractor}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.contractorIcon,
                  { backgroundColor: project.contractor.specialtyInfo.color + '20' },
                ]}
              >
                <Icon
                  name={getContractorCategoryIcon(project.contractor.specialty)}
                  size={24}
                  color={project.contractor.specialtyInfo.color}
                />
              </View>
              <View style={styles.contractorInfo}>
                <Typography variant="subheadline" weight="semibold">
                  {project.contractor.name}
                </Typography>
                {project.contractor.company_name && (
                  <Typography variant="caption1" color="secondary">
                    {project.contractor.company_name}
                  </Typography>
                )}
                <Typography
                  variant="caption2"
                  weight="medium"
                  style={{ color: project.contractor.specialtyInfo.color }}
                >
                  {project.contractor.specialtyInfo.label}
                </Typography>
              </View>
              <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Timeline */}
          {(project.start_date || project.estimated_end_date) && (
            <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
              <SectionHeader title="Timeline" icon="calendar" />
              <View style={styles.timelineContent}>
                {project.start_date && (
                  <View style={styles.timelineItem}>
                    <Icon name="flag" size={20} color={colors.primary} />
                    <View style={{ marginLeft: 12 }}>
                      <Typography variant="caption1" color="secondary">
                        Start Date
                      </Typography>
                      <Typography variant="subheadline" weight="medium">
                        {formatDate(project.start_date)}
                      </Typography>
                    </View>
                  </View>
                )}
                {project.estimated_end_date && (
                  <View style={styles.timelineItem}>
                    <Icon name="checkmark-circle" size={20} color={colors.success} />
                    <View style={{ marginLeft: 12 }}>
                      <Typography variant="caption1" color="secondary">
                        Estimated End
                      </Typography>
                      <Typography variant="subheadline" weight="medium">
                        {formatDate(project.estimated_end_date)}
                      </Typography>
                    </View>
                  </View>
                )}
                {project.actual_end_date && (
                  <View style={styles.timelineItem}>
                    <Icon name="checkmark-done-circle" size={20} color={colors.success} />
                    <View style={{ marginLeft: 12 }}>
                      <Typography variant="caption1" color="secondary">
                        Completed
                      </Typography>
                      <Typography variant="subheadline" weight="medium">
                        {formatDate(project.actual_end_date)}
                      </Typography>
                    </View>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Notes */}
          {project.notes && (
            <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
              <SectionHeader title="Notes" icon="create" />
              <Typography variant="body" color="secondary">
                {project.notes}
              </Typography>
            </View>
          )}
        </AdaptiveContainer>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    padding: 4,
    width: 40,
  },
  headerRight: {
    width: 40,
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    padding: 4,
    width: 40,
    alignItems: 'flex-end',
  },
  // Header Card
  headerCard: {
    borderRadius: 20,
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  typeIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  progressOverview: {
    flexDirection: 'row',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  progressItem: {
    flex: 1,
    alignItems: 'center',
  },
  progressDivider: {
    width: 1,
    height: '100%',
    marginHorizontal: 16,
  },
  // Actions
  actionsCard: {
    borderRadius: 20,
    padding: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  // Section
  section: {
    borderRadius: 20,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionCount: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  // Milestone
  milestoneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  milestoneCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  milestoneContent: {
    flex: 1,
  },
  milestoneBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  // Payment
  paymentCard: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  paymentHeader: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  paymentType: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  paymentStatus: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  paymentAmount: {
    marginBottom: 8,
  },
  markPaidButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 8,
  },
  // Contractor
  contractorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  contractorIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  contractorInfo: {
    flex: 1,
    gap: 2,
  },
  // Timeline
  timelineContent: {
    gap: 16,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

export default ProjectDetailScreen;
