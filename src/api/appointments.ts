import { createHouseLocalProxy } from '@features/house/local/localApiProxy';
import type { IoniconName } from '@utils/categoryIcons';

import { apiClient } from './client';

// ============ TYPES ============

export const APPOINTMENT_TYPES = [
  'consultation',
  'quote',
  'work',
  'multi_day_project',
  'inspection',
  'follow_up',
  'warranty',
  'emergency',
] as const;

export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'rescheduled',
  'no_show',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_TYPE_INFO: Record<
  AppointmentType,
  { label: string; icon: string; iconName: IoniconName; color: string }
> = {
  consultation: { label: 'Initial Consultation', icon: '💬', iconName: 'chatbubbles', color: '#5856D6' },
  quote: { label: 'Quote/Estimate Visit', icon: '📋', iconName: 'document-text', color: '#FF9500' },
  work: { label: 'Scheduled Work', icon: '🔧', iconName: 'construct', color: '#007AFF' },
  multi_day_project: { label: 'Multi-Day Project', icon: '🏗️', iconName: 'hammer', color: '#34C759' },
  inspection: { label: 'Inspection', icon: '🔍', iconName: 'search', color: '#5AC8FA' },
  follow_up: { label: 'Follow-up', icon: '🔄', iconName: 'refresh', color: '#AF52DE' },
  warranty: { label: 'Warranty Service', icon: '🛡️', iconName: 'shield-checkmark', color: '#FF2D55' },
  emergency: { label: 'Emergency Call', icon: '🚨', iconName: 'warning', color: '#FF3B30' },
};

export const APPOINTMENT_STATUS_INFO: Record<AppointmentStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#FF9500' },
  confirmed: { label: 'Confirmed', color: '#34C759' },
  in_progress: { label: 'In Progress', color: '#007AFF' },
  completed: { label: 'Completed', color: '#8E8E93' },
  cancelled: { label: 'Cancelled', color: '#FF3B30' },
  rescheduled: { label: 'Rescheduled', color: '#AF52DE' },
  no_show: { label: 'No Show', color: '#FF3B30' },
};

export interface Appointment {
  id: string;
  household_id: string;
  contractor_id: string;
  type: AppointmentType;
  title: string;
  description: string | null;
  scheduled_date: string;
  scheduled_time_start: string | null;
  scheduled_time_end: string | null;
  status: AppointmentStatus;
  location: string | null;
  estimated_duration_minutes: number | null;
  actual_arrival_time: string | null;
  actual_departure_time: string | null;
  notes: string | null;
  reminder_sent: boolean;
  calendar_event_id: string | null;
  linked_quote_id: string | null;
  linked_visit_id: string | null;
  linked_report_id: string | null;
  linked_task_id: string | null;
  linked_project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentWithDetails extends Appointment {
  contractor: {
    id: string;
    name: string;
    company_name: string | null;
    specialty: string;
    phone: string | null;
    email: string | null;
    specialtyInfo: { label: string; icon: string; color: string };
  };
  typeInfo: { label: string; icon: string; color: string };
}

export interface CalendarAppointment {
  date: string;
  appointments: AppointmentWithDetails[];
}

// ============ REQUEST TYPES ============

interface CreateAppointmentRequest {
  contractor_id: string;
  type: AppointmentType;
  title: string;
  description?: string;
  scheduled_date: string;
  scheduled_time_start?: string;
  scheduled_time_end?: string;
  location?: string;
  estimated_duration_minutes?: number;
  notes?: string;
  linked_quote_id?: string;
  linked_report_id?: string;
  linked_task_id?: string;
  linked_project_id?: string;
}

interface UpdateAppointmentRequest {
  type?: AppointmentType;
  title?: string;
  description?: string;
  scheduled_date?: string;
  scheduled_time_start?: string;
  scheduled_time_end?: string;
  status?: AppointmentStatus;
  location?: string;
  estimated_duration_minutes?: number;
  notes?: string;
  calendar_event_id?: string;
  linked_quote_id?: string;
  linked_report_id?: string;
  linked_task_id?: string;
  linked_project_id?: string;
}

interface AppointmentFilters {
  contractor_id?: string;
  status?: AppointmentStatus;
  type?: AppointmentType;
  start_date?: string;
  end_date?: string;
  upcoming_only?: boolean;
}

interface RescheduleRequest {
  scheduled_date: string;
  scheduled_time_start?: string;
  scheduled_time_end?: string;
  reason?: string;
}

// ============ RESPONSE TYPES ============

interface AppointmentsResponse {
  appointments: AppointmentWithDetails[];
}

interface AppointmentResponse {
  appointment: AppointmentWithDetails;
}

interface CalendarResponse {
  calendar: CalendarAppointment[];
}

// ============ API CLIENT ============

const remoteAppointmentsApi = {
  // List appointments
  getAll: (householdId: string, filters?: AppointmentFilters) =>
    apiClient
      .get<AppointmentsResponse>(`/households/${householdId}/appointments`, { params: filters })
      .then((res) => res.data),

  // Get upcoming appointments
  getUpcoming: (householdId: string, daysAhead?: number) =>
    apiClient
      .get<AppointmentsResponse>(`/households/${householdId}/appointments/upcoming`, {
        params: { days_ahead: daysAhead },
      })
      .then((res) => res.data),

  // Get calendar view
  getCalendar: (householdId: string, month?: string) =>
    apiClient
      .get<CalendarResponse>(`/households/${householdId}/appointments/calendar`, {
        params: { month },
      })
      .then((res) => res.data),

  // Get single appointment
  getOne: (householdId: string, appointmentId: string) =>
    apiClient
      .get<AppointmentResponse>(`/households/${householdId}/appointments/${appointmentId}`)
      .then((res) => res.data),

  // Create appointment
  create: (householdId: string, data: CreateAppointmentRequest) =>
    apiClient
      .post<AppointmentResponse>(`/households/${householdId}/appointments`, data)
      .then((res) => res.data),

  // Update appointment
  update: (householdId: string, appointmentId: string, data: UpdateAppointmentRequest) =>
    apiClient
      .patch<AppointmentResponse>(`/households/${householdId}/appointments/${appointmentId}`, data)
      .then((res) => res.data),

  // Delete appointment
  delete: (householdId: string, appointmentId: string) =>
    apiClient.delete(`/households/${householdId}/appointments/${appointmentId}`),

  // Status transitions
  confirm: (householdId: string, appointmentId: string) =>
    apiClient
      .post<AppointmentResponse>(`/households/${householdId}/appointments/${appointmentId}/confirm`)
      .then((res) => res.data),

  cancel: (householdId: string, appointmentId: string, reason?: string) =>
    apiClient
      .post<AppointmentResponse>(`/households/${householdId}/appointments/${appointmentId}/cancel`, { reason })
      .then((res) => res.data),

  reschedule: (householdId: string, appointmentId: string, data: RescheduleRequest) =>
    apiClient
      .post<AppointmentResponse>(`/households/${householdId}/appointments/${appointmentId}/reschedule`, data)
      .then((res) => res.data),

  start: (householdId: string, appointmentId: string) =>
    apiClient
      .post<AppointmentResponse>(`/households/${householdId}/appointments/${appointmentId}/start`)
      .then((res) => res.data),

  complete: (householdId: string, appointmentId: string, notes?: string) =>
    apiClient
      .post<AppointmentResponse>(`/households/${householdId}/appointments/${appointmentId}/complete`, { notes })
      .then((res) => res.data),

  markNoShow: (householdId: string, appointmentId: string) =>
    apiClient
      .post<AppointmentResponse>(`/households/${householdId}/appointments/${appointmentId}/no-show`)
      .then((res) => res.data),
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens call
 * `appointmentsApi` exactly as before; the Proxy is what makes the H11 B2
 * cutover cost zero screen edits. See `documents/requirements/House v2/` §6, §11.
 *
 * `remoteMethods` is empty and, unusually for a labor-hub module, there is
 * nothing on the other side of the ledger either: all 13 methods have a working
 * local counterpart and none of them throws. An appointment carries no
 * attachment, runs no model and notifies no third party — the Worker's own
 * service is SQL over one table plus a contractor join, and the five status
 * routes are that update with a guard in front. Marking "the plumber arrived"
 * from a basement with no signal is the case this table exists for.
 */
export const appointmentsApi: typeof remoteAppointmentsApi = createHouseLocalProxy(
  remoteAppointmentsApi,
  {
    moduleName: 'appointments',
    // Narrow require: the barrel would pull the sync orchestrator and status
    // store into every api call from every screen.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolveLocal: () => require('@features/house/local/localAppointmentsApi').localAppointmentsApi,
  },
);
