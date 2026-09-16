import { useFocusEffect, useNavigation, useRoute } from 'expo-router/react-navigation';
import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useAppColors, type AppColors } from '@theme';

import { visitChecklistsApi } from '../../api/visit-checklists';
import { useHouseholdStore } from '../../stores/householdStore';

interface ContractorComparisonRouteParams {
  taskId: string;
}

interface Contractor {
  id: string;
  household_id: string;
  company_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  specialty: string | null;
  rating: number | null;
  notes: string | null;
  created_at: string;
}

interface Visit {
  id: string;
  contractor_id: string;
  household_id: string;
  visit_date: string;
  description: string | null;
  cost: number | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  notes: string | null;
  rating: number | null;
  contractor_rep_name: string | null;
  visit_mode_started_at: string | null;
  visit_mode_ended_at: string | null;
  created_at: string;
}

interface Quote {
  id: string;
  household_id: string;
  contractor_id: string;
  task_id: string | null;
  total_price: number;
  notes: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

interface Checklist {
  id: string;
  household_id: string;
  appointment_id: string | null;
  visit_id: string | null;
  title: string;
  template_id: string | null;
  contractor_specialty: string | null;
  task_id: string | null;
  created_at: string;
}

interface Task {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string;
  created_at: string;
}

interface ContractorData {
  contractor: Contractor;
  visit?: Visit;
  checklist?: Checklist;
  quote?: Quote;
  checklistProgress: { completed: number; total: number };
  keyResponses: Array<{ question: string; answer: string; priority: string }>;
}

export const ContractorComparisonScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { taskId } = (route.params ?? {}) as ContractorComparisonRouteParams;
  const colors = useAppColors();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);

  const [task, setTask] = useState<Task | null>(null);
  const [contractors, setContractors] = useState<ContractorData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedContractorId, setSelectedContractorId] = useState<string | null>(null);

  const loadComparison = async () => {
    if (!currentHousehold) return;

    setIsLoading(true);
    try {
      const data = await visitChecklistsApi.getMultiContractorComparison(
        currentHousehold.id,
        taskId
      );

      setTask(data.task);
      setContractors(data.contractors);

      // Auto-select first contractor
      if (data.contractors.length > 0 && !selectedContractorId) {
        setSelectedContractorId(data.contractors[0].contractor.id);
      }
    } catch (error) {
      console.error('Failed to load comparison:', error);
      Alert.alert('Error', 'Failed to load contractor comparison. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadComparison();
    }, [taskId, currentHousehold])
  );

  const handleViewChecklist = (contractorId: string) => {
    const contractorData = contractors.find((c) => c.contractor.id === contractorId);
    if (contractorData?.checklist) {
      navigation.navigate('VisitChecklist', {
        checklistId: contractorData.checklist.id,
        taskId,
        contractorId,
        visitId: contractorData.visit?.id,
      });
    }
  };

  if (isLoading) {
    return (
      <AppBackground>
        <ScreenHeader
          title="Contractor Comparison"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  if (contractors.length === 0) {
    return (
      <AppBackground>
        <ScreenHeader
          title="Contractor Comparison"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />
        <View style={styles.emptyContainer}>
        <Icon name="clipboard-check-multiple-outline" size={64} color={colors.textTertiary} />
        <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary} style={styles.emptyTitle}>
          No Contractors to Compare
        </Typography>
        <Typography variant="bodySmall" color={colors.textTertiary} style={styles.emptyText}>
          Visit checklists will appear here once you meet with contractors for this task.
        </Typography>
      </View>
      </AppBackground>
    );
  }

  const selectedContractor = contractors.find((c) => c.contractor.id === selectedContractorId);

  return (
    <AppBackground>
      <ScreenHeader
        title="Contractor Comparison"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

      {task?.title ? (
        <Typography variant="bodySmall" color={colors.textTertiary} style={styles.taskSubtitle}>
          {task.title}
        </Typography>
      ) : null}

      {/* Contractor tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[
          styles.tabsContainer,
          { backgroundColor: colors.card, borderBottomColor: colors.borderColor },
        ]}
      >
        {contractors.map((contractorData) => (
          <TouchableOpacity
            key={contractorData.contractor.id}
            style={[
              styles.tab,
              selectedContractorId === contractorData.contractor.id && {
                borderBottomColor: colors.primary,
              },
            ]}
            onPress={() => setSelectedContractorId(contractorData.contractor.id)}
          >
            <Typography
              variant="labelRegular"
              weight={
                selectedContractorId === contractorData.contractor.id ? 'semibold' : 'medium'
              }
              color={
                selectedContractorId === contractorData.contractor.id
                  ? colors.primary
                  : colors.textTertiary
              }
              style={styles.tabText}
            >
              {contractorData.contractor.company_name || contractorData.contractor.contact_name}
            </Typography>
            {contractorData.checklistProgress.total > 0 && (
              <View style={[styles.progressBadge, { backgroundColor: colors.backgroundSecondary }]}>
                <Typography variant="captionSmall" weight="semibold" color={colors.textTertiary}>
                  {contractorData.checklistProgress.completed}/{contractorData.checklistProgress.total}
                </Typography>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Comparison content */}
      {selectedContractor && (
        <ScrollView style={[screenScrollViewStyle.scroll, styles.content]} showsVerticalScrollIndicator={false}>
          {/* Contractor info card */}
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardHeader}>
              <Icon name="account-tie" size={24} color={colors.primary} />
              <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary}>
                Contractor Information
              </Typography>
            </View>
            <View style={styles.infoRow}>
              <Typography variant="bodySmall" color={colors.textTertiary} style={styles.infoLabel}>
                Company:
              </Typography>
              <Typography variant="bodySmall" weight="medium" color={colors.textPrimary} style={styles.infoValue}>
                {selectedContractor.contractor.company_name || 'N/A'}
              </Typography>
            </View>
            <View style={styles.infoRow}>
              <Typography variant="bodySmall" color={colors.textTertiary} style={styles.infoLabel}>
                Contact:
              </Typography>
              <Typography variant="bodySmall" weight="medium" color={colors.textPrimary} style={styles.infoValue}>
                {selectedContractor.contractor.contact_name || 'N/A'}
              </Typography>
            </View>
            {selectedContractor.contractor.phone && (
              <View style={styles.infoRow}>
                <Typography variant="bodySmall" color={colors.textTertiary} style={styles.infoLabel}>
                  Phone:
                </Typography>
                <Typography variant="bodySmall" weight="medium" color={colors.primary} style={styles.infoValue}>
                  {selectedContractor.contractor.phone}
                </Typography>
              </View>
            )}
            {selectedContractor.contractor.email && (
              <View style={styles.infoRow}>
                <Typography variant="bodySmall" color={colors.textTertiary} style={styles.infoLabel}>
                  Email:
                </Typography>
                <Typography variant="bodySmall" weight="medium" color={colors.primary} style={styles.infoValue}>
                  {selectedContractor.contractor.email}
                </Typography>
              </View>
            )}
          </View>

          {/* Visit info card */}
          {selectedContractor.visit && (
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.cardHeader}>
                <Icon name="calendar-check" size={24} color={colors.success} />
                <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary}>
                  Visit Details
                </Typography>
              </View>
              <View style={styles.infoRow}>
                <Typography variant="bodySmall" color={colors.textTertiary} style={styles.infoLabel}>
                  Date:
                </Typography>
                <Typography variant="bodySmall" weight="medium" color={colors.textPrimary} style={styles.infoValue}>
                  {new Date(selectedContractor.visit.visit_date).toLocaleDateString()}
                </Typography>
              </View>
              <View style={styles.infoRow}>
                <Typography variant="bodySmall" color={colors.textTertiary} style={styles.infoLabel}>
                  Status:
                </Typography>
                <View style={[styles.statusBadge, getStatusStyle(selectedContractor.visit.status, colors)]}>
                  <Typography variant="caption" weight="semibold" color={colors.textPrimary} style={styles.statusText}>
                    {selectedContractor.visit.status}
                  </Typography>
                </View>
              </View>
              {selectedContractor.visit.contractor_rep_name && (
                <View style={styles.infoRow}>
                  <Typography variant="bodySmall" color={colors.textTertiary} style={styles.infoLabel}>
                    Representative:
                  </Typography>
                  <Typography variant="bodySmall" weight="medium" color={colors.textPrimary} style={styles.infoValue}>
                    {selectedContractor.visit.contractor_rep_name}
                  </Typography>
                </View>
              )}
              {selectedContractor.visit.notes && (
                <View style={[styles.notesContainer, { borderTopColor: colors.divider }]}>
                  <Typography variant="caption" weight="semibold" color={colors.textTertiary} style={styles.notesLabel}>
                    Visit Notes:
                  </Typography>
                  <Typography variant="bodySmall" color={colors.textPrimary} style={styles.notesText}>
                    {selectedContractor.visit.notes}
                  </Typography>
                </View>
              )}
            </View>
          )}

          {/* Quote info card */}
          {selectedContractor.quote && (
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.cardHeader}>
                <Icon name="currency-usd" size={24} color={colors.warning} />
                <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary}>
                  Quote
                </Typography>
              </View>
              <View style={styles.quoteAmount}>
                <Typography variant="bodySmall" color={colors.textTertiary}>
                  Quoted Price:
                </Typography>
                <Typography variant="heading" weight="bold" color={colors.warning}>
                  ${(selectedContractor.quote.total_price / 100).toLocaleString()}
                </Typography>
              </View>
              {selectedContractor.quote.notes && (
                <View style={[styles.notesContainer, { borderTopColor: colors.divider }]}>
                  <Typography variant="caption" weight="semibold" color={colors.textTertiary} style={styles.notesLabel}>
                    Quote Notes:
                  </Typography>
                  <Typography variant="bodySmall" color={colors.textPrimary} style={styles.notesText}>
                    {selectedContractor.quote.notes}
                  </Typography>
                </View>
              )}
            </View>
          )}

          {/* Checklist progress */}
          {selectedContractor.checklist && (
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.cardHeader}>
                <Icon name="clipboard-check" size={24} color={colors.info} />
                <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary}>
                  Checklist Progress
                </Typography>
              </View>
              <View style={styles.progressContainer}>
                <View style={styles.progressInfo}>
                  <Typography variant="heading" weight="bold" color={colors.primary}>
                    {selectedContractor.checklistProgress.completed}
                  </Typography>
                  <Typography variant="caption" color={colors.textTertiary} style={styles.progressLabel}>
                    Completed
                  </Typography>
                </View>
                <View style={[styles.progressDivider, { backgroundColor: colors.borderColor }]} />
                <View style={styles.progressInfo}>
                  <Typography variant="heading" weight="bold" color={colors.primary}>
                    {selectedContractor.checklistProgress.total}
                  </Typography>
                  <Typography variant="caption" color={colors.textTertiary} style={styles.progressLabel}>
                    Total
                  </Typography>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.viewChecklistButton, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleViewChecklist(selectedContractor.contractor.id)}
              >
                <Icon name="eye" size={20} color={colors.primary} />
                <Typography variant="labelRegular" weight="semibold" color={colors.primary}>
                  View Full Checklist
                </Typography>
              </TouchableOpacity>
            </View>
          )}

          {/* Key responses */}
          {selectedContractor.keyResponses.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.cardHeader}>
                <Icon name="message-text" size={24} color={colors.primary} />
                <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary}>
                  Key Responses
                </Typography>
              </View>
              {selectedContractor.keyResponses.map((response, index) => (
                <View key={index} style={[styles.responseCard, { backgroundColor: colors.backgroundSecondary }]}>
                  <View style={styles.responseHeader}>
                    <Typography variant="bodySmall" weight="semibold" color={colors.textPrimary} style={styles.responseQuestion}>
                      {response.question}
                    </Typography>
                    <View style={[styles.priorityBadge, getPriorityStyle(response.priority, colors)]}>
                      <Typography variant="micro" weight="semibold" color={colors.textPrimary} style={styles.priorityText}>
                        {response.priority}
                      </Typography>
                    </View>
                  </View>
                  {response.answer ? (
                    <Typography variant="bodySmall" color={colors.textSecondary} style={styles.responseAnswer}>
                      {response.answer}
                    </Typography>
                  ) : (
                    <Typography variant="bodySmall" color={colors.textTertiary} style={styles.responseNoAnswer}>
                      No response recorded
                    </Typography>
                  )}
                </View>
              ))}
            </View>
          )}

          <View style={styles.bottomPadding} />
        </ScrollView>
      )}
    </AppBackground>
  );
};

const getStatusStyle = (status: string, colors: AppColors) => {
  switch (status) {
    case 'scheduled':
      return { backgroundColor: colors.surfaceSelected };
    case 'completed':
      return { backgroundColor: colors.statusCompleteBg };
    case 'cancelled':
      return { backgroundColor: colors.backgroundSecondary };
    default:
      return { backgroundColor: colors.statusSoonBg };
  }
};

const getPriorityStyle = (priority: string, colors: AppColors) => {
  switch (priority) {
    case 'must_ask':
      return { backgroundColor: colors.destructiveSubtle };
    case 'nice_to_have':
      return { backgroundColor: colors.statusSoonBg };
    default:
      return { backgroundColor: colors.backgroundSecondary };
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    marginTop: 16,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  taskSubtitle: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  tabsContainer: {
    borderBottomWidth: 1,
    maxHeight: 60,
  },
  tab: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginHorizontal: 4,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabText: {
    marginBottom: 4,
  },
  progressBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  content: {
    flex: 1,
  },
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: 'rgba(0,0,0,1)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoLabel: {
    width: 100,
  },
  infoValue: {
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    textTransform: 'capitalize',
  },
  notesContainer: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  notesLabel: {
    marginBottom: 6,
  },
  notesText: {
    lineHeight: 20,
  },
  quoteAmount: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 16,
  },
  progressInfo: {
    alignItems: 'center',
  },
  progressLabel: {
    marginTop: 4,
  },
  progressDivider: {
    width: 1,
    height: 40,
  },
  viewChecklistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  responseCard: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  responseHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 12,
  },
  responseQuestion: {
    flex: 1,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  priorityText: {
    textTransform: 'uppercase',
  },
  responseAnswer: {
    lineHeight: 20,
  },
  responseNoAnswer: {
    fontStyle: 'italic',
  },
  bottomPadding: {
    height: 32,
  },
});
