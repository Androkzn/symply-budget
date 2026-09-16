/**
 * `localUtilitiesApi` against a real in-memory session (plan §6 DoD, H11
 * sub-wave C1).
 *
 * Six behaviours are load-bearing beyond the round trips:
 *
 *  - **Deleting a bill takes its reminders AND its pay task with it, in ONE
 *    op.** This is the only cascade in the whole of Wave C that a server delete
 *    actually fires (plan §11.1.2), so it gets both a behavioural test and a
 *    schema-derived one — the same pair `localContractorsApi.test.ts` grew after
 *    B2 shipped a silent orphan.
 *  - **`task_id` is a live link, not a stored string.** An unpaid bill owns a
 *    "Pay <provider> bill" task; marking it paid deletes that task, reopening it
 *    mints a fresh one from the bill's CURRENT values, and deleting the bill
 *    removes it. Every one of those is a single op, because a peer that saw half
 *    of one would hold a reminder it cannot dismiss.
 *  - **The two annual records are keyed on their YEAR.** Two members filing the
 *    same paper notice offline must converge onto one row rather than plotting
 *    2026 twice — and the two tables' keys are the same SHAPE, so only the id
 *    prefix keeps a tax and an assessment for the same year apart.
 *  - **Duplicate detection is month-based and speaks the screen's language.** A
 *    local duplicate arrives in the shape `getDuplicateBill` already reads, so
 *    `AddUtilityBillScreen` offers "add anyway" rather than "that failed".
 *  - **The dashboard and the charts are computed from prorated slices**, not
 *    from each bill's own month, so a two-month bill lands proportionally in
 *    both. Getting that wrong redraws every chart the day the flag flips.
 *  - **An account delete is SOFT**, which is why this family has no second
 *    cascade: the bills filed against a closed account keep their history.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { getDuplicateBill } from '@features/utilities/api/utilities';

import {
  getLocalHouseLedger,
  openLocalHouseSession,
  resetLocalHouseSession,
} from '../engine';
import { HouseLocalUnknownPropertyError, HouseLocalUnsupportedError } from '../errors';
import { houseDeterministicIds } from '../ids';
import {
  BILL_CASCADE_TABLES,
  localUtilitiesApi,
  type CreateLocalUtilityBillInput,
  type CreateLocalUtilityBillOptions,
} from '../localUtilitiesApi';
import { applyLedgerDelta, captureLedgerSnapshot, diffLedger } from '../projection';
import { HOUSE_LEDGER_PHYSICAL_TABLES, HOUSE_LEDGER_TABLE_NAMES } from '../schema';
import type { LocalUtilityReminder } from '../types';

import { emptyHouseLedger, stampAt, TEST_HOUSEHOLD_ID } from './houseLedgerTestKit';

const USER = 'user-utilities-1';

let householdId: string;

function opCount(): number {
  return getLocalHouseLedger().ops.length;
}

function ymd(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().split('T')[0]!;
}

async function fileBill(
  overrides: Partial<CreateLocalUtilityBillInput> = {},
  options?: CreateLocalUtilityBillOptions,
) {
  return localUtilitiesApi.createBill(
    householdId,
    {
      billType: 'electricity',
      provider: 'BC Hydro',
      billingPeriodStart: '2026-01-01',
      billingPeriodEnd: '2026-02-28',
      amount: 6_000,
      dueDate: '2026-03-15',
      ...overrides,
    },
    options,
  );
}

/** A reminder row as the SERVER would have written it — nothing local mints one. */
function seedReminder(billId: string | null, id: string): LocalUtilityReminder {
  const reminder: LocalUtilityReminder = {
    id,
    household_id: householdId,
    bill_id: billId,
    reminder_type: 'payment_due',
    scheduled_for: '2026-03-08T09:00:00.000Z',
    sent_at: null,
    reminder_days_before: 7,
    notification_channel: 'push',
    created_at: '2026-02-01T09:00:00.000Z',
  };
  getLocalHouseLedger().utilityReminders.push(reminder);
  return reminder;
}

beforeEach(async () => {
  await resetLocalHouseSession();
  const ledger = await openLocalHouseSession({ userId: USER, displayName: 'Utilities test home' });
  householdId = ledger.household.id;
});

afterEach(async () => {
  await resetLocalHouseSession();
});

describe('utility accounts — the address book, soft-deleted', () => {
  it('round-trips an account and stores the Tier C provider id as given', async () => {
    // The Worker resolves `providerId` against `utility_providers` and raises
    // `Utility provider not found`. That catalogue is Tier C and is not on the
    // device, so the id is stored rather than verified — the same position
    // `localGarbageApi` holds against the municipality catalogue.
    const account = await localUtilitiesApi.createAccount(householdId, {
      providerId: 'prov_bchydro',
      accountNumber: '1234-5678',
      serviceType: 'electricity',
      billingCyclePreference: 'bimonthly',
    });
    expect(account.provider_id).toBe('prov_bchydro');
    expect(account.household_id).toBe(householdId);
    expect(account.is_active).toBe(true);

    const updated = await localUtilitiesApi.updateAccount(householdId, account.id, {
      accountNumber: '9999',
    });
    expect(updated.account_number).toBe('9999');
    expect(updated.updated_at >= account.updated_at).toBe(true);
  });

  it('lists ACTIVE accounts only, ordered by service type', async () => {
    const gas = await localUtilitiesApi.createAccount(householdId, {
      providerId: 'prov_fortis',
      accountNumber: 'g-1',
      serviceType: 'gas',
    });
    await localUtilitiesApi.createAccount(householdId, {
      providerId: 'prov_bchydro',
      accountNumber: 'e-1',
      serviceType: 'electricity',
    });

    const all = await localUtilitiesApi.getAccounts(householdId);
    expect(all.map((row) => row.service_type)).toEqual(['electricity', 'gas']);

    await localUtilitiesApi.deleteAccount(householdId, gas.id);
    const afterDelete = await localUtilitiesApi.getAccounts(householdId);
    expect(afterDelete.map((row) => row.service_type)).toEqual(['electricity']);
  });

  it('deletes softly, so the bills filed against the account survive', async () => {
    // `deleteUtilityAccount` sets `is_active = false` rather than removing the
    // row, which is why this table has no cascade at all: D1 never fires a
    // foreign key, and `utility_bills.account_id` is not declared `cascade`
    // anyway. An account closed in June must not take five years of hydro bills
    // with it.
    const account = await localUtilitiesApi.createAccount(householdId, {
      providerId: 'prov_bchydro',
      accountNumber: '1234',
      serviceType: 'electricity',
    });
    await fileBill({ accountId: account.id });

    await localUtilitiesApi.deleteAccount(householdId, account.id);

    const ledger = getLocalHouseLedger();
    expect(ledger.utilityAccounts).toHaveLength(1);
    expect(ledger.utilityAccounts[0]!.is_active).toBe(false);
    expect(ledger.utilityBills).toHaveLength(1);
    expect(ledger.utilityBills[0]!.account_id).toBe(account.id);
  });

  it('raises on update but stays silent on delete, exactly as the Worker does', async () => {
    // `updateUtilityAccount` selects first and throws `NotFoundError`;
    // `deleteUtilityAccount` issues a bare UPDATE and cannot tell. The asymmetry
    // is the server's, and reproducing it is what keeps the two backends
    // answering the same way to the same mistake.
    await expect(
      localUtilitiesApi.updateAccount(householdId, 'uac_missing', { isActive: false }),
    ).rejects.toThrow('Utility account not found');
    await expect(localUtilitiesApi.deleteAccount(householdId, 'uac_missing')).resolves.toBeUndefined();
  });

  it('refuses to answer for a property that is not the active one', async () => {
    await expect(localUtilitiesApi.getAccounts('hh_local_someone_else')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
    await expect(localUtilitiesApi.getBills('hh_local_someone_else')).rejects.toThrow(
      HouseLocalUnknownPropertyError,
    );
  });
});

describe('utility bills — the pay task is part of the row', () => {
  it('mints the pay task with the bill, in ONE op', async () => {
    const before = opCount();
    const bill = await fileBill();
    // One op, not two. Two would let a peer hold a bill whose task does not
    // exist — and the paid-status sync would then mint a second one.
    expect(opCount() - before).toBe(1);

    expect(bill.task_id).toBeTruthy();
    const task = getLocalHouseLedger().tasks.find((row) => row.id === bill.task_id);
    expect(task).toBeDefined();
    // Title and description are the Worker's, character for character: the task
    // is stored text, so a household that switched backends would otherwise end
    // up with two spellings of the same reminder.
    expect(task!.title).toBe('Pay BC Hydro bill');
    expect(task!.description).toBe('$60.00 due Mar 15, 2026');
    expect(task!.frequency).toBe('one_time');
    expect(task!.next_due_date).toBe('2026-03-15');
    expect(task!.priority_severity).toBe('high');
  });

  it('falls back to the capitalized bill type when no provider is named', async () => {
    const bill = await fileBill({ provider: undefined, billType: 'water' });
    const task = getLocalHouseLedger().tasks.find((row) => row.id === bill.task_id);
    expect(task!.title).toBe('Pay Water bill');
  });

  it('skips the task for a bill that arrives already paid, and for a deferred import', async () => {
    const paid = await fileBill({ paidDate: '2026-03-10', paidAmount: 6_000 });
    expect(paid.task_id).toBeNull();

    // The batch-import path: every bill arrives unpaid, but the member has not
    // yet said which are ALREADY paid. Creating tasks here too would double up
    // once `ConfirmBillPayments` creates them for the ones left unpaid.
    const ordinary = await fileBill({ provider: 'FortisBC', billType: 'gas', amount: 4_100 });
    expect(ordinary.task_id).toBeTruthy();
    const deferred = await localUtilitiesApi.createBill(
      householdId,
      {
        billType: 'gas',
        provider: 'FortisBC',
        billingPeriodStart: '2026-03-01',
        billingPeriodEnd: '2026-04-30',
        amount: 3_000,
        dueDate: '2026-05-15',
      },
      { deferPayTask: true },
    );
    expect(deferred.task_id).toBeNull();
    // Three bills, one task: the paid one and the deferred one produced none.
    expect(getLocalHouseLedger().utilityBills).toHaveLength(3);
    expect(getLocalHouseLedger().tasks.filter((row) => row.title.startsWith('Pay'))).toHaveLength(
      1,
    );
  });

  it('drops the task when the bill is settled and mints a fresh one when reopened', async () => {
    const bill = await fileBill();
    const firstTaskId = bill.task_id!;

    const settled = await localUtilitiesApi.updateBill(householdId, bill.id, {
      paidDate: '2026-03-11',
    });
    expect(settled.paid_date).toBe('2026-03-11');
    expect(settled.task_id).toBeNull();
    expect(getLocalHouseLedger().tasks.find((row) => row.id === firstTaskId)).toBeUndefined();

    // Reopening mints from the bill's CURRENT values, so a corrected amount
    // shows on the new task rather than the one the first task carried.
    const reopened = await localUtilitiesApi.updateBill(householdId, bill.id, {
      paidDate: '',
      amount: 7_500,
    });
    expect(reopened.paid_date).toBeNull();
    expect(reopened.task_id).toBeTruthy();
    expect(reopened.task_id).not.toBe(firstTaskId);
    const replacement = getLocalHouseLedger().tasks.find((row) => row.id === reopened.task_id);
    expect(replacement!.description).toBe('$75.00 due Mar 15, 2026');
  });

  it('filters and orders bills the way the Worker does', async () => {
    const hydro = await fileBill();
    await localUtilitiesApi.createBill(householdId, {
      billType: 'gas',
      provider: 'FortisBC',
      billingPeriodStart: '2026-03-01',
      billingPeriodEnd: '2026-04-30',
      amount: 3_000,
      dueDate: '2026-05-15',
    });

    const all = await localUtilitiesApi.getBills(householdId);
    // `due_date` DESC.
    expect(all.map((row) => row.due_date)).toEqual(['2026-05-15', '2026-03-15']);

    expect(await localUtilitiesApi.getBills(householdId, { billType: 'gas' })).toHaveLength(1);
    expect(await localUtilitiesApi.getBills(householdId, { paid: false })).toHaveLength(2);
    expect(await localUtilitiesApi.getBills(householdId, { paid: true })).toHaveLength(0);
    expect(await localUtilitiesApi.getBills(householdId, { limit: 1 })).toHaveLength(1);

    // The bounds are asymmetric on the server and are mirrored: `startDate`
    // compares against the period START and `endDate` against the period END, so
    // a range returns bills CONTAINED by it rather than bills that overlap it.
    const contained = await localUtilitiesApi.getBills(householdId, {
      startDate: '2026-01-01',
      endDate: '2026-03-01',
    });
    expect(contained.map((row) => row.id)).toEqual([hydro.id]);
  });

  it('rejects a same-month duplicate in the shape the screen already reads', async () => {
    const first = await fileBill();

    // Month-based, anchored on the period MIDPOINT: an extraction can nudge the
    // dates by a day between re-imports, and anchoring on the midpoint stops two
    // consecutive multi-month bills that share a boundary month from colliding.
    let caught: unknown;
    try {
      await fileBill({ billingPeriodStart: '2026-01-03', billingPeriodEnd: '2026-02-27' });
    } catch (error) {
      caught = error;
    }
    // The point of the custom error: `getDuplicateBill` is the EXISTING client
    // helper `AddUtilityBillScreen` calls to choose between "that failed" and
    // "you already have this one — add anyway?".
    expect(getDuplicateBill(caught)?.id).toBe(first.id);
    expect(getLocalHouseLedger().utilityBills).toHaveLength(1);

    // …and "add anyway" gets through.
    const second = await fileBill(
      { billingPeriodStart: '2026-01-03', billingPeriodEnd: '2026-02-27' },
      { allowDuplicate: true },
    );
    expect(second.id).not.toBe(first.id);
    expect(getLocalHouseLedger().utilityBills).toHaveLength(2);
  });

  it('lets a different utility bill the same month through', async () => {
    // The duplicate check is scoped to `bill_type` first. Without that, a gas
    // bill and a hydro bill for January would collide whenever the amounts
    // happened to match.
    await fileBill();
    const gas = await localUtilitiesApi.createBill(householdId, {
      billType: 'gas',
      provider: 'FortisBC',
      billingPeriodStart: '2026-01-01',
      billingPeriodEnd: '2026-02-28',
      amount: 6_000,
      dueDate: '2026-03-15',
    });
    expect(gas.id).toBeTruthy();
  });
});

describe('utility bills — the cascade on delete', () => {
  /**
   * The regression this exists for is B2's, one wave later: a delete written
   * when only some of a family was live silently stops covering the rest. C1 has
   * one cascading child and it is easy to believe there are none, because four
   * of the five C1 tables genuinely have none.
   *
   * So the list is asserted against the DRIZZLE SCHEMA rather than against a
   * hand-written expectation. A cascading foreign key added in D1 without a
   * matching entry here now fails in milliseconds instead of leaking rows to
   * every peer forever.
   */
  it('cascades exactly the tables D1 cascades — checked against the schema, not the code', () => {
    const schemaDir = join(__dirname, '../../../../../backend/src/db');
    const sources = readdirSync(schemaDir)
      .filter((f) => f.startsWith('schema') && f.endsWith('.ts'))
      .map((f) => readFileSync(join(schemaDir, f), 'utf8'))
      .join('\n');

    const blocks = sources.split(/export const \w+ = sqliteTable\(\s*'/).slice(1);
    const cascading = new Set<string>();
    for (const block of blocks) {
      const physical = block.slice(0, block.indexOf("'"));
      if (/references\(\(\)\s*=>\s*utilityBills\.id,\s*\{\s*onDelete:\s*'cascade'/.test(block)) {
        cascading.add(physical);
      }
    }

    // Non-vacuity: if the parse breaks, `cascading` empties and the comparison
    // below passes for the wrong reason. One is the true floor here — unlike the
    // contractor list, this one is not expected to grow.
    expect(cascading.size).toBeGreaterThanOrEqual(1);
    expect(cascading.has('utility_reminders')).toBe(true);

    const live = HOUSE_LEDGER_TABLE_NAMES.filter((t) =>
      cascading.has(HOUSE_LEDGER_PHYSICAL_TABLES[t]),
    );
    expect([...BILL_CASCADE_TABLES].sort()).toEqual([...live].sort());
  });

  it('takes the reminders and the pay task with it, in ONE op', async () => {
    const bill = await fileBill();
    const other = await localUtilitiesApi.createBill(householdId, {
      billType: 'gas',
      provider: 'FortisBC',
      billingPeriodStart: '2026-03-01',
      billingPeriodEnd: '2026-04-30',
      amount: 3_000,
      dueDate: '2026-05-15',
    });

    // Reminders as the SERVER wrote them before the household went local-first;
    // nothing on device mints one (see `types.ts`). A second bill's reminder
    // must survive — a filter on the wrong column would empty both and every
    // assertion below would still pass.
    seedReminder(bill.id, 'urm_1');
    seedReminder(bill.id, 'urm_2');
    seedReminder(other.id, 'urm_other');
    // A grant/appeal reminder hangs off a notice rather than a bill, so its
    // `bill_id` is null and no bill delete may touch it.
    seedReminder(null, 'urm_orphanless');

    const before = opCount();
    await localUtilitiesApi.deleteBill(householdId, bill.id);
    expect(opCount() - before).toBe(1);

    const after = getLocalHouseLedger();
    expect(after.utilityBills.map((row) => row.id)).toEqual([other.id]);
    expect(after.utilityReminders.map((row) => row.id).sort()).toEqual([
      'urm_orphanless',
      'urm_other',
    ]);
    // The task went too — not a cascade (D1 puts no `references()` on
    // `task_id`), but the same obligation, and `deleteUtilityBill` discharges it
    // by hand for the same reason.
    expect(after.tasks.find((row) => row.id === bill.task_id)).toBeUndefined();
    expect(after.tasks.find((row) => row.id === other.task_id)).toBeDefined();
  });

  it('raises for a bill that does not exist', async () => {
    await expect(localUtilitiesApi.deleteBill(householdId, 'ubl_missing')).rejects.toThrow(
      'Utility bill not found',
    );
    await expect(
      localUtilitiesApi.updateBill(householdId, 'ubl_missing', { amount: 1 }),
    ).rejects.toThrow('Utility bill not found');
  });
});

/**
 * The cascade, proved through the MERGE rather than through the local ledger.
 *
 * The failure mode only appears on a second device: a peer that receives the
 * bill tombstone but not the reminders' would hold rows for a bill it no longer
 * has — invisible, because nothing reads a reminder without its bill, and
 * permanent, because a tombstone is absorbing and no later op would clear it.
 * Running the delta through `applyLedgerDelta` is the only way to see that,
 * because the local ledger is already correct by the time the write returns.
 */
describe('the bill delete converges on a peer, reminders included', () => {
  const STAMP_A = stampAt(10, 'member-a', 'op-a');
  const STAMP_B = stampAt(20, 'member-b', 'op-b');

  it('removes the bill, its reminders and its task on the receiving device', () => {
    const deviceA = emptyHouseLedger();
    const peer = emptyHouseLedger();

    const bill = {
      id: 'ubl_1',
      household_id: TEST_HOUSEHOLD_ID,
      bill_type: 'electricity',
      task_id: 'task_pay_1',
    };
    const reminder = (id: string) =>
      ({ id, bill_id: 'ubl_1', household_id: TEST_HOUSEHOLD_ID }) as never;

    const beforeCreate = captureLedgerSnapshot(deviceA);
    deviceA.utilityBills.push(bill as never);
    deviceA.utilityReminders.push(reminder('urm_1'), reminder('urm_2'));
    deviceA.tasks.push({ id: 'task_pay_1', household_id: TEST_HOUSEHOLD_ID } as never);
    applyLedgerDelta(peer, diffLedger(beforeCreate, deviceA)!, STAMP_A);

    expect(peer.utilityBills).toHaveLength(1);
    expect(peer.utilityReminders).toHaveLength(2);

    // One mutation across three tables — the shape `deleteBill` produces.
    const beforeDelete = captureLedgerSnapshot(deviceA);
    deviceA.utilityBills = [];
    deviceA.utilityReminders = [];
    deviceA.tasks = [];
    applyLedgerDelta(peer, diffLedger(beforeDelete, deviceA)!, STAMP_B);

    expect(peer.utilityBills).toHaveLength(0);
    expect(peer.utilityReminders).toHaveLength(0);
    expect(peer.tasks).toHaveLength(0);
  });
});

describe('bulk paid-status confirmation', () => {
  it('confirms a whole import in ONE op, self-healing in both directions', async () => {
    const unpaid = await fileBill();
    const alreadyPaid = await localUtilitiesApi.createBill(householdId, {
      billType: 'gas',
      provider: 'FortisBC',
      billingPeriodStart: '2026-03-01',
      billingPeriodEnd: '2026-04-30',
      amount: 3_000,
      dueDate: '2026-05-15',
      paidDate: '2026-05-02',
    });
    expect(alreadyPaid.task_id).toBeNull();

    const before = opCount();
    const updated = await localUtilitiesApi.setBillsPaidStatus(householdId, [
      { billId: unpaid.id, paid: true },
      { billId: alreadyPaid.id, paid: false },
      // An id from another household is skipped rather than raised.
      { billId: 'ubl_not_ours', paid: true },
    ]);
    // ONE op for what the member experienced as one tap. Twenty separate writes
    // would be twenty ops, and a peer applying them one at a time would render a
    // half-confirmed import.
    expect(opCount() - before).toBe(1);
    expect(updated).toHaveLength(2);

    const ledger = getLocalHouseLedger();
    const settled = ledger.utilityBills.find((row) => row.id === unpaid.id)!;
    // Marking paid uses TODAY and the bill's own amount, and drops the reminder.
    expect(settled.paid_date).toBe(new Date().toISOString().split('T')[0]);
    expect(settled.paid_amount).toBe(6_000);
    expect(settled.task_id).toBeNull();
    expect(ledger.tasks.find((row) => row.id === unpaid.task_id)).toBeUndefined();

    // Reopening restores the reminder task for a bill that had none.
    const reopened = ledger.utilityBills.find((row) => row.id === alreadyPaid.id)!;
    expect(reopened.paid_date).toBeNull();
    expect(reopened.paid_amount).toBeNull();
    expect(reopened.task_id).toBeTruthy();
    expect(ledger.tasks.find((row) => row.id === reopened.task_id)!.title).toBe(
      'Pay FortisBC bill',
    );
  });
});

describe('property taxes — one notice per year, and its reminder tasks', () => {
  const NOTICE = {
    taxYear: 2026,
    assessedValue: 118_100_000,
    taxAmount: 505_334,
    mainPaymentAmount: 505_334,
    mainPaymentDueDate: '2026-07-02',
    homeownerGrantEligible: true,
    homeownerGrantAmount: 57_000,
    municipalityName: 'Surrey',
  };

  it('derives the id from the year, so two devices converge on one record', async () => {
    const tax = await localUtilitiesApi.createPropertyTax(householdId, NOTICE);
    expect(tax.id).toBe(houseDeterministicIds.propertyTax(householdId, 2026));

    // The assessment's natural key is the SAME shape — `(household_id, a year)` —
    // so only the id prefix keeps the two apart. Without it, filing both for
    // 2026 would fold one into the other.
    const assessment = await localUtilitiesApi.createBCAssessment(householdId, {
      assessmentYear: 2026,
      assessedValue: 118_100_000,
    });
    expect(assessment.id).toBe(houseDeterministicIds.bcAssessment(householdId, 2026));
    expect(assessment.id).not.toBe(tax.id);
  });

  it('raises rather than duplicating when the year is already on this device', async () => {
    // A deterministic id merges writes that cannot see each other. When the
    // existing row is right there, pushing a second with the same id would put a
    // duplicate in the array rather than merge anything — and the member has the
    // information to choose, which is what the upload response's `duplicate` flag
    // is for.
    await localUtilitiesApi.createPropertyTax(householdId, NOTICE);
    await expect(localUtilitiesApi.createPropertyTax(householdId, NOTICE)).rejects.toThrow(
      'A property tax record already exists for this year',
    );
    await localUtilitiesApi.createBCAssessment(householdId, {
      assessmentYear: 2026,
      assessedValue: 1,
    });
    await expect(
      localUtilitiesApi.createBCAssessment(householdId, {
        assessmentYear: 2026,
        assessedValue: 1,
      }),
    ).rejects.toThrow('A BC Assessment record already exists for this year');
  });

  it('creates the grant task FIRST, then the pay task, in one op', async () => {
    const before = opCount();
    const tax = await localUtilitiesApi.createPropertyTax(householdId, NOTICE);
    expect(opCount() - before).toBe(1);

    expect(tax.grant_task_id).toBeTruthy();
    expect(tax.main_payment_task_id).toBeTruthy();
    const tasks = getLocalHouseLedger().tasks;
    expect(tasks.find((row) => row.id === tax.grant_task_id)!.title).toBe(
      'Claim 2026 Home Owner Grant',
    );
    const payTask = tasks.find((row) => row.id === tax.main_payment_task_id)!;
    // The municipality from the scanned notice lands in the title.
    expect(payTask.title).toBe('Pay 2026 property tax (Surrey)');
    expect(payTask.description).toBe('$5053.34 due Jul 2, 2026');
  });

  it('deducts an applied grant from what is owed but not from the levy', async () => {
    // `tax_amount` stays the gross "No Grant" levy for history;
    // `main_payment_amount` becomes what is actually due, so the pay task and
    // any penalty math read the post-grant figure. Getting this backwards would
    // show the member the wrong number to pay.
    const tax = await localUtilitiesApi.createPropertyTax(householdId, {
      ...NOTICE,
      homeownerGrantApplied: true,
    });
    expect(tax.tax_amount).toBe(505_334);
    expect(tax.main_payment_amount).toBe(505_334 - 57_000);
    expect(tax.homeowner_grant_applied_date).toBeTruthy();
    expect(tax.homeowner_grant_status).toBe('pending');
    // Nothing left to claim, so no grant nudge — but the pay task still stands.
    expect(tax.grant_task_id).toBeNull();
    expect(tax.main_payment_task_id).toBeTruthy();
  });

  it('creates no task at all for a notice imported already paid', async () => {
    const tax = await localUtilitiesApi.createPropertyTax(householdId, {
      ...NOTICE,
      mainPaymentPaidDate: '2026-06-20',
    });
    expect(tax.main_payment_task_id).toBeNull();
    expect(tax.grant_task_id).toBeNull();
    expect(getLocalHouseLedger().tasks).toHaveLength(0);
  });

  it('clears each task as its half is resolved, and never computes penalties', async () => {
    const tax = await localUtilitiesApi.createPropertyTax(householdId, NOTICE);
    const grantTaskId = tax.grant_task_id!;
    const payTaskId = tax.main_payment_task_id!;

    const granted = await localUtilitiesApi.updatePropertyTax(householdId, tax.id, {
      homeownerGrantAppliedDate: '2026-06-01',
    });
    expect(granted.grant_task_id).toBeNull();
    expect(granted.main_payment_task_id).toBe(payTaskId);
    expect(getLocalHouseLedger().tasks.find((row) => row.id === grantTaskId)).toBeUndefined();

    const paid = await localUtilitiesApi.updatePropertyTax(householdId, tax.id, {
      mainPaymentPaidDate: '2026-06-28',
    });
    expect(paid.main_payment_task_id).toBeNull();
    expect(getLocalHouseLedger().tasks.find((row) => row.id === payTaskId)).toBeUndefined();

    // `calculatePropertyTaxPenalties` returns `[]` without a municipality
    // config, the catalogue is Tier C and not on device, and the Worker takes
    // the same empty branch for any property outside the configured
    // municipalities. So this is the server's behaviour, not a gap.
    expect(paid.penalties).toBeNull();
  });

  it('lists newest year first and raises for a year with no notice', async () => {
    await localUtilitiesApi.createPropertyTax(householdId, NOTICE);
    await localUtilitiesApi.createPropertyTax(householdId, {
      ...NOTICE,
      taxYear: 2025,
      mainPaymentDueDate: '2025-07-02',
    });

    const taxes = await localUtilitiesApi.getPropertyTaxes(householdId);
    expect(taxes.map((row) => row.tax_year)).toEqual([2026, 2025]);
    expect((await localUtilitiesApi.getPropertyTaxByYear(householdId, 2025)).tax_year).toBe(2025);
    // The route answers 404 and the client's return type is non-nullable, so a
    // miss must not look like an empty answer.
    await expect(localUtilitiesApi.getPropertyTaxByYear(householdId, 2019)).rejects.toThrow(
      'Property tax not found',
    );
  });
});

describe('BC Assessment', () => {
  it('round-trips, keeps the blob key as metadata and lists newest first', async () => {
    const assessment = await localUtilitiesApi.createBCAssessment(householdId, {
      assessmentYear: 2026,
      assessedValue: 118_100_000,
      landValue: 92_500_000,
      improvementValue: 25_600_000,
      previousYearValue: 105_000_000,
      assessmentPdfKey: 'lf-blob/blob_assessment',
      appealDeadline: '2026-01-31',
    });
    expect(assessment.assessment_pdf_key).toBe('lf-blob/blob_assessment');
    expect(assessment.appeal_filed).toBe(false);

    await localUtilitiesApi.createBCAssessment(householdId, {
      assessmentYear: 2025,
      assessedValue: 105_000_000,
    });
    const all = await localUtilitiesApi.getBCAssessments(householdId);
    expect(all.map((row) => row.assessment_year)).toEqual([2026, 2025]);

    const appealed = await localUtilitiesApi.updateBCAssessment(householdId, assessment.id, {
      appealFiled: true,
    });
    expect(appealed.appeal_filed).toBe(true);
    await expect(
      localUtilitiesApi.updateBCAssessment(householdId, 'bca_missing', { appealFiled: true }),
    ).rejects.toThrow('BC Assessment not found');
  });
});

describe('composed reads — computed on device, never stored', () => {
  it('prorates a two-month bill by day across both months', async () => {
    // Jan 1 – Feb 28 is 59 days: 31 to January, 28 to February. $60.00 splits
    // 3153 / 2847, and the parts sum to the bill because rounding drift is
    // folded into the last slice. A dashboard that filed the whole bill under
    // its start month would show a January spike and an empty February.
    await fileBill();
    const analytics = await localUtilitiesApi.getAnalytics(householdId, {
      startYear: 2026,
      endYear: 2026,
    });

    expect(analytics.monthlyData.map((row) => [row.month, row.total])).toEqual([
      ['2026-01', 3_153],
      ['2026-02', 2_847],
    ]);
    expect(analytics.proratedTotalAmount).toBe(6_000);
    expect(analytics.totalAmount).toBe(6_000);
    expect(analytics.totalBills).toBe(1);
    // The provider key falls through by BILL TYPE when the name does not match,
    // so an unnamed electricity bill still lands on the BC Hydro card.
    expect(analytics.byProvider.map((row) => row.providerKey)).toEqual(['bc_hydro']);
    expect(analytics.byProvider[0]!.avgMonthlyAmount).toBe(3_000);
    expect(analytics.yearOverYear.currentYear).toEqual({ year: 2026, total: 6_000, count: 2 });
  });

  it('filters analytics by utility type and by provider', async () => {
    await fileBill();
    await localUtilitiesApi.createBill(householdId, {
      billType: 'gas',
      provider: 'FortisBC',
      billingPeriodStart: '2026-01-01',
      billingPeriodEnd: '2026-01-31',
      amount: 4_000,
      dueDate: '2026-02-15',
    });

    const gasOnly = await localUtilitiesApi.getAnalytics(householdId, {
      startYear: 2026,
      endYear: 2026,
      utilityType: 'gas',
    });
    expect(gasOnly.totalBills).toBe(1);
    expect(gasOnly.totalAmount).toBe(4_000);

    // `overview` is the "no filter" member of the union, not a provider.
    const everything = await localUtilitiesApi.getAnalytics(householdId, {
      startYear: 2026,
      endYear: 2026,
      providerKey: 'overview',
    });
    expect(everything.totalBills).toBe(2);
    const hydroOnly = await localUtilitiesApi.getAnalytics(householdId, {
      startYear: 2026,
      endYear: 2026,
      providerKey: 'bc_hydro',
    });
    expect(hydroOnly.totalBills).toBe(1);
  });

  it('answers the dashboard from the ledger, with a null municipality', async () => {
    const soon = await localUtilitiesApi.createBill(householdId, {
      billType: 'water',
      provider: 'City of Surrey',
      billingPeriodStart: ymd(-60),
      billingPeriodEnd: ymd(-30),
      amount: 2_500,
      dueDate: ymd(10),
    });
    // Outside the 30-day window, so it must NOT appear in `upcomingBills`.
    await localUtilitiesApi.createBill(householdId, {
      billType: 'sewer',
      provider: 'City of Surrey',
      billingPeriodStart: ymd(-120),
      billingPeriodEnd: ymd(-90),
      amount: 1_500,
      dueDate: ymd(120),
    });

    const dashboard = await localUtilitiesApi.getDashboard(householdId);
    expect(dashboard.upcomingBills.map((row) => row.id)).toEqual([soon.id]);
    expect(dashboard.periodMonthKey).toMatch(/^\d{4}-\d{2}$/);
    expect(typeof dashboard.periodIsCurrent).toBe('boolean');
    // The one field this method cannot answer: `municipality_configs` is Tier C
    // and not on the device, and the server derives it from an address a
    // local-first household keeps in its ledger. `null` is a first-class value
    // of the declared type and is what the Worker returns for any address
    // outside the configured municipalities. `getMunicipality` stays remote for
    // exactly this reason.
    expect(dashboard.municipality).toBeNull();
  });

  it('builds the property insights from both annual tables, ascending by year', async () => {
    await localUtilitiesApi.createBCAssessment(householdId, {
      assessmentYear: 2025,
      assessedValue: 100_000_000,
    });
    await localUtilitiesApi.createBCAssessment(householdId, {
      assessmentYear: 2026,
      assessedValue: 118_100_000,
      landValue: 92_500_000,
      improvementValue: 25_600_000,
      previousYearValue: 100_000_000,
    });
    await localUtilitiesApi.createPropertyTax(householdId, {
      taxYear: 2025,
      assessedValue: 100_000_000,
      taxAmount: 450_000,
      mainPaymentAmount: 450_000,
      mainPaymentDueDate: '2025-07-02',
      mainPaymentPaidDate: '2025-06-30',
    });
    await localUtilitiesApi.createPropertyTax(householdId, {
      taxYear: 2026,
      assessedValue: 118_100_000,
      taxAmount: 505_334,
      mainPaymentAmount: 505_334,
      mainPaymentDueDate: '2026-07-02',
      homeownerGrantEligible: true,
      homeownerGrantAmount: 57_000,
    });

    const insights = await localUtilitiesApi.getPropertyInsights(householdId);
    expect(insights.hasData).toBe(true);
    // ASCENDING — the charts plot left to right, and the "latest" values are
    // read off the end. Copying the descending order the list reads use would
    // draw every chart backwards.
    expect(insights.assessment.history.map((row) => row.year)).toEqual([2025, 2026]);
    expect(insights.propertyTax.history.map((row) => row.year)).toEqual([2025, 2026]);
    expect(insights.assessment.latest!.assessment_year).toBe(2026);
    expect(insights.assessment.yoy!.changeCents).toBe(18_100_000);
    expect(insights.assessment.landVsBuilding).toEqual({
      landValue: 92_500_000,
      improvementValue: 25_600_000,
    });
    expect(insights.propertyTax.yoy!.changeCents).toBe(55_334);
    // The most RECENT unpaid notice, not the oldest.
    expect(insights.propertyTax.nextDue!.year).toBe(2026);
    expect(insights.propertyTax.nextDue!.grantEligible).toBe(true);
    expect(insights.stats.map((row) => row.id)).toEqual([
      'assessed_value',
      'latest_tax',
      'next_due',
      'effective_rate',
    ]);
    expect(insights.insights.map((row) => row.id)).toContain('grant_available');
    // Nothing computed here is stored: the ledger row carries no tiles, no
    // series and no cards, so there is no aggregate for per-field LWW to
    // converge wrongly.
    const stored = getLocalHouseLedger().propertyTaxes[0]! as unknown as Record<string, unknown>;
    expect(stored.stats).toBeUndefined();
    expect(stored.insights).toBeUndefined();
  });

  it('reports no data for an empty ledger rather than failing', async () => {
    const insights = await localUtilitiesApi.getPropertyInsights(householdId);
    expect(insights.hasData).toBe(false);
    expect(insights.stats).toEqual([]);
    expect(insights.propertyTax.nextDue).toBeNull();

    const analytics = await localUtilitiesApi.getAnalytics(householdId);
    expect(analytics.totalBills).toBe(0);
    expect(analytics.insights.map((row) => row.id)).toEqual(['no-bills']);
  });
});

describe('the four extraction methods are off, with copy', () => {
  it.each([
    'uploadAndExtractBill',
    'extractBillFromDocument',
    'uploadAndExtractPropertyTax',
    'uploadAndExtractAssessment',
  ] as const)('%s throws rather than routing to a server', async (method) => {
    // A REJECTED promise carrying member-facing copy, never a missing key: a
    // missing key would route the upload to a Worker that would accept the PDF
    // and file the resulting record into a household whose rows live elsewhere.
    await expect(
      (localUtilitiesApi[method] as () => Promise<never>)(),
    ).rejects.toBeInstanceOf(HouseLocalUnsupportedError);
  });

  it('names the ONE method that is remote by design and no others', () => {
    // `getMunicipality` reads `municipality_configs`, Tier C global reference
    // data. It is absent from the local module on purpose and declared in the
    // Proxy's `remoteMethods`, so "this one goes to the server" is a decision in
    // the code rather than the absence of one.
    const local = localUtilitiesApi as unknown as Record<string, unknown>;
    expect(local.getMunicipality).toBeUndefined();

    // The module moved from `src/api/utilities.ts` into the `utilities` feature
    // folder. Read by path rather than imported on purpose — the assertion is
    // about the SOURCE declaring `remoteMethods`, which an import cannot see.
    const source = readFileSync(
      join(__dirname, '..', '..', '..', 'utilities', 'api', 'utilities.ts'),
      'utf8',
    );
    expect(source).toContain("remoteMethods: ['getMunicipality']");
  });
});
