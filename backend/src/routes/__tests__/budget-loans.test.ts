/**
 * Loan tracking for Monthly Payments — `/households/:householdId/savings/
 * recurring-payments/:id/loan` in `routes/savings.ts`, backed by
 * `BudgetLoanService`. Covers the CRUD lifecycle, household scoping/IDOR,
 * validation, and that the returned `summary` is computed from the loan's
 * facts + the recurring payment's live `amount_cents` (never a stale cached
 * figure). The pure amortization math itself is covered by
 * `services/budget/__tests__/loan-amortization.test.ts` — this is a
 * route-level integration test.
 */
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as schema from '../../db/schema';
import { savingsRecurringPayments } from '../../db/schema-savings';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { LoanExtractionDraft } from '../../services/budget-loan-extraction-service';
import { levelPayment, periodicRate } from '../../services/mortgage/amortization';
import type { Env } from '../../types';
import savingsRouter from '../savings';

import { applyBudgetWorkerTestBrand } from './budget-test-helpers';
import { createSavingsTables, resetSavingsTables } from './savings-test-helpers';


/**
 * `POST .../loan/extract` gate. Mirrors `health-ai.test.ts`'s technique:
 * mock the whole module so a single test can force the denial path, while
 * every other test (incl. every pre-existing loan-CRUD test above, which
 * never calls `assertCanUseAI` at all) keeps the default "allowed" behavior.
 */
let entitlementError: Error | null = null;
vi.mock('../../services/entitlement-service', () => ({
  assertCanUseAI: async () => {
    if (entitlementError) throw entitlementError;
    return { allowed: true, source: 'simplehouse', provider: 'anthropic' };
  },
}));

/**
 * `POST .../loan/extract` happy path. Mirrors `budget-receipt-scan.test.ts`'s
 * technique: mock the WHOLE extraction-service module (route-level test, not
 * a service-level one — the AI provider internals are covered separately by
 * `budget-loan-extraction-service.test.ts`).
 */
const mockExtractFromUpload = vi.fn();
vi.mock('../../services/budget-loan-extraction-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/budget-loan-extraction-service')>();
  return {
    ...actual,
    BudgetLoanExtractionService: class MockBudgetLoanExtractionService {
      extractFromUpload = mockExtractFromUpload;
    },
  };
});

const testEnv = env as unknown as Env;

const HID = 'hh_loan_routes';
const UID = 'u_loan_routes_owner';
const MID = 'm_loan_routes_owner';
const PAYMENT_ID = 'pay_loan_routes_car';

const OTHER_HID = 'hh_loan_routes_other';
const OTHER_UID = 'u_loan_routes_outsider';
const OTHER_MID = 'm_loan_routes_outsider';
const OTHER_PAYMENT_ID = 'pay_loan_routes_other_car';

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
  app.route('/households/:householdId/savings', savingsRouter);
  app.onError((error, c) => {
    const apiErrorNames = ['ApiError', 'ValidationError', 'ForbiddenError', 'NotFoundError', 'AIAccessError'];
    const errorName = (error as Error).name;
    if (apiErrorNames.includes(errorName)) {
      const apiError = error as unknown as { code: string; message: string; statusCode: number };
      return c.json({ error: { code: apiError.code, message: apiError.message } }, apiError.statusCode as 400 | 403 | 404);
    }
    return c.json({ error: { code: 'internal_error', message: error.message } }, 500);
  });
  return app;
}

function authHeaders(token: string, contentType?: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...(contentType ? { 'Content-Type': contentType } : {}) };
}

const LOAN_BASE = `/households/${HID}/savings/recurring-payments/${PAYMENT_ID}/loan`;

async function seed(): Promise<void> {
  applyBudgetWorkerTestBrand(testEnv);
  await createCoreTables(testEnv.DB);
  await createSavingsTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetSavingsTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([
    { id: UID, email: 'loan-routes@example.com', email_verified: true },
    { id: OTHER_UID, email: 'loan-routes-outsider@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values([
    { id: HID, name: 'LoanRoutesTest' },
    { id: OTHER_HID, name: 'LoanRoutesOther' },
  ]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
    { id: OTHER_MID, household_id: OTHER_HID, user_id: OTHER_UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);

  const savingsDb = drizzle(testEnv.DB);
  await savingsDb.insert(savingsRecurringPayments).values([
    { id: PAYMENT_ID, household_id: HID, label: 'Car loan', amount_cents: 45_000 },
    { id: OTHER_PAYMENT_ID, household_id: OTHER_HID, label: 'Other household car loan', amount_cents: 30_000 },
  ]);

  await testEnv.CONFIG_KV.delete('savings_enabled');
}

describe('loan tracking routes', () => {
  let token: string;
  let otherToken: string;

  beforeEach(async () => {
    await seed();
    token = await mintToken(UID);
    otherToken = await mintToken(OTHER_UID);
    entitlementError = null;
    mockExtractFromUpload.mockReset();
  });

  describe('GET /loan', () => {
    it('401s without a bearer token', async () => {
      const res = await mkApp().request(LOAN_BASE, {}, testEnv);
      expect(res.status).toBe(401);
    });

    it('returns { loan: null, summary: null } when nothing is tracked yet', async () => {
      const res = await mkApp().request(LOAN_BASE, { headers: authHeaders(token) }, testEnv);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ loan: null, summary: null });
    });

    it('403s a member outside the household', async () => {
      const res = await mkApp().request(LOAN_BASE, { headers: authHeaders(otherToken) }, testEnv);
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /loan', () => {
    it('creates a loan and returns a computed summary anchored to the payment amount', async () => {
      const res = await mkApp().request(
        LOAN_BASE,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({
            rate_type: 'fixed',
            rate_bps: 649,
            principal_cents: 1_800_000,
            term_months: 60,
            start_date: '2024-01-15',
            lender: 'Toyota Financial',
          }),
        },
        testEnv
      );
      expect(res.status).toBe(200);
      const { loan, summary } = await res.json<{ loan: Record<string, unknown>; summary: Record<string, unknown> }>();
      expect(loan).toMatchObject({
        recurring_payment_id: PAYMENT_ID,
        loan_kind: 'installment',
        rate_type: 'fixed',
        rate_bps: 649,
        principal_cents: 1_800_000,
        term_months: 60,
        lender: 'Toyota Financial',
      });
      expect(summary.termMonths).toBe(60);
      // The recurring payment's amount_cents (45_000) is what drives the summary math.
      expect(summary.totalCostCents).toBeGreaterThan(1_800_000);
    });

    it('accepts a 0% APR plan without an explicit rate', async () => {
      const res = await mkApp().request(
        LOAN_BASE,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({
            rate_type: 'zero',
            principal_cents: 120_000,
            term_months: 12,
            start_date: '2026-01-15',
          }),
        },
        testEnv
      );
      expect(res.status).toBe(200);
      const { loan, summary } = await res.json<{ loan: { rate_bps: number }; summary: { totalInterestCents: number } }>();
      expect(loan.rate_bps).toBe(0);
      expect(summary.totalInterestCents).toBe(0);
    });

    it('400s a fixed rate with no rate_bps', async () => {
      const res = await mkApp().request(
        LOAN_BASE,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({
            rate_type: 'fixed',
            principal_cents: 120_000,
            term_months: 12,
            start_date: '2026-01-15',
          }),
        },
        testEnv
      );
      expect(res.status).toBe(400);
    });

    it('400s a non-positive principal', async () => {
      const res = await mkApp().request(
        LOAN_BASE,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({ rate_type: 'zero', principal_cents: 0, term_months: 12, start_date: '2026-01-15' }),
        },
        testEnv
      );
      expect(res.status).toBe(400);
    });

    it('404s a recurring_payment_id that does not belong to this household', async () => {
      const res = await mkApp().request(
        `/households/${HID}/savings/recurring-payments/does-not-exist/loan`,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({ rate_type: 'zero', principal_cents: 120_000, term_months: 12, start_date: '2026-01-15' }),
        },
        testEnv
      );
      expect(res.status).toBe(404);
    });

    it('updates in place — a second PUT does not create a second loan row', async () => {
      const put = (termMonths: number) =>
        mkApp().request(
          LOAN_BASE,
          {
            method: 'PUT',
            headers: authHeaders(token, 'application/json'),
            body: JSON.stringify({
              rate_type: 'zero',
              principal_cents: 120_000,
              term_months: termMonths,
              start_date: '2026-01-15',
            }),
          },
          testEnv
        );
      await put(12);
      const second = await put(10);
      expect(second.status).toBe(200);

      const getRes = await mkApp().request(LOAN_BASE, { headers: authHeaders(token) }, testEnv);
      const { loan } = await getRes.json<{ loan: { term_months: number } }>();
      expect(loan.term_months).toBe(10);
    });
  });

  describe('DELETE /loan', () => {
    it('removes the loan', async () => {
      await mkApp().request(
        LOAN_BASE,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({ rate_type: 'zero', principal_cents: 120_000, term_months: 12, start_date: '2026-01-15' }),
        },
        testEnv
      );

      const res = await mkApp().request(LOAN_BASE, { method: 'DELETE', headers: authHeaders(token) }, testEnv);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });

      const getRes = await mkApp().request(LOAN_BASE, { headers: authHeaders(token) }, testEnv);
      expect(await getRes.json()).toEqual({ loan: null, summary: null });
    });

    it('is a no-op (success: false) when nothing was tracked', async () => {
      const res = await mkApp().request(LOAN_BASE, { method: 'DELETE', headers: authHeaders(token) }, testEnv);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: false });
    });
  });

  describe('GET /loan/schedule', () => {
    const SCHEDULE_PATH = `${LOAN_BASE}/schedule`;

    it('401s without a bearer token', async () => {
      const res = await mkApp().request(SCHEDULE_PATH, {}, testEnv);
      expect(res.status).toBe(401);
    });

    it('404s when the recurring payment has no tracked loan', async () => {
      const res = await mkApp().request(SCHEDULE_PATH, { headers: authHeaders(token) }, testEnv);
      expect(res.status).toBe(404);
    });

    it('200s with the right row count and a 0 balance on the final row', async () => {
      // Align the recurring payment's amount with the theoretical level
      // payment for this principal/rate/term — the seeded fixture amount
      // (45_000) would overpay and legitimately pay the loan off early.
      const principalCents = 1_800_000;
      const termMonths = 60;
      const rateBps = 649;
      const i = periodicRate(rateBps / 10_000, 12, 'monthly');
      const pmt = Math.round(levelPayment(principalCents, i, termMonths));

      await mkApp().request(
        `/households/${HID}/savings/recurring-payments/${PAYMENT_ID}`,
        {
          method: 'PATCH',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({ amount_cents: pmt }),
        },
        testEnv
      );
      await mkApp().request(
        LOAN_BASE,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({
            rate_type: 'fixed',
            rate_bps: rateBps,
            principal_cents: principalCents,
            term_months: termMonths,
            start_date: '2024-01-15',
            lender: 'Toyota Financial',
          }),
        },
        testEnv
      );

      const res = await mkApp().request(SCHEDULE_PATH, { headers: authHeaders(token) }, testEnv);
      expect(res.status).toBe(200);
      const body = await res.json<{
        paymentsElapsed: number;
        rows: Array<{ index: number; interest: number; principal: number; balance: number }>;
      }>();
      expect(body.rows).toHaveLength(60);
      expect(body.rows[body.rows.length - 1].balance).toBe(0);
      expect(body.paymentsElapsed).toBeGreaterThanOrEqual(0);
      expect(body.paymentsElapsed).toBeLessThanOrEqual(60);
    });

    it('a zero-rate loan schedule has zero interest on every row', async () => {
      // principal_cents is an exact multiple of the seeded payment (45_000)
      // times term_months, so the 0% schedule runs the full term with no
      // early payoff or final-row shortfall.
      await mkApp().request(
        `/households/${HID}/savings/recurring-payments/${PAYMENT_ID}`,
        {
          method: 'PATCH',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({ amount_cents: 45_000 }),
        },
        testEnv
      );
      await mkApp().request(
        LOAN_BASE,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({
            rate_type: 'zero',
            principal_cents: 45_000 * 12,
            term_months: 12,
            start_date: '2026-01-15',
          }),
        },
        testEnv
      );

      const res = await mkApp().request(SCHEDULE_PATH, { headers: authHeaders(token) }, testEnv);
      expect(res.status).toBe(200);
      const { rows } = await res.json<{ rows: Array<{ interest: number }> }>();
      expect(rows).toHaveLength(12);
      for (const r of rows) expect(r.interest).toBe(0);
    });

    it('403s a member outside the household', async () => {
      const res = await mkApp().request(SCHEDULE_PATH, { headers: authHeaders(otherToken) }, testEnv);
      expect(res.status).toBe(403);
    });

    it('404s a recurring_payment_id that belongs to a different household (IDOR)', async () => {
      await mkApp().request(
        `/households/${OTHER_HID}/savings/recurring-payments/${OTHER_PAYMENT_ID}/loan`,
        {
          method: 'PUT',
          headers: authHeaders(otherToken, 'application/json'),
          body: JSON.stringify({
            rate_type: 'zero',
            principal_cents: 90_000,
            term_months: 6,
            start_date: '2026-01-15',
          }),
        },
        testEnv
      );

      // The requesting user (token, household HID) reaches into OTHER_HID's payment.
      const res = await mkApp().request(
        `/households/${HID}/savings/recurring-payments/${OTHER_PAYMENT_ID}/loan/schedule`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(404);
    });
  });

  describe('GET /recurring-payments (list view)', () => {
    it('includes a loan_summary per item once a loan is tracked, without an extra round-trip', async () => {
      await mkApp().request(
        LOAN_BASE,
        {
          method: 'PUT',
          headers: authHeaders(token, 'application/json'),
          body: JSON.stringify({ rate_type: 'zero', principal_cents: 450_000, term_months: 10, start_date: '2026-01-15' }),
        },
        testEnv
      );

      const res = await mkApp().request(
        `/households/${HID}/savings/recurring-payments`,
        { headers: authHeaders(token) },
        testEnv
      );
      expect(res.status).toBe(200);
      const { items } = await res.json<{ items: Array<{ id: string; loan_summary: { termMonths: number } | null }> }>();
      const item = items.find((i) => i.id === PAYMENT_ID);
      expect(item?.loan_summary?.termMonths).toBe(10);
    });
  });

  it('a deleted recurring payment cascades to its loan row', async () => {
    await mkApp().request(
      LOAN_BASE,
      {
        method: 'PUT',
        headers: authHeaders(token, 'application/json'),
        body: JSON.stringify({ rate_type: 'zero', principal_cents: 120_000, term_months: 12, start_date: '2026-01-15' }),
      },
      testEnv
    );

    const db = drizzle(testEnv.DB);
    await db.delete(savingsRecurringPayments).where(eq(savingsRecurringPayments.id, PAYMENT_ID)).run();

    const getRes = await mkApp().request(LOAN_BASE, { headers: authHeaders(token) }, testEnv);
    // The recurring payment is gone, so the loan lookup 404s via assertRecurringPayment.
    expect(getRes.status).toBe(404);
  });

  describe('PUT /loan — portal_url', () => {
    const basePayload = {
      rate_type: 'zero' as const,
      principal_cents: 120_000,
      term_months: 12,
      start_date: '2026-01-15',
    };

    function put(body: Record<string, unknown>) {
      return mkApp().request(
        LOAN_BASE,
        { method: 'PUT', headers: authHeaders(token, 'application/json'), body: JSON.stringify(body) },
        testEnv
      );
    }

    it('creates with portal_url set, preserves it on a PUT that omits it, and clears it on an explicit null', async () => {
      const created = await put({
        ...basePayload,
        portal_url: 'https://www.ikea.com/us/en/customer-service/payment-plan/',
      });
      expect(created.status).toBe(200);
      const { loan: createdLoan } = await created.json<{ loan: { portal_url: string | null } }>();
      expect(createdLoan.portal_url).toBe('https://www.ikea.com/us/en/customer-service/payment-plan/');

      // A later PUT that omits portal_url preserves the prior value.
      const updated = await put({ ...basePayload, term_months: 10 });
      expect(updated.status).toBe(200);
      const { loan: updatedLoan } = await updated.json<{
        loan: { portal_url: string | null; term_months: number };
      }>();
      expect(updatedLoan.term_months).toBe(10);
      expect(updatedLoan.portal_url).toBe('https://www.ikea.com/us/en/customer-service/payment-plan/');

      // An explicit null clears it.
      const cleared = await put({ ...basePayload, portal_url: null });
      expect(cleared.status).toBe(200);
      const { loan: clearedLoan } = await cleared.json<{ loan: { portal_url: string | null } }>();
      expect(clearedLoan.portal_url).toBeNull();
    });

    it('400s a malformed portal_url', async () => {
      const res = await put({ ...basePayload, portal_url: 'not-a-url' });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /loan — amount_paid_cents', () => {
    const basePayload = {
      rate_type: 'zero' as const,
      principal_cents: 120_000,
      term_months: 12,
      start_date: '2026-01-15',
    };

    function put(body: Record<string, unknown>) {
      return mkApp().request(
        LOAN_BASE,
        { method: 'PUT', headers: authHeaders(token, 'application/json'), body: JSON.stringify(body) },
        testEnv
      );
    }

    it('creates with amount_paid_cents set, preserves it on a PUT that omits it, and clears it on an explicit null', async () => {
      const created = await put({ ...basePayload, amount_paid_cents: 24_000 });
      expect(created.status).toBe(200);
      const { loan: createdLoan } = await created.json<{ loan: { amount_paid_cents: number | null } }>();
      expect(createdLoan.amount_paid_cents).toBe(24_000);

      // A later PUT that omits amount_paid_cents preserves the prior value.
      const updated = await put({ ...basePayload, term_months: 10 });
      expect(updated.status).toBe(200);
      const { loan: updatedLoan } = await updated.json<{
        loan: { amount_paid_cents: number | null; term_months: number };
      }>();
      expect(updatedLoan.term_months).toBe(10);
      expect(updatedLoan.amount_paid_cents).toBe(24_000);

      // An explicit null clears it.
      const cleared = await put({ ...basePayload, amount_paid_cents: null });
      expect(cleared.status).toBe(200);
      const { loan: clearedLoan } = await cleared.json<{ loan: { amount_paid_cents: number | null } }>();
      expect(clearedLoan.amount_paid_cents).toBeNull();
    });

    it('400s a negative amount_paid_cents', async () => {
      const res = await put({ ...basePayload, amount_paid_cents: -100 });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /loan/extract ("Fill with AI")', () => {
    const EXTRACT_PATH = `${LOAN_BASE}/extract`;

    function jpegFile(name = 'statement.jpg'): File {
      return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], name, { type: 'image/jpeg' });
    }

    it('401s without a bearer token', async () => {
      const form = new FormData();
      form.append('file', jpegFile());
      const res = await mkApp().request(EXTRACT_PATH, { method: 'POST', body: form }, testEnv);
      expect(res.status).toBe(401);
      expect(mockExtractFromUpload).not.toHaveBeenCalled();
    });

    it('403s a member outside the household, before the AI gate', async () => {
      const form = new FormData();
      form.append('file', jpegFile());
      const res = await mkApp().request(
        EXTRACT_PATH,
        { method: 'POST', headers: authHeaders(otherToken), body: form },
        testEnv
      );
      expect(res.status).toBe(403);
      expect(mockExtractFromUpload).not.toHaveBeenCalled();
    });

    it('404s a recurring_payment_id that belongs to a different household (IDOR), never spending an AI call', async () => {
      const form = new FormData();
      form.append('file', jpegFile());
      const res = await mkApp().request(
        `/households/${HID}/savings/recurring-payments/${OTHER_PAYMENT_ID}/loan/extract`,
        { method: 'POST', headers: authHeaders(token), body: form },
        testEnv
      );
      expect(res.status).toBe(404);
      expect(mockExtractFromUpload).not.toHaveBeenCalled();
    });

    it('returns a non-2xx when the user has no AI entitlement', async () => {
      entitlementError = Object.assign(new Error('AI access requires an Apple subscription or a connected API key'), {
        name: 'AIAccessError',
        code: 'ai_access_required',
        statusCode: 403,
      });
      const form = new FormData();
      form.append('file', jpegFile());
      const res = await mkApp().request(
        EXTRACT_PATH,
        { method: 'POST', headers: authHeaders(token), body: form },
        testEnv
      );
      expect(res.status).not.toBe(200);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(mockExtractFromUpload).not.toHaveBeenCalled();
    });

    it('400s when no file is attached', async () => {
      const res = await mkApp().request(
        EXTRACT_PATH,
        { method: 'POST', headers: authHeaders(token), body: new FormData() },
        testEnv
      );
      expect(res.status).toBe(400);
      expect(mockExtractFromUpload).not.toHaveBeenCalled();
    });

    it('400s an unsupported file type', async () => {
      const form = new FormData();
      form.append('file', new File(['hello'], 'notes.txt', { type: 'text/plain' }));
      const res = await mkApp().request(
        EXTRACT_PATH,
        { method: 'POST', headers: authHeaders(token), body: form },
        testEnv
      );
      expect(res.status).toBe(400);
      expect(mockExtractFromUpload).not.toHaveBeenCalled();
    });

    it('returns { draft } from a mocked extraction on the happy path', async () => {
      const draft: LoanExtractionDraft = {
        principal_cents: 180_000,
        monthlyPaymentCents: 7_500,
        dueDayOfMonth: 22,
        term_months: 24,
        rate_type: 'zero',
        rate_bps: 0,
        lender: 'IKEA',
        notes: 'Loan #4',
        amountPaidCents: 5_000,
        lowConfidenceFields: [],
      };
      mockExtractFromUpload.mockResolvedValue({ draft });

      const form = new FormData();
      form.append('file', jpegFile());
      const res = await mkApp().request(
        EXTRACT_PATH,
        { method: 'POST', headers: authHeaders(token), body: form },
        testEnv
      );

      expect(res.status).toBe(200);
      const body = await res.json<{ draft: LoanExtractionDraft }>();
      expect(body.draft).toEqual(draft);
      expect(mockExtractFromUpload).toHaveBeenCalledTimes(1);
      const call = mockExtractFromUpload.mock.calls[0];
      expect(call?.[1]).toBe('image/jpeg');
      expect(call?.[2]).toBe(HID);
      expect(call?.[3]).toBe(UID);
    });
  });

  describe('POST /recurring-payments/loan-extract-draft ("Fill with AI" before Save)', () => {
    const DRAFT_EXTRACT_PATH = `/households/${HID}/savings/recurring-payments/loan-extract-draft`;

    function jpegFile(name = 'statement.jpg'): File {
      return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], name, { type: 'image/jpeg' });
    }

    it('401s without a bearer token', async () => {
      const form = new FormData();
      form.append('file', jpegFile());
      const res = await mkApp().request(DRAFT_EXTRACT_PATH, { method: 'POST', body: form }, testEnv);
      expect(res.status).toBe(401);
      expect(mockExtractFromUpload).not.toHaveBeenCalled();
    });

    it('403s a member outside the household, before the AI gate', async () => {
      const form = new FormData();
      form.append('file', jpegFile());
      const res = await mkApp().request(
        DRAFT_EXTRACT_PATH,
        { method: 'POST', headers: authHeaders(otherToken), body: form },
        testEnv
      );
      expect(res.status).toBe(403);
      expect(mockExtractFromUpload).not.toHaveBeenCalled();
    });

    it('returns a non-2xx when the user has no AI entitlement', async () => {
      entitlementError = Object.assign(new Error('AI access requires an Apple subscription or a connected API key'), {
        name: 'AIAccessError',
        code: 'ai_access_required',
        statusCode: 403,
      });
      const form = new FormData();
      form.append('file', jpegFile());
      const res = await mkApp().request(
        DRAFT_EXTRACT_PATH,
        { method: 'POST', headers: authHeaders(token), body: form },
        testEnv
      );
      expect(res.status).not.toBe(200);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(mockExtractFromUpload).not.toHaveBeenCalled();
    });

    it('400s when no file is attached', async () => {
      const res = await mkApp().request(
        DRAFT_EXTRACT_PATH,
        { method: 'POST', headers: authHeaders(token), body: new FormData() },
        testEnv
      );
      expect(res.status).toBe(400);
      expect(mockExtractFromUpload).not.toHaveBeenCalled();
    });

    it('400s an unsupported file type', async () => {
      const form = new FormData();
      form.append('file', new File(['hello'], 'notes.txt', { type: 'text/plain' }));
      const res = await mkApp().request(
        DRAFT_EXTRACT_PATH,
        { method: 'POST', headers: authHeaders(token), body: form },
        testEnv
      );
      expect(res.status).toBe(400);
      expect(mockExtractFromUpload).not.toHaveBeenCalled();
    });

    it('returns { draft } from a mocked extraction with no recurring_payment_id in play at all', async () => {
      const draft: LoanExtractionDraft = {
        principal_cents: 250_000,
        monthlyPaymentCents: null,
        dueDayOfMonth: null,
        term_months: 36,
        rate_type: 'fixed',
        rate_bps: 599,
        lender: 'Toyota Financial',
        notes: null,
        amountPaidCents: null,
        lowConfidenceFields: ['lender'],
      };
      mockExtractFromUpload.mockResolvedValue({ draft });

      const form = new FormData();
      form.append('file', jpegFile());
      const res = await mkApp().request(
        DRAFT_EXTRACT_PATH,
        { method: 'POST', headers: authHeaders(token), body: form },
        testEnv
      );

      expect(res.status).toBe(200);
      const body = await res.json<{ draft: LoanExtractionDraft }>();
      expect(body.draft).toEqual(draft);
      expect(mockExtractFromUpload).toHaveBeenCalledTimes(1);
      const call = mockExtractFromUpload.mock.calls[0];
      expect(call?.[1]).toBe('image/jpeg');
      expect(call?.[2]).toBe(HID);
      expect(call?.[3]).toBe(UID);
    });
  });
});
