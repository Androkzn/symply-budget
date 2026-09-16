/**
 * BooksGemini structured-output client — coverage for
 * `services/kaizen/books/gemini.ts`.
 *
 * The only network boundary is `ai/gemini-sdk-client`, which we replace with a
 * `vi.mock` factory (hoisted mock fns) so nothing leaves the isolate.
 *
 * Asserts: a fenced ```json stream parses+validates; a malformed first response
 * is fixed via the one repair call; both-fail throws BooksAiError; a transport
 * failure is wrapped in BooksAiError.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { streamMock, generateMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  generateMock: vi.fn(),
}));

vi.mock('../../../../ai/gemini-sdk-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../ai/gemini-sdk-client')>();
  return {
    ...actual,
    createGeminiClient: vi.fn(() => ({})),
    getGeminiModel: vi.fn(() => ({})),
    accumulateStreamText: streamMock,
    generateText: generateMock,
  };
});

import { BooksGemini, BooksAiError, BOOKS_GEMINI_MODEL } from '../gemini';

const schema = z.object({ ok: z.boolean(), title: z.string() });

beforeEach(() => {
  streamMock.mockReset();
  generateMock.mockReset();
});

describe('BooksGemini', () => {
  it('exposes the stable Flash model id', () => {
    expect(BOOKS_GEMINI_MODEL).toBe('gemini-flash-latest');
  });

  it('parses + validates a fenced ```json streamed response (no repair)', async () => {
    streamMock.mockResolvedValue('```json\n{"ok": true, "title": "Chapter 1"}\n```');

    const out = await new BooksGemini('k').generateStructured('prompt', schema);

    expect(out).toEqual({ ok: true, title: 'Chapter 1' });
    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('repairs a malformed first response via the single repair path', async () => {
    streamMock.mockResolvedValue('this is not json at all');
    generateMock.mockResolvedValue('```json\n{"ok": false, "title": "Fixed"}\n```');

    const out = await new BooksGemini('k').generateStructured('prompt', schema);

    expect(out).toEqual({ ok: false, title: 'Fixed' });
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('throws BooksAiError when both the response and the repair fail schema validation', async () => {
    streamMock.mockResolvedValue('garbage, not json');
    generateMock.mockResolvedValue('still not json');

    await expect(new BooksGemini('k').generateStructured('prompt', schema)).rejects.toBeInstanceOf(
      BooksAiError,
    );
  });

  it('wraps a streaming transport failure in BooksAiError', async () => {
    streamMock.mockRejectedValue(new Error('network boom'));

    await expect(new BooksGemini('k').generateStructured('prompt', schema)).rejects.toBeInstanceOf(
      BooksAiError,
    );
  });
});
