/**
 * The House assistant's write tools.
 *
 * These tools are unusual in that they DO nothing — every one returns an
 * envelope for the client to perform, because a home project is Tier A and the
 * Worker cannot reach its rows. That makes the contract, rather than any
 * database effect, the whole of the behaviour, and these are the parts of it
 * that would fail silently if they broke:
 *
 *  1. **The right project.** A material chat's writes must land on its PARENT.
 *     Getting this wrong writes to a project id that is really a material id —
 *     which 404s at best and, on a ledger, creates an orphan at worst.
 *  2. **Confirm is set where it must be.** `confirm: false` on a delete means
 *     the assistant silently removes a member's material. There is no undo.
 *  3. **Dollars become cents.** An off-by-100 on a price is the kind of bug that
 *     survives review and shows up as a $1,068 material costing $10.68.
 *  4. **No tools outside a project.** In the household's general chat there is
 *     nothing to write to, and offering the verbs there teaches the model to
 *     call them.
 *  5. **A refusal is a sentence.** Every failure path is read by the model and
 *     relayed to a member, so it must be prose, not an error code.
 */
import { describe, expect, it } from 'vitest';

import {
  buildHouseAction,
  houseActionTools,
  isHouseActionTool,
  resolveActionSubject,
} from '../chat/house-assistant-actions';

const PROJECT_SUBJECT = {
  type: 'home_project',
  id: 'proj_kitchen',
  label: 'Kitchen Reno',
  parentId: null,
  parentLabel: null,
};

const MATERIAL_SUBJECT = {
  type: 'home_project_material',
  id: 'sel_abc123def',
  label: 'Herringbone Oak',
  parentId: 'proj_kitchen',
  parentLabel: 'Kitchen Reno',
};

const project = () => resolveActionSubject(PROJECT_SUBJECT)!;
const material = () => resolveActionSubject(MATERIAL_SUBJECT)!;

describe('resolveActionSubject', () => {
  it('reads a project room as its own project', () => {
    expect(resolveActionSubject(PROJECT_SUBJECT)).toMatchObject({
      projectId: 'proj_kitchen',
      materialRef: null,
    });
  });

  it("reads a material room as its PARENT project, not the material's id", () => {
    const resolved = resolveActionSubject(MATERIAL_SUBJECT);
    expect(resolved?.projectId).toBe('proj_kitchen');
    // The material becomes the implicit target instead — as a ref, matching the
    // six-character handle the grounding brief prints.
    expect(resolved?.materialRef).toBe('sel_ab');
  });

  it('refuses a room that is about nothing, and one whose parent is missing', () => {
    expect(resolveActionSubject(null)).toBeNull();
    expect(
      resolveActionSubject({ ...MATERIAL_SUBJECT, parentId: null })
    ).toBeNull();
  });
});

describe('houseActionTools', () => {
  it('offers the write verbs only where there is a project to write to', () => {
    expect(houseActionTools(null)).toEqual([]);
    const names = houseActionTools(project()).map((t) => t.name);
    expect(names).toContain('add_material');
    expect(names).toContain('remove_material');
    expect(names.every(isHouseActionTool)).toBe(true);
  });
});

describe('add_material', () => {
  it('converts dollars to cents and targets the room’s project', () => {
    const { action } = buildHouseAction(
      project(),
      {
        name: 'add_material',
        input: {
          name: 'Herringbone white oak',
          qty: 12,
          unit: 'box',
          unit_price: 89,
          vendor: 'Home Depot',
          coverage_per_unit: 20,
          coverage_unit: 'sqft',
        },
      },
      1
    );

    expect(action).toBeDefined();
    expect(action!.project_id).toBe('proj_kitchen');
    expect(action!.args).toMatchObject({
      name: 'Herringbone white oak',
      qty: 12,
      unit: 'box',
      unitPriceCents: 8900,
      vendor: 'Home Depot',
      coveragePerUnit: 20,
      coverageUnit: 'sqft',
    });
    // Additive — it runs without a tap.
    expect(action!.confirm).toBe(false);
    // The summary is what the member reads on the card: 12 × $89.
    expect(action!.summary).toContain('$1,068');
  });

  it('drops a coverage figure with no unit rather than guessing one', () => {
    const { action } = buildHouseAction(
      project(),
      { name: 'add_material', input: { name: 'Underlay', coverage_per_unit: 100 } },
      1
    );
    expect(action!.args).not.toHaveProperty('coveragePerUnit');
  });

  it('answers a nameless material with a sentence, not an action', () => {
    const { result, action } = buildHouseAction(project(), { name: 'add_material', input: {} }, 1);
    expect(action).toBeUndefined();
    expect(result).toMatch(/needs a name/i);
  });
});

describe('update_material', () => {
  it('takes the material chat’s own subject as the implicit target', () => {
    const { action } = buildHouseAction(
      material(),
      { name: 'update_material', input: { qty: 14 } },
      1
    );
    expect(action!.target).toMatchObject({ ref: 'sel_ab', name: 'Herringbone Oak' });
    expect(action!.args).toEqual({ qty: 14 });
  });

  it('sends ONLY the fields the model supplied, so a patch stays a patch', () => {
    const { action } = buildHouseAction(
      project(),
      { name: 'update_material', input: { ref: 'a1b2c3', unit_price: 12.5 } },
      1
    );
    expect(action!.args).toEqual({ unitPriceCents: 1250 });
  });

  it('refuses when it cannot tell which material is meant', () => {
    const { result, action } = buildHouseAction(
      project(),
      { name: 'update_material', input: { qty: 3 } },
      1
    );
    expect(action).toBeUndefined();
    expect(result).toMatch(/which material/i);
  });
});

describe('destructive and overwriting writes are confirmed', () => {
  it('remove_material waits for a tap', () => {
    const { action, result } = buildHouseAction(
      material(),
      { name: 'remove_material', input: {} },
      1
    );
    expect(action!.confirm).toBe(true);
    // The model must not tell the member it is already done.
    expect(result).toMatch(/confirm/i);
    expect(result).not.toMatch(/^Done/);
  });

  it('update_project waits for a tap', () => {
    const { action } = buildHouseAction(
      project(),
      { name: 'update_project', input: { status: 'on_hold' } },
      1
    );
    expect(action!.confirm).toBe(true);
    expect(action!.args).toEqual({ status: 'on_hold' });
  });

  it('maps project fields onto the facade’s own patch shape', () => {
    const { action } = buildHouseAction(
      project(),
      { name: 'update_project', input: { target_budget: 42000, target_end_date: '2026-11-01' } },
      1
    );
    expect(action!.args).toEqual({ targetBudgetCents: 4200000, targetEndAt: '2026-11-01' });
  });

  it('ignores a date that is not a date', () => {
    const { result } = buildHouseAction(
      project(),
      { name: 'update_project', input: { target_end_date: 'next spring' } },
      1
    );
    expect(result).toMatch(/nothing to change/i);
  });
});

describe('budget lines', () => {
  it('requires a known category and at least one figure', () => {
    expect(
      buildHouseAction(project(), { name: 'add_budget_line', input: { label: 'x', category: 'vibes', estimate: 10 } }, 1)
        .result
    ).toMatch(/category must be one of/i);
    expect(
      buildHouseAction(project(), { name: 'add_budget_line', input: { label: 'x', category: 'labor' } }, 1).result
    ).toMatch(/estimate or an actual/i);
  });

  it('records what something actually cost', () => {
    const { action } = buildHouseAction(
      project(),
      { name: 'add_budget_line', input: { label: 'Mold remediation', category: 'labor', actual: 1450 } },
      1
    );
    expect(action!.args).toEqual({ label: 'Mold remediation', category: 'labor', actualCents: 145000 });
  });
});

describe('a chat with no project', () => {
  it('explains itself rather than producing an unaddressed write', () => {
    const { result, action } = buildHouseAction(
      null,
      { name: 'add_material', input: { name: 'Oak' } },
      1
    );
    expect(action).toBeUndefined();
    expect(result).toMatch(/not attached to a project/i);
  });
});

describe('action ids', () => {
  it('are unique within a reply, so the client can dedupe per action', () => {
    const a = buildHouseAction(project(), { name: 'add_material', input: { name: 'Oak' } }, 1);
    const b = buildHouseAction(project(), { name: 'add_material', input: { name: 'Tile' } }, 2);
    expect(a.action!.id).not.toBe(b.action!.id);
  });
});
