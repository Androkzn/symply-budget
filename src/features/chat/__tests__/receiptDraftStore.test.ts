import { chatMessageReceiptDraft } from '../receiptDraftStore';
import type { ChatMessage } from '../types';

function msg(overrides: Partial<ChatMessage> & { metadata?: Record<string, unknown> | null }): ChatMessage {
  return {
    id: 'm1',
    room_id: 'r1',
    sender_type: 'ai',
    sender_user_id: null,
    sender_name: 'Assistant',
    body: 'Review items',
    attachments: null,
    mentions: null,
    reply_to: null,
    metadata: null,
    edited_at: null,
    deleted_at: null,
    created_at: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('chatMessageReceiptDraft', () => {
  it('parses a valid receipt draft from AI metadata', () => {
    const draft = chatMessageReceiptDraft(
      msg({
        metadata: {
          receiptDraft: {
            vendor: 'Store',
            purchase_date: '2026-07-22',
            category_id: 'cat-1',
            category_name: 'Groceries',
            items: [
              { name: 'Milk', amount: 549, saved_amount: 50, category_id: 'cat-1', category_name: 'Groceries' },
              { name: 'Wine', amount: 1999, saved_amount: 0, category_id: 'cat-2', category_name: 'Alcohol' },
            ],
          },
        },
      })
    );
    expect(draft?.vendor).toBe('Store');
    expect(draft?.items).toHaveLength(2);
    expect(draft?.items[0]).toEqual({
      name: 'Milk',
      raw_name: 'Milk',
      raw_code: null,
      amount: 549,
      saved_amount: 50,
      tax_amount: 0,
      deposit_amount: 0,
      fees: [],
      name_suggestions: [],
      category_suggestions: [],
      category_id: 'cat-1',
      category_name: 'Groceries',
    });
    // Per-item category is preserved so the confirm screen can default each card.
    expect(draft?.items[1].category_id).toBe('cat-2');
    expect(draft?.items[1].category_name).toBe('Alcohol');
  });

  it('defaults per-item category to null when the AI omits it', () => {
    const draft = chatMessageReceiptDraft(
      msg({
        metadata: {
          receiptDraft: {
            vendor: 'Store',
            purchase_date: null,
            category_id: null,
            category_name: null,
            items: [{ name: 'Bread', amount: 250, saved_amount: 0 }],
          },
        },
      })
    );
    expect(draft?.items[0]).toEqual({
      name: 'Bread',
      raw_name: 'Bread',
      raw_code: null,
      amount: 250,
      saved_amount: 0,
      tax_amount: 0,
      deposit_amount: 0,
      fees: [],
      name_suggestions: [],
      category_suggestions: [],
      category_id: null,
      category_name: null,
    });
  });

  it('parses per-item tax and receipt-level tax totals', () => {
    const draft = chatMessageReceiptDraft(
      msg({
        metadata: {
          receiptDraft: {
            vendor: 'Costco',
            purchase_date: null,
            category_id: null,
            category_name: null,
            items: [{ name: 'Bags', amount: 1120, tax_amount: 120, saved_amount: 0 }],
            subtotal_amount: 1000,
            tax_amount: 120,
            total_amount: 1120,
            tax_breakdown: [
              { label: 'GST', amount: 50 },
              { label: 'PST', amount: 70 },
            ],
            tax_source: 'printed-coded',
            region_known: true,
          },
        },
      })
    );
    expect(draft?.items[0].tax_amount).toBe(120);
    expect(draft?.subtotal_amount).toBe(1000);
    expect(draft?.tax_amount).toBe(120);
    expect(draft?.total_amount).toBe(1120);
    expect(draft?.tax_source).toBe('printed-coded');
    expect(draft?.tax_breakdown).toHaveLength(2);
    expect(draft?.region_known).toBe(true);
  });

  it('returns null for user messages or empty items', () => {
    expect(
      chatMessageReceiptDraft(msg({ sender_type: 'user', metadata: { receiptDraft: { items: [] } } }))
    ).toBeNull();
    expect(chatMessageReceiptDraft(msg({ metadata: { receiptDraft: { items: [] } } }))).toBeNull();
    expect(chatMessageReceiptDraft(msg({ metadata: null }))).toBeNull();
  });
});
