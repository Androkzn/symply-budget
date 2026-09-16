/**
 * mortgage.ts routes — create/list/summary/schedule/terms/update/delete, plus
 * auth (401), household scoping (403), and validation (400). The summary test
 * ties the HTTP surface back to golden vector GV-1 (500k @ 5% semi-annual, 25yr
 * monthly → $2,908.02, first split $2,061.96 / $846.06).
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import type { Mortgage, MortgageTerm } from '../../db/schema-mortgage';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { MortgageSummary, ScheduleView } from '../../services/mortgage-service';
import type { Env } from '../../types';
import mortgageRouter from '../mortgage';

import { applyBudgetWorkerTestBrand } from './budget-test-helpers';


const testEnv = env as unknown as Env;

const HID = 'hh_mortgage_routes';
const UID = 'u_mortgage_owner';
const MID = 'm_mortgage_owner';
const OTHER_UID = 'u_mortgage_outsider';
const OTHER_HID = 'hh_mortgage_other';
const OTHER_MID = 'm_mortgage_outsider';

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

async function seed(): Promise<void> {
  applyBudgetWorkerTestBrand(testEnv);
  await createCoreTables(testEnv.DB);
  await createMortgageTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetMortgageTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([
    { id: UID, email: 'mortgage@example.com', email_verified: true },
    { id: OTHER_UID, email: 'mortgage-out@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values([
    { id: HID, name: 'MortgageHH' },
    { id: OTHER_HID, name: 'MortgageOther' },
  ]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
    { id: OTHER_MID, household_id: OTHER_HID, user_id: OTHER_UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);
}

const today = () => new Date().toISOString().slice(0, 10);

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

function authedPost(app: ReturnType<typeof mkApp>, token: string, body: unknown, hid = HID) {
  return app.request(
    `/households/${hid}/mortgage`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    testEnv
  );
}

describe('mortgage routes', () => {
  beforeEach(seed);

  it('creates a mortgage + first term and returns 201', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await authedPost(app, token, gv1Body());
    expect(res.status).toBe(201);
    const m = (await res.json()) as Mortgage;
    expect(m.id).toBeTruthy();
    expect(m.original_principal_cents).toBe(50_000_000);
    expect(m.original_amortization_months).toBe(300);
  });

  it('derives original principal from price − down when not given', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const body = { ...gv1Body(), originalPrincipalCents: undefined, originalPriceCents: 60_000_000, downPaymentCents: 12_000_000 };
    const res = await authedPost(app, token, body);
    expect(res.status).toBe(201);
    const m = (await res.json()) as Mortgage;
    expect(m.original_principal_cents).toBe(48_000_000); // 600k − 120k
  });

  it('summary ties to GV-1 (payment $2,908.02, first split $2,061.96 / $846.06)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const created = (await (await authedPost(app, token, gv1Body())).json()) as Mortgage;

    const res = await app.request(
      `/households/${HID}/mortgage/${created.id}/summary`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(res.status).toBe(200);
    const s = (await res.json()) as MortgageSummary;
    expect(s.paymentsElapsed).toBe(0);
    expect(s.currentBalanceCents).toBe(50_000_000);
    expect(s.scheduledPaymentCents).toBe(290802);
    expect(s.currentPaymentSplit.interestCents).toBe(206196);
    expect(s.currentPaymentSplit.principalCents).toBe(84606);
    expect(s.rate.nominalPct).toBe(5);
    expect(s.rate.effectiveAnnualPct).toBe(5.06);
    expect(s.paymentsTotal).toBe(300);
    expect(s.pctPaid).toBe(0);
  });

  it('returns a 300-row schedule ending at balance 0', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const created = (await (await authedPost(app, token, gv1Body())).json()) as Mortgage;
    const res = await app.request(
      `/households/${HID}/mortgage/${created.id}/schedule`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    const view = (await res.json()) as ScheduleView;
    expect(view.scheduleAvailable).toBe(true);
    expect(view.rows).toHaveLength(300);
    expect(view.rows[0].interest).toBe(206196);
    expect(view.rows[view.rows.length - 1].balance).toBe(0);
  });

  it('lists mortgages and terms', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const created = (await (await authedPost(app, token, gv1Body())).json()) as Mortgage;

    const listRes = await app.request(`/households/${HID}/mortgage`, { headers: { Authorization: `Bearer ${token}` } }, testEnv);
    const list = (await listRes.json()) as { mortgages: Array<{ id: string; pctPaid: number }> };
    expect(list.mortgages).toHaveLength(1);
    expect(list.mortgages[0].id).toBe(created.id);

    const termsRes = await app.request(`/households/${HID}/mortgage/${created.id}/terms`, { headers: { Authorization: `Bearer ${token}` } }, testEnv);
    const terms = (await termsRes.json()) as { terms: MortgageTerm[] };
    expect(terms.terms).toHaveLength(1);
    expect(terms.terms[0].sequence).toBe(1);
    expect(terms.terms[0].nominal_rate_bps).toBe(500);
  });

  it('updates and deletes a mortgage', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const created = (await (await authedPost(app, token, gv1Body())).json()) as Mortgage;

    const patchRes = await app.request(
      `/households/${HID}/mortgage/${created.id}`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Cottage' }) },
      testEnv
    );
    expect(patchRes.status).toBe(200);
    expect(((await patchRes.json()) as Mortgage).nickname).toBe('Cottage');

    const delRes = await app.request(`/households/${HID}/mortgage/${created.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }, testEnv);
    expect(delRes.status).toBe(204);

    const listRes = await app.request(`/households/${HID}/mortgage`, { headers: { Authorization: `Bearer ${token}` } }, testEnv);
    expect(((await listRes.json()) as { mortgages: unknown[] }).mortgages).toHaveLength(0);
  });

  it('gets a single mortgage by id with its full (unmasked) record', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const created = (await (
      await authedPost(app, token, { ...gv1Body(), propertyAddress: '123 King St', currentHomeValueCents: 60_000_000 })
    ).json()) as Mortgage;

    const res = await app.request(
      `/households/${HID}/mortgage/${created.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(res.status).toBe(200);
    const m = (await res.json()) as Mortgage;
    expect(m.id).toBe(created.id);
    // The settings/edit form needs the raw address + value the list/summary hide.
    expect(m.property_address).toBe('123 King St');
    expect(m.current_home_value_cents).toBe(60_000_000);
  });

  it('404 getting a non-existent mortgage by id', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/mortgage/does-not-exist`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(res.status).toBe(404);
  });

  it('401 without a token', async () => {
    const app = mkApp();
    const res = await app.request(`/households/${HID}/mortgage`, {}, testEnv);
    expect(res.status).toBe(401);
  });

  it('403 for a non-member of the household', async () => {
    const token = await mintToken(OTHER_UID); // member of OTHER_HID, not HID
    const app = mkApp();
    const res = await authedPost(app, token, gv1Body(), HID);
    expect(res.status).toBe(403);
  });

  it('400 when neither principal nor price/down is provided', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const body = { ...gv1Body(), originalPrincipalCents: undefined };
    const res = await authedPost(app, token, body);
    expect(res.status).toBe(400);
  });

  it('404 for a non-existent mortgage id', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/mortgage/does-not-exist/summary`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(res.status).toBe(404);
  });

  // ---- Phase 2: statements + reconciliation + renewal ----

  async function createGv1(app: ReturnType<typeof mkApp>, token: string): Promise<Mortgage> {
    return (await (await authedPost(app, token, gv1Body())).json()) as Mortgage;
  }
  function postStatement(app: ReturnType<typeof mkApp>, token: string, mId: string, body: unknown) {
    return app.request(
      `/households/${HID}/mortgage/${mId}/statements`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      testEnv
    );
  }

  it('commits a statement and the summary reconciles to its closing balance', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);

    // A statement dated today reports 480k (a prepayment happened) — the summary
    // must SNAP to it (confirmed), overriding the theoretical 500k.
    const res = await postStatement(app, token, m.id, {
      statementDate: today(),
      closingBalanceCents: 48_000_000,
      interestPaidCents: 200_000,
      principalPaidCents: 90_000,
    });
    expect(res.status).toBe(201);

    const summaryRes = await app.request(
      `/households/${HID}/mortgage/${m.id}/summary`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    const s = (await summaryRes.json()) as MortgageSummary;
    expect(s.currentBalanceCents).toBe(48_000_000);
    expect(s.balanceStatus).toBe('confirmed');
    expect(s.pctPaid).toBeCloseTo(0.04, 4); // (50m - 48m)/50m
  });

  // ---- Rate periods: the per-statement interest-rate history (0118) ----

  interface RatePeriodRow {
    id: string;
    statement_id: string | null;
    effective_date: string;
    rate_bps: number;
    prime_rate_bps: number | null;
    variance_bps: number | null;
    source: string;
  }

  async function getRatePeriods(
    app: ReturnType<typeof mkApp>,
    token: string,
    mId: string
  ): Promise<RatePeriodRow[]> {
    const res = await app.request(
      `/households/${HID}/mortgage/${mId}/rate-periods`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { ratePeriods: RatePeriodRow[] }).ratePeriods;
  }

  it('persists a statement rate breakdown as dated rate periods, oldest first', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);

    // A TD FlexLine December statement: prime cut mid-period on Oct 30, so the
    // statement lists TWO sub-periods. Both must survive as dated rows.
    const res = await postStatement(app, token, m.id, {
      statementDate: '2025-12-31',
      closingBalanceCents: 96_798_197,
      interestRateBps: 359,
      ratePeriods: [
        { effectiveDate: '2025-10-01', rateBps: 384, primeRateBps: 470, varianceBps: -86 },
        { effectiveDate: '2025-10-30', rateBps: 359, primeRateBps: 445, varianceBps: -86 },
      ],
    });
    expect(res.status).toBe(201);

    const periods = await getRatePeriods(app, token, m.id);
    expect(periods).toHaveLength(2);
    expect(periods.map((p) => p.effective_date)).toEqual(['2025-10-01', '2025-10-30']);
    expect(periods[1].rate_bps).toBe(359);
    expect(periods[1].variance_bps).toBe(-86); // signed variance survives
    expect(periods[1].source).toBe('statement');
  });

  it('derives a single rate period from the headline rate when no breakdown is sent', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);

    await postStatement(app, token, m.id, {
      statementDate: '2025-08-31',
      closingBalanceCents: 97_408_010,
      interestRateBps: 409,
      primeRateBps: 495,
      varianceBps: -86,
    });

    const periods = await getRatePeriods(app, token, m.id);
    expect(periods).toHaveLength(1);
    // Dated at the statement date — a manual entry still feeds the history.
    expect(periods[0].effective_date).toBe('2025-08-31');
    expect(periods[0].rate_bps).toBe(409);
  });

  it('records no rate period when the statement reported no rate at all', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);
    await postStatement(app, token, m.id, { statementDate: '2025-08-31', closingBalanceCents: 97_408_010 });
    expect(await getRatePeriods(app, token, m.id)).toHaveLength(0);
  });

  it('REPLACES a re-committed statement’s periods rather than duplicating them', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);
    const body = (periods: unknown) => ({
      statementDate: '2025-12-31',
      closingBalanceCents: 96_798_197,
      ratePeriods: periods,
      replace: true,
    });

    await postStatement(app, token, m.id, body([
      { effectiveDate: '2025-10-01', rateBps: 384 },
      { effectiveDate: '2025-10-30', rateBps: 359 },
    ]));
    // A correction that MERGES the two sub-periods into one. The dropped period
    // must not linger — it would read as a phantom rate change.
    await postStatement(app, token, m.id, body([{ effectiveDate: '2025-10-01', rateBps: 359 }]));

    const periods = await getRatePeriods(app, token, m.id);
    expect(periods).toHaveLength(1);
    expect(periods[0].effective_date).toBe('2025-10-01');
    expect(periods[0].rate_bps).toBe(359);
  });

  it('drops a deleted statement’s rate periods', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);
    const created = await postStatement(app, token, m.id, {
      statementDate: '2025-12-31',
      closingBalanceCents: 96_798_197,
      interestRateBps: 359,
    });
    const stmt = (await created.json()) as { id: string };
    expect(await getRatePeriods(app, token, m.id)).toHaveLength(1);

    const del = await app.request(
      `/households/${HID}/mortgage/${m.id}/statements/${stmt.id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(del.status).toBe(204);
    expect(await getRatePeriods(app, token, m.id)).toHaveLength(0);
  });

  it('scopes rate periods to the household (403 for an outsider)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);
    const outsider = await mintToken(OTHER_UID);
    const res = await app.request(
      `/households/${HID}/mortgage/${m.id}/rate-periods`,
      { headers: { Authorization: `Bearer ${outsider}` } },
      testEnv
    );
    expect(res.status).toBe(403);
  });

  // ---- Forecast enhancements: actual-interest, forward-rate, projection ----

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  async function getSummary(app: ReturnType<typeof mkApp>, token: string, mId: string): Promise<MortgageSummary> {
    const res = await app.request(
      `/households/${HID}/mortgage/${mId}/summary`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    return (await res.json()) as MortgageSummary;
  }

  it("interest paid to date sums the bank's actuals from statements (source='actual')", async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);

    // Two statements: the latest is dated TODAY so there's no forward tail — the
    // to-date interest is exactly the sum of both statements' interest_paid.
    await postStatement(app, token, m.id, {
      statementDate: daysAgo(35),
      closingBalanceCents: 49_800_000,
      interestPaidCents: 205_000,
      principalPaidCents: 85_000,
    });
    await postStatement(app, token, m.id, {
      statementDate: today(),
      closingBalanceCents: 49_600_000,
      interestPaidCents: 203_000,
      principalPaidCents: 87_000,
    });

    const s = await getSummary(app, token, m.id);
    expect(s.paidToDate?.interestSource).toBe('actual');
    expect(s.paidToDate?.statementsWithInterest).toBe(2);
    expect(s.paidToDate?.throughDate).toBe(today());
    expect(s.totalInterestToDateCents).toBe(408_000); // 205k + 203k, no tail
    // Principal to date stays balance-derived (reconciled): 50m − 49.6m.
    expect(s.totalPrincipalToDateCents).toBe(400_000);
  });

  it('projects the balance forward at the LATEST statement rate, not the term rate', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token); // term rate = 5.00%

    // A statement two months back reports a much higher rate (7.00%). The forward
    // projection + rate view must adopt it — the variable-rate fix.
    await postStatement(app, token, m.id, {
      statementDate: daysAgo(60),
      closingBalanceCents: 49_500_000,
      interestPaidCents: 260_000,
      interestRateBps: 700,
    });

    const s = await getSummary(app, token, m.id);
    expect(s.projected.forwardRate.basedOn).toBe('statement');
    expect(s.projected.forwardRate.nominalPct).toBe(7);
    expect(s.projected.forwardRate.asOfDate).toBe(daysAgo(60));
    expect(s.rate.nominalPct).toBe(7); // "current rate" reflects the latest statement
    expect(s.balanceStatus).toBe('estimated'); // projected past the anchor
  });

  it('forecasts to the end of the current term (amortizing, interest remaining > 0)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);

    const s = await getSummary(app, token, m.id);
    expect(s.projected.toEndOfTerm.date).toBe(s.currentTerm.maturityDate);
    expect(s.projected.toEndOfTerm.balanceCents).toBeLessThan(s.originalPrincipalCents); // paid down
    expect(s.projected.toEndOfTerm.interestRemainingCents).toBeGreaterThan(0);
    expect(s.projected.toEndOfTerm.totalInterestCents).toBeGreaterThan(0);
    expect(s.projected.projectionStale).toBe(false); // no anchor yet
    expect(s.remainingAmortizationMonths).toBeGreaterThan(290); // ~300 at term start
  });

  it('dedups a statement for the same date (409) but allows replace', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);

    const first = await postStatement(app, token, m.id, { statementDate: '2026-01-31', closingBalanceCents: 49_000_000 });
    expect(first.status).toBe(201);

    const dup = await postStatement(app, token, m.id, { statementDate: '2026-01-31', closingBalanceCents: 48_500_000 });
    expect(dup.status).toBe(409);

    const replaced = await postStatement(app, token, m.id, { statementDate: '2026-01-31', closingBalanceCents: 48_500_000, replace: true });
    expect(replaced.status).toBe(201);

    const listRes = await app.request(`/households/${HID}/mortgage/${m.id}/statements`, { headers: { Authorization: `Bearer ${token}` } }, testEnv);
    const list = (await listRes.json()) as { statements: unknown[] };
    expect(list.statements).toHaveLength(1); // replaced, not duplicated
  });

  it('deletes a single statement (clean data)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);

    const stmt = (await (
      await postStatement(app, token, m.id, { statementDate: '2026-02-28', closingBalanceCents: 47_000_000 })
    ).json()) as { id: string };

    const delRes = await app.request(
      `/households/${HID}/mortgage/${m.id}/statements/${stmt.id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(delRes.status).toBe(204);

    const listRes = await app.request(`/households/${HID}/mortgage/${m.id}/statements`, { headers: { Authorization: `Bearer ${token}` } }, testEnv);
    expect(((await listRes.json()) as { statements: unknown[] }).statements).toHaveLength(0);
  });

  it('deleting a property wipes every related artifact (statements, offers, terms)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);

    // Seed a full set of children: a statement, an offer, and the term created at setup.
    await postStatement(app, token, m.id, { statementDate: '2026-04-30', closingBalanceCents: 46_000_000 });
    await app.request(
      `/households/${HID}/mortgage/${m.id}/offers`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ bankName: 'RBC', offeredRateBps: 400, rateType: 'fixed', termMonths: 60 }) },
      testEnv
    );

    const delRes = await app.request(`/households/${HID}/mortgage/${m.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }, testEnv);
    expect(delRes.status).toBe(204);

    // Nothing tied to the property survives — a delete is a guaranteed full wipe.
    const count = async (table: string) =>
      ((await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE mortgage_id = ?`).bind(m.id).first()) as { n: number }).n;
    expect(await count('mortgage_statements')).toBe(0);
    expect(await count('mortgage_renewal_offers')).toBe(0);
    expect(await count('mortgage_terms')).toBe(0);
  });

  it('renews into a second term (re-amortized), listed as sequence 2', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);

    const renewRes = await app.request(
      `/households/${HID}/mortgage/${m.id}/renew`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          termStartDate: today(),
          termMonths: 60,
          rateType: 'fixed',
          compounding: 'semi_annual',
          nominalRateBps: 600, // renewed higher
          paymentFrequency: 'monthly',
        }),
      },
      testEnv
    );
    expect(renewRes.status).toBe(201);
    const term2 = (await renewRes.json()) as MortgageTerm;
    expect(term2.sequence).toBe(2);
    expect(term2.nominal_rate_bps).toBe(600);
    expect(term2.scheduled_payment_cents).toBeGreaterThan(0);

    const termsRes = await app.request(`/households/${HID}/mortgage/${m.id}/terms`, { headers: { Authorization: `Bearer ${token}` } }, testEnv);
    const terms = (await termsRes.json()) as { terms: MortgageTerm[] };
    expect(terms.terms).toHaveLength(2);
    // The current (renewed) term reprices higher than the original.
    expect(s2Rate(terms.terms)).toBe(600);
  });

  it('records rate/prepayment events and lists them newest-first (change history)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);

    const addEvent = (body: unknown) =>
      app.request(
        `/households/${HID}/mortgage/${m.id}/events`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        testEnv
      );

    expect((await addEvent({ eventType: 'rate_change', eventDate: '2026-01-15', newRateBps: 450, note: 'Prime moved' })).status).toBe(201);
    expect((await addEvent({ eventType: 'lump_sum_prepayment', eventDate: '2027-03-01', amountCents: 1_000_000 })).status).toBe(201);

    const listRes = await app.request(`/households/${HID}/mortgage/${m.id}/events`, { headers: { Authorization: `Bearer ${token}` } }, testEnv);
    expect(listRes.status).toBe(200);
    const { events } = (await listRes.json()) as {
      events: Array<{ event_type: string; event_date: string; amount_cents: number | null; new_rate_bps: number | null; note: string | null }>;
    };
    expect(events).toHaveLength(2);
    // Newest first: the 2027 prepayment precedes the 2026 rate change.
    expect(events[0].event_type).toBe('lump_sum_prepayment');
    expect(events[0].amount_cents).toBe(1_000_000);
    expect(events[1].event_type).toBe('rate_change');
    expect(events[1].new_rate_bps).toBe(450);
    expect(events[1].note).toBe('Prime moved');
  });

  it('403 listing events for a mortgage in another household', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1(app, token);
    const outsider = await mintToken(OTHER_UID);
    const res = await app.request(`/households/${HID}/mortgage/${m.id}/events`, { headers: { Authorization: `Bearer ${outsider}` } }, testEnv);
    expect(res.status).toBe(403);
  });
});

function s2Rate(terms: MortgageTerm[]): number {
  return terms.find((t) => t.sequence === 2)?.nominal_rate_bps ?? 0;
}

describe('mortgage offers + what-if (Phase 5)', () => {
  beforeEach(seed);

  async function createGv1b(app: ReturnType<typeof mkApp>, token: string): Promise<Mortgage> {
    return (await (await authedPost(app, token, gv1Body())).json()) as Mortgage;
  }

  it('adds a renewal offer and computes payment saved vs the incumbent', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1b(app, token);

    const addRes = await app.request(
      `/households/${HID}/mortgage/${m.id}/offers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankName: 'RBC', offeredRateBps: 400, rateType: 'fixed', termMonths: 60 }),
      },
      testEnv
    );
    expect(addRes.status).toBe(201);

    const listRes = await app.request(`/households/${HID}/mortgage/${m.id}/offers`, { headers: { Authorization: `Bearer ${token}` } }, testEnv);
    const view = (await listRes.json()) as {
      incumbentPaymentCents: number;
      offers: Array<{ id: string; bankName: string; monthlyPaymentCents: number; paymentSavedVsCurrentCents: number; offeredRatePct: number }>;
    };
    expect(view.offers).toHaveLength(1);
    expect(view.offers[0].bankName).toBe('RBC');
    expect(view.offers[0].offeredRatePct).toBe(4);
    // A lower rate (4% vs 5%) is cheaper → positive saving.
    expect(view.offers[0].monthlyPaymentCents).toBeGreaterThan(0);
    expect(view.offers[0].paymentSavedVsCurrentCents).toBeGreaterThan(0);
  });

  it('shortlists then deletes an offer', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1b(app, token);
    const offer = (await (
      await app.request(
        `/households/${HID}/mortgage/${m.id}/offers`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ bankName: 'BMO', offeredRateBps: 450, rateType: 'fixed', termMonths: 60 }) },
        testEnv
      )
    ).json()) as { id: string };

    const patchRes = await app.request(
      `/households/${HID}/mortgage/${m.id}/offers/${offer.id}`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'shortlisted' }) },
      testEnv
    );
    expect(patchRes.status).toBe(200);
    expect(((await patchRes.json()) as { status: string }).status).toBe('shortlisted');

    const delRes = await app.request(`/households/${HID}/mortgage/${m.id}/offers/${offer.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }, testEnv);
    expect(delRes.status).toBe(204);
  });

  it('computes an accelerated-biweekly what-if', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const m = await createGv1b(app, token);
    const res = await app.request(
      `/households/${HID}/mortgage/${m.id}/what-if?lumpSumCents=5000000`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      acceleratedBiweeklyPaymentCents: number;
      acceleratedYearsToPayoff: number | null;
      lumpSumInterestSavedCents: number | null;
    };
    // Accel biweekly ≈ half the ~$2,908 monthly payment.
    expect(view.acceleratedBiweeklyPaymentCents).toBeGreaterThan(140000);
    expect(view.acceleratedBiweeklyPaymentCents).toBeLessThan(150000);
    expect(view.acceleratedYearsToPayoff).not.toBeNull();
    expect(view.lumpSumInterestSavedCents).toBeGreaterThan(0);
  });
});

describe('mortgage extract route (Phase 3)', () => {
  beforeEach(seed);

  it('403 for a non-member before the AI gate', async () => {
    const token = await mintToken(OTHER_UID); // not a member of HID
    const app = mkApp();
    const form = new FormData();
    form.set('text', 'TD statement closing balance 480000');
    const res = await app.request(
      `/households/${HID}/mortgage/any/statements/extract`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
      testEnv
    );
    expect(res.status).toBe(403);
  });
});
