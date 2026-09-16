import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from "expo-router/react-navigation";
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  appointmentsApi,
  type AppointmentWithDetails,
  type AppointmentStatus,
  APPOINTMENT_TYPE_INFO,
  APPOINTMENT_STATUS_INFO,
  APPOINTMENT_STATUSES,
} from '@api/appointments';
import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { ContractorsStackParamList } from '@navigation/types';
import { useAppointmentStore } from '@stores/appointmentStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

// Format date for display
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return 'Tomorrow';
  }

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
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

// Format full date
function formatFullDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// View Mode
type ViewMode = 'list' | 'calendar';
type FilterStatus = 'all' | AppointmentStatus;

// Calendar Day Component
interface CalendarDayProps {
  date: Date;
  appointments: AppointmentWithDetails[];
  isToday: boolean;
  isSelected: boolean;
  onPress: () => void;
}

function CalendarDay({ date, appointments, isToday, isSelected, onPress }: CalendarDayProps) {
  const colors = useAppColors();
  const day = date.getDate();
  const hasAppointments = appointments.length > 0;

  return (
    <TouchableOpacity
      style={[
        styles.calendarDay,
        isToday && { borderColor: colors.primary, borderWidth: 2 },
        isSelected && { backgroundColor: colors.primary },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Typography
        variant="subheadline"
        weight={isToday || isSelected ? 'semibold' : 'regular'}
        color={isSelected ? 'onPrimary' : isToday ? 'primary' : 'primary'}
      >
        {day}
      </Typography>
      {hasAppointments && (
        <View style={styles.appointmentDots}>
          {appointments.slice(0, 3).map((apt, _index) => {
            const typeInfo = APPOINTMENT_TYPE_INFO[apt.type] || APPOINTMENT_TYPE_INFO.consultation;
            return (
              <View
                key={apt.id}
                style={[styles.appointmentDot, { backgroundColor: typeInfo.color }]}
              />
            );
          })}
        </View>
      )}
    </TouchableOpacity>
  );
}

// Appointment Card Component
interface AppointmentCardProps {
  appointment: AppointmentWithDetails;
  onPress: () => void;
}

function AppointmentCard({ appointment, onPress }: AppointmentCardProps) {
  const colors = useAppColors();
  const typeInfo = APPOINTMENT_TYPE_INFO[appointment.type] || APPOINTMENT_TYPE_INFO.consultation;
  const statusInfo = APPOINTMENT_STATUS_INFO[appointment.status] || APPOINTMENT_STATUS_INFO.pending;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.backgroundSecondary, shadowColor: colors.black }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <View style={[styles.iconCircle, { backgroundColor: typeInfo.color + '20' }]}>
          <Icon name={typeInfo.iconName} size={22} color={typeInfo.color} />
        </View>
        <View style={styles.cardContent}>
          <Typography variant="subheadline" weight="semibold" numberOfLines={1}>
            {appointment.title}
          </Typography>
          <Typography variant="caption1" color="secondary">
            {appointment.contractor.name}
            {appointment.contractor.company_name && ` - ${appointment.contractor.company_name}`}
          </Typography>
          <View style={styles.dateTimeRow}>
            <Typography variant="caption2" weight="medium" style={{ color: typeInfo.color }}>
              {formatDate(appointment.scheduled_date)}
            </Typography>
            {appointment.scheduled_time_start && (
              <Typography variant="caption2" color="secondary">
                {' '}
                at {formatTime(appointment.scheduled_time_start)}
                {appointment.scheduled_time_end && ` - ${formatTime(appointment.scheduled_time_end)}`}
              </Typography>
            )}
          </View>
          {appointment.location && (
            <Typography variant="caption2" color="secondary" numberOfLines={1}>
              {appointment.location}
            </Typography>
          )}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '20' }]}>
          <Typography variant="caption2" weight="medium" style={{ color: statusInfo.color }}>
            {statusInfo.label}
          </Typography>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// Filter Chip Component
interface FilterChipProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  color?: string;
}

function FilterChip({ label, isActive, onPress, color }: FilterChipProps) {
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

// Group appointments by date
function groupAppointmentsByDate(
  appointments: AppointmentWithDetails[]
): { date: string; appointments: AppointmentWithDetails[] }[] {
  const grouped: Record<string, AppointmentWithDetails[]> = {};

  appointments.forEach((apt) => {
    if (!grouped[apt.scheduled_date]) {
      grouped[apt.scheduled_date] = [];
    }
    grouped[apt.scheduled_date].push(apt);
  });

  return Object.entries(grouped)
    .map(([date, appts]) => ({ date, appointments: appts }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Main Screen Component
export function AppointmentsScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<ContractorsStackParamList>>();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();

  const {
    appointments,
    setAppointments,
    setCalendarData,
    isLoading,
    setLoading,
  } = useAppointmentStore();

  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());

  const householdId = currentHousehold?.id;

  const fetchData = useCallback(async () => {
    if (!householdId) return;

    setLoading(true);
    try {
      const [allRes, calendarRes] = await Promise.all([
        appointmentsApi.getAll(householdId),
        appointmentsApi.getCalendar(
          householdId,
          `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`
        ),
      ]);

      setAppointments(allRes.appointments);
      setCalendarData(calendarRes.calendar);
    } catch (error) {
      console.error('Error fetching appointments:', error);
    } finally {
      setLoading(false);
    }
  }, [householdId, currentMonth, setAppointments, setCalendarData, setLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  // Filtered appointments
  const filteredAppointments = useMemo(() => {
    let filtered = appointments;

    if (filterStatus !== 'all') {
      filtered = filtered.filter((apt) => apt.status === filterStatus);
    }

    // Sort by date
    return [...filtered].sort((a, b) => {
      const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
      if (dateCompare !== 0) return dateCompare;
      if (!a.scheduled_time_start) return 1;
      if (!b.scheduled_time_start) return -1;
      return a.scheduled_time_start.localeCompare(b.scheduled_time_start);
    });
  }, [appointments, filterStatus]);

  // Grouped appointments for list view
  const groupedAppointments = useMemo(
    () => groupAppointmentsByDate(filteredAppointments),
    [filteredAppointments]
  );

  // Appointments for selected date in calendar view
  const selectedDateAppointments = useMemo(() => {
    const dateStr = selectedDate.toISOString().split('T')[0];
    return filteredAppointments.filter((apt) => apt.scheduled_date === dateStr);
  }, [filteredAppointments, selectedDate]);

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = (firstDay.getDay() + 6) % 7; // Monday-start grid

    const days: { date: Date; isCurrentMonth: boolean }[] = [];

    // Previous month padding
    for (let i = startPadding - 1; i >= 0; i--) {
      const date = new Date(year, month, -i);
      days.push({ date, isCurrentMonth: false });
    }

    // Current month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }

    // Next month padding
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }

    return days;
  }, [currentMonth]);

  const handleAppointmentPress = (appointment: AppointmentWithDetails) => {
    navigation.navigate('AppointmentDetail', { appointmentId: appointment.id });
  };

  const handleAddAppointment = () => {
    navigation.navigate('AddEditAppointment', {});
  };

  const handlePrevMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const today = new Date();

  return (
    <AppBackground>
      <ScreenHeader
        title="Appointments"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={
          <TouchableOpacity onPress={handleAddAppointment} style={styles.addButton} testID="appointments-add-button">
            <Icon name="add-circle" size={28} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      <View testID="appointments-screen" style={styles.container}>
        {/* View Mode Toggle */}
        <View style={[styles.viewToggle, { backgroundColor: colors.groupedListBackground }]}>
          <TouchableOpacity
            testID="appointments-view-list"
            style={[
              styles.viewToggleButton,
              viewMode === 'list' && { backgroundColor: colors.backgroundSecondary },
            ]}
            onPress={() => setViewMode('list')}
          >
            <Icon
              name="list"
              size={20}
              color={viewMode === 'list' ? colors.primary : colors.textSecondary}
            />
            <Typography
              variant="caption1"
              weight="medium"
              color={viewMode === 'list' ? 'primary' : 'secondary'}
              style={{ marginLeft: 4 }}
            >
              List
            </Typography>
          </TouchableOpacity>
          <TouchableOpacity
            testID="appointments-view-calendar"
            style={[
              styles.viewToggleButton,
              viewMode === 'calendar' && { backgroundColor: colors.backgroundSecondary },
            ]}
            onPress={() => setViewMode('calendar')}
          >
            <Icon
              name="calendar"
              size={20}
              color={viewMode === 'calendar' ? colors.primary : colors.textSecondary}
            />
            <Typography
              variant="caption1"
              weight="medium"
              color={viewMode === 'calendar' ? 'primary' : 'secondary'}
              style={{ marginLeft: 4 }}
            >
              Calendar
            </Typography>
          </TouchableOpacity>
        </View>

        {/* Status Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterContainer}
          contentContainerStyle={styles.filterContent}
        >
          <FilterChip
            label="All"
            isActive={filterStatus === 'all'}
            onPress={() => setFilterStatus('all')}
          />
          {APPOINTMENT_STATUSES.map((status) => {
            const info = APPOINTMENT_STATUS_INFO[status];
            return (
              <FilterChip
                key={status}
                label={info.label}
                isActive={filterStatus === status}
                onPress={() => setFilterStatus(status)}
                color={info.color}
              />
            );
          })}
        </ScrollView>

        {isLoading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : viewMode === 'list' ? (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <AdaptiveContainer style={styles.stack}>
              {groupedAppointments.length > 0 ? (
                groupedAppointments.map(({ date, appointments: dayAppointments }) => (
                  <View key={date}>
                    <Typography variant="headline" weight="semibold" style={styles.dateHeader}>
                      {formatFullDate(date)}
                    </Typography>
                    {dayAppointments.map((appointment) => (
                      <AppointmentCard
                        key={appointment.id}
                        appointment={appointment}
                        onPress={() => handleAppointmentPress(appointment)}
                      />
                    ))}
                  </View>
                ))
              ) : (
                <EmptyState message="No appointments found" icon="calendar" />
              )}
            </AdaptiveContainer>
          </ScrollView>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <AdaptiveContainer style={styles.stack}>
              {/* Calendar Header */}
              <View style={[styles.calendarHeader, { backgroundColor: colors.backgroundSecondary }]}>
                <TouchableOpacity onPress={handlePrevMonth} style={styles.monthNavButton}>
                  <Icon name="chevron-back" size={24} color={colors.primary} />
                </TouchableOpacity>
                <Typography variant="headline" weight="semibold">
                  {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </Typography>
                <TouchableOpacity onPress={handleNextMonth} style={styles.monthNavButton}>
                  <Icon name="chevron-forward" size={24} color={colors.primary} />
                </TouchableOpacity>
              </View>

              {/* Calendar Grid */}
              <View style={[styles.calendarGrid, { backgroundColor: colors.backgroundSecondary }]}>
                {/* Weekday headers */}
                <View style={styles.weekdayRow}>
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                    <View key={day} style={styles.weekdayCell}>
                      <Typography variant="caption2" weight="medium" color="secondary">
                        {day}
                      </Typography>
                    </View>
                  ))}
                </View>

                {/* Calendar days */}
                <View style={styles.daysGrid}>
                  {calendarDays.map(({ date, isCurrentMonth }, index) => {
                    const dateStr = date.toISOString().split('T')[0];
                    const dayAppointments = filteredAppointments.filter(
                      (apt) => apt.scheduled_date === dateStr
                    );
                    const isToday = date.toDateString() === today.toDateString();
                    const isSelected = date.toDateString() === selectedDate.toDateString();

                    return (
                      <View
                        key={index}
                        style={[styles.dayCell, !isCurrentMonth && styles.dayCellFaded]}
                      >
                        <CalendarDay
                          date={date}
                          appointments={dayAppointments}
                          isToday={isToday}
                          isSelected={isSelected}
                          onPress={() => setSelectedDate(date)}
                        />
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Selected Date Appointments */}
              <View style={styles.selectedDateSection}>
                <Typography variant="headline" weight="semibold" style={styles.dateHeader}>
                  {formatFullDate(selectedDate.toISOString().split('T')[0])}
                </Typography>
                {selectedDateAppointments.length > 0 ? (
                  selectedDateAppointments.map((appointment) => (
                    <AppointmentCard
                      key={appointment.id}
                      appointment={appointment}
                      onPress={() => handleAppointmentPress(appointment)}
                    />
                  ))
                ) : (
                  <EmptyState message="No appointments on this date" icon="calendar" />
                )}
              </View>
            </AdaptiveContainer>
          </ScrollView>
        )}
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
  // View Toggle
  viewToggle: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    padding: 4,
  },
  viewToggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  // Filter
  filterContainer: {
    maxHeight: 50,
    marginTop: 12,
  },
  filterContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  // Add Button
  addButton: {
    padding: 4,
  },
  // Date Group — spacing between groups comes from the `stack` gap
  dateHeader: {
    marginBottom: 12,
  },
  // Card
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardContent: {
    flex: 1,
    gap: 4,
  },
  dateTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  // Calendar
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 16,
  },
  monthNavButton: {
    padding: 8,
  },
  calendarGrid: {
    borderRadius: 16,
    padding: 12,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekdayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    padding: 2,
  },
  dayCellFaded: {
    opacity: 0.3,
  },
  calendarDay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  appointmentDots: {
    flexDirection: 'row',
    position: 'absolute',
    bottom: 4,
    gap: 2,
  },
  appointmentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // Selected Date Section
  selectedDateSection: {
    marginTop: 16,
  },
  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
});

export default AppointmentsScreen;
