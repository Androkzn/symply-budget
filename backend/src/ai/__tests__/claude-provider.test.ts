/**
 * ClaudeProvider — the single `createMessage` chokepoint must route to the real
 * Anthropic client exactly once. Regression guard for the recursion bug where
 * `createMessage` awaited `this.createMessage(...)` (itself) instead of
 * `this.client.messages.create(...)`, which threw
 * `RangeError: Maximum call stack size exceeded` on EVERY AI call (budget
 * insights, briefings, digests, action plans, …).
 */
import { describe, it, expect, vi } from 'vitest';

import { ClaudeProvider } from '../claude-provider';

function fakeMessage(model = 'claude-test') {
  return {
    model,
    content: [{ type: 'tool_use', id: 't1', name: 'output', input: { ok: true } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 5, output_tokens: 7 },
  };
}

function fakeTextMessage(text = '{}', model = 'claude-test') {
  return {
    model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 5, output_tokens: 7 },
  };
}

/** base64 of a minimal JPEG header (FF D8 FF ...). */
const JPEG_B64 = btoa(
  String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0, 0, 0, 0, 0, 0, 0)
);

function withMockClient(provider: ClaudeProvider) {
  const create = vi.fn(async () => fakeMessage());
  (provider as unknown as { client: { messages: { create: unknown } } }).client = {
    messages: { create },
  };
  return create;
}

describe('ClaudeProvider.createMessage', () => {
  it('routes generate() to client.messages.create exactly once (no self-recursion)', async () => {
    const provider = new ClaudeProvider('test-key');
    const create = withMockClient(provider);

    const res = await provider.generate({
      model: 'm',
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(res.model).toBe('claude-test');
  });

  it('generateStructured returns the tool_use input via a single client call', async () => {
    const provider = new ClaudeProvider('test-key');
    const create = withMockClient(provider);

    const out = await provider.generateStructured<{ ok: boolean }>({
      model: 'm',
      systemPrompt: 's',
      userPrompt: 'u',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    });

    expect(out).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('ClaudeProvider.generateFromMediaContent media-type sniffing', () => {
  it('corrects a wrong declared media type (png declared, jpeg bytes) before sending to Anthropic', async () => {
    const provider = new ClaudeProvider('test-key');
    const create = vi.fn(async () => fakeTextMessage('{"closing_balance": 1}'));
    (provider as unknown as { client: { messages: { create: unknown } } }).client = {
      messages: { create },
    };

    // Declared image/png, but the base64 is actually JPEG — the historical 400.
    await provider.generateFromMediaContent({
      systemPrompt: 's',
      userText: 'u',
      media: { base64: JPEG_B64, mediaType: 'image/png' },
    });

    expect(create).toHaveBeenCalledTimes(1);
    const params = (create.mock.calls[0] as unknown[])[0] as {
      messages: { content: Array<{ type: string; source?: { media_type: string } }> }[];
    };
    const block = params.messages[0].content[0];
    // Routed as an image with the SNIFFED type, not the declared png.
    expect(block.type).toBe('image');
    expect(block.source?.media_type).toBe('image/jpeg');
  });
});

/**
 * Reading the model's answer out of `content`.
 *
 * These lock two shapes that used to be read as `content[0]`: an EMPTY content
 * array (a refusal, or `max_tokens` hit before any block was emitted), which
 * threw a raw TypeError; and a `thinking` block ahead of the real answer, which
 * silently produced '' and surfaced to members as "couldn't read that document".
 */
describe('ClaudeProvider — locating the text answer in the response', () => {
  function providerReturning(content: unknown[], stopReason = 'end_turn') {
    const provider = new ClaudeProvider('test-key');
    const create = vi.fn(async () => ({
      model: 'claude-test',
      content,
      stop_reason: stopReason,
      usage: { input_tokens: 1, output_tokens: 2 },
    }));
    (provider as unknown as { client: { messages: { create: unknown } } }).client = {
      messages: { create },
    };
    return provider;
  }

  const media = { base64: JPEG_B64, mediaType: 'image/jpeg' as const };

  it('returns an empty string, not a crash, when the model returned no content', async () => {
    const provider = providerReturning([], 'max_tokens');
    await expect(
      provider.generateFromMediaContent({ systemPrompt: 's', userText: 'u', media })
    ).resolves.toMatchObject({ text: '' });
  });

  it('finds the answer when a thinking block comes first', async () => {
    const provider = providerReturning([
      { type: 'thinking', thinking: 'let me look at the totals' },
      { type: 'text', text: '{"amount": 12}' },
    ]);
    const { text } = await provider.generateFromMediaContent({
      systemPrompt: 's',
      userText: 'u',
      media,
    });
    expect(text).toBe('{"amount": 12}');
  });

  it('joins multiple text blocks rather than keeping only the first', async () => {
    const provider = providerReturning([
      { type: 'text', text: 'part one' },
      { type: 'text', text: 'part two' },
    ]);
    const { text } = await provider.generateFromMediaContent({
      systemPrompt: 's',
      userText: 'u',
      media,
    });
    expect(text).toBe('part one\npart two');
  });

  it('does not crash generateJSON when the model returned no content', async () => {
    const provider = providerReturning([], 'max_tokens');
    // '' is not JSON, so this must be a parse failure — never a TypeError about
    // reading 'type' of undefined.
    const err = await provider
      .generateJSON({ systemPrompt: 's', userPrompt: 'u' })
      .catch((e: Error) => e);
    expect((err as Error).message).not.toMatch(/Cannot read propert/i);
  });
});

describe('ClaudeProvider.generate — failure and truncation', () => {
  function providerWith(create: ReturnType<typeof vi.fn>) {
    const provider = new ClaudeProvider('test-key');
    (provider as unknown as { client: { messages: { create: unknown } } }).client = {
      messages: { create },
    };
    return provider;
  }

  const args = {
    model: 'claude-test',
    systemPrompt: 's',
    messages: [{ role: 'user' as const, content: 'hi' }],
  };

  it('surfaces a truncated answer as max_tokens so a short list is distinguishable', async () => {
    const provider = providerWith(
      vi.fn(async () => ({
        model: 'claude-test',
        content: [{ type: 'text', text: '[{"a":1},{"b"' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 1, output_tokens: 2 },
      }))
    );
    const res = await provider.generate(args);
    expect(res.stopReason).toBe('max_tokens');
  });

  it('propagates a provider error instead of returning an empty result', async () => {
    const provider = providerWith(
      vi.fn(async () => {
        throw Object.assign(new Error('rate_limit_error'), { status: 429 });
      })
    );
    await expect(provider.generate(args)).rejects.toThrow(/rate_limit_error/);
  });

  it('records token usage for a successful call', async () => {
    const events: Array<{ provider: string; status: string; model: string }> = [];
    const provider = new ClaudeProvider('test-key', { onUsage: (e) => void events.push(e) });
    (provider as unknown as { client: { messages: { create: unknown } } }).client = {
      messages: {
        create: vi.fn(async () => ({
          model: 'claude-real',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4,
          },
        })),
      },
    };

    await provider.generate(args);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-real',
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 3,
      // No `cache_creation` breakdown on the response, so the whole write is
      // attributed to the 5-minute default TTL.
      cacheWrite5mTokens: 4,
      cacheWrite1hTokens: 0,
      status: 'ok',
    });
  });

  it('never lets a failing usage recorder break the AI call', async () => {
    const provider = new ClaudeProvider('test-key', {
      onUsage: () => {
        throw new Error('usage sink is down');
      },
    });
    (provider as unknown as { client: { messages: { create: unknown } } }).client = {
      messages: { create: vi.fn(async () => fakeTextMessage('ok')) },
    };
    await expect(provider.generate(args)).resolves.toMatchObject({ stopReason: 'end_turn' });
  });
});

describe('ClaudeProvider.generateWithWebSearch', () => {
  /** Queue of replies, one per sampling iteration. */
  function providerReturningSequence(replies: unknown[]) {
    const provider = new ClaudeProvider('test-key');
    let i = 0;
    const create = vi.fn(async () => replies[Math.min(i++, replies.length - 1)]);
    (provider as unknown as { client: { messages: { create: unknown } } }).client = {
      messages: { create },
    };
    return { provider, create };
  }

  const paused = {
    model: 'claude-test',
    content: [{ type: 'text', text: 'searching…' }],
    stop_reason: 'pause_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  const finished = {
    model: 'claude-test',
    content: [{ type: 'text', text: '{"municipality":"Surrey"}' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 2, output_tokens: 3 },
  };

  it('resumes after a pause_turn and returns the final answer', async () => {
    const { provider, create } = providerReturningSequence([paused, finished]);
    const res = await provider.generateWithWebSearch({ systemPrompt: 's', userPrompt: 'u' });

    expect(create).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('{"municipality":"Surrey"}');
    expect(res.stopReason).toBe('end_turn');
  });

  it('stops at maxIterations instead of looping forever on a stuck pause_turn', async () => {
    const { provider, create } = providerReturningSequence([paused]);
    const res = await provider.generateWithWebSearch({
      systemPrompt: 's',
      userPrompt: 'u',
      maxIterations: 3,
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(res.stopReason).toBe('pause_turn');
  });

  it('returns on the first reply when the model never pauses', async () => {
    const { provider, create } = providerReturningSequence([finished]);
    await provider.generateWithWebSearch({ systemPrompt: 's', userPrompt: 'u' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

/**
 * Streamed transport — opted into per call with `onToolJsonDelta`, for a slow
 * extraction that must report progress. The contract is that the caller cannot
 * tell the transports apart: same assembled result, same usage row.
 */
describe('ClaudeProvider streaming (onToolJsonDelta)', () => {
  /** Anthropic's event sequence for one forced tool call, split across deltas. */
  function toolStream(fragments: string[], stopReason = 'tool_use') {
    return [
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          model: 'claude-test',
          usage: { input_tokens: 11, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't1', name: 'output' },
      },
      ...fragments.map((partial_json) => ({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json },
      })),
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: 42 },
      },
      { type: 'message_stop' },
    ];
  }

  function withStream(provider: ClaudeProvider, events: unknown[]) {
    const create = vi.fn(async () => ({
      async *[Symbol.asyncIterator]() {
        for (const event of events) yield event;
      },
    }));
    (provider as unknown as { client: { messages: { create: unknown } } }).client = {
      messages: { create },
    };
    return create;
  }

  it('assembles the streamed tool JSON into the same result as a buffered call', async () => {
    const provider = new ClaudeProvider('test-key');
    const create = withStream(provider, toolStream(['{"items":[{"raw', '_name":"MILK"}]}']));
    const seen: string[] = [];

    const res = await provider.generate({
      model: 'm',
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'hi' }],
      onToolJsonDelta: (json) => seen.push(json),
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0] as unknown as [{ stream?: boolean }])[0].stream).toBe(true);
    expect(res.content).toEqual([
      { type: 'tool_use', id: 't1', name: 'output', input: { items: [{ raw_name: 'MILK' }] } },
    ]);
    expect(res.stopReason).toBe('tool_use');
    // The callback sees a growing prefix — that is what makes item counting work.
    expect(seen).toEqual(['{"items":[{"raw', '{"items":[{"raw_name":"MILK"}]}']);
  });

  it('reports usage from the stream: inputs from message_start, outputs from message_delta', async () => {
    const onUsage = vi.fn();
    const provider = new ClaudeProvider('test-key', { onUsage });
    withStream(provider, toolStream(['{}']));

    const res = await provider.generate({
      model: 'm',
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'hi' }],
      onToolJsonDelta: () => {},
    });

    expect(res.usage).toMatchObject({ inputTokens: 11, outputTokens: 42 });
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage.mock.calls[0][0]).toMatchObject({
      provider: 'anthropic',
      inputTokens: 11,
      outputTokens: 42,
      status: 'ok',
    });
  });

  it('surfaces a truncated tool call as max_tokens rather than throwing', async () => {
    // The caller retries on `max_tokens` with a bigger budget; a parse throw
    // here would turn a recoverable long receipt into a hard failure.
    const provider = new ClaudeProvider('test-key');
    withStream(provider, toolStream(['{"items":[{"raw_name":"MI'], 'max_tokens'));

    const res = await provider.generate({
      model: 'm',
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'hi' }],
      onToolJsonDelta: () => {},
    });

    expect(res.stopReason).toBe('max_tokens');
    expect(res.content).toEqual([]);
  });

  it('stays on the buffered transport when no progress callback is given', async () => {
    const provider = new ClaudeProvider('test-key');
    const create = withMockClient(provider);

    await provider.generate({ model: 'm', systemPrompt: 's', messages: [{ role: 'user', content: 'hi' }] });

    expect((create.mock.calls[0] as unknown as [{ stream?: boolean }])[0].stream).toBeUndefined();
  });
});
