/**
 * Offline harness for services that talk to Anthropic.
 *
 * IMPORTANT: the `@anthropic-ai/sdk` client binds `fetch` at module import, so
 * `vi.stubGlobal('fetch', …)` does NOT intercept it — a test that constructs a
 * ClaudeProvider and calls it will make a REAL request to api.anthropic.com.
 * Everything here intercepts one level lower, at `Messages.prototype.create`,
 * which is below `ClaudeProvider.createMessage` and therefore still exercises
 * all of the provider's request-building logic (media-type sniffing, cache
 * blocks, tool choice) while never touching the network.
 */
import Anthropic from '@anthropic-ai/sdk';
import { vi, type MockInstance } from 'vitest';

export type AnthropicSpy = MockInstance<
  (params: Anthropic.Messages.MessageCreateParamsNonStreaming) => Promise<unknown>
>;

/** A `messages.create` reply carrying a single text block. */
export function anthropicText(text: string, over?: Record<string, unknown>) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-test',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 200 },
    ...over,
  };
}

/** A `messages.create` reply carrying a single tool_use block. */
export function anthropicToolUse(name: string, input: unknown) {
  return anthropicText('', {
    content: [{ type: 'tool_use', id: 'tool_1', name, input }],
    stop_reason: 'tool_use',
  });
}

/**
 * Replace the Anthropic transport for the duration of a test. Returns the spy so
 * assertions can read the params that WOULD have been sent.
 */
export function stubAnthropic(reply: unknown): AnthropicSpy {
  return vi
    .spyOn(Anthropic.Messages.prototype, 'create')
    .mockResolvedValue(reply as never) as unknown as AnthropicSpy;
}

/** Replace the Anthropic transport with a failure. */
export function stubAnthropicFailure(error: unknown): AnthropicSpy {
  return vi
    .spyOn(Anthropic.Messages.prototype, 'create')
    .mockRejectedValue(error as never) as unknown as AnthropicSpy;
}

/** The content blocks of the first user message the provider built. */
export function sentContentBlocks(spy: AnthropicSpy): Array<Record<string, unknown>> {
  const params = spy.mock.calls[0]?.[0] as Anthropic.Messages.MessageCreateParamsNonStreaming;
  const content = params?.messages?.[0]?.content;
  return Array.isArray(content) ? (content as unknown as Array<Record<string, unknown>>) : [];
}

/** The first media (image/document) block the provider built, if any. */
export function sentMediaBlock(
  spy: AnthropicSpy
): { type: string; source: { media_type: string; data: string } } | undefined {
  return sentContentBlocks(spy).find((b) => b.type === 'image' || b.type === 'document') as
    | { type: string; source: { media_type: string; data: string } }
    | undefined;
}

/** Base64 of a real JPEG header (FF D8 FF …) — bytes that say "jpeg". */
export const JPEG_BYTES_B64 = btoa(
  String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0, 0, 0, 0, 0, 0, 0)
);

/** Base64 of a real PNG header (89 50 4E 47 0D 0A 1A 0A …). */
export const PNG_BYTES_B64 = btoa(
  String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0)
);

/** Base64 of a real PDF header ("%PDF-1.4"). */
export const PDF_BYTES_B64 = btoa('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj\n');
