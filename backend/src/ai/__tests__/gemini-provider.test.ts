/**
 * GeminiProvider — the outgoing Generative Language request and every way the
 * response can go wrong. `fetch` is stubbed throughout; no test reaches Google.
 *
 * Two invariants carry real weight here:
 *  - the API key travels in the `x-goog-api-key` HEADER, never the query string
 *    (a key in a URL ends up in proxy/access logs);
 *  - the Aihousekeeper `generate` / `generateStructured` entry points are NOT
 *    implemented for Gemini and must fail loudly, so the provider factory can
 *    never hand a caller a silently useless adapter.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { GeminiProvider } from '../gemini-provider';

const KEY = 'AIzaSyDUMMYKEYFORTESTSONLY0123456789xyz';

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: {
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    generationConfig: { maxOutputTokens: number };
  };
}

function stubGemini(reply: { status?: number; json?: unknown; text?: string }): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      const status = reply.status ?? 200;
      if (status >= 400) return new Response(reply.text ?? 'upstream failure', { status });
      return new Response(JSON.stringify(reply.json ?? {}), { status });
    })
  );
  return calls;
}

/** A generateContent payload carrying one text candidate. */
function candidate(text: string, usage?: Record<string, number>) {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: usage ?? {
      promptTokenCount: 12,
      candidatesTokenCount: 34,
      cachedContentTokenCount: 5,
    },
  };
}

const reportMetadata = {
  filename: 'r.pdf',
  page_count: 12,
  property_address: '1 Main St',
  inspection_date: '2026-01-02',
  inspector_name: 'A. Inspector',
};

afterEach(() => vi.unstubAllGlobals());

describe('GeminiProvider — the outgoing request', () => {
  it('sends the key as a header and keeps it out of the URL', async () => {
    const calls = stubGemini({ json: candidate('{"findings":[]}') });
    await new GeminiProvider(KEY).extractFindings({ chunks: [], promptVersion: 'v1' });

    expect(calls[0].headers['x-goog-api-key']).toBe(KEY);
    expect(calls[0].url).not.toContain(KEY);
    expect(calls[0].url).not.toContain('key=');
  });

  it('targets the configured model on the v1beta generateContent endpoint', async () => {
    const calls = stubGemini({ json: candidate('{"findings":[]}') });
    await new GeminiProvider(KEY, { model: 'gemini-3.5-pro' }).extractFindings({
      chunks: [],
      promptVersion: 'v1',
    });
    expect(calls[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-pro:generateContent'
    );
  });

  it('asks for a token budget big enough for a long findings list', async () => {
    const calls = stubGemini({ json: candidate('{"findings":[]}') });
    await new GeminiProvider(KEY).extractFindings({ chunks: [], promptVersion: 'v1' });
    expect(calls[0].body.generationConfig.maxOutputTokens).toBe(8192);
  });

  it('puts the chunk text and its page marker into the prompt', async () => {
    const calls = stubGemini({ json: candidate('{"findings":[]}') });
    await new GeminiProvider(KEY).extractFindings({
      chunks: [{ chunk_index: 0, page_number: 7, section_type: 'Plumbing', content: 'drip under sink' }],
      promptVersion: 'v1',
    });

    const prompt = calls[0].body.contents[0].parts[0].text;
    expect(prompt).toContain('drip under sink');
    expect(prompt).toContain('Page 7');
    expect(prompt).toContain('Plumbing');
  });

  it('substitutes report metadata into the summary prompt', async () => {
    const calls = stubGemini({ json: candidate('{"overall_condition":"good"}') });
    await new GeminiProvider(KEY).generateSummary({
      findings: [],
      reportMetadata,
      promptVersion: 'v1',
    });

    const prompt = calls[0].body.contents[0].parts[0].text;
    expect(prompt).toContain('1 Main St');
    expect(prompt).toContain('A. Inspector');
    // No unsubstituted placeholders left behind.
    expect(prompt).not.toContain('{property_address}');
    expect(prompt).not.toContain('{findings_json}');
  });

  it('spells the country out for action plans', async () => {
    const calls = stubGemini({ json: candidate('{"action_plans":[]}') });
    await new GeminiProvider(KEY).generateActionPlans({
      findings: [],
      timeframes: ['0-30_days', '3-6_months'],
      country: 'CA',
      promptVersion: 'v1',
    });

    const prompt = calls[0].body.contents[0].parts[0].text;
    expect(prompt).toContain('Canada');
    expect(prompt).toContain('0-30_days, 3-6_months');
  });
});

describe('GeminiProvider — reading the response', () => {
  it('unwraps JSON fenced in a markdown code block', async () => {
    stubGemini({ json: candidate('```json\n{"findings":[{"title":"Roof"}]}\n```') });
    const findings = await new GeminiProvider(KEY).extractFindings({ chunks: [], promptVersion: 'v1' });
    expect(findings).toEqual([{ title: 'Roof' }]);
  });

  it('finds a bare JSON object surrounded by prose', async () => {
    stubGemini({ json: candidate('Here you go: {"findings":[{"title":"Furnace"}]} hope that helps') });
    const findings = await new GeminiProvider(KEY).extractFindings({ chunks: [], promptVersion: 'v1' });
    expect(findings).toEqual([{ title: 'Furnace' }]);
  });

  it('reports token usage from usageMetadata, including cached tokens', async () => {
    stubGemini({ json: candidate('{"findings":[]}') });
    const events: Array<{ provider: string; status: string }> = [];
    await new GeminiProvider(KEY, { onUsage: (e) => void events.push(e) }).extractFindings({
      chunks: [],
      promptVersion: 'v1',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'gemini',
      // promptTokenCount (12) INCLUDES cachedContentTokenCount (5): the
      // uncached remainder is what bills at the input rate.
      inputTokens: 7,
      outputTokens: 34,
      cacheReadTokens: 5,
      status: 'ok',
    });
  });

  it('keeps working when the usage recorder throws', async () => {
    stubGemini({ json: candidate('{"findings":[{"title":"ok"}]}') });
    const provider = new GeminiProvider(KEY, {
      onUsage: () => {
        throw new Error('usage sink is down');
      },
    });
    await expect(provider.extractFindings({ chunks: [], promptVersion: 'v1' })).resolves.toEqual([
      { title: 'ok' },
    ]);
  });
});

describe('GeminiProvider — failure modes', () => {
  it.each([
    ['a rate limit', 429],
    ['a client error', 400],
    ['a server error', 500],
  ])('throws with the status on %s', async (_label, status) => {
    stubGemini({ status, text: 'upstream said no' });
    await expect(
      new GeminiProvider(KEY).extractFindings({ chunks: [], promptVersion: 'v1' })
    ).rejects.toThrow(`Gemini API error: ${status}`);
  });

  it('never puts the API key in the error it throws', async () => {
    stubGemini({ status: 400, text: `API key not valid: ${KEY}` });
    const err = await new GeminiProvider(KEY)
      .extractFindings({ chunks: [], promptVersion: 'v1' })
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(KEY);
  });

  it('throws when the payload carries an inline error instead of a candidate', async () => {
    stubGemini({ json: { error: { message: 'quota exceeded', code: 429 } } });
    await expect(
      new GeminiProvider(KEY).extractFindings({ chunks: [], promptVersion: 'v1' })
    ).rejects.toThrow(/quota exceeded/);
  });

  it('throws when the model returned no text at all (e.g. a safety block)', async () => {
    stubGemini({ json: { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] } });
    await expect(
      new GeminiProvider(KEY).extractFindings({ chunks: [], promptVersion: 'v1' })
    ).rejects.toThrow(/No response text/i);
  });

  it('returns an empty findings list when JSON was demanded but prose came back', async () => {
    // Unparseable output must degrade to "nothing found", not crash the pipeline.
    stubGemini({ json: candidate('I could not read that report.') });
    const findings = await new GeminiProvider(KEY).extractFindings({ chunks: [], promptVersion: 'v1' });
    expect(findings).toEqual([]);
  });

  it('returns a member-safe fallback summary when the response is not JSON', async () => {
    stubGemini({ json: candidate('sorry, no') });
    const summary = await new GeminiProvider(KEY).generateSummary({
      findings: [],
      reportMetadata,
      promptVersion: 'v1',
    });

    expect(summary.overall_condition).toBe('fair');
    // Never a raw provider/system string in something a member could read.
    expect(summary.executive_summary).not.toMatch(/error|http|json|sorry, no/i);
  });

  it('returns an empty action-plan list when the response is not JSON', async () => {
    stubGemini({ json: candidate('nope') });
    const plans = await new GeminiProvider(KEY).generateActionPlans({
      findings: [],
      timeframes: ['0-30_days'],
      country: 'US',
      promptVersion: 'v1',
    });
    expect(plans).toEqual([]);
  });

  it('reports itself unavailable without a key', () => {
    expect(new GeminiProvider('').isAvailable()).toBe(false);
    expect(new GeminiProvider(KEY).isAvailable()).toBe(true);
  });
});

describe('GeminiProvider — unimplemented Aihousekeeper surface', () => {
  // These must throw rather than return an empty/garbage result: the factory can
  // hand out a Gemini adapter, and a silent no-op would look like "the assistant
  // had nothing to say".
  it('generate refuses and names the provider to use instead', async () => {
    await expect(
      new GeminiProvider(KEY).generate({ model: 'm', systemPrompt: 's', messages: [] })
    ).rejects.toThrow(/not implemented.*Use ClaudeProvider/is);
  });

  it('generateStructured refuses and names the provider to use instead', async () => {
    await expect(
      new GeminiProvider(KEY).generateStructured({
        model: 'm',
        systemPrompt: 's',
        userPrompt: 'u',
        schema: {},
      })
    ).rejects.toThrow(/not implemented.*Use ClaudeProvider/is);
  });
});
