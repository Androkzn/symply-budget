/**
 * ReceiptScanService (budget-analysis) — AI vision extraction of receipts into
 * reviewable line items (generic names, price paid, discount savings).
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ClaudeProvider } from '../../ai/claude-provider';
import {
  SCAN_GROCERY_RECEIPT_SCHEMA,
  SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT,
} from '../../ai/prompts/scan-grocery-receipt';
import type { AIProvider, GenerateResult } from '../../ai/provider';
import * as schema from '../../db/schema';
import { budgetCategories } from '../../db/schema-budget';
import { createBudgetTables, resetBudgetTables } from '../../routes/__tests__/budget-test-helpers';
// Real test-document fixtures (resourses/testing/*), inlined for the worker runtime.
import fixtures from '../../test-utils/fixtures';
import type { Env } from '../../types';
import { ValidationError } from '../../utils/errors';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { ReceiptScanService as GroceryReceiptService } from '../budget-analysis';

const testEnv = env as unknown as Env;

// Real 240KB grocery receipt JPEG (budget-receipt fixture), cached across tests.
let cachedReceipt: ArrayBuffer | null = null;
function realReceiptJpeg(): ArrayBuffer {
  if (!cachedReceipt) cachedReceipt = fixtures.fixtureArrayBuffer('budget-receipt');
  return cachedReceipt;
}
const HID = 'hh_grocery_scan_01';
const UID = 'u_grocery_scan_owner';
const MID = 'm_grocery_scan_owner';

const mockAnthropicCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: (...args: unknown[]) => mockAnthropicCreate(...args),
    };
    constructor(_opts: { apiKey: string }) {}
  },
}));

// ---------- byte fixtures ----------

function jpegBytes(totalBytes = 40 * 1024): ArrayBuffer {
  const buf = new ArrayBuffer(totalBytes);
  const v = new DataView(buf);
  v.setUint8(0, 0xff);
  v.setUint8(1, 0xd8);
  v.setUint8(2, 0xff);
  v.setUint8(3, 0xc0);
  v.setUint16(4, 17);
  v.setUint8(6, 8);
  v.setUint16(7, 1600); // height
  v.setUint16(9, 1200); // width
  return buf;
}

function toolResult(input: unknown): GenerateResult {
  return {
    content: [{ type: 'tool_use', id: 't1', name: 'output', input }],
    stopReason: 'tool_use',
    model: 'test-model',
  };
}

function mockProvider(result: GenerateResult): { provider: AIProvider; generate: ReturnType<typeof vi.fn> } {
  const generate = vi.fn(async () => result);
  return { provider: { generate } as unknown as AIProvider, generate };
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({ id: UID, email: 'grocery@example.com', email_verified: true });
  await db.insert(schema.households).values({ id: HID, name: 'GroceryScanTest' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
}

describe('GroceryReceiptService', () => {
  beforeEach(async () => {
    await seed();
    mockAnthropicCreate.mockReset();
    testEnv.ANTHROPIC_API_KEY = 'test-key';
  });

  it('extracts normalized grocery items and resolves the Groceries category', async () => {
    const { provider } = mockProvider(
      toolResult({
        vendor: '  FreshMart  ',
        purchase_date: '2026-07-01',
        items: [
          { name: 'Milk', amount: 349, saved_amount: 0 },
          { name: 'Greek Yogurt', amount: 599, saved_amount: 279 },
        ],
      })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);

    // Feed the real receipt JPEG: the service must sniff its header, pass the
    // asset-quality gate, and extract normally (provider is mocked).
    const result = await service.scanReceipt(HID, UID, {
      data: realReceiptJpeg(),
      mimeType: 'image/jpeg',
    });

    expect(result.vendor).toBe('FreshMart');
    expect(result.purchase_date).toBe('2026-07-01');
    expect(result.category_name?.toLowerCase()).toBe('groceries');
    expect(result.category_id).toBeTruthy();
    // Items the model did not categorize default to the receipt-level Groceries.
    expect(result.items).toMatchObject([
      { name: 'Milk', amount: 349, tax_amount: 0, saved_amount: 0, category_id: result.category_id, category_name: result.category_name },
      { name: 'Greek Yogurt', amount: 599, tax_amount: 0, saved_amount: 279, category_id: result.category_id, category_name: result.category_name },
    ]);
  });

  it('merges repeated lines of the same product, summing amounts and savings', async () => {
    const { provider } = mockProvider(
      toolResult({
        vendor: 'FreshMart',
        purchase_date: null,
        items: [
          { name: 'Milk', amount: 349, saved_amount: 50 },
          { name: 'Bananas', amount: 120, saved_amount: 0 },
          { name: 'milk', amount: 349, saved_amount: 0 }, // same product, different case
          { name: 'Milk', amount: 199, saved_amount: 25 },
        ],
      })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);

    const result = await service.scanReceipt(HID, UID, {
      data: jpegBytes(),
      mimeType: 'image/jpeg',
    });

    // Three "Milk" lines collapse into one (349+349+199=897, saved 50+0+25=75);
    // Bananas stays distinct. First-seen order is preserved.
    expect(result.items).toMatchObject([
      { name: 'Milk', amount: 897, tax_amount: 0, saved_amount: 75, category_id: result.category_id, category_name: result.category_name },
      { name: 'Bananas', amount: 120, tax_amount: 0, saved_amount: 0, category_id: result.category_id, category_name: result.category_name },
    ]);
  });

  it('uses an existing Groceries category without seeding the default set', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(budgetCategories).values([
      { id: 'cat-food', household_id: HID, name: 'Groceries', icon: '🛒', color: '#66BB6A', sort_order: 0 },
      { id: 'cat-fun', household_id: HID, name: 'Entertainment', icon: '🎬', color: '#AB47BC', sort_order: 1 },
    ]);

    const { provider } = mockProvider(toolResult({ vendor: null, purchase_date: null, items: [] }));
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });

    expect(result.category_id).toBe('cat-food');
    expect(result.category_name).toBe('Groceries');

    const after = await db.select().from(budgetCategories).where(eq(budgetCategories.household_id, HID)).all();
    expect(after).toHaveLength(2); // no default set seeded
  });

  it('does not resurrect a deleted Groceries category (returns null) when others exist', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(budgetCategories).values([
      { id: 'cat-fun', household_id: HID, name: 'Entertainment', icon: '🎬', color: '#AB47BC', sort_order: 0 },
    ]);

    const { provider } = mockProvider(toolResult({ vendor: null, purchase_date: null, items: [] }));
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });

    expect(result.category_id).toBeNull();
    expect(result.category_name).toBeNull();

    const after = await db.select().from(budgetCategories).where(eq(budgetCategories.household_id, HID)).all();
    expect(after).toHaveLength(1); // untouched — no default seeding
  });

  it('overrides a misreported mime with the sniffed type before calling the model', async () => {
    const { provider, generate } = mockProvider(toolResult({ vendor: null, purchase_date: null, items: [] }));
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);

    // Declared PNG, but the bytes are a real JPEG — the service must sniff the
    // true type from the file header and send image/jpeg.
    await service.scanReceipt(HID, UID, { data: realReceiptJpeg(), mimeType: 'image/png' });

    const args = generate.mock.calls[0]?.[0] as { messages: Array<{ content: Array<{ type: string; source?: { media_type: string; data: string } }> }> };
    const imageBlock = args.messages[0]?.content.find((b) => b.type === 'image');
    expect(imageBlock?.source?.media_type).toBe('image/jpeg');
    // Real bytes (not a stub) were base64-encoded and forwarded to the model.
    expect(imageBlock?.source?.data.length ?? 0).toBeGreaterThan(1000);
  });

  it('instructs the model with the receipt system prompt and forces the structured output tool', async () => {
    const { provider, generate } = mockProvider(toolResult({ vendor: null, purchase_date: null, items: [] }));
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);

    await service.scanReceipt(HID, UID, { data: realReceiptJpeg(), mimeType: 'image/jpeg' });

    const args = generate.mock.calls[0]?.[0] as {
      systemPrompt: string;
      tools: Array<{ name: string; input_schema: unknown }>;
      toolChoice: { type: string; name: string };
      maxTokens: number;
      messages: Array<{ content: Array<{ type: string; text?: string }> }>;
    };
    // The extraction quality hinges on this wiring: the reader system prompt,
    // the exact output schema, and a forced tool call (never free-form text).
    expect(args.systemPrompt).toBe(SCAN_GROCERY_RECEIPT_SYSTEM_PROMPT);
    expect(args.tools).toHaveLength(1);
    expect(args.tools[0]?.name).toBe('output');
    expect(args.tools[0]?.input_schema).toEqual(SCAN_GROCERY_RECEIPT_SCHEMA);
    expect(args.toolChoice).toEqual({ type: 'tool', name: 'output' });
    expect(args.maxTokens).toBe(8192);
    // The receipt image and a text instruction are both sent to the model.
    const kinds = args.messages[0]?.content.map((b) => b.type);
    expect(kinds).toContain('image');
    expect(kinds).toContain('text');
  });

  it('drops invalid raw items (missing name, blank, non-numeric/negative amount) and clamps savings', async () => {
    const { provider } = mockProvider(
      toolResult({
        vendor: null,
        purchase_date: 'not-a-date',
        items: [
          { name: 'bread', amount: 250, saved_amount: -5 }, // saved clamps to 0
          { name: '', amount: 100, saved_amount: 0 }, // blank name → drop
          { amount: 100, saved_amount: 0 }, // missing name → drop
          { name: 'eggs', amount: -1, saved_amount: 0 }, // negative amount → drop
          { name: 'rice', amount: 'x' as unknown as number, saved_amount: 0 }, // non-numeric → drop
        ],
      })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);

    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });

    expect(result.purchase_date).toBeNull(); // invalid date normalized away
    expect(result.items).toMatchObject([
      { name: 'Bread', amount: 250, tax_amount: 0, saved_amount: 0, category_id: result.category_id, category_name: result.category_name },
    ]);
  });

  it('keeps non-grocery items, groups same-named lines, and coerces string / dollar amounts', async () => {
    // A liquor receipt: none of these are groceries. The model grouped both
    // drinks under "Alcohol" (different case) and returned amounts as a string
    // and as dollars. The two "Alcohol" lines must MERGE, and every amount must
    // normalize to integer cents (not be dropped).
    const { provider } = mockProvider(
      toolResult({
        vendor: 'BC Liquor',
        purchase_date: null,
        items: [
          { name: 'Alcohol', amount: '2499', saved_amount: '0' }, // string cents
          { name: 'alcohol', amount: 18.99, saved_amount: 0 }, // dollars, different case -> merges
          { name: 'service fee', amount: '1.50', saved_amount: 0 }, // dollars (string), a fee kept as an item
        ],
      })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);

    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });

    // Household has no categories other than the seeded defaults and the model
    // sent no per-item category, so each defaults to the Groceries fallback.
    expect(result.items).toMatchObject([
      { name: 'Alcohol', amount: 4398, tax_amount: 0, saved_amount: 0, category_id: result.category_id, category_name: result.category_name }, // 2499 + 1899
      { name: 'Service Fee', amount: 150, tax_amount: 0, saved_amount: 0, category_id: result.category_id, category_name: result.category_name }, // 1.50 -> 150
    ]);
  });

  it('folds printed tax into each flagged line (tax-inclusive) and reconciles totals', async () => {
    // Milk is tax-exempt (no flag); Bags carries GST+PST. The receipt prints the
    // tax totals, so amounts become tax-inclusive and Σ(items) == the grand total.
    const { provider } = mockProvider(
      toolResult({
        vendor: 'Costco',
        purchase_date: null,
        items: [
          { name: 'Milk', amount: 500, saved_amount: 0, tax_codes: [] },
          { name: 'Bags', amount: 1000, saved_amount: 0, tax_codes: ['G', 'P'] },
        ],
        tax_summary: [
          { code: 'G', label: 'GST', rate_percent: 5, amount: 50 },
          { code: 'P', label: 'PST', rate_percent: 7, amount: 70 },
        ],
        subtotal: 1500,
        total: 1620,
      })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });

    const milk = result.items.find((i) => i.name === 'Milk');
    const bags = result.items.find((i) => i.name === 'Bags');
    expect(milk).toMatchObject({ amount: 500, tax_amount: 0 }); // exempt, unchanged
    expect(bags).toMatchObject({ amount: 1120, tax_amount: 120 }); // 1000 + 50 GST + 70 PST

    expect(result.subtotal_amount).toBe(1500);
    expect(result.tax_amount).toBe(120);
    expect(result.total_amount).toBe(1620); // reconciles to the receipt grand total
    expect(result.tax_source).toBe('printed-coded');
    const byLabel = Object.fromEntries(result.tax_breakdown.map((b) => [b.label, b.amount]));
    expect(byLabel).toEqual({ GST: 50, PST: 70 });
  });

  it('reads PDF receipts through the Anthropic document path', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 't', name: 'output', input: { vendor: 'PDF Store', purchase_date: null, items: [{ name: 'tea', amount: 400, saved_amount: 0 }] } }],
      model: 'test-model',
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    // The PDF path runs through the injected Claude provider's document API,
    // whose createMessage hits the mocked Anthropic SDK. Feed a REAL small PDF
    // (house-bc-assessment) so the %PDF header routes down the document branch.
    const provider = new ClaudeProvider('test-key');
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);

    const result = await service.scanReceipt(HID, UID, {
      data: fixtures.fixtureArrayBuffer('house-bc-assessment'),
      mimeType: 'application/pdf',
    });

    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    expect(result.vendor).toBe('PDF Store');
    expect(result.items).toMatchObject([
      { name: 'Tea', amount: 400, tax_amount: 0, saved_amount: 0, category_id: result.category_id, category_name: result.category_name },
    ]);
  });

  it('throws a ValidationError when the model returns no tool output', async () => {
    const { provider } = mockProvider({
      content: [{ type: 'text', text: 'I could not read this' }],
      stopReason: 'end_turn',
      model: 'test-model',
    });
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);

    await expect(
      service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws when AI is not configured', async () => {
    testEnv.ANTHROPIC_API_KEY = '';
    // No injected provider: `aiConfigured` short-circuits true whenever one is
    // passed (see receipt-scan-service.ts), so this must go through the real
    // `hasUsableProviderKey` check — no managed key and no BYOK row for UID.
    const service = new GroceryReceiptService(testEnv, testEnv.DB);

    await expect(
      service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects files larger than 32MB', async () => {
    const { provider } = mockProvider(toolResult({ vendor: null, purchase_date: null, items: [] }));
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const tooBig = jpegBytes(33 * 1024 * 1024);

    await expect(
      service.scanReceipt(HID, UID, { data: tooBig, mimeType: 'image/jpeg' })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('GroceryReceiptService — per-item categorization', () => {
  /** Seed a fixed, known category set so AI category names map deterministically. */
  async function seedCategories(): Promise<void> {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(budgetCategories).values([
      { id: 'cat-food', household_id: HID, name: 'Groceries', icon: '🛒', color: '#66BB6A', sort_order: 0 },
      { id: 'cat-booze', household_id: HID, name: 'Alcohol', icon: '🍷', color: '#AB47BC', sort_order: 1 },
      { id: 'cat-home', household_id: HID, name: 'Household', icon: '🧻', color: '#42A5F5', sort_order: 2 },
      { id: 'cat-hidden', household_id: HID, name: 'Archived', icon: '📦', color: '#999999', sort_order: 3, hidden: true },
    ]);
  }

  beforeEach(async () => {
    await seed();
    await seedCategories();
    mockAnthropicCreate.mockReset();
    testEnv.ANTHROPIC_API_KEY = 'test-key';
  });

  it('maps each model category name back to its real category id (verbatim + case-insensitive)', async () => {
    const { provider } = mockProvider(
      toolResult({
        vendor: 'Superstore',
        purchase_date: null,
        items: [
          { name: 'Milk', amount: 349, saved_amount: 0, category: 'Groceries' },
          { name: 'Wine', amount: 1999, saved_amount: 0, category: 'alcohol' }, // different case still maps
          { name: 'Paper Towels', amount: 799, saved_amount: 0, category: 'Household' },
        ],
      })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });

    expect(result.items).toMatchObject([
      { name: 'Milk', amount: 349, tax_amount: 0, saved_amount: 0, category_id: 'cat-food', category_name: 'Groceries' },
      { name: 'Wine', amount: 1999, tax_amount: 0, saved_amount: 0, category_id: 'cat-booze', category_name: 'Alcohol' },
      { name: 'Paper Towels', amount: 799, tax_amount: 0, saved_amount: 0, category_id: 'cat-home', category_name: 'Household' },
    ]);
  });

  it('falls back to the Groceries category when the model returns null or an unknown category', async () => {
    const { provider } = mockProvider(
      toolResult({
        vendor: null,
        purchase_date: null,
        items: [
          { name: 'Bananas', amount: 120, saved_amount: 0, category: null }, // null → Groceries
          { name: 'Mystery Item', amount: 500, saved_amount: 0, category: 'Electronics' }, // not in list → Groceries
          { name: 'Bread', amount: 250, saved_amount: 0 }, // category omitted entirely → Groceries
        ],
      })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });

    expect(result.items).toMatchObject([
      { name: 'Bananas', amount: 120, tax_amount: 0, saved_amount: 0, category_id: 'cat-food', category_name: 'Groceries' },
      { name: 'Mystery Item', amount: 500, tax_amount: 0, saved_amount: 0, category_id: 'cat-food', category_name: 'Groceries' },
      { name: 'Bread', amount: 250, tax_amount: 0, saved_amount: 0, category_id: 'cat-food', category_name: 'Groceries' },
    ]);
  });

  it('never maps an item to a HIDDEN category — it falls back to Groceries instead', async () => {
    const { provider } = mockProvider(
      toolResult({
        vendor: null,
        purchase_date: null,
        items: [{ name: 'Old Thing', amount: 100, saved_amount: 0, category: 'Archived' }],
      })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });

    // 'Archived' is hidden, so it is not in the pool → fallback to Groceries.
    expect(result.items[0].category_id).toBe('cat-food');
    expect(result.items[0].category_name).toBe('Groceries');
  });

  it('passes the household category names into the model prompt (and excludes hidden ones)', async () => {
    const { provider, generate } = mockProvider(
      toolResult({ vendor: null, purchase_date: null, items: [] })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });

    const args = generate.mock.calls[0]?.[0] as {
      messages: Array<{ content: Array<{ type: string; text?: string }> }>;
    };
    const textBlock = args.messages[0]?.content.find((b) => b.type === 'text');
    expect(textBlock?.text).toContain('Groceries');
    expect(textBlock?.text).toContain('Alcohol');
    expect(textBlock?.text).toContain('Household');
    expect(textBlock?.text).not.toContain('Archived'); // hidden category never offered
  });

  it('keeps the FIRST category when merging same-named lines with differing categories', async () => {
    const { provider } = mockProvider(
      toolResult({
        vendor: null,
        purchase_date: null,
        items: [
          { name: 'Wine', amount: 1500, saved_amount: 0, category: 'Alcohol' },
          { name: 'wine', amount: 2000, saved_amount: 0, category: 'Groceries' }, // merges into the first
        ],
      })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });

    expect(result.items).toMatchObject([
      { name: 'Wine', amount: 3500, tax_amount: 0, saved_amount: 0, category_id: 'cat-booze', category_name: 'Alcohol' },
    ]);
  });
});

describe('GroceryReceiptService — v2 fees / codes / Other', () => {
  beforeEach(async () => {
    await seed();
    mockAnthropicCreate.mockReset();
    testEnv.ANTHROPIC_API_KEY = 'test-key';
  });

  it('uses vendor Other when the store name is unreadable', async () => {
    const { provider } = mockProvider(toolResult({ vendor: null, purchase_date: null, items: [] }));
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });
    expect(result.vendor).toBe('Other');
  });

  it('does not semantically merge Tomatoes / Alcohol without a shared code', async () => {
    const { provider } = mockProvider(
      toolResult({
        vendor: 'Superstore',
        purchase_date: null,
        items: [
          { name: 'Kumato Tomato', amount: 399, saved_amount: 0 },
          { name: 'Vine Tomato', amount: 299, saved_amount: 0 },
          { name: 'Beer', amount: 1200, saved_amount: 0 },
          { name: 'Whisky', amount: 4500, saved_amount: 0 },
        ],
      })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });
    expect(result.items.map((i) => i.name)).toEqual(['Kumato Tomato', 'Vine Tomato', 'Beer', 'Whisky']);
  });

  it('attaches Superstore milk recycling + deposit and keeps Title Case raw_name in suggestions', async () => {
    const { provider } = mockProvider(
      toolResult({
        vendor: 'Real Canadian Superstore',
        purchase_date: null,
        items: [
          {
            raw_name: '2% MILK',
            raw_code: '068700009401',
            name: '2% Milk',
            name_suggestions: ['2% Milk', 'Milk'],
            amount: 549,
            saved_amount: 0,
            tax_codes: [],
          },
          { name: 'RECYCLING FEE', amount: 7, saved_amount: 0 },
          { name: 'DEPOSIT', amount: 10, saved_amount: 0 },
        ],
      })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: '2% Milk',
      raw_code: '068700009401',
      amount: 566,
      deposit_amount: 10,
      tax_amount: 0,
    });
    expect(result.items[0].fees.map((f) => f.kind)).toEqual(['environmental', 'deposit']);
    expect(result.items[0].name_suggestions).toEqual(expect.arrayContaining(['2% Milk']));
  });

  it('collapses Costco 43483 and attaches TPD/610845 to brie', async () => {
    const { provider } = mockProvider(
      toolResult({
        vendor: 'Costco',
        purchase_date: null,
        items: [
          { name: 'KS DC BRIE', raw_code: '610845', amount: 1299, saved_amount: 0 },
          { name: 'TPD/610845', raw_code: '610845', amount: 200, saved_amount: 200 },
          { name: 'Kumato', raw_code: '43483', amount: 399, saved_amount: 0 },
          { name: 'Kumato', raw_code: '43483', amount: 399, saved_amount: 0 },
          { name: 'Kumato', raw_code: '43483', amount: 399, saved_amount: 0 },
          { name: 'Roti Chicken', amount: 799, saved_amount: 0, tax_codes: ['G'] },
        ],
        tax_summary: [{ code: 'G', label: 'GST', rate_percent: 5, amount: 40 }],
      })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });
    const brie = result.items.find((i) => i.raw_code === '610845');
    const kumato = result.items.find((i) => i.raw_code === '43483');
    const roti = result.items.find((i) => i.name === 'Roti Chicken');
    expect(brie?.saved_amount).toBe(200);
    expect(kumato?.amount).toBe(1197);
    expect(roti?.tax_amount).toBeGreaterThan(0);
    expect(result.items.filter((i) => i.tax_amount > 0).map((i) => i.name)).toEqual(['Roti Chicken']);
  });

  it('attaches BCL container deposit and keeps L+G flags for liquor PST', async () => {
    const { provider } = mockProvider(
      toolResult({
        vendor: 'BC Liquor Store',
        purchase_date: null,
        items: [
          {
            name: 'Canadian Club',
            raw_code: '062067040107',
            amount: 2499,
            saved_amount: 0,
            tax_codes: ['L', 'G'],
          },
          { name: 'Container Deposit', amount: 10, saved_amount: 0 },
        ],
        tax_summary: [
          { code: 'L', label: 'PST Liquor', rate_percent: 10, amount: 250 },
          { code: 'G', label: 'GST', rate_percent: 5, amount: 125 },
        ],
      })
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const result = await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: 'Canadian Club',
      deposit_amount: 10,
      amount: 2499 + 10 + 250 + 125,
      tax_amount: 375,
    });
  });
});

/**
 * Streamed progress — what turns a 30s spinner into a counter that moves. The
 * service only opts into the streamed transport when a caller passes
 * `onProgress`, and it reports ITEMS, never a percentage: the receipt's length
 * is unknown until the model reaches the end of it.
 */
describe('ReceiptScanService streamed progress', () => {
  beforeEach(async () => {
    await seed();
    mockAnthropicCreate.mockReset();
    testEnv.ANTHROPIC_API_KEY = 'test-key';
  });

  /**
   * A provider that plays `fragments` into the progress callback before
   * answering — the observable behaviour of a streamed tool call.
   */
  function streamingProvider(fragments: string[], result: GenerateResult) {
    const generate = vi.fn(async (args: { onToolJsonDelta?: (json: string) => void }) => {
      let accumulated = '';
      for (const fragment of fragments) {
        accumulated += fragment;
        args.onToolJsonDelta?.(accumulated);
      }
      return result;
    });
    return { provider: { generate } as unknown as AIProvider, generate };
  }

  const TWO_ITEMS = toolResult({
    vendor: 'FreshMart',
    purchase_date: null,
    items: [
      { raw_name: 'MILK', name: 'Milk', amount: 349, saved_amount: 0 },
      { raw_name: 'BREAD', name: 'Bread', amount: 299, saved_amount: 0 },
    ],
  });

  it('reports each new item as the model writes it', async () => {
    const { provider } = streamingProvider(
      ['{"items":[{"raw_name":"MI', 'LK","amount":349}', ',{"raw_name":"BREAD"', ',"amount":299}]}'],
      TWO_ITEMS
    );
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);
    const progress: number[] = [];

    const result = await service.scanReceipt(HID, UID, {
      segments: [{ data: jpegBytes(), mimeType: 'image/jpeg' }],
      onProgress: (p) => progress.push(p.items),
    });

    // Edge-triggered: one report per item, not one per JSON fragment.
    expect(progress).toEqual([1, 2]);
    expect(result.items).toHaveLength(2);
  });

  it('never walks the counter backwards when the max_tokens retry restarts', async () => {
    // The retry opens a SECOND stream from zero; reporting that verbatim would
    // show the member 12 items, then 1.
    const truncated: GenerateResult = { ...TWO_ITEMS, stopReason: 'max_tokens' };
    let call = 0;
    const generate = vi.fn(async (args: { onToolJsonDelta?: (json: string) => void }) => {
      call += 1;
      const fragments =
        call === 1
          ? ['{"items":[{"raw_name":"A"}', ',{"raw_name":"B"}']
          : ['{"items":[{"raw_name":"A"}', ',{"raw_name":"B"}', ',{"raw_name":"C"}]}'];
      let accumulated = '';
      for (const fragment of fragments) {
        accumulated += fragment;
        args.onToolJsonDelta?.(accumulated);
      }
      return call === 1 ? truncated : TWO_ITEMS;
    });
    const service = new GroceryReceiptService(
      testEnv,
      testEnv.DB,
      { generate } as unknown as AIProvider
    );
    const progress: number[] = [];

    await service.scanReceipt(HID, UID, {
      segments: [{ data: jpegBytes(), mimeType: 'image/jpeg' }],
      onProgress: (p) => progress.push(p.items),
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(progress).toEqual([1, 2, 3]);
    // Monotonic — the only property the overlay depends on.
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('leaves the AI call unstreamed when no progress callback is passed', async () => {
    const { provider, generate } = mockProvider(TWO_ITEMS);
    const service = new GroceryReceiptService(testEnv, testEnv.DB, provider);

    await service.scanReceipt(HID, UID, { data: jpegBytes(), mimeType: 'image/jpeg' });

    expect(generate.mock.calls[0][0].onToolJsonDelta).toBeUndefined();
  });
});
