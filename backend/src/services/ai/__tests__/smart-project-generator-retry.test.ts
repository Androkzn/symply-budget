/**
 * The generator's retry on a malformed plan.
 *
 * `generateWithFallback` swaps MODELS when one errors. It does nothing for a
 * model that answers successfully with a payload that fails the schema, and
 * that is the failure seen on device: `home-projects-smart-project-ui` sent one
 * shed description three times, drafted twice and 422'd once. Sampling is
 * stochastic, so one bad sample must not cost the member their attempt.
 *
 * What is pinned here is the COUNT, in both directions. One call would mean the
 * retry is gone; three or more would mean a member waits through an escalating
 * pile of model calls for a prompt that is never going to validate.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { Env } from '../../../types';

/** Bumped by the fake adapter on every model call. */
let generateCalls = 0;
/** What the fake model answers with, per call index. */
let responses: unknown[] = [];

vi.mock('../../ai-credential-resolver', () => ({
  resolveProviderApiKey: async () => ({ apiKey: 'test-key', provider: 'anthropic' }),
  hasUsableProviderKey: async () => true,
}));
vi.mock('../../ai-usage-service', () => ({
  usageRecorderFor: () => () => {},
}));
vi.mock('../../../ai/provider-factory', () => ({
  createProviderAdapter: () => ({
    provider: 'anthropic',
    generate: async () => {
      const input = responses[Math.min(generateCalls, responses.length - 1)];
      generateCalls += 1;
      return {
        content: [{ type: 'tool_use', name: 'output', input }],
        stopReason: 'tool_use',
        model: 'test',
      };
    },
  }),
}));

const { generateSmartProjectPlan } = await import('../smart-project-generator');

const testEnv = env as unknown as Env;

const INPUT = {
  householdId: 'hh_test',
  userId: 'user_test',
  description:
    'I have a shed with a roof, walls and a concrete floor, but inside it is ' +
    'just bare frame. I want to turn it into a woodworking shop.',
  spaces: [],
  // Empty on purpose: photo loading needs R2 and is not what this file covers.
  attachmentR2Keys: [],
};

beforeEach(() => {
  generateCalls = 0;
  responses = [];
});

describe('generateSmartProjectPlan — malformed output', () => {
  it('asks the model a SECOND time when the first plan fails the schema', async () => {
    responses = [{ nonsense: true }, { nonsense: true }];

    const plan = await generateSmartProjectPlan(testEnv, INPUT);

    // Still null — two bad samples is the point at which we stop.
    expect(plan).toBeNull();
    // The assertion that matters: it did not give up after one.
    expect(generateCalls).toBe(2);
  });

  it('stops at two attempts rather than retrying indefinitely', async () => {
    responses = [{ nonsense: true }];

    await generateSmartProjectPlan(testEnv, INPUT);

    expect(generateCalls).toBeLessThanOrEqual(2);
  });
});
