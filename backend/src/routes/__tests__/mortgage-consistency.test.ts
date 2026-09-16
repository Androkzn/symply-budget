/**
 * Cross-endpoint identity tests for the Mortgage tracker (Summary ⇄ Schedule
 * ⇄ Equity). Unlike the other *-consistency suites, mortgage math (day-count,
 * compounding, statement reconciliation) is already golden-vector-tested in
 * `mortgage.test.ts` and `loan-amortization.test.ts` — re-deriving it here
 * would just duplicate that. What's NOT covered elsewhere is whether the
 * pieces the summary and schedule *each* return actually add up to each
 * other and to themselves — the exact class of bug that makes one tab's
 * numbers disagree with another's even though each was computed "correctly"
 * in isolation:
 *
 *   schedule.rows[0].interest + schedule.rows[0].principal === summary.scheduledPaymentCents
 *   Σ every row's (interest + principal)                   === scheduledPaymentCents (per row)
 *   final schedule row balance                              === 0
 *   summary.totalPaidToDateCents                             === principalToDate + interestToDate
 *   summary.equity.totalEquityCents                           === down + paydown + appreciation
 *
 * A 1-cent tolerance is used where the source rounds interest and principal
 * independently each row (documented in `amortization.ts`) — real drift, not
 * a bug, would be off by far more than a cent.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import type { Mortgage } from '../../db/schema-mortgage';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { MortgageSummary, ScheduleView } from '../../services/mortgage-service';
import type { Env } from '../../types';
import mortgageRouter from '../mortgage';

import { applyBudgetWorkerTestBrand } from './budget-test-helpers';


const testEnv = env as unknown as Env;

const HID = 'hh_mortgage_consistency';
const UID = 'u_mortgage_consistency_owner';
const MID = 'm_mortgage_consistency_owner';

async function createMortgageTables(db: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS mortgages (
      id TEXT PRIMARY KEY, household_id TEXT NOT NULL, nickname TEXT NOT NULL, lender TEXT,
      product_type TEXT NOT NULL DEFAULT 'standard', property_address TEXT, mortgage_number_last4 TEXT,
      original_price_cents INTEGER, down_payment_cents INTEGER, original_principal_cents INTEGER NOT NULL,
      original_amortization_months INTEGER NOT NULL DEFAULT 300, start_date TEXT NOT NULL,
      current_home_value_cents INTEGER, insurance_premium_cents INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
      reminder_enabled INTEGER NOT NULL DEFAULT 1, reminder_months_before INTEGER NOT NULL DEFAULT 3,
      last_renewal_reminder_sent_at TEXT,
      created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS mortgage_terms (
      id TEXT PRIMARY KEY, mortgage_id TEXT NOT NULL, household_id TEXT NOT NULL, sequence INTEGER NOT NULL,
      rate_type TEXT NOT NULL, compounding TEXT NOT NULL, nominal_rate_bps INTEGER NOT NULL, prime_rate_bps INTEGER,
      spread_bps INTEGER, term_months INTEGER NOT NULL, term_start_date TEXT NOT NULL, maturity_date TEXT NOT NULL,
      payment_frequency TEXT NOT NULL, amortization_months_at_start INTEGER NOT NULL, starting_balance_cents INTEGER,
      scheduled_payment_cents INTEGER, property_tax_portion_cents INTEGER, insurance_portion_cents INTEGER,
      is_current INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS mortgage_statements (
      id TEXT PRIMARY KEY, mortgage_id TEXT NOT NULL, household_id TEXT NOT NULL, term_id TEXT,
      statement_date TEXT NOT NULL, period_start TEXT, period_end TEXT, opening_balance_cents INTEGER,
      closing_balance_cents INTEGER NOT NULL, interest_paid_cents INTEGER, interest_charged_cents INTEGER,
      principal_paid_cents INTEGER, payment_amount_cents INTEGER, interest_rate_bps INTEGER, prime_rate_bps INTEGER,
      variance_bps INTEGER, remaining_amortization_months INTEGER, property_tax_paid_cents INTEGER,
      source TEXT NOT NULL DEFAULT 'manual', extraction_confidence INTEGER, raw_extraction_json TEXT, created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS mortgage_events (
      id TEXT PRIMARY KEY, mortgage_id TEXT NOT NULL, household_id TEXT NOT NULL, event_type TEXT NOT NULL,
      event_date TEXT NOT NULL, amount_cents INTEGER, new_rate_bps INTEGER, new_payment_cents INTEGER, policy TEXT,
      note TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS mortgage_renewal_offers (
      id TEXT PRIMARY KEY, mortgage_id TEXT NOT NULL, household_id TEXT NOT NULL, bank_name TEXT NOT NULL,
      offered_rate_bps INTEGER NOT NULL, rate_type TEXT NOT NULL, term_months INTEGER NOT NULL,
      monthly_payment_cents INTEGER, offer_expires_at TEXT, status TEXT NOT NULL DEFAULT 'draft',
      source TEXT NOT NULL DEFAULT 'manual', note TEXT, created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS mortgage_rate_periods (
      id TEXT PRIMARY KEY, mortgage_id TEXT NOT NULL, household_id TEXT NOT NULL, statement_id TEXT,
      effective_date TEXT NOT NULL, period_end TEXT, rate_bps INTEGER NOT NULL, prime_rate_bps INTEGER,
      variance_bps INTEGER, source TEXT NOT NULL DEFAULT 'statement',
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS mortgage_rate_periods_statement_date_idx
      ON mortgage_rate_periods(statement_id, effective_date)`,
  ];
  for (const sql of statements) await db.exec(sql.replace(/\s+/g, ' ').trim());
}

async function resetMortgageTables(db: D1Database): Promise<void> {
  for (const t of ['mortgage_rate_periods', 'mortgage_renewal_offers', 'mortgage_events', 'mortgage_statements', 'mortgage_terms', 'mortgages']) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist yet
    }
  }
}

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum');
  return new jose.SignJWT({ sub: userId, email: `${userId}@example.com`, email_verified: true } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/households/:householdId/mortgage', mortgageRouter);
  app.onError((error, c) => {
    const named = ['ApiError', 'ValidationError', 'UnauthorizedError', 'ForbiddenError', 'NotFoundError', 'ConflictError', 'RateLimitError'];
    if (named.includes((error as Error).name)) {
      const e = error as unknown as { code: string; message: string; statusCode: number };
      return c.json({ error: { code: e.code, message: e.message } }, e.statusCode as 400 | 401 | 403 | 404);
    }
    return c.json({ error: { code: 'internal_error', message: (error as Error).message } }, 500);
  });
  return app;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function seed(): Promise<void> {
  applyBudgetWorkerTestBrand(testEnv);
  await createCoreTables(testEnv.DB);
  await createMortgageTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetMortgageTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([{ id: UID, email: 'mortgage-consistency@example.com', email_verified: true }]);
  await db.insert(schema.households).values([{ id: HID, name: 'MortgageConsistency' }]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** GV-1 mortgage: 500k @ 5% semi-annual, 25yr amortization, monthly, starting today. */
function gv1Body() {
  return {
    nickname: 'Main home',
    lender: 'TD',
    originalPrincipalCents: 50_000_000,
    originalAmortizationMonths: 300,
    startDate: today(),
    rateType: 'fixed' as const,
    compounding: 'semi_annual' as const,
    nominalRateBps: 500,
    termMonths: 60,
    paymentFrequency: 'monthly' as const,
  };
}

/** Full-mode mortgage (price/down/current-value known) started ~180 days ago, so elapsed > 0. */
function fullModeBody() {
  return {
    nickname: 'Full mode home',
    lender: 'RBC',
    originalPriceCents: 60_000_000, // $600,000
    downPaymentCents: 12_000_000, // $120,000
    originalPrincipalCents: 48_000_000, // $480,000
    currentHomeValueCents: 65_000_000, // $650,000
    originalAmortizationMonths: 300,
    startDate: daysAgo(180),
    rateType: 'fixed' as const,
    compounding: 'semi_annual' as const,
    nominalRateBps: 500,
    termMonths: 60,
    paymentFrequency: 'monthly' as const,
  };
}

async function create(app: ReturnType<typeof mkApp>, token: string, body: unknown): Promise<Mortgage> {
  const res = await app.request(
    `/households/${HID}/mortgage`,
    { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) },
    testEnv
  );
  expect(res.status).toBe(201);
  return (await res.json()) as Mortgage;
}

describe('Mortgage Summary ⇄ Schedule ⇄ Equity identities', () => {
  beforeEach(seed);

  it("schedule row 1's interest + principal equals the summary's scheduled payment", async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const mortgage = await create(app, token, gv1Body());

    const [summaryRes, scheduleRes] = await Promise.all([
      app.request(`/households/${HID}/mortgage/${mortgage.id}/summary`, { headers: authHeaders(token) }, testEnv),
      app.request(`/households/${HID}/mortgage/${mortgage.id}/schedule`, { headers: authHeaders(token) }, testEnv),
    ]);
    const summary = (await summaryRes.json()) as MortgageSummary;
    const schedule = (await scheduleRes.json()) as ScheduleView;

    expect(schedule.scheduleAvailable).toBe(true);
    const row1 = schedule.rows[0];
    expect(row1.interest + row1.principal).toBe(summary.scheduledPaymentCents);
    // Cross-check against the summary's own reported split for the same row.
    expect(row1.interest).toBe(summary.currentPaymentSplit.interestCents);
    expect(row1.principal).toBe(summary.currentPaymentSplit.principalCents);
  });

  it('every schedule row reconciles to the payment (±1¢ rounding) and the final balance is exactly 0', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const mortgage = await create(app, token, gv1Body());

    const summaryRes = await app.request(`/households/${HID}/mortgage/${mortgage.id}/summary`, { headers: authHeaders(token) }, testEnv);
    const summary = (await summaryRes.json()) as MortgageSummary;
    const scheduleRes = await app.request(`/households/${HID}/mortgage/${mortgage.id}/schedule`, { headers: authHeaders(token) }, testEnv);
    const schedule = (await scheduleRes.json()) as ScheduleView;

    expect(schedule.rows.length).toBeGreaterThan(0);
    let previousBalance = 50_000_000; // starting principal, in cents
    for (let idx = 0; idx < schedule.rows.length; idx++) {
      const row = schedule.rows[idx];
      const isLast = idx === schedule.rows.length - 1;
      if (!isLast) {
        expect(Math.abs(row.interest + row.principal - summary.scheduledPaymentCents)).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(previousBalance - row.balance - row.principal)).toBeLessThanOrEqual(1);
      previousBalance = row.balance;
    }
    expect(schedule.rows[schedule.rows.length - 1].balance).toBe(0);
  });

  it('equity breakdown adds up: total === down + paydown + appreciation', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const mortgage = await create(app, token, fullModeBody());

    const res = await app.request(`/households/${HID}/mortgage/${mortgage.id}/summary`, { headers: authHeaders(token) }, testEnv);
    const summary = (await res.json()) as MortgageSummary;

    expect(summary.equity.hasAppreciation).toBe(true);
    expect(
      summary.equity.downPaymentCents + summary.equity.paydownEquityCents + summary.equity.appreciationEquityCents
    ).toBe(summary.equity.totalEquityCents);
    // Also ties to the raw current-value − balance definition.
    expect(summary.equity.totalEquityCents).toBe(65_000_000 - summary.currentBalanceCents);
  });

  it('totalPaidToDate is exactly principal-to-date plus interest-to-date (elapsed > 0)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const mortgage = await create(app, token, fullModeBody());

    const res = await app.request(`/households/${HID}/mortgage/${mortgage.id}/summary`, { headers: authHeaders(token) }, testEnv);
    const summary = (await res.json()) as MortgageSummary;

    expect(summary.paymentsElapsed).toBeGreaterThan(0);
    expect(summary.totalPaidToDateCents).toBe(summary.totalPrincipalToDateCents + summary.totalInterestToDateCents);
    // Whole-loan equity paydown ties back to original principal − current balance.
    expect(summary.originalPrincipalCents - summary.currentBalanceCents).toBe(summary.totalPrincipalToDateCents);
  });
});
