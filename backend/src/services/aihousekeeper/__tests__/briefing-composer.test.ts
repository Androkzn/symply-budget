/**
 * briefing-composer.ts — plan §B3
 *
 * Covers:
 *  - composed branch (compose_briefing tool call parses correctly)
 *  - empty branch (empty_briefing tool call)
 *  - retry once on malformed output → returns empty with 'malformed_output'
 */

import { describe, it, expect, vi } from 'vitest';

import type { AIProvider, GenerateResult } from '../../../ai/provider';
import type { Env } from '../../../types';
import { BriefingComposer } from '../briefing-composer';
import type { BriefingDeps } from '../briefing-composer';

function mkEnv(): Env {
  return {
    AIHOUSEKEEPER_BRIEFING_MODEL: 'claude-sonnet-test',
    AIHOUSEKEEPER_NUDGE_MODEL: 'claude-haiku-test',
    AIHOUSEKEEPER_FALLBACK_MODEL: 'claude-fallback-test',
  } as unknown as Env;
}

function mkDeps(): BriefingDeps {
  return {
    listOverdueTasks: vi.fn(async () => [
      { id: 't1', title: 'Change furnace filter', category: 'hvac', dueDate: '2026-04-20' },
    ]),
    listAppointments: vi.fn(async () => []),
    getWeather: vi.fn(async () => ({ summary: 'Clear', highC: 12, lowC: 2 })),
    topMaintenanceSuggestion: vi.fn(async () => null),
    listOpenQuestions: vi.fn(async () => []),
    listRecentHistory: vi.fn(async () => []),
  };
}

function toolUseResponse(name: string, input: unknown): GenerateResult {
  return {
    content: [{ type: 'tool_use', id: 'tu_01', name, input: input as Record<string, unknown> }],
    model: 'claude-sonnet-test',
    stopReason: 'tool_use',
  } as unknown as GenerateResult;
}

function textResponse(text: string): GenerateResult {
  return {
    content: [{ type: 'text', text }],
    model: 'claude-sonnet-test',
    stopReason: 'end_turn',
  } as unknown as GenerateResult;
}

describe('BriefingComposer', () => {
  it('returns composed result on a valid compose_briefing tool call', async () => {
    const ai: AIProvider = {
      generate: vi.fn(async () =>
        toolUseResponse('compose_briefing', {
          paragraph: "Good morning! There's 1 overdue task today.",
          bullets: ['Change furnace filter (hvac, overdue)'],
          source_signals: [{ kind: 'task', ref: 't1' }],
        })
      ),
      generateStructured: vi.fn(async () => ({})),
    } as unknown as AIProvider;

    const composer = new BriefingComposer({ ai, env: mkEnv(), deps: mkDeps() });
    const result = await composer.composeFor('hh_brief_01', '2026-04-23');
    expect(result.kind).toBe('composed');
    if (result.kind === 'composed') {
      expect(result.paragraph).toContain('Good morning');
      expect(result.bullets.length).toBe(1);
    }
  });

  it('returns empty result on a valid empty_briefing tool call', async () => {
    const ai: AIProvider = {
      generate: vi.fn(async () =>
        toolUseResponse('empty_briefing', {
          reason: 'no_signals',
          source_signals: [],
        })
      ),
      generateStructured: vi.fn(async () => ({})),
    } as unknown as AIProvider;

    const composer = new BriefingComposer({ ai, env: mkEnv(), deps: mkDeps() });
    const result = await composer.composeFor('hh_brief_02', '2026-04-23');
    expect(result.kind).toBe('empty');
    if (result.kind === 'empty') expect(result.reason).toBe('no_signals');
  });

  it('retries once on malformed output; second failure → empty with malformed_output reason', async () => {
    const ai: AIProvider = {
      // Both attempts return plain text (no tool_use) — composer should retry
      // exactly once then default to empty with reason 'malformed_output'.
      generate: vi.fn(async () => textResponse('no tool call here')),
      generateStructured: vi.fn(async () => ({})),
    } as unknown as AIProvider;

    const composer = new BriefingComposer({ ai, env: mkEnv(), deps: mkDeps() });
    const result = await composer.composeFor('hh_brief_03', '2026-04-23');
    expect(ai.generate).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe('empty');
    if (result.kind === 'empty') expect(result.reason).toBe('malformed_output');
  });
});
