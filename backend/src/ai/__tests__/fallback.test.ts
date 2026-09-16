/**
 * fallback.ts — plan §B10
 *
 * Covers: primary succeeds → no retry; model_not_found → retry once with
 * fallback; non-eligible error → propagates.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  generateStructuredWithFallback,
  generateWithFallback,
} from '../fallback';
import type { AIProvider, GenerateResult } from '../provider';

function okResponse(model: string): GenerateResult {
  return {
    content: [{ type: 'text', text: 'ok' }],
    model,
    stopReason: 'end_turn',
  } as GenerateResult;
}

describe('generateWithFallback', () => {
  it('returns the primary result without retry when primary succeeds', async () => {
    const generate = vi.fn(async (args: { model: string }) => okResponse(args.model));
    const provider = { generate, generateStructured: vi.fn() } as unknown as AIProvider;
    const res = await generateWithFallback(
      provider,
      'claude-sonnet-test',
      'claude-fallback-test',
      {
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      }
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(res.model).toBe('claude-sonnet-test');
  });

  it('retries once with fallback on model_not_found', async () => {
    let call = 0;
    const generate = vi.fn(async (args: { model: string }) => {
      call += 1;
      if (call === 1) {
        const e = new Error('model not found') as Error & { type?: string };
        e.type = 'model_not_found';
        throw e;
      }
      return okResponse(args.model);
    });
    const provider = { generate, generateStructured: vi.fn() } as unknown as AIProvider;
    const res = await generateWithFallback(
      provider,
      'claude-sonnet-test',
      'claude-fallback-test',
      {
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      }
    );
    expect(generate).toHaveBeenCalledTimes(2);
    expect(res.model).toBe('claude-fallback-test');
  });

  it('retries once with fallback on HTTP 404 (sdk status)', async () => {
    let call = 0;
    const generate = vi.fn(async (args: { model: string }) => {
      call += 1;
      if (call === 1) {
        const e = new Error('404') as Error & { status?: number };
        e.status = 404;
        throw e;
      }
      return okResponse(args.model);
    });
    const provider = { generate, generateStructured: vi.fn() } as unknown as AIProvider;
    const res = await generateWithFallback(
      provider,
      'claude-sonnet-test',
      'claude-fallback-test',
      {
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      }
    );
    expect(res.model).toBe('claude-fallback-test');
  });

  it('propagates non-eligible errors without retry', async () => {
    const generate = vi.fn(async () => {
      throw new Error('network timeout');
    });
    const provider = { generate, generateStructured: vi.fn() } as unknown as AIProvider;
    await expect(
      generateWithFallback(
        provider,
        'claude-sonnet-test',
        'claude-fallback-test',
        {
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'hi' }],
        }
      )
    ).rejects.toThrow(/network timeout/);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe('generateStructuredWithFallback', () => {
  it('retries once with fallback on not_entitled', async () => {
    let call = 0;
    const generateStructured = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        const e = new Error('not entitled') as Error & { type?: string };
        e.type = 'not_entitled';
        throw e;
      }
      return { ok: true };
    });
    const provider = {
      generate: vi.fn(),
      generateStructured,
    } as unknown as AIProvider;
    const res = await generateStructuredWithFallback<{ ok: boolean }>(
      provider,
      'claude-sonnet-test',
      'claude-fallback-test',
      {
        systemPrompt: 'sys',
        userPrompt: 'user',
        schema: { type: 'object' },
      }
    );
    expect(res.ok).toBe(true);
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });
});
