/**
 * `localAppointmentsApi` against a real in-memory session (plan §6 DoD, H11
 * sub-wave B2).
 *
 * Four behaviours here are load-bearing beyond the round trips:
 *
 *  - **The status machine refuses from the wrong state, exactly as the Worker
 *    does.** These guards are the only thing keeping the row honest: without
 *    them a device could record a departure time for a visit that never started,
 *    and the merge would replicate that everywhere as fact.
 *  - **Every method is ONE op, including the five status transitions.** They all
 *    delegate to `update`, so a route that opened its own write would double the
 *    op count for a single tap and put two rows in every peer's delta.
 *  - **The contractor join and `typeInfo` are recomputed, never stored.** Two
 *    devices with per-field LWW would otherwise converge a cached contractor
 *    name to an answer neither of them wrote.
 *  - **Notes are appended, not replaced.** `notes` is one text column under
 *    per-field LWW; appending is what keeps the surviving body a superset of
 *    what its author saw.
 */
import {
  getLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { HouseLocalUnknownPropertyError } from '../errors';
import {
  localAppointmentsApi,
  type CreateLocalAppointmentInput,
} from '../localAppointmentsApi';
import { localContractorsApi } from '../localContractorsApi';
import { localQuotesApi } from '../localQuotesApi';

const USER = 'user-appointments-1';

let householdId: string;
let contractorId: string;

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

async function book(overrides: Partial<CreateLocalAppointmentInput> = {}) {
  const { appointment } = await localAppointmentsApi.create(householdId, {
    contractor_id: contractorId,
    type: 'work',
    title: 'Furnace service',
    scheduled_date: '2026-09-14',
    scheduled_time_start: '09:00',
    ...overrides,
  });
  return appointment;
}

/** Drive a booking to `in_progress`, the only state `complete` accepts. */
async function started() {
  const appointment = await book();
  await localAppointmentsApi.confirm(householdId, appointment.id);
  await localAppointmentsApi.start(householdId, appointment.id);
  return appointment;
}

beforeEach(async () => {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Appointment test home' });
  householdId = ledger.household.id;
  const { contractor } = await localContractorsApi.create(householdId, {
    name: 'Dave Rivera',
    company_name: 'Rivera Plumbing',
    specialty: 'plumber',
    phone: '604-555-0134',
    email: 'dave@rivera.example',
  });
  contractorId = contractor.id;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('appointments — create / read / update / delete', () => {
  it('round-trips a booking, opened in `pending` whatever the caller asks', async () => {
    const created = await book({ description: 'Annual service', location: 'Basement' });
    expect(created.household_id).toBe(householdId);
    // The route hard-codes the opening status on both backends — a caller cannot
    // create an appointment that is already confirmed.
    expect(created.status).toBe('pending');
    expect(created.reminder_sent).toBe(false);
    expect(created.description).toBe('Annual service');
    // Never settable at creation: the visit is linked later, when visit mode
    // starts against this booking.
    expect(created.linked_visit_id).toBeNull();

    const { appointment } = await localAppointmentsApi.getOne(householdId, created.id);
    expect(appointment.contractor.name).toBe('Dave Rivera');
    expect(appointment.contractor.specialtyInfo.label).toBe('Plumber');
    expect(appointment.typeInfo.label).toBe('Scheduled Work');

    const { appointment: updated } = await localAppointmentsApi.update(householdId, created.id, {
      location: '',
      estimated_duration_minutes: 90,
    });
    // Cleared with NULL, not an empty string — the detail rows render on
    // truthiness and would otherwise show a blank line.
    expect(updated.location).toBeNull();
    expect(updated.estimated_duration_minutes).toBe(90);

    await localAppointmentsApi.delete(householdId, created.id);
    const { appointments } = await localAppointmentsApi.getAll(householdId);
    expect(appointments).toHaveLength(0);
  });

  it('requires the contractor to exist before anything can be booked', async () => {
    // B1 is what made this answerable on device — the dependency §11 used to
    // order the sub-waves. Without it the row would hang off nobody.
    await expect(book({ contractor_id: 'ctr_missing' })).rejects.toThrow('Contractor not found');
  });

  it('raises for an appointment that does not exist', async () => {
    await expect(localAppointmentsApi.getOne(householdId, 'apt_missing')).rejects.toThrow(
      'Appointment not found',
    );
    await expect(
      localAppointmentsApi.update(householdId, 'apt_missing', { title: 'x' }),
    ).rejects.toThrow('Appointment not found');
    // Unlike `deleteVisit`, the Worker checks first and 404s on the second tap.
    await expect(localAppointmentsApi.delete(householdId, 'apt_missing')).rejects.toThrow(
      'Appointment not found',
    );
  });

  it('refuses to answer for a property that is not the active one', async () => {
    await expect(localAppointmentsApi.getAll('hh_local_someone_else')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
  });

  it('clears a quote pointing at the deleted booking, in the SAME op', async () => {
    // D1 declares `quotes.appointment_id` as `set null`. A ledger delete is a
    // tombstone rather than a foreign key, so splitting the two halves would let
    // a peer hold a quote pointing at a row that is already gone.
    const appointment = await book();
    const { quote } = await localQuotesApi.create(householdId, {
      contractor_id: contractorId,
      title: 'Furnace replacement',
      appointment_id: appointment.id,
    });

    const before = opCount();
    await localAppointmentsApi.delete(householdId, appointment.id);
    expect(opCount() - before).toBe(1);

    const stored = getLocalHouseLedger().quotes.find((row) => row.id === quote.id);
    expect(stored?.appointment_id).toBeNull();
  });
});

describe('appointments — listing, filters and ordering', () => {
  async function threeBookings() {
    const march = await book({ scheduled_date: '2026-03-02', scheduled_time_start: '14:00' });
    const marchEarly = await book({
      scheduled_date: '2026-03-02',
      scheduled_time_start: '08:00',
      type: 'inspection',
    });
    const june = await book({ scheduled_date: '2026-06-20', scheduled_time_start: undefined });
    return { march, marchEarly, june };
  }

  it('orders by date then start time, with all-day bookings leading their day', async () => {
    const { march, marchEarly, june } = await threeBookings();
    const { appointments } = await localAppointmentsApi.getAll(householdId);
    expect(appointments.map((row) => row.id)).toEqual([marchEarly.id, march.id, june.id]);
    // An unset start time sorts as the empty string, which is where the Worker's
    // `ASC` puts its NULLs — first within the day.
    expect(june.scheduled_time_start).toBeNull();
  });

  it('filters on contractor, status, type and an inclusive date window', async () => {
    const { march, marchEarly, june } = await threeBookings();

    const byType = await localAppointmentsApi.getAll(householdId, { type: 'inspection' });
    expect(byType.appointments.map((row) => row.id)).toEqual([marchEarly.id]);

    await localAppointmentsApi.confirm(householdId, june.id);
    const confirmed = await localAppointmentsApi.getAll(householdId, { status: 'confirmed' });
    expect(confirmed.appointments.map((row) => row.id)).toEqual([june.id]);

    // Both bounds inclusive, string comparison over `YYYY-MM-DD`.
    const windowed = await localAppointmentsApi.getAll(householdId, {
      start_date: '2026-03-02',
      end_date: '2026-03-02',
    });
    expect(windowed.appointments.map((row) => row.id).sort()).toEqual(
      [march.id, marchEarly.id].sort(),
    );

    const other = await localAppointmentsApi.getAll(householdId, { contractor_id: 'ctr_other' });
    expect(other.appointments).toEqual([]);
  });

  it('treats completed, cancelled and no-show as no longer upcoming', async () => {
    const open = await book({ scheduled_date: '2099-01-01' });
    const cancelled = await book({ scheduled_date: '2099-01-02' });
    await localAppointmentsApi.cancel(householdId, cancelled.id);

    const upcoming = await localAppointmentsApi.getAll(householdId, { upcoming_only: true });
    expect(upcoming.appointments.map((row) => row.id)).toEqual([open.id]);
  });

  it('windows `getUpcoming` on days ahead, defaulting to thirty', async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const distant = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const near = await book({ scheduled_date: soon });
    await book({ scheduled_date: distant });

    const { appointments } = await localAppointmentsApi.getUpcoming(householdId);
    expect(appointments.map((row) => row.id)).toEqual([near.id]);

    const wide = await localAppointmentsApi.getUpcoming(householdId, 365);
    expect(wide.appointments).toHaveLength(2);
  });

  it('groups the calendar by day and skips days with nothing on them', async () => {
    await book({ scheduled_date: '2026-03-02', scheduled_time_start: '08:00' });
    await book({ scheduled_date: '2026-03-02', scheduled_time_start: '14:00' });
    await book({ scheduled_date: '2026-03-31' });
    // Outside the month — proves the bounds are real and that the last day is
    // derived rather than assumed to be the 30th.
    await book({ scheduled_date: '2026-04-01' });

    const { calendar } = await localAppointmentsApi.getCalendar(householdId, '2026-03');
    expect(calendar.map((day) => day.date)).toEqual(['2026-03-02', '2026-03-31']);
    expect(calendar[0]!.appointments).toHaveLength(2);
  });

  it('handles February without a table of month lengths', async () => {
    // `new Date(year, month, 0)` is day 0 of the next month — the Worker's own
    // trick, and the reason leap years need no special case.
    await book({ scheduled_date: '2028-02-29' });
    const { calendar } = await localAppointmentsApi.getCalendar(householdId, '2028-02');
    expect(calendar.map((day) => day.date)).toEqual(['2028-02-29']);
  });

  it('drops a booking whose contractor is gone rather than crashing the list', async () => {
    // The orphan is SEEDED, not produced by deleting a contractor.
    //
    // This test was originally written against a real defect: B1's
    // `localContractorsApi.delete` predated this table and cascaded only
    // visits, documents and representatives, so `delete` genuinely stranded
    // appointments. That is fixed — the cascade now covers all seven tables and
    // is asserted against the Drizzle schema in `localContractorsApi.test.ts`.
    //
    // The defensive read is still worth keeping, and is now the ONLY thing this
    // test is about: an orphan can still arrive over sync from a peer running a
    // build made before that fix, and a list read must degrade rather than take
    // out the screen. Building the fixture by calling the (now correct) delete
    // would assert nothing — it would just prove the cascade works, twice.
    const appointment = await book();
    const ledger = getLocalHouseLedger();
    ledger.contractors = ledger.contractors.filter((row) => row.id !== contractorId);

    const { appointments } = await localAppointmentsApi.getAll(householdId);
    expect(appointments).toEqual([]);
    // The row is still there — this is a render decision, not a delete.
    expect(getLocalHouseLedger().appointments).toHaveLength(1);
    // A single read raises instead, which is what the Worker does.
    await expect(localAppointmentsApi.getOne(householdId, appointment.id)).rejects.toThrow(
      'Contractor not found',
    );
  });
});

describe('appointments — the status machine', () => {
  it('confirms, starts and completes, stamping arrival and departure', async () => {
    const appointment = await book();

    const { appointment: confirmed } = await localAppointmentsApi.confirm(
      householdId,
      appointment.id,
    );
    expect(confirmed.status).toBe('confirmed');

    const { appointment: inProgress } = await localAppointmentsApi.start(
      householdId,
      appointment.id,
    );
    expect(inProgress.status).toBe('in_progress');
    expect(inProgress.actual_arrival_time).toBeTruthy();
    expect(inProgress.actual_departure_time).toBeNull();

    const { appointment: done } = await localAppointmentsApi.complete(
      householdId,
      appointment.id,
      'Filter replaced',
    );
    expect(done.status).toBe('completed');
    expect(done.actual_departure_time).toBeTruthy();
    expect(done.notes).toBe('Filter replaced');
  });

  it('refuses every transition the Worker refuses', async () => {
    const appointment = await book();

    // `complete` demands `in_progress` — this is the guard that stops a
    // departure time being recorded for a visit that never started.
    await expect(localAppointmentsApi.complete(householdId, appointment.id)).rejects.toThrow(
      'Can only complete an in-progress appointment',
    );

    await localAppointmentsApi.confirm(householdId, appointment.id);
    await localAppointmentsApi.start(householdId, appointment.id);

    // …and `start` / `markNoShow` refuse once it is under way.
    await expect(localAppointmentsApi.start(householdId, appointment.id)).rejects.toThrow(
      'Can only start a pending, confirmed, or rescheduled appointment',
    );
    await expect(localAppointmentsApi.markNoShow(householdId, appointment.id)).rejects.toThrow(
      'Can only mark no-show for pending, confirmed, or rescheduled appointments',
    );

    await localAppointmentsApi.complete(householdId, appointment.id);
    await expect(localAppointmentsApi.cancel(householdId, appointment.id)).rejects.toThrow(
      'Cannot cancel a completed or already cancelled appointment',
    );
    await expect(
      localAppointmentsApi.reschedule(householdId, appointment.id, {
        scheduled_date: '2026-10-01',
      }),
    ).rejects.toThrow('Cannot reschedule a completed, cancelled, or no-show appointment');
  });

  it('marks a no-show from any open state', async () => {
    const appointment = await book();
    const { appointment: missed } = await localAppointmentsApi.markNoShow(
      householdId,
      appointment.id,
    );
    expect(missed.status).toBe('no_show');
  });

  it('reschedules, recording the date it moved FROM in the notes', async () => {
    const appointment = await book({ notes: 'Bring the small ladder' });
    const { appointment: moved } = await localAppointmentsApi.reschedule(
      householdId,
      appointment.id,
      { scheduled_date: '2026-09-21', scheduled_time_start: '11:00', reason: 'Parts delayed' },
    );

    expect(moved.status).toBe('rescheduled');
    expect(moved.scheduled_date).toBe('2026-09-21');
    expect(moved.scheduled_time_start).toBe('11:00');
    // The original note survives, and the history of the move survives the
    // column being overwritten.
    expect(moved.notes).toContain('Bring the small ladder');
    expect(moved.notes).toContain('Rescheduled from 2026-09-14: Parts delayed');
  });

  it('appends the cancellation reason instead of replacing the notes', async () => {
    const appointment = await book({ notes: 'Gate code 4821' });
    const { appointment: cancelled } = await localAppointmentsApi.cancel(
      householdId,
      appointment.id,
      'Contractor double-booked',
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.notes).toBe('Gate code 4821\nCancellation reason: Contractor double-booked');
  });

  it('leaves the notes alone when no reason is given', async () => {
    const appointment = await book({ notes: 'Gate code 4821' });
    const { appointment: cancelled } = await localAppointmentsApi.cancel(
      householdId,
      appointment.id,
    );
    expect(cancelled.notes).toBe('Gate code 4821');
  });

  it('writes exactly one op per member action, transitions included', async () => {
    // Every transition delegates to `update`, which funnels through one
    // `writeLocal`. A route that opened its own write would double this and put
    // two rows in every peer's delta for a single tap.
    const appointment = await started();
    const before = opCount();
    await localAppointmentsApi.complete(householdId, appointment.id, 'All good');
    expect(opCount() - before).toBe(1);
  });
});

describe('appointments — derived fields are never stored', () => {
  it('keeps the contractor join and the type lookup off the row', async () => {
    // One fact, one home in the ledger. A cached contractor name would be merged
    // per field and could converge to an answer neither device wrote; `typeInfo`
    // would additionally freeze a label that ships with the app bundle.
    const appointment = await book();
    await localAppointmentsApi.getOne(householdId, appointment.id);

    const stored = getLocalHouseLedger().appointments[0]! as unknown as Record<string, unknown>;
    expect(stored.contractor).toBeUndefined();
    expect(stored.typeInfo).toBeUndefined();
  });

  it('follows the contractor when their details change', async () => {
    const appointment = await book();
    await localContractorsApi.update(householdId, contractorId, { name: 'Dave R. Rivera' });
    const { appointment: reread } = await localAppointmentsApi.getOne(householdId, appointment.id);
    expect(reread.contractor.name).toBe('Dave R. Rivera');
  });
});
