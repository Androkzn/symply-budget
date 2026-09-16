/**
 * Utility-bill extraction — the AI response → stored bill pipeline.
 *
 * Everything is driven through the public surface (`extractFromR2`,
 * `extractFromBase64`, `toCreateBillInput`) with the Anthropic transport stubbed
 * offline, so the tests describe behaviour rather than pinning private helpers.
 *
 * The normalisation layer is where a silent wrong answer costs the most: a bill
 * amount that parses to `null`, a date that survives as a raw string, or a
 * dollars→cents slip all produce a plausible-looking but wrong record.
 */
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExtractedUtilityBill } from '../../ai/prompts/extract-utility-bill';
import type { Env } from '../../types';
import { BillExtractionService } from '../bill-extraction-service';

import {
  JPEG_BYTES_B64,
  PDF_BYTES_B64,
  anthropicText,
  sentMediaBlock,
  stubAnthropic,
  stubAnthropicFailure,
} from './ai-extraction-test-helpers';

const testEnv = { ...env, ANTHROPIC_API_KEY: 'sk-ant-test-key' } as unknown as Env;
const service = () => new BillExtractionService(testEnv);

/** Drive a raw model reply through the public extraction path. */
async function extract(modelReply: string): Promise<ExtractedUtilityBill> {
  stubAnthropic(anthropicText(modelReply));
  const { data } = await service().extractFromBase64(PDF_BYTES_B64, 'application/pdf');
  return data;
}

const FULL_BILL = {
  provider: { name: 'BC Hydro', type: 'Hydro' },
  account: { number: '1234 5678 90', invoiceNumber: 'INV-1', serviceAddress: '1 Main St', customerName: 'A' },
  billing: {
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    billingDate: '2026-02-01',
    dueDate: '2026-02-15',
  },
  financial: { amountDue: '$120.50', previousBalance: 0, currentCharges: 120.5 },
  usage: { quantity: '450 kWh', unit: 'kWh' },
  confidence: { overall: 0.93 },
};

afterEach(() => vi.restoreAllMocks());

describe('BillExtractionService — reading the model response', () => {
  it('parses a bare JSON object', async () => {
    const data = await extract(JSON.stringify(FULL_BILL));
    expect(data.provider.name).toBe('BC Hydro');
    expect(data.financial.amountDue).toBe(120.5);
  });

  it('parses JSON wrapped in a markdown fence', async () => {
    const data = await extract('```json\n' + JSON.stringify(FULL_BILL) + '\n```');
    expect(data.provider.name).toBe('BC Hydro');
  });

  it('parses a JSON object embedded in prose', async () => {
    const data = await extract(`Here is the bill:\n${JSON.stringify(FULL_BILL)}\nHope that helps.`);
    expect(data.financial.amountDue).toBe(120.5);
  });

  it('throws a service-level error — not a raw parser message — on unparseable output', async () => {
    stubAnthropic(anthropicText('I could not read that document.'));
    const err = await service()
      .extractFromBase64(PDF_BYTES_B64, 'application/pdf')
      .catch((e: Error) => e);

    expect((err as Error).message).toBe('Failed to parse bill extraction response');
    // Never the underlying JSON.parse text.
    expect((err as Error).message).not.toMatch(/JSON|token|position|unexpected/i);
  });

  it('propagates a provider failure rather than inventing an empty bill', async () => {
    // A silent empty bill would be committed as a real record; failing is correct.
    stubAnthropicFailure(new Error('Anthropic 529 overloaded'));
    await expect(service().extractFromBase64(PDF_BYTES_B64, 'application/pdf')).rejects.toThrow();
  });

  it('reports the token usage the model returned', async () => {
    stubAnthropic(anthropicText(JSON.stringify(FULL_BILL)));
    const { usage } = await service().extractFromBase64(PDF_BYTES_B64, 'application/pdf');
    expect(usage).toEqual({ input_tokens: 100, output_tokens: 200 });
  });
});

describe('BillExtractionService — normalisation', () => {
  it.each([
    ['Hydro', 'electricity'],
    ['electric', 'electricity'],
    ['Electricity', 'electricity'],
    ['natural gas', 'gas'],
    ['Water', 'water'],
    ['sewer', 'sewer'],
    ['waste', 'garbage'],
    ['satellite uplink', 'other'],
    [undefined, 'other'],
  ])('maps provider type %s to %s', async (input, expected) => {
    const data = await extract(JSON.stringify({ ...FULL_BILL, provider: { name: 'X', type: input } }));
    expect(data.provider.type).toBe(expected);
  });

  it('strips currency formatting from amounts', async () => {
    const data = await extract(
      JSON.stringify({
        ...FULL_BILL,
        financial: { amountDue: '$1,234.56', previousBalance: '-$10.00', currentCharges: 'n/a' },
      })
    );
    expect(data.financial.amountDue).toBe(1234.56);
    expect(data.financial.previousBalance).toBe(-10);
    // A value with no digits is null, not 0 — "unknown" must not read as "zero".
    expect(data.financial.currentCharges).toBeNull();
  });

  it('normalises dates to YYYY-MM-DD and drops unparseable ones', async () => {
    const data = await extract(
      JSON.stringify({
        ...FULL_BILL,
        billing: {
          periodStart: 'January 1, 2026',
          periodEnd: '2026-01-31',
          billingDate: 'not a date',
          dueDate: null,
        },
      })
    );
    expect(data.billing.periodStart).toBe('2026-01-01');
    expect(data.billing.periodEnd).toBe('2026-01-31');
    expect(data.billing.billingDate).toBeNull();
    expect(data.billing.dueDate).toBeNull();
  });

  it('derives the period length when the model omitted it', async () => {
    const data = await extract(JSON.stringify(FULL_BILL));
    expect(data.usage.periodDays).toBe(30); // 2026-01-01 → 2026-01-31
  });

  it('keeps the model’s own period length when supplied', async () => {
    const data = await extract(
      JSON.stringify({ ...FULL_BILL, usage: { ...FULL_BILL.usage, periodDays: 61 } })
    );
    expect(data.usage.periodDays).toBe(61);
  });

  it('removes spaces from the account number', async () => {
    const data = await extract(JSON.stringify(FULL_BILL));
    expect(data.account.number).toBe('1234567890');
  });

  it('drops line items and taxes that carry neither a description nor an amount', async () => {
    const data = await extract(
      JSON.stringify({
        ...FULL_BILL,
        lineItems: [{ description: 'Basic charge', amount: 6.5 }, null, {}, { amount: 2 }],
        taxes: [{ description: 'GST', amount: 5 }, {}],
      })
    );
    expect(data.lineItems!).toHaveLength(2);
    expect(data.lineItems![0]).toMatchObject({ description: 'Basic charge', amount: 6.5 });
    expect(data.taxes!).toHaveLength(1);
  });

  it('defaults a missing line-item amount to 0 rather than null', async () => {
    const data = await extract(
      JSON.stringify({ ...FULL_BILL, lineItems: [{ description: 'Rebate' }] })
    );
    expect(data.lineItems![0].amount).toBe(0);
  });

  it('substitutes neutral defaults for absent collections and confidence', async () => {
    const data = await extract(JSON.stringify({ provider: {}, billing: {}, financial: {} }));
    expect(data.lineItems).toEqual([]);
    expect(data.taxes).toEqual([]);
    expect(data.meterReadings).toEqual([]);
    expect(data.confidence.overall).toBe(0.5);
    expect(data.rawText).toBe('');
  });

  it('normalises meter readings including their dates', async () => {
    const data = await extract(
      JSON.stringify({
        ...FULL_BILL,
        meterReadings: [
          {
            meterNumber: 'M-1',
            currentReading: '1,200',
            currentReadingDate: '2026-01-31',
            previousReading: '1,000',
            consumption: '200',
            unit: 'kWh',
          },
        ],
      })
    );
    expect(data.meterReadings![0]).toMatchObject({
      meterNumber: 'M-1',
      currentReading: 1200,
      currentReadingDate: '2026-01-31',
      consumption: 200,
    });
  });
});

describe('BillExtractionService.extractFromR2', () => {
  /**
   * Bytes with no recognisable signature, so the provider's sniff falls back to
   * the DECLARED type — which is exactly what `detectMediaType` chose. Real
   * signatures would be corrected by the sniff and hide the decision under test.
   */
  const OPAQUE_BYTES = new TextEncoder().encode('opaque bytes with no magic number');

  const put = (key: string, contentType?: string) =>
    testEnv.REPORTS_BUCKET.put(key, OPAQUE_BYTES, {
      httpMetadata: contentType ? { contentType } : undefined,
    });

  it('throws a clear error when the file is missing from storage', async () => {
    await expect(service().extractFromR2('bills/does-not-exist.pdf')).rejects.toThrow(
      'File not found in storage'
    );
  });

  it.each([
    ['application/pdf', 'document'],
    ['image/jpeg', 'image'],
    ['image/png', 'image'],
    ['image/webp', 'image'],
  ])('uses the R2 content type %s over the (misleading) .txt name', async (contentType, blockType) => {
    const spy = stubAnthropic(anthropicText(JSON.stringify(FULL_BILL)));
    const key = `bills/${contentType.replace('/', '-')}.txt`;
    await put(key, contentType);
    await service().extractFromR2(key);

    const block = sentMediaBlock(spy);
    expect(block!.type).toBe(blockType);
    expect(block!.source.media_type).toBe(contentType);
  });

  it.each([
    ['bills/statement.pdf', 'application/pdf'],
    ['bills/statement.jpeg', 'image/jpeg'],
    ['bills/statement.png', 'image/png'],
    ['bills/statement.webp', 'image/webp'],
  ])('falls back to the extension of %s when R2 recorded no content type', async (key, expected) => {
    const spy = stubAnthropic(anthropicText(JSON.stringify(FULL_BILL)));
    await put(key);
    await service().extractFromR2(key);

    expect(sentMediaBlock(spy)!.source.media_type).toBe(expected);
  });

  it('still corrects the type when the extension lies about the bytes', async () => {
    const spy = stubAnthropic(anthropicText(JSON.stringify(FULL_BILL)));
    await testEnv.REPORTS_BUCKET.put(
      'bills/statement.png',
      Uint8Array.from(atob(JPEG_BYTES_B64), (c) => c.charCodeAt(0))
    );
    await service().extractFromR2('bills/statement.png');

    const block = sentMediaBlock(spy);
    expect(block!.type).toBe('image');
    expect(block!.source.media_type).toBe('image/jpeg');
  });

  it('defaults to PDF for an unrecognised name with no content type', async () => {
    const spy = stubAnthropic(anthropicText(JSON.stringify(FULL_BILL)));
    await testEnv.REPORTS_BUCKET.put(
      'bills/statement.unknown',
      Uint8Array.from(atob(PDF_BYTES_B64), (c) => c.charCodeAt(0))
    );
    await service().extractFromR2('bills/statement.unknown');

    expect(sentMediaBlock(spy)!.type).toBe('document');
  });
});

describe('BillExtractionService.toCreateBillInput', () => {
  const base = (over?: Partial<ExtractedUtilityBill>): ExtractedUtilityBill =>
    ({
      provider: { name: 'BC Hydro', type: 'electricity' },
      account: { number: '123', invoiceNumber: null, serviceAddress: null, customerName: null },
      billing: {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        billingDate: '2026-02-01',
        dueDate: '2026-02-15',
      },
      financial: {
        amountDue: 120.5,
        previousBalance: null,
        paymentsReceived: null,
        currentCharges: null,
        latePaymentCharge: null,
      },
      usage: {
        quantity: 450,
        unit: 'kWh',
        periodDays: 30,
        averageDailyUsage: null,
        averageDailyCost: null,
        meterNumber: null,
      },
      meterReadings: [],
      lineItems: [],
      taxes: [],
      comparison: { lastBillUsage: null, lastYearUsage: null, unit: null },
      rates: { basicCharge: null, energyRate: null },
      confidence: {
        overall: 0.93,
        provider: 0.9,
        account: 0.9,
        billing: 0.9,
        financial: 0.9,
        usage: 0.9,
      },
      rawText: '',
      ...over,
    }) as ExtractedUtilityBill;

  const toInput = (e: ExtractedUtilityBill) =>
    BillExtractionService.prototype.toCreateBillInput.call({} as BillExtractionService, e);

  it('converts the amount to integer cents and carries the period', () => {
    const input = toInput(base());
    expect(input.amount).toBe(12050);
    expect(input.billType).toBe('electricity');
    expect(input.billingPeriodStart).toBe('2026-01-01');
    expect(input.dueDate).toBe('2026-02-15');
    expect(input.usageQuantity).toBe(450);
    expect(input.confidenceScore).toBe(0.93);
  });

  it('rounds fractional cents rather than truncating them', () => {
    const input = toInput(base({ financial: { ...base().financial, amountDue: 10.005 } }));
    expect(input.amount).toBe(1001);
    expect(Number.isInteger(input.amount)).toBe(true);
  });

  it('carries a zero amount through instead of treating it as missing', () => {
    const input = toInput(base({ financial: { ...base().financial, amountDue: 0 } }));
    expect(input.amount).toBe(0);
  });

  it('omits optional fields rather than sending empty strings', () => {
    const input = toInput(
      base({
        provider: { name: null, type: 'gas' },
        account: { number: null, invoiceNumber: null, serviceAddress: null, customerName: null },
        usage: { ...base().usage, quantity: null, unit: null },
      })
    );
    expect(input.provider).toBeUndefined();
    expect(input.accountNumber).toBeUndefined();
    expect(input.usageQuantity).toBeUndefined();
    expect(input.usageUnit).toBeUndefined();
  });

  it('refuses to build a record without a billing period, due date or amount', () => {
    expect(() => toInput(base({ billing: { ...base().billing, periodStart: null } }))).toThrow(
      /billing period/i
    );
    expect(() => toInput(base({ billing: { ...base().billing, dueDate: null } }))).toThrow(/due date/i);
    expect(() =>
      toInput(base({ financial: { ...base().financial, amountDue: null } }))
    ).toThrow(/amount due/i);
  });
});
