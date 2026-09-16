/**
 * Re-planning a project that already exists (BRD §12 Q2, and SP-15).
 *
 * With generation split from storage, a "draft" is just a project whose
 * visibility is `draft` — so regenerate-keeping-edits and re-plan-a-published-
 * project are the same operation, and this is it.
 *
 * The risk being tested is duplication. A member re-plans a shed that already
 * has "Insulate walls" on it, the model returns "Wall insulation", and the
 * project now carries the same work twice. In a household-shared project that
 * is a deletion somebody has to notice first, so the server drops the duplicate
 * itself rather than trusting the prompt — and says so in `dropped`, because a
 * phase that silently vanishes is its own bug.
 *
 * The opposite error matters just as much: "Insulate walls" and "Insulate
 * ceiling" share a trade and are different work. Merging them would quietly
 * remove a room's worth of insulation from the plan.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { buildSmartProjectUserPrompt } from '../../../ai/prompts/smart-project';
import type { Env } from '../../../types';

let generateCalls = 0;
let responses: unknown[] = [];
/** The prompt text the fake model was handed, so the re-plan framing is checkable. */
let lastUserText = '';

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
    generate: async (req: {
      messages: Array<{ content: Array<{ type: string; text?: string }> }>;
    }) => {
      const text = req.messages[0]?.content.find(b => b.type === 'text');
      lastUserText = text?.text ?? '';
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

const DESCRIPTION =
  'I have a shed with a roof, walls and a concrete floor, but inside it is ' +
  'just bare frame. I want to turn it into a woodworking shop.';

const BASE = {
  householdId: 'hh_test',
  userId: 'user_test',
  description: DESCRIPTION,
  spaces: [],
  attachmentR2Keys: [],
};

/** Minimum valid generation — every other field has a schema default. */
function generationWith(phaseTitles: string[]): Record<string, unknown> {
  return {
    title: 'Shed workshop',
    phases: phaseTitles.map((title, i) => ({
      title,
      sort_order: i,
      depends_on: [],
    })),
  };
}

beforeEach(() => {
  generateCalls = 0;
  responses = [];
  lastUserText = '';
});

describe('re-plan — duplicate phases', () => {
  it('drops a phase the project already has, however it is worded', async () => {
    responses = [generationWith(['Wall insulation'])];

    const plan = await generateSmartProjectPlan(testEnv, {
      ...BASE,
      existing: {
        title: 'Shed conversion',
        phases: [{ title: 'Insulate walls', status: 'pending' }],
      },
    });

    expect(plan).not.toBeNull();
    expect(plan!.phases).toHaveLength(0);
    // Reported, not silently swallowed — review has to be able to explain it.
    expect(plan!.dropped).toEqual([
      { title: 'Wall insulation', because: 'Already on this project as "Insulate walls"' },
    ]);
  });

  it('keeps work the existing plan does not cover', async () => {
    responses = [generationWith(['Dust extraction ducting'])];

    const plan = await generateSmartProjectPlan(testEnv, {
      ...BASE,
      existing: {
        title: 'Shed conversion',
        phases: [{ title: 'Insulate walls', status: 'pending' }],
      },
    });

    expect(plan!.phases.map(p => p.title)).toEqual(['Dust extraction ducting']);
    expect(plan!.dropped).toEqual([]);
  });

  it('does NOT merge the same trade on a different surface', async () => {
    // The failure this guards: dropping the ceiling because the walls are done
    // takes a room's worth of insulation out of the plan, and nothing says so.
    responses = [generationWith(['Insulate ceiling'])];

    const plan = await generateSmartProjectPlan(testEnv, {
      ...BASE,
      existing: {
        title: 'Shed conversion',
        phases: [{ title: 'Insulate walls', status: 'pending' }],
      },
    });

    expect(plan!.phases.map(p => p.title)).toEqual(['Insulate ceiling']);
    expect(plan!.dropped).toEqual([]);
  });

  it('suppresses a duplicate of COMPLETED work too', async () => {
    responses = [generationWith(['Pour concrete slab'])];

    const plan = await generateSmartProjectPlan(testEnv, {
      ...BASE,
      existing: {
        title: 'Shed conversion',
        phases: [{ title: 'Concrete slab', status: 'done' }],
      },
    });

    expect(plan!.phases).toHaveLength(0);
    expect(plan!.dropped[0]!.because).toContain('Concrete slab');
  });

  it('returning nothing is a legitimate answer', async () => {
    responses = [generationWith(['Wall insulation', 'Electrical rough-in'])];

    const plan = await generateSmartProjectPlan(testEnv, {
      ...BASE,
      existing: {
        title: 'Shed conversion',
        phases: [
          { title: 'Insulate walls', status: 'pending' },
          { title: 'Rough-in electrical', status: 'pending' },
        ],
      },
    });

    // "Your plan already covers this" is useful; padding it would not be.
    expect(plan!.phases).toHaveLength(0);
    expect(plan!.dropped).toHaveLength(2);
  });

  it('leaves a FIRST draft alone — nothing to duplicate', async () => {
    responses = [generationWith(['Insulate walls', 'Wall insulation'])];

    const plan = await generateSmartProjectPlan(testEnv, BASE);

    // Both survive: without an existing project there is no basis to call
    // either one a duplicate, and this path must not change for a new draft.
    expect(plan!.phases).toHaveLength(2);
    expect(plan!.dropped).toEqual([]);
  });
});

describe('re-plan — what the model is told', () => {
  it('says this is not a new project, and splits done from outstanding', () => {
    const prompt = buildSmartProjectUserPrompt({
      description: DESCRIPTION,
      photoCount: 0,
      existing: {
        title: 'Shed conversion',
        phases: [
          { title: 'Concrete slab', status: 'done' },
          { title: 'Insulate walls', status: 'pending' },
        ],
      },
    });

    expect(prompt).toContain('This is NOT a new project');
    expect(prompt).toContain('Shed conversion');
    expect(prompt).toMatch(/already COMPLETED:[^\n]*Concrete slab/);
    expect(prompt).toMatch(/still outstanding:[^\n]*Insulate walls/);
    expect(prompt).toContain('Returning nothing is a valid');
  });

  it('a first draft keeps its original closing instruction', () => {
    const prompt = buildSmartProjectUserPrompt({
      description: DESCRIPTION,
      photoCount: 0,
    });

    expect(prompt).not.toContain('This is NOT a new project');
    expect(prompt).toContain('Record what already exists first');
  });

  it('reaches the model, not just the builder', async () => {
    responses = [generationWith([])];

    await generateSmartProjectPlan(testEnv, {
      ...BASE,
      existing: {
        title: 'Shed conversion',
        phases: [{ title: 'Insulate walls', status: 'pending' }],
      },
    });

    expect(lastUserText).toContain('This is NOT a new project');
  });
});
