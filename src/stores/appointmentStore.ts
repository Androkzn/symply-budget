import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { AppointmentWithDetails, CalendarAppointment } from '@api/appointments';

interface AppointmentState {
  appointments: AppointmentWithDetails[];
  upcomingAppointments: AppointmentWithDetails[];
  calendarData: CalendarAppointment[];
  selectedAppointment: AppointmentWithDetails | null;
  currentMonth: string; // YYYY-MM format
  isLoading: boolean;
  error: string | null;
}

interface AppointmentActions {
  setAppointments: (appointments: AppointmentWithDetails[]) => void;
  setUpcomingAppointments: (appointments: AppointmentWithDetails[]) => void;
  setCalendarData: (data: CalendarAppointment[]) => void;
  setCurrentMonth: (month: string) => void;
  addAppointment: (appointment: AppointmentWithDetails) => void;
  updateAppointment: (appointmentId: string, updates: Partial<AppointmentWithDetails>) => void;
  removeAppointment: (appointmentId: string) => void;
  setSelectedAppointment: (appointment: AppointmentWithDetails | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type AppointmentStore = AppointmentState & AppointmentActions;

const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const initialState: AppointmentState = {
  appointments: [],
  upcomingAppointments: [],
  calendarData: [],
  selectedAppointment: null,
  currentMonth: getCurrentMonth(),
  isLoading: false,
  error: null,
};

export const useAppointmentStore = create<AppointmentStore>()(
  immer((set) => ({
    ...initialState,

      setAppointments: (appointments) =>
        set((state) => {
          state.appointments = appointments;
        }),

      setUpcomingAppointments: (appointments) =>
        set((state) => {
          state.upcomingAppointments = appointments;
        }),

      setCalendarData: (data) =>
        set((state) => {
          state.calendarData = data;
        }),

      setCurrentMonth: (month) =>
        set((state) => {
          state.currentMonth = month;
        }),

      addAppointment: (appointment) =>
        set((state) => {
          state.appointments.push(appointment);
          // Also add to upcoming if it qualifies
          const today = new Date().toISOString().split('T')[0];
          if (
            appointment.scheduled_date >= today &&
            !['completed', 'cancelled', 'no_show'].includes(appointment.status)
          ) {
            state.upcomingAppointments.push(appointment);
            state.upcomingAppointments.sort(
              (a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()
            );
          }
        }),

      updateAppointment: (appointmentId, updates) =>
        set((state) => {
          const index = state.appointments.findIndex((a) => a.id === appointmentId);
          if (index !== -1) {
            state.appointments[index] = { ...state.appointments[index], ...updates };
          }
          const upcomingIndex = state.upcomingAppointments.findIndex((a) => a.id === appointmentId);
          if (upcomingIndex !== -1) {
            state.upcomingAppointments[upcomingIndex] = {
              ...state.upcomingAppointments[upcomingIndex],
              ...updates,
            };
          }
          if (state.selectedAppointment?.id === appointmentId) {
            state.selectedAppointment = { ...state.selectedAppointment, ...updates };
          }
        }),

      removeAppointment: (appointmentId) =>
        set((state) => {
          state.appointments = state.appointments.filter((a) => a.id !== appointmentId);
          state.upcomingAppointments = state.upcomingAppointments.filter((a) => a.id !== appointmentId);
          if (state.selectedAppointment?.id === appointmentId) {
            state.selectedAppointment = null;
          }
        }),

      setSelectedAppointment: (appointment) =>
        set((state) => {
          state.selectedAppointment = appointment;
        }),

      setLoading: (loading) =>
        set((state) => {
          state.isLoading = loading;
        }),

      setError: (error) =>
        set((state) => {
          state.error = error;
        }),

      reset: () => set(initialState),
    }))
);
