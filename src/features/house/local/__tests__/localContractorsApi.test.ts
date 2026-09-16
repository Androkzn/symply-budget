/**
 * `localContractorsApi` / `localRepresentativesApi` against a real in-memory
 * session (plan §6 DoD, H11 sub-wave B1).
 *
 * Beyond the round trips, five behaviours here are load-bearing:
 *
 *  - **The stats are recomputed, not stored.** `totalVisits`, `totalSpent` and
 *    `lastVisitDate` are a join the Worker performs per request; if they were
 *    ever persisted, two devices would converge them to different answers.
 *  - **Deleting a contractor takes ALL SEVEN of its cascading tables with it,
 *    in ONE op.** A ledger delete is a tombstone rather than a foreign key, so
 *    an orphan is forever: it syncs to every peer and is never read. This list
 *    grew with sub-wave B2 and the delete did not follow, which is the defect
 *    the two tests at the end of `deleting a contractor` now lock — one against
 *    the Drizzle schema, one against observed behaviour.
 *  - **`deleteVisit` clears `visit_id` on the documents instead of dropping
 *    them.** D1 says `set null`, not cascade, because a receipt outlives the
 *    appointment it was filed against.
 *  - **The three server-only methods THROW.** They are the R2 transfer and the
 *    AI lookup; the coverage rule says a gap is a thrown error, never a missing
 *    key that lets the Proxy reach a Worker holding nothing for this household.
 *  - **"Primary" is enforced at write time.** The ledger has no unique index, so
 *    the only moment at which at-most-one-primary is enforceable is inside the
 *    op that sets it.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import {
  getLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { HouseLocalUnknownPropertyError, HouseLocalUnsupportedError } from '../errors';
import { CONTRACTOR_CASCADE_TABLES, localContractorsApi, localRepresentativesApi } from '../localContractorsApi';
import { HOUSE_LEDGER_PHYSICAL_TABLES, HOUSE_LEDGER_TABLE_NAMES } from '../schema';
import { getHouseUnsupportedCopy } from '../unsupportedCopy';

const USER = 'user-contractors-1';

let householdId: string;

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

async function createPlumber(overrides: { name?: string; company_name?: string } = {}) {
  const { contractor } = await localContractorsApi.create(householdId, {
    name: overrides.name ?? 'Dave Rivera',
    company_name: overrides.company_name ?? 'Rivera Plumbing',
    specialty: 'plumber',
    phone: '604-555-0134',
  });
  return contractor;
}

beforeEach(async () => {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Contractor test home' });
  householdId = ledger.household.id;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('contractors — create / read / update / delete', () => {
  it('round-trips a contractor', async () => {
    const created = await createPlumber();
    expect(created.household_id).toBe(householdId);
    expect(created.is_favorite).toBe(false);
    // The DTO models "not set" as NULL, matching the column.
    expect(created.website).toBeNull();

    const { contractor } = await localContractorsApi.getOne(householdId, created.id);
    expect(contractor.name).toBe('Dave Rivera');
    expect(contractor.specialtyInfo.label).toBe('Plumber');

    const { contractor: updated } = await localContractorsApi.update(householdId, created.id, {
      address: '1200 Water St',
      phone: '',
    });
    expect(updated.address).toBe('1200 Water St');
    // Cleared with NULL, not with an empty string — the cards render
    // `phone ?? '—'` and would otherwise show a blank row.
    expect(updated.phone).toBeNull();

    await localContractorsApi.delete(householdId, created.id);
    const { contractors } = await localContractorsApi.getAll(householdId);
    expect(contractors).toHaveLength(0);
  });

  it('lists by name and filters by specialty, favourite and search', async () => {
    const dave = await createPlumber({ name: 'Zoe Ng', company_name: 'Ng Plumbing' });
    const { contractor: sparks } = await localContractorsApi.create(householdId, {
      name: 'Alan Voss',
      company_name: 'Voss Electric',
      specialty: 'electrician',
      is_favorite: true,
    });

    const all = await localContractorsApi.getAll(householdId);
    expect(all.contractors.map((row) => row.name)).toEqual(['Alan Voss', 'Zoe Ng']);

    const trade = await localContractorsApi.getAll(householdId, { specialty: 'plumber' });
    expect(trade.contractors.map((row) => row.id)).toEqual([dave.id]);

    const favourites = await localContractorsApi.getAll(householdId, { is_favorite: true });
    expect(favourites.contractors.map((row) => row.id)).toEqual([sparks.id]);

    // The search matches the company name as well as the person's, exactly as
    // `getContractors` does — members look up "the electric people", not "Alan".
    const byCompany = await localContractorsApi.getAll(householdId, { search: 'voss elec' });
    expect(byCompany.contractors.map((row) => row.id)).toEqual([sparks.id]);
    const byPerson = await localContractorsApi.getAll(householdId, { search: 'zoe' });
    expect(byPerson.contractors.map((row) => row.id)).toEqual([dave.id]);
  });

  it('toggles favourite through the same write path as update', async () => {
    const contractor = await createPlumber();
    const { contractor: favourited } = await localContractorsApi.toggleFavorite(
      householdId,
      contractor.id,
      true,
    );
    expect(favourited.is_favorite).toBe(true);
    const { contractor: unfavourited } = await localContractorsApi.toggleFavorite(
      householdId,
      contractor.id,
      false,
    );
    expect(unfavourited.is_favorite).toBe(false);
  });

  it('raises for a contractor that does not exist', async () => {
    await expect(localContractorsApi.getOne(householdId, 'ctr_missing')).rejects.toThrow(
      'Contractor not found',
    );
    await expect(
      localContractorsApi.update(householdId, 'ctr_missing', { name: 'x' }),
    ).rejects.toThrow('Contractor not found');
    await expect(localContractorsApi.delete(householdId, 'ctr_missing')).rejects.toThrow(
      'Contractor not found',
    );
  });

  it('refuses to answer for a property that is not the active one', async () => {
    await expect(localContractorsApi.getAll('hh_local_someone_else')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
    await expect(localRepresentativesApi.getAll('hh_local_someone_else', 'ctr_1')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
  });
});

describe('contractors — derived stats', () => {
  it('counts completed visits, sums every visit, and dates the last completed one', async () => {
    const contractor = await createPlumber();
    await localContractorsApi.createVisit(householdId, contractor.id, {
      visit_date: '2026-01-10',
      status: 'completed',
      cost: 240,
    });
    await localContractorsApi.createVisit(householdId, contractor.id, {
      visit_date: '2026-05-02',
      status: 'completed',
      cost: 110,
    });
    // Booked but not yet done: it counts toward money spent and not toward
    // visits made, which is what the Worker does too.
    await localContractorsApi.createVisit(householdId, contractor.id, {
      visit_date: '2026-09-30',
      status: 'scheduled',
      cost: 500,
    });

    const { contractors } = await localContractorsApi.getAll(householdId);
    expect(contractors[0]!.totalVisits).toBe(2);
    expect(contractors[0]!.totalSpent).toBe(850);
    expect(contractors[0]!.lastVisitDate).toBe('2026-05-02');
  });

  it('sums costs in cents so the total does not drift', async () => {
    const contractor = await createPlumber();
    for (const cost of [0.1, 0.2, 10.05]) {
      await localContractorsApi.createVisit(householdId, contractor.id, {
        visit_date: '2026-01-01',
        status: 'completed',
        cost,
      });
    }
    const { contractors } = await localContractorsApi.getAll(householdId);
    expect(contractors[0]!.totalSpent).toBe(10.35);
  });

  it('never stores the stats on the row', async () => {
    // The whole point of recomputing them: one fact, one home in the ledger.
    // A stored `totalSpent` would be merged per field and could converge to a
    // number that matches neither device's visits.
    const contractor = await createPlumber();
    await localContractorsApi.createVisit(householdId, contractor.id, {
      visit_date: '2026-01-10',
      status: 'completed',
      cost: 240,
    });
    const stored = getLocalHouseLedger().contractors[0]! as unknown as Record<string, unknown>;
    expect(stored.totalSpent).toBeUndefined();
    expect(stored.totalVisits).toBeUndefined();
    expect(stored.specialtyInfo).toBeUndefined();
  });

  it('caps the detail view at five visits and counts the documents', async () => {
    const contractor = await createPlumber();
    for (const day of ['01', '02', '03', '04', '05', '06']) {
      await localContractorsApi.createVisit(householdId, contractor.id, {
        visit_date: `2026-03-${day}`,
        status: 'completed',
      });
    }
    await localContractorsApi.createDocument(householdId, {
      contractor_id: contractor.id,
      type: 'invoice',
      title: 'March invoice',
      file_key: 'blob_1',
      file_name: 'march.pdf',
    });

    const { contractor: detail } = await localContractorsApi.getOne(householdId, contractor.id);
    expect(detail.recentVisits).toHaveLength(5);
    expect(detail.recentVisits.map((row) => row.visit_date)).toEqual([
      '2026-03-06',
      '2026-03-05',
      '2026-03-04',
      '2026-03-03',
      '2026-03-02',
    ]);
    expect(detail.documentCount).toBe(1);
  });
});

describe('visits', () => {
  it('requires the contractor to exist before a visit can be booked', async () => {
    await expect(
      localContractorsApi.createVisit(householdId, 'ctr_missing', {
        visit_date: '2026-04-01',
        status: 'scheduled',
      }),
    ).rejects.toThrow('Contractor not found');
  });

  it('lists newest first, joined to its contractor, and filters on status and dates', async () => {
    const contractor = await createPlumber();
    await localContractorsApi.createVisit(householdId, contractor.id, {
      visit_date: '2026-02-01',
      status: 'completed',
    });
    await localContractorsApi.createVisit(householdId, contractor.id, {
      visit_date: '2026-06-15',
      status: 'cancelled',
    });

    const all = await localContractorsApi.getAllVisits(householdId);
    expect(all.visits.map((row) => row.visit_date)).toEqual(['2026-06-15', '2026-02-01']);
    // The join the Worker composes — the row renderer reads `visit.contractor`.
    expect(all.visits[0]!.contractor.name).toBe('Dave Rivera');

    const cancelled = await localContractorsApi.getAllVisits(householdId, { status: 'cancelled' });
    expect(cancelled.visits).toHaveLength(1);

    const windowed = await localContractorsApi.getAllVisits(householdId, {
      start_date: '2026-01-01',
      end_date: '2026-03-01',
    });
    expect(windowed.visits.map((row) => row.visit_date)).toEqual(['2026-02-01']);
  });

  it('answers an unknown contractor with an empty visit list rather than raising', async () => {
    // The route filters and does not check — `ContractorDetailScreen` fires this
    // in parallel with `getOne`, and `getOne` is the call that raises. Diverging
    // would make the screen report two different errors for one missing row.
    const { visits } = await localContractorsApi.getContractorVisits(householdId, 'ctr_missing');
    expect(visits).toEqual([]);
  });

  it('updates and clears visit fields', async () => {
    const contractor = await createPlumber();
    const { visit } = await localContractorsApi.createVisit(householdId, contractor.id, {
      visit_date: '2026-04-01',
      status: 'scheduled',
      description: 'Leaking valve',
    });

    const { visit: updated } = await localContractorsApi.updateVisit(householdId, visit.id, {
      status: 'completed',
      cost: 189.5,
      description: '',
    });
    expect(updated.status).toBe('completed');
    expect(updated.cost).toBe(189.5);
    expect(updated.description).toBeNull();

    await expect(
      localContractorsApi.updateVisit(householdId, 'cvi_missing', { cost: 1 }),
    ).rejects.toThrow('Visit not found');
  });

  it('keeps the documents when the visit goes, with their link cleared', async () => {
    const contractor = await createPlumber();
    const { visit } = await localContractorsApi.createVisit(householdId, contractor.id, {
      visit_date: '2026-04-01',
      status: 'completed',
    });
    const { document } = await localContractorsApi.createDocument(householdId, {
      contractor_id: contractor.id,
      visit_id: visit.id,
      type: 'receipt',
      title: 'Valve receipt',
      file_key: 'blob_2',
      file_name: 'valve.pdf',
    });

    const before = opCount();
    await localContractorsApi.deleteVisit(householdId, visit.id);
    // Both halves in one op: a peer must never hold a document pointing at a
    // visit that is already a tombstone.
    expect(opCount() - before).toBe(1);

    const { documents } = await localContractorsApi.getAllDocuments(householdId);
    expect(documents.map((row) => row.id)).toEqual([document.id]);
    expect(documents[0]!.visit_id).toBeNull();
    expect(getLocalHouseLedger().contractorVisits).toHaveLength(0);
  });

  it('does not raise when deleting a visit that is already gone', async () => {
    // The Worker issues an unconditional DELETE and answers 204 either way, so a
    // double-tap must not behave differently depending on which backend replied.
    await expect(localContractorsApi.deleteVisit(householdId, 'cvi_missing')).resolves.toBeUndefined();
  });
});

describe('deleting a contractor', () => {
  it('takes its visits, documents and representatives in ONE op', async () => {
    const contractor = await createPlumber();
    const { visit } = await localContractorsApi.createVisit(householdId, contractor.id, {
      visit_date: '2026-04-01',
      status: 'completed',
    });
    await localContractorsApi.createDocument(householdId, {
      contractor_id: contractor.id,
      visit_id: visit.id,
      type: 'invoice',
      title: 'April invoice',
      file_key: 'blob_3',
      file_name: 'april.pdf',
    });
    await localRepresentativesApi.create(householdId, contractor.id, { name: 'Sam Ortiz' });

    const before = opCount();
    await localContractorsApi.delete(householdId, contractor.id);
    expect(opCount() - before).toBe(1);

    const ledger = getLocalHouseLedger();
    expect(ledger.contractors).toHaveLength(0);
    expect(ledger.contractorVisits).toHaveLength(0);
    expect(ledger.contractorDocuments).toHaveLength(0);
    expect(ledger.contractorRepresentatives).toHaveLength(0);
  });

  it('leaves the other contractor records alone', async () => {
    const dave = await createPlumber();
    const { contractor: other } = await localContractorsApi.create(householdId, {
      name: 'Alan Voss',
      specialty: 'electrician',
    });
    await localContractorsApi.createVisit(householdId, other.id, {
      visit_date: '2026-04-01',
      status: 'completed',
    });

    await localContractorsApi.delete(householdId, dave.id);
    expect(getLocalHouseLedger().contractorVisits).toHaveLength(1);
  });

  /**
   * The regression this exists for, stated plainly: B1 wrote the cascade when
   * three tables were live. B2 activated four more that D1 also cascades from
   * `contractors` — `appointments`, `quotes`, `contractorQuotes`,
   * `quoteRequests` — and the delete kept filtering only the original three.
   * Nothing failed. An orphan has no foreign key to complain to; it simply
   * syncs to every peer and is never read again.
   *
   * So this asserts the cascade list against the DRIZZLE SCHEMA rather than
   * against the implementation. Adding a cascading FK in D1 without adding the
   * table here now fails in milliseconds instead of leaking rows forever.
   */
  it('cascades exactly the tables D1 cascades — checked against the schema, not the code', () => {
    const schemaDir = join(__dirname, '../../../../../backend/src/db');
    const sources = readdirSync(schemaDir)
      .filter((f) => f.startsWith('schema') && f.endsWith('.ts'))
      .map((f) => readFileSync(join(schemaDir, f), 'utf8'))
      .join('\n');

    // `sqliteTable('physical_name'` … up to the next `sqliteTable(`, so a
    // cascade is attributed to the table it is declared inside.
    const blocks = sources.split(/export const \w+ = sqliteTable\(\s*'/).slice(1);
    const cascading = new Set<string>();
    for (const block of blocks) {
      const physical = block.slice(0, block.indexOf("'"));
      if (/references\(\(\)\s*=>\s*contractors\.id,\s*\{\s*onDelete:\s*'cascade'/.test(block)) {
        cascading.add(physical);
      }
    }

    // Non-vacuity: if the parse breaks, `cascading` empties and every
    // assertion below passes for the wrong reason. The floor rises with each
    // sub-wave — B3 added `projects` — which is itself a small guard against a
    // parser that starts matching fewer tables than it used to.
    expect(cascading.size).toBeGreaterThanOrEqual(8);

    // Physical → ledger name, keeping only tables that are actually live.
    const live = HOUSE_LEDGER_TABLE_NAMES.filter((t) =>
      cascading.has(HOUSE_LEDGER_PHYSICAL_TABLES[t]),
    );

    // The assertion that matters: the IMPLEMENTATION's list, compared to what
    // D1 actually declares. Comparing the schema to a hand-written expectation
    // would have stayed green through the very defect this exists for — the
    // schema was always right; the code was the thing that fell behind.
    expect([...CONTRACTOR_CASCADE_TABLES].sort()).toEqual([...live].sort());
  });

  it('actually empties every cascading table, B2’s four and B3’s one included', async () => {
    const contractor = await createPlumber();
    await localContractorsApi.createVisit(householdId, contractor.id, {
      visit_date: '2026-04-01',
      status: 'completed',
    });
    await localRepresentativesApi.create(householdId, contractor.id, { name: 'Sam Ortiz' });

    // Seeded directly: appointments/quotes/projects belong to B2's and B3's
    // facades, and this test is about the CASCADE, not about those modules'
    // create paths.
    const ledger = getLocalHouseLedger();
    const stamp = { household_id: householdId, contractor_id: contractor.id };
    (ledger.appointments as unknown[]).push({ ...stamp, id: 'apt_x' });
    (ledger.quotes as unknown[]).push({ ...stamp, id: 'quo_x' });
    (ledger.contractorQuotes as unknown[]).push({ ...stamp, id: 'cq_x' });
    (ledger.quoteRequests as unknown[]).push({ ...stamp, id: 'qr_x' });
    (ledger.projects as unknown[]).push({ ...stamp, id: 'prj_x' });

    const before = opCount();
    await localContractorsApi.delete(householdId, contractor.id);
    expect(opCount() - before).toBe(1);

    const after = getLocalHouseLedger();
    expect(after.contractors).toHaveLength(0);
    expect(after.contractorVisits).toHaveLength(0);
    expect(after.contractorRepresentatives).toHaveLength(0);
    expect(after.appointments).toHaveLength(0);
    expect(after.quotes).toHaveLength(0);
    expect(after.contractorQuotes).toHaveLength(0);
    expect(after.quoteRequests).toHaveLength(0);
    expect(after.projects).toHaveLength(0);
  });

  /**
   * The transitive tail — D1 does not stop at one hop, and neither does this.
   *
   * `contractors` cascades `projects`, and `projects` cascades milestones,
   * payments and progress photos, so a server-side contractor delete removes
   * all of it. `CONTRACTOR_CASCADE_TABLES` cannot express the second hop: it
   * filters on `contractor_id`, and the grandchildren are project-scoped. B3
   * pinned that as a known gap; the delete now runs a second pass keyed on the
   * deleted projects' ids, in the SAME op.
   *
   * "Same op" is the load-bearing part. A peer that received the first pass
   * without the second would hold milestones belonging to a project it no
   * longer has — which is precisely the orphan this mechanism exists to stop.
   */
  it('reaches the project children too — the transitive cascade, in one op', async () => {
    const contractor = await createPlumber();
    const ledger = getLocalHouseLedger();
    (ledger.projects as unknown[]).push({
      household_id: householdId,
      contractor_id: contractor.id,
      id: 'prj_y',
    });
    (ledger.projectMilestones as unknown[]).push({
      household_id: householdId,
      project_id: 'prj_y',
      id: 'pml_y',
    });
    (ledger.projectPayments as unknown[]).push({
      household_id: householdId,
      project_id: 'prj_y',
      id: 'ppy_y',
    });
    (ledger.projectProgressPhotos as unknown[]).push({
      household_id: householdId,
      project_id: 'prj_y',
      id: 'ppp_y',
    });
    // Another contractor's project, to prove the second pass is keyed on the
    // deleted project ids and not simply emptying the child tables.
    (ledger.projects as unknown[]).push({
      household_id: householdId,
      contractor_id: 'ctr_someone_else',
      id: 'prj_keep',
    });
    (ledger.projectMilestones as unknown[]).push({
      household_id: householdId,
      project_id: 'prj_keep',
      id: 'pml_keep',
    });

    const before = opCount();
    await localContractorsApi.delete(householdId, contractor.id);
    expect(opCount() - before).toBe(1);

    const after = getLocalHouseLedger();
    expect(after.projects.map((row) => row.id)).toEqual(['prj_keep']);
    expect(after.projectMilestones.map((row) => row.id)).toEqual(['pml_keep']);
    expect(after.projectPayments).toHaveLength(0);
    expect(after.projectProgressPhotos).toHaveLength(0);
  });
});

describe('receipts', () => {
  async function completedVisit() {
    const contractor = await createPlumber();
    const { visit } = await localContractorsApi.createVisit(householdId, contractor.id, {
      visit_date: '2026-04-01',
      status: 'completed',
      description: 'Replaced the shut-off valve',
    });
    return { contractor, visit };
  }

  it('marks a receipt received', async () => {
    const { visit } = await completedVisit();
    const { visit: updated } = await localContractorsApi.markReceiptReceived(
      householdId,
      visit.id,
      true,
    );
    expect(updated.receipt_received).toBe(true);
  });

  it('stamps the request rather than reaching a server', async () => {
    // `ReceiptRequestModal` opens the device's own mail app; the Worker never
    // sent anything either. All this records is "asked, on this date".
    const { visit } = await completedVisit();
    const result = await localContractorsApi.requestReceipt(householdId, visit.id, {
      method: 'email',
      property_address: '42 Wallaby Way',
    });

    expect(result.success).toBe(true);
    expect(result.receipt_requested_at).toBeTruthy();
    expect(result.message).toContain('Replaced the shut-off valve');
    expect(result.message).toContain('42 Wallaby Way');

    const { visits } = await localContractorsApi.getAllVisits(householdId);
    expect(visits[0]!.receipt_requested_at).toBe(result.receipt_requested_at);
  });

  it('honours a custom message and still stamps the visit', async () => {
    const { visit } = await completedVisit();
    const result = await localContractorsApi.requestReceipt(householdId, visit.id, {
      method: 'sms',
      property_address: '42 Wallaby Way',
      custom_message: 'Hi Dave, could you send the receipt?',
    });
    expect(result.message).toContain('Hi Dave, could you send the receipt?');
    expect(result.message).not.toContain('Best regards');
  });

  it('creates the reminder task and the back-pointer in ONE op', async () => {
    const { visit } = await completedVisit();
    const before = opCount();

    const result = await localContractorsApi.createReceiptReminderTask(householdId, visit.id);
    expect(result.success).toBe(true);
    expect(opCount() - before).toBe(1);

    const ledger = getLocalHouseLedger();
    const task = ledger.tasks.find((row) => row.id === result.task_id);
    expect(task?.title).toBe('Request receipt from Rivera Plumbing');
    expect(task?.frequency).toBe('daily');
    // The Worker writes `system_generated`, which the DTO's union does not
    // contain; `manual` is the truest member and the row IS the DTO.
    expect(task?.source).toBe('manual');
    expect(ledger.contractorVisits[0]!.receipt_reminder_task_id).toBe(result.task_id);
  });

  it('refuses to mint a second reminder for the same visit', async () => {
    const { visit } = await completedVisit();
    const first = await localContractorsApi.createReceiptReminderTask(householdId, visit.id);
    const second = await localContractorsApi.createReceiptReminderTask(householdId, visit.id);

    expect(second.success).toBe(false);
    expect(second.task_id).toBe(first.task_id);
    expect(getLocalHouseLedger().tasks).toHaveLength(1);
  });

  it('raises for a visit that does not exist', async () => {
    await expect(
      localContractorsApi.requestReceipt(householdId, 'cvi_missing', {
        method: 'email',
        property_address: 'x',
      }),
    ).rejects.toThrow('Visit not found');
    await expect(
      localContractorsApi.createReceiptReminderTask(householdId, 'cvi_missing'),
    ).rejects.toThrow('Visit not found');
  });
});

describe('documents — metadata is ledgered even though the bytes are not', () => {
  it('creates, lists newest first, filters and deletes', async () => {
    const contractor = await createPlumber();
    const { visit } = await localContractorsApi.createVisit(householdId, contractor.id, {
      visit_date: '2026-04-01',
      status: 'completed',
    });
    const { document: receipt } = await localContractorsApi.createDocument(householdId, {
      contractor_id: contractor.id,
      visit_id: visit.id,
      type: 'receipt',
      title: 'Valve receipt',
      file_key: 'blob_a',
      file_name: 'valve.pdf',
      amount: 189.5,
    });
    const { document: warranty } = await localContractorsApi.createDocument(householdId, {
      contractor_id: contractor.id,
      type: 'warranty',
      title: 'Two-year warranty',
      file_key: 'blob_b',
      file_name: 'warranty.pdf',
    });

    const all = await localContractorsApi.getAllDocuments(householdId);
    expect(all.documents.map((row) => row.id)).toEqual(
      [...all.documents]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((row) => row.id),
    );
    expect(all.documents).toHaveLength(2);

    const byType = await localContractorsApi.getAllDocuments(householdId, { type: 'warranty' });
    expect(byType.documents.map((row) => row.id)).toEqual([warranty.id]);

    const byVisit = await localContractorsApi.getAllDocuments(householdId, { visit_id: visit.id });
    expect(byVisit.documents.map((row) => row.id)).toEqual([receipt.id]);

    const forContractor = await localContractorsApi.getContractorDocuments(
      householdId,
      contractor.id,
    );
    expect(forContractor.documents).toHaveLength(2);

    await localContractorsApi.deleteDocument(householdId, receipt.id);
    expect(getLocalHouseLedger().contractorDocuments).toHaveLength(1);
  });

  it('raises for a document or contractor that does not exist', async () => {
    await expect(
      localContractorsApi.createDocument(householdId, {
        contractor_id: 'ctr_missing',
        type: 'receipt',
        title: 'x',
        file_key: 'k',
        file_name: 'x.pdf',
      }),
    ).rejects.toThrow('Contractor not found');
    await expect(localContractorsApi.deleteDocument(householdId, 'cdc_missing')).rejects.toThrow(
      'Document not found',
    );
  });
});

describe('the server-only surface (H6 blobs, P4 AI)', () => {
  it('throws rather than falling through to a Worker with no blobs', async () => {
    await expect(
      localContractorsApi.getUploadUrl(householdId, {
        file_name: 'receipt.pdf',
        content_type: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(HouseLocalUnsupportedError);
    await expect(
      localContractorsApi.uploadDocument(householdId, {
        uri: 'file:///receipt.pdf',
        name: 'receipt.pdf',
        type: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(HouseLocalUnsupportedError);
    await expect(
      localContractorsApi.aiLookup(householdId, 'Rivera Plumbing'),
    ).rejects.toBeInstanceOf(HouseLocalUnsupportedError);
  });

  it('carries member-facing copy and the documented error code', async () => {
    const error = await localContractorsApi
      .aiLookup(householdId, 'Rivera Plumbing')
      .catch((caught: unknown) => caught as HouseLocalUnsupportedError);

    expect(error.code).toBe('house_local_unsupported');
    // Per-feature copy (H7 DoD) — real product copy carrying no identifier,
    // rather than a shared developer sentence.
    expect(error.message).toBe(getHouseUnsupportedCopy(error.method).message);
    expect(error.message).not.toContain('contractorsApi');
  });
});

describe('visit mode — the on-site surface', () => {
  async function scheduledVisit() {
    const contractor = await createPlumber();
    const { visit } = await localContractorsApi.createVisit(householdId, contractor.id, {
      visit_date: '2026-04-01',
      status: 'scheduled',
    });
    return visit;
  }

  it('starts a visit, recording who turned up', async () => {
    const visit = await scheduledVisit();
    const { visit: started } = await localContractorsApi.startVisitMode(householdId, visit.id, {
      contractor_rep_name: 'Sam Ortiz',
    });
    // The Worker writes a status the DTO's union does not carry; the port keeps
    // the value rather than inventing a legal-but-different one.
    expect(started.status).toBe('in_progress');
    expect(started.visit_mode_started_at).toBeTruthy();
    expect(started.contractor_rep_name).toBe('Sam Ortiz');
  });

  it('keeps the rep name when a resumed start omits it', async () => {
    const visit = await scheduledVisit();
    await localContractorsApi.startVisitMode(householdId, visit.id, {
      contractor_rep_name: 'Sam Ortiz',
    });
    const { visit: resumed } = await localContractorsApi.startVisitMode(householdId, visit.id);
    expect(resumed.contractor_rep_name).toBe('Sam Ortiz');
  });

  it('completes a visit with its rating, notes and recording', async () => {
    const visit = await scheduledVisit();
    await localContractorsApi.startVisitMode(householdId, visit.id);
    const { visit: done } = await localContractorsApi.completeVisit(householdId, visit.id, {
      rating: 5,
      notes: 'Valve replaced, no leak',
      voice_recording_key: 'blob_voice_1',
      voice_recording_duration_seconds: 92,
    });

    expect(done.status).toBe('completed');
    expect(done.visit_mode_ended_at).toBeTruthy();
    expect(done.rating).toBe(5);
    expect(done.voice_recording_key).toBe('blob_voice_1');
    expect(done.voice_recording_duration_seconds).toBe(92);
  });

  it('raises for a visit that does not exist', async () => {
    await expect(
      localContractorsApi.startVisitMode(householdId, 'cvi_missing'),
    ).rejects.toThrow('Visit not found');
    await expect(localContractorsApi.completeVisit(householdId, 'cvi_missing')).rejects.toThrow(
      'Visit not found',
    );
  });
});

describe('representatives', () => {
  it('makes the first person primary without being asked', async () => {
    const contractor = await createPlumber();
    const { representative } = await localRepresentativesApi.create(householdId, contractor.id, {
      name: 'Sam Ortiz',
      role: 'Estimator',
    });
    expect(representative.is_primary).toBe(true);
    expect(representative.contractor_id).toBe(contractor.id);
  });

  it('keeps at most one primary, demoting the incumbent in the same op', async () => {
    const contractor = await createPlumber();
    const { representative: sam } = await localRepresentativesApi.create(
      householdId,
      contractor.id,
      { name: 'Sam Ortiz' },
    );
    const { representative: ada } = await localRepresentativesApi.create(
      householdId,
      contractor.id,
      { name: 'Ada Blake', is_primary: true },
    );

    expect(ada.is_primary).toBe(true);
    const { representatives } = await localRepresentativesApi.getAll(householdId, contractor.id);
    expect(representatives.filter((row) => row.is_primary)).toHaveLength(1);
    expect(representatives.find((row) => row.id === sam.id)?.is_primary).toBe(false);
  });

  it('sorts primary first, then by name', async () => {
    const contractor = await createPlumber();
    await localRepresentativesApi.create(householdId, contractor.id, { name: 'Ada Blake' });
    await localRepresentativesApi.create(householdId, contractor.id, { name: 'Zed Cole' });
    const { representative: sam } = await localRepresentativesApi.create(
      householdId,
      contractor.id,
      { name: 'Sam Ortiz' },
    );
    await localRepresentativesApi.setPrimary(householdId, contractor.id, sam.id);

    const { representatives } = await localRepresentativesApi.getAll(householdId, contractor.id);
    expect(representatives.map((row) => row.name)).toEqual(['Sam Ortiz', 'Ada Blake', 'Zed Cole']);
  });

  it('updates and clears fields', async () => {
    const contractor = await createPlumber();
    const { representative } = await localRepresentativesApi.create(householdId, contractor.id, {
      name: 'Sam Ortiz',
      role: 'Estimator',
    });
    const { representative: updated } = await localRepresentativesApi.update(
      householdId,
      contractor.id,
      representative.id,
      { role: '', phone: '604-555-0199' },
    );
    expect(updated.role).toBeNull();
    expect(updated.phone).toBe('604-555-0199');
  });

  it('promotes a deterministic heir when the primary is deleted', async () => {
    // A contractor with three people and no primary renders no "call" button at
    // all, so the promotion is not cosmetic. Alphabetical, not incidental order:
    // every peer applying this op must reach the same person.
    const contractor = await createPlumber();
    await localRepresentativesApi.create(householdId, contractor.id, { name: 'Zed Cole' });
    await localRepresentativesApi.create(householdId, contractor.id, { name: 'Ada Blake' });
    const { representative: sam } = await localRepresentativesApi.create(
      householdId,
      contractor.id,
      { name: 'Sam Ortiz', is_primary: true },
    );

    await localRepresentativesApi.delete(householdId, contractor.id, sam.id);
    const { representatives } = await localRepresentativesApi.getAll(householdId, contractor.id);
    expect(representatives.map((row) => row.name)).toEqual(['Ada Blake', 'Zed Cole']);
    expect(representatives[0]!.is_primary).toBe(true);
  });

  it('promotes nobody when a non-primary is deleted', async () => {
    const contractor = await createPlumber();
    const { representative: sam } = await localRepresentativesApi.create(
      householdId,
      contractor.id,
      { name: 'Sam Ortiz' },
    );
    const { representative: ada } = await localRepresentativesApi.create(
      householdId,
      contractor.id,
      { name: 'Ada Blake' },
    );

    await localRepresentativesApi.delete(householdId, contractor.id, ada.id);
    const { representatives } = await localRepresentativesApi.getAll(householdId, contractor.id);
    expect(representatives).toHaveLength(1);
    expect(representatives[0]!.id).toBe(sam.id);
    expect(representatives[0]!.is_primary).toBe(true);
  });

  it('raises for an unknown contractor or representative', async () => {
    const contractor = await createPlumber();
    await expect(localRepresentativesApi.getAll(householdId, 'ctr_missing')).rejects.toThrow(
      'Contractor not found',
    );
    await expect(
      localRepresentativesApi.getOne(householdId, contractor.id, 'crp_missing'),
    ).rejects.toThrow('Representative not found');
    await expect(
      localRepresentativesApi.update(householdId, contractor.id, 'crp_missing', { name: 'x' }),
    ).rejects.toThrow('Representative not found');
    await expect(
      localRepresentativesApi.delete(householdId, contractor.id, 'crp_missing'),
    ).rejects.toThrow('Representative not found');
  });
});
