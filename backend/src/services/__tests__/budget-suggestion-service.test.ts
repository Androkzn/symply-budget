/**
 * budget-suggestion-service.ts — text + document AI draft extraction.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AIProvider } from '../../ai/provider';
import * as schema from '../../db/schema';
import { createBudgetTables, resetBudgetTables } from '../../routes/__tests__/budget-test-helpers';
import type { Env } from '../../types';
import { ValidationError } from '../../utils/errors';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { BudgetSuggestionService } from '../budget-suggestion-service';

const testEnv = env as unknown as Env;
const HID = 'hh_budget_suggest_01';
const UID = 'u_budget_suggest_owner';
const MID = 'm_budget_suggest_owner';

const mockAnthropicCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: (...args: unknown[]) => mockAnthropicCreate(...args),
    };
    constructor(_opts: { apiKey: string }) {}
  },
}));

function mockProvider(): { provider: AIProvider; generateStructured: ReturnType<typeof vi.fn> } {
  const generateStructured = vi.fn(async () => ({
    items: [
      {
        title: 'Netflix',
        description: null,
        estimated_cost_min: 1600,
        estimated_cost_max: 1600,
        priority: 'medium',
        category: null,
        scheduled: false,
        target_date: null,
        is_recurring: true,
        recurrence_frequency: 'monthly',
      },
    ],
  }));
  return {
    provider: { generateStructured } as unknown as AIProvider,
    generateStructured,
  };
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createBudgetTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetBudgetTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({ id: UID, email: 'bs@example.com', email_verified: true });
  await db.insert(schema.households).values({ id: HID, name: 'BudgetSuggestTest' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
}

describe('BudgetSuggestionService', () => {
  beforeEach(async () => {
    await seed();
    mockAnthropicCreate.mockReset();
    testEnv.ANTHROPIC_API_KEY = 'test-key';
  });

  it('suggestFromText returns normalized draft spendings', async () => {
    const { provider, generateStructured } = mockProvider();
    const service = new BudgetSuggestionService(testEnv, testEnv.DB, provider);

    const suggestions = await service.suggestFromText(HID, UID, {
      text: 'Netflix subscription $16 monthly',
    });

    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.title).toBe('Netflix');
    expect(suggestions[0]?.estimated_cost_min).toBe(1600);
    expect(suggestions[0]?.is_recurring).toBe(true);
  });

  it('suggestFromTextAndFile merges extracted document text with user text', async () => {
    const { provider, generateStructured } = mockProvider();
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Water heater replacement quote $2,000 due next month' }],
    });

    const service = new BudgetSuggestionService(testEnv, testEnv.DB, provider);
    const suggestions = await service.suggestFromTextAndFile(HID, UID, {
      text: 'From the contractor quote',
      file: {
        data: new TextEncoder().encode('fake pdf').buffer as ArrayBuffer,
        mimeType: 'application/pdf',
        name: 'quote.pdf',
      },
    });

    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    expect(generateStructured).toHaveBeenCalledTimes(1);
    const userPromptArg = generateStructured.mock.calls[0]?.[0]?.userPrompt as string;
    expect(userPromptArg).toContain('From the contractor quote');
    expect(userPromptArg).toContain('Water heater replacement quote $2,000 due next month');
    expect(suggestions).toHaveLength(1);
  });

  it('emits asset-quality debug logs when a file is attached', async () => {
    const { provider } = mockProvider();
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Groceries $20' }],
      model: 'test-model',
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 2 },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const prevFlag = testEnv.BUDGET_DEBUG_LOGS;
    testEnv.BUDGET_DEBUG_LOGS = 'true';

    const service = new BudgetSuggestionService(testEnv, testEnv.DB, provider);
    await service.suggestFromTextAndFile(HID, UID, {
      file: {
        data: new TextEncoder().encode('%PDF-1.4 fake').buffer as ArrayBuffer,
        mimeType: 'application/pdf',
        name: 'quote.pdf',
      },
    });

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('[BUDGET-E2E][ai-detect.asset]'))).toBe(true);
    expect(lines.some((l) => l.includes('[BUDGET-E2E][ai-detect.ai]'))).toBe(true);
    logSpy.mockRestore();
    testEnv.BUDGET_DEBUG_LOGS = prevFlag;
  });

  it('suggestFromTextAndFile throws when neither text nor document yields content', async () => {
    const { provider } = mockProvider();
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: '   ' }],
    });

    const service = new BudgetSuggestionService(testEnv, testEnv.DB, provider);

    await expect(
      service.suggestFromTextAndFile(HID, UID, {
        file: {
        data: new TextEncoder().encode('fake pdf').buffer as ArrayBuffer,
        mimeType: 'application/pdf',
        name: 'blank.pdf',
        },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
