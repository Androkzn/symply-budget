import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useRoute, type RouteProp } from "expo-router/react-navigation";
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert, TextInput, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  appointmentsApi,
  type AppointmentType,
  APPOINTMENT_TYPES,
  APPOINTMENT_TYPE_INFO,
} from '@api/appointments';
import { contractorsApi, type ContractorWithStats } from '@api/contractors';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import type { ContractorsStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useAppointmentStore } from '@stores/appointmentStore';
import { useHouseholdStore } from '@stores/householdStore';
import { scaledFont, useAppColors } from '@theme';
import { keyboardDismissScrollProps, numericTextHandler } from '@utils/keyboard';

type AddEditAppointmentRoute = RouteProp<ContractorsStackParamList, 'AddEditAppointment'>;

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

// Selection Chip Component
interface SelectionChipProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  isSelected: boolean;
  color?: string;
  onPress: () => void;
}

function SelectionChip({ label, icon, isSelected, color, onPress }: SelectionChipProps) {
  const colors = useAppColors();
  const activeColor = color || colors.primary;

  return (
    <TouchableOpacity
      style={[
        styles.chip,
        {
          backgroundColor: isSelected ? activeColor + '20' : colors.backgroundSecondary,
          borderColor: isSelected ? activeColor : 'transparent',
          borderWidth: 1,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {icon && (
        <Icon
          name={icon}
          size={16}
          color={isSelected ? activeColor : colors.textSecondary}
          style={{ marginRight: 6 }}
        />
      )}
      <Typography
        variant="caption1"
        weight={isSelected ? 'semibold' : 'regular'}
        style={{ color: isSelected ? activeColor : colors.textSecondary }}
      >
        {label}
      </Typography>
    </TouchableOpacity>
  );
}

// Contractor Selector Component
interface ContractorSelectorProps {
  contractors: ContractorWithStats[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
}

function ContractorSelector({ contractors, selectedId, onSelect, isLoading }: ContractorSelectorProps) {
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
        No contractors available. Add a contractor first.
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
                  : colors.backgroundSecondary,
                borderColor: isSelected ? contractor.specialtyInfo.color : 'transparent',
                borderWidth: 1,
              },
            ]}
            onPress={() => onSelect(contractor.id)}
            activeOpacity={0.7}
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

// Main Screen Component
export function AddEditAppointmentScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<any>();
  const route = useRoute<AddEditAppointmentRoute>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();
  const { addAppointment, updateAppointment } = useAppointmentStore();

  const { appointmentId, contractorId: preselectedContractorId, linkedReportId, linkedTaskId, linkedQuoteId, linkedProjectId } = route.params || {};

  const isEditing = !!appointmentId;

  // Stable "now" for the default date so the create baseline can match the
  // initial form state exactly (a fresh `new Date()` each render would not).
  const [initialDate] = useState(() => new Date());

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<AppointmentType>('consultation');
  const [selectedContractorId, setSelectedContractorId] = useState<string | null>(preselectedContractorId || null);
  const [scheduledDate, setScheduledDate] = useState(initialDate);
  const [scheduledTimeStart, setScheduledTimeStart] = useState<Date | null>(null);
  const [scheduledTimeEnd, setScheduledTimeEnd] = useState<Date | null>(null);
  const [location, setLocation] = useState('');
  const [estimatedDuration, setEstimatedDuration] = useState('');
  const [notes, setNotes] = useState('');

  // Last-saved snapshot to diff the form against (empty defaults for create,
  // hydrated from the loaded appointment). Keys mirror `values` below. See
  // [[useUnsavedChanges]].
  const [baseline, setBaseline] = useState({
    title: '',
    description: '',
    type: 'consultation' as AppointmentType,
    selectedContractorId: (preselectedContractorId || null) as string | null,
    scheduledDate: initialDate as Date,
    scheduledTimeStart: null as Date | null,
    scheduledTimeEnd: null as Date | null,
    location: '',
    estimatedDuration: '',
    notes: '',
  });

  // Date/time picker state
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);

  // Loading states
  const [contractors, setContractors] = useState<ContractorWithStats[]>([]);
  const [isLoadingContractors, setIsLoadingContractors] = useState(true);
  const [isLoadingAppointment, setIsLoadingAppointment] = useState(false);

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

  // Fetch existing appointment if editing
  useEffect(() => {
    const fetchAppointment = async () => {
      if (!householdId || !appointmentId) return;

      setIsLoadingAppointment(true);
      try {
        const response = await appointmentsApi.getOne(householdId, appointmentId);
        const apt = response.appointment;

        let startTime: Date | null = null;
        if (apt.scheduled_time_start) {
          const [hours, minutes] = apt.scheduled_time_start.split(':');
          startTime = new Date();
          startTime.setHours(parseInt(hours, 10), parseInt(minutes, 10));
        }
        let endTime: Date | null = null;
        if (apt.scheduled_time_end) {
          const [hours, minutes] = apt.scheduled_time_end.split(':');
          endTime = new Date();
          endTime.setHours(parseInt(hours, 10), parseInt(minutes, 10));
        }

        const loaded = {
          title: apt.title,
          description: apt.description || '',
          type: apt.type,
          selectedContractorId: apt.contractor_id as string | null,
          scheduledDate: new Date(apt.scheduled_date),
          scheduledTimeStart: startTime,
          scheduledTimeEnd: endTime,
          location: apt.location || '',
          estimatedDuration: apt.estimated_duration_minutes?.toString() || '',
          notes: apt.notes || '',
        };

        setTitle(loaded.title);
        setDescription(loaded.description);
        setType(loaded.type);
        setSelectedContractorId(loaded.selectedContractorId);
        setScheduledDate(loaded.scheduledDate);
        setScheduledTimeStart(loaded.scheduledTimeStart);
        setScheduledTimeEnd(loaded.scheduledTimeEnd);
        setLocation(loaded.location);
        setEstimatedDuration(loaded.estimatedDuration);
        setNotes(loaded.notes);
        setBaseline(loaded);
      } catch (error) {
        console.error('Error fetching appointment:', error);
        Alert.alert('Error', 'Failed to load appointment details');
      } finally {
        setIsLoadingAppointment(false);
      }
    };

    if (isEditing) {
      fetchAppointment();
    }
  }, [householdId, appointmentId, isEditing]);

  // Disable Save until the form diverges from its snapshot; on success show a
  // toast and pop back. See [[useUnsavedChanges]].
  const { isDirty, isSaving, save } = useUnsavedChanges({
    values: {
      title,
      description,
      type,
      selectedContractorId,
      scheduledDate,
      scheduledTimeStart,
      scheduledTimeEnd,
      location,
      estimatedDuration,
      notes,
    },
    baseline,
    successMessage: isEditing ? 'Changes saved' : 'Appointment scheduled',
    onClose: () => navigation.goBack(),
    onSave: async () => {
      if (!householdId) return false;

      // Validation
      if (!title.trim()) {
        showToast('error', 'Please enter a title for the appointment');
        return false;
      }
      if (!selectedContractorId) {
        showToast('error', 'Please select a contractor');
        return false;
      }

      const formatTime = (date: Date | null) => {
        if (!date) return undefined;
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      };

      const appointmentData = {
        contractor_id: selectedContractorId,
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        scheduled_date: scheduledDate.toISOString().split('T')[0],
        scheduled_time_start: formatTime(scheduledTimeStart),
        scheduled_time_end: formatTime(scheduledTimeEnd),
        location: location.trim() || undefined,
        estimated_duration_minutes: estimatedDuration ? parseInt(estimatedDuration, 10) : undefined,
        notes: notes.trim() || undefined,
        linked_report_id: linkedReportId,
        linked_task_id: linkedTaskId,
        linked_quote_id: linkedQuoteId,
        linked_project_id: linkedProjectId,
      };

      if (isEditing) {
        const response = await appointmentsApi.update(householdId, appointmentId!, appointmentData);
        updateAppointment(appointmentId!, response.appointment);
      } else {
        const response = await appointmentsApi.create(householdId, appointmentData);
        addAppointment(response.appointment);
      }

      return;
    },
  });

  const formatDateDisplay = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTimeDisplay = (date: Date | null) => {
    if (!date) return 'Not set';
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  const headerTitle = isEditing ? 'Edit Appointment' : 'New Appointment';

  if (isLoadingAppointment) {
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
        testID="appointment-form-screen"
        style={[screenScrollViewStyle.scroll, styles.scrollView]}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
        {...keyboardDismissScrollProps}
      >
        <AdaptiveContainer style={styles.stack}>
          {/* Appointment Type */}
          <FormField label="Type" required>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipContainer}
            >
              {APPOINTMENT_TYPES.map((aptType) => {
                const info = APPOINTMENT_TYPE_INFO[aptType];
                return (
                  <SelectionChip
                    key={aptType}
                    label={info.label}
                    icon={info.iconName}
                    isSelected={type === aptType}
                    color={info.color}
                    onPress={() => setType(aptType)}
                  />
                );
              })}
            </ScrollView>
          </FormField>

          {/* Contractor */}
          <FormField label="Contractor" required>
            <ContractorSelector
              contractors={contractors}
              selectedId={selectedContractorId}
              onSelect={setSelectedContractorId}
              isLoading={isLoadingContractors}
            />
          </FormField>

          {/* Title */}
          <FormField label="Title" required>
            <TextInput
              testID="appointment-form-title"
              style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.textPrimary }]}
              placeholder="e.g., Initial consultation for kitchen remodel"
              placeholderTextColor={colors.textSecondary}
              value={title}
              onChangeText={setTitle}
            />
          </FormField>

          {/* Description */}
          <FormField label="Description">
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                { backgroundColor: colors.backgroundSecondary, color: colors.textPrimary },
              ]}
              placeholder="Add details about this appointment..."
              placeholderTextColor={colors.textSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />
          </FormField>

          {/* Date */}
          <FormField label="Date" required>
            <TouchableOpacity
              style={[styles.dateButton, { backgroundColor: colors.backgroundSecondary }]}
              onPress={() => setShowDatePicker(true)}
            >
              <Icon name="calendar" size={20} color={colors.primary} />
              <Typography variant="subheadline" style={{ marginLeft: 8 }}>
                {formatDateDisplay(scheduledDate)}
              </Typography>
            </TouchableOpacity>
          </FormField>

          {showDatePicker && (
            <DateTimePicker
              value={scheduledDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_event, date) => {
                setShowDatePicker(Platform.OS === 'ios');
                if (date) setScheduledDate(date);
              }}
              minimumDate={new Date()}
            />
          )}

          {/* Time Range */}
          <View style={styles.timeRow}>
            <View style={{ flex: 1 }}>
              <FormField label="Start Time">
                <TouchableOpacity
                  style={[styles.dateButton, { backgroundColor: colors.backgroundSecondary }]}
                  onPress={() => setShowStartTimePicker(true)}
                >
                  <Icon name="time" size={20} color={colors.primary} />
                  <Typography variant="subheadline" style={{ marginLeft: 8 }}>
                    {formatTimeDisplay(scheduledTimeStart)}
                  </Typography>
                </TouchableOpacity>
              </FormField>
            </View>
            <View style={{ flex: 1 }}>
              <FormField label="End Time">
                <TouchableOpacity
                  style={[styles.dateButton, { backgroundColor: colors.backgroundSecondary }]}
                  onPress={() => setShowEndTimePicker(true)}
                >
                  <Icon name="time" size={20} color={colors.primary} />
                  <Typography variant="subheadline" style={{ marginLeft: 8 }}>
                    {formatTimeDisplay(scheduledTimeEnd)}
                  </Typography>
                </TouchableOpacity>
              </FormField>
            </View>
          </View>

          {showStartTimePicker && (
            <DateTimePicker
              value={scheduledTimeStart || new Date()}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_event, date) => {
                setShowStartTimePicker(Platform.OS === 'ios');
                if (date) setScheduledTimeStart(date);
              }}
            />
          )}

          {showEndTimePicker && (
            <DateTimePicker
              value={scheduledTimeEnd || new Date()}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_event, date) => {
                setShowEndTimePicker(Platform.OS === 'ios');
                if (date) setScheduledTimeEnd(date);
              }}
            />
          )}

          {/* Location */}
          <FormField label="Location">
            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.textPrimary }]}
              placeholder="e.g., Kitchen, Master bathroom"
              placeholderTextColor={colors.textSecondary}
              value={location}
              onChangeText={setLocation}
            />
          </FormField>

          {/* Duration */}
          <FormField label="Estimated Duration (minutes)">
            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.textPrimary }]}
              placeholder="e.g., 60"
              placeholderTextColor={colors.textSecondary}
              value={estimatedDuration}
              onChangeText={numericTextHandler(setEstimatedDuration)}
              keyboardType="number-pad"
            />
          </FormField>

          {/* Notes */}
          <FormField label="Notes">
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                { backgroundColor: colors.backgroundSecondary, color: colors.textPrimary },
              ]}
              placeholder="Add any notes or special instructions..."
              placeholderTextColor={colors.textSecondary}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />
          </FormField>

          {/* Save Button */}
          <TouchableOpacity
            testID="appointment-form-save"
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
                {isEditing ? 'Update Appointment' : 'Create Appointment'}
              </Typography>
            )}
          </TouchableOpacity>
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
  // Chip
  chipContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
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
  // Date Button
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
  },
  timeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  // Save Button
  saveButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    marginTop: 24,
  },
});

export default AddEditAppointmentScreen;
