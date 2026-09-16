import type {
  AddEventRequest,
  AddOfferRequest,
  CreateMortgageRequest,
  CreateStatementRequest,
  Mortgage,
  MortgageEvent,
  MortgageOfferView,
  MortgageOffersView,
  MortgageRatePeriod,
  MortgageStatement,
  MortgageTerm,
  MortgageWhatIfView,
  RenewMortgageRequest,
  UpdateMortgageRequest,
  UpdateOfferRequest,
} from '@api/mortgage';

import {
  getLocalLedgerFor,
  mutateLocalLedger,
  runOnHousehold,
  type LocalBudgetLedger,
} from '../engine';
import { BudgetLocalUnsupportedError } from '../errors';
import { isoNow, newLocalId } from '../ids';

import {
  addMonths,
  currentTermFor,
  projectListItem,
  projectSchedule,
  projectSummary,
  type LocalMortgageTerm,
  type MortgageProjectionContext,
} from './localMortgageProjector';

/*
 * Mortgage WRITES run through the engine's `runOnHousehold(id, work)`, which
 * activates the named household first (BR-016 B5).
 *
 * `mutateLocalLedger` is bound to the ACTIVE session by design — the engine
 * deliberately gave it no `forHouseholdId` — so a call naming another household
 * has exactly two honest outcomes: move the session, or refuse. Writing anyway
 * would file household B's mortgage in household A's ledger, sealed correctly
 * under A's HDK and therefore invisible to every integrity check the engine has,
 * and it would sync to A's peers. A mortgage is the largest number in this app;
 * leaking one into the wrong household is not a cosmetic defect.
 *
 * It replaced `assertHousehold`, which threw on every such call. That was the
 * right answer while a device could hold only one household and became a wall
 * the moment it could hold two: anything naming a non-active household died with
 * "Mortgage household mismatch for local ledger" rather than doing the obvious
 * thing. Activating is what the member meant — they addressed that household.
 * The refusal half survives inside `runOnHousehold`, which raises
 * `BudgetLocalUnknownHouseholdError` for an id this device holds no ledger for.
 *
 * It also replaced this file's private copy of the helper, which activated on
 * the engine's session chain but ran the write off it. `renew` shows the gap:
 * it awaits `getLocalLedgerFor`, projects a summary off the prior term, and only
 * then calls `mutateLocalLedger` — and `mutateLocalLedger` binds the active
 * session synchronously at that last moment, so a sibling facade's activation
 * landing anywhere in between took the new term into the other household.
 *
 * READS deliberately do NOT come through it — they take
 * `getLocalLedgerFor(householdId)`, which hydrates that household on demand and
 * answers from its own rows without moving the session. A payment-schedule
 * refetch for a household the member has already left must not drag them back.
 */

/**
 * Every lookup takes the ledger it is to read rather than reaching for the
 * active one. Under a single household those were the same object; under BR-016
 * they are not, and a helper that quietly read the active ledger would answer a
 * background household's question with the wrong household's balance — with no
 * parameter anywhere in the call to reveal it.
 *
 * The `household_id` predicate is new. It was redundant while `getLocalLedger()`
 * could only ever hold one household's mortgages, and it is now the second half
 * of the boundary: the ledger says which household, the row says it agrees.
 */
function requireMortgage(
  source: LocalBudgetLedger,
  householdId: string,
  mortgageId: string,
): Mortgage {
  const mortgage = (source.mortgages ?? []).find(
    (m) => m.id === mortgageId && m.household_id === householdId,
  );
  if (!mortgage) throw new Error('Mortgage not found');
  return mortgage;
}

/**
 * Terms, statements and events are matched on `mortgage_id` alone — the mortgage
 * itself was already proved to belong to `householdId` above, and `source` is
 * that household's ledger, so nothing else can be reached from here.
 */
function requireTerm(source: LocalBudgetLedger, mortgageId: string): LocalMortgageTerm {
  const term = currentTermFor(source.mortgageTerms ?? [], mortgageId);
  if (!term) throw new Error('Mortgage has no term');
  return term;
}

function asOfNow(): string {
  return new Date().toISOString();
}

function projectionContext(
  source: LocalBudgetLedger,
  mortgageId: string,
): MortgageProjectionContext {
  return {
    statements: (source.mortgageStatements ?? []).filter((s) => s.mortgage_id === mortgageId),
    events: (source.mortgageEvents ?? []).filter((e) => e.mortgage_id === mortgageId),
  };
}

export const localMortgageApi = {
  list: async (householdId: string) => {
    const source = await getLocalLedgerFor(householdId);
    const asOf = asOfNow();
    const mortgages = (source.mortgages ?? [])
      .filter((m) => m.household_id === householdId)
      .slice()
      .sort((a, b) => Number(b.is_active) - Number(a.is_active) || b.created_at.localeCompare(a.created_at))
      .map((m) =>
        projectListItem(
          m,
          currentTermFor(source.mortgageTerms ?? [], m.id),
          asOf,
          projectionContext(source, m.id),
        ),
      );
    return { mortgages };
  },

  get: async (householdId: string, mortgageId: string) => {
    return requireMortgage(await getLocalLedgerFor(householdId), householdId, mortgageId);
  },

  create: async (householdId: string, data: CreateMortgageRequest) =>
    runOnHousehold(householdId, async () => {
      let principalCents = data.originalPrincipalCents ?? null;
      if (
        principalCents == null &&
        data.originalPriceCents != null &&
        data.downPaymentCents != null
      ) {
        principalCents = data.originalPriceCents - data.downPaymentCents;
      }
      if (principalCents == null || principalCents <= 0) {
        throw new Error('Provide the original loan amount (or price and down payment).');
      }
      const amortizationMonths = data.originalAmortizationMonths ?? 300;
      if (amortizationMonths <= 0) throw new Error('Amortization must be positive.');
      if (data.termMonths <= 0) throw new Error('Term length must be positive.');

      const now = isoNow();
      const mortgageId = newLocalId('mtg');
      const termId = newLocalId('mtg_term');
      const mortgage: Mortgage = {
        id: mortgageId,
        household_id: householdId,
        nickname: data.nickname,
        lender: data.lender ?? null,
        product_type: data.productType ?? 'standard',
        property_address: data.propertyAddress ?? null,
        mortgage_number_last4: data.mortgageNumberLast4 ?? null,
        original_price_cents: data.originalPriceCents ?? null,
        down_payment_cents: data.downPaymentCents ?? null,
        original_principal_cents: principalCents,
        original_amortization_months: amortizationMonths,
        start_date: data.startDate,
        current_home_value_cents: data.currentHomeValueCents ?? null,
        insurance_premium_cents: data.insurancePremiumCents ?? null,
        is_active: true,
        created_at: now,
        updated_at: now,
      };
      const term: LocalMortgageTerm = {
        id: termId,
        mortgage_id: mortgageId,
        household_id: householdId,
        sequence: 1,
        rate_type: data.rateType,
        compounding: data.compounding,
        nominal_rate_bps: data.nominalRateBps ?? 0,
        prime_rate_bps: data.primeRateBps ?? null,
        spread_bps: data.spreadBps ?? null,
        term_months: data.termMonths,
        term_start_date: data.startDate,
        maturity_date: addMonths(data.startDate, data.termMonths),
        payment_frequency: data.paymentFrequency,
        amortization_months_at_start: amortizationMonths,
        scheduled_payment_cents: data.scheduledPaymentCents ?? null,
        starting_balance_cents: principalCents,
        is_current: true,
      };

      await mutateLocalLedger(
        (ledger) => {
          ledger.mortgages = [...(ledger.mortgages ?? []), mortgage];
          ledger.mortgageTerms = [...(ledger.mortgageTerms ?? []), term];
        },
        {
          opType: 'MORTGAGE_CREATE',
          entityType: 'mortgage',
          entityId: mortgageId,
          payload: { mortgage, term },
        },
      );

      return mortgage;
    }),

  getSummary: async (householdId: string, mortgageId: string) => {
    const source = await getLocalLedgerFor(householdId);
    const mortgage = requireMortgage(source, householdId, mortgageId);
    const term = requireTerm(source, mortgageId);
    return projectSummary(mortgage, term, asOfNow(), projectionContext(source, mortgageId));
  },

  getSchedule: async (householdId: string, mortgageId: string) => {
    const source = await getLocalLedgerFor(householdId);
    const mortgage = requireMortgage(source, householdId, mortgageId);
    const term = requireTerm(source, mortgageId);
    return projectSchedule(mortgage, term, asOfNow());
  },

  listTerms: async (householdId: string, mortgageId: string) => {
    const source = await getLocalLedgerFor(householdId);
    requireMortgage(source, householdId, mortgageId);
    const terms = (source.mortgageTerms ?? [])
      .filter((t) => t.mortgage_id === mortgageId)
      .sort((a, b) => a.sequence - b.sequence);
    return { terms: terms as MortgageTerm[] };
  },

  listEvents: async (householdId: string, mortgageId: string) => {
    const source = await getLocalLedgerFor(householdId);
    requireMortgage(source, householdId, mortgageId);
    const events = (source.mortgageEvents ?? []).filter((e) => e.mortgage_id === mortgageId);
    return { events };
  },

  addEvent: async (
    householdId: string,
    mortgageId: string,
    data: AddEventRequest,
  ): Promise<MortgageEvent> =>
    runOnHousehold(householdId, async () => {
      requireMortgage(await getLocalLedgerFor(householdId), householdId, mortgageId);
      const event: MortgageEvent = {
        id: newLocalId('mtg_evt'),
        mortgage_id: mortgageId,
        household_id: householdId,
        event_type: data.eventType,
        event_date: data.eventDate,
        amount_cents: data.amountCents ?? null,
        new_rate_bps: data.newRateBps ?? null,
        new_payment_cents: data.newPaymentCents ?? null,
        policy: data.policy ?? null,
        note: data.note ?? null,
        created_at: isoNow(),
      };
      await mutateLocalLedger(
        (ledger) => {
          ledger.mortgageEvents = [...(ledger.mortgageEvents ?? []), event];
        },
        {
          opType: 'MORTGAGE_EVENT_ADD',
          entityType: 'mortgage_event',
          entityId: event.id,
          payload: event,
        },
      );
      return event;
    }),

  update: async (
    householdId: string,
    mortgageId: string,
    data: UpdateMortgageRequest,
  ): Promise<Mortgage> =>
    runOnHousehold(householdId, async (): Promise<Mortgage> => {
      requireMortgage(await getLocalLedgerFor(householdId), householdId, mortgageId);
      let updated: Mortgage | null = null;
      await mutateLocalLedger(
        (ledger) => {
          ledger.mortgages = (ledger.mortgages ?? []).map((m) => {
            if (m.id !== mortgageId) return m;
            updated = {
              ...m,
              nickname: data.nickname ?? m.nickname,
              lender: data.lender !== undefined ? data.lender : m.lender,
              property_address:
                data.propertyAddress !== undefined ? data.propertyAddress : m.property_address,
              current_home_value_cents:
                data.currentHomeValueCents !== undefined
                  ? data.currentHomeValueCents
                  : m.current_home_value_cents,
              is_active: data.isActive ?? m.is_active,
              updated_at: isoNow(),
            };
            return updated;
          });
        },
        {
          opType: 'MORTGAGE_UPDATE',
          entityType: 'mortgage',
          entityId: mortgageId,
          payload: data,
        },
      );
      if (!updated) throw new Error('Mortgage not found');
      return updated;
    }),

  remove: async (householdId: string, mortgageId: string) =>
    runOnHousehold(householdId, async () => {
      requireMortgage(await getLocalLedgerFor(householdId), householdId, mortgageId);
      await mutateLocalLedger(
        (ledger) => {
          ledger.mortgages = (ledger.mortgages ?? []).filter((m) => m.id !== mortgageId);
          ledger.mortgageTerms = (ledger.mortgageTerms ?? []).filter(
            (t) => t.mortgage_id !== mortgageId,
          );
          ledger.mortgageStatements = (ledger.mortgageStatements ?? []).filter(
            (s) => s.mortgage_id !== mortgageId,
          );
          ledger.mortgageEvents = (ledger.mortgageEvents ?? []).filter(
            (e) => e.mortgage_id !== mortgageId,
          );
        },
        {
          opType: 'MORTGAGE_DELETE',
          entityType: 'mortgage',
          entityId: mortgageId,
          payload: { mortgageId },
        },
      );
    }),

  addStatement: async (
    householdId: string,
    mortgageId: string,
    data: CreateStatementRequest,
  ): Promise<MortgageStatement> =>
    runOnHousehold(householdId, async () => {
      requireMortgage(await getLocalLedgerFor(householdId), householdId, mortgageId);
      const statement: MortgageStatement = {
        id: newLocalId('mtg_stmt'),
        mortgage_id: mortgageId,
        statement_date: data.statementDate,
        closing_balance_cents: data.closingBalanceCents,
        opening_balance_cents: data.openingBalanceCents ?? null,
        interest_paid_cents: data.interestPaidCents ?? null,
        principal_paid_cents: data.principalPaidCents ?? null,
        payment_amount_cents: data.paymentAmountCents ?? null,
        interest_rate_bps: data.interestRateBps ?? null,
        prime_rate_bps: data.primeRateBps ?? null,
        variance_bps: data.varianceBps ?? null,
        raw_extraction_json: data.rawExtractionJson ?? null,
        source: data.source ?? 'manual',
        created_at: isoNow(),
      };
      await mutateLocalLedger(
        (ledger) => {
          let statements = ledger.mortgageStatements ?? [];
          if (data.replace) {
            statements = statements.filter(
              (s) =>
                !(s.mortgage_id === mortgageId && s.statement_date === data.statementDate),
            );
          }
          ledger.mortgageStatements = [...statements, statement];
        },
        {
          opType: 'MORTGAGE_STATEMENT_ADD',
          entityType: 'mortgage_statement',
          entityId: statement.id,
          payload: statement,
        },
      );
      return statement;
    }),

  listStatements: async (householdId: string, mortgageId: string) => {
    const source = await getLocalLedgerFor(householdId);
    requireMortgage(source, householdId, mortgageId);
    const statements = (source.mortgageStatements ?? [])
      .filter((s) => s.mortgage_id === mortgageId)
      .sort((a, b) => b.statement_date.localeCompare(a.statement_date));
    return { statements };
  },

  deleteStatement: async (householdId: string, mortgageId: string, statementId: string) =>
    runOnHousehold(householdId, async () => {
      requireMortgage(await getLocalLedgerFor(householdId), householdId, mortgageId);
      await mutateLocalLedger(
        (ledger) => {
          ledger.mortgageStatements = (ledger.mortgageStatements ?? []).filter(
            (s) => !(s.id === statementId && s.mortgage_id === mortgageId),
          );
        },
        {
          opType: 'MORTGAGE_STATEMENT_DELETE',
          entityType: 'mortgage_statement',
          entityId: statementId,
          payload: { statementId },
        },
      );
    }),

  listRatePeriods: async (householdId: string, mortgageId: string) => {
    requireMortgage(await getLocalLedgerFor(householdId), householdId, mortgageId);
    return { ratePeriods: [] as MortgageRatePeriod[] };
  },

  // A read, not a write: it proves the mortgage belongs to `householdId` and
  // then runs the extraction ladder over bytes the caller supplied. Nothing
  // lands in the ledger, so there is no reason to move the active household —
  // the member can be scanning a statement for one household while looking at
  // another.
  extractStatement: async (householdId: string, mortgageId: string, form: FormData) => {
    requireMortgage(await getLocalLedgerFor(householdId), householdId, mortgageId);
    const { readFormDataImportParts } = await import('../ai/formDataParts');
    const { runMortgageStatementExtractLadder } = await import('../ai/localImportLadder');
    const parts = readFormDataImportParts(form);
    return runMortgageStatementExtractLadder({ text: parts.text, file: parts.file });
  },

  renew: async (
    householdId: string,
    mortgageId: string,
    data: RenewMortgageRequest,
  ): Promise<MortgageTerm> =>
    runOnHousehold(householdId, async () => {
      const source = await getLocalLedgerFor(householdId);
      const mortgage = requireMortgage(source, householdId, mortgageId);
      const prior = requireTerm(source, mortgageId);
      const summary = projectSummary(
        mortgage,
        prior,
        data.termStartDate,
        projectionContext(source, mortgageId),
      );
      const startingBalance = summary.currentBalanceCents;
      const term: LocalMortgageTerm = {
        id: newLocalId('mtg_term'),
        mortgage_id: mortgageId,
        household_id: householdId,
        sequence: prior.sequence + 1,
        rate_type: data.rateType,
        compounding: data.compounding,
        nominal_rate_bps: data.nominalRateBps ?? 0,
        prime_rate_bps: data.primeRateBps ?? null,
        spread_bps: data.spreadBps ?? null,
        term_months: data.termMonths,
        term_start_date: data.termStartDate,
        maturity_date: addMonths(data.termStartDate, data.termMonths),
        payment_frequency: data.paymentFrequency,
        amortization_months_at_start:
          data.amortizationMonthsAtStart ?? summary.remainingAmortizationMonths,
        scheduled_payment_cents: data.scheduledPaymentCents ?? null,
        starting_balance_cents: startingBalance,
        is_current: true,
      };

      await mutateLocalLedger(
        (ledger) => {
          ledger.mortgageTerms = (ledger.mortgageTerms ?? []).map((t) =>
            t.mortgage_id === mortgageId ? { ...t, is_current: false } : t,
          );
          ledger.mortgageTerms = [...(ledger.mortgageTerms ?? []), term];
        },
        {
          opType: 'MORTGAGE_RENEW',
          entityType: 'mortgage_term',
          entityId: term.id,
          payload: term,
        },
      );

      return term;
    }),

  addOffer: async (
    _householdId: string,
    _mortgageId: string,
    _data: AddOfferRequest,
  ): Promise<MortgageOfferView> => {
    throw new BudgetLocalUnsupportedError('mortgageApi.addOffer');
  },

  listOffers: async (_householdId: string, _mortgageId: string): Promise<MortgageOffersView> => {
    return { incumbentPaymentCents: 0, offers: [] };
  },

  updateOffer: async (
    _householdId: string,
    _mortgageId: string,
    _offerId: string,
    _data: UpdateOfferRequest,
  ): Promise<MortgageOfferView> => {
    throw new BudgetLocalUnsupportedError('mortgageApi.updateOffer');
  },

  deleteOffer: async (_householdId: string, _mortgageId: string, _offerId: string) => {
    throw new BudgetLocalUnsupportedError('mortgageApi.deleteOffer');
  },

  getWhatIf: async (
    _householdId: string,
    _mortgageId: string,
    _lumpSumCents?: number,
  ): Promise<MortgageWhatIfView> => {
    throw new BudgetLocalUnsupportedError('mortgageApi.getWhatIf');
  },
};
