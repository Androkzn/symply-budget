/**
 * The media-type sniffing chokepoint, proven per extraction service.
 *
 * Anthropic hard-rejects a declared media type that disagrees with the bytes:
 *   400 invalid_request_error: "media type image/png, but the image appears to
 *   be a image/jpeg image"
 * which reached members as a generic "Could not read that statement". Files
 * saved with a lying extension are common, and every extraction route forwards
 * a CLIENT-declared MIME (from a file extension, or an unreliable picker).
 *
 * So the rule is: no service may send a declared type that the bytes contradict.
 * These tests assert the REQUEST THAT WOULD BE SENT for each service — declaring
 * the wrong type on purpose and requiring the sniffed one on the wire — rather
 * than trusting that the service happens to call the right helper.
 *
 * Both provider entry points are covered: `generateFromMediaContent` (single
 * document/image extraction) and `generate` (message content blocks), because
 * services use both and only the former sniffed originally.
 */
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { ClaudeProvider } from '../../ai/claude-provider';
import type { Env } from '../../types';
import { BillExtractionService } from '../bill-extraction-service';
import { RegisteredStatementExtractionService } from '../registered-statement-extraction-service';

import {
  JPEG_BYTES_B64,
  PDF_BYTES_B64,
  PNG_BYTES_B64,
  anthropicText,
  sentMediaBlock,
  stubAnthropic,
} from './ai-extraction-test-helpers';

const testEnv = { ...env, ANTHROPIC_API_KEY: 'sk-ant-test-key' } as unknown as Env;

/** Enough JSON to satisfy each service's parser. */
const BILL_JSON = JSON.stringify({
  provider: { name: 'BC Hydro', type: 'electricity' },
  billing: { periodStart: '2026-01-01', periodEnd: '2026-01-31', dueDate: '2026-02-15' },
  financial: { amountDue: 120.5 },
});
const REGISTERED_JSON = JSON.stringify({ accounts: [], confidence: 0.9 });

afterEach(() => vi.restoreAllMocks());

describe('media-type chokepoint — every extraction service corrects a lying MIME', () => {
  it.each([
    [
      'utility bill extraction',
      async () => {
        await new BillExtractionService(testEnv).extractFromBase64(JPEG_BYTES_B64, 'image/png');
      },
    ],
    [
      'registered statement extraction',
      async () => {
        await new RegisteredStatementExtractionService(testEnv).extractFromBase64(
          JPEG_BYTES_B64,
          'image/png'
        );
      },
    ],
  ])('%s sends image/jpeg when a .png declaration holds JPEG bytes', async (_name, run) => {
    const spy = stubAnthropic(
      anthropicText(_name.startsWith('utility') ? BILL_JSON : REGISTERED_JSON)
    );

    await run();

    const block = sentMediaBlock(spy);
    expect(block).toBeDefined();
    expect(block!.source.media_type).toBe('image/jpeg');
    expect(block!.type).toBe('image');
  });

  it('routes a document declared as an image to a PDF document block', async () => {
    // The mismatch also breaks document↔image ROUTING: real PDF bytes declared
    // as an image would be sent as an image block and rejected.
    const spy = stubAnthropic(anthropicText(BILL_JSON));
    await new BillExtractionService(testEnv).extractFromBase64(PDF_BYTES_B64, 'image/png');

    const block = sentMediaBlock(spy);
    expect(block!.type).toBe('document');
    expect(block!.source.media_type).toBe('application/pdf');
  });

  it('keeps a correctly declared type untouched', async () => {
    const spy = stubAnthropic(anthropicText(BILL_JSON));
    await new BillExtractionService(testEnv).extractFromBase64(PNG_BYTES_B64, 'image/png');

    const block = sentMediaBlock(spy);
    expect(block!.source.media_type).toBe('image/png');
  });

  it('falls back to the declared type when the bytes are unrecognisable', async () => {
    // Unknown magic bytes must not be "corrected" to a guess — the declared type
    // is still the caller's best information.
    const spy = stubAnthropic(anthropicText(BILL_JSON));
    await new BillExtractionService(testEnv).extractFromBase64(btoa('not a real image at all'), 'image/webp');

    const block = sentMediaBlock(spy);
    expect(block!.source.media_type).toBe('image/webp');
  });
});

describe('media-type chokepoint — the generate() message path', () => {
  // Savings import and receipt scan build image blocks and call `generate`
  // directly, passing the UPLOAD's declared mime. That path did not sniff, so a
  // mislabelled file still 400'd there after the fix landed on the other entry
  // point. Both provider entry points must correct the type.
  const provider = () => new ClaudeProvider('sk-ant-test-key');

  it('corrects an image block whose declared type contradicts its bytes', async () => {
    const spy = stubAnthropic(anthropicText('{}'));
    await provider().generate({
      model: 'claude-test',
      systemPrompt: 's',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: JPEG_BYTES_B64 } },
            { type: 'text', text: 'read this' },
          ],
        },
      ],
    });

    expect(sentMediaBlock(spy)!.source.media_type).toBe('image/jpeg');
  });

  it('corrects every image block in a multi-image message', async () => {
    // A multi-photo receipt is one request; a single bad block fails the whole call.
    const spy = stubAnthropic(anthropicText('{}'));
    await provider().generate({
      model: 'claude-test',
      systemPrompt: 's',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: JPEG_BYTES_B64 } },
            { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: PNG_BYTES_B64 } },
            { type: 'text', text: 'read these' },
          ],
        },
      ],
    });

    const params = spy.mock.calls[0][0];
    const blocks = params.messages[0].content as Array<{ type: string; source?: { media_type: string } }>;
    expect(blocks[0].source!.media_type).toBe('image/jpeg');
    expect(blocks[1].source!.media_type).toBe('image/png');
  });

  it('re-routes a document block that actually holds an image', async () => {
    // Correcting only the media type would leave `{ type: 'document',
    // media_type: 'image/jpeg' }` — still a 400, just a different one. The block
    // kind has to move with the type.
    const spy = stubAnthropic(anthropicText('{}'));
    await provider().generate({
      model: 'claude-test',
      systemPrompt: 's',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: JPEG_BYTES_B64 },
            },
            { type: 'text', text: 'read this' },
          ],
        },
      ] as never,
    });

    const block = sentMediaBlock(spy)!;
    expect(block.type).toBe('image');
    expect(block.source.media_type).toBe('image/jpeg');
  });

  it('re-routes an image block that actually holds a PDF', async () => {
    const spy = stubAnthropic(anthropicText('{}'));
    await provider().generate({
      model: 'claude-test',
      systemPrompt: 's',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PDF_BYTES_B64 } },
            { type: 'text', text: 'read this' },
          ],
        },
      ],
    });

    const block = sentMediaBlock(spy)!;
    expect(block.type).toBe('document');
    expect(block.source.media_type).toBe('application/pdf');
  });

  it('leaves a correctly declared PDF document block untouched', async () => {
    const spy = stubAnthropic(anthropicText('{}'));
    await provider().generate({
      model: 'claude-test',
      systemPrompt: 's',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: PDF_BYTES_B64 },
            },
          ],
        },
      ] as never,
    });

    const block = sentMediaBlock(spy)!;
    expect(block.type).toBe('document');
    expect(block.source.media_type).toBe('application/pdf');
  });

  it('leaves text and tool blocks alone', async () => {
    const spy = stubAnthropic(anthropicText('{}'));
    await provider().generate({
      model: 'claude-test',
      systemPrompt: 's',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'plain text' },
            { type: 'tool_result', tool_use_id: 't1', content: 'done' },
          ],
        },
      ],
    });

    const params = spy.mock.calls[0][0];
    expect(params.messages[0].content).toEqual([
      { type: 'text', text: 'plain text' },
      { type: 'tool_result', tool_use_id: 't1', content: 'done' },
    ]);
  });

  it('leaves a plain string message untouched', async () => {
    const spy = stubAnthropic(anthropicText('{}'));
    await provider().generate({
      model: 'claude-test',
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'just a question' }],
    });

    expect(spy.mock.calls[0][0].messages[0].content).toBe('just a question');
  });
});
