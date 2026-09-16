/**
 * utilities.ts — dashboard proration, analytics, and bill upload extraction.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { ExtractedPropertyTax } from '../../ai/prompts/extract-property-tax';
import type { ExtractedUtilityBill } from '../../ai/prompts/extract-utility-bill';
import * as schema from '../../db/schema';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import bcHydroFixture from '../../utils/__tests__/fixtures/bc-hydro-bill.json';
import fortisFixture from '../../utils/__tests__/fixtures/fortisbc-bill.json';
import surreyPropertyTaxFixture from '../../utils/__tests__/fixtures/surrey-property-tax.json';
import utilitiesRouter from '../utilities';

import {
  createUtilitiesTables,
  createTaskSupportTables,
  resetUtilitiesTables,
} from './utilities-test-helpers';

const mockExtractFromR2 = vi.fn();

vi.mock('../../services/bill-extraction-service', () => ({
  BillExtractionService: class MockBillExtractionService {
    extractFromR2 = mockExtractFromR2;
    toCreateBillInput(extracted: ExtractedUtilityBill) {
      return {
        billType: extracted.provider.type,
        provider: extracted.provider.name || undefined,
        accountNumber: extracted.account.number || undefined,
        billingPeriodStart: extracted.billing.periodStart!,
        billingPeriodEnd: extracted.billing.periodEnd!,
        amount: Math.round((extracted.financial.amountDue ?? 0) * 100),
        dueDate: extracted.billing.dueDate!,
        usageQuantity: extracted.usage.quantity || undefined,
        usageUnit: extracted.usage.unit || undefined,
        aiExtractedData: extracted,
        confidenceScore: extracted.confidence.overall,
      };
    }
  },
}));

// BC Assessment extraction is mocked the same way: extractFromR2 is stubbed per
// test; toCreateBCAssessmentInput mirrors the real dollars→cents conversion so
// the upload route's response shape stays honest. (The real converter's own
// logic is unit-tested in bc-assessment-extraction-service.test.ts.)
const mockAssessmentExtractFromR2 = vi.fn();

vi.mock('../../services/bc-assessment-extraction-service', () => ({
  BCAssessmentExtractionService: class MockBCAssessmentExtractionService {
    extractFromR2 = mockAssessmentExtractFromR2;
    toCreateBCAssessmentInput(extracted: {
      assessmentYear: number | null;
      property: { propertyClass: string | null };
      values: {
        totalValue: number | null;
        landValue: number | null;
        improvementValue: number | null;
        previousYearValue: number | null;
      };
      appealDeadline: string | null;
      confidence: { overall: number };
    }) {
      const toCents = (v: number) => Math.round(v * 100);
      const total = extracted.values.totalValue!;
      const prev = extracted.values.previousYearValue;
      return {
        assessmentYear: extracted.assessmentYear!,
        propertyClass: extracted.property.propertyClass || undefined,
        assessedValue: toCents(total),
        landValue: extracted.values.landValue != null ? toCents(extracted.values.landValue) : undefined,
        improvementValue:
          extracted.values.improvementValue != null ? toCents(extracted.values.improvementValue) : undefined,
        previousYearValue: prev != null ? toCents(prev) : undefined,
        changePercent: prev != null && prev > 0 ? Math.round(((total - prev) / prev) * 1000) / 10 : undefined,
        appealDeadline: extracted.appealDeadline || undefined,
        confidenceScore: extracted.confidence.overall,
      };
    }
    toBackfillHistoryInputs(extracted: {
      assessmentYear: number | null;
      property: { propertyClass: string | null };
      valueHistory?: Array<{
        year: number;
        totalValue: number | null;
        landValue: number | null;
        improvementValue: number | null;
      }>;
    }) {
      const toCents = (v: number) => Math.round(v * 100);
      const history = extracted.valueHistory ?? [];
      return history
        .filter((h) => h.year !== extracted.assessmentYear && h.totalValue != null)
        .map((h) => ({
          assessmentYear: h.year,
          propertyClass: extracted.property.propertyClass || undefined,
          assessedValue: toCents(h.totalValue as number),
          landValue: h.landValue != null ? toCents(h.landValue) : undefined,
          improvementValue: h.improvementValue != null ? toCents(h.improvementValue) : undefined,
        }));
    }
  },
}));

// Property tax extraction is mocked the same way: extractFromR2 is stubbed per
// test; toCreatePropertyTaxInput mirrors the real dollars→cents conversion so
// the upload route's response shape stays honest. (The real converter's own
// logic is unit-tested in property-tax-extraction-service.test.ts.)
const mockPropertyTaxExtractFromR2 = vi.fn();

vi.mock('../../services/property-tax-extraction-service', () => ({
  PropertyTaxExtractionService: class MockPropertyTaxExtractionService {
    extractFromR2 = mockPropertyTaxExtractFromR2;
    toCreatePropertyTaxInput(extracted: ExtractedPropertyTax) {
      const toCents = (v: number) => Math.round(v * 100);
      const totalTax = extracted.financial.totalTaxAmount!;
      const mainAmount = extracted.payment.mainAmount ?? totalTax;
      return {
        taxYear: extracted.taxYear!,
        assessedValue: extracted.assessedValue != null ? toCents(extracted.assessedValue) : 0,
        taxAmount: toCents(totalTax),
        mainPaymentAmount: toCents(mainAmount),
        mainPaymentDueDate: extracted.payment.mainDueDate!,
        advancePaymentAmount:
          extracted.payment.advanceAmount != null ? toCents(extracted.payment.advanceAmount) : undefined,
        advancePaymentDueDate: extracted.payment.advanceDueDate || undefined,
        homeownerGrantEligible: extracted.homeownerGrant.eligible,
        homeownerGrantAmount:
          extracted.homeownerGrant.basicAmount != null
            ? toCents(extracted.homeownerGrant.basicAmount)
            : undefined,
        municipalityName: extracted.municipality.name || undefined,
        confidenceScore: extracted.confidence.overall,
      };
    }
  },
}));

const assessmentFixture = {
  assessmentYear: 2026,
  property: {
    address: '8138 138 St',
    rollNumber: '6282-89962-0',
    jurisdiction: 'Surrey',
    jurisdictionNumber: '326',
    pid: '003-110-320',
    propertyClass: '01 - Residential',
    ownerName: null,
    owners: [],
    legalDescription: null,
  },
  propertyInfo: {
    yearBuilt: 1983,
    description: '1 STY house - Standard',
    bedrooms: 4,
    bathrooms: 2,
    carports: null,
    garages: 'G',
    landSizeSqFt: 6986,
    firstFloorAreaSqFt: 1044,
    secondFloorAreaSqFt: null,
    basementFinishAreaSqFt: 808,
    strataAreaSqFt: null,
    buildingStoreys: 1,
    grossLeasableAreaSqFt: null,
    netLeasableAreaSqFt: null,
    manufacturedHome: null,
  },
  values: {
    totalValue: 1181000,
    landValue: 920000,
    improvementValue: 261000,
    previousYearValue: 1050000,
  },
  valueHistory: [
    { year: 2026, totalValue: 1181000, landValue: 1081000, improvementValue: 100000, exemptValue: 0, netValue: 1181000, changePercent: -5 },
    { year: 2025, totalValue: 1245000, landValue: 1196000, improvementValue: 49000, exemptValue: 0, netValue: 1245000, changePercent: -1 },
    { year: 2024, totalValue: 1260300, landValue: 1200000, improvementValue: 60300, exemptValue: 0, netValue: 1260300, changePercent: 0 },
  ],
  salesHistory: [{ date: '2025-06-12', price: 1220000 }],
  homeownerGrant: { basicGrant: 570, additionalGrant: 845, grantClaimed: 0 },
  appealDeadline: '2026-01-31',
  confidence: { overall: 0.9, assessmentYear: 0.95, values: 0.9, property: 0.85 },
  rawText: '',
};

const testEnv = env as unknown as Env;
const HID = 'hh_utilities_test';
const UID = 'u_utilities_owner';
const MID = 'm_utilities_owner';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum');
  return new jose.SignJWT({
    sub: userId,
    email: `${userId}@example.com`,
    email_verified: true,
  } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/households/:householdId/utilities', utilitiesRouter);
  return app;
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createUtilitiesTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetUtilitiesTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({ id: UID, email: 'util@example.com', email_verified: true });
  await db.insert(schema.households).values({
    id: HID,
    name: 'UtilitiesTest',
    city: 'Surrey',
    state_province: 'BC',
    country: 'CA',
  });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
}

async function seedBills(): Promise<void> {
  const now = '2026-06-01T00:00:00Z';
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO utility_bills (id, household_id, bill_type, provider, billing_period_start, billing_period_end, amount, due_date, usage_quantity, usage_unit, ai_extracted_data, confidence_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      'bill-hydro',
      HID,
      'electricity',
      'BC Hydro',
      '2026-04-09',
      '2026-06-08',
      17972,
      '2026-06-24',
      1270,
      'kWh',
      JSON.stringify(bcHydroFixture),
      0.92,
      now,
      now
    ),
    testEnv.DB.prepare(
      `INSERT INTO utility_bills (id, household_id, bill_type, provider, billing_period_start, billing_period_end, amount, due_date, usage_quantity, usage_unit, ai_extracted_data, confidence_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      'bill-fortis',
      HID,
      'gas',
      'FortisBC',
      '2026-05-12',
      '2026-06-10',
      6845,
      '2026-06-26',
      1.4,
      'GJ',
      JSON.stringify(fortisFixture),
      0.9,
      now,
      now
    ),
  ]);
}

describe('GET /dashboard', () => {
  beforeEach(async () => {
    await seed();
    await seedBills();
  });

  it('returns prorated monthly totals and provider summaries', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(`/households/${HID}/utilities/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
    }, testEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      currentMonthByType: unknown;
      byProvider: unknown[];
      insights: unknown[];
      currentMonthTotal: number;
    };
    expect(body.currentMonthByType).toBeDefined();
    expect(body.byProvider).toHaveLength(2);
    expect(body.insights).toBeInstanceOf(Array);
    expect(typeof body.currentMonthTotal).toBe('number');
  });

  it('falls back to the latest active month so "By utility" matches the providers', async () => {
    // Reproduce the reported bug: today is July 2026 (no bills prorate into it),
    // but the latest activity is June. The headline must summarize June — with a
    // NON-zero electricity figure that agrees with BC Hydro in the provider list
    // — not show Electricity $0 next to "BC Hydro $70/mo".
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-06T12:00:00Z'));
    try {
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await app.request(`/households/${HID}/utilities/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      }, testEnv);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        currentMonthByType: { electricity: number; gas: number; water: number };
        currentMonthTotal: number;
        periodMonthKey: string;
        periodLabel: string;
        periodIsCurrent: boolean;
        byProvider: Array<{ providerKey: string }>;
      };

      expect(body.periodIsCurrent).toBe(false);
      expect(body.periodMonthKey).toBe('2026-06');
      expect(body.periodLabel).toBe('June 2026');
      expect(body.currentMonthByType.electricity).toBeGreaterThan(0);
      expect(body.currentMonthTotal).toBeGreaterThan(0);
      expect(body.byProvider.some((p) => p.providerKey === 'bc_hydro')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GET /analytics', () => {
  beforeEach(async () => {
    await seed();
    await seedBills();
  });

  it('returns prorated monthly data with byType per month', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/utilities/analytics?startYear=2026&endYear=2026`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      monthlyData: Array<{ byType: Record<string, number> }>;
      byProvider: unknown[];
      proratedTotalAmount: number;
    };
    expect(body.monthlyData[0].byType).toBeDefined();
    expect(body.byProvider.length).toBe(2);
    expect(body.proratedTotalAmount).toBeGreaterThan(0);
  });

  it('filters analytics by providerKey=bc_hydro', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/utilities/analytics?startYear=2026&endYear=2026&providerKey=bc_hydro`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalBills: number;
      byProvider: Array<{ providerKey: string }>;
    };
    expect(body.byProvider[0].providerKey).toBe('bc_hydro');
  });
});

describe('POST /bills/upload', () => {
  beforeEach(async () => {
    await seed();
    mockExtractFromR2.mockReset();
    mockExtractFromR2.mockResolvedValue({
      data: bcHydroFixture,
      usage: { input_tokens: 100, output_tokens: 200 },
    });
  });

  it('extracts BC Hydro bill and returns structured data', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    form.append('file', new File(['%PDF'], 'bc-hydro.pdf', { type: 'application/pdf' }));

    const res = await app.request(`/households/${HID}/utilities/bills/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, testEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      extractedData: { provider: { name: string }; financial: { amountDue: number } };
      confidence: { overall: number };
    };
    expect(body.success).toBe(true);
    expect(body.extractedData.provider.name).toBe('BC Hydro');
    expect(body.extractedData.financial.amountDue).toBe(179.72);
    expect(body.confidence.overall).toBeGreaterThan(0.8);
  });

  // The BC Hydro fixture matches the seeded `bill-hydro` (same month, provider,
  // amount), so re-uploading it must be recognised as a duplicate rather than
  // silently creating a second copy.
  it('flags an uploaded bill that duplicates an existing one', async () => {
    await seedBills();
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    form.append('file', new File(['%PDF'], 'bc-hydro.pdf', { type: 'application/pdf' }));

    const res = await app.request(`/households/${HID}/utilities/bills/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, testEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { duplicate?: boolean; existingBill?: { id: string } };
    expect(body.duplicate).toBe(true);
    expect(body.existingBill?.id).toBe('bill-hydro');
  });

  // Even in the high-confidence auto-create path, a duplicate must be skipped
  // (not auto-created) so batch imports don't silently double-add bills.
  it('does not auto-create a duplicate on high-confidence upload', async () => {
    await seedBills();
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    form.append('file', new File(['%PDF'], 'bc-hydro.pdf', { type: 'application/pdf' }));
    form.append('autoCreate', 'true');

    const res = await app.request(`/households/${HID}/utilities/bills/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, testEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { autoCreated: boolean; duplicate?: boolean };
    expect(body.autoCreated).toBe(false);
    expect(body.duplicate).toBe(true);
  });
});

// Manual add / edit / delete + month-based duplicate guard on direct creation.
describe('bill CRUD + duplicate detection', () => {
  const NEW_BILL = {
    billType: 'electricity' as const,
    provider: 'BC Hydro',
    billingPeriodStart: '2026-04-09',
    billingPeriodEnd: '2026-06-08',
    amount: 17972,
    dueDate: '2026-06-24',
  };

  beforeEach(async () => {
    await seed();
    await seedBills();
  });

  it('rejects a manually-added bill that duplicates an existing period', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(`/households/${HID}/utilities/bills`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(NEW_BILL),
    }, testEnv);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; existingBill?: { id: string } };
    expect(body.code).toBe('DUPLICATE_BILL');
    expect(body.existingBill?.id).toBe('bill-hydro');
  });

  it('allows the duplicate through when allowDuplicate is set', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(`/households/${HID}/utilities/bills`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...NEW_BILL, allowDuplicate: true }),
    }, testEnv);

    expect(res.status).toBe(201);
  });

  it('creates a non-duplicate bill for a different month', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(`/households/${HID}/utilities/bills`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...NEW_BILL,
        billingPeriodStart: '2026-06-09',
        billingPeriodEnd: '2026-08-08',
        dueDate: '2026-08-24',
      }),
    }, testEnv);

    expect(res.status).toBe(201);
  });

  it('edits core fields of an existing bill', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(`/households/${HID}/utilities/bills/bill-hydro`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'BC Hydro (corrected)',
        billType: 'gas',
        amount: 18500,
        billingPeriodStart: '2026-04-01',
        billingPeriodEnd: '2026-05-31',
      }),
    }, testEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      provider: string;
      bill_type: string;
      amount: number;
      billing_period_start: string;
    };
    expect(body.provider).toBe('BC Hydro (corrected)');
    expect(body.bill_type).toBe('gas');
    expect(body.amount).toBe(18500);
    expect(body.billing_period_start).toBe('2026-04-01');
  });

  it('deletes a bill', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const del = await app.request(`/households/${HID}/utilities/bills/bill-fortis`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }, testEnv);
    expect(del.status).toBe(200);

    const list = await app.request(`/households/${HID}/utilities/bills`, {
      headers: { Authorization: `Bearer ${token}` },
    }, testEnv);
    const bills = (await list.json()) as Array<{ id: string }>;
    expect(bills.find((b) => b.id === 'bill-fortis')).toBeUndefined();
    expect(bills.find((b) => b.id === 'bill-hydro')).toBeDefined();
  });
});

// The "Pay bill" task lifecycle across import (deferred) and the confirm step.
// Regression guard for the "wrong number of tasks" bug: importing N bills must
// NOT create N tasks up front — a task is created only for each bill the user
// leaves Unpaid on the ConfirmBillPayments screen.
describe('pay-bill task lifecycle (import → confirm)', () => {
  const APR = {
    billType: 'electricity' as const,
    provider: 'BC Hydro',
    billingPeriodStart: '2026-04-01',
    billingPeriodEnd: '2026-04-30',
    amount: 10000,
    dueDate: '2026-05-15',
  };
  const MAY = {
    billType: 'gas' as const,
    provider: 'FortisBC',
    billingPeriodStart: '2026-05-01',
    billingPeriodEnd: '2026-05-31',
    amount: 6000,
    dueDate: '2026-06-15',
  };

  beforeEach(async () => {
    await seed();
    // The pay-bill task path runs the full TaskService.createTask, which reads
    // subtasks and clears scheduled notifications — tables not in createCoreTables.
    await testEnv.DB.exec(
      `CREATE TABLE IF NOT EXISTS maintenance_subtasks (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT, sort_order INTEGER NOT NULL DEFAULT 0, is_completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT, completed_by TEXT, reminder_enabled INTEGER NOT NULL DEFAULT 0, reminder_days_before INTEGER NOT NULL DEFAULT 1, reminder_time TEXT NOT NULL DEFAULT '09:00', reminder_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT, deleted_at TEXT)`
    );
    await testEnv.DB.exec(
      `CREATE TABLE IF NOT EXISTS scheduled_notifications (id TEXT PRIMARY KEY, user_id TEXT, household_id TEXT, type TEXT, reference_type TEXT NOT NULL, reference_id TEXT NOT NULL, title TEXT, body TEXT, data TEXT, scheduled_for TEXT, sent_at TEXT, failed_at TEXT, cancelled_at TEXT, failure_reason TEXT, error_message TEXT, notification_type TEXT, task_id TEXT, action_item_id TEXT, retry_count INTEGER DEFAULT 0, last_error TEXT, priority TEXT, metadata TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
    );
  });

  async function countActiveTasks(): Promise<number> {
    const row = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM tasks WHERE household_id = ? AND deleted_at IS NULL'
    )
      .bind(HID)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async function createBill(
    token: string,
    app: ReturnType<typeof mkApp>,
    body: Record<string, unknown>
  ): Promise<{ id: string; task_id: string | null }> {
    const res = await app.request(`/households/${HID}/utilities/bills`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, testEnv);
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; task_id: string | null };
  }

  it('defers task creation on import, then creates one only for the bill left unpaid', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    // Two bills imported unpaid, both deferring their task (the batch flow).
    const billA = await createBill(token, app, { ...APR, deferPayTask: true });
    const billB = await createBill(token, app, { ...MAY, deferPayTask: true });

    expect(billA.task_id).toBeNull();
    expect(billB.task_id).toBeNull();
    // No premature tasks — this is the core of the bug fix.
    expect(await countActiveTasks()).toBe(0);

    // Confirm step: A stays unpaid, B is already paid.
    const res = await app.request(`/households/${HID}/utilities/bills/paid-status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: [
          { billId: billA.id, paid: false },
          { billId: billB.id, paid: true },
        ],
      }),
    }, testEnv);
    expect(res.status).toBe(200);

    // Exactly one task — for the single bill left unpaid.
    expect(await countActiveTasks()).toBe(1);
    const updated = (await res.json()) as Array<{ id: string; task_id: string | null; paid_date: string | null }>;
    const a = updated.find((b) => b.id === billA.id)!;
    const b = updated.find((b) => b.id === billB.id)!;
    expect(a.task_id).not.toBeNull();
    expect(b.task_id).toBeNull();
    expect(b.paid_date).not.toBeNull();
  });

  it('still creates the task immediately for a single manual add (no defer)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    // Manual single add of an unpaid bill — the inline flow, not batch import.
    const bill = await createBill(token, app, APR);
    expect(bill.task_id).not.toBeNull();
    expect(await countActiveTasks()).toBe(1);
  });

  it('creates no task for a bill added as already paid', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const today = new Date().toISOString().split('T')[0];
    const bill = await createBill(token, app, { ...APR, paidDate: today, paidAmount: APR.amount });
    expect(bill.task_id).toBeNull();
    expect(await countActiveTasks()).toBe(0);
  });
});

// ── BC Assessment CRUD ──────────────────────────────────────────────────────
describe('BC Assessment CRUD', () => {
  beforeEach(async () => {
    await seed();
  });

  it('creates, lists, and updates a BC assessment record', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const create = await app.request(`/households/${HID}/utilities/bc-assessment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assessmentYear: 2025,
        propertyClass: '01 - Residential',
        assessedValue: 105000000,
        landValue: 80000000,
        improvementValue: 25000000,
        previousYearValue: 100000000,
        changePercent: 5,
        appealDeadline: '2025-01-31',
      }),
    }, testEnv);
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string; assessment_year: number };
    expect(created.assessment_year).toBe(2025);

    const list = await app.request(`/households/${HID}/utilities/bc-assessment`, {
      headers: { Authorization: `Bearer ${token}` },
    }, testEnv);
    expect(list.status).toBe(200);
    expect((await list.json()) as unknown[]).toHaveLength(1);

    const patch = await app.request(`/households/${HID}/utilities/bc-assessment/${created.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appealFiled: true, assessedValue: 106000000 }),
    }, testEnv);
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as { appeal_filed: boolean; assessed_value: number };
    expect(patched.appeal_filed).toBe(true);
    expect(patched.assessed_value).toBe(106000000);
  });
});

// ── BC Assessment upload + AI extraction ────────────────────────────────────
describe('POST /bc-assessment/upload', () => {
  beforeEach(async () => {
    await seed();
    mockAssessmentExtractFromR2.mockReset();
    mockAssessmentExtractFromR2.mockResolvedValue({
      data: assessmentFixture,
      usage: { input_tokens: 80, output_tokens: 150 },
    });
  });

  it('extracts an assessment notice into a create-ready suggestion (dollars→cents)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    form.append('file', new File(['%PDF'], 'assessment.pdf', { type: 'application/pdf' }));

    const res = await app.request(`/households/${HID}/utilities/bc-assessment/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, testEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      duplicate?: boolean;
      suggestedAssessment: {
        assessmentYear: number;
        assessedValue: number;
        landValue?: number;
        changePercent?: number;
      };
      confidence: { overall: number };
    };
    expect(body.success).toBe(true);
    expect(body.duplicate).toBe(false);
    expect(body.suggestedAssessment.assessmentYear).toBe(2026);
    expect(body.suggestedAssessment.assessedValue).toBe(118100000); // $1,181,000 → cents
    expect(body.suggestedAssessment.landValue).toBe(92000000);
    expect(body.suggestedAssessment.changePercent).toBeCloseTo(12.5, 1); // 1.05M → 1.181M
    expect(body.confidence.overall).toBeGreaterThan(0.8);
  });

  it('backfills the prior years from the notice history (excluding the current year)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    form.append('file', new File(['%PDF'], 'assessment.pdf', { type: 'application/pdf' }));

    const res = await app.request(`/households/${HID}/utilities/bc-assessment/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, testEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { historyBackfill?: { created: number; enriched: number } };
    // Fixture history has 2026/2025/2024 → the current year (2026) is left for
    // the review sheet, so 2025 + 2024 are auto-persisted.
    expect(body.historyBackfill?.created).toBe(2);

    const rows = await testEnv.DB.prepare(
      `SELECT assessment_year, assessed_value FROM bc_assessment_data WHERE household_id = ? ORDER BY assessment_year DESC`
    )
      .bind(HID)
      .all<{ assessment_year: number; assessed_value: number }>();
    const years = rows.results.map((r) => r.assessment_year);
    expect(years).toContain(2025);
    expect(years).toContain(2024);
    expect(years).not.toContain(2026); // current year is not backfilled
    const y2025 = rows.results.find((r) => r.assessment_year === 2025);
    expect(y2025?.assessed_value).toBe(124500000); // $1,245,000 → cents
  });

  it('flags an upload whose assessment year already exists', async () => {
    await testEnv.DB.prepare(
      `INSERT INTO bc_assessment_data (id, household_id, assessment_year, assessed_value, appeal_filed, created_at, updated_at)
       VALUES ('bca-2026', ?, 2026, 100000000, 0, '2026-01-05', '2026-01-05')`
    )
      .bind(HID)
      .run();

    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    form.append('file', new File(['%PDF'], 'assessment.pdf', { type: 'application/pdf' }));

    const res = await app.request(`/households/${HID}/utilities/bc-assessment/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, testEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { duplicate?: boolean; existingAssessment?: { id: string } };
    expect(body.duplicate).toBe(true);
    expect(body.existingAssessment?.id).toBe('bca-2026');
  });
});

// ── Property insights (GET /property-overview) ──────────────────────────────
describe('GET /property-overview', () => {
  async function seedPropertyData(): Promise<void> {
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO bc_assessment_data (id, household_id, assessment_year, property_class, assessed_value, land_value, improvement_value, previous_year_value, change_percent, appeal_deadline, appeal_filed, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind('bca-2025', HID, 2025, '01 - Residential', 105000000, null, null, 100000000, 5, '2025-01-31', 0, '2025-01-05', '2025-01-05'),
      testEnv.DB.prepare(
        `INSERT INTO bc_assessment_data (id, household_id, assessment_year, property_class, assessed_value, land_value, improvement_value, previous_year_value, change_percent, appeal_deadline, appeal_filed, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind('bca-2026', HID, 2026, '01 - Residential', 118100000, 92000000, 26100000, 105000000, 12.5, '2026-01-31', 0, '2026-01-05', '2026-01-05'),
      // 2025 paid; 2026 unpaid + grant eligible (drives next-due / grant insights).
      testEnv.DB.prepare(
        `INSERT INTO property_taxes (id, household_id, tax_year, assessed_value, tax_amount, main_payment_amount, main_payment_due_date, main_payment_paid_date, homeowner_grant_eligible, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind('ptx-2025', HID, 2025, 105000000, 480000, 480000, '2025-07-02', '2025-06-20', 1, '2025-05-01', '2025-05-01'),
      testEnv.DB.prepare(
        `INSERT INTO property_taxes (id, household_id, tax_year, assessed_value, tax_amount, main_payment_amount, main_payment_due_date, main_payment_paid_date, homeowner_grant_eligible, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind('ptx-2026', HID, 2026, 118100000, 505334, 505334, '2026-07-02', null, 1, '2026-05-01', '2026-05-01'),
    ]);
  }

  beforeEach(async () => {
    await seed();
  });

  it('returns empty insights when the property has no records', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(`/households/${HID}/utilities/property-overview`, {
      headers: { Authorization: `Bearer ${token}` },
    }, testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasData: boolean; stats: unknown[]; insights: unknown[] };
    expect(body.hasData).toBe(false);
    expect(body.stats).toHaveLength(0);
    expect(body.insights).toHaveLength(0);
  });

  it('computes stat tiles, YoY, history and insight cards from tax + assessment history', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    try {
      await seedPropertyData();
      const token = await mintToken(UID);
      const app = mkApp();
      const res = await app.request(`/households/${HID}/utilities/property-overview`, {
        headers: { Authorization: `Bearer ${token}` },
      }, testEnv);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        hasData: boolean;
        assessment: {
          latest: { assessment_year: number };
          history: unknown[];
          yoy: { changePercent: number };
          landVsBuilding: unknown;
        };
        propertyTax: { latest: { tax_year: number }; nextDue: { year: number } | null };
        stats: Array<{ id: string }>;
        insights: Array<{ id: string }>;
      };

      expect(body.hasData).toBe(true);
      expect(body.assessment.latest.assessment_year).toBe(2026);
      expect(body.assessment.history).toHaveLength(2);
      expect(body.assessment.yoy.changePercent).toBe(12.5);
      expect(body.assessment.landVsBuilding).not.toBeNull();

      expect(body.propertyTax.latest.tax_year).toBe(2026);
      expect(body.propertyTax.nextDue?.year).toBe(2026);

      const statIds = body.stats.map((s) => s.id);
      expect(statIds).toEqual(
        expect.arrayContaining(['assessed_value', 'latest_tax', 'next_due', 'effective_rate'])
      );

      const insightIds = body.insights.map((i) => i.id);
      expect(insightIds).toEqual(
        expect.arrayContaining(['land_split', 'grant_available', 'tax_change', 'tax_due_soon'])
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

// Upload → AI extraction → structured suggestion, plus per-year duplicate flag.
describe('POST /property-taxes/upload', () => {
  beforeEach(async () => {
    await seed();
    mockPropertyTaxExtractFromR2.mockReset();
    mockPropertyTaxExtractFromR2.mockResolvedValue({
      data: surreyPropertyTaxFixture,
      usage: { input_tokens: 120, output_tokens: 240 },
    });
  });

  async function uploadNotice(token: string, app: ReturnType<typeof mkApp>) {
    const form = new FormData();
    form.append('file', new File(['%PDF'], 'surrey-tax.pdf', { type: 'application/pdf' }));
    return app.request(`/households/${HID}/utilities/property-taxes/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, testEnv);
  }

  it('extracts a Surrey notice and returns a create-ready suggestion', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await uploadNotice(token, app);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      duplicate?: boolean;
      documentUrl: string;
      suggestedTax: {
        taxYear: number;
        taxAmount: number;
        assessedValue: number;
        mainPaymentDueDate: string;
        homeownerGrantEligible: boolean;
        homeownerGrantAmount?: number;
        municipalityName?: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.duplicate).toBe(false);
    expect(body.documentUrl).toContain(`utilities/${HID}/property-taxes/`);
    // Dollars → cents; the No-Grant column is the amount due.
    expect(body.suggestedTax.taxYear).toBe(2026);
    expect(body.suggestedTax.taxAmount).toBe(505334);
    expect(body.suggestedTax.assessedValue).toBe(118100000);
    expect(body.suggestedTax.mainPaymentDueDate).toBe('2026-07-02');
    expect(body.suggestedTax.homeownerGrantEligible).toBe(true);
    expect(body.suggestedTax.homeownerGrantAmount).toBe(57000);
    expect(body.suggestedTax.municipalityName).toBe('City of Surrey');
  });

  it('flags an uploaded notice that duplicates an existing tax year', async () => {
    // A 2026 record already exists — re-uploading a 2026 notice must be flagged,
    // not silently create a second row (one record per household+year).
    await testEnv.DB.prepare(
      `INSERT INTO property_taxes (id, household_id, tax_year, assessed_value, tax_amount, main_payment_amount, main_payment_due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind('pt-2026', HID, 2026, 118100000, 505334, 505334, '2026-07-02')
      .run();

    const token = await mintToken(UID);
    const app = mkApp();
    const res = await uploadNotice(token, app);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { duplicate?: boolean; existingTax?: { id: string; tax_year: number } };
    expect(body.duplicate).toBe(true);
    expect(body.existingTax?.id).toBe('pt-2026');
    expect(body.existingTax?.tax_year).toBe(2026);
  });
});

// Import → paid/unpaid choice drives the grant + pay reminder tasks; marking
// paid / claiming the grant later clears the matching task.
describe('property tax CRUD + reminder-task automation', () => {
  const UNPAID_WITH_GRANT = {
    taxYear: 2026,
    assessedValue: 118100000,
    taxAmount: 505334,
    mainPaymentAmount: 505334,
    mainPaymentDueDate: '2026-07-02',
    homeownerGrantEligible: true,
    homeownerGrantAmount: 57000,
    municipalityName: 'City of Surrey',
  };

  beforeEach(async () => {
    await seed();
    // createPropertyTax runs the full TaskService.createTask when unpaid.
    await createTaskSupportTables(testEnv.DB);
  });

  async function countTasks(): Promise<number> {
    const row = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM tasks WHERE household_id = ? AND deleted_at IS NULL'
    )
      .bind(HID)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async function createTax(
    token: string,
    app: ReturnType<typeof mkApp>,
    body: Record<string, unknown>
  ): Promise<{
    id: string;
    main_payment_amount: number;
    main_payment_task_id: string | null;
    grant_task_id: string | null;
    main_payment_paid_date: string | null;
    homeowner_grant_applied_date: string | null;
    grantWarning?: string;
  }> {
    const res = await app.request(`/households/${HID}/utilities/property-taxes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, testEnv);
    expect(res.status).toBe(201);
    return (await res.json()) as {
      id: string;
      main_payment_amount: number;
      main_payment_task_id: string | null;
      grant_task_id: string | null;
      main_payment_paid_date: string | null;
      homeowner_grant_applied_date: string | null;
      grantWarning?: string;
    };
  }

  it('creates a grant task AND a pay task for an unpaid, grant-eligible notice', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const tax = await createTax(token, app, UNPAID_WITH_GRANT);
    expect(tax.grant_task_id).not.toBeNull();
    expect(tax.main_payment_task_id).not.toBeNull();
    expect(tax.main_payment_paid_date).toBeNull();
    // Grant task + pay task = 2.
    expect(await countTasks()).toBe(2);
  });

  it('applies the grant: deducts it from what is owed and skips the claim task', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const tax = await createTax(token, app, {
      ...UNPAID_WITH_GRANT,
      homeownerGrantApplied: true,
    });
    // Grant is claimed → nothing left to claim, only the pay task remains.
    expect(tax.grant_task_id).toBeNull();
    expect(tax.main_payment_task_id).not.toBeNull();
    expect(await countTasks()).toBe(1);
    // Amount owed drops by the grant amount, and the record is marked applied.
    expect(tax.main_payment_amount).toBe(505334 - 57000);
    expect(tax.homeowner_grant_applied_date).not.toBeNull();
  });

  it('creates only the pay task when the notice has no Home Owner Grant', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const tax = await createTax(token, app, {
      ...UNPAID_WITH_GRANT,
      homeownerGrantEligible: false,
      homeownerGrantAmount: undefined,
    });
    expect(tax.grant_task_id).toBeNull();
    expect(tax.main_payment_task_id).not.toBeNull();
    expect(await countTasks()).toBe(1);
  });

  it('creates no tasks for a notice imported as already paid', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const tax = await createTax(token, app, {
      ...UNPAID_WITH_GRANT,
      mainPaymentPaidDate: '2026-06-20',
    });
    expect(tax.grant_task_id).toBeNull();
    expect(tax.main_payment_task_id).toBeNull();
    expect(tax.main_payment_paid_date).toBe('2026-06-20');
    expect(await countTasks()).toBe(0);
  });

  it('clears the pay task when the tax is marked paid', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const tax = await createTax(token, app, {
      ...UNPAID_WITH_GRANT,
      homeownerGrantEligible: false,
    });
    expect(await countTasks()).toBe(1);

    const res = await app.request(`/households/${HID}/utilities/property-taxes/${tax.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mainPaymentPaidDate: '2026-07-01' }),
    }, testEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      main_payment_task_id: string | null;
      main_payment_paid_date: string | null;
    };
    expect(body.main_payment_task_id).toBeNull();
    expect(body.main_payment_paid_date).toBe('2026-07-01');
    expect(await countTasks()).toBe(0);
  });

  it('clears the grant task when the Home Owner Grant is recorded as applied', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const tax = await createTax(token, app, UNPAID_WITH_GRANT);
    expect(await countTasks()).toBe(2);

    const res = await app.request(`/households/${HID}/utilities/property-taxes/${tax.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ homeownerGrantAppliedDate: '2026-06-15' }),
    }, testEnv);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { grant_task_id: string | null };
    expect(body.grant_task_id).toBeNull();
    // Pay task remains; only the grant task was cleared.
    expect(await countTasks()).toBe(1);
  });
});

// ── Reminders + penalties (BUDGET-BILL-038/041) ─────────────────────────────
describe('GET /reminders + calculate-penalties', () => {
  beforeEach(async () => {
    await seed();
  });

  it('returns an empty reminder list when none are scheduled (BUDGET-BILL-041)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const res = await app.request(`/households/${HID}/utilities/reminders`, {
      headers: { Authorization: `Bearer ${token}` },
    }, testEnv);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns seeded utility reminders for the household', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const reminderId = 'rem-1';
    await testEnv.DB.prepare(
      `INSERT INTO utility_reminders (id, household_id, bill_id, reminder_type, scheduled_for, reminder_days_before, notification_channel, created_at)
       VALUES (?, ?, NULL, 'bill_due', datetime('now', '+1 day'), 3, 'push', datetime('now'))`
    )
      .bind(reminderId, HID)
      .run();

    const res = await app.request(`/households/${HID}/utilities/reminders`, {
      headers: { Authorization: `Bearer ${token}` },
    }, testEnv);

    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toContain(reminderId);
  });

  it('POST calculate-penalties returns tiers for an overdue tax (BUDGET-BILL-041)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const taxId = 'tax_penalty_1';
    await testEnv.DB.prepare(
      `INSERT INTO property_taxes (
        id, household_id, tax_year, assessed_value, tax_amount, main_payment_amount,
        main_payment_due_date, homeowner_grant_eligible, created_at, updated_at
      ) VALUES (?, ?, 2026, 100000000, 450000, 450000, '2026-07-02', 0, datetime('now'), datetime('now'))`
    )
      .bind(taxId, HID)
      .run();

    const res = await app.request(
      `/households/${HID}/utilities/property-taxes/${taxId}/calculate-penalties`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentDate: '2026-08-15' }),
      },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { penalties: unknown[]; totalPenalty: number };
    expect(Array.isArray(body.penalties)).toBe(true);
    expect(body.totalPenalty).toBeGreaterThanOrEqual(0);
  });
});
