/**
 * Local `appointments` — the ledger counterpart of `src/api/appointments.ts`
 * (plan §11, sub-wave B2). B1 shipped the contractor; this is the calendar the
 * contractor turns up on.
 *
 * **Every one of the 13 methods is local. There is no throw site here.** That is
 * unusual enough to state: an appointment carries no attachment, runs no model
 * and reaches no third party. The Worker's own `appointment-service.ts` is pure
 * SQL over one table plus a contractor join, and `POST /confirm`, `/cancel`,
 * `/start`, `/complete` and `/no-show` are all `updateAppointment` with a status
 * and a guard. Nothing on that list needs a server, and a household that cannot
 * mark "the plumber arrived" while standing in their own basement with no signal
 * would have the feature exactly backwards.
 *
 * **The status machine is ported, guards included.** `cancel`, `reschedule`,
 * `start`, `complete` and `markNoShow` each refuse from the wrong state and the
 * refusals are reproduced verbatim, because they are the only thing keeping the
 * row honest: `complete` demands `in_progress`, so an appointment cannot record
 * a departure time for a visit that never started. Dropping a guard offline
 * would let a device mint a state the server would have rejected, and the merge
 * would then replicate it everywhere as fact.
 *
 * **`AppointmentWithDetails` is composed, never stored.** The `contractor` block
 * is a join `enrichAppointment` performs per request and `typeInfo` is a lookup
 * into `APPOINTMENT_TYPE_INFO`, a client constant that changes with the app
 * bundle. Storing either would give one fact two homes in the ledger and let
 * per-field LWW converge them to different answers — the same rule
 * `localContractorsApi.withStats` follows for `totalSpent`.
 *
 * **Notes are appended, not replaced.** `cancel`, `reschedule` and `complete`
 * all splice a line onto `notes` rather than overwriting it. That is the
 * server's behaviour and it matters more here than there: `notes` is one text
 * column under per-field LWW, so two members cancelling and completing offline
 * resolve to ONE of the two note bodies. Appending at least means the surviving
 * body is a superset of what that member saw.
 *
 * **No bulk path.** Every write is one row and there is no cascade — D1 declares
 * `appointments.linked_visit_id` as `set null` in the OTHER direction (a visit
 * going does not take its appointment), and nothing points AT an appointment
 * except `quotes.appointment_id`, which `localQuotesApi` clears in its own op.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import {
  APPOINTMENT_TYPE_INFO,
  type AppointmentStatus,
  type AppointmentType,
  type AppointmentWithDetails,
  type CalendarAppointment,
} from '@api/appointments';
import { SPECIALTY_INFO, type ContractorSpecialty } from '@api/contractors';

import { HouseLocalUnknownPropertyError } from './errors';
import { newLocalId } from './ids';
import { activeHouseholdId, nowIso, rowsOf, writeLocal } from './localWrite';
import type { LocalAppointment, LocalContractor } from './types';

// ---------------------------------------------------------------------------
// Input shapes — mirrors of the module-private request types in
// `src/api/appointments.ts`. They are not exported there, so they are restated
// rather than imported; `apiParity.test.ts` catches a method that disappears and
// `tsc` catches a field whose type changed on the DTO.
// ---------------------------------------------------------------------------

export type CreateLocalAppointmentInput = {
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
};

export type UpdateLocalAppointmentInput = Partial<
  Omit<CreateLocalAppointmentInput, 'contractor_id'>
> & {
  status?: AppointmentStatus;
  calendar_event_id?: string;
  actual_arrival_time?: string;
  actual_departure_time?: string;
};

export type LocalAppointmentFilters = {
  contractor_id?: string;
  status?: AppointmentStatus;
  type?: AppointmentType;
  start_date?: string;
  end_date?: string;
  upcoming_only?: boolean;
};

export type RescheduleLocalAppointmentInput = {
  scheduled_date: string;
  scheduled_time_start?: string;
  scheduled_time_end?: string;
  reason?: string;
};

/** Statuses that `upcoming_only` treats as no longer upcoming. */
const CLOSED_STATUSES: readonly AppointmentStatus[] = ['completed', 'cancelled', 'no_show'];

/** The three states a job can still be started, moved or missed from. */
const OPEN_STATUSES: readonly AppointmentStatus[] = ['pending', 'confirmed', 'rescheduled'];

/**
 * The Worker's `ValidationError` — a 400 the screens already render, and NOT a
 * `HouseLocalUnsupportedError`. The distinction matters: an unsupported error
 * says "this feature is off in private mode", while these say "you cannot
 * complete an appointment that never started", which is true on both backends.
 */
class LocalAppointmentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalAppointmentStateError';
  }
}

/**
 * Reads and writes address the ACTIVE property — `engine.ts` holds one ledger
 * per property and `mutateLocalHouseLedger` writes to whichever is active (H5,
 * plan §7). Answering another property's id out of the active ledger would list
 * the cottage's roofer under the house, so the mismatch is raised, not absorbed.
 */
function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function appointmentsOf(householdId: string): LocalAppointment[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalAppointment>('appointments');
}

function contractorsById(householdId: string): Map<string, LocalContractor> {
  requireActiveProperty(householdId);
  return new Map(rowsOf<LocalContractor>('contractors').map((row) => [row.id, row]));
}

function requireAppointment(householdId: string, appointmentId: string): LocalAppointment {
  const found = appointmentsOf(householdId).find((row) => row.id === appointmentId);
  if (!found) throw new Error('Appointment not found');
  return found;
}

/**
 * Server order: `scheduled_date` asc, then `scheduled_time_start` asc.
 *
 * The SQL puts NULLs first on the time column; a JS `localeCompare` against
 * `null` would throw, so an unset start time sorts as the empty string, which
 * lands in the same place. An all-day appointment therefore leads its day, which
 * is what a member expects from a row that has no time on it.
 */
function bySchedule(a: LocalAppointment, b: LocalAppointment): number {
  const byDate = a.scheduled_date.localeCompare(b.scheduled_date);
  if (byDate !== 0) return byDate;
  return (a.scheduled_time_start ?? '').localeCompare(b.scheduled_time_start ?? '');
}

/**
 * The join + the type lookup, rebuilt on every read.
 *
 * `enrichAppointment` throws `NotFoundError('Contractor not found')` when the
 * join dangles, and on device it CAN dangle: D1 cascades `appointments` when a
 * contractor is deleted, but `localContractorsApi.delete` — written in B1,
 * before this table was live — cascades only visits, documents and
 * representatives. So a list read drops the orphan (rendering an appointment
 * with no contractor would crash the row renderer, not the sync) and a single
 * read raises, which is the same thing the member sees either way. Closing the
 * gap means widening B1's cascade, which is a B1 edit, not a B2 one.
 */
function enrich(
  appointment: LocalAppointment,
  contractor: LocalContractor,
): AppointmentWithDetails {
  return {
    ...appointment,
    contractor: {
      id: contractor.id,
      name: contractor.name,
      company_name: contractor.company_name,
      specialty: contractor.specialty,
      phone: contractor.phone,
      email: contractor.email,
      specialtyInfo: SPECIALTY_INFO[contractor.specialty as ContractorSpecialty] ?? SPECIALTY_INFO.other,
    },
    typeInfo: APPOINTMENT_TYPE_INFO[appointment.type] ?? APPOINTMENT_TYPE_INFO.consultation,
  };
}

function enrichAll(
  rows: readonly LocalAppointment[],
  byId: Map<string, LocalContractor>,
): AppointmentWithDetails[] {
  const out: AppointmentWithDetails[] = [];
  for (const row of rows) {
    const contractor = byId.get(row.contractor_id);
    if (contractor) out.push(enrich(row, contractor));
  }
  return out;
}

/** `YYYY-MM-DD` for today, the same slice `nowIso().split('T')[0]` gives. */
function today(): string {
  return nowIso().slice(0, 10);
}

function filtered(
  rows: readonly LocalAppointment[],
  filters?: LocalAppointmentFilters,
): LocalAppointment[] {
  const cutoff = filters?.upcoming_only ? today() : null;
  return rows
    .filter((row) => (filters?.contractor_id ? row.contractor_id === filters.contractor_id : true))
    .filter((row) => (filters?.status ? row.status === filters.status : true))
    .filter((row) => (filters?.type ? row.type === filters.type : true))
    // Inclusive string bounds, exactly as the Worker does them — `scheduled_date`
    // is a `text` column holding `YYYY-MM-DD`, which sorts lexically.
    .filter((row) => (filters?.start_date ? row.scheduled_date >= filters.start_date : true))
    .filter((row) => (filters?.end_date ? row.scheduled_date <= filters.end_date : true))
    .filter((row) =>
      cutoff ? row.scheduled_date >= cutoff && !CLOSED_STATUSES.includes(row.status) : true,
    )
    .sort(bySchedule);
}

/**
 * Append a line to `notes`, the server's exact shape:
 * `` `${existing || ''}\n${line}`.trim() ``. An empty result stays NULL rather
 * than becoming an empty string, because the detail screen renders the notes
 * block on truthiness.
 */
function appendNote(existing: string | null, line: string | null): string | null {
  if (!line) return existing;
  return `${existing || ''}\n${line}`.trim() || null;
}

/**
 * The single write path every mutation funnels through — one op, whatever the
 * caller called.
 *
 * `confirm`/`cancel`/`start`/`complete`/`markNoShow` all delegate to `update`,
 * so putting the field application here rather than inline in each method keeps
 * the op count at exactly one per member action. The Worker reaches the same
 * place by a different road (`updateAppointment` re-reads and re-enriches),
 * which is why the state guards live in the CALLERS: they need the pre-update
 * row, and by the time the mutator runs the row is already a draft.
 */
async function applyUpdate(
  householdId: string,
  appointmentId: string,
  data: UpdateLocalAppointmentInput,
  op: { opType: string; payload: unknown },
): Promise<void> {
  await writeLocal(
    (draft) => {
      const appointment = draft.appointments.find(
        (row) => row.id === appointmentId && row.household_id === householdId,
      );
      if (!appointment) throw new Error('Appointment not found');
      // `updateAppointment` treats an absent key as "leave it alone"; an empty
      // string clears the column, and the DTO's cleared state is NULL. `title`
      // and `scheduled_date` are the exceptions — both are notNull in D1, so
      // they are stored as given rather than coalesced away.
      if (data.type !== undefined) appointment.type = data.type;
      if (data.title !== undefined) appointment.title = data.title;
      if (data.description !== undefined) appointment.description = data.description || null;
      if (data.scheduled_date !== undefined) appointment.scheduled_date = data.scheduled_date;
      if (data.scheduled_time_start !== undefined) {
        appointment.scheduled_time_start = data.scheduled_time_start || null;
      }
      if (data.scheduled_time_end !== undefined) {
        appointment.scheduled_time_end = data.scheduled_time_end || null;
      }
      if (data.status !== undefined) appointment.status = data.status;
      if (data.location !== undefined) appointment.location = data.location || null;
      if (data.estimated_duration_minutes !== undefined) {
        appointment.estimated_duration_minutes = data.estimated_duration_minutes ?? null;
      }
      if (data.actual_arrival_time !== undefined) {
        appointment.actual_arrival_time = data.actual_arrival_time || null;
      }
      if (data.actual_departure_time !== undefined) {
        appointment.actual_departure_time = data.actual_departure_time || null;
      }
      if (data.notes !== undefined) appointment.notes = data.notes || null;
      if (data.calendar_event_id !== undefined) {
        appointment.calendar_event_id = data.calendar_event_id || null;
      }
      if (data.linked_quote_id !== undefined) {
        appointment.linked_quote_id = data.linked_quote_id || null;
      }
      if (data.linked_report_id !== undefined) {
        appointment.linked_report_id = data.linked_report_id || null;
      }
      if (data.linked_task_id !== undefined) {
        appointment.linked_task_id = data.linked_task_id || null;
      }
      if (data.linked_project_id !== undefined) {
        appointment.linked_project_id = data.linked_project_id || null;
      }
      appointment.updated_at = nowIso();
    },
    {
      opType: op.opType,
      entityType: 'appointment',
      entityId: appointmentId,
      payload: op.payload,
    },
  );
}

export const localAppointmentsApi = {
  /** `GET /appointments` — `AppointmentService.getAppointments`. */
  getAll: async (householdId: string, filters?: LocalAppointmentFilters) => {
    const byId = contractorsById(householdId);
    return { appointments: enrichAll(filtered(appointmentsOf(householdId), filters), byId) };
  },

  /**
   * `GET /appointments/upcoming`.
   *
   * The window is computed the Worker's way — `Date.now() + days * 86_400_000`,
   * sliced to a date — so a run at 23:59 local on the last day of a month gives
   * the same answer on both backends. Default 30 days, from the route.
   */
  getUpcoming: async (householdId: string, daysAhead?: number) => {
    const days = daysAhead ?? 30;
    const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return localAppointmentsApi.getAll(householdId, {
      start_date: today(),
      end_date: endDate,
      upcoming_only: true,
    });
  },

  /**
   * `GET /appointments/calendar` — one entry per day that HAS appointments.
   *
   * The month's last day is derived with `new Date(year, month, 0)`, which is
   * the Worker's own trick (day 0 of the next month), so February and leap years
   * agree without a table of month lengths.
   */
  getCalendar: async (householdId: string, month?: string) => {
    const targetMonth = month || nowIso().slice(0, 7);
    const [year, monthNum] = targetMonth.split('-').map(Number);
    const lastDay = new Date(year ?? 0, monthNum ?? 0, 0).getDate();
    const { appointments } = await localAppointmentsApi.getAll(householdId, {
      start_date: `${targetMonth}-01`,
      end_date: `${targetMonth}-${String(lastDay).padStart(2, '0')}`,
    });

    const grouped = new Map<string, AppointmentWithDetails[]>();
    for (const appointment of appointments) {
      const list = grouped.get(appointment.scheduled_date);
      if (list) list.push(appointment);
      else grouped.set(appointment.scheduled_date, [appointment]);
    }

    const calendar: CalendarAppointment[] = [...grouped.entries()]
      .map(([date, rows]) => ({ date, appointments: rows }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { calendar };
  },

  /** `GET /appointments/:id`. Raises when the contractor join dangles, as the Worker does. */
  getOne: async (householdId: string, appointmentId: string) => {
    const found = requireAppointment(householdId, appointmentId);
    const contractor = contractorsById(householdId).get(found.contractor_id);
    if (!contractor) throw new Error('Contractor not found');
    return { appointment: enrich(found, contractor) };
  },

  create: async (householdId: string, data: CreateLocalAppointmentInput) => {
    requireActiveProperty(householdId);
    const contractor = contractorsById(householdId).get(data.contractor_id);
    // The Worker verifies the contractor belongs to the household before
    // inserting. B1 made that check answerable on device, which is precisely the
    // dependency §11 used to order the sub-waves.
    if (!contractor) throw new Error('Contractor not found');

    const timestamp = nowIso();
    // Random id: D1 puts no uniqueness on this table, and two members booking
    // the same contractor for the same morning have booked two appointments
    // until one of them says otherwise. Minting a deterministic id from
    // `(contractor_id, scheduled_date)` would merge a genuine double-booking.
    const appointment: LocalAppointment = {
      id: newLocalId('apt'),
      household_id: householdId,
      contractor_id: data.contractor_id,
      type: data.type,
      title: data.title,
      description: data.description || null,
      scheduled_date: data.scheduled_date,
      scheduled_time_start: data.scheduled_time_start || null,
      scheduled_time_end: data.scheduled_time_end || null,
      // The route hard-codes `pending`; a caller cannot open an appointment in
      // any other state, on either backend.
      status: 'pending',
      location: data.location || null,
      estimated_duration_minutes: data.estimated_duration_minutes || null,
      actual_arrival_time: null,
      actual_departure_time: null,
      notes: data.notes || null,
      reminder_sent: false,
      calendar_event_id: null,
      linked_quote_id: data.linked_quote_id || null,
      // Not settable at creation on either backend — the visit is linked later,
      // when visit mode starts against this booking.
      linked_visit_id: null,
      linked_report_id: data.linked_report_id || null,
      linked_task_id: data.linked_task_id || null,
      linked_project_id: data.linked_project_id || null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        draft.appointments.push(appointment);
      },
      {
        opType: 'APPOINTMENT_CREATE',
        entityType: 'appointment',
        entityId: appointment.id,
        payload: appointment,
      },
    );
    return { appointment: enrich(appointment, contractor) };
  },

  update: async (
    householdId: string,
    appointmentId: string,
    data: UpdateLocalAppointmentInput,
  ) => {
    requireActiveProperty(householdId);
    await applyUpdate(householdId, appointmentId, data, {
      opType: 'APPOINTMENT_UPDATE',
      payload: data,
    });
    return localAppointmentsApi.getOne(householdId, appointmentId);
  },

  /**
   * The Worker checks the row exists and then deletes it; a second tap 404s
   * rather than answering 204, unlike `deleteVisit`. Mirrored, because
   * `AppointmentDetailScreen` navigates back on success and a silent 204 on a
   * row that is already gone would look like the delete worked twice.
   *
   * Nothing cascades. `quotes.appointment_id` points here with `set null`, and
   * that half is cleared in this same op so no peer holds a quote pointing at a
   * tombstone — the same rule `deleteVisit` follows for its documents.
   */
  delete: async (householdId: string, appointmentId: string) => {
    requireActiveProperty(householdId);
    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const exists = draft.appointments.some(
          (row) => row.id === appointmentId && row.household_id === householdId,
        );
        if (!exists) throw new Error('Appointment not found');
        draft.appointments = draft.appointments.filter((row) => row.id !== appointmentId);
        for (const quote of draft.quotes) {
          if (quote.appointment_id !== appointmentId) continue;
          quote.appointment_id = null;
          quote.updated_at = timestamp;
        }
      },
      {
        opType: 'APPOINTMENT_DELETE',
        entityType: 'appointment',
        entityId: appointmentId,
        payload: { id: appointmentId },
      },
    );
  },

  // ---- status transitions -------------------------------------------------

  /** `confirmAppointment` is `update({ status: 'confirmed' })`, guard-free on both sides. */
  confirm: async (householdId: string, appointmentId: string) =>
    localAppointmentsApi.update(householdId, appointmentId, { status: 'confirmed' }),

  cancel: async (householdId: string, appointmentId: string, reason?: string) => {
    const existing = requireAppointment(householdId, appointmentId);
    if (existing.status === 'completed' || existing.status === 'cancelled') {
      throw new LocalAppointmentStateError(
        'Cannot cancel a completed or already cancelled appointment',
      );
    }
    return localAppointmentsApi.update(householdId, appointmentId, {
      status: 'cancelled',
      notes: appendNote(existing.notes, reason ? `Cancellation reason: ${reason}` : null) ?? undefined,
    });
  },

  reschedule: async (
    householdId: string,
    appointmentId: string,
    data: RescheduleLocalAppointmentInput,
  ) => {
    const existing = requireAppointment(householdId, appointmentId);
    if (CLOSED_STATUSES.includes(existing.status)) {
      throw new LocalAppointmentStateError(
        'Cannot reschedule a completed, cancelled, or no-show appointment',
      );
    }
    // The note records the date being moved FROM, so the history survives the
    // column being overwritten a line below.
    const notes = appendNote(
      existing.notes,
      data.reason ? `Rescheduled from ${existing.scheduled_date}: ${data.reason}` : null,
    );
    return localAppointmentsApi.update(householdId, appointmentId, {
      status: 'rescheduled',
      scheduled_date: data.scheduled_date,
      scheduled_time_start: data.scheduled_time_start,
      scheduled_time_end: data.scheduled_time_end,
      notes: notes ?? undefined,
    });
  },

  start: async (householdId: string, appointmentId: string) => {
    const existing = requireAppointment(householdId, appointmentId);
    if (!OPEN_STATUSES.includes(existing.status)) {
      throw new LocalAppointmentStateError(
        'Can only start a pending, confirmed, or rescheduled appointment',
      );
    }
    return localAppointmentsApi.update(householdId, appointmentId, {
      status: 'in_progress',
      actual_arrival_time: nowIso(),
    });
  },

  complete: async (householdId: string, appointmentId: string, notes?: string) => {
    const existing = requireAppointment(householdId, appointmentId);
    if (existing.status !== 'in_progress') {
      throw new LocalAppointmentStateError('Can only complete an in-progress appointment');
    }
    return localAppointmentsApi.update(householdId, appointmentId, {
      status: 'completed',
      actual_departure_time: nowIso(),
      notes: appendNote(existing.notes, notes ?? null) ?? undefined,
    });
  },

  markNoShow: async (householdId: string, appointmentId: string) => {
    const existing = requireAppointment(householdId, appointmentId);
    if (!OPEN_STATUSES.includes(existing.status)) {
      throw new LocalAppointmentStateError(
        'Can only mark no-show for pending, confirmed, or rescheduled appointments',
      );
    }
    return localAppointmentsApi.update(householdId, appointmentId, { status: 'no_show' });
  },
};
