import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useRoute, type RouteProp } from "expo-router/react-navigation";
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert, TextInput, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { contractorsApi, type ContractorWithStats } from '@api/contractors';
import { projectsApi } from '@api/projects';
import { quotesApi } from '@api/quotes';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import type { ContractorsStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { useProjectStore } from '@stores/projectStore';
import { scaledFont, useAppColors } from '@theme';
import { keyboardDismissScrollProps, numericTextHandler } from '@utils/keyboard';

type AddEditProjectRoute = RouteProp<ContractorsStackParamList, 'AddEditProject'>;

// Form Field Component
interface FormFieldProps {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}

function FormField({ label, required, children }: FormFieldProps) {
  return (
    <View style={styles.formField}>
      <Typography variant="caption1" color="secondary" style={styles.fieldLabel}>
        {label}
        {required && <Typography color="error"> *</Typography>}
      </Typography>
      {children}
    </View>
  );
}

// Contractor Selector Component
interface ContractorSelectorProps {
  contractors: ContractorWithStats[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
  disabled?: boolean;
}

function ContractorSelector({
  contractors,
  selectedId,
  onSelect,
  isLoading,
  disabled,
}: ContractorSelectorProps) {
  const colors = useAppColors();
  if (isLoading) {
    return (
      <View style={styles.loadingSmall}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (contractors.length === 0) {
    return (
      <Typography variant="caption1" color="secondary">
        No contractors available.
      </Typography>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.contractorList}
    >
      {contractors.map((contractor) => {
        const isSelected = selectedId === contractor.id;
        return (
          <TouchableOpacity
            key={contractor.id}
            style={[
              styles.contractorOption,
              {
                backgroundColor: isSelected
                  ? contractor.specialtyInfo.color + '20'
                  : colors.groupedListBackground,
                borderColor: isSelected ? contractor.specialtyInfo.color : 'transparent',
                borderWidth: 1,
              },
            ]}
            onPress={() => onSelect(contractor.id)}
            activeOpacity={0.7}
            disabled={disabled}
          >
            <View
              style={[
                styles.contractorIcon,
                { backgroundColor: contractor.specialtyInfo.color + '30' },
              ]}
            >
              <Icon
                name={contractor.specialtyInfo.icon as keyof typeof Ionicons.glyphMap}
                size={18}
                color={contractor.specialtyInfo.color}
              />
            </View>
            <Typography variant="caption1" weight="semibold" numberOfLines={1}>
              {contractor.name}
            </Typography>
            <Typography variant="caption2" color="secondary" numberOfLines={1}>
              {contractor.specialtyInfo.label}
            </Typography>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// Milestone Input Component
interface MilestoneInputProps {
  milestones: { title: string; dueDate: Date | null }[];
  onChange: (milestones: { title: string; dueDate: Date | null }[]) => void;
}

function MilestoneInput({ milestones, onChange }: MilestoneInputProps) {
  const colors = useAppColors();
  const [showDatePicker, setShowDatePicker] = useState<number | null>(null);

  const addMilestone = () => {
    onChange([...milestones, { title: '', dueDate: null }]);
  };

  const removeMilestone = (index: number) => {
    const newMilestones = milestones.filter((_, i) => i !== index);
    onChange(newMilestones);
  };

  const updateMilestone = (index: number, updates: Partial<{ title: string; dueDate: Date | null }>) => {
    const newMilestones = [...milestones];
    newMilestones[index] = { ...newMilestones[index], ...updates };
    onChange(newMilestones);
  };

  return (
    <View style={styles.milestonesContainer}>
      {milestones.map((milestone, index) => (
        <View key={index} style={[styles.milestoneItem, { backgroundColor: colors.groupedListBackground }]}>
          <View style={styles.milestoneNumber}>
            <Typography variant="caption2" weight="bold" color="secondary">
              {index + 1}
            </Typography>
          </View>
          <View style={styles.milestoneContent}>
            <TextInput
              style={[
                styles.milestoneInput,
                { backgroundColor: colors.backgroundSecondary, color: colors.textPrimary },
              ]}
              placeholder={`Milestone ${index + 1} title`}
              placeholderTextColor={colors.textSecondary}
              value={milestone.title}
              onChangeText={(text) => updateMilestone(index, { title: text })}
            />
            <TouchableOpacity
              style={[styles.datePickerButton, { backgroundColor: colors.backgroundSecondary }]}
              onPress={() => setShowDatePicker(index)}
            >
              <Icon name="calendar-outline" size={16} color={colors.primary} />
              <Typography variant="caption2" color={milestone.dueDate ? 'primary' : 'secondary'} style={{ marginLeft: 4 }}>
                {milestone.dueDate
                  ? milestone.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : 'Due date'}
              </Typography>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => removeMilestone(index)} style={styles.removeButton}>
            <Icon name="close-circle" size={24} color={colors.error} />
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.addMilestoneButton, { borderColor: colors.primary }]}
        onPress={addMilestone}
      >
        <Icon name="add" size={20} color={colors.primary} />
        <Typography variant="caption1" weight="medium" color="primary" style={{ marginLeft: 4 }}>
          Add Milestone
        </Typography>
      </TouchableOpacity>

      {showDatePicker !== null && (
        <DateTimePicker
          value={milestones[showDatePicker]?.dueDate || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_event, date) => {
            setShowDatePicker(null);
            if (date && showDatePicker !== null) {
              updateMilestone(showDatePicker, { dueDate: date });
            }
          }}
        />
      )}
    </View>
  );
}

// Main Screen Component
export function AddEditProjectScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<any>();
  const route = useRoute<AddEditProjectRoute>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();
  const { addProject, updateProject, removeProject } = useProjectStore();

  const { projectId, contractorId: preselectedContractorId, quoteId } = route.params || {};

  const isEditing = !!projectId;

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedContractorId, setSelectedContractorId] = useState<string | null>(
    preselectedContractorId || null
  );
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [estimatedEndDate, setEstimatedEndDate] = useState<Date | null>(null);
  const [totalBudget, setTotalBudget] = useState('');
  const [notes, setNotes] = useState('');
  const [milestones, setMilestones] = useState<{ title: string; dueDate: Date | null }[]>([]);

  // Last-saved snapshot to diff the form against (empty for create, hydrated
  // from the loaded project/quote). Keys mirror `values` below. See
  // [[useUnsavedChanges]].
  const [baseline, setBaseline] = useState({
    title: '',
    description: '',
    selectedContractorId: (preselectedContractorId || null) as string | null,
    startDate: null as Date | null,
    estimatedEndDate: null as Date | null,
    totalBudget: '',
    notes: '',
    milestones: [] as { title: string; dueDate: Date | null }[],
  });

  // Date picker state
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);

  // Loading states
  const [contractors, setContractors] = useState<ContractorWithStats[]>([]);
  const [isLoadingContractors, setIsLoadingContractors] = useState(true);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const householdId = currentHousehold?.id;

  // Fetch contractors
  useEffect(() => {
    const fetchContractors = async () => {
      if (!householdId) return;

      setIsLoadingContractors(true);
      try {
        const response = await contractorsApi.getAll(householdId);
        setContractors(response.contractors);
      } catch (error) {
        console.error('Error fetching contractors:', error);
      } finally {
        setIsLoadingContractors(false);
      }
    };

    fetchContractors();
  }, [householdId]);

  // Fetch quote if provided (to prefill data)
  useEffect(() => {
    const fetchQuote = async () => {
      if (!householdId || !quoteId) return;

      setIsLoadingQuote(true);
      try {
        const response = await quotesApi.getOne(householdId, quoteId);
        const quote = response.quote;

        // Prefill from quote
        const prefilledBudget = quote.amount_cents ? (quote.amount_cents / 100).toString() : '';
        setTitle(quote.title);
        setDescription(quote.description || '');
        setSelectedContractorId(quote.contractor_id);
        setTotalBudget(prefilledBudget);
        // Baseline mirrors the quote prefill so Save stays disabled until the
        // user actually changes something.
        setBaseline((prev) => ({
          ...prev,
          title: quote.title,
          description: quote.description || '',
          selectedContractorId: quote.contractor_id,
          totalBudget: prefilledBudget,
        }));
      } catch (error) {
        console.error('Error fetching quote:', error);
      } finally {
        setIsLoadingQuote(false);
      }
    };

    if (!isEditing) {
      fetchQuote();
    }
  }, [householdId, quoteId, isEditing]);

  // Fetch existing project if editing
  useEffect(() => {
    const fetchProject = async () => {
      if (!householdId || !projectId) return;

      setIsLoadingProject(true);
      try {
        const response = await projectsApi.getOne(householdId, projectId);
        const proj = response.project;

        const loaded = {
          title: proj.title,
          description: proj.description || '',
          selectedContractorId: proj.contractor_id as string | null,
          startDate: (proj.start_date ? new Date(proj.start_date) : null) as Date | null,
          estimatedEndDate: (proj.estimated_end_date
            ? new Date(proj.estimated_end_date)
            : null) as Date | null,
          totalBudget: proj.total_budget_cents ? (proj.total_budget_cents / 100).toString() : '',
          notes: proj.notes || '',
          milestones: proj.milestones.map((m) => ({
            title: m.title,
            dueDate: (m.due_date ? new Date(m.due_date) : null) as Date | null,
          })),
        };

        setTitle(loaded.title);
        setDescription(loaded.description);
        setSelectedContractorId(loaded.selectedContractorId);
        setStartDate(loaded.startDate);
        setEstimatedEndDate(loaded.estimatedEndDate);
        setTotalBudget(loaded.totalBudget);
        setNotes(loaded.notes);
        setMilestones(loaded.milestones);
        setBaseline(loaded);
      } catch (error) {
        console.error('Error fetching project:', error);
        Alert.alert('Error', 'Failed to load project details');
      } finally {
        setIsLoadingProject(false);
      }
    };

    if (isEditing) {
      fetchProject();
    }
  }, [householdId, projectId, isEditing]);

  // Disable Save until the form diverges from its snapshot; on success show a
  // toast and pop back. See [[useUnsavedChanges]].
  const { isDirty, isSaving, save } = useUnsavedChanges({
    values: {
      title,
      description,
      selectedContractorId,
      startDate,
      estimatedEndDate,
      totalBudget,
      notes,
      milestones,
    },
    baseline,
    successMessage: isEditing ? 'Changes saved' : 'Project created',
    onClose: () => navigation.goBack(),
    onSave: async () => {
      if (!householdId) return false;

      // Validation
      if (!title.trim()) {
        showToast('error', 'Please enter a project title');
        return false;
      }
      if (!selectedContractorId) {
        showToast('error', 'Please select a contractor');
        return false;
      }

      const budgetCents = totalBudget ? Math.round(parseFloat(totalBudget) * 100) : 0;

      const projectData = {
        contractor_id: selectedContractorId,
        title: title.trim(),
        description: description.trim() || undefined,
        start_date: startDate?.toISOString().split('T')[0],
        estimated_end_date: estimatedEndDate?.toISOString().split('T')[0],
        total_budget_cents: budgetCents,
        notes: notes.trim() || undefined,
        quote_id: quoteId,
        milestones: milestones
          .filter((m) => m.title.trim())
          .map((m, index) => ({
            title: m.title.trim(),
            due_date: m.dueDate?.toISOString().split('T')[0],
            sort_order: index,
          })),
      };

      if (isEditing) {
        const response = await projectsApi.update(householdId, projectId!, projectData);
        updateProject(projectId!, response.project);
      } else {
        const response = await projectsApi.create(householdId, projectData);
        addProject(response.project);
      }

      return;
    },
  });

  const handleDelete = () => {
    Alert.alert(
      'Delete Project',
      'Are you sure you want to delete this project? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!householdId || !projectId) return;

            setIsDeleting(true);
            try {
              await projectsApi.delete(householdId, projectId);
              removeProject(projectId);
              navigation.goBack();
            } catch (error) {
              console.error('Error deleting project:', error);
              Alert.alert('Error', 'Failed to delete project');
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  const formatDateDisplay = (date: Date | null) => {
    if (!date) return 'Not set';
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const headerTitle = isEditing ? 'Edit Project' : 'New Project';

  if (isLoadingProject || isLoadingQuote) {
    return (
      <AppBackground>
        <ScreenHeader
        title={headerTitle}
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

  return (
    <AppBackground>
      <ScreenHeader
        title={headerTitle}
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.scrollView]}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        {...keyboardDismissScrollProps}
      >
        <AdaptiveContainer style={styles.stack}>
          {/* Quote Reference */}
          {quoteId && (
            <View style={[styles.quoteReference, { backgroundColor: colors.primary + '10' }]}>
              <Icon name="document-text" size={20} color={colors.primary} />
              <Typography variant="caption1" color="primary" style={{ marginLeft: 8 }}>
                Creating from accepted quote
              </Typography>
            </View>
          )}

          {/* Title */}
          <FormField label="Project Title" required>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.groupedListBackground, color: colors.textPrimary },
              ]}
              placeholder="e.g., Kitchen Renovation"
              placeholderTextColor={colors.textSecondary}
              value={title}
              onChangeText={setTitle}
            />
          </FormField>

          {/* Contractor */}
          <FormField label="Contractor" required>
            <ContractorSelector
              contractors={contractors}
              selectedId={selectedContractorId}
              onSelect={setSelectedContractorId}
              isLoading={isLoadingContractors}
              disabled={!!quoteId}
            />
          </FormField>

          {/* Description */}
          <FormField label="Description">
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                { backgroundColor: colors.groupedListBackground, color: colors.textPrimary },
              ]}
              placeholder="Project details and scope..."
              placeholderTextColor={colors.textSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />
          </FormField>

          {/* Dates */}
          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <FormField label="Start Date">
                <TouchableOpacity
                  style={[styles.dateButton, { backgroundColor: colors.groupedListBackground }]}
                  onPress={() => setShowStartDatePicker(true)}
                >
                  <Icon name="calendar" size={18} color={colors.primary} />
                  <Typography variant="caption1" style={{ marginLeft: 6 }}>
                    {formatDateDisplay(startDate)}
                  </Typography>
                </TouchableOpacity>
              </FormField>
            </View>
            <View style={{ flex: 1 }}>
              <FormField label="Est. End Date">
                <TouchableOpacity
                  style={[styles.dateButton, { backgroundColor: colors.groupedListBackground }]}
                  onPress={() => setShowEndDatePicker(true)}
                >
                  <Icon name="calendar" size={18} color={colors.primary} />
                  <Typography variant="caption1" style={{ marginLeft: 6 }}>
                    {formatDateDisplay(estimatedEndDate)}
                  </Typography>
                </TouchableOpacity>
              </FormField>
            </View>
          </View>

          {showStartDatePicker && (
            <DateTimePicker
              value={startDate || new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_event, date) => {
                setShowStartDatePicker(Platform.OS === 'ios');
                if (date) setStartDate(date);
              }}
            />
          )}

          {showEndDatePicker && (
            <DateTimePicker
              value={estimatedEndDate || new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_event, date) => {
                setShowEndDatePicker(Platform.OS === 'ios');
                if (date) setEstimatedEndDate(date);
              }}
            />
          )}

          {/* Budget */}
          <FormField label="Total Budget">
            <View
              style={[
                styles.budgetInput,
                { backgroundColor: colors.groupedListBackground },
              ]}
            >
              <Typography variant="subheadline" weight="medium" style={{ marginRight: 4 }}>
                $
              </Typography>
              <TextInput
                style={[styles.budgetTextInput, { color: colors.textPrimary }]}
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                value={totalBudget}
                onChangeText={numericTextHandler(setTotalBudget)}
                keyboardType="decimal-pad"
              />
            </View>
          </FormField>

          {/* Milestones */}
          <FormField label="Milestones">
            <MilestoneInput milestones={milestones} onChange={setMilestones} />
          </FormField>

          {/* Notes */}
          <FormField label="Notes">
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                { backgroundColor: colors.groupedListBackground, color: colors.textPrimary },
              ]}
              placeholder="Additional notes..."
              placeholderTextColor={colors.textSecondary}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />
          </FormField>

          {/* Save Button */}
          <TouchableOpacity
            style={[
              styles.saveButton,
              { backgroundColor: colors.primary },
              (isSaving || !isDirty || !title.trim() || !selectedContractorId) && { opacity: 0.6 },
            ]}
            onPress={save}
            disabled={isSaving || !isDirty || !title.trim() || !selectedContractorId}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Typography variant="subheadline" weight="semibold" color="onPrimary">
                {isEditing ? 'Update Project' : 'Create Project'}
              </Typography>
            )}
          </TouchableOpacity>

          {/* Delete Button - Only shown when editing */}
          {isEditing && (
            <TouchableOpacity
              style={[
                styles.deleteButton,
                { backgroundColor: colors.error + '15', borderColor: colors.error },
                isDeleting && { opacity: 0.6 },
              ]}
              onPress={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <>
                  <Icon name="trash-outline" size={18} color={colors.error} />
                  <Typography variant="subheadline" weight="semibold" color="error" style={{ marginLeft: 8 }}>
                    Delete Project
                  </Typography>
                </>
              )}
            </TouchableOpacity>
          )}
        </AdaptiveContainer>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  // The ScrollView has a single child (AdaptiveContainer), so the vertical
  // rhythm has to live here — otherwise every card stacks flush.
  stack: {
    gap: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingSmall: {
    padding: 20,
    alignItems: 'center',
  },
  // Quote Reference
  quoteReference: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
  },
  // Form Field
  formField: {
    marginBottom: 16,
  },
  fieldLabel: {
    marginBottom: 8,
  },
  // Input
  input: {
    borderRadius: 12,
    padding: 14,
    ...scaledFont('body'),
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  // Date
  dateRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
  },
  // Budget
  budgetInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  budgetTextInput: {
    flex: 1,
    ...scaledFont('bodyLarge'),
  },
  // Contractor
  contractorList: {
    gap: 12,
  },
  contractorOption: {
    width: 120,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  contractorIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  // Milestones
  milestonesContainer: {
    gap: 8,
  },
  milestoneItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
  },
  milestoneNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  milestoneContent: {
    flex: 1,
    gap: 6,
  },
  milestoneInput: {
    padding: 10,
    borderRadius: 8,
    ...scaledFont('bodySmall'),
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  removeButton: {
    marginLeft: 8,
  },
  addMilestoneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  // Save Button
  saveButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    marginTop: 24,
  },
  // Delete Button
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    marginTop: 12,
    borderWidth: 1,
  },
});

export default AddEditProjectScreen;
