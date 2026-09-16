/**
 * BR-016 B4 — reminder identifiers are household-scoped (plan §2, Tier-2).
 *
 * The defect this suite exists for: `syncBudgetLocalReminders` used to cancel
 * every request under `budget.reminder.` and then rebuild the ACTIVE household
 * only, so opening household B silently deleted A's recurring, mortgage and
 * renewal reminders and never re-placed them. A's payments went quiet until the
 * member happened to switch back and trigger another pass — no error, no log,
 * nothing to notice until a bill was late.
 *
 * Both halves of the fix are asserted, because neither works alone:
 *
 *  1. **The identifier names the household.** Proven the only way that means
 *     anything: both households are given rows with the SAME ids (`rp_1`,
 *     `mg_1`, `rn_1`). With the household in the identifier that is ten pending
 *     requests; without it, `scheduleNotificationAsync` overwrites by identifier
 *     and there would be five — B's reminders wearing A's payload.
 *  2. **The cancel is scoped to what this pass rebuilds.** A household this pass
 *     did not recompute keeps exactly the requests it had, byte for byte, and
 *     `cancelScheduledNotificationAsync` is never called with one of its ids.
 *
 * The `expo-notifications` mock is **stateful** rather than a bare `jest.fn()`,
 * following `house/local/__tests__/houseLocalReminders.test.ts`. A stateless
 * mock would let the original blanket-cancel pass every assertion here: the
 * deletion is only visible if the pending list is real and survives between
 * passes, which is exactly what it does on a device.
 *
 * Time is pinned with fake timers so the fire dates are exact rather than
 * "whatever the horizon happens to hold today" — this suite asserts identifier
 * SETS, and a set assertion needs a deterministic calendar. It is pinned in
 * LOCAL time (`new Date(2026, 2, 10, …)`), not UTC, because the scheduler builds
 * every fire date with the local-time `Date` constructor; a UTC pin would make
 * the expected `YYYY-MM` segments depend on the runner's timezone.
 *
 * Static imports throughout — `await import()` throws under this Jest config
 * without `--experimental-vm-modules`.
 */
import * as Notifications from 'expo-notifications';

import type { Mortgage } from '@api/mortgage';
import type { SavingsRecurringPayment } from '@api/savings';

import type { LocalBudgetRenewal } from '../../engine';
import type { LocalMortgageTerm } from '../../mortgage/localMortgageProjector';
import {
  BUDGET_REMINDER_PREFIX,
  BUDGET_REMINDER_TYPES,
  budgetReminderScope,
  syncBudgetLocalReminders,
  type BudgetReminderLedger,
} from '../budgetLocalReminders';

// --- expo-notifications: a real pending list, not a spy ---------------------

type PendingRequest = { identifier: string; content: Record<string, unknown> };

const pending: PendingRequest[] = [];

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

(Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(
  async (request: PendingRequest) => {
    // iOS REPLACES a pending request that reuses an identifier rather than
    // adding a second one. Modelling that is the whole point of the same-row-id
    // fixtures below: an identifier that omits the household silently collapses
    // two households into one notification, and only a replacing mock shows it.
    const existing = pending.findIndex((req) => req.identifier === request.identifier);
    const entry = { identifier: request.identifier, content: request.content };
    if (existing >= 0) pending[existing] = entry;
    else pending.push(entry);
    return request.identifier;
  },
);
(Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(
  async (identifier: string) => {
    const index = pending.findIndex((request) => request.identifier === identifier);
    if (index >= 0) pending.splice(index, 1);
  },
);
(Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockImplementation(async () => [
  ...pending,
]);

// --- engine + flag: the scheduler reads a session, the suite supplies one ----

type MockHousehold = { householdId: string; hydrated: boolean; awaitingEnrolment: boolean };

let mockSessionOpen = true;
let mockHouseholds: MockHousehold[] = [];
let mockActiveHouseholdId: string | null = null;
const mockLedgers = new Map<string, BudgetReminderLedger>();

jest.mock('../../flag', () => ({ isBudgetLocalFirst: () => true }));

jest.mock('../../engine', () => ({
  isLocalBudgetSessionOpen: () => mockSessionOpen,
  listLocalBudgetHouseholds: () =>
    mockHouseholds.map((household) => ({
      householdId: household.householdId,
      // One device, one identity — every summary reports the same deviceId.
      deviceId: 'dev-1',
      name: household.householdId,
      role: 'owner',
      isActive: household.householdId === mockActiveHouseholdId,
      hydrated: household.hydrated,
      awaitingEnrolment: household.awaitingEnrolment,
    })),
  getLocalLedgerFor: async (householdId: string) => {
    const ledger = mockLedgers.get(householdId);
    // Loud rather than undefined: `syncBudgetLocalReminders` swallows everything
    // that throws inside it, so a fixture gap would otherwise read as a green
    // pass over an empty notification centre.
    if (!ledger) throw new Error(`test fixture missing a ledger for ${householdId}`);
    return ledger;
  },
}));

// --- fixtures ---------------------------------------------------------------

const HH_A = 'hh_local_alpha';
const HH_B = 'hh_local_beta';
/** Shares HH_A's id as a string prefix — see the trailing-dot test. */
const HH_A_LOOKALIKE = 'hh_local_alpha2';

/** Tue 10 Mar 2026, 12:00 local. */
const NOW = new Date(2026, 2, 10, 12, 0, 0, 0);

function payment(overrides: Partial<SavingsRecurringPayment> = {}): SavingsRecurringPayment {
  return {
    id: 'rp_1',
    household_id: HH_A,
    category_id: null,
    label: 'Internet',
    amount_cents: 8_900,
    currency: 'CAD',
    // The 20th is after the pinned `now` (the 10th), so the current month
    // qualifies too — three dues across the scheduler's three-month window.
    day_of_month: 20,
    group_label: null,
    is_essential: true,
    active: true,
    is_automated: false,
    scope_type: 'all_year',
    scope_year: null,
    active_months: null,
    source: 'manual',
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mortgage(overrides: Partial<Mortgage> = {}): Mortgage {
  return {
    id: 'mg_1',
    household_id: HH_A,
    nickname: 'Main',
    lender: 'RBC',
    product_type: 'standard',
    property_address: null,
    mortgage_number_last4: null,
    original_price_cents: null,
    down_payment_cents: null,
    original_principal_cents: 50_000_000,
    original_amortization_months: 300,
    start_date: '2022-03-01',
    current_home_value_cents: null,
    insurance_premium_cents: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function term(overrides: Partial<LocalMortgageTerm> = {}): LocalMortgageTerm {
  return {
    id: 'mt_1',
    mortgage_id: 'mg_1',
    household_id: HH_A,
    sequence: 1,
    rate_type: 'fixed',
    compounding: 'semi_annual',
    nominal_rate_bps: 499,
    prime_rate_bps: null,
    spread_bps: null,
    term_months: 60,
    term_start_date: '2022-03-01',
    // A year out, so the lead window (maturity minus three months) still opens
    // in the future — a window that has already opened fires "now", which
    // `scheduleDateReminder` correctly drops as not-in-the-future.
    maturity_date: '2027-03-01',
    payment_frequency: 'monthly',
    amortization_months_at_start: 300,
    scheduled_payment_cents: 280_000,
    is_current: true,
    ...overrides,
  };
}

function renewal(overrides: Partial<LocalBudgetRenewal> = {}): LocalBudgetRenewal {
  return {
    id: 'rn_1',
    household_id: HH_A,
    recurring_payment_id: 'rp_1',
    next_renewal_date: '2026-06-01',
    status: 'upcoming',
    // Lead start lands 2026-05-02 — comfortably ahead of the pinned `now`.
    reminder_lead_days: 30,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * A full ledger for one household, with the SAME row ids in every household.
 *
 * Deliberate: shared ids are what make the identifier namespace observable. Two
 * households really can hold rows with equal ids — a restored backup, a natural
 * key re-mint, a fixture like this one — and before BR-016 the second household
 * to schedule simply overwrote the first.
 */
function ledgerFor(householdId: string): BudgetReminderLedger {
  return {
    household: { id: householdId, name: householdId } as BudgetReminderLedger['household'],
    savingsRecurringPayments: [payment({ household_id: householdId })],
    mortgages: [mortgage({ household_id: householdId })],
    mortgageTerms: [term({ household_id: householdId })],
    budgetRenewals: [renewal({ household_id: householdId })],
  };
}

/** The five requests a `ledgerFor` household is expected to place, in scope. */
function expectedIdentifiers(householdId: string): string[] {
  const scope = budgetReminderScope(householdId);
  return [
    `${scope}recurring.rp_1.2026-03`,
    `${scope}recurring.rp_1.2026-04`,
    `${scope}recurring.rp_1.2026-05`,
    `${scope}mortgage.mg_1.2027-03-01`,
    `${scope}renewal.rn_1.2026-06-01`,
  ].sort();
}

function useHouseholds(...households: MockHousehold[]): void {
  mockHouseholds = households;
  mockActiveHouseholdId = households[0]?.householdId ?? null;
  for (const household of households) {
    if (!mockLedgers.has(household.householdId)) {
      mockLedgers.set(household.householdId, ledgerFor(household.householdId));
    }
  }
}

const hydrated = (householdId: string): MockHousehold => ({
  householdId,
  hydrated: true,
  awaitingEnrolment: false,
});

const cold = (householdId: string): MockHousehold => ({
  householdId,
  hydrated: false,
  awaitingEnrolment: false,
});

function identifiers(): string[] {
  return pending.map((request) => request.identifier).sort();
}

/** Everything currently pending for one household, sorted for set comparison. */
function identifiersFor(householdId: string): string[] {
  const scope = budgetReminderScope(householdId);
  return identifiers().filter((identifier) => identifier.startsWith(scope));
}

function cancelledIdentifiers(): string[] {
  return (Notifications.cancelScheduledNotificationAsync as jest.Mock).mock.calls.map(
    (call) => call[0] as string,
  );
}

function payloadHouseholdId(identifier: string): unknown {
  const request = pending.find((req) => req.identifier === identifier);
  return (request?.content.data as Record<string, unknown> | undefined)?.householdId;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.clearAllMocks();
  pending.length = 0;
  mockLedgers.clear();
  mockHouseholds = [];
  mockActiveHouseholdId = null;
  mockSessionOpen = true;
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('budgetReminderScope', () => {
  it('puts the household first, so one household is addressable as a prefix', () => {
    expect(budgetReminderScope(HH_A)).toBe(`${BUDGET_REMINDER_PREFIX}${HH_A}.`);
  });

  it('ends in a dot, so one household id cannot straddle another that extends it', () => {
    // `hh_local_alpha2` starts with `hh_local_alpha`. Without the trailing
    // separator, "cancel everything for alpha" would also cancel alpha2's
    // reminders — the same silent deletion this whole suite is about, one level
    // down. The dot is what makes the prefix a boundary rather than a substring.
    expect(HH_A_LOOKALIKE.startsWith(HH_A)).toBe(true);
    expect(budgetReminderScope(HH_A_LOOKALIKE).startsWith(budgetReminderScope(HH_A))).toBe(false);
  });
});

describe('syncBudgetLocalReminders — identifiers are household-scoped', () => {
  it('places every request under its own household, with the payload agreeing', async () => {
    useHouseholds(hydrated(HH_A), hydrated(HH_B));

    await syncBudgetLocalReminders();

    expect(identifiersFor(HH_A)).toEqual(expectedIdentifiers(HH_A));
    expect(identifiersFor(HH_B)).toEqual(expectedIdentifiers(HH_B));

    // The `data.householdId` was always correct — the bug was that it never
    // reached the identifier, which is the only part a cancel can address. Both
    // must now name the same household, or a routed tap and a cancel would
    // disagree about which household a request belongs to.
    for (const identifier of identifiersFor(HH_A)) expect(payloadHouseholdId(identifier)).toBe(HH_A);
    for (const identifier of identifiersFor(HH_B)) expect(payloadHouseholdId(identifier)).toBe(HH_B);
  });

  it('keeps two households whose rows share ids from overwriting each other', async () => {
    useHouseholds(hydrated(HH_A), hydrated(HH_B));

    await syncBudgetLocalReminders();

    // Ten, not five. Both households hold `rp_1`, `mg_1` and `rn_1`; iOS
    // replaces a pending request that reuses an identifier, so an identifier
    // without the household segment would leave exactly one household's worth
    // of notifications standing — whichever scheduled last.
    expect(identifiers()).toHaveLength(10);
    expect(new Set(identifiers()).size).toBe(10);
  });

  it('tags every request with its reminder type so taps still route per class', async () => {
    useHouseholds(hydrated(HH_A));

    await syncBudgetLocalReminders();

    const types = pending.map(
      (request) => (request.content.data as Record<string, unknown>).type as string,
    );
    expect(new Set(types)).toEqual(
      new Set([
        BUDGET_REMINDER_TYPES.RECURRING_DUE,
        BUDGET_REMINDER_TYPES.MORTGAGE_RENEWAL,
        BUDGET_REMINDER_TYPES.BUDGET_RENEWAL,
      ]),
    );
  });
});

describe('syncBudgetLocalReminders — a pass over one household leaves the other alone', () => {
  it('does not cancel a household this pass did not rebuild (the Tier-2 defect)', async () => {
    // Both households scheduled while both were in memory — the state a device
    // is in after the member has visited each of them once.
    useHouseholds(hydrated(HH_A), hydrated(HH_B));
    await syncBudgetLocalReminders();
    const beforeSwitch = identifiersFor(HH_B);
    expect(beforeSwitch).toEqual(expectedIdentifiers(HH_B));

    // Next launch: the member opens A, so only A is hydrated. B's rows are still
    // encrypted on disk and its notifications are still pending in the OS —
    // notifications outlive the process, sessions do not.
    jest.clearAllMocks();
    useHouseholds(hydrated(HH_A), cold(HH_B));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await syncBudgetLocalReminders();

    // B's five requests are untouched — same identifiers, and never cancelled.
    // Before the fix this list was emptied by the blanket prefix cancel and
    // stayed empty until the member switched back, which is the "switching
    // households silently deletes the other's notifications" failure verbatim.
    expect(identifiersFor(HH_B)).toEqual(beforeSwitch);
    expect(cancelledIdentifiers().some((id) => id.startsWith(budgetReminderScope(HH_B)))).toBe(
      false,
    );
    // A was rebuilt in full, so the pass did its job rather than no-op its way
    // to a green assertion.
    expect(identifiersFor(HH_A)).toEqual(expectedIdentifiers(HH_A));
    // `syncBudgetLocalReminders` swallows its own failures; a warn here would
    // mean the pass aborted and everything above only saw stale state.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rebuilds a household in place instead of doubling it, pass after pass', async () => {
    useHouseholds(hydrated(HH_A), hydrated(HH_B));

    await syncBudgetLocalReminders();
    const firstPass = identifiers();
    await syncBudgetLocalReminders();
    await syncBudgetLocalReminders();

    // The cancel-then-reschedule cycle has to converge: the same ledgers through
    // three passes are the same ten requests, not thirty.
    expect(identifiers()).toEqual(firstPass);
  });

  it('leaves a household that is still awaiting its key completely alone', async () => {
    useHouseholds(hydrated(HH_A), hydrated(HH_B));
    await syncBudgetLocalReminders();
    const beforeEnrolmentStall = identifiersFor(HH_B);

    // B is enrolling and holds no usable HDK, so its ledger reads empty and
    // rebuilding it would place nothing. Skipping it is only safe because
    // skipping also means not cancelling — otherwise an enrolment in flight
    // would wipe the reminders B already has.
    jest.clearAllMocks();
    mockHouseholds = [
      hydrated(HH_A),
      { householdId: HH_B, hydrated: true, awaitingEnrolment: true },
    ];

    await syncBudgetLocalReminders();

    expect(identifiersFor(HH_B)).toEqual(beforeEnrolmentStall);
    expect(cancelledIdentifiers().some((id) => id.startsWith(budgetReminderScope(HH_B)))).toBe(
      false,
    );
  });

  it('covers a cold household when the caller asks for the full sweep', async () => {
    useHouseholds(hydrated(HH_A), cold(HH_B));

    await syncBudgetLocalReminders();
    expect(identifiersFor(HH_B)).toEqual([]);

    // The foreground / app-start caller pays the hydration cost once so a member
    // who never switches households still gets the other one's reminders.
    await syncBudgetLocalReminders({ includeColdHouseholds: true });
    expect(identifiersFor(HH_B)).toEqual(expectedIdentifiers(HH_B));
    expect(identifiersFor(HH_A)).toEqual(expectedIdentifiers(HH_A));
  });

  it('does not touch the notification centre when no session is open', async () => {
    useHouseholds(hydrated(HH_A), hydrated(HH_B));
    await syncBudgetLocalReminders();
    const beforeSignOut = identifiers();

    mockSessionOpen = false;
    jest.clearAllMocks();
    await syncBudgetLocalReminders();

    // A sign-out must not double as "cancel everything": the pass returns before
    // it ever reads the pending list.
    expect(identifiers()).toEqual(beforeSignOut);
    expect(Notifications.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  });
});

describe('syncBudgetLocalReminders — everything outside the rebuilt households', () => {
  it('leaves other surfaces of the app pending', async () => {
    pending.push({ identifier: 'house.reminder.task.hh_x.t1', content: {} });
    pending.push({ identifier: 'kaizen.action.1', content: {} });
    useHouseholds(hydrated(HH_A), hydrated(HH_B));

    await syncBudgetLocalReminders();

    expect(identifiers()).toContain('house.reminder.task.hh_x.t1');
    expect(identifiers()).toContain('kaizen.action.1');
    expect(cancelledIdentifiers()).not.toContain('kaizen.action.1');
  });

  it('sweeps pre-BR-016 identifiers, which no household scope can address', async () => {
    // The shapes an upgraded device carries over: household-less, so the segment
    // a scoped cancel inspects holds a class token instead of an id. Left
    // pending they would fire alongside the freshly namespaced copies and the
    // member would get every reminder twice.
    pending.push({ identifier: `${BUDGET_REMINDER_PREFIX}recurring.rp_1.2026-04`, content: {} });
    pending.push({ identifier: `${BUDGET_REMINDER_PREFIX}mortgage.mg_1.2027-03-01`, content: {} });
    pending.push({ identifier: `${BUDGET_REMINDER_PREFIX}renewal.rn_1.2026-06-01`, content: {} });
    useHouseholds(hydrated(HH_A));

    await syncBudgetLocalReminders();

    expect(
      identifiers().filter((identifier) => !identifier.startsWith(budgetReminderScope(HH_A))),
    ).toEqual([]);
    expect(identifiersFor(HH_A)).toEqual(expectedIdentifiers(HH_A));
  });
});
