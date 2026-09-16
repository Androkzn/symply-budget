/**
 * The assistant's writes, where they actually land.
 *
 * Two claims are worth holding down here, and they are the two that make this
 * design defensible rather than merely clever:
 *
 *  1. **Every action goes through `homeProjectsApi`.** That is the whole reason
 *     the write happens on the device: the facade routes to the on-device
 *     ledger for a local-first household and to the Worker otherwise, and every
 *     rollup, budget-line derivation and activity entry hangs off it. A test
 *     that let a runner call `apiClient` directly would let that guarantee rot.
 *  2. **An ambiguous target is refused, never guessed.** Editing the wrong
 *     material is the failure mode with no error and no moment of discovery —
 *     the member finds out weeks later that the oak they priced is now the trim.
 */
import {
  ChatActionError,
  resolveRow,
  runChatActions,
} from '../homeProjectActionRunner';
import { parseChatActions, chatActionActor } from '../types';

jest.mock('@api/home-projects', () => ({
  homeProjectKeys: {
    all: (h: string) => ['home-projects', h],
    hub: (p: string) => ['home-project', p],
    activity: (p: string) => ['home-project-activity', p],
  },
  homeProjectsApi: {
    getHub: jest.fn(),
    createSelection: jest.fn(),
    updateSelection: jest.fn(),
    deleteSelection: jest.fn(),
    createBudgetLine: jest.fn(),
    updateBudgetLine: jest.fn(),
    createPhase: jest.fn(),
    createBlocker: jest.fn(),
    updateBlocker: jest.fn(),
    createTask: jest.fn(),
    update: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { homeProjectsApi } = require('@api/home-projects');

const HID = 'hh_1';
const PID = 'proj_kitchen';

const hub = {
  selections: [
    { id: 'sel_aaaaaa11', name: 'Herringbone Oak' },
    { id: 'sel_bbbbbb22', name: 'Oak trim' },
  ],
  budget_lines: [{ id: 'bl_cccccc33', label: 'Labour' }],
  blockers: [{ id: 'blk_dddd44', title: 'Permit not issued' }],
};

function action(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'a1',
    kind: 'add_material',
    project_id: PID,
    args: { name: 'Oak' },
    summary: 'Add Oak',
    confirm: false,
    ...over,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  homeProjectsApi.getHub.mockResolvedValue(hub);
});

describe('resolveRow', () => {
  const rows = [
    { id: 'sel_aaaaaa11', label: 'Herringbone Oak' },
    { id: 'sel_bbbbbb22', label: 'Oak trim' },
  ];

  it('matches the ref the brief printed', () => {
    expect(resolveRow(rows, { ref: 'sel_aa' }, 'material').id).toBe('sel_aaaaaa11');
  });

  it('falls back to an exact name when the ref has gone stale', () => {
    // A row renamed or replaced since the brief was written: the ref matches
    // nothing, but the name the model quoted still does.
    expect(resolveRow(rows, { ref: 'zzzzzz', name: 'Oak trim' }, 'material').id).toBe(
      'sel_bbbbbb22'
    );
  });

  it('matches a unique partial name, case-insensitively', () => {
    expect(resolveRow(rows, { name: 'herringbone' }, 'material').id).toBe('sel_aaaaaa11');
  });

  it('refuses an ambiguous name instead of taking the first', () => {
    expect(() => resolveRow(rows, { name: 'oak' }, 'material')).toThrow(ChatActionError);
    expect(() => resolveRow(rows, { name: 'oak' }, 'material')).toThrow(/matches 2 materials/i);
  });

  it('refuses a name that is not there, in words a member can read', () => {
    expect(() => resolveRow(rows, { name: 'Marble' }, 'material')).toThrow(
      /no material called “Marble”/i
    );
  });
});

describe('runChatActions', () => {
  it('adds a material through the facade, not through a chat-specific path', async () => {
    const results = await runChatActions(HID, [action()]);
    expect(results).toEqual([{ id: 'a1', ok: true }]);
    expect(homeProjectsApi.createSelection).toHaveBeenCalledWith(HID, PID, { name: 'Oak' });
    // A plain add needs no hub read — the commonest case stays one call.
    expect(homeProjectsApi.getHub).not.toHaveBeenCalled();
  });

  it('resolves a ref against the hub before updating', async () => {
    await runChatActions(HID, [
      action({ kind: 'update_material', target: { ref: 'sel_bb' }, args: { qty: 4 } }),
    ]);
    expect(homeProjectsApi.updateSelection).toHaveBeenCalledWith(HID, PID, 'sel_bbbbbb22', {
      qty: 4,
    });
  });

  it('reads the hub once for several actions on one project', async () => {
    await runChatActions(HID, [
      action({ id: 'a1', kind: 'update_material', target: { ref: 'sel_aa' }, args: { qty: 1 } }),
      action({ id: 'a2', kind: 'update_material', target: { ref: 'sel_bb' }, args: { qty: 2 } }),
    ]);
    expect(homeProjectsApi.getHub).toHaveBeenCalledTimes(1);
  });

  it('routes each kind to its own facade method', async () => {
    await runChatActions(HID, [
      action({ id: '1', kind: 'add_budget_line', args: { label: 'L', category: 'labor' } }),
      action({ id: '2', kind: 'add_phase', args: { title: 'Demo' } }),
      action({ id: '3', kind: 'add_blocker', args: { title: 'Wet wall' } }),
      action({ id: '4', kind: 'add_task', args: { title: 'Call inspector' } }),
      action({ id: '5', kind: 'update_project', args: { status: 'on_hold' } }),
      action({ id: '6', kind: 'remove_material', target: { ref: 'sel_aa' }, args: {} }),
      action({ id: '7', kind: 'resolve_blocker', target: { ref: 'blk_dd' }, args: { status: 'resolved' } }),
      action({ id: '8', kind: 'update_budget_line', target: { ref: 'bl_cccc' }, args: { actualCents: 100 } }),
    ]);

    expect(homeProjectsApi.createBudgetLine).toHaveBeenCalled();
    expect(homeProjectsApi.createPhase).toHaveBeenCalled();
    expect(homeProjectsApi.createBlocker).toHaveBeenCalled();
    expect(homeProjectsApi.createTask).toHaveBeenCalled();
    expect(homeProjectsApi.update).toHaveBeenCalledWith(HID, PID, { status: 'on_hold' });
    expect(homeProjectsApi.deleteSelection).toHaveBeenCalledWith(HID, PID, 'sel_aaaaaa11');
    expect(homeProjectsApi.updateBlocker).toHaveBeenCalledWith(HID, PID, 'blk_dddd44', {
      status: 'resolved',
    });
    expect(homeProjectsApi.updateBudgetLine).toHaveBeenCalledWith(HID, PID, 'bl_cccccc33', {
      actualCents: 100,
    });
  });

  it('carries on after one failure — three asks should not be lost to one bad price', async () => {
    homeProjectsApi.createSelection
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({});

    const results = await runChatActions(HID, [
      action({ id: 'a1', args: { name: 'Oak' } }),
      action({ id: 'a2', args: { name: 'Tile' } }),
    ]);

    expect(results[0]).toMatchObject({ id: 'a1', ok: false });
    expect(results[1]).toMatchObject({ id: 'a2', ok: true });
    // A transport failure is phrased for a member, not surfaced as "boom".
    expect(results[0].error).toMatch(/didn't save/i);
  });

  it('reports a resolution failure in the words resolveRow chose', async () => {
    const [result] = await runChatActions(HID, [
      action({ kind: 'update_material', target: { name: 'Marble' }, args: { qty: 1 } }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no material called “Marble”/i);
  });
});

describe('parseChatActions', () => {
  it('reads a well-formed envelope', () => {
    const parsed = parseChatActions({
      actions: [{ id: 'x', kind: 'add_material', project_id: PID, args: { name: 'Oak' }, summary: 'Add Oak', confirm: false }],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].confirm).toBe(false);
  });

  it('drops what it cannot run rather than half-running it', () => {
    expect(
      parseChatActions({
        actions: [
          { kind: 'delete_household', project_id: PID }, // not a kind we know
          { kind: 'add_material' }, // no project
          'nonsense',
          null,
        ],
      })
    ).toEqual([]);
  });

  it('defaults a malformed confirm flag to needing a tap', () => {
    const [a] = parseChatActions({
      actions: [{ kind: 'add_material', project_id: PID, args: {} }],
    });
    expect(a.confirm).toBe(true);
  });

  it('is inert on an ordinary message', () => {
    expect(parseChatActions(null)).toEqual([]);
    expect(parseChatActions({ ui: [] })).toEqual([]);
    expect(chatActionActor({ ui: [] })).toBeNull();
  });
});
