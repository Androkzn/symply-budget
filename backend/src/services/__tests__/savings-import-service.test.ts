/**
 * savings-import-service.ts — AI-import commit / mapping / truncation tests.
 *
 * The AIProvider is a STUB (no real Anthropic call). Coverage:
 *  - commit writes ALL income → savings_income_entries (recurring flagged, NOT
 *    written as templates), spending → entries, recurring → recurring_payments;
 *  - resolves member/category names;
 *  - idempotent on re-commit (deterministic id → no double rows);
 *  - truncation path: stub provider THROWS (MalformedGenerateJSONError) →
 *    status 'failed' + 'IMPORT_PARSE_FAILED', NOT committed, ZERO partial rows;
 *  - CSV deterministic path performs no model call.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { MalformedGenerateJSONError } from '../../ai/fallback';
import type { AIProvider } from '../../ai/provider';
import * as schema from '../../db/schema';
import {
  savingsCategories,
  savingsIncomeEntries,
  savingsSpendingEntries,
  savingsRecurringPayments,
  savingsIncomeTemplates,
  savingsImportJobs,
} from '../../db/schema-savings';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import {
  SavingsImportService,
  SavingsImportError,
  type SavingsImportDraft,
} from '../savings-import-service';

const testEnv = env as unknown as Env;
const HID = 'hh_savings_import_01';
const UID = 'u_savings_import_owner';
const MID = 'm_savings_import_owner';

// ---- savings tables (no shared helper exists yet) ----

async function createSavingsTables(db: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS savings_categories (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT,
      color TEXT,
      is_essential INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS savings_income_entries (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      member_id TEXT,
      source_type TEXT NOT NULL,
      label TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      income_date TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CAD',
      notes TEXT,
      template_id TEXT,
      period TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      import_batch_id TEXT,
      status TEXT NOT NULL DEFAULT 'confirmed',
      rolled_over_from_entry_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS savings_spending_entries (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      category_id TEXT,
      label TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CAD',
      spending_date TEXT NOT NULL,
      notes TEXT,
      recurring_payment_id TEXT,
      period TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS savings_recurring_payments (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      category_id TEXT,
      label TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CAD',
      day_of_month INTEGER,
      group_label TEXT,
      is_essential INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      is_automated INTEGER NOT NULL DEFAULT 0,
      scope_type TEXT NOT NULL DEFAULT 'all_year',
      scope_year INTEGER,
      active_months TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS savings_income_templates (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      member_id TEXT,
      source_type TEXT NOT NULL,
      label TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CAD',
      day_of_month INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS savings_import_jobs (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_upload',
      source_kind TEXT NOT NULL,
      file_key TEXT,
      file_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      content_hash TEXT,
      raw_text TEXT,
      draft_json TEXT,
      error TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ];
  for (const sql of statements) {
    await db.exec(sql.replace(/\s+/g, ' ').trim());
  }
}

async function resetSavingsTables(db: D1Database): Promise<void> {
  for (const t of [
    'savings_import_jobs',
    'savings_recurring_payments',
    'savings_spending_entries',
    'savings_income_entries',
    'savings_income_templates',
    'savings_categories',
  ]) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // ignore
    }
  }
}

// ---- provider stubs ----

const FIXED_DRAFT: SavingsImportDraft = {
  income: [
    {
      member_name: 'Sarah Chen',
      source_type: 'payroll',
      label: 'Salary',
      amount_cents: 500000,
      income_date: '2026-07-01',
      is_recurring: true,
      day_of_month: 1,
    },
    {
      member_name: null,
      source_type: 'rental',
      label: 'Apartment rent',
      amount_cents: 180000,
      income_date: '2026-07-01',
      is_recurring: true,
      day_of_month: 1,
    },
  ],
  spending: [
    {
      category_name: 'Groceries',
      label: 'Costco run',
      amount_cents: 24500,
      spending_date: '2026-07-02',
    },
  ],
  recurringPayments: [
    {
      label: 'Netflix',
      amount_cents: 1699,
      category_name: 'Subscriptions',
      day_of_month: 15,
      group_label: 'Streaming',
      is_essential: false,
    },
    {
      label: 'Rent',
      amount_cents: 220000,
      category_name: null,
      day_of_month: 1,
      group_label: null,
      is_essential: true,
    },
  ],
};

/** A provider whose generateStructured returns a fixed draft (no throw). */
function okProvider(): { provider: AIProvider; generateStructured: ReturnType<typeof vi.fn> } {
  const generateStructured = vi.fn(async () => FIXED_DRAFT);
  return {
    provider: { generateStructured } as unknown as AIProvider,
    generateStructured,
  };
}

/** A provider whose generateStructured throws — simulates a max_tokens cutoff. */
function throwingProvider(): { provider: AIProvider; generateStructured: ReturnType<typeof vi.fn> } {
  const generateStructured = vi.fn(async () => {
    throw new MalformedGenerateJSONError('Claude response did not include a tool_use block');
  });
  return {
    provider: { generateStructured } as unknown as AIProvider,
    generateStructured,
  };
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createSavingsTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetSavingsTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({
    id: UID,
    email: 'sarah@example.com',
    email_verified: true,
    display_name: 'Sarah Chen',
  });
  await db.insert(schema.households).values({ id: HID, name: 'SavingsImportTest' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2026-01-01T00:00:00Z',
  });
  // A pre-existing "Groceries" category so member/category resolution can match.
  await db.insert(savingsCategories).values({
    id: 'cat_groceries',
    household_id: HID,
    name: 'Groceries',
  });
}

/** Seed a ready-to-commit job carrying the fixed draft. */
async function seedReadyJob(jobId: string): Promise<void> {
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(savingsImportJobs).values({
    id: jobId,
    household_id: HID,
    status: 'ready',
    source_kind: 'text',
    draft_json: JSON.stringify(FIXED_DRAFT),
    created_by: UID,
  });
}

describe('SavingsImportService', () => {
  beforeEach(async () => {
    await seed();
    testEnv.ANTHROPIC_API_KEY = 'test-key';
    testEnv.AIHOUSEKEEPER_NUDGE_MODEL = 'claude-haiku-4-5-20251001';
    testEnv.AIHOUSEKEEPER_FALLBACK_MODEL = 'claude-sonnet-4-5-20250929';
  });

  it('commit writes ALL income, spending, and recurring rows and resolves names', async () => {
    const jobId = 'job_commit_ok';
    await seedReadyJob(jobId);

    const { provider } = okProvider();
    const service = new SavingsImportService(testEnv, testEnv.DB, provider);

    const counts = await service.commit(HID, UID, jobId, FIXED_DRAFT);
    expect(counts).toEqual({ income: 2, spending: 1, recurringPayments: 2 });

    const db = drizzle(testEnv.DB, { schema });

    // ALL income → savings_income_entries (recurring flagged, NOT templates).
    const income = await db
      .select()
      .from(savingsIncomeEntries)
      .where(eq(savingsIncomeEntries.household_id, HID))
      .all();
    expect(income).toHaveLength(2);
    // member_name 'Sarah Chen' resolved to the owner member id.
    const salary = income.find((r) => r.label === 'Salary');
    expect(salary?.member_id).toBe(MID);
    expect(salary?.source_type).toBe('payroll');
    // Unmatched member_name (null) → null member_id.
    const rentIncome = income.find((r) => r.label === 'Apartment rent');
    expect(rentIncome?.member_id).toBeNull();

    // NO templates written in Phase 5.
    const templates = await db.select().from(savingsIncomeTemplates).all();
    expect(templates).toHaveLength(0);

    // spending → entries, category resolved to the existing "Groceries" id.
    const spending = await db.select().from(savingsSpendingEntries).all();
    expect(spending).toHaveLength(1);
    expect(spending[0]?.category_id).toBe('cat_groceries');

    // recurring → savings_recurring_payments with source 'ai_import'.
    const recurring = await db.select().from(savingsRecurringPayments).all();
    expect(recurring).toHaveLength(2);
    expect(recurring.every((r) => r.source === 'ai_import')).toBe(true);
    // A new category name ("Subscriptions") was lazily created and resolved.
    const netflix = recurring.find((r) => r.label === 'Netflix');
    expect(netflix?.category_id).toBeTruthy();
    const cats = await db.select().from(savingsCategories).all();
    expect(cats.some((c) => c.name === 'Subscriptions')).toBe(true);

    // Job marked committed.
    const job = await db
      .select()
      .from(savingsImportJobs)
      .where(eq(savingsImportJobs.id, jobId))
      .get();
    expect(job?.status).toBe('committed');
  });

  it('is idempotent on re-commit (deterministic id → no double rows)', async () => {
    const jobId = 'job_commit_idem';
    await seedReadyJob(jobId);

    const { provider } = okProvider();
    const service = new SavingsImportService(testEnv, testEnv.DB, provider);

    const first = await service.commit(HID, UID, jobId, FIXED_DRAFT);
    expect(first).toEqual({ income: 2, spending: 1, recurringPayments: 2 });

    // Re-commit is a no-op returning the prior counts.
    const second = await service.commit(HID, UID, jobId, FIXED_DRAFT);
    expect(second).toEqual({ income: 2, spending: 1, recurringPayments: 2 });

    const db = drizzle(testEnv.DB, { schema });
    const income = await db.select().from(savingsIncomeEntries).all();
    const spending = await db.select().from(savingsSpendingEntries).all();
    const recurring = await db.select().from(savingsRecurringPayments).all();
    // No duplicates despite the double commit.
    expect(income).toHaveLength(2);
    expect(spending).toHaveLength(1);
    expect(recurring).toHaveLength(2);
  });

  it('truncation path: provider throws → job failed IMPORT_PARSE_FAILED, zero rows', async () => {
    const jobId = 'job_analyze_trunc';
    const db = drizzle(testEnv.DB, { schema });
    // A text job to analyze (structuring will throw).
    await db.insert(savingsImportJobs).values({
      id: jobId,
      household_id: HID,
      status: 'uploaded',
      source_kind: 'text',
      raw_text: 'Salary 5000 monthly; Rent 2200; Netflix 16.99',
      created_by: UID,
    });

    const { provider, generateStructured } = throwingProvider();
    const service = new SavingsImportService(testEnv, testEnv.DB, provider);

    await expect(service.analyze(HID, UID, jobId)).rejects.toBeInstanceOf(SavingsImportError);
    expect(generateStructured).toHaveBeenCalled();

    // Job set failed with the bounded code — NEVER committed.
    const job = await db.select().from(savingsImportJobs).where(eq(savingsImportJobs.id, jobId)).get();
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe('IMPORT_PARSE_FAILED');
    expect(job?.draft_json).toBeNull();

    // ZERO partial savings_* rows written.
    const income = await db.select().from(savingsIncomeEntries).all();
    const spending = await db.select().from(savingsSpendingEntries).all();
    const recurring = await db.select().from(savingsRecurringPayments).all();
    expect(income).toHaveLength(0);
    expect(spending).toHaveLength(0);
    expect(recurring).toHaveLength(0);
  });

  it('CSV deterministic path performs no model call for the read step', async () => {
    const jobId = 'job_csv';
    const csv = 'label,amount,date\nGroceries,24.50,2026-07-02\nHydro,80.00,2026-07-05\n';
    const fileKey = `savings-imports/${HID}/${jobId}/data.csv`;
    await testEnv.REPORTS_BUCKET.put(fileKey, new TextEncoder().encode(csv));

    const db = drizzle(testEnv.DB, { schema });
    await db.insert(savingsImportJobs).values({
      id: jobId,
      household_id: HID,
      status: 'uploaded',
      source_kind: 'file',
      file_key: fileKey,
      file_name: 'data.csv',
      mime_type: 'text/csv',
      size_bytes: csv.length,
      created_by: UID,
    });

    // Provider that would EXPLODE if the CSV bytes were sent to a model read
    // (generate) — but returns a valid draft for the structuring pass.
    const generate = vi.fn(async () => {
      throw new Error('generate() must NOT be called for CSV read');
    });
    const generateStructured = vi.fn(async (_args: { userPrompt?: string }) => FIXED_DRAFT);
    const provider = { generate, generateStructured } as unknown as AIProvider;

    const service = new SavingsImportService(testEnv, testEnv.DB, provider);
    const draft = await service.analyze(HID, UID, jobId);

    // The CSV read did NOT call the model; only the structuring pass did.
    expect(generate).not.toHaveBeenCalled();
    expect(generateStructured).toHaveBeenCalledTimes(1);
    // The parsed CSV rows (not raw CSV) were handed to the structuring prompt.
    const userPrompt = generateStructured.mock.calls[0]?.[0]?.userPrompt as string;
    expect(userPrompt).toContain('Groceries');
    expect(userPrompt).toContain('Hydro');
    expect(draft.income).toHaveLength(2);

    const job = await db.select().from(savingsImportJobs).where(eq(savingsImportJobs.id, jobId)).get();
    expect(job?.status).toBe('ready');
  });

  // ==================================================================
  // Irregular (one-off) income through the AI import path
  // ==================================================================

  describe('irregular income sources', () => {
    /** Draft carrying a one-off marketplace sale alongside regular payroll. */
    const IRREGULAR_DRAFT: SavingsImportDraft = {
      income: [
        {
          member_name: 'Sarah Chen',
          source_type: 'payroll',
          label: 'Salary',
          amount_cents: 500000,
          income_date: '2026-07-01',
          is_recurring: true,
          day_of_month: 1,
        },
        {
          member_name: null,
          source_type: 'marketplace_sale',
          label: 'Sold couch on Marketplace',
          amount_cents: 12000,
          income_date: '2026-07-14',
          is_recurring: false,
          day_of_month: null,
        },
      ],
      spending: [],
      recurringPayments: [],
    };

    it('commits a one-off marketplace sale from an AI import draft', async () => {
      const jobId = 'job_commit_irregular';
      await seedReadyJob(jobId);

      const generateStructured = vi.fn(async () => IRREGULAR_DRAFT);
      const provider = { generateStructured } as unknown as AIProvider;
      const service = new SavingsImportService(testEnv, testEnv.DB, provider);

      const counts = await service.commit(HID, UID, jobId, IRREGULAR_DRAFT);
      expect(counts.income).toBe(2);

      const db = drizzle(testEnv.DB, { schema });
      const income = await db
        .select()
        .from(savingsIncomeEntries)
        .where(eq(savingsIncomeEntries.household_id, HID))
        .all();

      const sale = income.find((r) => r.label === 'Sold couch on Marketplace');
      // Before the irregular-income change this normalised to 'other' via the
      // draft schema's .catch() fallback, silently losing the classification.
      expect(sale?.source_type).toBe('marketplace_sale');
      expect(sale?.amount_cents).toBe(12000);

      // One-off income must never be promoted into a recurring template.
      const templates = await db.select().from(savingsIncomeTemplates).all();
      expect(templates).toHaveLength(0);
    });

    it('keeps a one-off source through analyze(), normalising only unknown ones', async () => {
      const jobId = 'job_analyze_irregular';
      const seedDb = drizzle(testEnv.DB, { schema });
      await seedDb.insert(savingsImportJobs).values({
        id: jobId,
        household_id: HID,
        status: 'uploaded',
        source_kind: 'text',
        raw_text: 'Sold couch on Marketplace 120; Scratch ticket 50',
        created_by: UID,
      });

      // The model returns one valid one-off source and one it invented.
      const modelDraft = {
        income: [
          { ...IRREGULAR_DRAFT.income[1] },
          {
            ...IRREGULAR_DRAFT.income[1],
            source_type: 'lottery_win',
            label: 'Scratch ticket',
          },
        ],
        spending: [],
        recurringPayments: [],
      };

      const generateStructured = vi.fn(async () => modelDraft);
      const provider = { generateStructured } as unknown as AIProvider;
      const service = new SavingsImportService(testEnv, testEnv.DB, provider);

      const draft = await service.analyze(HID, UID, jobId);

      const sale = draft.income.find((r) => r.label === 'Sold couch on Marketplace');
      expect(sale?.source_type).toBe('marketplace_sale');

      // `.catch('other')` still absorbs an off-domain value so one odd row
      // never fails the whole import.
      const bogus = draft.income.find((r) => r.label === 'Scratch ticket');
      expect(bogus?.source_type).toBe('other');
    });
  });
});
