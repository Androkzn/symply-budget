/**
 * Chat adapter for scan_receipt_for_review — must return a receiptDraft and
 * must NOT mark budgetMutated / persist expenses.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as schema from '../../db/schema';
import { createBudgetTables, resetBudgetTables } from '../../routes/__tests__/budget-test-helpers';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import type { ChatAssistantToolContext } from '../chat/chat-room-service-core';

const mockScanReceipt = vi.fn();

vi.mock('../budget-analysis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../budget-analysis')>();
  return {
    ...actual,
    ReceiptScanService: class MockReceiptScanService {
      scanReceipt = mockScanReceipt;
    },
  };
});

// Import after mock so BUDGET_CHAT_ASSISTANT picks up the stubbed service.
const { BUDGET_CHAT_ASSISTANT } = await import('../chat/budget-assistant-tools');
const { BudgetService } = await import('../budget-service');

const testEnv = env as unknown as Env;
const HID = 'hh_chat_scan';
const UID = 'u_chat_scan';
const MID = 'm_chat_scan';

function ctx(attachments: ChatAssistantToolContext['imageAttachments']): ChatAssistantToolContext {
  return {
    env: testEnv,
    householdId: HID,
    roomId: 'room_scan',
    userId: UID,
    imageAttachments: attachments,
    // Budget rooms carry no subject — only House has project/material chats.
    subject: null,
  };
}

beforeEach(async () => {
  mockScanReceipt.mockReset();
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([{ id: UID, email: 'scan@example.com', email_verified: true }]);
  await db.insert(schema.households).values([{ id: HID, name: 'Scan House' }]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);

  // Minimal R2 stub for the attachment key.
  (testEnv as { REPORTS_BUCKET: R2Bucket }).REPORTS_BUCKET = {
    get: vi.fn().mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(8),
    }),
  } as unknown as R2Bucket;
});

describe('scan_receipt_for_review chat tool', () => {
  it('returns receiptDraft and does not persist expenses', async () => {
    mockScanReceipt.mockResolvedValue({
      vendor: 'Costco',
      purchase_date: '2026-07-20',
      category_id: 'cat_g',
      category_name: 'Groceries',
      items: [
        { name: 'Milk', amount: 499, saved_amount: 50, category_id: 'cat_g', category_name: 'Groceries' },
        { name: 'Wine', amount: 1999, saved_amount: 0, category_id: 'cat_a', category_name: 'Alcohol' },
      ],
    });

    const ret = await BUDGET_CHAT_ASSISTANT.runTool!(
      ctx([{ key: 'hh/room/receipt.jpg', url: 'https://example.com/r.jpg', mimeType: 'image/jpeg' }]),
      { name: 'scan_receipt_for_review', input: {} }
    );

    expect(typeof ret).not.toBe('string');
    if (typeof ret === 'string') return;
    expect(ret.result).toMatch(/^Scanned 2 items/);
    expect(ret.result).toContain('NOT saved yet');
    expect(ret.budgetMutated).toBeUndefined();
    // Per-item categories survive into the chat draft the confirm screen reads.
    expect(ret.receiptDraft).toMatchObject({
      vendor: 'Costco',
      purchase_date: '2026-07-20',
      category_id: 'cat_g',
      category_name: 'Groceries',
      items: [
        { name: 'Milk', amount: 499, saved_amount: 50, category_id: 'cat_g', category_name: 'Groceries' },
        { name: 'Wine', amount: 1999, saved_amount: 0, category_id: 'cat_a', category_name: 'Alcohol' },
      ],
    });
    expect(ret.receiptDraft?.items[0]?.raw_code).toBeNull();
    expect(ret.receiptDraft?.items[0]?.deposit_amount).toBe(0);

    const budget = new BudgetService(testEnv, testEnv.DB);
    expect(await budget.getExpenses(HID, UID, {})).toHaveLength(0);
  });

  it('asks for an attachment when none is present', async () => {
    const ret = await BUDGET_CHAT_ASSISTANT.runTool!(ctx([]), {
      name: 'scan_receipt_for_review',
      input: {},
    });
    expect(typeof ret).toBe('string');
    expect(String(ret).toLowerCase()).toContain('no receipt');
  });
});
