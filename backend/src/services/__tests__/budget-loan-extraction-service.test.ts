/**
 * BudgetLoanExtractionService — "Fill with AI" for loan tracking.
 *
 * Covers a lightly mocked check of the image-extraction branch's AI call
 * wiring (system prompt, forced "output" tool, exact schema) and the
 * PDF/document branch — mirrors `grocery-receipt-service.test.ts`'s
 * mocked-provider / mocked-Anthropic-SDK techniques (no real network call is
 * ever made).
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClaudeProvider } from '../../ai/claude-provider';
import {
  SCAN_LOAN_STATEMENT_SCHEMA,
  SCAN_LOAN_STATEMENT_SYSTEM_PROMPT,
  type RawLoanExtraction,
} from '../../ai/prompts/scan-loan-statement';
import type { AIProvider, GenerateResult } from '../../ai/provider';
// Real test-document fixtures (resourses/testing/*), inlined for the worker runtime.
import fixtures from '../../test-utils/fixtures';
import type { Env } from '../../types';
import { ValidationError } from '../../utils/errors';
import { BudgetLoanExtractionService, type LoanExtractionDraft } from '../budget-loan-extraction-service';

const testEnv = env as unknown as Env;
const UID = 'u_loan_extract_owner';
const HID = 'h_loan_extract';

const mockAnthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: (...args: unknown[]) => mockAnthropicCreate(...args),
    };
    constructor(_opts: { apiKey: string }) {}
  },
}));

beforeEach(() => {
  mockAnthropicCreate.mockReset();
});

function rawExtraction(overrides: Partial<RawLoanExtraction> = {}): RawLoanExtraction {
  return {
    principal_cents: null,
    monthly_payment_cents: null,
    due_day_of_month: null,
    term_months: null,
    rate_type: null,
    rate_bps: null,
    lender: null,
    notes: null,
    amount_paid_cents: null,
    remaining_balance_cents: null,
    progress_percent: null,
    low_confidence_fields: [],
    ...overrides,
  };
}

// ---------- image extraction branch (mocked AIProvider) ----------

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

function jpegBase64(): string {
  const bytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

describe('BudgetLoanExtractionService — image extraction branch', () => {
  it('calls generateWithFallback with the loan system prompt, forces the "output" tool, and maps the draft contract', async () => {
    const raw: RawLoanExtraction = {
      principal_cents: 180_000,
      monthly_payment_cents: 5_000,
      due_day_of_month: 22,
      term_months: 36,
      rate_type: 'zero',
      rate_bps: 0,
      lender: 'IKEA',
      notes: 'Loan #4',
      amount_paid_cents: 15_000,
      remaining_balance_cents: 165_000,
      progress_percent: 8,
      low_confidence_fields: [],
    };
    const { provider, generate } = mockProvider(toolResult(raw));
    const service = new BudgetLoanExtractionService(testEnv, testEnv.DB, provider);

    const { draft } = await service.extractFromUpload(jpegBase64(), 'image/jpeg', HID, UID);

    const args = generate.mock.calls[0]?.[0] as {
      systemPrompt: string;
      tools: Array<{ name: string; input_schema: unknown }>;
      toolChoice: { type: string; name: string };
      messages: Array<{ content: Array<{ type: string; source?: { media_type: string } }> }>;
    };
    // The extraction quality hinges on this wiring: the reader system prompt,
    // the exact output schema, and a forced tool call (never free-form text).
    expect(args.systemPrompt).toBe(SCAN_LOAN_STATEMENT_SYSTEM_PROMPT);
    expect(args.tools).toHaveLength(1);
    expect(args.tools[0]?.name).toBe('output');
    expect(args.tools[0]?.input_schema).toEqual(SCAN_LOAN_STATEMENT_SCHEMA);
    expect(args.toolChoice).toEqual({ type: 'tool', name: 'output' });
    const imageBlock = args.messages[0]?.content.find((b) => b.type === 'image');
    expect(imageBlock?.source?.media_type).toBe('image/jpeg');

    // monthly_payment_cents/due_day_of_month surface (they feed the recurring
    // payment's OWN amount/day fields); internal-only cross-check fields
    // (remaining_balance/progress_percent) never leak into the draft —
    // amount_paid_cents passes straight through as-is.
    const expectedDraft: LoanExtractionDraft = {
      principal_cents: 180_000,
      monthlyPaymentCents: 5_000,
      dueDayOfMonth: 22,
      term_months: 36,
      rate_type: 'zero',
      rate_bps: 0,
      lender: 'IKEA',
      notes: 'Loan #4',
      amountPaidCents: 15_000,
      lowConfidenceFields: [],
    };
    expect(draft).toEqual(expectedDraft);
  });

  it('clamps an out-of-range due_day_of_month to null rather than trusting a hallucinated value', async () => {
    const { provider } = mockProvider(toolResult(rawExtraction({ due_day_of_month: 45 })));
    const service = new BudgetLoanExtractionService(testEnv, testEnv.DB, provider);

    const { draft } = await service.extractFromUpload(jpegBase64(), 'image/jpeg', HID, UID);
    expect(draft.dueDayOfMonth).toBeNull();
  });

  it('sniffs a mislabeled file and sends the REAL media type to the model', async () => {
    const { provider, generate } = mockProvider(toolResult(rawExtraction()));
    const service = new BudgetLoanExtractionService(testEnv, testEnv.DB, provider);

    // Declared PNG, but the bytes are a real JPEG header — the service must
    // sniff the true type via resolveMediaType and send image/jpeg.
    await service.extractFromUpload(jpegBase64(), 'image/png', HID, UID);

    const args = generate.mock.calls[0]?.[0] as {
      messages: Array<{ content: Array<{ type: string; source?: { media_type: string } }> }>;
    };
    const imageBlock = args.messages[0]?.content.find((b) => b.type === 'image');
    expect(imageBlock?.source?.media_type).toBe('image/jpeg');
  });

  it('throws a ValidationError when the model returns no tool_use block', async () => {
    const { provider } = mockProvider({
      content: [{ type: 'text', text: 'could not read this' }],
      stopReason: 'end_turn',
      model: 'test-model',
    });
    const service = new BudgetLoanExtractionService(testEnv, testEnv.DB, provider);

    await expect(service.extractFromUpload(jpegBase64(), 'image/jpeg', HID, UID)).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});

// ---------- document (PDF) extraction branch (real ClaudeProvider, mocked SDK) ----------

describe('BudgetLoanExtractionService — document (PDF) extraction branch', () => {
  it('reads a PDF through the Anthropic document API', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          id: 't',
          name: 'output',
          input: rawExtraction({ lender: 'PDF Lender', principal_cents: 200_000, term_months: 12 }),
        },
      ],
      model: 'test-model',
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    // The PDF path runs through the injected Claude provider's document API,
    // whose createMessage hits the mocked Anthropic SDK. Feed a REAL small
    // PDF fixture so the %PDF header routes down the document branch.
    const provider = new ClaudeProvider('test-key');
    const service = new BudgetLoanExtractionService(testEnv, testEnv.DB, provider);

    const base64 = arrayBufferToBase64(fixtures.fixtureArrayBuffer('house-bc-assessment'));
    const { draft } = await service.extractFromUpload(base64, 'application/pdf', HID, UID);

    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    expect(draft.lender).toBe('PDF Lender');
    expect(draft.principal_cents).toBe(200_000);
    expect(draft.term_months).toBe(12);
  });
});
