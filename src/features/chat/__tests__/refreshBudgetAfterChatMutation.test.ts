import { chatMessageMutatedBudget } from '../refreshBudgetAfterChatMutation';
import type { ChatMessage } from '../types';

function msg(overrides: Partial<ChatMessage> & { metadata?: Record<string, unknown> | null }): ChatMessage {
  return {
    id: 'm1',
    room_id: 'r1',
    sender_type: 'ai',
    sender_user_id: null,
    sender_name: 'Assistant',
    body: 'ok',
    attachments: null,
    mentions: null,
    reply_to: null,
    metadata: null,
    edited_at: null,
    deleted_at: null,
    created_at: '2026-07-22T00:00:00Z',
    ...overrides,
  };
}

describe('chatMessageMutatedBudget', () => {
  it('is true for budgetMutated on AI messages', () => {
    expect(chatMessageMutatedBudget(msg({ metadata: { budgetMutated: true } }))).toBe(true);
  });

  it('is false for receiptDraft (confirm-before-save)', () => {
    expect(
      chatMessageMutatedBudget(
        msg({
          metadata: {
            receiptDraft: { items: [{ name: 'Milk', amount: 100, saved_amount: 0 }] },
          },
        })
      )
    ).toBe(false);
  });

  it('is false for user messages or unrelated AI metadata', () => {
    expect(chatMessageMutatedBudget(msg({ sender_type: 'user', metadata: { budgetMutated: true } }))).toBe(
      false
    );
    expect(chatMessageMutatedBudget(msg({ metadata: { model: 'x' } }))).toBe(false);
    expect(chatMessageMutatedBudget(msg({ metadata: null }))).toBe(false);
  });
});
