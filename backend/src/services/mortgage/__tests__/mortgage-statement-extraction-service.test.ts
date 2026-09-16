/**
 * Mortgage statement extraction (`mortgage-statement-extraction-service.ts`).
 *
 * THE MODEL IS ALWAYS MOCKED — `ai/provider-factory` is replaced wholesale, so
 * nothing here can reach a real provider.
 *
 * What actually needs pinning is the deterministic half either side of the
 * model call, because that half is what protects the user:
 *   - the response is JSON-extracted whether the model fences it, wraps it in
 *     prose, or returns it bare;
 *   - a response that is not JSON raises a named error rather than surfacing
 *     model text to the caller;
 *   - EVERY path goes through `normalizeMortgageDraft`, so a model that echoes
 *     a full account number or borrower name cannot put one in the draft.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../../types';
import { MortgageStatementExtractionService } from '../mortgage-statement-extraction-service';

let mediaText = '';
let structuredJson: Record<string, unknown> = {};
const mediaCalls: unknown[] = [];

vi.mock('../../../ai/provider-factory', () => ({
  createAnthropicAdapterForUser: async () => ({
    name: 'mock',
    isAvailable: () => true,
    generateFromMediaContent: async (args: unknown) => {
      mediaCalls.push(args);
      return { text: mediaText, usage: { input_tokens: 11, output_tokens: 7 } };
    },
    generateJSON: async () => structuredJson,
  }),
}));

const service = () => new MortgageStatementExtractionService({} as Env, 'user_1');

/** Model output shape: snake_case in, camelCase draft out. */
const STATEMENT = {
  lender: 'Test Credit Union',
  statement_date: '2026-07-31',
  closing_balance: 420_000,
  interest_rate: 4.99,
};

beforeEach(() => {
  mediaText = '';
  structuredJson = {};
  mediaCalls.length = 0;
});

describe('extractFromBase64 — reading the model response', () => {
  it('parses a fenced ```json block', async () => {
    mediaText = '```json\n' + JSON.stringify(STATEMENT) + '\n```';
    const { data } = await service().extractFromBase64('base64==');
    expect(data.lender).toBe('Test Credit Union');
  });

  it('parses a fenced block with no language tag', async () => {
    mediaText = '```\n' + JSON.stringify(STATEMENT) + '\n```';
    const { data } = await service().extractFromBase64('base64==');
    expect(data.lender).toBe('Test Credit Union');
  });

  it('parses a bare object wrapped in prose', async () => {
    mediaText = `Here is the statement you asked for:\n${JSON.stringify(STATEMENT)}\nHope that helps!`;
    const { data } = await service().extractFromBase64('base64==');
    expect(data.lender).toBe('Test Credit Union');
  });

  it('parses a plain JSON response', async () => {
    mediaText = JSON.stringify(STATEMENT);
    const { data } = await service().extractFromBase64('base64==');
    expect(data.statementDate).toBe('2026-07-31');
  });

  it('throws a named error when the response is not JSON at all', async () => {
    mediaText = 'I could not read that document.';
    await expect(service().extractFromBase64('base64==')).rejects.toThrow(
      'Failed to parse mortgage statement extraction response',
    );
  });

  it('throws rather than half-parsing truncated JSON', async () => {
    mediaText = '{"lender_name": "Test Credit Un';
    await expect(service().extractFromBase64('base64==')).rejects.toThrow(
      'Failed to parse mortgage statement extraction response',
    );
  });

  it('reports the model token usage back to the caller', async () => {
    mediaText = JSON.stringify(STATEMENT);
    const { usage } = await service().extractFromBase64('base64==');
    expect(usage).toEqual({ input_tokens: 11, output_tokens: 7 });
  });

  it('defaults to PDF but forwards whichever media type it is given', async () => {
    mediaText = JSON.stringify(STATEMENT);
    await service().extractFromBase64('base64==');
    await service().extractFromBase64('base64==', 'image/png');

    const [first, second] = mediaCalls as Array<{ media: { mediaType: string } }>;
    expect(first.media.mediaType).toBe('application/pdf');
    expect(second.media.mediaType).toBe('image/png');
  });
});

describe('PII minimization applies to every path', () => {
  it('never returns a full account number from the media path', async () => {
    mediaText = JSON.stringify({ ...STATEMENT, account_number: '1234567890123456' });
    const { data } = await service().extractFromBase64('base64==');
    expect(JSON.stringify(data)).not.toContain('1234567890123456');
  });

  it('never returns a full account number from the text path', async () => {
    structuredJson = { ...STATEMENT, account_number: '1234567890123456' };
    const { data } = await service().extractFromText('pasted statement text');
    expect(JSON.stringify(data)).not.toContain('1234567890123456');
  });

  it('drops keys the draft allowlist does not recognise', async () => {
    mediaText = JSON.stringify({ ...STATEMENT, borrower_sin: '046454286', nonsense_key: 'x' });
    const { data } = await service().extractFromBase64('base64==');
    expect(data).not.toHaveProperty('borrower_sin');
    expect(data).not.toHaveProperty('nonsense_key');
  });
});

describe('extractFromText', () => {
  it('returns a normalized draft from the structured call', async () => {
    structuredJson = STATEMENT;
    const { data } = await service().extractFromText('pasted statement text');
    expect(data.lender).toBe('Test Credit Union');
  });

  it('reports zero usage — the structured call does not surface token counts', async () => {
    structuredJson = STATEMENT;
    const { usage } = await service().extractFromText('pasted statement text');
    expect(usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
});
