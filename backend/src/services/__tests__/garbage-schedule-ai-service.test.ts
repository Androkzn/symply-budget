/**
 * Garbage-schedule detection — Claude + the server-side web_search tool turning
 * an address into a DRAFT collection schedule the member confirms.
 *
 * The product rule that shapes every assertion: a wrong schedule is worse than
 * no schedule (a member who trusts it misses collection for weeks). So the
 * normaliser drops anything it cannot vouch for, and an unreadable model reply
 * degrades to "nothing found" — the client then falls back to manual entry —
 * rather than throwing or inventing a plausible weekly pickup.
 */
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../types';
import { GarbageScheduleAIService } from '../garbage-schedule-ai-service';

import { anthropicText, stubAnthropic, stubAnthropicFailure } from './ai-extraction-test-helpers';

const testEnv = { ...env, ANTHROPIC_API_KEY: 'sk-ant-test-key' } as unknown as Env;
const service = () => new GarbageScheduleAIService(testEnv);

const ADDRESS = {
  address_line1: '8135 138 ST',
  city: 'Surrey',
  state_province: 'BC',
  postal_code: 'V3W 0A1',
  country: 'CA',
};

/** Drive a raw model reply through the public detection path. */
async function detect(reply: string, address = ADDRESS) {
  stubAnthropic(anthropicText(reply));
  return (await service().detectFromAddress(address)).data;
}

const GOOD_REPLY = {
  municipality: 'City of Surrey',
  schedules: [
    { type: 'garbage', frequency: 'biweekly', dayOfWeek: 3, week: 'A' },
    { type: 'organics', frequency: 'weekly', dayOfWeek: 3 },
  ],
  setOutTime: '07:00',
  confidence: 0.9,
  addressSpecific: true,
  notes: 'Collection day is Wednesday.',
  sources: [{ title: 'Surrey waste', url: 'https://surrey.ca/waste' }],
};

afterEach(() => vi.restoreAllMocks());

describe('GarbageScheduleAIService — address handling', () => {
  it('refuses to search without a city', async () => {
    // A street number alone cannot identify a municipality; searching anyway
    // returns a confident schedule for the wrong town.
    await expect(
      service().detectFromAddress({ address_line1: '8135 138 ST', city: null })
    ).rejects.toThrow(/street address .*city.* required/i);
  });

  it('refuses when the city is only whitespace', async () => {
    await expect(service().detectFromAddress({ city: '   ' })).rejects.toThrow();
  });

  it('puts the full address into the prompt', async () => {
    const spy = stubAnthropic(anthropicText(JSON.stringify(GOOD_REPLY)));
    await service().detectFromAddress(ADDRESS);

    const prompt = String(spy.mock.calls[0][0].messages[0].content);
    expect(prompt).toContain('8135 138 ST, Surrey, BC, V3W 0A1, CA');
    expect(prompt).not.toContain('{{ADDRESS}}');
  });

  it('omits blank address parts rather than leaving empty separators', async () => {
    const spy = stubAnthropic(anthropicText(JSON.stringify(GOOD_REPLY)));
    await service().detectFromAddress({ address_line1: null, city: 'Surrey', country: 'CA' });

    const prompt = String(spy.mock.calls[0][0].messages[0].content);
    expect(prompt).toContain('Surrey, CA');
    expect(prompt).not.toMatch(/, ,/);
  });

  it('enables the web_search tool for the lookup', async () => {
    const spy = stubAnthropic(anthropicText(JSON.stringify(GOOD_REPLY)));
    await service().detectFromAddress(ADDRESS);

    const tools = spy.mock.calls[0][0].tools as Array<{ type?: string; name?: string }>;
    expect(tools?.[0]).toMatchObject({ name: 'web_search' });
  });
});

describe('GarbageScheduleAIService — a usable result', () => {
  it('keeps well-formed schedule items', async () => {
    const data = await detect(JSON.stringify(GOOD_REPLY));
    expect(data.municipality).toBe('City of Surrey');
    expect(data.schedules).toHaveLength(2);
    expect(data.schedules[0]).toMatchObject({
      type: 'garbage',
      frequency: 'biweekly',
      dayOfWeek: 3,
      week: 'A',
    });
    expect(data.setOutTime).toBe('07:00');
    expect(data.addressSpecific).toBe(true);
    expect(data.sources).toEqual([{ title: 'Surrey waste', url: 'https://surrey.ca/waste' }]);
  });

  it('reads a fenced JSON reply', async () => {
    const data = await detect('```json\n' + JSON.stringify(GOOD_REPLY) + '\n```');
    expect(data.schedules).toHaveLength(2);
  });

  it('accepts week-of-month schedules within 1–5', async () => {
    const data = await detect(
      JSON.stringify({
        schedules: [{ type: 'bulkItem', frequency: 'monthly', weekOfMonth: [1, 3, 9, 0] }],
        confidence: 0.8,
      })
    );
    expect(data.schedules[0].weekOfMonth).toEqual([1, 3]);
  });

  it('accepts a seasonal window', async () => {
    const data = await detect(
      JSON.stringify({
        schedules: [
          {
            type: 'yardWaste',
            frequency: 'seasonal',
            seasonStart: { month: 4, day: 1 },
            seasonEnd: { month: 11, day: 30 },
          },
        ],
        confidence: 0.7,
      })
    );
    expect(data.schedules[0].seasonStart).toEqual({ month: 4, day: 1 });
    expect(data.schedules[0].seasonEnd).toEqual({ month: 11, day: 30 });
  });

  it('reports the model’s token usage', async () => {
    stubAnthropic(anthropicText(JSON.stringify(GOOD_REPLY)));
    const { usage } = await service().detectFromAddress(ADDRESS);
    expect(usage).toEqual({ input_tokens: 100, output_tokens: 200 });
  });
});

describe('GarbageScheduleAIService — dropping what it cannot vouch for', () => {
  it('drops an item with an unknown waste type or frequency', async () => {
    const data = await detect(
      JSON.stringify({
        schedules: [
          { type: 'nuclear', frequency: 'weekly' },
          { type: 'garbage', frequency: 'fortnightly' },
          { type: 'garbage', frequency: 'weekly' },
        ],
        confidence: 0.9,
      })
    );
    expect(data.schedules).toHaveLength(1);
    expect(data.schedules[0]).toMatchObject({ type: 'garbage', frequency: 'weekly' });
  });

  it('drops an out-of-range day of week', async () => {
    const data = await detect(
      JSON.stringify({ schedules: [{ type: 'garbage', frequency: 'weekly', dayOfWeek: 9 }], confidence: 0.9 })
    );
    expect(data.schedules[0].dayOfWeek).toBeUndefined();
  });

  it('drops an impossible season date', async () => {
    const data = await detect(
      JSON.stringify({
        schedules: [
          { type: 'yardWaste', frequency: 'seasonal', seasonStart: { month: 13, day: 1 }, seasonEnd: { month: 6, day: 45 } },
        ],
        confidence: 0.9,
      })
    );
    expect(data.schedules[0].seasonStart).toBeUndefined();
    expect(data.schedules[0].seasonEnd).toBeUndefined();
  });

  it('drops a set-out time that is not a real 24h clock time', async () => {
    for (const bad of ['7am', '25:00', '07:99', '']) {
      const data = await detect(JSON.stringify({ ...GOOD_REPLY, setOutTime: bad }));
      expect(data.setOutTime).toBeNull();
    }
  });

  it('drops an alternating-week marker that is not A or B', async () => {
    const data = await detect(
      JSON.stringify({ schedules: [{ type: 'garbage', frequency: 'biweekly', week: 'C' }], confidence: 0.9 })
    );
    expect(data.schedules[0].week).toBeUndefined();
  });

  it('drops sources with neither a title nor a URL', async () => {
    const data = await detect(
      JSON.stringify({ ...GOOD_REPLY, sources: [{ title: 'ok', url: 'https://x' }, {}, null] })
    );
    expect(data.sources).toHaveLength(1);
  });
});

describe('GarbageScheduleAIService — confidence discipline', () => {
  it('clamps a confidence above 1 or below 0', async () => {
    const high = await detect(JSON.stringify({ ...GOOD_REPLY, confidence: 5 }));
    expect(high.confidence).toBe(1);

    const low = await detect(JSON.stringify({ ...GOOD_REPLY, confidence: -3 }));
    expect(low.confidence).toBe(0);
  });

  it('caps confidence at 0.3 when no usable schedule item survived', async () => {
    // The model claiming 0.99 while returning nothing usable must not read as a
    // trustworthy result downstream.
    const data = await detect(JSON.stringify({ municipality: 'Somewhere', schedules: [], confidence: 0.99 }));
    expect(data.schedules).toEqual([]);
    expect(data.confidence).toBeLessThanOrEqual(0.3);
  });

  it('treats a non-numeric confidence as zero', async () => {
    const data = await detect(JSON.stringify({ ...GOOD_REPLY, confidence: 'high' }));
    expect(data.confidence).toBe(0);
  });
});

describe('GarbageScheduleAIService — failure modes', () => {
  it('returns a member-safe "nothing found" draft when the reply is not JSON', async () => {
    const data = await detect('I could not find a collection schedule for that address.');

    expect(data.schedules).toEqual([]);
    expect(data.municipality).toBeNull();
    expect(data.confidence).toBe(0);
    expect(data.notes).toBe('Could not determine a schedule automatically.');
    // Never a raw parser/system string in a field a member can read.
    expect(data.notes).not.toMatch(/JSON|error|undefined/i);
  });

  it('returns "nothing found" for a truncated JSON reply rather than a partial schedule', async () => {
    const data = await detect('{"municipality":"Surrey","schedules":[{"type":"garbage","frequ');
    expect(data.schedules).toEqual([]);
    expect(data.confidence).toBe(0);
  });

  it('propagates a provider failure (that is not a parse problem)', async () => {
    stubAnthropicFailure(new Error('Anthropic 500 api_error'));
    await expect(service().detectFromAddress(ADDRESS)).rejects.toThrow();
  });

  it('truncates an over-long municipality and notes instead of storing them whole', async () => {
    const data = await detect(
      JSON.stringify({ ...GOOD_REPLY, municipality: 'M'.repeat(500), notes: 'N'.repeat(900) })
    );
    expect(data.municipality!.length).toBe(200);
    expect(data.notes.length).toBe(500);
  });
});
