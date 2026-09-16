/**
 * "What should we draft?" — the wizard's last step, end to end through the
 * generator.
 *
 * The member ticks steps, tasks and materials independently, and the promise on
 * that screen is absolute: *we only add what you tick*. Two things have to be
 * true for it to hold, and each fails differently.
 *
 * 1. **The model is told.** A model that is not asked for materials still
 *    produces the best plan it can, which includes them — so the instruction is
 *    checked against the prompt text, both the positive half and the negative.
 * 2. **The result is filtered anyway.** An instruction is a request. This is
 *    the case that actually reaches a member: the model returns the section
 *    regardless, and the rows land in a project as things they have to delete
 *    one at a time, having explicitly said they did not want them.
 *
 * Also pinned here: what a member can NEVER untick. The as-is record is why a
 * phase was skipped — the review banner renders it — and blockers are questions
 * asked back at them. Neither is a suggestion, and a draft that swallows a
 * safety question because somebody wanted a shorter list is the one failure
 * mode in this feature that could hurt someone.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { Env } from '../../../types';

let responses: unknown[] = [];
let generateCalls = 0;
/** The prompt the fake model was handed, so the instruction is checkable. */
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
      lastUserText =
        req.messages[0]?.content.find(b => b.type === 'text')?.text ?? '';
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

const BASE = {
  householdId: 'hh_test',
  userId: 'user_test',
  description:
    'I have a shed with a roof, walls and a concrete floor, but inside it is ' +
    'just bare frame. I want to turn it into a woodworking shop.',
  spaces: [
    {
      label: 'Shed',
      length_m: 5,
      width_m: 3,
      height_m: 2.5,
    },
  ],
  attachmentR2Keys: [],
};

/**
 * A model that answered with EVERYTHING, whatever it was asked for.
 *
 * That is the point of the fixture: the filter is what the member is relying
 * on, so every test here feeds the same over-generous payload and varies only
 * the tick boxes.
 */
const EVERYTHING = {
  title: 'Shed to workshop',
  as_is: [
    { element: 'roof', state: 'present', evidence: 'has a roof' },
    { element: 'insulation', state: 'absent', evidence: 'stud cavities open' },
  ],
  phases: [
    { title: 'Ventilation', sort_order: 0, depends_on: [] },
    { title: 'Insulation', sort_order: 1, depends_on: ['Ventilation'] },
  ],
  surfaces: [
    { name: 'Walls', kind: 'wall' },
    { name: 'Ceiling', kind: 'ceiling' },
  ],
  materials: [
    {
      label: 'Mineral wool batts',
      surface_name: 'Walls',
      coverage_per_unit: 5.6,
      coverage_unit: 'm2',
    },
    { label: 'Expanding foam', unit: 'can' },
  ],
  tasks: [
    { title: 'Shed — fit the gable vents', phase_title: 'Ventilation' },
    { title: 'Shed — insulate the walls', phase_title: 'Insulation' },
  ],
  blockers: [
    { title: 'Passive vents or a powered fan?', severity: 'medium' },
  ],
};

beforeEach(() => {
  generateCalls = 0;
  responses = [EVERYTHING];
  lastUserText = '';
});

describe('the model is told what the member ticked', () => {
  it('names what was asked for and what was not', async () => {
    await generateSmartProjectPlan(testEnv, {
      ...BASE,
      include: { phases: true, tasks: false, materials: false },
    });

    expect(lastUserText).toContain('The member asked for');
    expect(lastUserText).toContain('the phases of work');
    // The negative half matters as much: a model told only what to include
    // still volunteers the rest.
    expect(lastUserText).toContain('did NOT ask for');
    expect(lastUserText).toContain('empty array');
  });

  it('says nothing was declined when all three are ticked', async () => {
    await generateSmartProjectPlan(testEnv, {
      ...BASE,
      include: { phases: true, tasks: true, materials: true },
    });

    expect(lastUserText).toContain('The member asked for');
    expect(lastUserText).not.toContain('did NOT ask for');
  });

  it('defaults to all three when the client does not send one', async () => {
    await generateSmartProjectPlan(testEnv, BASE);

    expect(lastUserText).not.toContain('did NOT ask for');
  });
});

describe('a section the member unticked never reaches the project', () => {
  it('drops materials and their surfaces when only steps were wanted', async () => {
    const plan = await generateSmartProjectPlan(testEnv, {
      ...BASE,
      include: { phases: true, tasks: false, materials: false },
    });

    expect(plan).not.toBeNull();
    expect(plan!.phases.map(p => p.title)).toEqual(['Ventilation', 'Insulation']);
    expect(plan!.generation.tasks).toEqual([]);
    expect(plan!.generation.materials).toEqual([]);
    // Surfaces go with materials: an option group with an area and nothing to
    // buy against it is an empty container on the project.
    expect(plan!.surfaces).toEqual([]);
  });

  it('drops phases and tasks when only the shopping list was wanted', async () => {
    const plan = await generateSmartProjectPlan(testEnv, {
      ...BASE,
      include: { phases: false, tasks: false, materials: true },
    });

    expect(plan!.phases).toEqual([]);
    expect(plan!.generation.tasks).toEqual([]);
    expect(plan!.generation.materials).toHaveLength(2);
    // The areas still come out of the member's own measurements, which is the
    // whole reason a material carries coverage rather than a quantity.
    expect(plan!.surfaces.map(s => s.kind).sort()).toEqual(['ceiling', 'wall']);
  });

  it('keeps everything the member left ticked', async () => {
    const plan = await generateSmartProjectPlan(testEnv, {
      ...BASE,
      include: { phases: true, tasks: true, materials: true },
    });

    expect(plan!.phases).toHaveLength(2);
    expect(plan!.generation.tasks).toHaveLength(2);
    expect(plan!.generation.materials).toHaveLength(2);
  });
});

describe('what a member cannot untick', () => {
  /**
   * Both survive an empty selection, which is not reachable from the wizard —
   * it requires one — but is expressible on the wire, and the answer has to be
   * a thin draft rather than a silent one.
   */
  it('still records what they already have, and still asks its questions', async () => {
    const plan = await generateSmartProjectPlan(testEnv, {
      ...BASE,
      include: { phases: false, tasks: false, materials: false },
    });

    expect(plan).not.toBeNull();
    expect(plan!.generation.as_is).toHaveLength(2);
    expect(plan!.blockers.map(b => b.title)).toContain(
      'Passive vents or a powered fan?',
    );
    expect(plan!.generation.title).toBe('Shed to workshop');
  });
});
