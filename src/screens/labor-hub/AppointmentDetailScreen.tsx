import { useNavigation, useRoute, type RouteProp } from "expo-router/react-navigation";
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, Alert, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  appointmentsApi,
  type AppointmentWithDetails,
  type AppointmentStatus,
  APPOINTMENT_TYPE_INFO,
  APPOINTMENT_STATUS_INFO,
} from '@api/appointments';
import { AppBackground, HeaderActionButton, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { ContractorsStackParamList } from '@navigation/types';
import { useAppointmentStore } from '@stores/appointmentStore';
import { useHouseholdStore } from '@stores/householdStore';
import { Header, useAppColors } from '@theme';
import { getContractorCategoryIcon, type IoniconName } from '@utils/categoryIcons';

type AppointmentDetailRoute = RouteProp<ContractorsStackParamList, 'AppointmentDetail'>;

// Format date for display
function formatFullDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// Format time for display
function formatTime(timeString: string | null): string {
  if (!timeString) return '';
  const [hours, minutes] = timeString.split(':');
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
}

// Info Row Component
interface InfoRowProps {
  icon: IoniconName;
  label: string;
  value: string | null;
  onPress?: () => void;
}

function InfoRow({ icon, label, value, onPress }: InfoRowProps) {
  const colors = useAppColors();
  if (!value) return null;

  const content = (
    <View style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: colors.groupedListBackground }]}>
        <Icon name={icon} size={18} color={colors.textSecondary} />
      </View>
      <View style={styles.infoContent}>
        <Typography variant="caption1" color="secondary">
          {label}
        </Typography>
        <Typography variant="subheadline" weight="medium">
          {value}
        </Typography>
      </View>
      {onPress && (
        <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

// Action Button Component
interface ActionButtonProps {
  icon: IoniconName;
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}

function ActionButton({ icon, label, color, onPress, disabled }: ActionButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.actionButton, { backgroundColor: color + '15', opacity: disabled ? 0.5 : 1 }]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <View style={[styles.actionIcon, { backgroundColor: color + '25' }]}>
        <Icon name={icon} size={20} color={color} />
      </View>
      <Typography variant="caption1" weight="medium" style={{ color, marginTop: 4 }}>
        {label}
      </Typography>
    </TouchableOpacity>
  );
}

// Main Screen Component
export function AppointmentDetailScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<any>();
  const route = useRoute<AppointmentDetailRoute>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();
  const { updateAppointment, removeAppointment } = useAppointmentStore();

  const [appointment, setAppointment] = useState<AppointmentWithDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const { appointmentId } = route.params;
  const householdId = currentHousehold?.id;

  const fetchAppointment = useCallback(async () => {
    if (!householdId) return;

    setIsLoading(true);
    try {
      const response = await appointmentsApi.getOne(householdId, appointmentId);
      setAppointment(response.appointment);
    } catch (error) {
      console.error('Error fetching appointment:', error);
      Alert.alert('Error', 'Failed to load appointment details');
    } finally {
      setIsLoading(false);
    }
  }, [householdId, appointmentId]);

  useEffect(() => {
    fetchAppointment();
  }, [fetchAppointment]);

  const handleStatusChange = async (newStatus: AppointmentStatus) => {
    if (!householdId || !appointment) return;

    setIsUpdating(true);
    try {
      let response;

      switch (newStatus) {
        case 'confirmed':
          response = await appointmentsApi.confirm(householdId, appointmentId);
          break;
        case 'cancelled':
          Alert.alert(
            'Cancel Appointment',
            'Are you sure you want to cancel this appointment?',
            [
              { text: 'No', style: 'cancel' },
              {
                text: 'Yes, Cancel',
                style: 'destructive',
                onPress: async () => {
                  try {
                    const cancelRes = await appointmentsApi.cancel(householdId, appointmentId);
                    setAppointment(cancelRes.appointment);
                    updateAppointment(appointmentId, cancelRes.appointment);
                  } catch (err) {
                    Alert.alert('Error', 'Failed to cancel appointment');
                  }
                },
              },
            ]
          );
          setIsUpdating(false);
          return;
        case 'in_progress':
          response = await appointmentsApi.start(householdId, appointmentId);
          break;
        case 'completed':
          response = await appointmentsApi.complete(householdId, appointmentId);
          break;
        case 'no_show':
          response = await appointmentsApi.markNoShow(householdId, appointmentId);
          break;
        default:
          response = await appointmentsApi.update(householdId, appointmentId, { status: newStatus });
      }

      if (response) {
        setAppointment(response.appointment);
        updateAppointment(appointmentId, response.appointment);
      }
    } catch (error) {
      console.error('Error updating appointment:', error);
      Alert.alert('Error', 'Failed to update appointment status');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReschedule = () => {
    navigation.navigate('AddEditAppointment', {
      appointmentId,
      // Pass existing data for prefill
    });
  };

  const handleDelete = () => {
    if (!householdId) return;

    Alert.alert(
      'Delete Appointment',
      'Are you sure you want to delete this appointment? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await appointmentsApi.delete(householdId, appointmentId);
              removeAppointment(appointmentId);
              navigation.goBack();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete appointment');
            }
          },
        },
      ]
    );
  };

  const handleCallContractor = () => {
    if (appointment?.contractor.phone) {
      Linking.openURL(`tel:${appointment.contractor.phone}`);
    }
  };

  const handleEmailContractor = () => {
    if (appointment?.contractor.email) {
      Linking.openURL(`mailto:${appointment.contractor.email}`);
    }
  };

  const handleViewContractor = () => {
    if (appointment) {
      navigation.navigate('ContractorDetail', { contractorId: appointment.contractor_id });
    }
  };

  const handleStartVisitMode = () => {
    if (appointment) {
      navigation.navigate('VisitMode', { appointmentId: appointment.id });
    }
  };

  const handleAddRating = () => {
    if (appointment) {
      // TODO: AddRating screen not yet implemented; show placeholder feedback.
      Alert.alert('Rating', 'Coming soon');
    }
  };

  const renderScreenHeader = (showDelete = false) => (
    <ScreenHeader
      title="Appointment"
      showBackButton
      onBackPress={() => navigation.goBack()}
      showNotificationBell={false}
      showAvatar={false}
      rightElement={
        showDelete ? (
          <HeaderActionButton
            iconOnly
            onPress={handleDelete}
            testID="appointment-detail-delete"
            accessibilityLabel="Delete appointment"
          >
            <Icon name="trash-outline" size={Header.actionIconSize} color={colors.error} />
          </HeaderActionButton>
        ) : undefined
      }
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

  if (!appointment) {
    return (
      <AppBackground>
        {renderScreenHeader()}
        <View style={styles.errorContainer}>
          <Typography variant="headline" color="secondary">
            Appointment not found
          </Typography>
        </View>
      </AppBackground>
    );
  }

  const typeInfo = APPOINTMENT_TYPE_INFO[appointment.type] || APPOINTMENT_TYPE_INFO.consultation;
  const statusInfo = APPOINTMENT_STATUS_INFO[appointment.status] || APPOINTMENT_STATUS_INFO.pending;

  const canConfirm = ['pending', 'rescheduled'].includes(appointment.status);
  const canStart = ['pending', 'confirmed', 'rescheduled'].includes(appointment.status);
  const canComplete = appointment.status === 'in_progress';
  const canCancel = !['completed', 'cancelled'].includes(appointment.status);
  const isActive = ['pending', 'confirmed', 'rescheduled', 'in_progress'].includes(
    appointment.status
  );
  const isCompleted = appointment.status === 'completed';

  return (
    <AppBackground>
      <View testID="appointment-detail-screen" style={{ flex: 1 }}>
      {renderScreenHeader(true)}

      <ScrollView
        style={[screenScrollViewStyle.scroll, styles.scrollView]}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
      >
        <AdaptiveContainer style={styles.stack}>
          {/* Header Card */}
          <View style={[styles.headerCard, { backgroundColor: colors.backgroundSecondary }]}>
            <View style={styles.headerRow}>
              <View style={[styles.typeIcon, { backgroundColor: typeInfo.color + '20' }]}>
                <Icon name={typeInfo.iconName} size={26} color={typeInfo.color} />
              </View>
              <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '20' }]}>
                <Typography variant="caption1" weight="semibold" style={{ color: statusInfo.color }}>
                  {statusInfo.label}
                </Typography>
              </View>
            </View>

            <Typography variant="title2" weight="bold" style={{ marginTop: 16 }}>
              {appointment.title}
            </Typography>

            <View style={[styles.typeBadge, { backgroundColor: typeInfo.color + '15' }]}>
              <Typography variant="caption1" weight="medium" style={{ color: typeInfo.color }}>
                {typeInfo.label}
              </Typography>
            </View>

            {appointment.description && (
              <Typography variant="body" color="secondary" style={{ marginTop: 12 }}>
                {appointment.description}
              </Typography>
            )}
          </View>

          {/* Quick Actions */}
          {isActive && (
            <View style={[styles.actionsCard, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="headline" weight="semibold" style={{ marginBottom: 12 }}>
                Quick Actions
              </Typography>
              <View style={styles.actionsRow}>
                {canConfirm && (
                  <ActionButton
                    icon="checkmark"
                    label="Confirm"
                    color={colors.success}
                    onPress={() => handleStatusChange('confirmed')}
                    disabled={isUpdating}
                  />
                )}
                {canStart && (
                  <ActionButton
                    icon="play"
                    label="Start"
                    color={colors.primary}
                    onPress={() => handleStatusChange('in_progress')}
                    disabled={isUpdating}
                  />
                )}
                {canComplete && (
                  <ActionButton
                    icon="checkmark"
                    label="Complete"
                    color={colors.success}
                    onPress={() => handleStatusChange('completed')}
                    disabled={isUpdating}
                  />
                )}
                <ActionButton
                  icon="create"
                  label="Visit Mode"
                  color={colors.info}
                  onPress={handleStartVisitMode}
                />
                {canCancel && (
                  <ActionButton
                    icon="close"
                    label="Cancel"
                    color={colors.error}
                    onPress={() => handleStatusChange('cancelled')}
                    disabled={isUpdating}
                  />
                )}
              </View>
            </View>
          )}

          {/* Add Rating after completed */}
          {isCompleted && (
            <TouchableOpacity
              style={[styles.ratingPrompt, { backgroundColor: colors.primary + '15' }]}
              onPress={handleAddRating}
            >
              <Icon name="star" size={20} color={colors.primary} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Typography variant="subheadline" weight="semibold" color="primary">
                  Rate this visit
                </Typography>
                <Typography variant="caption1" color="secondary">
                  Help improve your future recommendations
                </Typography>
              </View>
              <Icon name="chevron-forward" size={20} color={colors.primary} />
            </TouchableOpacity>
          )}

          {/* Schedule Info */}
          <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="headline" weight="semibold" style={{ marginBottom: 12 }}>
              Schedule
            </Typography>

            <InfoRow icon="calendar" label="Date" value={formatFullDate(appointment.scheduled_date)} />

            {appointment.scheduled_time_start && (
              <InfoRow
                icon="time"
                label="Time"
                value={`${formatTime(appointment.scheduled_time_start)}${
                  appointment.scheduled_time_end
                    ? ` - ${formatTime(appointment.scheduled_time_end)}`
                    : ''
                }`}
              />
            )}

            {appointment.estimated_duration_minutes && (
              <InfoRow
                icon="hourglass"
                label="Duration"
                value={`${appointment.estimated_duration_minutes} minutes`}
              />
            )}

            {appointment.location && (
              <InfoRow icon="location" label="Location" value={appointment.location} />
            )}
          </View>

          {/* Contractor Info */}
          <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
            <Typography variant="headline" weight="semibold" style={{ marginBottom: 12 }}>
              Contractor
            </Typography>

            <TouchableOpacity
              style={styles.contractorCard}
              onPress={handleViewContractor}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.contractorIcon,
                  { backgroundColor: appointment.contractor.specialtyInfo.color + '20' },
                ]}
              >
                <Icon
                  name={getContractorCategoryIcon(appointment.contractor.specialty)}
                  size={24}
                  color={appointment.contractor.specialtyInfo.color}
                />
              </View>
              <View style={styles.contractorInfo}>
                <Typography variant="subheadline" weight="semibold">
                  {appointment.contractor.name}
                </Typography>
                {appointment.contractor.company_name && (
                  <Typography variant="caption1" color="secondary">
                    {appointment.contractor.company_name}
                  </Typography>
                )}
                <Typography
                  variant="caption2"
                  weight="medium"
                  style={{ color: appointment.contractor.specialtyInfo.color }}
                >
                  {appointment.contractor.specialtyInfo.label}
                </Typography>
              </View>
              <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <View style={styles.contactButtons}>
              {appointment.contractor.phone && (
                <TouchableOpacity
                  style={[styles.contactButton, { backgroundColor: colors.groupedListBackground }]}
                  onPress={handleCallContractor}
                >
                  <Icon name="call" size={20} color={colors.success} />
                  <Typography variant="caption1" weight="medium" color="primary">
                    Call
                  </Typography>
                </TouchableOpacity>
              )}
              {appointment.contractor.email && (
                <TouchableOpacity
                  style={[styles.contactButton, { backgroundColor: colors.groupedListBackground }]}
                  onPress={handleEmailContractor}
                >
                  <Icon name="mail" size={20} color={colors.primary} />
                  <Typography variant="caption1" weight="medium" color="primary">
                    Email
                  </Typography>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Notes */}
          {appointment.notes && (
            <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="headline" weight="semibold" style={{ marginBottom: 12 }}>
                Notes
              </Typography>
              <Typography variant="body" color="secondary">
                {appointment.notes}
              </Typography>
            </View>
          )}

          {/* Actual Times (if completed) */}
          {(appointment.actual_arrival_time || appointment.actual_departure_time) && (
            <View style={[styles.section, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="headline" weight="semibold" style={{ marginBottom: 12 }}>
                Actual Times
              </Typography>
              {appointment.actual_arrival_time && (
                <InfoRow
                  icon="arrow-forward"
                  label="Arrival"
                  value={new Date(appointment.actual_arrival_time).toLocaleTimeString()}
                />
              )}
              {appointment.actual_departure_time && (
                <InfoRow
                  icon="arrow-back"
                  label="Departure"
                  value={new Date(appointment.actual_departure_time).toLocaleTimeString()}
                />
              )}
            </View>
          )}

          {/* Edit Button */}
          {isActive && (
            <TouchableOpacity
              style={[styles.editButton, { backgroundColor: colors.primary }]}
              onPress={handleReschedule}
            >
              <Typography variant="subheadline" weight="semibold" color="onPrimary">
                Edit Appointment
              </Typography>
            </TouchableOpacity>
          )}
        </AdaptiveContainer>
      </ScrollView>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 32,
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
  typeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  // Actions
  actionsCard: {
    borderRadius: 20,
    padding: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionButton: {
    minWidth: 70,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Rating Prompt
  ratingPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
  },
  // Section
  section: {
    borderRadius: 20,
    padding: 16,
  },
  // Info Row
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  infoIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  infoContent: {
    flex: 1,
    gap: 2,
  },
  // Contractor
  contractorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
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
  contactButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  contactButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  // Edit Button
  editButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    marginTop: 8,
  },
});

export default AppointmentDetailScreen;
