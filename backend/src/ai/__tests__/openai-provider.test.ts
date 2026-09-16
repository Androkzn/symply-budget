/**
 * OpenAIProvider — asserts the request that WOULD be sent to OpenAI as much as
 * the handling of what comes back. No test here may reach the network: `fetch`
 * is stubbed in every case, so a regression that starts calling the real API
 * fails loudly (the stub records the call) instead of billing a key.
 *
 * The failure modes matter more than the happy path: a 4xx/5xx, a rate limit, a
 * truncated answer, and a tool payload that is not valid JSON when JSON was
 * demanded are all silent-corruption risks — a short list looks like a real
 * short list. Each one is pinned below.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { OpenAIProvider } from '../openai-provider';

/** Looks like a real secret so the "never leaks" assertions are meaningful. */
const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
    max_completion_tokens: number;
    tools?: Array<{ type: string; function: { name: string; parameters: unknown } }>;
    tool_choice?: unknown;
  };
}

/** Stub `fetch` with a fixed reply and record every request the provider builds. */
function stubOpenAI(reply: { status?: number; json?: unknown; text?: string }): RecordedCall[] {
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

/** A chat-completions payload with one assistant text answer. */
function textReply(text: string, finishReason = 'stop') {
  return {
    model: 'gpt-5.6-terra',
    choices: [{ message: { content: text }, finish_reason: finishReason }],
    usage: { prompt_tokens: 11, completion_tokens: 22 },
  };
}

/** A chat-completions payload with one tool call. */
function toolReply(name: string, args: string) {
  return {
    model: 'gpt-5.6-terra',
    choices: [
      {
        message: { content: null, tool_calls: [{ id: 'call_1', function: { name, arguments: args } }] },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 6 },
  };
}

const simpleArgs = {
  model: 'gpt-5.6-terra',
  systemPrompt: 'be brief',
  messages: [{ role: 'user' as const, content: 'hello' }],
};

afterEach(() => vi.unstubAllGlobals());

describe('OpenAIProvider — the outgoing request', () => {
  it('posts to chat/completions with the bearer key, system+user turns and a token budget', async () => {
    const calls = stubOpenAI({ json: textReply('hi') });
    await new OpenAIProvider(KEY).generate({ ...simpleArgs, maxTokens: 1234 });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0].body.model).toBe('gpt-5.6-terra');
    expect(calls[0].body.max_completion_tokens).toBe(1234);
    expect(calls[0].body.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('falls back to the constructor model when the call names none', async () => {
    const calls = stubOpenAI({ json: textReply('hi') });
    await new OpenAIProvider(KEY, { model: 'gpt-5.6-sol' }).generate({
      ...simpleArgs,
      model: '',
    });
    expect(calls[0].body.model).toBe('gpt-5.6-sol');
  });

  it('translates tool defs and each toolChoice mode to the OpenAI vocabulary', async () => {
    const tools = [{ name: 'lookup', description: 'find it', input_schema: { type: 'object' } }];

    for (const [choice, expected] of [
      [{ type: 'any' as const }, 'required'],
      [{ type: 'auto' as const }, 'auto'],
      [{ type: 'tool' as const, name: 'lookup' }, { type: 'function', function: { name: 'lookup' } }],
    ] as const) {
      const calls = stubOpenAI({ json: textReply('ok') });
      await new OpenAIProvider(KEY).generate({ ...simpleArgs, tools, toolChoice: choice });
      expect(calls[0].body.tools).toEqual([
        { type: 'function', function: { name: 'lookup', description: 'find it', parameters: { type: 'object' } } },
      ]);
      expect(calls[0].body.tool_choice).toEqual(expected);
      vi.unstubAllGlobals();
    }
  });

  it('omits tools entirely when the caller passed none', async () => {
    const calls = stubOpenAI({ json: textReply('ok') });
    await new OpenAIProvider(KEY).generate(simpleArgs);
    expect(calls[0].body.tools).toBeUndefined();
    expect(calls[0].body.tool_choice).toBeUndefined();
  });

  it('sends attached images instead of silently dropping them', async () => {
    // Every OpenAI catalog entry advertises `image_understanding`, so an image
    // block has to survive the portable→OpenAI translation. This previously
    // flattened the message to its text blocks: the model answered about a photo
    // it was never shown, with no error anywhere.
    const calls = stubOpenAI({ json: textReply('a receipt') });
    await new OpenAIProvider(KEY).generate({
      ...simpleArgs,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
          ],
        },
      ],
    });

    const parts = calls[0].body.messages[1].content as Array<Record<string, unknown>>;
    expect(Array.isArray(parts)).toBe(true);
    expect(parts).toContainEqual({ type: 'text', text: 'what is this?' });
    expect(parts).toContainEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,QUJD' },
    });
  });

  it('keeps the plain string form for a text-only multi-block message', async () => {
    const calls = stubOpenAI({ json: textReply('ok') });
    await new OpenAIProvider(KEY).generate({
      ...simpleArgs,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'line one' },
            { type: 'text', text: 'line two' },
          ],
        },
      ],
    });
    expect(calls[0].body.messages[1].content).toBe('line one\nline two');
  });
});

describe('OpenAIProvider — reading the response', () => {
  it('returns text and the provider-reported model and token counts', async () => {
    stubOpenAI({ json: textReply('the answer') });
    const res = await new OpenAIProvider(KEY).generate(simpleArgs);

    expect(res.content).toEqual([{ type: 'text', text: 'the answer' }]);
    expect(res.stopReason).toBe('end_turn');
    expect(res.model).toBe('gpt-5.6-terra');
    expect(res.usage).toEqual({
      inputTokens: 11,
      outputTokens: 22,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
    });
  });

  it('parses tool_calls into tool_use blocks', async () => {
    stubOpenAI({ json: toolReply('lookup', '{"q":"pipes"}') });
    const res = await new OpenAIProvider(KEY).generate(simpleArgs);

    expect(res.stopReason).toBe('tool_use');
    expect(res.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'lookup', input: { q: 'pipes' } },
    ]);
  });

  it('reports a truncated answer as max_tokens, not a normal end of turn', async () => {
    // The caller has to be able to tell "the model finished" from "the model ran
    // out of budget mid-list" — a truncated list is otherwise indistinguishable
    // from a genuinely short one.
    stubOpenAI({ json: textReply('item 1, item 2, ite', 'length') });
    const res = await new OpenAIProvider(KEY).generate(simpleArgs);
    expect(res.stopReason).toBe('max_tokens');
  });

  it('preserves unparseable tool arguments as raw rather than throwing', async () => {
    // A truncated tool payload is not valid JSON. Surfacing it as `{ raw }` keeps
    // the failure inspectable instead of exploding inside the provider.
    stubOpenAI({ json: toolReply('lookup', '{"items":[{"name":"half') });
    const res = await new OpenAIProvider(KEY).generate(simpleArgs);

    expect(res.content[0]).toMatchObject({ type: 'tool_use', name: 'lookup' });
    expect((res.content[0] as { input: { raw: string } }).input.raw).toContain('half');
  });

  it('defaults token counts to zero when the response omits usage', async () => {
    stubOpenAI({ json: { model: 'm', choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] } });
    const res = await new OpenAIProvider(KEY).generate(simpleArgs);
    expect(res.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
    });
  });
});

describe('OpenAIProvider — failure modes', () => {
  it.each([
    ['a rate limit', 429],
    ['a client error', 400],
    ['a server error', 500],
  ])('throws on %s and records the attempt as a failed usage event', async (_label, status) => {
    stubOpenAI({ status, text: 'upstream said no' });
    const events: Array<{ status: string; inputTokens: number }> = [];
    const provider = new OpenAIProvider(KEY, { onUsage: (e) => void events.push(e) });

    await expect(provider.generate(simpleArgs)).rejects.toThrow(`OpenAI HTTP ${status}`);
    // Usage is still recorded, so a failing provider is visible in the usage
    // ledger rather than just absent from it.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'error', inputTokens: 0 });
  });

  it('never puts the API key in the error it throws', async () => {
    // The raw upstream body is echoed into the message — it must never carry the
    // credential with it.
    stubOpenAI({ status: 401, text: `Incorrect API key provided: ${KEY}. Check your key.` });
    const provider = new OpenAIProvider(KEY);

    const err = await provider.generate(simpleArgs).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(KEY);
    expect((err as Error).stack ?? '').not.toContain(KEY);
  });

  it('keeps working when the usage recorder itself throws', async () => {
    stubOpenAI({ json: textReply('still fine') });
    const provider = new OpenAIProvider(KEY, {
      onUsage: () => {
        throw new Error('usage sink is down');
      },
    });
    const res = await provider.generate(simpleArgs);
    expect(res.content).toEqual([{ type: 'text', text: 'still fine' }]);
  });

  it('reports itself unavailable without a key', () => {
    expect(new OpenAIProvider('').isAvailable()).toBe(false);
    expect(new OpenAIProvider(KEY).isAvailable()).toBe(true);
  });
});

describe('OpenAIProvider.generateStructured', () => {
  const structuredArgs = {
    model: 'gpt-5.6-terra',
    systemPrompt: 'extract',
    userPrompt: 'the document',
    schema: { type: 'object', properties: { total: { type: 'number' } } },
  };

  it('forces the structured_output tool and returns its parsed input', async () => {
    const calls = stubOpenAI({ json: toolReply('structured_output', '{"total":42}') });
    const out = await new OpenAIProvider(KEY).generateStructured<{ total: number }>(structuredArgs);

    expect(out).toEqual({ total: 42 });
    expect(calls[0].body.tool_choice).toEqual({
      type: 'function',
      function: { name: 'structured_output' },
    });
    expect(calls[0].body.tools?.[0].function.parameters).toEqual(structuredArgs.schema);
  });

  it('recovers a JSON object the model wrapped in prose instead of the tool', async () => {
    stubOpenAI({ json: textReply('Sure! Here you go: {"total":7} — let me know.') });
    const out = await new OpenAIProvider(KEY).generateStructured<{ total: number }>(structuredArgs);
    expect(out).toEqual({ total: 7 });
  });

  it('throws a provider-specific error when JSON was demanded and none came back', async () => {
    stubOpenAI({ json: textReply('I am not going to answer that.') });
    await expect(
      new OpenAIProvider(KEY).generateStructured(structuredArgs)
    ).rejects.toThrow(/did not return structured tool output/i);
  });

  it('propagates a malformed JSON object found in prose rather than returning a partial', async () => {
    // Truncated JSON in the text fallback must fail loudly; returning half an
    // object would look like a successful short extraction.
    stubOpenAI({ json: textReply('here: {"items":[{"name":"a"},{"nam') });
    await expect(new OpenAIProvider(KEY).generateStructured(structuredArgs)).rejects.toThrow();
  });

  it('asks for a token budget large enough for a many-item list', async () => {
    // `maxTokens` too low silently truncated multi-item JSON here before.
    const calls = stubOpenAI({ json: toolReply('structured_output', '{"total":1}') });
    await new OpenAIProvider(KEY).generateStructured({ ...structuredArgs, maxTokens: 8192 });
    expect(calls[0].body.max_completion_tokens).toBe(8192);
  });
});

describe('OpenAIProvider — report pipeline methods', () => {
  it('extractFindings requests a large budget and unwraps the findings array', async () => {
    const calls = stubOpenAI({
      json: toolReply('structured_output', '{"findings":[{"title":"Roof"},{"title":"Furnace"}]}'),
    });
    const findings = await new OpenAIProvider(KEY).extractFindings({
      chunks: [{ chunk_index: 0, page_number: 3, section_type: 'Roof', content: 'shingles curling' }],
      promptVersion: 'v1',
    });

    expect(findings).toHaveLength(2);
    // A findings list is long — the budget must not be the 4096 default.
    expect(calls[0].body.max_completion_tokens).toBe(8192);
    // The chunk text and its page marker actually reach the prompt.
    const userTurn = calls[0].body.messages[1].content as string;
    expect(userTurn).toContain('shingles curling');
    expect(userTurn).toContain('Page 3');
  });

  it('extractFindings degrades to an empty list instead of throwing when the provider fails', async () => {
    stubOpenAI({ status: 500, text: 'boom' });
    const findings = await new OpenAIProvider(KEY).extractFindings({ chunks: [], promptVersion: 'v1' });
    expect(findings).toEqual([]);
  });

  it('generateSummary returns a neutral fallback summary when the provider fails', async () => {
    stubOpenAI({ status: 503, text: 'unavailable' });
    const summary = await new OpenAIProvider(KEY).generateSummary({
      findings: [],
      reportMetadata: {
        filename: 'r.pdf',
        page_count: null,
        property_address: null,
        inspection_date: null,
        inspector_name: null,
      },
      promptVersion: 'v1',
    });

    // A friendly, member-safe sentence — never the upstream error text.
    expect(summary.overall_condition).toBe('fair');
    expect(summary.executive_summary).not.toMatch(/unavailable|http|error/i);
  });

  it('generateActionPlans returns an empty plan list when the provider fails', async () => {
    stubOpenAI({ status: 500, text: 'boom' });
    const plans = await new OpenAIProvider(KEY).generateActionPlans({
      findings: [],
      timeframes: ['0-30_days'],
      country: 'CA',
      promptVersion: 'v1',
    });
    expect(plans).toEqual([]);
  });
});
