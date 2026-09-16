/**
 * Saving a generated plan as a real project.
 *
 * The server thinks and this function stores, so everything a member ends up
 * looking at is written here — and anything it forgets to pass on is simply
 * gone, with no error anywhere and a plausible-looking project to hide it.
 * Two things were being dropped on the floor:
 *
 *  1. **Coverage.** The model is asked for `coverage_per_unit` precisely
 *     because it is a property of the product rather than a claim about this
 *     room, and it is what turns the member's own measured area into "17
 *     sheets". Written without it, every drafted material arrived as a name
 *     with no quantity against it — the server had derived 42.1 m² of wall and
 *     the member still had to work out how many boards that is.
 *
 *  2. **Tasks.** The plan has carried them since the first version and nothing
 *     ever wrote them. Invisible while nobody asked for them; a broken promise
 *     the moment the wizard put a tick box on the screen.
 *
 * Asserted against the HTTP bodies rather than a mocked facade: the facade is
 * a Proxy that routes per household, and what actually has to be right is the
 * request that leaves this module.
 */
import { apiClient } from '../client';
import { materializeSmartProjectPlan, type SmartProjectPlan } from '../home-projects';

jest.mock('../client', () => ({
  apiClient: { post: jest.fn(), put: jest.fn(), get: jest.fn(), delete: jest.fn() },
}));

const post = apiClient.post as jest.Mock;
const put = apiClient.put as jest.Mock;

const HID = 'hh_1';

/** Every POST this call made to a path ending in `suffix`, as bodies. */
const bodiesFor = (suffix: string) =>
  post.mock.calls
    .filter(([url]: [string]) => String(url).endsWith(suffix))
    .map(([, body]: [string, unknown]) => body);

function plan(overrides: Partial<SmartProjectPlan['generation']> = {}): SmartProjectPlan {
  return {
    generation: {
      title: 'Shed to workshop',
      type: 'renovation',
      summary: 'Line and insulate the shed.',
      as_is: [],
      materials: [],
      tasks: [],
      confidence: 'medium',
      ...overrides,
    },
    surfaces: [],
    phases: [],
    dropped: [],
    blockers: [],
    roomModels: [],
    photosRead: 0,
  } as SmartProjectPlan;
}

beforeEach(() => {
  post.mockReset();
  put.mockReset();
  // The project itself is the only write that may throw; everything else is
  // best-effort, so the default response has to satisfy the create.
  post.mockImplementation(async (url: string) => {
    if (url.endsWith('/option-groups')) {
      return { data: { option_group: { id: 'grp_walls' } } };
    }
    if (/home-projects$/.test(url)) {
      return { data: { project: { id: 'prj_1', title: 'Shed to workshop' } } };
    }
    return { data: {} };
  });
  put.mockResolvedValue({ data: {} });
});

describe('a material keeps the coverage its quantity comes from', () => {
  it('passes coverage through for an area material, linked to its surface', async () => {
    await materializeSmartProjectPlan(
      HID,
      {
        ...plan({
          materials: [
            {
              label: 'OSB sheathing panel',
              surface_name: 'Walls',
              category: 'panel',
              unit: 'sheet',
              coverage_per_unit: 2.98,
              coverage_unit: 'm2',
              confidence: 'high',
            },
          ],
        }),
        surfaces: [
          {
            name: 'Walls',
            kind: 'wall',
            category: 'finish',
            area_m2: 42.1,
            waste_factor_pct: 10,
          },
        ],
      },
      undefined,
    );

    const [material] = bodiesFor('/selections') as Array<Record<string, unknown>>;
    expect(material).toMatchObject({
      name: 'OSB sheathing panel',
      unit: 'sheet',
      coveragePerUnit: 2.98,
      coverageUnit: 'm2',
      // Hung off the surface it goes on, so the area and the coverage meet.
      optionGroupId: 'grp_walls',
    });
    // No price, ever. The member supplies every number.
    expect(material).not.toHaveProperty('unitPriceCents');
  });

  /**
   * `lm` and `each` are legitimate answers — skirting is bought by the metre
   * and a window one at a time — and neither is an AREA. Stored in
   * `coverage_unit` they look meaningful to a reader and are rejected by every
   * consumer, which is worse than being absent.
   */
  it('leaves a non-area coverage unit off rather than storing a unit nothing reads', async () => {
    await materializeSmartProjectPlan(
      HID,
      plan({
        materials: [
          {
            label: 'Expanding foam',
            category: 'sealant',
            unit: 'can',
            coverage_per_unit: 12,
            coverage_unit: 'lm',
            confidence: 'medium',
          },
        ],
      }),
      undefined,
    );

    const [material] = bodiesFor('/selections') as Array<Record<string, unknown>>;
    expect(material).toMatchObject({ name: 'Expanding foam', unit: 'can' });
    expect(material).not.toHaveProperty('coveragePerUnit');
    expect(material).not.toHaveProperty('coverageUnit');
  });

  it('writes a consumable with no surface at all, unattached', async () => {
    await materializeSmartProjectPlan(
      HID,
      plan({
        materials: [
          { label: 'Duct clamps', category: 'fixings', unit: 'each', confidence: 'medium' },
        ],
      }),
      undefined,
    );

    const [material] = bodiesFor('/selections') as Array<Record<string, unknown>>;
    expect(material).toMatchObject({ name: 'Duct clamps' });
    expect(material.optionGroupId).toBeUndefined();
  });

  /**
   * `createSelection` PREPENDS — a material a member adds by hand belongs at
   * the top of the list, not under a plan they have already read. This loop is
   * the one caller that must opt out of that: it writes a plan a row at a
   * time, and prepending each row would hand the member the plan backwards.
   */
  it('states each material’s position, so the plan is not written backwards', async () => {
    await materializeSmartProjectPlan(
      HID,
      plan({
        materials: [
          { label: 'OSB panels', category: 'sheet', unit: 'sheet', confidence: 'high' },
          { label: 'Screws', category: 'fixings', unit: 'box', confidence: 'high' },
          { label: 'Primer', category: 'paint', unit: 'can', confidence: 'medium' },
        ],
      }),
      undefined,
    );

    const materials = bodiesFor('/selections') as Array<Record<string, unknown>>;
    expect(materials.map(m => [m.name, m.sortOrder])).toEqual([
      ['OSB panels', 0],
      ['Screws', 1],
      ['Primer', 2],
    ]);
  });
});

describe('tasks reach the project', () => {
  it('creates one per generated task, carrying its reason', async () => {
    await materializeSmartProjectPlan(
      HID,
      plan({
        tasks: [
          {
            title: 'Shed — foam the window perimeter',
            rationale: 'Before the inner wall goes on, or you cannot reach it.',
          },
          { title: 'Shed — insulate the walls' },
        ],
      }),
      undefined,
    );

    expect(bodiesFor('/tasks')).toEqual([
      {
        title: 'Shed — foam the window perimeter',
        description: 'Before the inner wall goes on, or you cannot reach it.',
      },
      { title: 'Shed — insulate the walls', description: undefined },
    ]);
  });

  /**
   * The section the member unticked is empty by the time it gets here — the
   * server strips it — so this function writes nothing rather than deciding
   * again. Pinned because a second copy of that decision on this side is
   * exactly what would drift.
   */
  it('writes nothing when the plan carries nothing', async () => {
    await materializeSmartProjectPlan(HID, plan(), undefined);

    expect(bodiesFor('/tasks')).toEqual([]);
    expect(bodiesFor('/selections')).toEqual([]);
    expect(bodiesFor('/phases')).toEqual([]);
  });
});

describe('the member can see it happening, and hear when it did not', () => {
  /**
   * The count is known BEFORE the first write, which is the whole point — a
   * progress line that discovers its own total as it goes is a spinner with
   * extra steps.
   */
  it('reports a total up front and counts every row', async () => {
    const seen: Array<{ done: number; total: number; failed: number }> = [];

    await materializeSmartProjectPlan(
      HID,
      {
        ...plan({
          materials: [
            { label: 'Batts', category: 'insulation', unit: 'bag', confidence: 'medium' },
            { label: 'Foam', category: 'sealant', unit: 'can', confidence: 'medium' },
          ],
          tasks: [{ title: 'Insulate the walls' }],
        }),
        phases: [{ title: 'Insulation', sort_order: 0 }],
        blockers: [{ title: 'Vapour barrier?', severity: 'medium' }],
      },
      undefined,
      { onProgress: p => seen.push({ ...p }) },
    );

    // 1 phase + 2 materials + 1 task + 1 blocker.
    expect(seen).toHaveLength(5);
    expect(seen.every(p => p.total === 5)).toBe(true);
    expect(seen.map(p => p.done)).toEqual([1, 2, 3, 4, 5]);
    expect(seen[seen.length - 1].failed).toBe(0);
  });

  /**
   * A connection that drops halfway leaves a project quietly missing half its
   * shopping list, and nothing on the screen reads as wrong. The count is what
   * lets the wizard say so instead of the member finding out at the merchant.
   */
  it('counts what did not land, so the loss can be said out loud', async () => {
    post.mockImplementation(async (url: string) => {
      if (/home-projects$/.test(url)) {
        return { data: { project: { id: 'prj_1', title: 'Shed to workshop' } } };
      }
      if (url.endsWith('/selections')) throw new Error('offline');
      return { data: {} };
    });

    let last = { done: 0, total: 0, failed: 0 };
    await materializeSmartProjectPlan(
      HID,
      plan({
        materials: [
          { label: 'Batts', category: 'insulation', unit: 'bag', confidence: 'medium' },
          { label: 'Foam', category: 'sealant', unit: 'can', confidence: 'medium' },
        ],
        tasks: [{ title: 'Insulate the walls' }],
      }),
      undefined,
      { onProgress: p => (last = p) },
    );

    expect(last).toEqual({ done: 3, total: 3, failed: 2 });
  });
});

describe('one failed child does not cost the member the project', () => {
  it('keeps going after a material fails, and still returns the project', async () => {
    post.mockImplementation(async (url: string) => {
      if (/home-projects$/.test(url)) {
        return { data: { project: { id: 'prj_1', title: 'Shed to workshop' } } };
      }
      if (url.endsWith('/selections')) throw new Error('offline');
      return { data: {} };
    });

    const project = await materializeSmartProjectPlan(
      HID,
      plan({
        materials: [
          { label: 'Batts', category: 'insulation', unit: 'bag', confidence: 'medium' },
        ],
        tasks: [{ title: 'Insulate the walls' }],
      }),
      undefined,
    );

    expect(project.id).toBe('prj_1');
    // The task after the failed material still went out.
    expect(bodiesFor('/tasks')).toHaveLength(1);
  });
});
