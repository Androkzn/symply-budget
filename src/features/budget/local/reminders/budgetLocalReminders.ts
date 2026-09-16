/**
 * Device-scheduled Budget reminders — multi-household since BR-016 B4.
 *
 * WHAT CHANGED, AND WHY IT WAS A BUG
 * ----------------------------------
 * This pass used to cancel every request under {@link BUDGET_REMINDER_PREFIX}
 * and then rebuild the reminders of the ACTIVE household only. With one
 * household per device that is a complete rewrite and correct. With two it is a
 * silent deletion: switching to household B cancelled A's pending recurring,
 * mortgage and renewal reminders and never re-placed them, so A's payments went
 * quiet until the member switched back and happened to trigger another pass
 * (plan §2, Tier-2 — "switching households silently deletes the other's
 * notifications").
 *
 * The fix is two halves, and neither works alone:
 *
 *  1. **Every identifier names its household**, so the notification centre can
 *     be partitioned by household at all. The `householdId` was already in the
 *     `data` payload — it just never reached the identifier, which is the only
 *     part `cancelScheduledNotificationAsync` can address.
 *  2. **The cancel is scoped to the households this pass is about to rebuild.**
 *     A household nobody recomputed keeps what it had.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { SavingsRecurringPayment } from '@api/savings';

import {
  getLocalLedgerFor,
  isLocalBudgetSessionOpen,
  listLocalBudgetHouseholds,
  type LocalBudgetLedger,
} from '../engine';
import { isBudgetLocalFirst } from '../flag';
import { currentTermFor } from '../mortgage/localMortgageProjector';

/** Stable identifier prefix — cancel/reschedule by scanning scheduled requests. */
export const BUDGET_REMINDER_PREFIX = 'budget.reminder.';

const REMINDER_HOUR = 9;
const REMINDER_MINUTE = 0;
const DEFAULT_MORTGAGE_LEAD_MONTHS = 3;

export const BUDGET_REMINDER_TYPES = {
  RECURRING_DUE: 'savings_recurring_payment_due_reminder',
  MORTGAGE_RENEWAL: 'mortgage_renewal',
  BUDGET_RENEWAL: 'budget_renewal_reminder',
} as const;

/**
 * Everything this module places for ONE household, as a `startsWith` prefix:
 * `budget.reminder.<householdId>.<class>.…`.
 *
 * The household segment comes FIRST, before the class — a deliberate divergence
 * from House, which writes `house.reminder.task.<householdId>.…`
 * (`houseLocalReminders.ts:277, 338, 434, 485`). House can afford class-first
 * because its pass always rebuilds every eligible property in one go, so the
 * household id there only has to make identifiers unique. Budget's pass rebuilds
 * a SUBSET (see `includeColdHouseholds`), so it needs a prefix that names one
 * household and nothing else; with the id anywhere but first, "cancel exactly
 * what I am about to replace" degrades from a `startsWith` into a substring
 * search over identifier segments.
 *
 * Safe as a prefix because household ids are opaque and dot-free — a UUID from
 * the control plane (`backend/src/utils/id.ts:5`) or `hh_local_<hex>` for a
 * ledger minted on device — so one household's scope cannot straddle another's.
 */
export function budgetReminderScope(householdId: string): string {
  return `${BUDGET_REMINDER_PREFIX}${householdId}.`;
}

/**
 * Identifier shapes left behind by the pre-BR-016 build, which had no household
 * segment: `budget.reminder.recurring.<paymentId>.<year>-<month>` and friends.
 *
 * They must be swept by name. A household-scoped cancel cannot see them — the
 * segment where it looks for a household id holds a class token instead — so on
 * an upgraded device they would sit in the notification centre until their fire
 * date, next to the freshly namespaced copies, and the member would get every
 * reminder twice.
 *
 * Swept on EVERY pass, not only on a full `includeColdHouseholds` sweep: a
 * duplicate that survives until the next foreground is still a duplicate the
 * member saw. The worst case is a legacy reminder for a household this pass did
 * not rebuild, which is dropped a few hours early and re-placed by the first
 * pass that does — cheap next to shipping visible doubles.
 */
const LEGACY_REMINDER_PREFIXES = [
  `${BUDGET_REMINDER_PREFIX}recurring.`,
  `${BUDGET_REMINDER_PREFIX}mortgage.`,
  `${BUDGET_REMINDER_PREFIX}renewal.`,
] as const;

/** The slice of the ledger this scheduler reads. */
export type BudgetReminderLedger = Pick<
  LocalBudgetLedger,
  'household' | 'savingsRecurringPayments' | 'mortgages' | 'mortgageTerms' | 'budgetRenewals'
>;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseYmd(dateStr: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function dueDateForMonth(year: number, month: number, dayOfMonth: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(Math.max(1, dayOfMonth), lastDay);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Mirrors backend `computeRenewalReminderDate` — first nudge at lead start, never in the past. */
export function computeRenewalReminderDate(
  nextRenewalDate: string,
  leadDays: number,
  now: Date = new Date(),
): Date | null {
  const parts = parseYmd(nextRenewalDate);
  if (!parts) return null;
  const renewal = new Date(parts.year, parts.month - 1, parts.day, REMINDER_HOUR, REMINDER_MINUTE, 0, 0);
  const leadStart = new Date(renewal.getTime() - leadDays * 24 * 60 * 60 * 1000);
  return leadStart.getTime() > now.getTime() ? leadStart : now;
}

function mortgageRenewalReminderDate(maturityDate: string, monthsBefore: number, now: Date): Date | null {
  const parts = parseYmd(maturityDate);
  if (!parts) return null;
  const maturity = new Date(parts.year, parts.month - 1, parts.day, REMINDER_HOUR, REMINDER_MINUTE, 0, 0);
  const windowStart = new Date(maturity);
  windowStart.setMonth(windowStart.getMonth() - monthsBefore);
  if (now.getTime() > maturity.getTime()) return null;
  if (now.getTime() < windowStart.getTime()) return windowStart;
  return now;
}

function recurringDueReminderDate(year: number, month: number, dayOfMonth: number, now: Date): Date | null {
  const dueDate = dueDateForMonth(year, month, dayOfMonth);
  const parts = parseYmd(dueDate);
  if (!parts) return null;
  const due = new Date(parts.year, parts.month - 1, parts.day, REMINDER_HOUR, REMINDER_MINUTE, 0, 0);
  if (due.getTime() <= now.getTime()) return null;
  return due;
}

/** Whether a recurring payment applies in `(year, month)` per Savings scope rules. */
export function recurringPaymentAppliesInMonth(
  payment: SavingsRecurringPayment,
  year: number,
  month: number,
): boolean {
  if (!payment.active) return false;
  if (payment.scope_type === 'all_year') return true;
  if (payment.scope_type === 'custom_months' && payment.scope_year === year) {
    return payment.active_months?.includes(month) ?? false;
  }
  // Custom scope is year-specific; other years run all twelve months.
  return true;
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('budget_reminders', {
    name: 'Budget reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 120, 200],
  });
}

/**
 * Drop the reminders this pass is about to replace — and nothing else.
 *
 * The blanket `startsWith(BUDGET_REMINDER_PREFIX)` this replaced is the whole
 * Tier-2 defect: it deleted the reminders of every household on the device while
 * only one of them was being rebuilt. Anything outside `householdIds` — another
 * household, another brand, another surface of this app — is left pending.
 */
async function cancelBudgetReminderNotifications(
  pending: readonly Notifications.NotificationRequest[],
  householdIds: readonly string[],
): Promise<void> {
  const scopes = householdIds.map((householdId) => budgetReminderScope(householdId));
  await Promise.all(
    pending
      .filter(
        (req) =>
          scopes.some((scope) => req.identifier.startsWith(scope)) ||
          LEGACY_REMINDER_PREFIXES.some((legacy) => req.identifier.startsWith(legacy)),
      )
      .map((req) => Notifications.cancelScheduledNotificationAsync(req.identifier)),
  );
}

async function scheduleDateReminder(params: {
  identifier: string;
  title: string;
  body: string;
  fireAt: Date;
  data: Record<string, unknown>;
}): Promise<void> {
  if (params.fireAt.getTime() <= Date.now()) return;

  await Notifications.scheduleNotificationAsync({
    identifier: params.identifier,
    content: {
      title: params.title,
      body: params.body,
      data: params.data,
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: 'budget_reminders' } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: params.fireAt,
    },
  });
}

function* upcomingMonths(count: number, from: Date = new Date()): Generator<{ year: number; month: number }> {
  let year = from.getFullYear();
  let month = from.getMonth() + 1;
  for (let i = 0; i < count; i += 1) {
    yield { year, month };
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

/**
 * Place one household's reminders, every identifier scoped to it.
 *
 * Takes the ledger rather than reading it, because the caller is a loop over
 * households and `getLocalLedger()` would hand every iteration the ACTIVE
 * household's rows — writing A's payments under B's identifiers, which is the
 * cross-household bleed BR-016 exists to prevent, one layer up from the engine.
 */
async function scheduleHouseholdReminders(ledger: BudgetReminderLedger, now: Date): Promise<void> {
  const householdId = ledger.household.id;
  const scope = budgetReminderScope(householdId);
  const paymentLabelById = new Map(
    ledger.savingsRecurringPayments.map((p) => [p.id, p.label] as const),
  );

  for (const payment of ledger.savingsRecurringPayments) {
    if (!payment.active || payment.is_automated || payment.day_of_month == null) continue;

    for (const { year, month } of upcomingMonths(3, now)) {
      if (!recurringPaymentAppliesInMonth(payment, year, month)) continue;
      const fireAt = recurringDueReminderDate(year, month, payment.day_of_month, now);
      if (!fireAt) continue;

      const dueDate = dueDateForMonth(year, month, payment.day_of_month);
      const identifier = `${scope}recurring.${payment.id}.${year}-${pad2(month)}`;
      await scheduleDateReminder({
        identifier,
        title: `${payment.label} is due soon`,
        body: `$${(payment.amount_cents / 100).toFixed(2)} is due ${dueDate}.`,
        fireAt,
        data: {
          type: BUDGET_REMINDER_TYPES.RECURRING_DUE,
          householdId,
          recurringPaymentId: payment.id,
          screen: 'SavingsRecurringPayments',
          dueDate,
        },
      });
    }
  }

  for (const mortgage of ledger.mortgages ?? []) {
    if (!mortgage.is_active) continue;
    const term = currentTermFor(ledger.mortgageTerms ?? [], mortgage.id);
    if (!term?.maturity_date) continue;

    const fireAt = mortgageRenewalReminderDate(
      term.maturity_date,
      DEFAULT_MORTGAGE_LEAD_MONTHS,
      now,
    );
    if (!fireAt) continue;

    const identifier = `${scope}mortgage.${mortgage.id}.${term.maturity_date}`;
    await scheduleDateReminder({
      identifier,
      title: 'Mortgage renewal coming up',
      body: `"${mortgage.nickname}" matures on ${term.maturity_date} — review offers before it renews.`,
      fireAt,
      data: {
        type: BUDGET_REMINDER_TYPES.MORTGAGE_RENEWAL,
        householdId,
        mortgageId: mortgage.id,
        screen: 'MortgageDetail',
        maturityDate: term.maturity_date,
      },
    });
  }

  for (const renewal of ledger.budgetRenewals ?? []) {
    if (renewal.status !== 'upcoming') continue;
    const label = paymentLabelById.get(renewal.recurring_payment_id) ?? 'Monthly payment';
    const fireAt = computeRenewalReminderDate(
      renewal.next_renewal_date,
      renewal.reminder_lead_days,
      now,
    );
    if (!fireAt) continue;

    const identifier = `${scope}renewal.${renewal.id}.${renewal.next_renewal_date}`;
    await scheduleDateReminder({
      identifier,
      title: 'Renewal coming up',
      body: `"${label}" renews on ${renewal.next_renewal_date} — update or mark it renewed.`,
      fireAt,
      data: {
        type: BUDGET_REMINDER_TYPES.BUDGET_RENEWAL,
        householdId,
        recurringPaymentId: renewal.recurring_payment_id,
        renewalId: renewal.id,
        screen: 'SavingsRecurringPayments',
        beforeRenewalDate: renewal.next_renewal_date,
      },
    });
  }
}

/**
 * Refresh device-local Budget reminders from the encrypted ledgers.
 * Best-effort: never throws — reminder failures must not block sync/session open.
 *
 * `includeColdHouseholds` is BR-016's lazy hydration made explicit, the same
 * trade House states at `houseLocalReminders.ts:639, 666`. A household that has
 * not been hydrated this session has no rows in memory, so covering it means
 * decrypting its whole row set (~35 µs/row, seconds on Hermes for a large
 * ledger). The change-driven callers — the sync orchestrator's `finally`, the
 * post-open pass in `ensureSession` — therefore leave cold households alone and
 * only rebuild what is already in memory; an app-start / foreground caller
 * passes `true` to sweep the rest, so a member who never switches households
 * still gets the other one's reminders, once per foreground rather than once per
 * merged op. Households left out are NOT cancelled, so "not covered by this
 * pass" costs nothing.
 */
export async function syncBudgetLocalReminders(
  options: { includeColdHouseholds?: boolean } = {},
): Promise<void> {
  if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) return;

  try {
    await ensureAndroidChannel();

    const households = listLocalBudgetHouseholds().filter(
      (household) =>
        // A household still awaiting its HDK cannot decrypt anything, so its
        // ledger is empty by definition — hydrating it would buy no reminders.
        !household.awaitingEnrolment &&
        (household.hydrated || options.includeColdHouseholds === true),
    );
    if (households.length === 0) return;

    // ONE read of the notification centre, before anything is placed: it is what
    // tells us which requests are ours to cancel, and re-reading after the
    // cancel would race the OS's own bookkeeping on iOS.
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await cancelBudgetReminderNotifications(
      pending,
      households.map((household) => household.householdId),
    );

    // One `now` for the whole pass, so two households cannot straddle a minute
    // boundary and disagree about which reminders are still in the future.
    const now = new Date();
    for (const household of households) {
      const ledger = await getLocalLedgerFor(household.householdId);
      await scheduleHouseholdReminders(ledger, now);
    }
  } catch (error) {
    console.warn('[budget.local] reminder sync failed', error);
  }
}
