import { eq, and, gte, lte, sql, desc, asc, isNull, isNotNull, inArray } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { households, householdMembers } from '../db/schema';
import {
  utilityProviders,
  utilityAccounts,
  utilityBills,
  propertyTaxes,
  bcAssessmentData,
  utilityReminders,
  utilityTrends,
  municipalityConfigs,
  type UtilityProvider,
  type UtilityAccount,
  type UtilityBill,
  type PropertyTax,
  type BCAssessmentData,
  type UtilityReminder,
  type UtilityTrend,
  type MunicipalityConfig,
} from '../db/schema-utilities';
import type { Env } from '../types';
import { detectMunicipality, isInGreaterVancouverArea, type AddressComponents } from '../utils/bc-city-detector';
import { buildBillAnalytics } from '../utils/bill-analytics';
import type { ProviderKey } from '../utils/bill-proration';
import { NotFoundError, ForbiddenError, ConflictError } from '../utils/errors';
import { nowIso } from '../utils/id';

import { TaskService } from './task-service';

// The calendar month immediately before a YYYY-MM key (e.g. "2026-01" → "2025-12").
function monthKeyMinusOne(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
}

// "2026-06" → "June 2026" for the dashboard period header.
function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ─── Duplicate detection (month-based) ──────────────────────────────────────
// Utility providers issue irregular billing periods (e.g. Apr 9 – Jun 8), and
// AI extraction can nudge those dates by a day or two between re-imports. So we
// dedupe on the MONTH a bill belongs to — the midpoint of its period — not on
// exact dates. Anchoring to the midpoint also stops consecutive multi-month
// bills that share a boundary month (Apr–Jun vs Jun–Aug) from colliding.
function anchorMonthIndex(start: string, end: string): number | null {
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (!Number.isNaN(s) && !Number.isNaN(e)) {
    const mid = new Date((s + e) / 2);
    return mid.getUTCFullYear() * 12 + mid.getUTCMonth();
  }
  // Fall back to whichever endpoint parses to a YYYY-MM prefix.
  const m = /^(\d{4})-(\d{2})/.exec((start || end || '').trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 12 + (parseInt(m[2], 10) - 1);
}

function normalizeProvider(provider?: string | null): string {
  return (provider || '').trim().toLowerCase();
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

// Cents → "$12.34" for the pay-bill task description.
function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// "2026-07-15" → "Jul 15, 2026" for the pay-bill task description.
function formatDueDateLabel(dueDate: string): string {
  const parsed = new Date(dueDate);
  return Number.isNaN(parsed.getTime())
    ? dueDate
    : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// Cents → compact "$1.18M" / "$925K" / "$5,053" for property insight stat tiles.
function formatMoneyShort(cents: number): string {
  const dollars = Math.round(cents / 100);
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? '-' : '';
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}$${m.toFixed(abs % 1_000_000 === 0 ? 0 : 2)}M`;
  }
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}K`;
  return `${sign}$${abs.toLocaleString('en-US')}`;
}

// Whole days from now until an ISO date (negative = in the past). null on bad input.
function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

export class UtilityService {
  private db: DrizzleD1Database;
  private env: Env;
  private d1: D1Database;
  // Built lazily — only bill create / paid-status changes need it, so most
  // UtilityService instances never pay the cost of constructing it.
  private taskServiceInstance: TaskService | null = null;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1);
    this.env = _env;
    this.d1 = d1;
  }

  private get taskService(): TaskService {
    if (!this.taskServiceInstance) {
      this.taskServiceInstance = new TaskService(this.env, this.d1);
    }
    return this.taskServiceInstance;
  }

  // ─── "Pay bill" task sync ──────────────────────────────────────────────────
  // An UNPAID bill gets a one-time reminder task ("Pay <provider> bill", due on
  // the bill's due date). Marking the bill paid deletes that task; marking it
  // unpaid again re-creates one. All task work is best-effort: a failure here
  // must never break bill CRUD, so callers wrap results and tolerate null.

  private payBillTaskTitle(input: { provider?: string | null; billType: string }): string {
    const label = input.provider?.trim() || capitalize(input.billType);
    return `Pay ${label} bill`;
  }

  private async createPayBillTask(
    householdId: string,
    userId: string,
    input: { provider?: string | null; billType: string; amount: number; dueDate: string }
  ): Promise<string | null> {
    try {
      const task = await this.taskService.createTask(householdId, userId, {
        title: this.payBillTaskTitle(input),
        description: `${formatDollars(input.amount)} due ${formatDueDateLabel(input.dueDate)}`,
        frequency: 'one_time',
        next_due_date: input.dueDate,
        priority_severity: 'high',
      });
      return task.id;
    } catch (error) {
      console.error('Failed to create pay-bill task:', error);
      return null;
    }
  }

  private async deletePayBillTask(
    householdId: string,
    taskId: string | null,
    userId: string
  ): Promise<void> {
    if (!taskId) return;
    try {
      await this.taskService.deleteTask(householdId, taskId, userId);
    } catch (error) {
      // Already gone (deleted/completed by the user) — nothing to do.
      console.error('Failed to delete pay-bill task:', error);
    }
  }

  // ─── Property tax reminder tasks ────────────────────────────────────────────
  // An UNPAID property tax spawns a one-time "Pay <year> property tax" task due
  // on the main due date. When the notice shows a Home Owner Grant, a separate
  // "Claim <year> Home Owner Grant" task is created FIRST (the grant must be
  // claimed by the same due date and lowers what's owed). Marking the tax paid
  // deletes the pay task; recording the grant as applied/approved deletes the
  // grant task. All task work is best-effort — a failure must never break tax CRUD.

  private async createPropertyTaxPayTask(
    householdId: string,
    userId: string,
    input: { taxYear: number; municipalityName?: string | null; amount: number; dueDate: string }
  ): Promise<string | null> {
    try {
      const where = input.municipalityName?.trim() ? ` (${input.municipalityName.trim()})` : '';
      const task = await this.taskService.createTask(householdId, userId, {
        title: `Pay ${input.taxYear} property tax${where}`,
        description: `${formatDollars(input.amount)} due ${formatDueDateLabel(input.dueDate)}`,
        frequency: 'one_time',
        next_due_date: input.dueDate,
        priority_severity: 'high',
      });
      return task.id;
    } catch (error) {
      console.error('Failed to create property-tax pay task:', error);
      return null;
    }
  }

  private async createHomeownerGrantTask(
    householdId: string,
    userId: string,
    input: { taxYear: number; grantAmount?: number | null; dueDate: string }
  ): Promise<string | null> {
    try {
      const savings =
        input.grantAmount && input.grantAmount > 0
          ? ` Saves up to ${formatDollars(input.grantAmount)}.`
          : '';
      const task = await this.taskService.createTask(householdId, userId, {
        title: `Claim ${input.taxYear} Home Owner Grant`,
        description: `Apply by ${formatDueDateLabel(
          input.dueDate
        )} to avoid a penalty.${savings} Claim at gov.bc.ca/homeownergrant.`,
        frequency: 'one_time',
        next_due_date: input.dueDate,
        priority_severity: 'high',
      });
      return task.id;
    } catch (error) {
      console.error('Failed to create home-owner-grant task:', error);
      return null;
    }
  }

  private async deletePropertyTaxTask(
    householdId: string,
    taskId: string | null,
    userId: string
  ): Promise<void> {
    if (!taskId) return;
    try {
      await this.taskService.deleteTask(householdId, taskId, userId);
    } catch (error) {
      // Already gone (deleted/completed by the user) — nothing to do.
      console.error('Failed to delete property-tax task:', error);
    }
  }

  // ============ ACCESS CHECK ============

  private async checkHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const member = await this.db
      .select()
      .from(householdMembers)
      .where(
        and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, userId))
      )
      .get();

    if (!member) {
      throw new ForbiddenError('You do not have access to this household');
    }
  }

  // ============ MUNICIPALITY DETECTION ============

  async detectMunicipalityForHousehold(householdId: string, userId: string): Promise<MunicipalityConfig | null> {
    await this.checkHouseholdAccess(householdId, userId);

    const household = await this.db
      .select()
      .from(households)
      .where(eq(households.id, householdId))
      .get();

    if (!household) {
      throw new NotFoundError('Household not found');
    }

    // Check if in Greater Vancouver Area
    const address: AddressComponents = {
      city: household.city || undefined,
      state_province: household.state_province || undefined,
      postal_code: household.postal_code || undefined,
      country: household.country || undefined,
    };

    if (!isInGreaterVancouverArea(address)) {
      return null;
    }

    const detected = detectMunicipality(address);
    return (detected?.config as unknown as MunicipalityConfig) || null;
  }

  // ============ UTILITY ACCOUNTS ============

  async createUtilityAccount(
    householdId: string,
    userId: string,
    input: {
      providerId: string;
      accountNumber: string;
      serviceType: string;
      startDate?: string;
      billingCyclePreference?: string;
    }
  ): Promise<UtilityAccount> {
    await this.checkHouseholdAccess(householdId, userId);

    // Verify provider exists
    const provider = await this.db
      .select()
      .from(utilityProviders)
      .where(eq(utilityProviders.id, input.providerId))
      .get();

    if (!provider) {
      throw new NotFoundError('Utility provider not found');
    }

    const id = crypto.randomUUID();
    const now = nowIso();

    const account: UtilityAccount = {
      id,
      household_id: householdId,
      provider_id: input.providerId,
      account_number: input.accountNumber,
      service_type: input.serviceType,
      start_date: input.startDate || null,
      is_active: true,
      billing_cycle_preference: input.billingCyclePreference || null,
      created_at: now,
      updated_at: now,
    };

    await this.db.insert(utilityAccounts).values(account);

    return account;
  }

  async getUtilityAccounts(householdId: string, userId: string): Promise<UtilityAccount[]> {
    await this.checkHouseholdAccess(householdId, userId);

    return this.db
      .select()
      .from(utilityAccounts)
      .where(and(eq(utilityAccounts.household_id, householdId), eq(utilityAccounts.is_active, true)))
      .orderBy(asc(utilityAccounts.service_type))
      .all();
  }

  async updateUtilityAccount(
    householdId: string,
    accountId: string,
    userId: string,
    updates: Partial<{
      accountNumber: string;
      isActive: boolean;
      billingCyclePreference: string;
    }>
  ): Promise<UtilityAccount> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(utilityAccounts)
      .where(and(eq(utilityAccounts.id, accountId), eq(utilityAccounts.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Utility account not found');
    }

    const updateData: Record<string, unknown> = {
      updated_at: nowIso(),
    };

    if (updates.accountNumber !== undefined) updateData.account_number = updates.accountNumber;
    if (updates.isActive !== undefined) updateData.is_active = updates.isActive;
    if (updates.billingCyclePreference !== undefined)
      updateData.billing_cycle_preference = updates.billingCyclePreference;

    await this.db.update(utilityAccounts).set(updateData).where(eq(utilityAccounts.id, accountId));

    return { ...existing, ...updateData } as UtilityAccount;
  }

  async deleteUtilityAccount(householdId: string, accountId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    // Soft delete by setting is_active to false
    await this.db
      .update(utilityAccounts)
      .set({ is_active: false, updated_at: nowIso() })
      .where(and(eq(utilityAccounts.id, accountId), eq(utilityAccounts.household_id, householdId)));
  }

  // ============ UTILITY BILLS ============

  /**
   * Find an existing bill that represents the same billing cycle as `input`.
   * Month-based (see {@link anchorMonthIndex}) so it tolerates irregular
   * provider periods and small date drift between re-imports. Matches when the
   * anchor month is identical AND either the provider or the exact amount lines
   * up (provider handles corrected re-issues where the amount changed; amount
   * handles bills the AI couldn't attribute a provider to).
   */
  /**
   * Membership is enforced here because this method RETURNS ANOTHER ROW.
   *
   * It previously took no userId, so `POST /bills/upload` — which only asserts
   * AI entitlement, never household membership — could be pointed at any
   * household id and would answer with that household's full bill row
   * (`existingBill`: amount, account number, provider, document key) whenever
   * the uploaded document happened to collide on anchor month plus provider or
   * amount. An unrelated user could probe another home's utility history.
   */
  async findDuplicateBill(
    householdId: string,
    userId: string,
    input: {
      billType: string;
      provider?: string;
      billingPeriodStart: string;
      billingPeriodEnd: string;
      amount: number;
    }
  ): Promise<UtilityBill | null> {
    await this.checkHouseholdAccess(householdId, userId);

    const inputMonth = anchorMonthIndex(input.billingPeriodStart, input.billingPeriodEnd);
    if (inputMonth === null) return null;

    const candidates = await this.db
      .select()
      .from(utilityBills)
      .where(
        and(
          eq(utilityBills.household_id, householdId),
          eq(utilityBills.bill_type, input.billType)
        )
      );

    const inputProvider = normalizeProvider(input.provider);

    for (const candidate of candidates) {
      const candidateMonth = anchorMonthIndex(
        candidate.billing_period_start,
        candidate.billing_period_end
      );
      if (candidateMonth !== inputMonth) continue;

      const providerMatch = !!inputProvider && inputProvider === normalizeProvider(candidate.provider);
      const amountMatch = candidate.amount === input.amount;

      if (providerMatch || amountMatch) {
        return candidate as UtilityBill;
      }
    }

    return null;
  }

  async createUtilityBill(
    householdId: string,
    userId: string,
    input: {
      accountId?: string;
      billType: string;
      provider?: string;
      accountNumber?: string;
      billingPeriodStart: string;
      billingPeriodEnd: string;
      amount: number; // in cents
      dueDate: string;
      paidDate?: string;
      paidAmount?: number; // in cents
      usageQuantity?: number;
      usageUnit?: string;
      documentUrl?: string;
      aiExtractedData?: object;
      confidenceScore?: number;
    },
    options?: { allowDuplicate?: boolean; deferPayTask?: boolean }
  ): Promise<UtilityBill> {
    await this.checkHouseholdAccess(householdId, userId);

    // Guard against re-importing the same bill. The caller can override with
    // { allowDuplicate: true } once the user has confirmed "add anyway".
    if (!options?.allowDuplicate) {
      const existing = await this.findDuplicateBill(householdId, userId, input);
      if (existing) {
        const error = new ConflictError('A matching bill already exists for this period.');
        (error as ConflictError & { existingBill: UtilityBill }).existingBill = existing;
        throw error;
      }
    }

    const id = crypto.randomUUID();
    const now = nowIso();

    // Unpaid bills spawn a one-time "Pay <provider> bill" task so the amount
    // shows up on the maintenance/tasks board with the bill's due date.
    // Batch imports pass { deferPayTask: true }: their bills all arrive unpaid,
    // but the user hasn't yet declared which are ALREADY paid — that happens on
    // the ConfirmBillPayments screen, which then creates a task only for the
    // ones left unpaid. Creating tasks here too would double up (one per
    // imported bill regardless of the user's choice), which is the "wrong
    // number of tasks" bug. So skip creation and let the confirm step own it.
    const taskId =
      input.paidDate || options?.deferPayTask
        ? null
        : await this.createPayBillTask(householdId, userId, {
            provider: input.provider,
            billType: input.billType,
            amount: input.amount,
            dueDate: input.dueDate,
          });

    const bill: UtilityBill = {
      id,
      household_id: householdId,
      account_id: input.accountId || null,
      bill_type: input.billType,
      provider: input.provider || null,
      account_number: input.accountNumber || null,
      billing_period_start: input.billingPeriodStart,
      billing_period_end: input.billingPeriodEnd,
      amount: input.amount,
      due_date: input.dueDate,
      paid_date: input.paidDate || null,
      paid_amount: input.paidAmount ?? null,
      usage_quantity: input.usageQuantity ?? null,
      usage_unit: input.usageUnit || null,
      document_url: input.documentUrl || null,
      ai_extracted_data: input.aiExtractedData ? JSON.stringify(input.aiExtractedData) : null,
      confidence_score: input.confidenceScore ?? null,
      task_id: taskId,
      created_at: now,
      updated_at: now,
    };

    await this.db.insert(utilityBills).values(bill);

    // Automatically schedule reminders for new bills
    try {
      await this.scheduleBillReminders(householdId, userId, id, input.dueDate);
    } catch (error) {
      console.error('Failed to schedule reminders for bill:', error);
      // Don't fail bill creation if reminder scheduling fails
    }

    return bill;
  }

  async getUtilityBills(
    householdId: string,
    userId: string,
    filters: {
      billType?: string;
      startDate?: string;
      endDate?: string;
      paid?: boolean;
      limit?: number;
    }
  ): Promise<UtilityBill[]> {
    await this.checkHouseholdAccess(householdId, userId);

    this.db
      .select()
      .from(utilityBills)
      .where(eq(utilityBills.household_id, householdId))
      .orderBy(desc(utilityBills.due_date))
      .limit(filters.limit || 100);

    // Apply filters
    const conditions = [eq(utilityBills.household_id, householdId)];

    if (filters.billType) {
      conditions.push(eq(utilityBills.bill_type, filters.billType));
    }

    if (filters.startDate) {
      conditions.push(gte(utilityBills.billing_period_start, filters.startDate));
    }

    if (filters.endDate) {
      conditions.push(lte(utilityBills.billing_period_end, filters.endDate));
    }

    if (filters.paid !== undefined) {
      if (filters.paid) {
        conditions.push(sql`${utilityBills.paid_date} IS NOT NULL`);
      } else {
        conditions.push(isNull(utilityBills.paid_date));
      }
    }

    return this.db
      .select()
      .from(utilityBills)
      .where(and(...conditions))
      .orderBy(desc(utilityBills.due_date))
      .limit(filters.limit || 100)
      .all();
  }

  async updateUtilityBill(
    householdId: string,
    billId: string,
    userId: string,
    updates: Partial<{
      billType: string;
      provider: string;
      accountNumber: string;
      billingPeriodStart: string;
      billingPeriodEnd: string;
      amount: number;
      dueDate: string;
      paidDate: string;
      paidAmount: number;
      usageQuantity: number;
      usageUnit: string;
    }>
  ): Promise<UtilityBill> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(utilityBills)
      .where(and(eq(utilityBills.id, billId), eq(utilityBills.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Utility bill not found');
    }

    const updateData: Record<string, unknown> = {
      updated_at: nowIso(),
    };

    if (updates.billType !== undefined) updateData.bill_type = updates.billType;
    if (updates.provider !== undefined) updateData.provider = updates.provider || null;
    if (updates.accountNumber !== undefined) updateData.account_number = updates.accountNumber || null;
    if (updates.billingPeriodStart !== undefined)
      updateData.billing_period_start = updates.billingPeriodStart;
    if (updates.billingPeriodEnd !== undefined)
      updateData.billing_period_end = updates.billingPeriodEnd;
    if (updates.amount !== undefined) updateData.amount = updates.amount;
    if (updates.dueDate !== undefined) updateData.due_date = updates.dueDate;
    if (updates.paidDate !== undefined) updateData.paid_date = updates.paidDate || null;
    if (updates.paidAmount !== undefined) updateData.paid_amount = updates.paidAmount;
    if (updates.usageQuantity !== undefined) updateData.usage_quantity = updates.usageQuantity;
    if (updates.usageUnit !== undefined) updateData.usage_unit = updates.usageUnit;

    // Keep the linked "Pay bill" task in sync when paid status flips.
    if (updates.paidDate !== undefined) {
      const wasPaid = !!existing.paid_date;
      const willBePaid = !!updates.paidDate;
      if (willBePaid && !wasPaid) {
        // Marked paid — the reminder task is no longer needed.
        await this.deletePayBillTask(householdId, existing.task_id, userId);
        updateData.task_id = null;
      } else if (!willBePaid && wasPaid) {
        // Reopened as unpaid — bring the reminder task back.
        updateData.task_id = await this.createPayBillTask(householdId, userId, {
          provider: (updates.provider ?? existing.provider) as string | null,
          billType: updates.billType ?? existing.bill_type,
          amount: updates.amount ?? existing.amount,
          dueDate: updates.dueDate ?? existing.due_date,
        });
      }
    }

    await this.db.update(utilityBills).set(updateData).where(eq(utilityBills.id, billId));

    return { ...existing, ...updateData } as UtilityBill;
  }

  /**
   * Bulk-confirm paid status for a set of bills — used by the import-review
   * screen where the user ticks off which freshly-imported bills are already
   * paid. Idempotent and self-healing: a paid bill's linked reminder task is
   * removed, an unpaid bill without one gets it (re)created. Marking paid uses
   * today's date and the bill's own amount. Missing/other-household ids are
   * silently skipped. Returns the updated bills.
   */
  async setBillsPaidStatus(
    householdId: string,
    userId: string,
    items: Array<{ billId: string; paid: boolean }>
  ): Promise<UtilityBill[]> {
    await this.checkHouseholdAccess(householdId, userId);

    const today = nowIso().split('T')[0];
    const updated: UtilityBill[] = [];

    for (const item of items) {
      const existing = await this.db
        .select()
        .from(utilityBills)
        .where(and(eq(utilityBills.id, item.billId), eq(utilityBills.household_id, householdId)))
        .get();
      if (!existing) continue;

      const isPaid = !!existing.paid_date;
      const updateData: Record<string, unknown> = { updated_at: nowIso() };

      if (item.paid) {
        if (!isPaid) {
          updateData.paid_date = today;
          updateData.paid_amount = existing.amount;
        }
        // Paid bills need no reminder task — drop any lingering one.
        if (existing.task_id) {
          await this.deletePayBillTask(householdId, existing.task_id, userId);
          updateData.task_id = null;
        }
      } else {
        if (isPaid) {
          updateData.paid_date = null;
          updateData.paid_amount = null;
        }
        // Unpaid bill should have a live reminder task — create one if missing.
        if (!existing.task_id) {
          updateData.task_id = await this.createPayBillTask(householdId, userId, {
            provider: existing.provider,
            billType: existing.bill_type,
            amount: existing.amount,
            dueDate: existing.due_date,
          });
        }
      }

      await this.db.update(utilityBills).set(updateData).where(eq(utilityBills.id, existing.id));
      updated.push({ ...existing, ...updateData } as UtilityBill);
    }

    return updated;
  }

  async deleteUtilityBill(householdId: string, billId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    // Tidy up the linked "Pay bill" task so it doesn't outlive its bill.
    const existing = await this.db
      .select()
      .from(utilityBills)
      .where(and(eq(utilityBills.id, billId), eq(utilityBills.household_id, householdId)))
      .get();
    if (existing?.task_id) {
      await this.deletePayBillTask(householdId, existing.task_id, userId);
    }

    await this.db
      .delete(utilityBills)
      .where(and(eq(utilityBills.id, billId), eq(utilityBills.household_id, householdId)));
  }

  // ============ PROPERTY TAXES ============

  async createPropertyTax(
    householdId: string,
    userId: string,
    input: {
      taxYear: number;
      assessedValue: number; // in cents
      taxAmount: number; // in cents
      advancePaymentAmount?: number;
      advancePaymentDueDate?: string;
      mainPaymentAmount: number;
      mainPaymentDueDate: string;
      homeownerGrantEligible?: boolean;
      homeownerGrantAmount?: number;
      // When true, the user claims the grant now: its amount is deducted from
      // what's owed on the main payment, the record is marked applied, and the
      // "Claim Home Owner Grant" reminder task is skipped.
      homeownerGrantApplied?: boolean;
      documentUrl?: string;
      // Set when the tax is imported already paid — records the payment date and
      // suppresses the reminder tasks below.
      mainPaymentPaidDate?: string;
      // Municipality name from the scanned notice, used in the pay-task title.
      municipalityName?: string;
      // Skip auto-creating the grant/pay reminder tasks (defaults to on for
      // unpaid records). Paid records never get tasks regardless.
      createTasks?: boolean;
    }
  ): Promise<PropertyTax> {
    await this.checkHouseholdAccess(householdId, userId);

    const id = crypto.randomUUID();
    const now = nowIso();
    const todayDate = now.split('T')[0];
    const isPaid = !!input.mainPaymentPaidDate;

    // The grant can only be applied when the notice is grant-eligible. When
    // applied, deduct it from the main payment so the amount owed (and the pay
    // task / penalty math that read main_payment_amount) reflects what's due
    // AFTER the grant. tax_amount stays the gross "No Grant" levy for history.
    const grantApplied = !!input.homeownerGrantApplied && !!input.homeownerGrantEligible;
    const grantCents = input.homeownerGrantAmount || 0;
    const netMainPayment = grantApplied
      ? Math.max(0, input.mainPaymentAmount - grantCents)
      : input.mainPaymentAmount;

    const tax: PropertyTax = {
      id,
      household_id: householdId,
      tax_year: input.taxYear,
      assessed_value: input.assessedValue,
      tax_amount: input.taxAmount,
      advance_payment_amount: input.advancePaymentAmount ?? null,
      advance_payment_due_date: input.advancePaymentDueDate || null,
      advance_payment_paid_date: null,
      main_payment_amount: netMainPayment,
      main_payment_due_date: input.mainPaymentDueDate,
      main_payment_paid_date: input.mainPaymentPaidDate || null,
      homeowner_grant_eligible: input.homeownerGrantEligible || false,
      homeowner_grant_amount: input.homeownerGrantAmount ?? null,
      homeowner_grant_applied_date: grantApplied ? todayDate : null,
      homeowner_grant_status: grantApplied ? 'pending' : null,
      penalties: null,
      document_url: input.documentUrl || null,
      main_payment_task_id: null,
      grant_task_id: null,
      created_at: now,
      updated_at: now,
    };

    // Insert first so a unique-year conflict fails BEFORE we create any tasks —
    // otherwise a duplicate would orphan the grant/pay tasks.
    await this.db.insert(propertyTaxes).values(tax);

    // Unpaid notices get reminder tasks: the Home Owner Grant task first (claim
    // it to lower what's owed), then the "Pay property tax" task. Both due on the
    // main due date. Skipped when already paid or when createTasks is false.
    if (!isPaid && input.createTasks !== false) {
      // Only nudge them to claim the grant when it's eligible but NOT yet
      // applied — if they already applied it, there's nothing left to claim.
      if (input.homeownerGrantEligible && !grantApplied) {
        tax.grant_task_id = await this.createHomeownerGrantTask(householdId, userId, {
          taxYear: input.taxYear,
          grantAmount: input.homeownerGrantAmount,
          dueDate: input.mainPaymentDueDate,
        });
      }
      tax.main_payment_task_id = await this.createPropertyTaxPayTask(householdId, userId, {
        taxYear: input.taxYear,
        municipalityName: input.municipalityName,
        amount: netMainPayment,
        dueDate: input.mainPaymentDueDate,
      });

      if (tax.grant_task_id || tax.main_payment_task_id) {
        await this.db
          .update(propertyTaxes)
          .set({
            main_payment_task_id: tax.main_payment_task_id,
            grant_task_id: tax.grant_task_id,
          })
          .where(eq(propertyTaxes.id, id));
      }
    }

    return tax;
  }

  /**
   * Track-and-warn helper for the one-property Home Owner Grant rule: returns
   * the name of ANOTHER of the user's properties that has already applied the
   * grant for `taxYear`, if any. BC allows the grant on only one (principal)
   * residence per year — we surface a conflict as a soft warning, not a block.
   */
  async checkGrantAppliedElsewhere(
    householdId: string,
    userId: string,
    taxYear: number
  ): Promise<{ conflict: boolean; householdName: string | null }> {
    const memberships = await this.db
      .select({ household_id: householdMembers.household_id })
      .from(householdMembers)
      .where(and(eq(householdMembers.user_id, userId), isNull(householdMembers.deleted_at)))
      .all();

    const otherHouseholdIds = memberships
      .map((m) => m.household_id)
      .filter((id) => id !== householdId);
    if (otherHouseholdIds.length === 0) return { conflict: false, householdName: null };

    const conflict = await this.db
      .select({ name: households.name })
      .from(propertyTaxes)
      .innerJoin(households, eq(propertyTaxes.household_id, households.id))
      .where(
        and(
          inArray(propertyTaxes.household_id, otherHouseholdIds),
          eq(propertyTaxes.tax_year, taxYear),
          isNotNull(propertyTaxes.homeowner_grant_applied_date)
        )
      )
      .get();

    return { conflict: !!conflict, householdName: conflict?.name ?? null };
  }

  async getPropertyTaxes(householdId: string, userId: string): Promise<PropertyTax[]> {
    await this.checkHouseholdAccess(householdId, userId);

    return this.db
      .select()
      .from(propertyTaxes)
      .where(eq(propertyTaxes.household_id, householdId))
      .orderBy(desc(propertyTaxes.tax_year))
      .all();
  }

  async getPropertyTaxByYear(householdId: string, userId: string, taxYear: number): Promise<PropertyTax | null> {
    await this.checkHouseholdAccess(householdId, userId);

    const result = await this.db
      .select()
      .from(propertyTaxes)
      .where(and(eq(propertyTaxes.household_id, householdId), eq(propertyTaxes.tax_year, taxYear)))
      .get();
    return result ?? null;
  }

  async getPropertyTaxById(householdId: string, taxId: string, userId: string): Promise<PropertyTax | null> {
    await this.checkHouseholdAccess(householdId, userId);

    const result = await this.db
      .select()
      .from(propertyTaxes)
      .where(and(eq(propertyTaxes.id, taxId), eq(propertyTaxes.household_id, householdId)))
      .get();
    return result ?? null;
  }

  async updatePropertyTax(
    householdId: string,
    taxId: string,
    userId: string,
    updates: Partial<{
      assessedValue: number;
      taxAmount: number;
      advancePaymentPaidDate: string;
      mainPaymentPaidDate: string;
      homeownerGrantAppliedDate: string;
      homeownerGrantStatus: string;
    }>
  ): Promise<PropertyTax> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(propertyTaxes)
      .where(and(eq(propertyTaxes.id, taxId), eq(propertyTaxes.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Property tax not found');
    }

    const updateData: Record<string, unknown> = {
      updated_at: nowIso(),
    };

    if (updates.assessedValue !== undefined) updateData.assessed_value = updates.assessedValue;
    if (updates.taxAmount !== undefined) updateData.tax_amount = updates.taxAmount;
    if (updates.advancePaymentPaidDate !== undefined)
      updateData.advance_payment_paid_date = updates.advancePaymentPaidDate;
    if (updates.mainPaymentPaidDate !== undefined)
      updateData.main_payment_paid_date = updates.mainPaymentPaidDate;
    if (updates.homeownerGrantAppliedDate !== undefined)
      updateData.homeowner_grant_applied_date = updates.homeownerGrantAppliedDate;
    if (updates.homeownerGrantStatus !== undefined)
      updateData.homeowner_grant_status = updates.homeownerGrantStatus;

    // Keep the linked reminder tasks in sync. Paying the tax clears the "Pay
    // property tax" task; recording the grant as applied/approved clears the
    // "Claim Home Owner Grant" task.
    if (updates.mainPaymentPaidDate) {
      await this.deletePropertyTaxTask(householdId, existing.main_payment_task_id, userId);
      updateData.main_payment_task_id = null;
    }
    const grantResolved =
      updates.homeownerGrantAppliedDate !== undefined ||
      updates.homeownerGrantStatus === 'approved';
    if (grantResolved) {
      await this.deletePropertyTaxTask(householdId, existing.grant_task_id, userId);
      updateData.grant_task_id = null;
    }

    await this.db.update(propertyTaxes).set(updateData).where(eq(propertyTaxes.id, taxId));

    // If payment date is updated, recalculate penalties
    if (updates.mainPaymentPaidDate || updates.advancePaymentPaidDate) {
      try {
        const municipality = await this.detectMunicipalityForHousehold(householdId, userId);
        const penalties = this.calculatePropertyTaxPenalties(
          { ...existing, ...updateData } as PropertyTax,
          municipality,
          updates.mainPaymentPaidDate
        );

        if (penalties.length > 0) {
          await this.db
            .update(propertyTaxes)
            .set({ penalties: JSON.stringify(penalties) })
            .where(eq(propertyTaxes.id, taxId));
        }
      } catch (error) {
        console.error('Failed to calculate penalties:', error);
        // Don't fail update if penalty calculation fails
      }
    }

    return { ...existing, ...updateData } as PropertyTax;
  }

  // ============ BC ASSESSMENT ============

  async createBCAssessment(
    householdId: string,
    userId: string,
    input: {
      assessmentYear: number;
      propertyClass?: string;
      assessedValue: number; // in cents
      landValue?: number;
      improvementValue?: number;
      previousYearValue?: number;
      changePercent?: number;
      assessmentPdfKey?: string;
      appealDeadline?: string;
    }
  ): Promise<BCAssessmentData> {
    await this.checkHouseholdAccess(householdId, userId);

    const id = crypto.randomUUID();
    const now = nowIso();

    const assessment: BCAssessmentData = {
      id,
      household_id: householdId,
      assessment_year: input.assessmentYear,
      property_class: input.propertyClass || null,
      assessed_value: input.assessedValue,
      land_value: input.landValue ?? null,
      improvement_value: input.improvementValue ?? null,
      previous_year_value: input.previousYearValue ?? null,
      change_percent: input.changePercent ?? null,
      assessment_pdf_key: input.assessmentPdfKey || null,
      appeal_deadline: input.appealDeadline || null,
      appeal_filed: false,
      created_at: now,
      updated_at: now,
    };

    await this.db.insert(bcAssessmentData).values(assessment);

    return assessment;
  }

  /**
   * Backfill historical BC Assessment rows from a single notice's multi-year
   * value history. One row per year (unique on household+year). Years that
   * already exist are ENRICHED — we only fill fields that are currently null, so
   * a user's earlier edits are never clobbered. Missing years are inserted with
   * no PDF/appeal-deadline (they're historical facts, not the active notice).
   *
   * Callers should exclude the current roll year (it flows through the review
   * sheet). Returns how many rows were created vs. enriched.
   */
  async backfillBCAssessmentHistory(
    householdId: string,
    userId: string,
    years: Array<{
      assessmentYear: number;
      propertyClass?: string;
      assessedValue: number; // in cents
      landValue?: number;
      improvementValue?: number;
      previousYearValue?: number;
      changePercent?: number;
    }>
  ): Promise<{ created: number; enriched: number }> {
    await this.checkHouseholdAccess(householdId, userId);

    let created = 0;
    let enriched = 0;
    const now = nowIso();

    for (const y of years) {
      const existing = await this.db
        .select()
        .from(bcAssessmentData)
        .where(
          and(
            eq(bcAssessmentData.household_id, householdId),
            eq(bcAssessmentData.assessment_year, y.assessmentYear)
          )
        )
        .get();

      if (existing) {
        // Only fill gaps — never overwrite a value that already exists.
        const patch: Record<string, unknown> = {};
        if (existing.land_value == null && y.landValue != null) patch.land_value = y.landValue;
        if (existing.improvement_value == null && y.improvementValue != null)
          patch.improvement_value = y.improvementValue;
        if (existing.previous_year_value == null && y.previousYearValue != null)
          patch.previous_year_value = y.previousYearValue;
        if (existing.change_percent == null && y.changePercent != null)
          patch.change_percent = y.changePercent;
        if (existing.property_class == null && y.propertyClass)
          patch.property_class = y.propertyClass;

        if (Object.keys(patch).length > 0) {
          patch.updated_at = now;
          await this.db
            .update(bcAssessmentData)
            .set(patch)
            .where(eq(bcAssessmentData.id, existing.id));
          enriched++;
        }
      } else {
        await this.db.insert(bcAssessmentData).values({
          id: crypto.randomUUID(),
          household_id: householdId,
          assessment_year: y.assessmentYear,
          property_class: y.propertyClass || null,
          assessed_value: y.assessedValue,
          land_value: y.landValue ?? null,
          improvement_value: y.improvementValue ?? null,
          previous_year_value: y.previousYearValue ?? null,
          change_percent: y.changePercent ?? null,
          assessment_pdf_key: null,
          appeal_deadline: null,
          appeal_filed: false,
          created_at: now,
          updated_at: now,
        });
        created++;
      }
    }

    return { created, enriched };
  }

  async getBCAssessments(householdId: string, userId: string): Promise<BCAssessmentData[]> {
    await this.checkHouseholdAccess(householdId, userId);

    return this.db
      .select()
      .from(bcAssessmentData)
      .where(eq(bcAssessmentData.household_id, householdId))
      .orderBy(desc(bcAssessmentData.assessment_year))
      .all();
  }

  async getBCAssessmentByYear(
    householdId: string,
    userId: string,
    assessmentYear: number
  ): Promise<BCAssessmentData | null> {
    await this.checkHouseholdAccess(householdId, userId);

    const result = await this.db
      .select()
      .from(bcAssessmentData)
      .where(
        and(
          eq(bcAssessmentData.household_id, householdId),
          eq(bcAssessmentData.assessment_year, assessmentYear)
        )
      )
      .get();
    return result ?? null;
  }

  async updateBCAssessment(
    householdId: string,
    assessmentId: string,
    userId: string,
    updates: Partial<{
      propertyClass: string;
      assessedValue: number; // in cents
      landValue: number; // in cents
      improvementValue: number; // in cents
      previousYearValue: number; // in cents
      changePercent: number;
      appealDeadline: string;
      appealFiled: boolean;
    }>
  ): Promise<BCAssessmentData> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(bcAssessmentData)
      .where(
        and(eq(bcAssessmentData.id, assessmentId), eq(bcAssessmentData.household_id, householdId))
      )
      .get();

    if (!existing) {
      throw new NotFoundError('BC Assessment not found');
    }

    const updateData: Record<string, unknown> = { updated_at: nowIso() };
    if (updates.propertyClass !== undefined) updateData.property_class = updates.propertyClass;
    if (updates.assessedValue !== undefined) updateData.assessed_value = updates.assessedValue;
    if (updates.landValue !== undefined) updateData.land_value = updates.landValue;
    if (updates.improvementValue !== undefined)
      updateData.improvement_value = updates.improvementValue;
    if (updates.previousYearValue !== undefined)
      updateData.previous_year_value = updates.previousYearValue;
    if (updates.changePercent !== undefined) updateData.change_percent = updates.changePercent;
    if (updates.appealDeadline !== undefined) updateData.appeal_deadline = updates.appealDeadline;
    if (updates.appealFiled !== undefined) updateData.appeal_filed = updates.appealFiled;

    await this.db
      .update(bcAssessmentData)
      .set(updateData)
      .where(eq(bcAssessmentData.id, assessmentId));

    return { ...existing, ...updateData } as BCAssessmentData;
  }

  // ============ PROPERTY INSIGHTS ============

  /**
   * Server-computed insights for the Property detail screen. Combines BC
   * Assessment history and property-tax history into ready-to-render stat
   * tiles, chart series (ascending by year), and insight cards — the client
   * only renders. Money values in the chart series stay in cents; the `value`
   * strings on stat tiles / insights are pre-formatted.
   */
  async getPropertyInsights(householdId: string, userId: string) {
    await this.checkHouseholdAccess(householdId, userId);

    const [assessments, taxes] = await Promise.all([
      this.db
        .select()
        .from(bcAssessmentData)
        .where(eq(bcAssessmentData.household_id, householdId))
        .orderBy(asc(bcAssessmentData.assessment_year))
        .all(),
      this.db
        .select()
        .from(propertyTaxes)
        .where(eq(propertyTaxes.household_id, householdId))
        .orderBy(asc(propertyTaxes.tax_year))
        .all(),
    ]);

    // ── Assessment series + latest ─────────────────────────────────────────
    const assessmentHistory = assessments.map((a) => ({
      year: a.assessment_year,
      assessedValue: a.assessed_value,
      landValue: a.land_value,
      improvementValue: a.improvement_value,
      changePercent: a.change_percent,
    }));
    const latestAssessment = assessments.length ? assessments[assessments.length - 1] : null;
    let assessmentYoy: { changeCents: number; changePercent: number } | null = null;
    if (latestAssessment) {
      const prev =
        latestAssessment.previous_year_value ??
        (assessments.length > 1 ? assessments[assessments.length - 2].assessed_value : null);
      if (prev != null && prev > 0) {
        const changeCents = latestAssessment.assessed_value - prev;
        assessmentYoy = {
          changeCents,
          changePercent:
            latestAssessment.change_percent ??
            Math.round((changeCents / prev) * 1000) / 10,
        };
      }
    }
    const landVsBuilding =
      latestAssessment && latestAssessment.land_value != null && latestAssessment.improvement_value != null
        ? { landValue: latestAssessment.land_value, improvementValue: latestAssessment.improvement_value }
        : null;

    // ── Property-tax series + latest / next due ────────────────────────────
    const taxHistory = taxes.map((t) => ({
      year: t.tax_year,
      taxAmount: t.tax_amount,
      assessedValue: t.assessed_value,
      paid: !!t.main_payment_paid_date,
      dueDate: t.main_payment_due_date,
    }));
    const latestTax = taxes.length ? taxes[taxes.length - 1] : null;
    let taxYoy: { changeCents: number; changePercent: number } | null = null;
    if (taxes.length > 1) {
      const prev = taxes[taxes.length - 2].tax_amount;
      const curr = taxes[taxes.length - 1].tax_amount;
      if (prev > 0) {
        const changeCents = curr - prev;
        taxYoy = { changeCents, changePercent: Math.round((changeCents / prev) * 1000) / 10 };
      }
    }
    // Next thing to pay: the most recent unpaid notice.
    const unpaid = [...taxes].reverse().find((t) => !t.main_payment_paid_date) || null;
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

    // ── Stat tiles (pre-formatted) ─────────────────────────────────────────
    const stats: Array<{
      id: string;
      label: string;
      value: string;
      subtitle?: string;
      tone?: 'default' | 'positive' | 'warning';
    }> = [];

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
      const d = daysUntil(nextDue.dueDate);
      stats.push({
        id: 'next_due',
        label: 'Next payment',
        value: formatMoneyShort(nextDue.amount),
        subtitle: `Due ${formatDueDateLabel(nextDue.dueDate)}`,
        tone: d != null && d <= 60 ? 'warning' : 'default',
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

    // ── Insight cards (pre-written copy) ───────────────────────────────────
    const insights: Array<{
      id: string;
      severity: 'info' | 'positive' | 'warning';
      title: string;
      body: string;
    }> = [];

    if (assessmentYoy) {
      const up = assessmentYoy.changePercent >= 0;
      insights.push({
        id: 'assessment_change',
        severity: up && assessmentYoy.changePercent >= 10 ? 'warning' : 'info',
        title: `Assessed value ${up ? 'up' : 'down'} ${Math.abs(assessmentYoy.changePercent)}%`,
        body: `Your ${latestAssessment!.assessment_year} assessment ${up ? 'rose' : 'fell'} ${formatMoneyShort(
          Math.abs(assessmentYoy.changeCents)
        )} from the prior year${up && assessmentYoy.changePercent >= 10 ? ' — a large jump may be worth appealing.' : '.'}`,
      });
    }
    if (latestAssessment?.appeal_deadline && !latestAssessment.appeal_filed) {
      const d = daysUntil(latestAssessment.appeal_deadline);
      if (d != null && d >= 0 && d <= 45) {
        insights.push({
          id: 'appeal_deadline',
          severity: 'warning',
          title: 'Assessment appeal window closing',
          body: `If you think your ${latestAssessment.assessment_year} assessment is too high, file a Notice of Complaint by ${formatDueDateLabel(
            latestAssessment.appeal_deadline
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
          body: `Of your assessed value, ${formatMoneyShort(landVsBuilding.landValue)} is land and ${formatMoneyShort(
            landVsBuilding.improvementValue
          )} is buildings.`,
        });
      }
    }
    if (taxYoy) {
      const up = taxYoy.changeCents >= 0;
      insights.push({
        id: 'tax_change',
        severity: up && taxYoy.changePercent >= 8 ? 'warning' : 'info',
        title: `Property tax ${up ? 'up' : 'down'} ${formatMoneyShort(Math.abs(taxYoy.changeCents))}`,
        body: `Your property tax ${up ? 'increased' : 'decreased'} ${Math.abs(
          taxYoy.changePercent
        )}% versus the prior year.`,
      });
    }
    if (nextDue) {
      const d = daysUntil(nextDue.dueDate);
      if (d != null && d >= 0 && d <= 60) {
        insights.push({
          id: 'tax_due_soon',
          severity: 'warning',
          title: 'Property tax due soon',
          body: `${formatMoneyShort(nextDue.amount)} is due ${formatDueDateLabel(nextDue.dueDate)}${
            d <= 14 ? ` — only ${d} day${d === 1 ? '' : 's'} left.` : '.'
          }`,
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
      propertyTax: {
        latest: latestTax,
        history: taxHistory,
        yoy: taxYoy,
        nextDue,
      },
      stats,
      insights,
    };
  }

  // ============ DASHBOARD OVERVIEW ============

  async getDashboardOverview(householdId: string, userId: string) {
    await this.checkHouseholdAccess(householdId, userId);

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Get upcoming bills (not paid, due in next 30 days)
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const upcomingBills = await this.db
      .select()
      .from(utilityBills)
      .where(
        and(
          eq(utilityBills.household_id, householdId),
          isNull(utilityBills.paid_date),
          gte(utilityBills.due_date, now.toISOString().split('T')[0]),
          lte(utilityBills.due_date, thirtyDaysFromNow)
        )
      )
      .orderBy(asc(utilityBills.due_date))
      .limit(10)
      .all();

    const allBills = await this.db
      .select()
      .from(utilityBills)
      .where(eq(utilityBills.household_id, householdId))
      .all();

    const currentMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    // Single source of truth: the prorated monthly series drives EVERY headline
    // number (total, by-type breakdown, month-over-month change) as well as the
    // provider cards below — no separate ad-hoc month math that could disagree.
    const analytics = buildBillAnalytics(allBills, {
      startYear: currentYear - 1,
      endYear: currentYear,
    });
    const monthly = analytics.monthlyData; // ascending by monthKey

    // The literal current month is often empty — bills are usually logged after
    // their billing period ends — which made the hero + "By utility" read $0.00
    // while the provider cards showed a real /mo average (the "electricity is 0
    // but BC Hydro is $70/mo" contradiction). So summarize the most recent month
    // that actually has activity and tell the client which month that is.
    const latestActiveKey = monthly.length > 0 ? monthly[monthly.length - 1].month : null;
    const referenceMonthKey =
      latestActiveKey === null || monthly.some((m) => m.month === currentMonthKey)
        ? currentMonthKey
        : latestActiveKey;
    const prevMonthKey = monthKeyMinusOne(referenceMonthKey);

    const refRow = monthly.find((m) => m.month === referenceMonthKey);
    const currentMonthTotal = refRow?.total ?? 0;
    const prevMonthTotal = monthly.find((m) => m.month === prevMonthKey)?.total ?? 0;

    const currentMonthByType = {
      electricity: refRow?.byType.electricity ?? 0,
      gas: refRow?.byType.gas ?? 0,
      water: refRow?.byType.water ?? 0,
    };

    const periodIsCurrent = referenceMonthKey === currentMonthKey;

    // Get municipality config
    const municipality = await this.detectMunicipalityForHousehold(householdId, userId);

    return {
      upcomingBills,
      currentMonthTotal,
      prevMonthTotal,
      change: currentMonthTotal - prevMonthTotal,
      changePercent: prevMonthTotal > 0 ? ((currentMonthTotal - prevMonthTotal) / prevMonthTotal) * 100 : 0,
      currentMonthByType,
      // Which month the headline numbers summarize, so the client labels it
      // honestly ("This month" vs "June 2026") instead of a hardcoded header.
      periodMonthKey: referenceMonthKey,
      periodLabel: periodIsCurrent ? 'This month' : formatMonthLabel(referenceMonthKey),
      periodIsCurrent,
      byProvider: analytics.byProvider,
      insights: analytics.insights,
      municipality,
    };
  }

  // ============ REMINDERS ============

  async scheduleBillReminders(
    householdId: string,
    userId: string,
    billId: string,
    dueDate: string,
    reminderDays: number[] = [14, 7, 3, 1]
  ): Promise<UtilityReminder[]> {
    await this.checkHouseholdAccess(householdId, userId);

    // The bill must actually exist, in THIS household. Without this,
    // `POST /bills/<nonexistent>/reminders` returned 201 and wrote reminder
    // rows whose bill_id pointed at nothing — invisible orphans that the
    // `utility_reminders.bill_id` cascade could never clean up, because there
    // was no bill to delete.
    const bill = await this.db
      .select({ id: utilityBills.id })
      .from(utilityBills)
      .where(and(eq(utilityBills.id, billId), eq(utilityBills.household_id, householdId)))
      .get();

    if (!bill) {
      throw new NotFoundError('Utility bill not found');
    }

    // Cancel existing reminders for this bill. Re-checks membership inside —
    // redundant with the check above, and deliberately so: the guarantee lives
    // on the method, not on its callers.
    await this.cancelBillReminders(householdId, billId, userId);

    const reminders: UtilityReminder[] = [];
    const due = new Date(dueDate);

    for (const daysBefore of reminderDays) {
      const reminderDate = new Date(due);
      reminderDate.setDate(reminderDate.getDate() - daysBefore);

      // Only schedule if reminder date is in the future
      if (reminderDate > new Date()) {
        const id = crypto.randomUUID();
        const reminder: UtilityReminder = {
          id,
          household_id: householdId,
          bill_id: billId,
          reminder_type: 'payment_due',
          scheduled_for: reminderDate.toISOString(),
          sent_at: null,
          reminder_days_before: daysBefore,
          notification_channel: 'push',
          created_at: nowIso(),
        };

        await this.db.insert(utilityReminders).values(reminder);
        reminders.push(reminder);
      }
    }

    // Schedule overdue reminder — but only if it is still ahead of us.
    //
    // This insert used to be unconditional, unlike the payment_due rows above
    // which are guarded by `reminderDate > new Date()`. Because
    // `createUtilityBill` schedules reminders for EVERY new bill, importing a
    // historical bill — or one created already paid — wrote an `overdue` row
    // dated in the past. Adding a 2024 bill in 2026 queued an overdue reminder
    // for 2024, and a bill paid five days early still got one for its due date.
    const overdueDate = new Date(due);
    overdueDate.setHours(overdueDate.getHours() + 12);

    if (overdueDate > new Date()) {
      const overdueId = crypto.randomUUID();
      const overdueReminder: UtilityReminder = {
        id: overdueId,
        household_id: householdId,
        bill_id: billId,
        reminder_type: 'overdue',
        scheduled_for: overdueDate.toISOString(),
        sent_at: null,
        reminder_days_before: null,
        notification_channel: 'push',
        created_at: nowIso(),
      };

      await this.db.insert(utilityReminders).values(overdueReminder);
      reminders.push(overdueReminder);
    }

    return reminders;
  }

  /**
   * Membership is enforced here, not just at the route. This was the ONLY
   * public method on this service that never called `checkHouseholdAccess` —
   * `getReminders` directly below it always has — so any authenticated caller
   * could delete another household's reminders just by putting that
   * household's id in the URL. The route called `getUserId(c)` and threw the
   * result away, which is what made the omission easy to miss.
   */
  async cancelBillReminders(householdId: string, billId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.db
      .delete(utilityReminders)
      .where(and(eq(utilityReminders.household_id, householdId), eq(utilityReminders.bill_id, billId)));
  }

  async getReminders(householdId: string, userId: string, filters?: { sent?: boolean; type?: string }) {
    await this.checkHouseholdAccess(householdId, userId);

    const conditions = [eq(utilityReminders.household_id, householdId)];

    if (filters?.sent !== undefined) {
      if (filters.sent) {
        conditions.push(sql`${utilityReminders.sent_at} IS NOT NULL`);
      } else {
        conditions.push(isNull(utilityReminders.sent_at));
      }
    }

    if (filters?.type) {
      conditions.push(eq(utilityReminders.reminder_type, filters.type));
    }

    return this.db
      .select()
      .from(utilityReminders)
      .where(and(...conditions))
      .orderBy(asc(utilityReminders.scheduled_for))
      .all();
  }

  // ============ ANALYTICS & TRENDS ============

  async getAnalytics(
    householdId: string,
    userId: string,
    filters: {
      startYear?: number;
      endYear?: number;
      utilityType?: string;
      providerKey?: string;
    }
  ) {
    await this.checkHouseholdAccess(householdId, userId);

    const bills = await this.db
      .select()
      .from(utilityBills)
      .where(eq(utilityBills.household_id, householdId))
      .all();

    const analytics = buildBillAnalytics(bills, {
      startYear: filters.startYear,
      endYear: filters.endYear,
      utilityType: filters.utilityType,
      providerKey: filters.providerKey as ProviderKey | undefined,
    });

    const endYear = filters.endYear || new Date().getFullYear();
    const currentYearMonths = analytics.monthlyData.filter((m) =>
      m.month.startsWith(String(endYear))
    );
    const previousYearMonths = analytics.monthlyData.filter((m) =>
      m.month.startsWith(String(endYear - 1))
    );
    const currentYearTotal = currentYearMonths.reduce((sum, m) => sum + m.total, 0);
    const previousYearTotal = previousYearMonths.reduce((sum, m) => sum + m.total, 0);

    return {
      ...analytics,
      yearOverYear: {
        currentYear: {
          year: endYear,
          total: currentYearTotal,
          count: currentYearMonths.length,
        },
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
  }

  async calculateTrends(householdId: string, userId: string, year: number, month?: number): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    const startDate = month
      ? `${year}-${String(month).padStart(2, '0')}-01`
      : `${year}-01-01`;
    const endDate = month
      ? `${year}-${String(month).padStart(2, '0')}-31`
      : `${year}-12-31`;

    const bills = await this.db
      .select()
      .from(utilityBills)
      .where(
        and(
          eq(utilityBills.household_id, householdId),
          gte(utilityBills.billing_period_start, startDate),
          lte(utilityBills.billing_period_end, endDate)
        )
      )
      .all();

    // Group by utility type
    const byType: Record<string, UtilityBill[]> = {};
    for (const bill of bills) {
      if (!byType[bill.bill_type]) {
        byType[bill.bill_type] = [];
      }
      byType[bill.bill_type].push(bill);
    }

    // Calculate and store trends
    for (const [utilityType, typeBills] of Object.entries(byType)) {
      const totalAmount = typeBills.reduce((sum, b) => sum + b.amount, 0);
      const averageAmount = typeBills.length > 0 ? totalAmount / typeBills.length : 0;
      const usageTotal = typeBills.reduce((sum, b) => sum + (b.usage_quantity || 0), 0);
      const usageAverage = typeBills.length > 0 ? usageTotal / typeBills.length : 0;

      // Get previous period for comparison
      const prevStartDate = month
        ? month === 1
          ? `${year - 1}-12-01`
          : `${year}-${String(month - 1).padStart(2, '0')}-01`
        : `${year - 1}-01-01`;
      const prevEndDate = month
        ? month === 1
          ? `${year - 1}-12-31`
          : `${year}-${String(month - 1).padStart(2, '0')}-31`
        : `${year - 1}-12-31`;

      const prevBills = await this.db
        .select()
        .from(utilityBills)
        .where(
          and(
            eq(utilityBills.household_id, householdId),
            eq(utilityBills.bill_type, utilityType),
            gte(utilityBills.billing_period_start, prevStartDate),
            lte(utilityBills.billing_period_end, prevEndDate)
          )
        )
        .all();

      const prevTotal = prevBills.reduce((sum, b) => sum + b.amount, 0);
      const changeFromPrevious = totalAmount - prevTotal;
      const changePercent = prevTotal > 0 ? (changeFromPrevious / prevTotal) * 100 : 0;

      const trendId = crypto.randomUUID();
      const trend: UtilityTrend = {
        id: trendId,
        household_id: householdId,
        utility_type: utilityType,
        year,
        month: month || null,
        total_amount: totalAmount,
        average_amount: averageAmount,
        change_from_previous: changeFromPrevious,
        change_percent: changePercent,
        usage_total: usageTotal || null,
        usage_average: usageAverage || null,
        created_at: nowIso(),
      };

      // Upsert trend
      await this.db
        .insert(utilityTrends)
        .values(trend)
        .onConflictDoUpdate({
          target: [
            utilityTrends.household_id,
            utilityTrends.utility_type,
            utilityTrends.year,
            utilityTrends.month,
          ],
          set: {
            total_amount: trend.total_amount,
            average_amount: trend.average_amount,
            change_from_previous: trend.change_from_previous,
            change_percent: trend.change_percent,
            usage_total: trend.usage_total,
            usage_average: trend.usage_average,
          },
        });
    }
  }

  // ============ PENALTY CALCULATION ============

  calculatePropertyTaxPenalties(
    tax: PropertyTax,
    municipality: MunicipalityConfig | null,
    paymentDate?: string
  ): Array<{ date: string; percentage: number; amount: number }> {
    const penalties: Array<{ date: string; percentage: number; amount: number }> = [];
    const dueDate = new Date(tax.main_payment_due_date);
    const paidDate = paymentDate ? new Date(paymentDate) : tax.main_payment_paid_date ? new Date(tax.main_payment_paid_date) : new Date();

    // If already paid on time, no penalties
    if (tax.main_payment_paid_date) {
      const actualPaidDate = new Date(tax.main_payment_paid_date);
      if (actualPaidDate <= dueDate) {
        return penalties;
      }
    }

    // If checking future payment date and it's before due date, no penalties
    if (paymentDate && new Date(paymentDate) <= dueDate) {
      return penalties;
    }

    if (!municipality || !municipality.penalty_structure) {
      return penalties;
    }

    // Parse penalty structure (stored as JSON string in DB)
    let penaltyStructure: Array<{ daysAfterDue: number; percentage: number }> = [];
    try {
      penaltyStructure = typeof municipality.penalty_structure === 'string'
        ? JSON.parse(municipality.penalty_structure)
        : municipality.penalty_structure;
    } catch (e) {
      console.error('Error parsing penalty structure:', e);
      return penalties;
    }

    const daysOverdue = Math.floor((paidDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    const baseAmount = tax.main_payment_amount;

    // Calculate cumulative penalties
    for (const penalty of penaltyStructure) {
      if (daysOverdue >= penalty.daysAfterDue) {
        const penaltyAmount = Math.round((baseAmount * penalty.percentage) / 100);
        penalties.push({
          date: new Date(dueDate.getTime() + penalty.daysAfterDue * 24 * 60 * 60 * 1000).toISOString(),
          percentage: penalty.percentage,
          amount: penaltyAmount,
        });
      }
    }

    return penalties;
  }

  // ============ HOME OWNER GRANT CALCULATION ============

  calculateHomeOwnerGrant(
    assessedValue: number, // in cents
    isSenior: boolean = false,
    isVeteran: boolean = false,
    isDisabled: boolean = false,
    isRural: boolean = false
  ): { eligible: boolean; amount: number; threshold: number } {
    // 2026 Home Owner Grant amounts (in cents).
    //
    // The grant AMOUNT varies by region, not just the threshold. Both constants
    // used to be hardcoded to the northern-and-rural figures ($770 / $1,045) and
    // handed to every claimant, while `isRural` moved only ADDITIONAL_THRESHOLD.
    // A Vancouver homeowner was therefore quoted $770 instead of $570, and
    // `isRural: true` vs `false` returned byte-identical results for anyone not
    // claiming the additional grant. The repo's own Surrey fixture
    // (utilities.test.ts) carries basicGrant 570 / additionalGrant 845, which is
    // the non-rural pair — it disagreed with this calculator.
    //
    // Source: gov.bc.ca Home Owner Grant, 2026 amounts.
    // NOTE FOR 2027: the province has legislated the northern-and-rural top-up
    // away effective 2027-01-01 — the regular grant becomes $570 and the
    // additional $845 EVERYWHERE. This function is not year-aware; when 2027
    // rates land, gate these on the tax year rather than editing in place.
    const REGULAR_GRANT = isRural ? 77000 : 57000; // $770 northern/rural, else $570
    const ADDITIONAL_GRANT = isRural ? 104500 : 84500; // $1,045 northern/rural, else $845
    const REGULAR_THRESHOLD = 207500000; // $2,075,000
    const ADDITIONAL_THRESHOLD = isRural ? 228400000 : 224400000; // $2,284,000 (rural) or $2,244,000 (regular)
    const PHASE_OUT_RATE = 5; // $5 reduction per $1,000 over threshold

    const baseGrant = isSenior || isVeteran || isDisabled ? ADDITIONAL_GRANT : REGULAR_GRANT;
    const threshold = isSenior || isVeteran || isDisabled ? ADDITIONAL_THRESHOLD : REGULAR_THRESHOLD;

    if (assessedValue <= threshold) {
      return {
        eligible: true,
        amount: baseGrant,
        threshold,
      };
    }

    // Calculate phase-out
    const overThreshold = assessedValue - threshold;
    const reduction = Math.round((overThreshold / 100000) * PHASE_OUT_RATE * 100); // Convert to cents
    const grantAmount = Math.max(0, baseGrant - reduction);

    return {
      eligible: grantAmount > 0,
      amount: grantAmount,
      threshold,
    };
  }

  // ============ PROPERTY TAX DUE DATE CALCULATION ============

  calculatePropertyTaxDueDate(
    taxYear: number,
    municipality: MunicipalityConfig | null,
    paymentType: 'advance' | 'main' = 'main'
  ): string {
    if (!municipality) {
      // Default to July 2 if no municipality
      return `${taxYear}-07-02`;
    }

    const dueDateStr = paymentType === 'advance'
      ? municipality.property_tax_advance_due_date || null
      : municipality.property_tax_main_due_date;

    if (!dueDateStr) {
      return `${taxYear}-07-02`; // Default
    }

    // Parse date string like "July 2" or "July 3"
    const monthMap: Record<string, number> = {
      january: 1,
      february: 2,
      march: 3,
      april: 4,
      may: 5,
      june: 6,
      july: 7,
      august: 8,
      september: 9,
      october: 10,
      november: 11,
      december: 12,
    };

    const parts = dueDateStr.toLowerCase().trim().split(/\s+/);
    const monthName = parts[0];
    const day = parseInt(parts[1]);

    const month = monthMap[monthName];
    if (!month || !day) {
      return `${taxYear}-07-02`; // Default fallback
    }

    return `${taxYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // ============ UTILITY PROVIDERS ============

  async getUtilityProviders(type?: string): Promise<UtilityProvider[]> {
    const conditions = [];
    if (type) {
      conditions.push(eq(utilityProviders.type, type));
    }

    if (conditions.length > 0) {
      return this.db.select().from(utilityProviders).where(and(...conditions)).all();
    }

    return this.db.select().from(utilityProviders).all();
  }

  // ============ SEEDING HELPERS ============

  async seedUtilityProviders(): Promise<void> {
    const { BC_UTILITY_PROVIDERS } = await import('../utils/bc-providers');

    for (const provider of BC_UTILITY_PROVIDERS) {
      await this.db
        .insert(utilityProviders)
        .values({
          id: provider.id,
          name: provider.name,
          type: provider.type,
          service_area: provider.service_area,
          website_url: provider.website_url,
          portal_url: provider.portal_url,
          billing_cycle: provider.billing_cycle,
          contact_phone: provider.contact_phone,
          contact_email: provider.contact_email || null,
          created_at: nowIso(),
        })
        .onConflictDoUpdate({
          target: utilityProviders.id,
          set: {
            name: provider.name,
            type: provider.type,
            service_area: provider.service_area,
            website_url: provider.website_url,
            portal_url: provider.portal_url,
            billing_cycle: provider.billing_cycle,
            contact_phone: provider.contact_phone,
            contact_email: provider.contact_email || null,
          },
        });
    }
  }

  async seedMunicipalityConfigs(): Promise<void> {
    const { MUNICIPALITY_CONFIGS } = await import('../utils/municipality-configs');

    for (const config of MUNICIPALITY_CONFIGS) {
      await this.db
        .insert(municipalityConfigs)
        .values({
          id: config.id,
          municipality_name: config.municipality_name,
          municipality_code: config.municipality_code,
          property_tax_advance_due_date: config.property_tax_advance_due_date || null,
          property_tax_main_due_date: config.property_tax_main_due_date,
          utility_due_date: config.utility_due_date || null,
          early_discount_percentage: config.early_discount_percentage || null,
          penalty_structure: JSON.stringify(config.penalty_structure),
          portal_url: config.portal_url,
          contact_phone: config.contact_phone,
          contact_email: config.contact_email || null,
          created_at: nowIso(),
          updated_at: nowIso(),
        })
        .onConflictDoUpdate({
          target: [municipalityConfigs.municipality_code],
          set: {
            property_tax_advance_due_date: config.property_tax_advance_due_date || null,
            property_tax_main_due_date: config.property_tax_main_due_date,
            utility_due_date: config.utility_due_date || null,
            early_discount_percentage: config.early_discount_percentage || null,
            penalty_structure: JSON.stringify(config.penalty_structure),
            portal_url: config.portal_url,
            contact_phone: config.contact_phone,
            contact_email: config.contact_email || null,
            updated_at: nowIso(),
          },
        });
    }
  }
}
