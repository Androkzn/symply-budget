/**
 * Local `utilities` — the ledger counterpart of `src/api/utilities.ts` (plan §11,
 * sub-wave C1). The first block of Wave C, and five tables in one facade:
 * `utility_accounts`, `utility_bills`, `property_taxes`, `bc_assessment_data`
 * and `utility_reminders`.
 *
 * ## The cascade audit, which is the reason this sub-wave is more than a registry edit
 *
 * Plan §11.1.2 pre-audited every Wave-C parent and found **exactly one** server
 * delete that is HARD and therefore actually fires a foreign key. It is here, and
 * it was re-derived against `backend/src/db/schema-utilities.ts` and
 * `backend/src/services/utility-service.ts` before a line of this file was
 * written, because §11.1.1's whole point is that these audits are cheap and the
 * bug they catch is silent:
 *
 * | C1 table | Server delete | Cascade fires? |
 * |---|---|---|
 * | `utility_bills` | **hard** — `.delete(utilityBills)` (`utility-service.ts:739`) | **YES → `utility_reminders`** (`bill_id`, `onDelete: 'cascade'`, `schema-utilities.ts:196`) |
 * | `utility_accounts` | **soft** — `set is_active = false` (`:384`) | no. The row survives, so D1 has nothing to cascade — and `utility_bills.account_id` is not declared `cascade` anyway, so a bill outlives its account by design |
 * | `property_taxes` | none — no route, no service method | no |
 * | `bc_assessment_data` | none — no route, no service method | no |
 *
 * And the other direction, which is the one B2 got wrong: **nothing already live
 * cascades INTO a C1 table.** `utility_reminders.bill_id` is the only foreign key
 * pointing at any of these five from anywhere, and it comes from inside C1. All
 * four `household_id` columns cascade from `households`, which is never deleted
 * on device (deleting a property tears down its whole ledger, not rows within
 * it). So `CONTRACTOR_CASCADE_TABLES` and its transitive list need no new entry,
 * and no existing facade changes — this is the first sub-wave since B1 for which
 * that is true.
 *
 * `BILL_CASCADE_TABLES` below names the one obligation, and `deleteBill`
 * performs it in ONE op. A peer that received a partial cascade would hold
 * reminders for a bill it no longer has: invisible, because nothing reads a
 * reminder without its bill, and permanent, because a tombstone is absorbing.
 *
 * ## `task_id` — the bill's pay reminder is REAL and is maintained here
 *
 * `utility_bills.task_id` is a genuine pointer into `tasks`, a Wave-A ledger
 * table: an unpaid bill owns a one-time "Pay <provider> bill" task carrying the
 * bill's amount and due date, and that task is how a bill reaches the
 * maintenance board at all. `utility-service.ts` mints it on create, drops it
 * when the bill is marked paid, brings it back when the bill is reopened, and
 * deletes it before deleting the bill (`:735`, immediately above the hard delete
 * above).
 *
 * **Both halves of that link are on the ledger, so the facade maintains it.** The
 * alternative — leaving `task_id` permanently null on device — would silently
 * delete a feature: bills would stop appearing on the board the day a household
 * went local-first, and nothing would fail. Worse, bills the server wrote
 * BEFORE the cutover arrive with a live `task_id` and a live task row, so a
 * facade that ignored the column would strand a "Pay BC Hydro bill" task for a
 * bill the member had just deleted.
 *
 * `localContractorsApi.createReceiptReminderTask` settled the precedent: a
 * facade may write `draft.tasks` directly, in its OWN op, rather than calling
 * `localTasksApi`. Two ops would let a peer hold a bill whose task does not
 * exist, or a task with no bill. The same applies to `property_taxes`, which
 * owns two task pointers (`main_payment_task_id`, `grant_task_id`) and is
 * handled identically.
 *
 * One divergence, and it is the server's own: `TaskService.createTask` also
 * schedules push notifications. Notifications are Tier B and a device with no
 * signal has nothing to send them with — the member's own device reminders are
 * H4's scheduler (`reminders/`), reading the task row that this write creates.
 *
 * ## What is deliberately NOT reproduced
 *
 *  - **`scheduleBillReminders`.** The Worker writes five `utility_reminders`
 *    rows per bill so its 5-minute cron can push. A local-first ledger is
 *    ciphertext to that cron, and on-device reminders read the bill's `due_date`
 *    directly, so minting these rows would replicate a work queue nobody drains
 *    to every peer forever. The table is still ledgered — for convergence, and
 *    decisively for the cascade above. See `types.ts`.
 *  - **Property-tax penalties.** `calculatePropertyTaxPenalties` returns `[]`
 *    whenever it has no municipality config, and the municipality catalogue is
 *    Tier C and not on the device. So the local answer is `[]` — which is not a
 *    divergence but the SAME branch the server takes for any property outside
 *    the Greater Vancouver configs.
 *  - **`grantWarning`.** The create route adds it when ANOTHER of the user's
 *    properties already claimed that year's Home Owner Grant. A local-first
 *    ledger holds one property and cannot see another's tax rows, so the warning
 *    can never be raised here — the row comes back without it, exactly as the
 *    server returns it when there is no conflict. See `types.ts`.
 *  - **Provider verification.** `createUtilityAccount` checks the id against
 *    `utility_providers`, which is Tier C. The id is stored as given.
 *
 * ## Four throws, one remote, nineteen local
 *
 * **Thrown (H6 + P4):** all four extraction methods. Each takes a PDF or photo,
 * moves the bytes to R2 and runs a model over them; under E2EE the Worker holds
 * ciphertext and the device holds no model. They are present as throws rather
 * than declared remote-only, because a missing key routes to a Worker that would
 * happily accept the upload and file the resulting bill into a household whose
 * rows live somewhere else entirely.
 *
 * **Remote by design (Tier C):** `getMunicipality`. `municipality_configs` is in
 * `HOUSE_TIER_B/C` — global reference data identical for every household,
 * carrying nothing of theirs — and this is the same call
 * `garbageCollectionApi.getMunicipality` makes. Its answer is typed
 * `MunicipalityConfig | null` and every screen already renders the null.
 *
 * Everything else is local, including the two that look most like server
 * features: `getDashboard` and `getAnalytics` are pure functions of
 * `utility_bills` (`logic/billAnalytics.ts`), and `getPropertyInsights` is pure
 * arithmetic over the two annual tables. The table that DOES pre-compute this
 * server-side, `utility_trends`, is Tier D and must never be ledgered.
 *
 * **No bulk path.** Every write is one row plus its cascade. `setBillsPaidStatus`
 * looks like a bulk write and is not: it mutates rows already in the ledger, so
 * it is one op regardless of how many bills the import review ticked.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import type {
  BillAnalytics,
  CreatePropertyTaxRequest,
  DashboardOverview,
  PropertyInsights,
  ProviderKey,
  UtilityBill,
} from '@features/utilities/api/utilities';

import { getLocalHouseMemberId } from './engine';
import { HouseLocalUnknownPropertyError, HouseLocalUnsupportedError } from './errors';
import { houseDeterministicIds, newLocalId } from './ids';
import { activeHouseholdId, nowIso, rowsOf, writeLocal } from './localWrite';
import { buildBillAnalytics } from './logic/billAnalytics';
import type { HouseLedgerTableName } from './schema';
import type {
  LocalBcAssessmentData,
  LocalPropertyTax,
  LocalTask,
  LocalUtilityAccount,
  LocalUtilityBill,
} from './types';

// ---------------------------------------------------------------------------
// Input shapes — mirrors of the module-private request types in
// `src/api/utilities.ts`. They are not exported there, so they are restated
// rather than imported; `apiParity.test.ts` catches a method that disappears and
// `tsc` catches a field whose type changed on the DTO.
//
// Note these are camelCase, unlike every labor-hub facade's snake_case inputs.
// That is the remote module's convention here and the screens pass it, so the
// facade takes what they send rather than what the column is called.
// `CreatePropertyTaxRequest` is the one that IS exported, so it is imported
// rather than restated — a restatement of a type that can be imported is a
// second copy waiting to drift.
// ---------------------------------------------------------------------------

export type LocalUtilityServiceType =
  | 'electricity'
  | 'gas'
  | 'water'
  | 'sewer'
  | 'garbage'
  | 'other';

export type LocalBillingCycle = 'monthly' | 'bimonthly' | 'quarterly' | 'annual';

export type CreateLocalUtilityAccountInput = {
  providerId: string;
  accountNumber: string;
  serviceType: LocalUtilityServiceType;
  startDate?: string;
  billingCyclePreference?: LocalBillingCycle;
};

export type UpdateLocalUtilityAccountInput = {
  accountNumber?: string;
  isActive?: boolean;
  billingCyclePreference?: LocalBillingCycle;
};

export type CreateLocalUtilityBillInput = {
  accountId?: string;
  billType: LocalUtilityServiceType;
  provider?: string;
  accountNumber?: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  /** Integer cents. */
  amount: number;
  dueDate: string;
  paidDate?: string;
  /** Integer cents. */
  paidAmount?: number;
  usageQuantity?: number;
  usageUnit?: string;
  documentUrl?: string;
  aiExtractedData?: object;
  confidenceScore?: number;
};

export type CreateLocalUtilityBillOptions = {
  allowDuplicate?: boolean;
  deferPayTask?: boolean;
};

export type UpdateLocalUtilityBillInput = {
  billType?: LocalUtilityServiceType;
  provider?: string;
  accountNumber?: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
  amount?: number;
  dueDate?: string;
  paidDate?: string;
  paidAmount?: number;
  usageQuantity?: number;
  usageUnit?: string;
};

export type LocalUtilityBillFilters = {
  billType?: string;
  startDate?: string;
  endDate?: string;
  paid?: boolean;
  limit?: number;
};

export type UpdateLocalPropertyTaxInput = {
  assessedValue?: number;
  taxAmount?: number;
  advancePaymentPaidDate?: string;
  mainPaymentPaidDate?: string;
  homeownerGrantAppliedDate?: string;
  homeownerGrantStatus?: 'pending' | 'approved' | 'rejected';
};

export type CreateLocalBcAssessmentInput = {
  assessmentYear: number;
  propertyClass?: string;
  /** Integer cents. */
  assessedValue: number;
  landValue?: number;
  improvementValue?: number;
  previousYearValue?: number;
  changePercent?: number;
  assessmentPdfKey?: string;
  appealDeadline?: string;
};

export type UpdateLocalBcAssessmentInput = {
  propertyClass?: string;
  assessedValue?: number;
  landValue?: number;
  improvementValue?: number;
  previousYearValue?: number;
  changePercent?: number;
  appealDeadline?: string;
  appealFiled?: boolean;
};

export type LocalBillAnalyticsFilters = {
  startYear?: number;
  endYear?: number;
  utilityType?: string;
  providerKey?: ProviderKey;
};

/**
 * Ledger tables D1 cascades when a `utility_bills` row is deleted.
 *
 * One entry, and that is the finding rather than a placeholder: it is the ONLY
 * cascade in the whole of Wave C that a server delete actually fires (plan
 * §11.1.2, re-derived in this module's header). It is kept as a named list for
 * the reason `CONTRACTOR_CASCADE_TABLES` is — the set grows with the registry
 * and a missed entry is invisible, because an orphan is only noticed by a reader
 * that goes looking for its parent, and a ledger has no foreign key to complain
 * to. `localUtilitiesApi.test.ts` asserts this list against foreign keys parsed
 * out of the Drizzle schema, so adding a cascading table to D1 without adding it
 * here fails a unit test rather than quietly leaking rows.
 *
 * `tasks` is deliberately NOT in this list even though `deleteBill` also drops
 * the bill's pay task. That link is not a foreign key at all — `task_id` has no
 * `references()` in D1 — and folding it in would make the schema-derived guard
 * lie about the schema, which is the same reason `CONTRACTOR_TRANSITIVE_CASCADES`
 * is kept separate from the direct list.
 */
export const BILL_CASCADE_TABLES = [
  'utilityReminders',
] as const satisfies readonly HouseLedgerTableName[];

/** The column each cascaded table points back at the bill with. */
const BILL_CASCADE_COLUMNS: Record<(typeof BILL_CASCADE_TABLES)[number], string> = {
  utilityReminders: 'bill_id',
};

/**
 * Raised by `createBill` when a bill for the same billing month is already on
 * the ledger, carrying the axios-shaped `response` block that
 * `getDuplicateBill` in `src/api/utilities.ts` reads.
 *
 * Mimicking a transport error is not something to do casually, and it is right
 * here for one reason: `getDuplicateBill` is the EXISTING client helper that
 * `AddUtilityBillScreen` calls to decide between "that failed" and "you already
 * have this one — add anyway?". The Proxy's promise (§6) is that a screen cannot
 * tell which backend answered it, so the local duplicate has to arrive in the
 * shape the screen already knows how to read. The alternative — teaching
 * `getDuplicateBill` a second shape — would put local-first knowledge into a
 * module that has no other reason to have any.
 */
export class HouseLocalDuplicateBillError extends Error {
  readonly code = 'house_local_duplicate_bill';
  readonly response: {
    status: 409;
    data: { code: 'DUPLICATE_BILL'; existingBill: UtilityBill };
  };

  constructor(existingBill: UtilityBill) {
    super('A matching bill already exists for this period.');
    this.name = 'HouseLocalDuplicateBillError';
    this.response = {
      status: 409,
      data: { code: 'DUPLICATE_BILL', existingBill },
    };
  }
}

// ---------------------------------------------------------------------------
// Ported helpers — `utility-service.ts`, verbatim where the output is member
// visible. Formatting in particular must match: a pay-bill task's description is
// stored text, so a household that switches backends would otherwise end up with
// two spellings of the same reminder.
// ---------------------------------------------------------------------------

/** Cents → "$12.34" for the pay-bill task description (`utility-service.ts:74`). */
function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "2026-07-15" → "Jul 15, 2026" (`utility-service.ts:79`). */
function formatDueDateLabel(dueDate: string): string {
  const parsed = new Date(dueDate);
  return Number.isNaN(parsed.getTime())
    ? dueDate
    : parsed.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

/** "2026-06" → "June 2026" for the dashboard period header (`:37`). */
function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The calendar month before a `YYYY-MM` key (`:30`). */
function monthKeyMinusOne(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const previous = new Date(Date.UTC(year!, (month ?? 1) - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Cents → compact "$1.18M" / "$925K" / "$5,053" for stat tiles (`:88`). */
function formatMoneyShort(cents: number): string {
  const dollars = Math.round(cents / 100);
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? '-' : '';
  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000;
    return `${sign}$${millions.toFixed(abs % 1_000_000 === 0 ? 0 : 2)}M`;
  }
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}K`;
  return `${sign}$${abs.toLocaleString('en-US')}`;
}

/** Whole days until an ISO date, negative in the past; null on bad input (`:103`). */
function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.ceil((at - Date.now()) / 86_400_000);
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function normalizeProvider(provider?: string | null): string {
  return (provider || '').trim().toLowerCase();
}

/**
 * The MIDPOINT month a billing period belongs to (`utility-service.ts:53`).
 *
 * Duplicate detection is month-based rather than date-based because providers
 * issue irregular periods (Apr 9 – Jun 8) and an extraction can nudge a date by
 * a day between re-imports. Anchoring on the midpoint is what stops two
 * consecutive multi-month bills that share a boundary month (Apr–Jun, Jun–Aug)
 * from colliding — a naive "starts in the same month" check would reject the
 * second as a duplicate of the first.
 */
function anchorMonthIndex(start: string, end: string): number | null {
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (!Number.isNaN(from) && !Number.isNaN(to)) {
    const middle = new Date((from + to) / 2);
    return middle.getUTCFullYear() * 12 + middle.getUTCMonth();
  }
  const matched = /^(\d{4})-(\d{2})/.exec((start || end || '').trim());
  if (!matched) return null;
  return parseInt(matched[1]!, 10) * 12 + (parseInt(matched[2]!, 10) - 1);
}

/**
 * Reads and writes address the ACTIVE property — `engine.ts` holds one ledger
 * per property and `mutateLocalHouseLedger` writes to whichever is active (H5,
 * plan §7). Answering another property's id out of the active ledger would file
 * the cottage's hydro bill under the house, so the mismatch is raised.
 */
function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function accountsOf(householdId: string): LocalUtilityAccount[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalUtilityAccount>('utilityAccounts');
}

function billsOf(householdId: string): LocalUtilityBill[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalUtilityBill>('utilityBills');
}

function taxesOf(householdId: string): LocalPropertyTax[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalPropertyTax>('propertyTaxes');
}

function assessmentsOf(householdId: string): LocalBcAssessmentData[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalBcAssessmentData>('bcAssessmentData');
}

function requireAccount(householdId: string, accountId: string): LocalUtilityAccount {
  const found = accountsOf(householdId).find((row) => row.id === accountId);
  if (!found) throw new Error('Utility account not found');
  return found;
}

function requireBill(householdId: string, billId: string): LocalUtilityBill {
  const found = billsOf(householdId).find((row) => row.id === billId);
  if (!found) throw new Error('Utility bill not found');
  return found;
}

function requireTax(householdId: string, taxId: string): LocalPropertyTax {
  const found = taxesOf(householdId).find((row) => row.id === taxId);
  if (!found) throw new Error('Property tax not found');
  return found;
}

function requireAssessment(householdId: string, assessmentId: string): LocalBcAssessmentData {
  const found = assessmentsOf(householdId).find((row) => row.id === assessmentId);
  if (!found) throw new Error('BC Assessment not found');
  return found;
}

/**
 * A one-time reminder task, built the way `TaskService.createTask` builds one
 * from the four fields `utility-service.ts` supplies.
 *
 * Every other column is that service's own default — `source: 'manual'`,
 * `reminder_days_before: 1`, `reminder_time: '09:00'`, `reminder_repeat: true`,
 * `is_personal: false` — copied from `task-service.ts:236` rather than guessed,
 * so a task minted on device and one minted by the Worker are the same row.
 * `localContractorsApi.createReceiptReminderTask` builds the same shape for the
 * same reason.
 */
function reminderTask(
  householdId: string,
  input: { title: string; description: string; dueDate: string },
  timestamp: string,
): LocalTask {
  return {
    id: newLocalId('task'),
    household_id: householdId,
    title: input.title,
    description: input.description,
    system_category: null,
    frequency: 'one_time',
    custom_interval_days: null,
    next_due_date: input.dueDate,
    last_completed_at: null,
    assigned_to: null,
    space_id: null,
    is_active: true,
    source: 'manual',
    // The one field the caller overrides: a bill or a tax notice is a hard
    // deadline with a penalty behind it.
    priority_severity: 'high',
    time_effort: null,
    risk_level: null,
    complexity: null,
    ai_rationale: null,
    enrichment_status: null,
    clarification_question: null,
    purchase_suggestion: null,
    blocked: false,
    blocker_reason: null,
    blocked_at: null,
    blocked_by: null,
    reminder_enabled: true,
    reminder_days_before: 1,
    reminder_time: '09:00',
    reminder_repeat: true,
    needs_contractor: false,
    is_personal: false,
    created_by: getLocalHouseMemberId(),
    created_at: timestamp,
    updated_at: timestamp,
    photos: [],
    cover_photo_id: null,
    cover_photo_url: null,
  };
}

/** `payBillTaskTitle` — `utility-service.ts:135`. */
function payBillTitle(input: { provider?: string | null; billType: string }): string {
  return `Pay ${input.provider?.trim() || capitalize(input.billType)} bill`;
}

function payBillTask(
  householdId: string,
  input: { provider?: string | null; billType: string; amount: number; dueDate: string },
  timestamp: string,
): LocalTask {
  return reminderTask(
    householdId,
    {
      title: payBillTitle(input),
      description: `${formatDollars(input.amount)} due ${formatDueDateLabel(input.dueDate)}`,
      dueDate: input.dueDate,
    },
    timestamp,
  );
}

/** `createPropertyTaxPayTask` — `utility-service.ts:183`. */
function propertyTaxPayTask(
  householdId: string,
  input: { taxYear: number; municipalityName?: string | null; amount: number; dueDate: string },
  timestamp: string,
): LocalTask {
  const where = input.municipalityName?.trim() ? ` (${input.municipalityName.trim()})` : '';
  return reminderTask(
    householdId,
    {
      title: `Pay ${input.taxYear} property tax${where}`,
      description: `${formatDollars(input.amount)} due ${formatDueDateLabel(input.dueDate)}`,
      dueDate: input.dueDate,
    },
    timestamp,
  );
}

/** `createHomeownerGrantTask` — `utility-service.ts:201`. */
function homeownerGrantTask(
  householdId: string,
  input: { taxYear: number; grantAmount?: number | null; dueDate: string },
  timestamp: string,
): LocalTask {
  const savings =
    input.grantAmount && input.grantAmount > 0
      ? ` Saves up to ${formatDollars(input.grantAmount)}.`
      : '';
  return reminderTask(
    householdId,
    {
      title: `Claim ${input.taxYear} Home Owner Grant`,
      description: `Apply by ${formatDueDateLabel(
        input.dueDate,
      )} to avoid a penalty.${savings} Claim at gov.bc.ca/homeownergrant.`,
      dueDate: input.dueDate,
    },
    timestamp,
  );
}

/** Server order: `service_type` asc (`getUtilityAccounts`). */
function byServiceType(a: LocalUtilityAccount, b: LocalUtilityAccount): number {
  return a.service_type.localeCompare(b.service_type);
}

/** Server order: `due_date` desc (`getUtilityBills`). */
function byDueDateDesc(a: LocalUtilityBill, b: LocalUtilityBill): number {
  return b.due_date.localeCompare(a.due_date);
}

export const localUtilitiesApi = {
  // ---- accounts -----------------------------------------------------------

  /**
   * `POST /utilities/accounts` — `UtilityService.createUtilityAccount`.
   *
   * The Worker first resolves `providerId` against `utility_providers` and
   * raises `Utility provider not found`. That table is Tier C (plan §1.2) and is
   * not on the device, so the id is stored as given — the same position
   * `localGarbageApi` holds against the municipality catalogue. Nothing on the
   * utilities screens reads a provider record through an account: they render
   * `utility_bills.provider`, which is a plain text column on the bill.
   */
  createAccount: async (
    householdId: string,
    data: CreateLocalUtilityAccountInput,
  ): Promise<LocalUtilityAccount> => {
    requireActiveProperty(householdId);
    const timestamp = nowIso();
    // Random id: `utility_accounts` carries no `uniqueIndex` and no business
    // uniqueness. A household can genuinely hold two electricity accounts — a
    // house and a suite — and a deterministic id would merge them.
    const account: LocalUtilityAccount = {
      id: newLocalId('uac'),
      household_id: householdId,
      provider_id: data.providerId,
      account_number: data.accountNumber,
      service_type: data.serviceType,
      start_date: data.startDate || null,
      is_active: true,
      billing_cycle_preference: data.billingCyclePreference || null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await writeLocal(
      (draft) => {
        draft.utilityAccounts.push(account);
      },
      {
        opType: 'UTILITY_ACCOUNT_CREATE',
        entityType: 'utility_account',
        entityId: account.id,
        payload: account,
      },
    );
    return account;
  },

  /** `GET /utilities/accounts` — ACTIVE accounts only, the Worker's `where`. */
  getAccounts: async (householdId: string): Promise<LocalUtilityAccount[]> =>
    accountsOf(householdId)
      .filter((row) => row.is_active)
      .sort(byServiceType),

  updateAccount: async (
    householdId: string,
    accountId: string,
    data: UpdateLocalUtilityAccountInput,
  ): Promise<LocalUtilityAccount> => {
    requireAccount(householdId, accountId);
    await writeLocal(
      (draft) => {
        const account = draft.utilityAccounts.find(
          (row) => row.id === accountId && row.household_id === householdId,
        );
        if (!account) throw new Error('Utility account not found');
        // Absent means "leave it alone". Note `accountNumber` is NOT coalesced
        // to null here — `updateUtilityAccount` assigns it raw, so clearing the
        // field stores an empty string, and the column is notNull anyway.
        if (data.accountNumber !== undefined) account.account_number = data.accountNumber;
        if (data.isActive !== undefined) account.is_active = data.isActive;
        if (data.billingCyclePreference !== undefined) {
          account.billing_cycle_preference = data.billingCyclePreference;
        }
        account.updated_at = nowIso();
      },
      {
        opType: 'UTILITY_ACCOUNT_UPDATE',
        entityType: 'utility_account',
        entityId: accountId,
        payload: data,
      },
    );
    return requireAccount(householdId, accountId);
  },

  /**
   * `DELETE /utilities/accounts/:id` — a SOFT delete, and the reason this table
   * has no cascade at all.
   *
   * `deleteUtilityAccount` sets `is_active = false` rather than removing the row
   * (`utility-service.ts:384`), so D1 never fires a foreign key and the bills
   * filed against the account keep their history — which is the point: an
   * account closed in June must not take five years of hydro bills with it.
   * `utility_bills.account_id` is not declared `onDelete: 'cascade'` either, so
   * even a hard delete would leave them.
   *
   * The Worker also does NOT check that the account exists — it issues a bare
   * UPDATE — so an unknown id is a no-op rather than a 404. Mirrored, including
   * the asymmetry with `updateAccount` above, which does raise.
   */
  deleteAccount: async (householdId: string, accountId: string): Promise<void> => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const account = draft.utilityAccounts.find(
          (row) => row.id === accountId && row.household_id === householdId,
        );
        if (!account) return;
        account.is_active = false;
        account.updated_at = nowIso();
      },
      {
        opType: 'UTILITY_ACCOUNT_DEACTIVATE',
        entityType: 'utility_account',
        entityId: accountId,
        payload: { id: accountId },
      },
    );
  },

  // ---- bills --------------------------------------------------------------

  /**
   * `POST /utilities/bills` — `UtilityService.createUtilityBill`.
   *
   * Three things happen in ONE op: the bill, and — unless it arrives already
   * paid or the caller defers — its "Pay <provider> bill" task, plus the
   * back-pointer that links them. Two ops would let a peer hold a bill whose
   * task does not exist, and the paid-status sync below would then mint a
   * second one.
   *
   * `deferPayTask` is the batch-import path: those bills all arrive unpaid, but
   * the member has not yet said which are ALREADY paid — that happens on
   * `ConfirmBillPayments`, which calls `setBillsPaidStatus` and creates a task
   * only for the ones left unpaid. Creating tasks here too would double up.
   */
  createBill: async (
    householdId: string,
    data: CreateLocalUtilityBillInput,
    options?: CreateLocalUtilityBillOptions,
  ): Promise<LocalUtilityBill> => {
    requireActiveProperty(householdId);

    if (!options?.allowDuplicate) {
      const existing = findDuplicateBill(householdId, data);
      if (existing) throw new HouseLocalDuplicateBillError(existing);
    }

    const timestamp = nowIso();
    const task =
      data.paidDate || options?.deferPayTask
        ? null
        : payBillTask(
            householdId,
            {
              provider: data.provider,
              billType: data.billType,
              amount: data.amount,
              dueDate: data.dueDate,
            },
            timestamp,
          );

    const bill: LocalUtilityBill = {
      // Random id. `utility_bills` carries no `uniqueIndex`, and the duplicate
      // it WOULD need one for is caught above by month + provider/amount rather
      // than by an id — which is the honest model, because two bills for the
      // same month from the same provider are sometimes real (a corrected
      // re-issue), and the member is asked rather than merged.
      id: newLocalId('ubl'),
      household_id: householdId,
      account_id: data.accountId || null,
      bill_type: data.billType,
      provider: data.provider || null,
      account_number: data.accountNumber || null,
      billing_period_start: data.billingPeriodStart,
      billing_period_end: data.billingPeriodEnd,
      amount: data.amount,
      due_date: data.dueDate,
      paid_date: data.paidDate || null,
      paid_amount: data.paidAmount || null,
      usage_quantity: data.usageQuantity || null,
      usage_unit: data.usageUnit || null,
      document_url: data.documentUrl || null,
      // Stored as the JSON text D1 stores. Running the extraction is the throw
      // site; carrying what a previous run produced is not.
      ai_extracted_data: data.aiExtractedData ? JSON.stringify(data.aiExtractedData) : null,
      confidence_score: data.confidenceScore || null,
      task_id: task?.id ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        draft.utilityBills.push(bill);
        if (task) draft.tasks.push(task);
      },
      { opType: 'UTILITY_BILL_CREATE', entityType: 'utility_bill', entityId: bill.id, payload: bill },
    );
    return bill;
  },

  /**
   * `GET /utilities/bills`.
   *
   * The date bounds are asymmetric on the server and are mirrored: `startDate`
   * compares against `billing_period_start` and `endDate` against
   * `billing_period_end`, so a range returns bills whose period is CONTAINED by
   * it rather than bills that overlap it. Both are `text` columns holding
   * `YYYY-MM-DD`, which sorts lexically, so the comparison is a string one here
   * exactly as it is in SQL.
   */
  getBills: async (
    householdId: string,
    filters?: LocalUtilityBillFilters,
  ): Promise<LocalUtilityBill[]> =>
    billsOf(householdId)
      .filter((row) => (filters?.billType ? row.bill_type === filters.billType : true))
      .filter((row) =>
        filters?.startDate ? row.billing_period_start >= filters.startDate : true,
      )
      .filter((row) => (filters?.endDate ? row.billing_period_end <= filters.endDate : true))
      .filter((row) =>
        filters?.paid === undefined ? true : filters.paid ? !!row.paid_date : !row.paid_date,
      )
      .sort(byDueDateDesc)
      .slice(0, filters?.limit || 100),

  /**
   * `PATCH /utilities/bills/:id`.
   *
   * The interesting half is the paid-status flip, which the Worker keeps the
   * linked task in step with: marking a bill paid deletes its reminder and nulls
   * the pointer; reopening it as unpaid mints a fresh one from the bill's
   * CURRENT values, so a corrected amount or due date shows on the new task.
   * Both directions happen in the same op as the bill edit.
   */
  updateBill: async (
    householdId: string,
    billId: string,
    data: UpdateLocalUtilityBillInput,
  ): Promise<LocalUtilityBill> => {
    const existing = requireBill(householdId, billId);
    const timestamp = nowIso();

    const wasPaid = !!existing.paid_date;
    const willBePaid = !!data.paidDate;
    const reopening = data.paidDate !== undefined && !willBePaid && wasPaid;
    const settling = data.paidDate !== undefined && willBePaid && !wasPaid;
    const replacement = reopening
      ? payBillTask(
          householdId,
          {
            provider: (data.provider ?? existing.provider) as string | null,
            billType: data.billType ?? existing.bill_type,
            amount: data.amount ?? existing.amount,
            dueDate: data.dueDate ?? existing.due_date,
          },
          timestamp,
        )
      : null;

    await writeLocal(
      (draft) => {
        const bill = draft.utilityBills.find(
          (row) => row.id === billId && row.household_id === householdId,
        );
        if (!bill) throw new Error('Utility bill not found');

        // Absent means "leave it alone". `provider`, `accountNumber` and
        // `paidDate` coalesce an empty string to NULL because
        // `updateUtilityBill` does; `amount`, the dates and the usage fields do
        // not, because it does not.
        if (data.billType !== undefined) bill.bill_type = data.billType;
        if (data.provider !== undefined) bill.provider = data.provider || null;
        if (data.accountNumber !== undefined) bill.account_number = data.accountNumber || null;
        if (data.billingPeriodStart !== undefined) {
          bill.billing_period_start = data.billingPeriodStart;
        }
        if (data.billingPeriodEnd !== undefined) bill.billing_period_end = data.billingPeriodEnd;
        if (data.amount !== undefined) bill.amount = data.amount;
        if (data.dueDate !== undefined) bill.due_date = data.dueDate;
        if (data.paidDate !== undefined) bill.paid_date = data.paidDate || null;
        if (data.paidAmount !== undefined) bill.paid_amount = data.paidAmount;
        if (data.usageQuantity !== undefined) bill.usage_quantity = data.usageQuantity;
        if (data.usageUnit !== undefined) bill.usage_unit = data.usageUnit;
        bill.updated_at = timestamp;

        if (settling && existing.task_id) {
          draft.tasks = draft.tasks.filter((row) => row.id !== existing.task_id);
          bill.task_id = null;
        } else if (settling) {
          bill.task_id = null;
        } else if (replacement) {
          draft.tasks.push(replacement);
          bill.task_id = replacement.id;
        }
      },
      {
        opType: 'UTILITY_BILL_UPDATE',
        entityType: 'utility_bill',
        entityId: billId,
        payload: data,
      },
    );
    return requireBill(householdId, billId);
  },

  /**
   * `DELETE /utilities/bills/:id` — the bill, its reminders and its pay task, in
   * ONE op. **This is the only cascade in Wave C.**
   *
   * `utility_reminders.bill_id` references `utility_bills.id` with
   * `onDelete: 'cascade'` and `utility-service.ts:739` HARD-deletes the bill, so
   * the cascade genuinely fires server-side. On device a delete is a tombstone
   * rather than a foreign key: a reminder left behind is an orphan that syncs to
   * every peer and is never read again, and nothing fails, because an orphan has
   * nothing to complain to. B2 shipped exactly that bug at the contractor level.
   *
   * ONE op rather than three is the other half. `mutateLocalHouseLedger` diffs
   * the whole ledger per call, so separate writes would be separate ops a peer
   * applies one at a time — and between the first and the last that peer holds a
   * "Pay BC Hydro bill" task for a bill that no longer exists, which is a
   * reminder the member cannot dismiss by paying anything.
   *
   * The task is dropped for a second reason too: `deleteUtilityBill` deletes it
   * explicitly (`:735`) BEFORE the row goes, precisely because `task_id` is not
   * a foreign key and no cascade would reach it.
   */
  deleteBill: async (householdId: string, billId: string): Promise<void> => {
    requireActiveProperty(householdId);
    await writeLocal(
      (draft) => {
        const bill = draft.utilityBills.find(
          (row) => row.id === billId && row.household_id === householdId,
        );
        if (!bill) throw new Error('Utility bill not found');
        const taskId = bill.task_id;

        draft.utilityBills = draft.utilityBills.filter((row) => row.id !== billId);

        for (const table of BILL_CASCADE_TABLES) {
          const column = BILL_CASCADE_COLUMNS[table];
          const rows = draft[table] as unknown as Record<string, unknown>[];
          (draft[table] as unknown) = rows.filter((row) => row[column] !== billId);
        }

        // Not a cascade — `task_id` has no `references()` in D1 — but the same
        // obligation, and the Worker discharges it by hand for the same reason.
        if (taskId) draft.tasks = draft.tasks.filter((row) => row.id !== taskId);
      },
      {
        opType: 'UTILITY_BILL_DELETE',
        entityType: 'utility_bill',
        entityId: billId,
        payload: { id: billId },
      },
    );
  },

  /**
   * `PATCH /utilities/bills/paid-status` — the import-review screen's bulk
   * confirm, and the one multi-row write in this module.
   *
   * It is ONE op, not one per bill. `mutateLocalHouseLedger` diffs the whole
   * ledger per call, so a loop over twenty freshly-imported bills would be
   * twenty ops for what the member experienced as one tap — and a peer applying
   * them one at a time would render a half-confirmed import.
   *
   * Idempotent and self-healing, exactly as the Worker is: a paid bill loses any
   * lingering reminder task, an unpaid bill without one gets it back, marking
   * paid uses today's date and the bill's own amount, and ids that name another
   * household's bill are skipped rather than raised.
   */
  setBillsPaidStatus: async (
    householdId: string,
    updates: Array<{ billId: string; paid: boolean }>,
  ): Promise<LocalUtilityBill[]> => {
    requireActiveProperty(householdId);
    const timestamp = nowIso();
    const today = timestamp.split('T')[0]!;
    const touched: string[] = [];

    await writeLocal(
      (draft) => {
        for (const item of updates) {
          const bill = draft.utilityBills.find(
            (row) => row.id === item.billId && row.household_id === householdId,
          );
          if (!bill) continue;
          const isPaid = !!bill.paid_date;

          if (item.paid) {
            if (!isPaid) {
              bill.paid_date = today;
              bill.paid_amount = bill.amount;
            }
            if (bill.task_id) {
              const taskId = bill.task_id;
              draft.tasks = draft.tasks.filter((row) => row.id !== taskId);
              bill.task_id = null;
            }
          } else {
            if (isPaid) {
              bill.paid_date = null;
              bill.paid_amount = null;
            }
            if (!bill.task_id) {
              const task = payBillTask(
                householdId,
                {
                  provider: bill.provider,
                  billType: bill.bill_type,
                  amount: bill.amount,
                  dueDate: bill.due_date,
                },
                timestamp,
              );
              draft.tasks.push(task);
              bill.task_id = task.id;
            }
          }

          bill.updated_at = timestamp;
          touched.push(bill.id);
        }
      },
      {
        opType: 'UTILITY_BILLS_SET_PAID_STATUS',
        entityType: 'utility_bill',
        // The op addresses a SET of bills, so there is no single entity id. The
        // household is the honest answer, and it is what the projection needs to
        // scope the delta; the ids are in the payload for the audit trail.
        entityId: householdId,
        payload: { updates },
      },
    );

    const byId = new Map(billsOf(householdId).map((row) => [row.id, row]));
    return touched.map((id) => byId.get(id)!).filter(Boolean);
  },

  // ---- property taxes -----------------------------------------------------

  /**
   * `POST /utilities/property-taxes` — the notice, and up to two reminder tasks.
   *
   * The id is DETERMINISTIC, from `(household_id, tax_year)`:
   * `property_taxes_household_year_idx` is a real D1 `uniqueIndex` and one
   * notice per property per year is the whole point of the table. Two members
   * filing the same paper notice offline converge onto one row rather than
   * plotting 2026 twice on the year-over-year chart.
   *
   * A row for that year that is ALREADY on this device is a different case and
   * raises. A deterministic id merges writes that cannot see each other; when
   * the existing row is right there, pushing a second one with the same id would
   * put a duplicate in the array rather than merge anything, and the member has
   * the information to choose. `AddPropertyTaxScreen` already handles this path
   * — the upload response carries `duplicate` and `existingTax`.
   *
   * The grant arithmetic is the Worker's: when the notice is grant-eligible AND
   * the member claims it now, the grant comes off `main_payment_amount` so the
   * amount owed (and the pay task, and the penalty math) reflects what is due
   * AFTER the grant, while `tax_amount` keeps the gross "No Grant" levy for
   * history. Getting that backwards would show the member the wrong number to
   * pay.
   */
  createPropertyTax: async (
    householdId: string,
    data: CreatePropertyTaxRequest,
  ): Promise<LocalPropertyTax> => {
    requireActiveProperty(householdId);
    const clash = taxesOf(householdId).find((row) => row.tax_year === data.taxYear);
    if (clash) throw new Error('A property tax record already exists for this year');

    const timestamp = nowIso();
    const today = timestamp.split('T')[0]!;
    const isPaid = !!data.mainPaymentPaidDate;
    const grantApplied = !!data.homeownerGrantApplied && !!data.homeownerGrantEligible;
    const grantCents = data.homeownerGrantAmount || 0;
    const netMainPayment = grantApplied
      ? Math.max(0, data.mainPaymentAmount - grantCents)
      : data.mainPaymentAmount;

    // Unpaid notices get reminders: the grant task FIRST (claiming it lowers
    // what is owed), then the pay task. Both due on the main due date. The grant
    // nudge is skipped when the member has already applied it — there is nothing
    // left to claim.
    const grantTask =
      !isPaid && data.homeownerGrantEligible && !grantApplied
        ? homeownerGrantTask(
            householdId,
            {
              taxYear: data.taxYear,
              grantAmount: data.homeownerGrantAmount,
              dueDate: data.mainPaymentDueDate,
            },
            timestamp,
          )
        : null;
    const payTask = !isPaid
      ? propertyTaxPayTask(
          householdId,
          {
            taxYear: data.taxYear,
            municipalityName: data.municipalityName,
            amount: netMainPayment,
            dueDate: data.mainPaymentDueDate,
          },
          timestamp,
        )
      : null;

    const tax: LocalPropertyTax = {
      id: houseDeterministicIds.propertyTax(householdId, data.taxYear),
      household_id: householdId,
      tax_year: data.taxYear,
      assessed_value: data.assessedValue,
      tax_amount: data.taxAmount,
      advance_payment_amount: data.advancePaymentAmount || null,
      advance_payment_due_date: data.advancePaymentDueDate || null,
      advance_payment_paid_date: null,
      main_payment_amount: netMainPayment,
      main_payment_due_date: data.mainPaymentDueDate,
      main_payment_paid_date: data.mainPaymentPaidDate || null,
      homeowner_grant_eligible: data.homeownerGrantEligible || false,
      homeowner_grant_amount: data.homeownerGrantAmount || null,
      homeowner_grant_applied_date: grantApplied ? today : null,
      homeowner_grant_status: grantApplied ? 'pending' : null,
      // No penalties at create time on either backend, and none can be computed
      // here later — see the module header.
      penalties: null,
      document_url: data.documentUrl || null,
      main_payment_task_id: payTask?.id ?? null,
      grant_task_id: grantTask?.id ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        draft.propertyTaxes.push(tax);
        if (grantTask) draft.tasks.push(grantTask);
        if (payTask) draft.tasks.push(payTask);
      },
      {
        opType: 'PROPERTY_TAX_CREATE',
        entityType: 'property_tax',
        entityId: tax.id,
        payload: tax,
      },
    );
    return tax;
  },

  /** `GET /utilities/property-taxes` — newest year first. */
  getPropertyTaxes: async (householdId: string): Promise<LocalPropertyTax[]> =>
    [...taxesOf(householdId)].sort((a, b) => b.tax_year - a.tax_year),

  /**
   * `GET /utilities/property-taxes/:year`.
   *
   * The route answers 404 for a year with no notice and the client's return type
   * is a non-nullable `PropertyTax`, so a miss raises rather than resolving to
   * null — the two must not look alike to a caller that only checks truthiness.
   */
  getPropertyTaxByYear: async (
    householdId: string,
    year: number,
  ): Promise<LocalPropertyTax> => {
    const found = taxesOf(householdId).find((row) => row.tax_year === year);
    if (!found) throw new Error('Property tax not found');
    return found;
  },

  /**
   * `PATCH /utilities/property-taxes/:id`.
   *
   * Recording payment clears the "Pay property tax" task; recording the grant as
   * applied — or approved — clears the "Claim Home Owner Grant" task. Both in
   * the same op as the edit, so a peer never holds a task the notice no longer
   * points at.
   *
   * Penalties are NOT recomputed, and that is the server's own behaviour rather
   * than a gap: `calculatePropertyTaxPenalties` returns `[]` without a
   * municipality config, the catalogue is Tier C and not on device, and the
   * Worker takes the same empty branch for any property outside the Greater
   * Vancouver configs.
   */
  updatePropertyTax: async (
    householdId: string,
    taxId: string,
    data: UpdateLocalPropertyTaxInput,
  ): Promise<LocalPropertyTax> => {
    const existing = requireTax(householdId, taxId);
    const settling = !!data.mainPaymentPaidDate;
    const grantResolved =
      data.homeownerGrantAppliedDate !== undefined || data.homeownerGrantStatus === 'approved';

    await writeLocal(
      (draft) => {
        const tax = draft.propertyTaxes.find(
          (row) => row.id === taxId && row.household_id === householdId,
        );
        if (!tax) throw new Error('Property tax not found');

        if (data.assessedValue !== undefined) tax.assessed_value = data.assessedValue;
        if (data.taxAmount !== undefined) tax.tax_amount = data.taxAmount;
        if (data.advancePaymentPaidDate !== undefined) {
          tax.advance_payment_paid_date = data.advancePaymentPaidDate;
        }
        if (data.mainPaymentPaidDate !== undefined) {
          tax.main_payment_paid_date = data.mainPaymentPaidDate;
        }
        if (data.homeownerGrantAppliedDate !== undefined) {
          tax.homeowner_grant_applied_date = data.homeownerGrantAppliedDate;
        }
        if (data.homeownerGrantStatus !== undefined) {
          tax.homeowner_grant_status = data.homeownerGrantStatus;
        }
        tax.updated_at = nowIso();

        if (settling && existing.main_payment_task_id) {
          const taskId = existing.main_payment_task_id;
          draft.tasks = draft.tasks.filter((row) => row.id !== taskId);
        }
        if (settling) tax.main_payment_task_id = null;

        if (grantResolved && existing.grant_task_id) {
          const taskId = existing.grant_task_id;
          draft.tasks = draft.tasks.filter((row) => row.id !== taskId);
        }
        if (grantResolved) tax.grant_task_id = null;
      },
      {
        opType: 'PROPERTY_TAX_UPDATE',
        entityType: 'property_tax',
        entityId: taxId,
        payload: data,
      },
    );
    return requireTax(householdId, taxId);
  },

  /**
   * `POST /utilities/property-taxes/upload` — H6 + P4, and off.
   *
   * The bytes have to reach R2 and a model has to read the notice. Under E2EE
   * the Worker holds ciphertext, and the device holds no model. Present as a
   * throw rather than declared remote-only, because a missing key would route to
   * a Worker that would accept the PDF and file the resulting record into a
   * household whose rows live somewhere else entirely.
   */
  uploadAndExtractPropertyTax: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('utilitiesApi.uploadAndExtractPropertyTax');
  },

  // ---- BC Assessment ------------------------------------------------------

  /**
   * `POST /utilities/bc-assessment`. Deterministic id from
   * `(household_id, assessment_year)` — `bc_assessment_data_household_year_idx`,
   * one assessment per property per year, same argument as the tax notice.
   */
  createBCAssessment: async (
    householdId: string,
    data: CreateLocalBcAssessmentInput,
  ): Promise<LocalBcAssessmentData> => {
    requireActiveProperty(householdId);
    const clash = assessmentsOf(householdId).find(
      (row) => row.assessment_year === data.assessmentYear,
    );
    if (clash) throw new Error('A BC Assessment record already exists for this year');

    const timestamp = nowIso();
    const assessment: LocalBcAssessmentData = {
      id: houseDeterministicIds.bcAssessment(householdId, data.assessmentYear),
      household_id: householdId,
      assessment_year: data.assessmentYear,
      property_class: data.propertyClass || null,
      assessed_value: data.assessedValue,
      land_value: data.landValue || null,
      improvement_value: data.improvementValue || null,
      previous_year_value: data.previousYearValue || null,
      change_percent: data.changePercent || null,
      // Names an object in the H6 blob channel; the bytes never enter the ledger.
      assessment_pdf_key: data.assessmentPdfKey || null,
      appeal_deadline: data.appealDeadline || null,
      appeal_filed: false,
      created_at: timestamp,
      updated_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        draft.bcAssessmentData.push(assessment);
      },
      {
        opType: 'BC_ASSESSMENT_CREATE',
        entityType: 'bc_assessment',
        entityId: assessment.id,
        payload: assessment,
      },
    );
    return assessment;
  },

  /** `GET /utilities/bc-assessment` — newest year first. */
  getBCAssessments: async (householdId: string): Promise<LocalBcAssessmentData[]> =>
    [...assessmentsOf(householdId)].sort((a, b) => b.assessment_year - a.assessment_year),

  updateBCAssessment: async (
    householdId: string,
    assessmentId: string,
    data: UpdateLocalBcAssessmentInput,
  ): Promise<LocalBcAssessmentData> => {
    requireAssessment(householdId, assessmentId);
    await writeLocal(
      (draft) => {
        const assessment = draft.bcAssessmentData.find(
          (row) => row.id === assessmentId && row.household_id === householdId,
        );
        if (!assessment) throw new Error('BC Assessment not found');
        if (data.propertyClass !== undefined) assessment.property_class = data.propertyClass;
        if (data.assessedValue !== undefined) assessment.assessed_value = data.assessedValue;
        if (data.landValue !== undefined) assessment.land_value = data.landValue;
        if (data.improvementValue !== undefined) {
          assessment.improvement_value = data.improvementValue;
        }
        if (data.previousYearValue !== undefined) {
          assessment.previous_year_value = data.previousYearValue;
        }
        if (data.changePercent !== undefined) assessment.change_percent = data.changePercent;
        if (data.appealDeadline !== undefined) assessment.appeal_deadline = data.appealDeadline;
        if (data.appealFiled !== undefined) assessment.appeal_filed = data.appealFiled;
        assessment.updated_at = nowIso();
      },
      {
        opType: 'BC_ASSESSMENT_UPDATE',
        entityType: 'bc_assessment',
        entityId: assessmentId,
        payload: data,
      },
    );
    return requireAssessment(householdId, assessmentId);
  },

  /** `POST /utilities/bc-assessment/upload` — H6 + P4, exactly as the tax one. */
  uploadAndExtractAssessment: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('utilitiesApi.uploadAndExtractAssessment');
  },

  // ---- composed reads -----------------------------------------------------

  /**
   * `GET /utilities/property-overview` — `UtilityService.getPropertyInsights`.
   *
   * Server-COMPUTED, not server-stored: every tile, series and card is arithmetic
   * over `bc_assessment_data` and `property_taxes`, both of which are now on the
   * device. Nothing here is derived and then persisted, so there is no aggregate
   * to converge wrongly under per-field LWW — the whole payload is rebuilt on
   * every read, which is rule 1 in `types.ts` applied to a response rather than
   * to a row.
   *
   * Both series are ASCENDING by year, which is the opposite of the two list
   * reads above; the charts plot left to right and the "latest" values are read
   * off the end. Copying the descending order from `getPropertyTaxes` would draw
   * every chart backwards.
   */
  getPropertyInsights: async (householdId: string): Promise<PropertyInsights> => {
    const assessments = [...assessmentsOf(householdId)].sort(
      (a, b) => a.assessment_year - b.assessment_year,
    );
    const taxes = [...taxesOf(householdId)].sort((a, b) => a.tax_year - b.tax_year);

    const assessmentHistory = assessments.map((row) => ({
      year: row.assessment_year,
      assessedValue: row.assessed_value,
      landValue: row.land_value,
      improvementValue: row.improvement_value,
      changePercent: row.change_percent,
    }));
    const latestAssessment = assessments.length ? assessments[assessments.length - 1]! : null;

    let assessmentYoy: { changeCents: number; changePercent: number } | null = null;
    if (latestAssessment) {
      // The notice's OWN `previous_year_value` wins over the previous row: a
      // backfilled history can be incomplete, and the number printed on the
      // notice is the one the member is looking at.
      const previous =
        latestAssessment.previous_year_value ??
        (assessments.length > 1 ? assessments[assessments.length - 2]!.assessed_value : null);
      if (previous != null && previous > 0) {
        const changeCents = latestAssessment.assessed_value - previous;
        assessmentYoy = {
          changeCents,
          changePercent:
            latestAssessment.change_percent ?? Math.round((changeCents / previous) * 1000) / 10,
        };
      }
    }
    const landVsBuilding =
      latestAssessment &&
      latestAssessment.land_value != null &&
      latestAssessment.improvement_value != null
        ? {
            landValue: latestAssessment.land_value,
            improvementValue: latestAssessment.improvement_value,
          }
        : null;

    const taxHistory = taxes.map((row) => ({
      year: row.tax_year,
      taxAmount: row.tax_amount,
      assessedValue: row.assessed_value,
      paid: !!row.main_payment_paid_date,
      dueDate: row.main_payment_due_date,
    }));
    const latestTax = taxes.length ? taxes[taxes.length - 1]! : null;

    let taxYoy: { changeCents: number; changePercent: number } | null = null;
    if (taxes.length > 1) {
      const previous = taxes[taxes.length - 2]!.tax_amount;
      const current = taxes[taxes.length - 1]!.tax_amount;
      if (previous > 0) {
        const changeCents = current - previous;
        taxYoy = { changeCents, changePercent: Math.round((changeCents / previous) * 1000) / 10 };
      }
    }

    // The most RECENT unpaid notice, not the oldest — the member's next payment.
    const unpaid = [...taxes].reverse().find((row) => !row.main_payment_paid_date) || null;
    const nextDue = unpaid
      ? {
          year: unpaid.tax_year,
          amount: unpaid.main_payment_amount,
          dueDate: unpaid.main_payment_due_date,
          paid: false,
          grantEligible: unpaid.homeowner_grant_eligible,
          grantApplied: !!unpaid.homeowner_grant_applied_date,
        }
      : null;

    const stats: PropertyInsights['stats'] = [];
    if (latestAssessment) {
      const yoyLabel = assessmentYoy
        ? ` · ${assessmentYoy.changePercent >= 0 ? '+' : ''}${assessmentYoy.changePercent}% YoY`
        : '';
      stats.push({
        id: 'assessed_value',
        label: 'Assessed value',
        value: formatMoneyShort(latestAssessment.assessed_value),
        subtitle: `${latestAssessment.assessment_year}${yoyLabel}`,
        tone: assessmentYoy && assessmentYoy.changePercent >= 10 ? 'warning' : 'default',
      });
    }
    if (latestTax) {
      stats.push({
        id: 'latest_tax',
        label: 'Property tax',
        value: formatMoneyShort(latestTax.tax_amount),
        subtitle: `${latestTax.tax_year}`,
        tone: 'default',
      });
    }
    if (nextDue) {
      const days = daysUntil(nextDue.dueDate);
      stats.push({
        id: 'next_due',
        label: 'Next payment',
        value: formatMoneyShort(nextDue.amount),
        subtitle: `Due ${formatDueDateLabel(nextDue.dueDate)}`,
        tone: days != null && days <= 60 ? 'warning' : 'default',
      });
    }
    if (latestTax && latestTax.assessed_value > 0) {
      const rate = (latestTax.tax_amount / latestTax.assessed_value) * 100;
      stats.push({
        id: 'effective_rate',
        label: 'Effective rate',
        value: `${rate.toFixed(2)}%`,
        subtitle: 'of assessed value',
        tone: 'default',
      });
    }

    const insights: PropertyInsights['insights'] = [];
    if (assessmentYoy && latestAssessment) {
      const up = assessmentYoy.changePercent >= 0;
      insights.push({
        id: 'assessment_change',
        severity: up && assessmentYoy.changePercent >= 10 ? 'warning' : 'info',
        title: `Assessed value ${up ? 'up' : 'down'} ${Math.abs(assessmentYoy.changePercent)}%`,
        body: `Your ${latestAssessment.assessment_year} assessment ${
          up ? 'rose' : 'fell'
        } ${formatMoneyShort(Math.abs(assessmentYoy.changeCents))} from the prior year${
          up && assessmentYoy.changePercent >= 10
            ? ' — a large jump may be worth appealing.'
            : '.'
        }`,
      });
    }
    if (latestAssessment?.appeal_deadline && !latestAssessment.appeal_filed) {
      const days = daysUntil(latestAssessment.appeal_deadline);
      if (days != null && days >= 0 && days <= 45) {
        insights.push({
          id: 'appeal_deadline',
          severity: 'warning',
          title: 'Assessment appeal window closing',
          body: `If you think your ${
            latestAssessment.assessment_year
          } assessment is too high, file a Notice of Complaint by ${formatDueDateLabel(
            latestAssessment.appeal_deadline,
          )}.`,
        });
      }
    }
    if (landVsBuilding) {
      const total = landVsBuilding.landValue + landVsBuilding.improvementValue;
      if (total > 0) {
        const landPct = Math.round((landVsBuilding.landValue / total) * 100);
        insights.push({
          id: 'land_split',
          severity: 'info',
          title: `Land is ${landPct}% of your value`,
          body: `Of your assessed value, ${formatMoneyShort(
            landVsBuilding.landValue,
          )} is land and ${formatMoneyShort(landVsBuilding.improvementValue)} is buildings.`,
        });
      }
    }
    if (taxYoy) {
      const up = taxYoy.changeCents >= 0;
      insights.push({
        id: 'tax_change',
        severity: up && taxYoy.changePercent >= 8 ? 'warning' : 'info',
        title: `Property tax ${up ? 'up' : 'down'} ${formatMoneyShort(
          Math.abs(taxYoy.changeCents),
        )}`,
        body: `Your property tax ${up ? 'increased' : 'decreased'} ${Math.abs(
          taxYoy.changePercent,
        )}% versus the prior year.`,
      });
    }
    if (nextDue) {
      const days = daysUntil(nextDue.dueDate);
      if (days != null && days >= 0 && days <= 60) {
        insights.push({
          id: 'tax_due_soon',
          severity: 'warning',
          title: 'Property tax due soon',
          body: `${formatMoneyShort(nextDue.amount)} is due ${formatDueDateLabel(
            nextDue.dueDate,
          )}${days <= 14 ? ` — only ${days} day${days === 1 ? '' : 's'} left.` : '.'}`,
        });
      }
      if (nextDue.grantEligible && !nextDue.grantApplied) {
        insights.push({
          id: 'grant_available',
          severity: 'positive',
          title: 'Claim your Home Owner Grant',
          body: `This property is eligible for the BC Home Owner Grant — claim it to reduce what you owe on your ${nextDue.year} taxes.`,
        });
      }
    }

    return {
      hasData: assessments.length > 0 || taxes.length > 0,
      assessment: {
        latest: latestAssessment,
        history: assessmentHistory,
        yoy: assessmentYoy,
        landVsBuilding,
      },
      propertyTax: { latest: latestTax, history: taxHistory, yoy: taxYoy, nextDue },
      stats,
      insights,
    };
  },

  /**
   * `GET /utilities/dashboard` — `UtilityService.getDashboardOverview`.
   *
   * Every headline number comes from the SAME prorated monthly series that
   * drives the charts (`logic/billAnalytics.ts`), with no separate ad-hoc month
   * arithmetic that could disagree with it. That was a real bug on the server —
   * the hero read "$0.00" while the provider cards showed "$70/mo" — and the fix
   * was to make one series the source of truth. Reproducing the shortcut here
   * would reintroduce it on device only.
   *
   * The reference month is the same subtlety: the literal current month is often
   * empty, because bills are logged after their period ends, so the summary falls
   * back to the most recent month with activity and TELLS the client which month
   * that is (`periodMonthKey` / `periodLabel` / `periodIsCurrent`). The screen
   * renders "June 2026" instead of a hardcoded "This month".
   *
   * `municipality` is `null` here, and it is the one field this method cannot
   * answer. It comes from `municipality_configs`, which is Tier C and not on the
   * device, and the server derives it from the property's address, which a
   * local-first household keeps in its ledger rather than in D1 — so neither side
   * can answer alone. `null` is a first-class value of the field's declared type
   * (`MunicipalityConfig | null`), it is what the Worker returns for any address
   * outside the Greater Vancouver configs, and every screen already renders it.
   * A screen that specifically needs the config can still call `getMunicipality`,
   * which stays remote for exactly this reason.
   */
  getDashboard: async (householdId: string): Promise<DashboardOverview> => {
    const bills = billsOf(householdId);
    const now = new Date();
    const currentYear = now.getFullYear();
    const today = now.toISOString().split('T')[0]!;
    const thirtyDaysOut = new Date(now.getTime() + 30 * 86_400_000).toISOString().split('T')[0]!;

    const upcomingBills = bills
      .filter((row) => !row.paid_date)
      .filter((row) => row.due_date >= today && row.due_date <= thirtyDaysOut)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .slice(0, 10);

    const analytics = buildBillAnalytics(bills, {
      startYear: currentYear - 1,
      endYear: currentYear,
    });
    const monthly = analytics.monthlyData;
    const currentMonthKey = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const latestActiveKey = monthly.length > 0 ? monthly[monthly.length - 1]!.month : null;
    const referenceMonthKey =
      latestActiveKey === null || monthly.some((row) => row.month === currentMonthKey)
        ? currentMonthKey
        : latestActiveKey;
    const previousMonthKey = monthKeyMinusOne(referenceMonthKey);

    const referenceRow = monthly.find((row) => row.month === referenceMonthKey);
    const currentMonthTotal = referenceRow?.total ?? 0;
    const prevMonthTotal = monthly.find((row) => row.month === previousMonthKey)?.total ?? 0;
    const periodIsCurrent = referenceMonthKey === currentMonthKey;

    return {
      upcomingBills,
      currentMonthTotal,
      prevMonthTotal,
      change: currentMonthTotal - prevMonthTotal,
      changePercent:
        prevMonthTotal > 0 ? ((currentMonthTotal - prevMonthTotal) / prevMonthTotal) * 100 : 0,
      currentMonthByType: {
        electricity: referenceRow?.byType.electricity ?? 0,
        gas: referenceRow?.byType.gas ?? 0,
        water: referenceRow?.byType.water ?? 0,
      },
      periodMonthKey: referenceMonthKey,
      periodLabel: periodIsCurrent ? 'This month' : formatMonthLabel(referenceMonthKey),
      periodIsCurrent,
      byProvider: analytics.byProvider,
      insights: analytics.insights,
      municipality: null,
    };
  },

  /**
   * `GET /utilities/analytics` — the charts screen.
   *
   * `yearOverYear.count` counts MONTHS with activity, not bills. That reads like
   * a bug and is the server's contract, and the charts label it "months of
   * data"; counting bills instead would double the number for a household that
   * files two utilities.
   */
  getAnalytics: async (
    householdId: string,
    filters?: LocalBillAnalyticsFilters,
  ): Promise<BillAnalytics> => {
    const analytics = buildBillAnalytics(billsOf(householdId), filters);
    const endYear = filters?.endYear || new Date().getFullYear();
    const currentYearMonths = analytics.monthlyData.filter((row) =>
      row.month.startsWith(String(endYear)),
    );
    const previousYearMonths = analytics.monthlyData.filter((row) =>
      row.month.startsWith(String(endYear - 1)),
    );
    const currentYearTotal = currentYearMonths.reduce((sum, row) => sum + row.total, 0);
    const previousYearTotal = previousYearMonths.reduce((sum, row) => sum + row.total, 0);

    return {
      ...analytics,
      yearOverYear: {
        currentYear: { year: endYear, total: currentYearTotal, count: currentYearMonths.length },
        previousYear: {
          year: endYear - 1,
          total: previousYearTotal,
          count: previousYearMonths.length,
        },
        change: currentYearTotal - previousYearTotal,
        changePercent:
          previousYearTotal > 0
            ? ((currentYearTotal - previousYearTotal) / previousYearTotal) * 100
            : 0,
      },
    };
  },

  // ---- extraction: H6 + P4, all four off ----------------------------------

  /**
   * `POST /utilities/bills/upload` — the feature this whole screen is built
   * around, and the one thing on it that cannot work offline.
   *
   * It uploads a PDF to R2 and runs a vision model over it. Both halves need a
   * server that can see the document, and under E2EE it cannot. Note what is NOT
   * off: every field the extraction would have filled in is editable by hand, and
   * a bill entered that way is byte-identical to an extracted one.
   */
  uploadAndExtractBill: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('utilitiesApi.uploadAndExtractBill');
  },

  /**
   * `POST /utilities/bills/extract` — re-runs the model over a document already
   * in R2. Same limit as the upload, one step later.
   */
  extractBillFromDocument: async (): Promise<never> => {
    throw new HouseLocalUnsupportedError('utilitiesApi.extractBillFromDocument');
  },
};

/**
 * `UtilityService.findDuplicateBill` (`utility-service.ts:394`), local.
 *
 * Matches when the anchor MONTH is identical and either the provider or the
 * exact amount lines up. Both halves earn their place: the provider match
 * catches a corrected re-issue whose amount changed, and the amount match
 * catches a bill whose provider the extraction could not read. Requiring both
 * would let the same bill in twice; requiring neither would reject a genuine
 * second bill from a different utility in the same month.
 */
function findDuplicateBill(
  householdId: string,
  input: {
    billType: string;
    provider?: string;
    billingPeriodStart: string;
    billingPeriodEnd: string;
    amount: number;
  },
): LocalUtilityBill | null {
  const inputMonth = anchorMonthIndex(input.billingPeriodStart, input.billingPeriodEnd);
  if (inputMonth === null) return null;
  const inputProvider = normalizeProvider(input.provider);

  for (const candidate of billsOf(householdId)) {
    if (candidate.bill_type !== input.billType) continue;
    const candidateMonth = anchorMonthIndex(
      candidate.billing_period_start,
      candidate.billing_period_end,
    );
    if (candidateMonth !== inputMonth) continue;

    const providerMatch =
      !!inputProvider && inputProvider === normalizeProvider(candidate.provider);
    if (providerMatch || candidate.amount === input.amount) return candidate;
  }
  return null;
}
