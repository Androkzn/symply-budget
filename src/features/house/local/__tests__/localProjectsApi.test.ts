/**
 * `localProjectsApi` against a real in-memory session (plan §6 DoD, H11 sub-wave
 * B3).
 *
 * Six behaviours here are load-bearing beyond the round trips:
 *
 *  - **Deleting a project takes its milestones, payments and photos with it, in
 *    ONE op.** D1 cascades all three; a ledger delete is a tombstone rather than
 *    a foreign key, so an orphan is forever — it syncs to every peer and is
 *    never read. B2 shipped exactly this bug one level up and nothing failed,
 *    which is why it gets both a behavioural test and a schema-derived one.
 *  - **`progress` is recomputed, never stored.** D1 has a `total_spent_cents`
 *    column that `markPaymentPaid` writes; the ledger deliberately has no such
 *    field, because a stored aggregate under per-field LWW converges to one
 *    device's answer and is then wrong on both.
 *  - **`deleteMilestone` CLEARS the photo pointer instead of dropping the
 *    photo.** D1 says `set null`, not cascade — a photo of the work outlives the
 *    milestone it was filed under.
 *  - **The child arrays are ordered the way the Worker orders them**: milestones
 *    by `sort_order`, payments oldest-first, photos newest-first. Three
 *    different orders on one screen is not something to guess at.
 *  - **`sort_order` is `max + 1`, so the first milestone is 1 and not 0** — the
 *    Worker's `Math.max(0, ...)`. Two members adding one offline converge to two
 *    rows sharing an order, which is correct: they are two milestones.
 *  - **Nothing in this module throws `HouseLocalUnsupportedError`.** There is no
 *    upload method and no URL builder on `projectsApi` at all, so B3 is the
 *    first labor-hub sub-wave with no P4/H6 surface whatsoever.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  getLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { HouseLocalUnknownPropertyError } from '../errors';
import { localContractorsApi } from '../localContractorsApi';
import { localProjectsApi, type CreateLocalProjectInput } from '../localProjectsApi';
import { applyLedgerDelta, captureLedgerSnapshot, diffLedger } from '../projection';

import { emptyHouseLedger, stampAt, TEST_HOUSEHOLD_ID } from './houseLedgerTestKit';

const USER = 'user-projects-1';

let householdId: string;
let contractorId: string;

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

async function commission(overrides: Partial<CreateLocalProjectInput> = {}) {
  const { project } = await localProjectsApi.create(householdId, {
    contractor_id: contractorId,
    title: 'Re-roof the garage',
    total_budget_cents: 950_000,
    ...overrides,
  });
  return project;
}

beforeEach(async () => {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Project test home' });
  householdId = ledger.household.id;
  const { contractor } = await localContractorsApi.create(householdId, {
    name: 'Mia Roth',
    company_name: 'Roth Roofing',
    specialty: 'roofer',
    phone: '604-555-0188',
    email: 'mia@roth.example',
  });
  contractorId = contractor.id;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('projects — create / read / update / delete', () => {
  it('round-trips a project, opened in `planning` whatever the caller asks', async () => {
    const created = await commission({ description: 'Cedar shakes, approx 400 sq ft' });
    expect(created.household_id).toBe(householdId);
    expect(created.status).toBe('planning');
    expect(created.actual_end_date).toBeNull();
    expect(created.total_budget_cents).toBe(950_000);

    const { project } = await localProjectsApi.getOne(householdId, created.id);
    expect(project.contractor.name).toBe('Mia Roth');
    expect(project.contractor.specialtyInfo.label).toBeTruthy();
    // The client's `ProjectWithDetails` declares these two; the Worker omits
    // them. The ledger row cannot lie about its own shape, so the facade fills
    // them in — which is what makes "call the roofer" work from a project.
    expect(project.contractor.phone).toBe('604-555-0188');
    expect(project.contractor.email).toBe('mia@roth.example');

    const { project: updated } = await localProjectsApi.update(householdId, created.id, {
      status: 'in_progress',
      actual_end_date: '2026-11-02',
    });
    expect(updated.status).toBe('in_progress');
    expect(updated.actual_end_date).toBe('2026-11-02');
    expect(updated.updated_at >= created.updated_at).toBe(true);

    await localProjectsApi.delete(householdId, created.id);
    const { projects } = await localProjectsApi.getAll(householdId);
    expect(projects).toHaveLength(0);
  });

  it('stores an empty string rather than coalescing it to NULL, unlike quotes', async () => {
    // `project-service.ts:259` assigns `input.description` with no `|| null`,
    // where `quote-service.ts` coalesces. Reproducing each service's own quirk
    // is what keeps a project edited offline byte-identical to one edited
    // online; "fixing" one side would make the backends disagree about a field
    // the member cleared.
    const project = await commission({ description: 'Cedar shakes' });
    const { project: cleared } = await localProjectsApi.update(householdId, project.id, {
      description: '',
    });
    expect(cleared.description).toBe('');
  });

  it('requires the contractor to exist before a project can be commissioned', async () => {
    await expect(commission({ contractor_id: 'ctr_missing' })).rejects.toThrow(
      'Contractor not found',
    );
  });

  it('raises for a project that does not exist', async () => {
    await expect(localProjectsApi.getOne(householdId, 'prj_missing')).rejects.toThrow(
      'Project not found',
    );
    await expect(
      localProjectsApi.update(householdId, 'prj_missing', { title: 'x' }),
    ).rejects.toThrow('Project not found');
    await expect(localProjectsApi.delete(householdId, 'prj_missing')).rejects.toThrow(
      'Project not found',
    );
  });

  it('refuses to answer for a property that is not the active one', async () => {
    await expect(localProjectsApi.getAll('hh_local_someone_else')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
  });

  it('lists newest first and filters on contractor and status', async () => {
    const first = await commission();
    const second = await commission({ title: 'Rebuild the deck' });
    await localProjectsApi.update(householdId, second.id, { status: 'completed' });

    const all = await localProjectsApi.getAll(householdId);
    expect(all.projects).toHaveLength(2);
    expect(all.projects.map((row) => row.created_at)).toEqual(
      [...all.projects]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((row) => row.created_at),
    );

    const planning = await localProjectsApi.getAll(householdId, { status: 'planning' });
    expect(planning.projects.map((row) => row.id)).toEqual([first.id]);

    const other = await localProjectsApi.getAll(householdId, { contractor_id: 'ctr_other' });
    expect(other.projects).toEqual([]);
  });

  it('keeps only planning and in_progress in `getActive`', async () => {
    // `project-service.ts:152` — the home tab's active-project cards read this,
    // and it is the one B3 method with a live React Query subscriber.
    const running = await commission();
    await localProjectsApi.update(householdId, running.id, { status: 'in_progress' });
    const held = await commission({ title: 'Repave the drive' });
    await localProjectsApi.update(householdId, held.id, { status: 'on_hold' });
    const done = await commission({ title: 'Replace the gutters' });
    await localProjectsApi.update(householdId, done.id, { status: 'completed' });

    const { projects } = await localProjectsApi.getActive(householdId);
    expect(projects.map((row) => row.id)).toEqual([running.id]);
  });

  it('drops a project whose contractor is gone rather than crashing the list', async () => {
    // Orphan SEEDED, not produced by a delete: `localContractorsApi.delete`
    // cascades `projects` now, so this is the shape that arrives over sync from
    // a peer running an older build. A list read must not blank the screen; a
    // single read raises, matching the Worker.
    const project = await commission();
    const ledger = getLocalHouseLedger();
    ledger.contractors = ledger.contractors.filter((row) => row.id !== contractorId);

    const { projects } = await localProjectsApi.getAll(householdId);
    expect(projects).toEqual([]);
    expect(getLocalHouseLedger().projects).toHaveLength(1);
    await expect(localProjectsApi.getOne(householdId, project.id)).rejects.toThrow(
      'Contractor not found',
    );
  });

  it('stores the link arrays as the JSON text D1 stores', async () => {
    // `linked_report_ids` is the PLURAL the client declares and D1 does not
    // have — the Worker's zod drops it, so keeping it is a superset of the
    // remote behaviour rather than a divergence a screen can trip over.
    const project = await commission({
      linked_report_ids: ['rep_1', 'rep_2'],
      linked_task_ids: ['task_9'],
    });
    expect(JSON.parse(project.linked_report_ids!)).toEqual(['rep_1', 'rep_2']);
    expect(JSON.parse(project.linked_task_ids!)).toEqual(['task_9']);

    const bare = await commission({ title: 'Nothing linked' });
    expect(bare.linked_report_ids).toBeNull();
    expect(bare.linked_task_ids).toBeNull();
  });
});

describe('projects — the cascade on delete', () => {
  it('takes every child with it, in ONE op', async () => {
    const project = await commission();
    const { milestone } = await localProjectsApi.addMilestone(householdId, project.id, {
      title: 'Tear-off complete',
    });
    await localProjectsApi.addPayment(householdId, project.id, {
      type: 'deposit',
      title: 'Deposit',
      amount_cents: 300_000,
    });
    await localProjectsApi.addProgressPhoto(householdId, project.id, {
      photo_key: 'lf-blob/blob_roof1',
      milestone_id: milestone.id,
    });

    // A second project's children must survive — a filter on the wrong column
    // would empty both and every assertion below would still pass.
    const other = await commission({ title: 'Rebuild the deck' });
    await localProjectsApi.addMilestone(householdId, other.id, { title: 'Frame the deck' });

    const before = opCount();
    await localProjectsApi.delete(householdId, project.id);
    // ONE op, not four. Four writes would be four ops a peer applies one at a
    // time, and between the first and the last it holds payments belonging to a
    // project that no longer exists.
    expect(opCount() - before).toBe(1);

    const after = getLocalHouseLedger();
    expect(after.projects.map((row) => row.id)).toEqual([other.id]);
    expect(after.projectMilestones).toHaveLength(1);
    expect(after.projectMilestones[0]!.project_id).toBe(other.id);
    expect(after.projectPayments).toHaveLength(0);
    expect(after.projectProgressPhotos).toHaveLength(0);
  });

  it('leaves no child of a deleted project reachable through any read', async () => {
    const project = await commission();
    await localProjectsApi.addPayment(householdId, project.id, {
      type: 'final',
      title: 'Balance',
      amount_cents: 650_000,
    });
    await localProjectsApi.delete(householdId, project.id);

    const { projects } = await localProjectsApi.getAll(householdId);
    expect(projects).toEqual([]);
    await expect(
      localProjectsApi.addPayment(householdId, project.id, {
        type: 'progress',
        title: 'Stage two',
        amount_cents: 1,
      }),
    ).rejects.toThrow('Project not found');
  });
});

describe('projects — milestones', () => {
  it('numbers from 1 and orders by `sort_order`, not by insertion', async () => {
    const project = await commission();
    const { milestone: first } = await localProjectsApi.addMilestone(householdId, project.id, {
      title: 'Tear-off complete',
    });
    const { milestone: second } = await localProjectsApi.addMilestone(householdId, project.id, {
      title: 'Underlay down',
    });
    // `Math.max(0, ...)` over an empty list is 0, so the first is 1 — the
    // Worker's arithmetic, kept because the numbers are visible to the member.
    expect(first.sort_order).toBe(1);
    expect(second.sort_order).toBe(2);
    expect(first.status).toBe('pending');
    expect(first.household_id).toBe(householdId);

    // Reorder: the read follows `sort_order`, not the order rows were written.
    await localProjectsApi.updateMilestone(householdId, project.id, second.id, { sort_order: 0 });
    const { project: read } = await localProjectsApi.getOne(householdId, project.id);
    expect(read.milestones.map((row) => row.id)).toEqual([second.id, first.id]);
  });

  it('completes a milestone with a full timestamp, as the Worker does', async () => {
    // `completedDate: nowIso()` — a full ISO stamp despite the column being
    // named `completed_date`. Mirrored, or the list would sort differently on
    // the two backends.
    const project = await commission();
    const { milestone } = await localProjectsApi.addMilestone(householdId, project.id, {
      title: 'Tear-off complete',
    });

    const { milestone: done } = await localProjectsApi.completeMilestone(
      householdId,
      project.id,
      milestone.id,
    );
    expect(done.status).toBe('completed');
    expect(done.completed_date).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const { project: read } = await localProjectsApi.getOne(householdId, project.id);
    expect(read.progress.completedMilestones).toBe(1);
    expect(read.progress.totalMilestones).toBe(1);
  });

  it('clears the photo pointer on delete instead of dropping the photo', async () => {
    // D1 says `set null`, not cascade (`schema-labor-hub.ts:291`): a photo of
    // the work outlives the milestone it was filed under, exactly as a
    // contractor document outlives its visit.
    const project = await commission();
    const { milestone } = await localProjectsApi.addMilestone(householdId, project.id, {
      title: 'Underlay down',
    });
    const { photo } = await localProjectsApi.addProgressPhoto(householdId, project.id, {
      photo_key: 'lf-blob/blob_underlay',
      milestone_id: milestone.id,
    });
    expect(photo.milestone_id).toBe(milestone.id);

    await localProjectsApi.deleteMilestone(householdId, project.id, milestone.id);

    const after = getLocalHouseLedger();
    expect(after.projectMilestones).toHaveLength(0);
    expect(after.projectProgressPhotos).toHaveLength(1);
    expect(after.projectProgressPhotos[0]!.milestone_id).toBeNull();
  });

  it('raises for a milestone that belongs to another project', async () => {
    const project = await commission();
    const other = await commission({ title: 'Rebuild the deck' });
    const { milestone } = await localProjectsApi.addMilestone(householdId, project.id, {
      title: 'Tear-off complete',
    });

    await expect(
      localProjectsApi.updateMilestone(householdId, other.id, milestone.id, { title: 'x' }),
    ).rejects.toThrow('Milestone not found');
    await expect(
      localProjectsApi.deleteMilestone(householdId, other.id, milestone.id),
    ).rejects.toThrow('Milestone not found');
    await expect(
      localProjectsApi.addMilestone('hh_local_someone_else', project.id, { title: 'x' }),
    ).rejects.toThrow(HouseLocalUnknownPropertyError);
  });
});

describe('projects — payments and the derived spend', () => {
  it('recomputes the spend from the rows rather than storing a total', async () => {
    const project = await commission();
    const { payment: deposit } = await localProjectsApi.addPayment(householdId, project.id, {
      type: 'deposit',
      title: 'Deposit',
      amount_cents: 300_000,
    });
    await localProjectsApi.addPayment(householdId, project.id, {
      type: 'final',
      title: 'Balance',
      amount_cents: 650_000,
    });

    expect(deposit.status).toBe('pending');
    // Client-only field: D1 has no `title` column and the Worker's zod drops it,
    // so a payment fetched from the server has `undefined` where the DTO says
    // `string`. The ledger stores what the caller passed.
    expect(deposit.title).toBe('Deposit');

    const beforePaid = await localProjectsApi.getOne(householdId, project.id);
    expect(beforePaid.project.progress.paidAmount).toBe(0);
    expect(beforePaid.project.progress.totalAmount).toBe(950_000);

    await localProjectsApi.markPaymentPaid(householdId, project.id, deposit.id, 'receipts/dep.pdf');

    const afterPaid = await localProjectsApi.getOne(householdId, project.id);
    expect(afterPaid.project.progress.paidAmount).toBe(300_000);
    expect(afterPaid.project.progress.totalAmount).toBe(950_000);
    // The aggregate is NOT on the row. Storing it would let per-field LWW
    // converge two members' partial totals onto one wrong answer.
    expect(
      (getLocalHouseLedger().projects[0]! as unknown as Record<string, unknown>).total_spent_cents,
    ).toBeUndefined();
  });

  it('marks paid in ONE op, stamping the date and keeping the receipt key', async () => {
    const project = await commission();
    const { payment } = await localProjectsApi.addPayment(householdId, project.id, {
      type: 'deposit',
      title: 'Deposit',
      amount_cents: 300_000,
    });

    const before = opCount();
    const { payment: paid } = await localProjectsApi.markPaymentPaid(
      householdId,
      project.id,
      payment.id,
      'receipts/dep.pdf',
    );
    // One op, not two: the Worker's second write is `total_spent_cents`, which
    // this facade deliberately does not reproduce.
    expect(opCount() - before).toBe(1);
    expect(paid.status).toBe('paid');
    expect(paid.paid_date).toBeTruthy();
    expect(paid.receipt_document_key).toBe('receipts/dep.pdf');

    // A later mark-paid with no key must not CLEAR the one already recorded —
    // the Worker's `if (input.x !== undefined)`.
    const { payment: again } = await localProjectsApi.markPaymentPaid(
      householdId,
      project.id,
      payment.id,
    );
    expect(again.receipt_document_key).toBe('receipts/dep.pdf');
  });

  it('lists payments oldest-first and photos newest-first', async () => {
    // Three different orders on one screen: milestones by `sort_order`, payments
    // ascending, photos descending. Guessing at any of them changes what the
    // detail screen shows without changing anything a reader would look at.
    const project = await commission();
    const { payment: first } = await localProjectsApi.addPayment(householdId, project.id, {
      type: 'deposit',
      title: 'Deposit',
      amount_cents: 1,
    });
    const { payment: second } = await localProjectsApi.addPayment(householdId, project.id, {
      type: 'final',
      title: 'Balance',
      amount_cents: 2,
    });
    const { photo: older } = await localProjectsApi.addProgressPhoto(householdId, project.id, {
      photo_key: 'lf-blob/a',
    });
    const { photo: newer } = await localProjectsApi.addProgressPhoto(householdId, project.id, {
      photo_key: 'lf-blob/b',
    });
    // Two writes in one tick share a `created_at` to the millisecond, and the
    // comparator is then a no-op that stable-sort resolves to insertion order.
    // The stamps are widened here so the DIRECTION is what is under test rather
    // than how fast the machine ran — the same reason `stampAt` exists.
    const stored = getLocalHouseLedger().projectProgressPhotos;
    stored.find((row) => row.id === older.id)!.created_at = '2026-03-01T09:00:00.000Z';
    stored.find((row) => row.id === newer.id)!.created_at = '2026-06-01T09:00:00.000Z';

    const { project: read } = await localProjectsApi.getOne(householdId, project.id);
    // Payments oldest-first (`asc(created_at)`), photos newest-first
    // (`desc(created_at)`) — `project-service.ts:89` and `:96`.
    expect(read.payments.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(read.progressPhotos.map((row) => row.id)).toEqual([newer.id, older.id]);
  });

  it('raises for a payment that belongs to another project', async () => {
    const project = await commission();
    const other = await commission({ title: 'Rebuild the deck' });
    const { payment } = await localProjectsApi.addPayment(householdId, project.id, {
      type: 'deposit',
      title: 'Deposit',
      amount_cents: 1,
    });

    await expect(
      localProjectsApi.updatePayment(householdId, other.id, payment.id, { amount_cents: 2 }),
    ).rejects.toThrow('Payment not found');
    await expect(
      localProjectsApi.markPaymentPaid(householdId, other.id, payment.id),
    ).rejects.toThrow('Payment not found');
    await expect(localProjectsApi.deletePayment(householdId, other.id, payment.id)).rejects.toThrow(
      'Payment not found',
    );
  });
});

describe('projects — progress photos are metadata, not bytes', () => {
  it('records the key and honours a supplied `taken_at`', async () => {
    // The Worker ignores `taken_at` (its zod does not declare it) and stamps the
    // row with the moment it was FILED. A photo of last week's framing filed
    // today belongs to last week, so a supplied value wins and `now` is the
    // fallback — which is exactly what the server would have written.
    const project = await commission();
    const { photo } = await localProjectsApi.addProgressPhoto(householdId, project.id, {
      photo_key: 'lf-blob/blob_framing',
      caption: 'Framing, south elevation',
      taken_at: '2026-05-04T16:20:00.000Z',
      tags: ['during'],
    });

    expect(photo.photo_key).toBe('lf-blob/blob_framing');
    expect(photo.taken_at).toBe('2026-05-04T16:20:00.000Z');
    expect(JSON.parse(photo.tags!)).toEqual(['during']);
    expect(photo.household_id).toBe(householdId);

    const { photo: undated } = await localProjectsApi.addProgressPhoto(householdId, project.id, {
      photo_key: 'lf-blob/blob_two',
    });
    expect(undated.taken_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(undated.tags).toBeNull();
  });

  it('deletes the row, and raises for one that belongs to another project', async () => {
    const project = await commission();
    const other = await commission({ title: 'Rebuild the deck' });
    const { photo } = await localProjectsApi.addProgressPhoto(householdId, project.id, {
      photo_key: 'lf-blob/blob_framing',
    });

    await expect(
      localProjectsApi.deleteProgressPhoto(householdId, other.id, photo.id),
    ).rejects.toThrow('Photo not found');

    await localProjectsApi.deleteProgressPhoto(householdId, project.id, photo.id);
    expect(getLocalHouseLedger().projectProgressPhotos).toHaveLength(0);
  });

  it('has no upload method and no URL builder to throw from', () => {
    // B3 is the first labor-hub sub-wave with no P4/H6 surface at all, and that
    // was NOT the expectation going in — a table called
    // `project_progress_photos` reads like a blob surface. Asserted rather than
    // assumed, in both directions: the remote module genuinely has no transfer
    // method, and the local module genuinely never throws. If `projectsApi` ever
    // grows one, it must arrive with a `HouseLocalUnsupportedError` and an entry
    // in `unsupportedCopy.ts`, and this is what will say so.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const remote = require('@api/projects').projectsApi as Record<string, unknown>;
    const names = Object.keys(remote);
    expect(names).toHaveLength(16);
    expect(names.filter((name) => /upload|url/i.test(name))).toEqual([]);

    // The same technique `unsupportedCopy.test.ts` uses to find throw sites,
    // pointed at this one module. A source read rather than a behavioural probe
    // because the claim is "none of the sixteen", and calling all sixteen to
    // prove a negative would prove less.
    const source = readFileSync(join(__dirname, '..', 'localProjectsApi.ts'), 'utf8');
    expect(source).not.toContain('HouseLocalUnsupportedError');
  });
});

describe('projects — one op per member action', () => {
  it('writes exactly one op for every write path in the module', async () => {
    let before = opCount();
    const project = await commission({ title: 'One op' });
    expect(opCount() - before).toBe(1);

    before = opCount();
    await localProjectsApi.update(householdId, project.id, { title: 'Renamed' });
    expect(opCount() - before).toBe(1);

    before = opCount();
    const { milestone } = await localProjectsApi.addMilestone(householdId, project.id, {
      title: 'Tear-off complete',
    });
    expect(opCount() - before).toBe(1);

    before = opCount();
    await localProjectsApi.updateMilestone(householdId, project.id, milestone.id, {
      notes: 'Skip arrived',
    });
    expect(opCount() - before).toBe(1);

    // `completeMilestone` routes through `updateMilestone` rather than opening
    // its own write — a status change and its timestamp must be one op, or a
    // peer can hold a milestone marked complete with no completion date.
    before = opCount();
    await localProjectsApi.completeMilestone(householdId, project.id, milestone.id);
    expect(opCount() - before).toBe(1);

    before = opCount();
    const { payment } = await localProjectsApi.addPayment(householdId, project.id, {
      type: 'deposit',
      title: 'Deposit',
      amount_cents: 1,
    });
    expect(opCount() - before).toBe(1);

    before = opCount();
    await localProjectsApi.updatePayment(householdId, project.id, payment.id, {
      amount_cents: 2,
    });
    expect(opCount() - before).toBe(1);

    before = opCount();
    const { photo } = await localProjectsApi.addProgressPhoto(householdId, project.id, {
      photo_key: 'lf-blob/blob_x',
    });
    expect(opCount() - before).toBe(1);

    before = opCount();
    await localProjectsApi.deleteProgressPhoto(householdId, project.id, photo.id);
    expect(opCount() - before).toBe(1);

    before = opCount();
    await localProjectsApi.deletePayment(householdId, project.id, payment.id);
    expect(opCount() - before).toBe(1);

    before = opCount();
    await localProjectsApi.deleteMilestone(householdId, project.id, milestone.id);
    expect(opCount() - before).toBe(1);
  });
});

/**
 * The cascade, proved through the MERGE rather than through the local ledger.
 *
 * B3 has no S3b table, so it has no shared-natural-key convergence proof to
 * write — every one of its ids is random, deliberately (`schema.ts`). What it
 * has instead is the delete, and the delete is the one op in this sub-wave whose
 * failure mode only appears on a second device: a peer that receives the project
 * tombstone but not the children's would render a spend total for a job that no
 * longer exists. Running the delta through `applyLedgerDelta` is the only way to
 * see that, because the local ledger is already correct by the time the write
 * returns.
 */
describe('the project delete converges on a peer, children included', () => {
  const STAMP_A = stampAt(10, 'member-a', 'op-a');
  const STAMP_B = stampAt(20, 'member-b', 'op-b');

  it('removes the project and all three child tables on the receiving device', () => {
    const deviceA = emptyHouseLedger();
    const peer = emptyHouseLedger();

    const project = { id: 'prj_1', household_id: TEST_HOUSEHOLD_ID, contractor_id: 'ctr_1' };
    const child = (id: string) =>
      ({ id, project_id: 'prj_1', household_id: TEST_HOUSEHOLD_ID }) as never;

    // Device A commissions the job and fills it in; the peer catches up.
    const beforeCreate = captureLedgerSnapshot(deviceA);
    deviceA.projects.push(project as never);
    deviceA.projectMilestones.push(child('pml_1'));
    deviceA.projectPayments.push(child('ppy_1'));
    deviceA.projectProgressPhotos.push(child('pph_1'));
    const createDelta = diffLedger(beforeCreate, deviceA)!;
    applyLedgerDelta(peer, createDelta, STAMP_A);

    expect(peer.projects).toHaveLength(1);
    expect(peer.projectPayments).toHaveLength(1);

    // Device A cancels the job. One mutation across four tables — the shape
    // `localProjectsApi.delete` produces.
    const beforeDelete = captureLedgerSnapshot(deviceA);
    deviceA.projects = [];
    deviceA.projectMilestones = [];
    deviceA.projectPayments = [];
    deviceA.projectProgressPhotos = [];
    const deleteDelta = diffLedger(beforeDelete, deviceA)!;
    applyLedgerDelta(peer, deleteDelta, STAMP_B);

    // Nothing survives on the peer. A delete that named only `projects` would
    // leave the peer holding a payment row forever — invisible, because nothing
    // reads a child without its parent, and permanent, because a tombstone is
    // absorbing and no later op would ever clear it.
    expect(peer.projects).toHaveLength(0);
    expect(peer.projectMilestones).toHaveLength(0);
    expect(peer.projectPayments).toHaveLength(0);
    expect(peer.projectProgressPhotos).toHaveLength(0);
  });
});
