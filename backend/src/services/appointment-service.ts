import { eq, and, asc } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { v4 as uuidv4 } from 'uuid';

import { householdMembers } from '../db/schema';
import { contractors, SPECIALTY_INFO, type ContractorSpecialty } from '../db/schema-contractors';
import {
  appointments,
  type Appointment,
  type AppointmentType,
  type AppointmentStatus,
  APPOINTMENT_TYPE_INFO,
} from '../db/schema-labor-hub';
import type { Env } from '../types';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { nowIso } from '../utils/id';

// Types for API responses
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

export class AppointmentService {
  private db: DrizzleD1Database;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1);
  }

  // ============ ACCESS CHECK ============

  private async checkHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const member = await this.db
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, userId)))
      .get();

    if (!member) {
      throw new ForbiddenError('You do not have access to this household');
    }
  }

  // ============ HELPER METHODS ============

  private async enrichAppointment(appointment: Appointment): Promise<AppointmentWithDetails> {
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(eq(contractors.id, appointment.contractor_id))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    return {
      ...appointment,
      contractor: {
        id: contractor.id,
        name: contractor.name,
        company_name: contractor.company_name,
        specialty: contractor.specialty,
        phone: contractor.phone,
        email: contractor.email,
        specialtyInfo: SPECIALTY_INFO[contractor.specialty as ContractorSpecialty] || SPECIALTY_INFO.other,
      },
      typeInfo: APPOINTMENT_TYPE_INFO[appointment.type as AppointmentType] || APPOINTMENT_TYPE_INFO.consultation,
    };
  }

  // ============ APPOINTMENTS ============

  async getAppointments(
    householdId: string,
    userId: string,
    filters?: {
      contractorId?: string;
      status?: string;
      type?: string;
      startDate?: string;
      endDate?: string;
      upcomingOnly?: boolean;
    }
  ): Promise<AppointmentWithDetails[]> {
    await this.checkHouseholdAccess(householdId, userId);

    let appointmentList = await this.db
      .select()
      .from(appointments)
      .where(eq(appointments.household_id, householdId))
      .orderBy(asc(appointments.scheduled_date), asc(appointments.scheduled_time_start))
      .all();

    // Apply filters
    if (filters?.contractorId) {
      appointmentList = appointmentList.filter((a) => a.contractor_id === filters.contractorId);
    }
    if (filters?.status) {
      appointmentList = appointmentList.filter((a) => a.status === filters.status);
    }
    if (filters?.type) {
      appointmentList = appointmentList.filter((a) => a.type === filters.type);
    }
    if (filters?.startDate) {
      appointmentList = appointmentList.filter((a) => a.scheduled_date >= filters.startDate!);
    }
    if (filters?.endDate) {
      appointmentList = appointmentList.filter((a) => a.scheduled_date <= filters.endDate!);
    }
    if (filters?.upcomingOnly) {
      const today = nowIso().split('T')[0];
      appointmentList = appointmentList.filter(
        (a) => a.scheduled_date >= today && !['completed', 'cancelled', 'no_show'].includes(a.status)
      );
    }

    // Enrich with contractor details
    return Promise.all(appointmentList.map((a) => this.enrichAppointment(a)));
  }

  async getUpcomingAppointments(
    householdId: string,
    userId: string,
    daysAhead: number = 30
  ): Promise<AppointmentWithDetails[]> {
    const today = nowIso().split('T')[0];
    const endDate = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    return this.getAppointments(householdId, userId, {
      startDate: today,
      endDate,
      upcomingOnly: true,
    });
  }

  async getAppointmentsForCalendar(
    householdId: string,
    userId: string,
    month?: string
  ): Promise<CalendarAppointment[]> {
    await this.checkHouseholdAccess(householdId, userId);

    // Default to current month if not specified
    const targetMonth = month || nowIso().slice(0, 7);
    const startDate = `${targetMonth}-01`;
    const [year, monthNum] = targetMonth.split('-').map(Number);
    const lastDay = new Date(year, monthNum, 0).getDate();
    const endDate = `${targetMonth}-${lastDay.toString().padStart(2, '0')}`;

    const appointmentList = await this.getAppointments(householdId, userId, { startDate, endDate });

    // Group by date
    const grouped = appointmentList.reduce(
      (acc, appointment) => {
        const date = appointment.scheduled_date;
        if (!acc[date]) {
          acc[date] = [];
        }
        acc[date].push(appointment);
        return acc;
      },
      {} as Record<string, AppointmentWithDetails[]>
    );

    return Object.entries(grouped)
      .map(([date, appts]) => ({ date, appointments: appts }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async getAppointment(householdId: string, appointmentId: string, userId: string): Promise<AppointmentWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);

    const appointment = await this.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.household_id, householdId)))
      .get();

    if (!appointment) {
      throw new NotFoundError('Appointment not found');
    }

    return this.enrichAppointment(appointment);
  }

  async createAppointment(
    householdId: string,
    userId: string,
    input: {
      contractorId: string;
      type: AppointmentType;
      title: string;
      description?: string;
      scheduledDate: string;
      scheduledTimeStart?: string;
      scheduledTimeEnd?: string;
      location?: string;
      estimatedDurationMinutes?: number;
      notes?: string;
      linkedQuoteId?: string;
      linkedReportId?: string;
      linkedTaskId?: string;
      linkedProjectId?: string;
    }
  ): Promise<AppointmentWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);

    // Verify contractor exists and belongs to household
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(and(eq(contractors.id, input.contractorId), eq(contractors.household_id, householdId)))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    const id = uuidv4();
    const now = nowIso();

    await this.db.insert(appointments).values({
      id,
      household_id: householdId,
      contractor_id: input.contractorId,
      type: input.type,
      title: input.title,
      description: input.description || null,
      scheduled_date: input.scheduledDate,
      scheduled_time_start: input.scheduledTimeStart || null,
      scheduled_time_end: input.scheduledTimeEnd || null,
      status: 'pending',
      location: input.location || null,
      estimated_duration_minutes: input.estimatedDurationMinutes || null,
      notes: input.notes || null,
      linked_quote_id: input.linkedQuoteId || null,
      linked_report_id: input.linkedReportId || null,
      linked_task_id: input.linkedTaskId || null,
      linked_project_id: input.linkedProjectId || null,
      created_at: now,
      updated_at: now,
    });

    return this.getAppointment(householdId, id, userId);
  }

  async updateAppointment(
    householdId: string,
    appointmentId: string,
    userId: string,
    input: {
      type?: AppointmentType;
      title?: string;
      description?: string;
      scheduledDate?: string;
      scheduledTimeStart?: string;
      scheduledTimeEnd?: string;
      status?: AppointmentStatus;
      location?: string;
      estimatedDurationMinutes?: number;
      actualArrivalTime?: string;
      actualDepartureTime?: string;
      notes?: string;
      calendarEventId?: string;
      linkedQuoteId?: string;
      linkedReportId?: string;
      linkedTaskId?: string;
      linkedProjectId?: string;
    }
  ): Promise<AppointmentWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Appointment not found');
    }

    const updateData: Partial<Appointment> = {
      updated_at: nowIso(),
    };

    if (input.type !== undefined) updateData.type = input.type;
    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.scheduledDate !== undefined) updateData.scheduled_date = input.scheduledDate;
    if (input.scheduledTimeStart !== undefined) updateData.scheduled_time_start = input.scheduledTimeStart;
    if (input.scheduledTimeEnd !== undefined) updateData.scheduled_time_end = input.scheduledTimeEnd;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.location !== undefined) updateData.location = input.location;
    if (input.estimatedDurationMinutes !== undefined) updateData.estimated_duration_minutes = input.estimatedDurationMinutes;
    if (input.actualArrivalTime !== undefined) updateData.actual_arrival_time = input.actualArrivalTime;
    if (input.actualDepartureTime !== undefined) updateData.actual_departure_time = input.actualDepartureTime;
    if (input.notes !== undefined) updateData.notes = input.notes;
    if (input.calendarEventId !== undefined) updateData.calendar_event_id = input.calendarEventId;
    if (input.linkedQuoteId !== undefined) updateData.linked_quote_id = input.linkedQuoteId;
    if (input.linkedReportId !== undefined) updateData.linked_report_id = input.linkedReportId;
    if (input.linkedTaskId !== undefined) updateData.linked_task_id = input.linkedTaskId;
    if (input.linkedProjectId !== undefined) updateData.linked_project_id = input.linkedProjectId;

    await this.db.update(appointments).set(updateData).where(eq(appointments.id, appointmentId));

    return this.getAppointment(householdId, appointmentId, userId);
  }

  async deleteAppointment(householdId: string, appointmentId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, appointmentId), eq(appointments.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Appointment not found');
    }

    await this.db.delete(appointments).where(eq(appointments.id, appointmentId));
  }

  // ============ STATUS TRANSITIONS ============

  async confirmAppointment(householdId: string, appointmentId: string, userId: string): Promise<AppointmentWithDetails> {
    return this.updateAppointment(householdId, appointmentId, userId, { status: 'confirmed' });
  }

  async cancelAppointment(
    householdId: string,
    appointmentId: string,
    userId: string,
    reason?: string
  ): Promise<AppointmentWithDetails> {
    const existing = await this.getAppointment(householdId, appointmentId, userId);

    if (['completed', 'cancelled'].includes(existing.status)) {
      throw new ValidationError('Cannot cancel a completed or already cancelled appointment');
    }

    const notes = reason ? `${existing.notes || ''}\nCancellation reason: ${reason}`.trim() : existing.notes;

    return this.updateAppointment(householdId, appointmentId, userId, {
      status: 'cancelled',
      notes: notes || undefined,
    });
  }

  async rescheduleAppointment(
    householdId: string,
    appointmentId: string,
    userId: string,
    input: {
      scheduledDate: string;
      scheduledTimeStart?: string;
      scheduledTimeEnd?: string;
      reason?: string;
    }
  ): Promise<AppointmentWithDetails> {
    const existing = await this.getAppointment(householdId, appointmentId, userId);

    if (['completed', 'cancelled', 'no_show'].includes(existing.status)) {
      throw new ValidationError('Cannot reschedule a completed, cancelled, or no-show appointment');
    }

    const notes = input.reason
      ? `${existing.notes || ''}\nRescheduled from ${existing.scheduled_date}: ${input.reason}`.trim()
      : existing.notes;

    return this.updateAppointment(householdId, appointmentId, userId, {
      status: 'rescheduled',
      scheduledDate: input.scheduledDate,
      scheduledTimeStart: input.scheduledTimeStart,
      scheduledTimeEnd: input.scheduledTimeEnd,
      notes: notes || undefined,
    });
  }

  async startAppointment(householdId: string, appointmentId: string, userId: string): Promise<AppointmentWithDetails> {
    const existing = await this.getAppointment(householdId, appointmentId, userId);

    if (!['pending', 'confirmed', 'rescheduled'].includes(existing.status)) {
      throw new ValidationError('Can only start a pending, confirmed, or rescheduled appointment');
    }

    return this.updateAppointment(householdId, appointmentId, userId, {
      status: 'in_progress',
      actualArrivalTime: nowIso(),
    });
  }

  async completeAppointment(
    householdId: string,
    appointmentId: string,
    userId: string,
    notes?: string
  ): Promise<AppointmentWithDetails> {
    const existing = await this.getAppointment(householdId, appointmentId, userId);

    if (existing.status !== 'in_progress') {
      throw new ValidationError('Can only complete an in-progress appointment');
    }

    const updatedNotes = notes ? `${existing.notes || ''}\n${notes}`.trim() : existing.notes;

    return this.updateAppointment(householdId, appointmentId, userId, {
      status: 'completed',
      actualDepartureTime: nowIso(),
      notes: updatedNotes || undefined,
    });
  }

  async markNoShow(householdId: string, appointmentId: string, userId: string): Promise<AppointmentWithDetails> {
    const existing = await this.getAppointment(householdId, appointmentId, userId);

    if (!['pending', 'confirmed', 'rescheduled'].includes(existing.status)) {
      throw new ValidationError('Can only mark no-show for pending, confirmed, or rescheduled appointments');
    }

    return this.updateAppointment(householdId, appointmentId, userId, { status: 'no_show' });
  }
}
