import { and, eq } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import { householdMembers } from '../db/schema';
import {
  budgetRenewalDocuments,
  budgetRenewals,
  type BudgetRenewal,
  type BudgetRenewalDocument,
} from '../db/schema-budget-renewals';
import { savingsRecurringPayments } from '../db/schema-savings';
import type { Env } from '../types';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { generateId, nowIso } from '../utils/id';

import { cancelBudgetRenewalReminder, scheduleBudgetRenewalReminder } from './budget/renewal-reminder';

/**
 * Renewal tracking for one Monthly-Payments item (Savings → Monthly). A
 * household opts a `savings_recurring_payments` row into tracking a renewal —
 * provider, reference number, cycle, next due date, and optional attached
 * documents (policy, renewal notice, ...) — and the shared recurring-reminders
 * engine (`services/recurring-reminders/`, wired via `services/budget/renewal-reminder.ts`)
 * keeps nagging the household until either they mark it renewed or stop
 * tracking it.
 *
 * Household-scoped (not user-scoped, unlike `HealthAssetsService`'s files —
 * Budget data is shared across the household). Mirrors that service's
 * reserve → PUT bytes → proxied GET → delete attachment contract, re-scoped
 * per household membership instead of per user.
 */

export const RENEWAL_CATEGORIES = [
  'insurance',
  'warranty',
  'subscription',
  'membership',
  'license',
  'other',
] as const;
export type RenewalCategory = (typeof RENEWAL_CATEGORIES)[number];

export const RENEWAL_CYCLES = ['monthly', 'quarterly', 'semi_annual', 'annual', 'custom'] as const;
export type RenewalCycle = (typeof RENEWAL_CYCLES)[number];

export const RENEWAL_DOCUMENT_SOURCES = ['camera', 'gallery', 'file', 'drive', 'manual'] as const;
export type RenewalDocumentSource = (typeof RENEWAL_DOCUMENT_SOURCES)[number];

/** Donor-neutral cap — matches `HealthAssetsService.MAX_FILE_BYTES`. */
export const MAX_RENEWAL_DOCUMENT_BYTES = 50 * 1024 * 1024;

export const ALLOWED_RENEWAL_DOCUMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
];

const R2_KEY_PREFIX = 'budget-renewals';

function cycleMonths(cycle: RenewalCycle, customMonths: number | null): number {
  switch (cycle) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'semi_annual':
      return 6;
    case 'custom':
      return customMonths && customMonths > 0 ? customMonths : 12;
    case 'annual':
    default:
      return 12;
  }
}

/**
 * Add `months` to a `YYYY-MM-DD` date, clamping to the target month's last day
 * (Jan 31 + 1mo → Feb 28, not Mar 3) — same rule as
 * `mortgage/statement-reminder.ts`'s `computeStatementReminderDate`.
 */
export function addMonthsClamped(dateStr: string, months: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  const month0 = Number(match[2]) - 1;
  const day = Number(match[3]);
  const targetMonth0 = month0 + months;
  const lastDayOfTarget = new Date(Date.UTC(year, targetMonth0 + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDayOfTarget);
  const result = new Date(Date.UTC(year, targetMonth0, targetDay));
  return result.toISOString().slice(0, 10);
}

/** Strip a client-supplied file name to something safe for an R2 key + `Content-Disposition`. */
export function sanitizeRenewalFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\-() ]+/g, '_').slice(0, 255);
  return cleaned.trim() === '' ? 'file' : cleaned;
}

export interface UpsertRenewalInput {
  category?: RenewalCategory;
  provider?: string | null;
  reference_number?: string | null;
  cycle?: RenewalCycle;
  cycle_months?: number | null;
  next_renewal_date: string;
  renewal_amount_cents?: number | null;
  auto_renew?: boolean;
  reminder_lead_days?: number;
  notes?: string | null;
}

export class BudgetRenewalService {
  private db: DrizzleD1Database;
  private env: Env;
  private d1: D1Database;

  constructor(env: Env, d1: D1Database) {
    this.env = env;
    this.d1 = d1;
    this.db = drizzle(d1);
  }

  private async assertHouseholdMember(householdId: string, userId: string): Promise<void> {
    const member = await this.db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, userId)))
      .get();
    if (!member) throw new ForbiddenError('You do not have access to this household');
  }

  /** Validates the recurring payment belongs to this household; returns its label. */
  private async assertRecurringPayment(householdId: string, recurringPaymentId: string): Promise<string> {
    const payment = await this.db
      .select({ id: savingsRecurringPayments.id, label: savingsRecurringPayments.label })
      .from(savingsRecurringPayments)
      .where(
        and(
          eq(savingsRecurringPayments.id, recurringPaymentId),
          eq(savingsRecurringPayments.household_id, householdId)
        )
      )
      .get();
    if (!payment) throw new NotFoundError('Monthly payment not found');
    return payment.label;
  }

  private async getRenewalRow(householdId: string, recurringPaymentId: string): Promise<BudgetRenewal | null> {
    return (
      (await this.db
        .select()
        .from(budgetRenewals)
        .where(
          and(
            eq(budgetRenewals.household_id, householdId),
            eq(budgetRenewals.recurring_payment_id, recurringPaymentId)
          )
        )
        .get()) ?? null
    );
  }

  async getRenewal(
    householdId: string,
    userId: string,
    recurringPaymentId: string
  ): Promise<{ renewal: BudgetRenewal | null; documents: BudgetRenewalDocument[] }> {
    await this.assertHouseholdMember(householdId, userId);
    const renewal = await this.getRenewalRow(householdId, recurringPaymentId);
    if (!renewal) return { renewal: null, documents: [] };

    const documents = await this.db
      .select()
      .from(budgetRenewalDocuments)
      .where(eq(budgetRenewalDocuments.renewal_id, renewal.id))
      .all();
    return { renewal, documents };
  }

  async upsertRenewal(
    householdId: string,
    userId: string,
    recurringPaymentId: string,
    input: UpsertRenewalInput
  ): Promise<BudgetRenewal> {
    await this.assertHouseholdMember(householdId, userId);
    const label = await this.assertRecurringPayment(householdId, recurringPaymentId);

    const existing = await this.getRenewalRow(householdId, recurringPaymentId);
    const ts = nowIso();
    const id = existing?.id ?? generateId();
    const leadDays = input.reminder_lead_days ?? existing?.reminder_lead_days ?? 14;

    const row: typeof budgetRenewals.$inferInsert = {
      id,
      household_id: householdId,
      recurring_payment_id: recurringPaymentId,
      category: input.category ?? existing?.category ?? 'other',
      provider: input.provider ?? existing?.provider ?? null,
      reference_number: input.reference_number ?? existing?.reference_number ?? null,
      cycle: input.cycle ?? existing?.cycle ?? 'annual',
      cycle_months: input.cycle_months ?? existing?.cycle_months ?? null,
      next_renewal_date: input.next_renewal_date,
      renewal_amount_cents: input.renewal_amount_cents ?? existing?.renewal_amount_cents ?? null,
      auto_renew: input.auto_renew ?? existing?.auto_renew ?? false,
      reminder_lead_days: leadDays,
      status: 'upcoming',
      notes: input.notes ?? existing?.notes ?? null,
      last_renewed_at: existing?.last_renewed_at ?? null,
      renewal_count: existing?.renewal_count ?? 0,
      created_by: existing?.created_by ?? userId,
      created_at: existing?.created_at ?? ts,
      updated_at: ts,
    };

    if (existing) {
      await this.db.update(budgetRenewals).set(row).where(eq(budgetRenewals.id, id)).run();
    } else {
      await this.db.insert(budgetRenewals).values(row).run();
    }

    await scheduleBudgetRenewalReminder(this.env, this.d1, {
      householdId,
      renewalId: id,
      recurringPaymentId,
      recurringPaymentLabel: label,
      nextRenewalDate: row.next_renewal_date,
      leadDays,
    });

    return row as BudgetRenewal;
  }

  /** Advance to the next cycle and stop the current nag (a fresh one starts for the new date). */
  async markRenewed(householdId: string, userId: string, recurringPaymentId: string): Promise<BudgetRenewal> {
    await this.assertHouseholdMember(householdId, userId);
    const label = await this.assertRecurringPayment(householdId, recurringPaymentId);
    const existing = await this.getRenewalRow(householdId, recurringPaymentId);
    if (!existing) throw new NotFoundError('Renewal not tracked for this payment');

    const months = cycleMonths(existing.cycle as RenewalCycle, existing.cycle_months);
    const nextDate = addMonthsClamped(existing.next_renewal_date, months) ?? existing.next_renewal_date;
    const ts = nowIso();

    const updated: Partial<typeof budgetRenewals.$inferInsert> = {
      next_renewal_date: nextDate,
      status: 'upcoming',
      last_renewed_at: ts,
      renewal_count: existing.renewal_count + 1,
      updated_at: ts,
    };
    await this.db.update(budgetRenewals).set(updated).where(eq(budgetRenewals.id, existing.id)).run();

    await scheduleBudgetRenewalReminder(this.env, this.d1, {
      householdId,
      renewalId: existing.id,
      recurringPaymentId,
      recurringPaymentLabel: label,
      nextRenewalDate: nextDate,
      leadDays: existing.reminder_lead_days,
    });

    return { ...existing, ...updated } as BudgetRenewal;
  }

  async deleteRenewal(householdId: string, userId: string, recurringPaymentId: string): Promise<boolean> {
    await this.assertHouseholdMember(householdId, userId);
    const existing = await this.getRenewalRow(householdId, recurringPaymentId);
    if (!existing) return false;

    // Drop attachments' R2 objects before the cascade removes the metadata rows.
    const documents = await this.db
      .select()
      .from(budgetRenewalDocuments)
      .where(eq(budgetRenewalDocuments.renewal_id, existing.id))
      .all();
    for (const doc of documents) {
      await this.env.REPORTS_BUCKET.delete(doc.r2_key).catch(() => undefined);
    }

    await this.db.delete(budgetRenewals).where(eq(budgetRenewals.id, existing.id)).run();
    await cancelBudgetRenewalReminder(this.d1, existing.id);
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Documents (reserve → PUT bytes → proxied GET → delete)            */
  /* ---------------------------------------------------------------- */

  async createDocument(
    householdId: string,
    userId: string,
    recurringPaymentId: string,
    input: { file_name: string; mime_type: string; file_size: number; source: RenewalDocumentSource }
  ): Promise<{ document: BudgetRenewalDocument; upload: { upload_url: null; method: 'PUT'; path: string } }> {
    await this.assertHouseholdMember(householdId, userId);
    const renewal = await this.getRenewalRow(householdId, recurringPaymentId);
    if (!renewal) throw new NotFoundError('Renewal not tracked for this payment');

    if (!ALLOWED_RENEWAL_DOCUMENT_MIME_TYPES.includes(input.mime_type)) {
      throw new ForbiddenError('File type not allowed');
    }
    if (input.file_size > MAX_RENEWAL_DOCUMENT_BYTES) {
      throw new ForbiddenError(`File too large (max ${MAX_RENEWAL_DOCUMENT_BYTES} bytes)`);
    }

    const id = generateId();
    const safeName = sanitizeRenewalFileName(input.file_name);
    const r2Key = `${R2_KEY_PREFIX}/${householdId}/${renewal.id}/${id}-${safeName}`;
    const ts = nowIso();
    const row: typeof budgetRenewalDocuments.$inferInsert = {
      id,
      renewal_id: renewal.id,
      household_id: householdId,
      r2_key: r2Key,
      file_name: safeName,
      mime_type: input.mime_type,
      file_size: input.file_size,
      source: input.source,
      created_by: userId,
      created_at: ts,
    };
    await this.db.insert(budgetRenewalDocuments).values(row).run();

    return {
      document: row as BudgetRenewalDocument,
      upload: {
        upload_url: null,
        method: 'PUT',
        path: `/households/${householdId}/savings/recurring-payments/${recurringPaymentId}/renewal/documents/${id}/content`,
      },
    };
  }

  private async getDocumentRow(householdId: string, id: string) {
    return (
      (await this.db
        .select()
        .from(budgetRenewalDocuments)
        .where(and(eq(budgetRenewalDocuments.id, id), eq(budgetRenewalDocuments.household_id, householdId)))
        .get()) ?? null
    );
  }

  async putDocumentContent(
    householdId: string,
    userId: string,
    docId: string,
    body: ArrayBuffer
  ): Promise<BudgetRenewalDocument | null> {
    await this.assertHouseholdMember(householdId, userId);
    const row = await this.getDocumentRow(householdId, docId);
    if (!row) return null;

    await this.env.REPORTS_BUCKET.put(row.r2_key, body, {
      httpMetadata: { contentType: row.mime_type },
      customMetadata: { householdId, documentId: docId },
    });
    await this.db
      .update(budgetRenewalDocuments)
      .set({ file_size: body.byteLength })
      .where(eq(budgetRenewalDocuments.id, docId))
      .run();
    return { ...row, file_size: body.byteLength };
  }

  async getDocumentContent(
    householdId: string,
    userId: string,
    docId: string
  ): Promise<{ object: R2ObjectBody; document: BudgetRenewalDocument } | null> {
    await this.assertHouseholdMember(householdId, userId);
    const row = await this.getDocumentRow(householdId, docId);
    if (!row) return null;
    const object = await this.env.REPORTS_BUCKET.get(row.r2_key);
    if (!object) return null;
    return { object, document: row };
  }

  async deleteDocument(householdId: string, userId: string, docId: string): Promise<boolean> {
    await this.assertHouseholdMember(householdId, userId);
    const row = await this.getDocumentRow(householdId, docId);
    if (!row) return false;
    await this.env.REPORTS_BUCKET.delete(row.r2_key).catch(() => undefined);
    await this.db.delete(budgetRenewalDocuments).where(eq(budgetRenewalDocuments.id, docId)).run();
    return true;
  }
}
