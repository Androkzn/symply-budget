/**
 * Registered-statement extraction (RRSP / TFSA / FHSA / DPSP / pension).
 *
 * The normaliser is the whole safety layer: the model returns free-form JSON and
 * this turns it into a reviewable draft of accounts + contributions. A wrong
 * account_type or a contribution that survives with a null amount becomes a real
 * retirement-savings row after the user taps confirm, so unknown values must
 * become `null`/dropped rather than plausible guesses.
 *
 * Driven through the public API with the Anthropic transport stubbed offline.
 */
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../types';
import { RegisteredStatementExtractionService } from '../registered-statement-extraction-service';

import {
  JPEG_BYTES_B64,
  PDF_BYTES_B64,
  anthropicText,
  sentContentBlocks,
  sentMediaBlock,
  stubAnthropic,
  stubAnthropicFailure,
} from './ai-extraction-test-helpers';

const testEnv = { ...env, ANTHROPIC_API_KEY: 'sk-ant-test-key' } as unknown as Env;
const service = () => new RegisteredStatementExtractionService(testEnv);

/** Drive a raw model reply through the file-extraction path. */
async function fromFile(reply: string) {
  stubAnthropic(anthropicText(reply));
  return (await service().extractFromBase64(PDF_BYTES_B64, 'application/pdf')).data;
}

/** Drive a raw model reply through the pasted-text path. */
async function fromText(reply: string) {
  stubAnthropic(anthropicText(reply));
  return (await service().extractFromText('some pasted statement')).data;
}

const ONE_ACCOUNT = {
  accounts: [
    {
      account_type: 'RRSP',
      institution: '  Sun Life  ',
      is_employer_plan: true,
      employer_name: 'Acme',
      balance: '$12,345.67',
      reported_room: 5000,
      contributions: [
        { date: '2026-01-15', amount: '$100.00', contributor: 'employer' },
        { date: 'March 3, 2026', amount: 250, contributor: 'self' },
      ],
    },
  ],
  confidence: 0.88,
  rawText: 'statement text',
};

afterEach(() => vi.restoreAllMocks());

describe('RegisteredStatementExtractionService — response handling', () => {
  it('parses a bare JSON object', async () => {
    const data = await fromFile(JSON.stringify(ONE_ACCOUNT));
    expect(data.accounts).toHaveLength(1);
    expect(data.confidence).toBe(0.88);
    expect(data.rawText).toBe('statement text');
  });

  it('parses JSON wrapped in a markdown fence', async () => {
    const data = await fromFile('```json\n' + JSON.stringify(ONE_ACCOUNT) + '\n```');
    expect(data.accounts).toHaveLength(1);
  });

  it('parses a JSON object embedded in prose', async () => {
    const data = await fromFile(`Sure:\n${JSON.stringify(ONE_ACCOUNT)}\nAnything else?`);
    expect(data.accounts).toHaveLength(1);
  });

  it('throws a service-level error — not a parser message — on unparseable output', async () => {
    stubAnthropic(anthropicText('I cannot read this statement.'));
    const err = await service()
      .extractFromBase64(PDF_BYTES_B64, 'application/pdf')
      .catch((e: Error) => e);

    expect((err as Error).message).toBe('Failed to parse registered statement extraction response');
    expect((err as Error).message).not.toMatch(/JSON|token|position/i);
  });

  it('propagates a provider failure instead of returning an empty draft', async () => {
    stubAnthropicFailure(new Error('Anthropic 429 rate_limit_error'));
    await expect(service().extractFromBase64(PDF_BYTES_B64, 'application/pdf')).rejects.toThrow();
  });

  it('reports the model’s token usage for the file path', async () => {
    stubAnthropic(anthropicText(JSON.stringify(ONE_ACCOUNT)));
    const { usage } = await service().extractFromBase64(PDF_BYTES_B64, 'application/pdf');
    expect(usage).toEqual({ input_tokens: 100, output_tokens: 200 });
  });

  it('caches the system prompt on the file path', async () => {
    // These statements share a long system prompt across pages/files; caching it
    // is the difference between a cheap and an expensive import.
    const spy = stubAnthropic(anthropicText(JSON.stringify(ONE_ACCOUNT)));
    await service().extractFromBase64(PDF_BYTES_B64, 'application/pdf');

    const system = spy.mock.calls[0][0].system as Array<{ cache_control?: unknown }>;
    expect(Array.isArray(system)).toBe(true);
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('RegisteredStatementExtractionService — normalisation', () => {
  it('keeps a recognised account type, lowercased', async () => {
    const data = await fromFile(JSON.stringify(ONE_ACCOUNT));
    expect(data.accounts[0].account_type).toBe('rrsp');
  });

  it.each(['tfsa', 'rrsp', 'fhsa', 'dpsp', 'rpp'])('accepts the %s account type', async (type) => {
    const data = await fromFile(JSON.stringify({ accounts: [{ account_type: type.toUpperCase() }] }));
    expect(data.accounts[0].account_type).toBe(type);
  });

  it('nulls an account type it does not recognise rather than guessing', async () => {
    const data = await fromFile(JSON.stringify({ accounts: [{ account_type: 'resp' }] }));
    expect(data.accounts[0].account_type).toBeNull();
  });

  it('trims institution names and nulls empty ones', async () => {
    const data = await fromFile(JSON.stringify(ONE_ACCOUNT));
    expect(data.accounts[0].institution).toBe('Sun Life');

    const blank = await fromFile(JSON.stringify({ accounts: [{ institution: '   ' }] }));
    expect(blank.accounts[0].institution).toBeNull();
  });

  it('treats is_employer_plan as true only for a real boolean true', async () => {
    const truthy = await fromFile(JSON.stringify({ accounts: [{ is_employer_plan: 'yes' }] }));
    expect(truthy.accounts[0].is_employer_plan).toBe(false);

    const real = await fromFile(JSON.stringify({ accounts: [{ is_employer_plan: true }] }));
    expect(real.accounts[0].is_employer_plan).toBe(true);
  });

  it('strips currency formatting from balances and contribution room', async () => {
    const data = await fromFile(JSON.stringify(ONE_ACCOUNT));
    expect(data.accounts[0].balance).toBe(12345.67);
    expect(data.accounts[0].reported_room).toBe(5000);
  });

  it('nulls a balance that carries no digits instead of reading it as zero', async () => {
    const data = await fromFile(JSON.stringify({ accounts: [{ balance: 'not disclosed' }] }));
    expect(data.accounts[0].balance).toBeNull();
  });

  it('normalises contribution dates to YYYY-MM-DD', async () => {
    const data = await fromFile(JSON.stringify(ONE_ACCOUNT));
    expect(data.accounts[0].contributions[0].date).toBe('2026-01-15');
    expect(data.accounts[0].contributions[1].date).toBe('2026-03-03');
  });

  it('keeps the contributor as employer only when stated, defaulting to self', async () => {
    const data = await fromFile(JSON.stringify(ONE_ACCOUNT));
    expect(data.accounts[0].contributions[0].contributor).toBe('employer');
    expect(data.accounts[0].contributions[1].contributor).toBe('self');
  });

  it('drops contributions with no positive amount', async () => {
    // A null/zero contribution would otherwise be committed as a real deposit.
    const data = await fromFile(
      JSON.stringify({
        accounts: [
          {
            account_type: 'tfsa',
            contributions: [
              { date: '2026-01-01', amount: 100 },
              { date: '2026-02-01', amount: 0 },
              { date: '2026-03-01', amount: null },
              { date: '2026-04-01' },
            ],
          },
        ],
      })
    );
    expect(data.accounts[0].contributions).toHaveLength(1);
    expect(data.accounts[0].contributions[0].amount).toBe(100);
  });

  it('returns an empty account list when the model sent no accounts array', async () => {
    const data = await fromFile(JSON.stringify({ confidence: 0.2 }));
    expect(data.accounts).toEqual([]);
  });

  it('defaults confidence to 0.5 and rawText to empty when absent', async () => {
    const data = await fromFile(JSON.stringify({ accounts: [] }));
    expect(data.confidence).toBe(0.5);
    expect(data.rawText).toBe('');
  });
});

describe('RegisteredStatementExtractionService.extractFromText', () => {
  it('normalises pasted text through the same rules as a file', async () => {
    const data = await fromText(JSON.stringify(ONE_ACCOUNT));
    expect(data.accounts[0].account_type).toBe('rrsp');
    expect(data.accounts[0].balance).toBe(12345.67);
  });

  it('embeds the pasted document in the prompt rather than sending a media block', async () => {
    const spy = stubAnthropic(anthropicText(JSON.stringify({ accounts: [] })));
    await service().extractFromText('ACCOUNT SUMMARY 2026');

    expect(sentMediaBlock(spy)).toBeUndefined();
    const params = spy.mock.calls[0][0];
    expect(String(params.messages[0].content)).toContain('ACCOUNT SUMMARY 2026');
  });

  it('reports zero usage for the text path (nothing is billed per page)', async () => {
    stubAnthropic(anthropicText(JSON.stringify({ accounts: [] })));
    const { usage } = await service().extractFromText('text');
    expect(usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
});

describe('RegisteredStatementExtractionService — media routing', () => {
  it('sends an image as an image block with the sniffed type', async () => {
    const spy = stubAnthropic(anthropicText(JSON.stringify({ accounts: [] })));
    await service().extractFromBase64(JPEG_BYTES_B64, 'image/webp');

    const block = sentMediaBlock(spy);
    expect(block!.type).toBe('image');
    expect(block!.source.media_type).toBe('image/jpeg');
  });

  it('sends the user instruction alongside the document', async () => {
    const spy = stubAnthropic(anthropicText(JSON.stringify({ accounts: [] })));
    await service().extractFromBase64(PDF_BYTES_B64, 'application/pdf');

    const blocks = sentContentBlocks(spy);
    expect(blocks.some((b) => b.type === 'text')).toBe(true);
  });
});
