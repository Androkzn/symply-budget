/**
 * budget.ts — grocery receipt scan route + saved_amount expense persistence.
 *
 * Covers:
 *   - POST /receipts/scan multipart happy path (mocked ReceiptScanService)
 *   - 400 when no file is attached
 *   - 400 for unsupported file types
 *   - 401 for an unauthenticated request
 *   - saved_amount is persisted on POST /expenses and aggregated into
 *     monthly-overview.savedTotal (real BudgetService).
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as schema from '../../db/schema';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import { EXPENSE_INSERT_COLUMNS } from '../../services/budget-service';
import fixtures from '../../test-utils/fixtures';
import type { Env } from '../../types';
import { ValidationError } from '../../utils/errors';
import budgetRouter from '../budget';

import {
  applyBudgetWorkerTestBrand,
  createBudgetTables,
  resetBudgetTables,
} from './budget-test-helpers';

// Real test-document fixtures (resourses/testing/*), inlined for the worker runtime.

const mockScanReceipt = vi.fn();

vi.mock('../../services/budget-analysis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/budget-analysis')>();
  return {
    ...actual,
    ReceiptScanService: class MockReceiptScanService {
      scanReceipt = mockScanReceipt;
    },
  };
});

const testEnv = env as unknown as Env;
const HID = 'hh_receipt_scan_01';
const UID = 'u_receipt_scan_owner';
const MID = 'm_receipt_scan_owner';

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
  app.route('/households/:householdId/budget', budgetRouter);
  return app;
}

async function seed(): Promise<void> {
  applyBudgetWorkerTestBrand(testEnv);

  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({ id: UID, email: 'receipt@example.com', email_verified: true });
  await db.insert(schema.households).values({ id: HID, name: 'ReceiptScanTest' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
}

describe('POST /receipts/scan', () => {
  beforeEach(async () => {
    await seed();
    mockScanReceipt.mockReset();
    mockScanReceipt.mockResolvedValue({
      vendor: 'FreshMart',
      purchase_date: '2026-07-01',
      category_id: 'cat-groceries',
      category_name: 'Groceries',
      items: [
        { name: 'milk', amount: 349, saved_amount: 0, category_id: 'cat-groceries', category_name: 'Groceries' },
        { name: 'wine', amount: 599, saved_amount: 279, category_id: 'cat-alcohol', category_name: 'Alcohol' },
      ],
    });
  });

  it('returns the extracted receipt for a multipart image upload', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    // Real 240KB grocery receipt JPEG (ReceiptScanService is mocked below).
    form.append('file', fixtures.fixtureFile('budget-receipt'));

    const res = await app.request(
      `/households/${HID}/budget/receipts/scan`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
      testEnv
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ name: string; saved_amount: number; category_id: string | null; category_name: string | null }>;
      vendor: string;
    };
    expect(body.vendor).toBe('FreshMart');
    expect(body.items).toHaveLength(2);
    expect(body.items[1]?.saved_amount).toBe(279);
    // Per-item category is passed through untouched by the route.
    expect(body.items[0]?.category_id).toBe('cat-groceries');
    expect(body.items[1]?.category_name).toBe('Alcohol');
    expect(mockScanReceipt).toHaveBeenCalledTimes(1);
    const call = mockScanReceipt.mock.calls[0];
    expect(call?.[0]).toBe(HID);
    expect(call?.[1]).toBe(UID);
    // The route now passes a { segments: [...] } payload (multi-file capable).
    expect(call?.[2]?.segments?.[0]?.mimeType).toBe('image/jpeg');
    expect(call?.[2]?.segments).toHaveLength(1);
  });

  it('returns 400 when no file is attached', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/budget/receipts/scan`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: new FormData() },
      testEnv
    );
    expect(res.status).toBe(400);
    expect(mockScanReceipt).not.toHaveBeenCalled();
  });

  it('returns 400 for unsupported file types', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    form.append('file', new File(['data'], 'notes.txt', { type: 'text/plain' }));
    const res = await app.request(
      `/households/${HID}/budget/receipts/scan`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
      testEnv
    );
    expect(res.status).toBe(400);
    expect(mockScanReceipt).not.toHaveBeenCalled();
  });

  it('returns 401 without a token', async () => {
    const app = mkApp();
    const form = new FormData();
    form.append('file', new File(['x'], 'receipt.jpg', { type: 'image/jpeg' }));
    const res = await app.request(
      `/households/${HID}/budget/receipts/scan`,
      { method: 'POST', body: form },
      testEnv
    );
    expect(res.status).toBe(401);
    expect(mockScanReceipt).not.toHaveBeenCalled();
  });

  it('accepts a PDF receipt and forwards the application/pdf mime to the scanner', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    // Real small PDF fixture; the mocked scanner just echoes a parsed result.
    form.append(
      'file',
      new File([fixtures.fixtureArrayBuffer('house-bc-assessment')], 'receipt.pdf', {
        type: 'application/pdf',
      })
    );

    const res = await app.request(
      `/households/${HID}/budget/receipts/scan`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
      testEnv
    );

    expect(res.status).toBe(200);
    expect(mockScanReceipt).toHaveBeenCalledTimes(1);
    expect(mockScanReceipt.mock.calls[0]?.[2]?.segments?.[0]?.mimeType).toBe('application/pdf');
  });

  it('accepts several files as ONE receipt and forwards all segments + region', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    // A long receipt photographed in two sections + the user's Settings region.
    form.append('file', fixtures.fixtureFile('budget-receipt'));
    form.append(
      'file',
      new File([fixtures.fixtureArrayBuffer('budget-receipt')], 'part2.jpg', { type: 'image/jpeg' })
    );
    form.append('country', 'CA');
    form.append('state_province', 'BC');

    const res = await app.request(
      `/households/${HID}/budget/receipts/scan`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
      testEnv
    );

    expect(res.status).toBe(200);
    const call = mockScanReceipt.mock.calls[0];
    expect(call?.[2]?.segments).toHaveLength(2);
    expect(call?.[2]?.region).toEqual({ country: 'CA', stateProvince: 'BC' });
  });

  it('rejects more than 12 receipt files', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    for (let i = 0; i < 13; i++) {
      form.append('file', new File(['x'], `p${i}.jpg`, { type: 'image/jpeg' }));
    }
    const res = await app.request(
      `/households/${HID}/budget/receipts/scan`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
      testEnv
    );
    expect(res.status).toBe(400);
    expect(mockScanReceipt).not.toHaveBeenCalled();
  });

  it('maps an unreadable-receipt ValidationError to a friendly 400 (no raw 500)', async () => {
    mockScanReceipt.mockRejectedValueOnce(
      new ValidationError('Could not read the receipt. Try a clearer photo.')
    );
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    form.append('file', fixtures.fixtureFile('budget-receipt'));

    const res = await app.request(
      `/households/${HID}/budget/receipts/scan`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
      testEnv
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Could not read the receipt');
  });

  it('returns 500 when the scanner fails unexpectedly', async () => {
    mockScanReceipt.mockRejectedValueOnce(new Error('provider exploded'));
    const token = await mintToken(UID);
    const app = mkApp();
    const form = new FormData();
    form.append('file', fixtures.fixtureFile('budget-receipt'));

    const res = await app.request(
      `/households/${HID}/budget/receipts/scan`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
      testEnv
    );

    expect(res.status).toBe(500);
  });
});

describe('saved_amount on expenses', () => {
  beforeEach(seed);

  it('persists saved_amount and aggregates it into monthly savedTotal', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const withSavings = await app.request(
      `/households/${HID}/budget/expenses`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'greek yogurt',
          amount: 599,
          saved_amount: 279,
          expense_date: '2026-07-05',
        }),
      },
      testEnv
    );
    expect(withSavings.status).toBe(201);
    const created = (await withSavings.json()) as { expense: { saved_amount: number } };
    expect(created.expense.saved_amount).toBe(279);

    // A second expense with no savings (defaults to 0).
    await app.request(
      `/households/${HID}/budget/expenses`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'milk', amount: 349, expense_date: '2026-07-05' }),
      },
      testEnv
    );

    const overviewRes = await app.request(
      `/households/${HID}/budget/monthly-overview?year=2026&month=7`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    expect(overviewRes.status).toBe(200);
    const overview = (await overviewRes.json()) as { actualSpent: number; savedTotal: number };
    expect(overview.actualSpent).toBe(948);
    expect(overview.savedTotal).toBe(279);
  });

  it('persists deposit_amount and aggregates it into monthly depositsTotal', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const createdRes = await app.request(
      `/households/${HID}/budget/expenses`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'milk',
          amount: 566,
          deposit_amount: 10,
          expense_date: '2026-07-05',
        }),
      },
      testEnv
    );
    expect(createdRes.status).toBe(201);
    const created = (await createdRes.json()) as { expense: { deposit_amount: number } };
    expect(created.expense.deposit_amount).toBe(10);

    const overviewRes = await app.request(
      `/households/${HID}/budget/monthly-overview?year=2026&month=7`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    const overview = (await overviewRes.json()) as { depositsTotal: number };
    expect(overview.depositsTotal).toBe(10);
  });
});

describe('POST /expenses/bulk', () => {
  beforeEach(seed);

  it('chunks bulk inserts at 17 columns per expense row', () => {
    expect(EXPENSE_INSERT_COLUMNS).toBe(17);
  });

  it('creates every item atomically and aggregates them into the monthly overview', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const res = await app.request(
      `/households/${HID}/budget/expenses/bulk`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenses: [
            { title: 'milk', amount: 349, expense_date: '2026-07-05' },
            { title: 'greek yogurt', amount: 599, saved_amount: 279, expense_date: '2026-07-05' },
            { title: 'bread', amount: 250, saved_amount: 50, expense_date: '2026-07-05' },
          ],
        }),
      },
      testEnv
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { expenses: Array<{ id: string; title: string; saved_amount: number }> };
    expect(body.expenses).toHaveLength(3);
    expect(new Set(body.expenses.map((e) => e.id)).size).toBe(3);
    expect(body.expenses.map((e) => e.title)).toEqual(['milk', 'greek yogurt', 'bread']);

    const overviewRes = await app.request(
      `/households/${HID}/budget/monthly-overview?year=2026&month=7`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    const overview = (await overviewRes.json()) as { actualSpent: number; savedTotal: number };
    expect(overview.actualSpent).toBe(1198);
    expect(overview.savedTotal).toBe(329);
  });

  it('persists per-line tax_amount from a scanned (tax-inclusive) receipt', async () => {
    const token = await mintToken(UID);
    const app = mkApp();

    const res = await app.request(
      `/households/${HID}/budget/expenses/bulk`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenses: [
            { title: 'milk', amount: 349, expense_date: '2026-07-05' }, // exempt
            { title: 'bags', amount: 1120, tax_amount: 120, expense_date: '2026-07-05' }, // incl. tax
          ],
        }),
      },
      testEnv
    );

    expect(res.status).toBe(201);
    const listRes = await app.request(
      `/households/${HID}/budget/expenses?start_date=2026-07-01&end_date=2026-08-01`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    const list = (await listRes.json()) as { expenses: Array<{ title: string; tax_amount: number }> };
    const bags = list.expenses.find((e) => e.title === 'bags');
    const milk = list.expenses.find((e) => e.title === 'milk');
    expect(bags?.tax_amount).toBe(120);
    expect(milk?.tax_amount).toBe(0); // defaults when omitted
  });

  it('returns 400 for an empty list', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/budget/expenses/bulk`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenses: [] }),
      },
      testEnv
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when any item is invalid (nothing is persisted)', async () => {
    const token = await mintToken(UID);
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/budget/expenses/bulk`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenses: [
            { title: 'milk', amount: 349, expense_date: '2026-07-05' },
            { title: '', amount: 0, expense_date: '2026-07-05' },
          ],
        }),
      },
      testEnv
    );
    expect(res.status).toBe(400);

    const overviewRes = await app.request(
      `/households/${HID}/budget/monthly-overview?year=2026&month=7`,
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv
    );
    const overview = (await overviewRes.json()) as { actualSpent: number };
    expect(overview.actualSpent).toBe(0);
  });

  it('returns 401 without a token', async () => {
    const app = mkApp();
    const res = await app.request(
      `/households/${HID}/budget/expenses/bulk`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenses: [{ title: 'milk', amount: 349, expense_date: '2026-07-05' }] }),
      },
      testEnv
    );
    expect(res.status).toBe(401);
  });
});

/**
 * POST /receipts/scan/stream — the NDJSON twin. The result must be identical to
 * the buffered route; what it adds is `items` frames DURING the read, which is
 * the whole point (a 30s spinner with nothing to show otherwise).
 */
describe('POST /receipts/scan/stream', () => {
  const RESULT = {
    vendor: 'FreshMart',
    purchase_date: '2026-07-01',
    category_id: 'cat-groceries',
    category_name: 'Groceries',
    items: [{ name: 'milk', amount: 349, saved_amount: 0 }],
  };

  beforeEach(async () => {
    await seed();
    mockScanReceipt.mockReset();
  });

  /** Read the whole NDJSON body and parse one object per line. */
  async function frames(res: Response): Promise<Array<Record<string, unknown>>> {
    const text = await res.text();
    return text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  async function post(): Promise<Response> {
    const token = await mintToken(UID);
    const form = new FormData();
    form.append('file', fixtures.fixtureFile('budget-receipt'));
    return mkApp().request(
      `/households/${HID}/budget/receipts/scan/stream`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
      testEnv
    );
  }

  it('streams start → items → result as NDJSON', async () => {
    mockScanReceipt.mockImplementation(
      async (
        _hid: string,
        _uid: string,
        input: { onProgress?: (p: { stage: 'reading'; items: number }) => void }
      ) => {
        input.onProgress?.({ stage: 'reading', items: 1 });
        input.onProgress?.({ stage: 'reading', items: 2 });
        return RESULT;
      }
    );

    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');

    const events = await frames(res);
    expect(events[0]).toEqual({ type: 'start', segments: 1 });
    expect(events.filter((e) => e.type === 'items')).toEqual([
      { type: 'items', count: 1 },
      { type: 'items', count: 2 },
    ]);
    expect(events[events.length - 1]).toEqual({ type: 'result', result: RESULT });
  });

  it('opts the service into streamed extraction by passing onProgress', async () => {
    mockScanReceipt.mockResolvedValue(RESULT);
    await frames(await post());
    expect(typeof mockScanReceipt.mock.calls[0]?.[2]?.onProgress).toBe('function');
  });

  it('reports a mid-scan failure as an error frame, not a broken stream', async () => {
    // The status is locked at 200 by the first byte, so this is the only channel
    // left — the client maps it to the same alert as a 4xx body.
    mockScanReceipt.mockRejectedValue(new ValidationError('Could not read the receipt.'));

    const res = await post();
    expect(res.status).toBe(200);
    const events = await frames(res);
    expect(events[events.length - 1]).toEqual({
      type: 'error',
      message: 'Could not read the receipt.',
    });
  });

  it('still answers 400 for a bad upload — before any byte is streamed', async () => {
    const token = await mintToken(UID);
    const res = await mkApp().request(
      `/households/${HID}/budget/receipts/scan/stream`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: new FormData() },
      testEnv
    );

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(mockScanReceipt).not.toHaveBeenCalled();
  });

  it('returns 401 without a token', async () => {
    const form = new FormData();
    form.append('file', new File(['x'], 'receipt.jpg', { type: 'image/jpeg' }));
    const res = await mkApp().request(
      `/households/${HID}/budget/receipts/scan/stream`,
      { method: 'POST', body: form },
      testEnv
    );
    expect(res.status).toBe(401);
  });
});
