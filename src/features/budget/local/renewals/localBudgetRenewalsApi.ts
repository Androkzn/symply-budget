import type {
  BudgetRenewal,
  BudgetRenewalDocument,
  UpsertRenewalRequest,
} from '@api/budgetRenewals';

import type { LocalBudgetLedger, LocalBudgetRenewal } from '../engine';
import { getLocalLedgerFor, mutateLocalLedger, runOnHousehold } from '../engine';
import { BudgetLocalUnsupportedError } from '../errors';
import { isoNow, newLocalId } from '../ids';

/** Default cycle step when advancing offline — metadata rows omit cycle fields. */
const MARK_RENEWED_MONTHS = 12;

/*
 * Renewal WRITES run through the engine's `runOnHousehold(id, work)`, which
 * activates the named household first (BR-016 B5).
 *
 * `mutateLocalLedger` is bound to the ACTIVE session by design — the engine
 * deliberately gave it no `forHouseholdId` — so a call naming another household
 * has exactly two honest outcomes: move the session, or refuse. Writing anyway
 * would file household B's renewal in household A's ledger, sealed correctly
 * under A's HDK and therefore invisible to every integrity check the engine has.
 * A renewal row also drives a reminder date, so the misfiled row would surface
 * as a notification to A's members about a policy that is not theirs.
 *
 * It replaced `assertHousehold`, which threw on every such call. That was the
 * right answer while a device could hold only one household and became a wall
 * the moment it could hold two: anything naming a non-active household died with
 * "Renewal household mismatch for local ledger" rather than doing the obvious
 * thing. Activating is what the member meant — they addressed that household.
 * The refusal half survives inside `runOnHousehold`, which raises
 * `BudgetLocalUnknownHouseholdError` for an id this device holds no ledger for.
 *
 * It also replaced this file's private copy of the helper, which activated on the
 * engine's session chain but ran the write off it — one of seven such copies, so
 * even a per-file queue would have missed the sibling facades writing the same
 * ledger. The lock belongs where the ledger is.
 *
 * READS deliberately do NOT come through it — they take
 * `getLocalLedgerFor(householdId)`, which hydrates that household on demand and
 * answers from its own rows without moving the session.
 */

/**
 * Every lookup takes the ledger it is to read rather than reaching for the
 * active one. Under a single household those were the same object; under BR-016
 * they are not, and a helper that quietly read the active ledger would answer a
 * background household's question with the wrong household's rows — the exact
 * bleed the `household_id` filter below only *looks* like it prevents.
 */
function findRenewal(
  source: LocalBudgetLedger,
  householdId: string,
  recurringPaymentId: string,
): LocalBudgetRenewal | null {
  return (
    (source.budgetRenewals ?? []).find(
      (row) =>
        row.household_id === householdId && row.recurring_payment_id === recurringPaymentId,
    ) ?? null
  );
}

function requireRecurringPayment(
  source: LocalBudgetLedger,
  householdId: string,
  recurringPaymentId: string,
) {
  const payment = (source.savingsRecurringPayments ?? []).find(
    (row) => row.id === recurringPaymentId && row.household_id === householdId,
  );
  if (!payment) throw new Error('Monthly payment not found');
  return payment;
}

/**
 * Add `months` to a `YYYY-MM-DD` date, clamping to the target month's last day
 * (Jan 31 + 1mo → Feb 28) — mirrors `budget-renewal-service.ts`.
 */
function addMonthsClamped(dateStr: string, months: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  const month0 = Number(match[2]) - 1;
  const day = Number(match[3]);
  const targetMonth0 = month0 + months;
  const lastDayOfTarget = new Date(Date.UTC(year, targetMonth0 + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDayOfTarget);
  return new Date(Date.UTC(year, targetMonth0, targetDay)).toISOString().slice(0, 10);
}

/**
 * Project stored metadata into the remote `BudgetRenewal` envelope.
 *
 * Takes the ledger for the `created_by` fallback rather than calling
 * `getLocalLedger().memberId`, which answers for whichever household is active.
 * Stamping a renewal with the active household's member id while describing a
 * background household's row is a provenance lie no later read can detect — and
 * `get` is exactly the call a background refetch makes.
 */
function toBudgetRenewal(
  source: LocalBudgetLedger,
  row: LocalBudgetRenewal,
  extras: Partial<BudgetRenewal> = {},
): BudgetRenewal {
  return {
    id: row.id,
    household_id: row.household_id,
    recurring_payment_id: row.recurring_payment_id,
    category: extras.category ?? 'other',
    provider: extras.provider ?? null,
    reference_number: extras.reference_number ?? null,
    cycle: extras.cycle ?? 'annual',
    cycle_months: extras.cycle_months ?? null,
    next_renewal_date: row.next_renewal_date,
    renewal_amount_cents: extras.renewal_amount_cents ?? null,
    auto_renew: extras.auto_renew ?? false,
    reminder_lead_days: row.reminder_lead_days,
    status: row.status,
    notes: extras.notes ?? null,
    last_renewed_at: extras.last_renewed_at ?? null,
    renewal_count: extras.renewal_count ?? 0,
    created_by: extras.created_by ?? source.memberId,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function upsertExtrasFromRequest(
  input: UpsertRenewalRequest,
  existing: Partial<BudgetRenewal> = {},
): Partial<BudgetRenewal> {
  return {
    category: input.category ?? existing.category,
    provider: input.provider !== undefined ? input.provider : existing.provider,
    reference_number:
      input.reference_number !== undefined ? input.reference_number : existing.reference_number,
    cycle: input.cycle ?? existing.cycle,
    cycle_months: input.cycle_months !== undefined ? input.cycle_months : existing.cycle_months,
    renewal_amount_cents:
      input.renewal_amount_cents !== undefined
        ? input.renewal_amount_cents
        : existing.renewal_amount_cents,
    auto_renew: input.auto_renew ?? existing.auto_renew,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  };
}

/**
 * Local-first budget renewal metadata — enough for Monthly-Payments pills and
 * reminder dates offline. Full renewal fields and R2 document bytes are not
 * persisted; document APIs throw {@link BudgetLocalUnsupportedError}.
 */
export const localBudgetRenewalsApi = {
  get: async (householdId: string, paymentId: string) => {
    const source = await getLocalLedgerFor(householdId);
    const row = findRenewal(source, householdId, paymentId);
    if (!row) {
      return { renewal: null, documents: [] as BudgetRenewalDocument[] };
    }
    return { renewal: toBudgetRenewal(source, row), documents: [] as BudgetRenewalDocument[] };
  },

  upsert: async (householdId: string, paymentId: string, input: UpsertRenewalRequest) =>
    runOnHousehold(householdId, async () => {
      // Resolved AFTER the activation, so the linked payment and the `created_by`
      // fallback both come from the household this renewal is being written into
      // rather than from the one it left behind.
      const source = await getLocalLedgerFor(householdId);
      requireRecurringPayment(source, householdId, paymentId);

      const existing = findRenewal(source, householdId, paymentId);
      const now = isoNow();
      const id = existing?.id ?? newLocalId('budget_renewal');
      const leadDays = input.reminder_lead_days ?? existing?.reminder_lead_days ?? 14;

      const row: LocalBudgetRenewal = {
        id,
        household_id: householdId,
        recurring_payment_id: paymentId,
        next_renewal_date: input.next_renewal_date,
        status: 'upcoming',
        reminder_lead_days: leadDays,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };

      const extras = upsertExtrasFromRequest(
        input,
        existing ? toBudgetRenewal(source, existing) : {},
      );

      const next = await mutateLocalLedger(
        (ledger) => {
          const renewals = ledger.budgetRenewals ?? [];
          if (existing) {
            ledger.budgetRenewals = renewals.map((entry) => (entry.id === id ? row : entry));
          } else {
            ledger.budgetRenewals = [...renewals, row];
          }
        },
        {
          opType: existing ? 'BUDGET_RENEWAL_UPDATE' : 'BUDGET_RENEWAL_CREATE',
          entityType: 'budget_renewal',
          entityId: id,
          payload: row,
        },
      );

      return { renewal: toBudgetRenewal(next, row, extras) };
    }),

  markRenewed: async (householdId: string, paymentId: string) =>
    runOnHousehold(householdId, async () => {
      const source = await getLocalLedgerFor(householdId);
      requireRecurringPayment(source, householdId, paymentId);
      const existing = findRenewal(source, householdId, paymentId);
      if (!existing) throw new Error('Renewal not tracked for this payment');

      const now = isoNow();
      const nextDate =
        addMonthsClamped(existing.next_renewal_date, MARK_RENEWED_MONTHS) ??
        existing.next_renewal_date;

      const row: LocalBudgetRenewal = {
        ...existing,
        next_renewal_date: nextDate,
        status: 'upcoming',
        updated_at: now,
      };

      const next = await mutateLocalLedger(
        (ledger) => {
          ledger.budgetRenewals = (ledger.budgetRenewals ?? []).map((entry) =>
            entry.id === existing.id ? row : entry,
          );
        },
        {
          opType: 'BUDGET_RENEWAL_MARK_RENEWED',
          entityType: 'budget_renewal',
          entityId: existing.id,
          payload: { id: existing.id, next_renewal_date: nextDate },
        },
      );

      return {
        renewal: toBudgetRenewal(next, row, {
          last_renewed_at: now,
          renewal_count: 1,
        }),
      };
    }),

  remove: async (householdId: string, paymentId: string) =>
    runOnHousehold(householdId, async () => {
      const existing = findRenewal(await getLocalLedgerFor(householdId), householdId, paymentId);
      if (!existing) return { success: false };

      await mutateLocalLedger(
        (ledger) => {
          ledger.budgetRenewals = (ledger.budgetRenewals ?? []).filter(
            (entry) => entry.id !== existing.id,
          );
        },
        {
          opType: 'BUDGET_RENEWAL_DELETE',
          entityType: 'budget_renewal',
          entityId: existing.id,
          payload: { id: existing.id, recurring_payment_id: paymentId },
        },
      );

      return { success: true };
    }),

  createDocument: async () => {
    throw new BudgetLocalUnsupportedError('budgetRenewalsApi.createDocument');
  },

  uploadDocumentBytes: async () => {
    throw new BudgetLocalUnsupportedError('budgetRenewalsApi.uploadDocumentBytes');
  },

  deleteDocument: async () => {
    throw new BudgetLocalUnsupportedError('budgetRenewalsApi.deleteDocument');
  },
};
