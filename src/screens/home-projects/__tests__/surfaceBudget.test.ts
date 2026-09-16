/**
 * What attaching a material to a surface does to the budget.
 *
 * The promote step this covers replaced one that matched selections **by name**,
 * and every case below is a way that failed a member who was spending real
 * money:
 *
 *  - renaming a finish made the next promote create a second selection and a
 *    second budget line, so the project quietly cost twice as much;
 *  - re-measuring a room never moved the estimate, because the name still
 *    matched and the line was skipped;
 *  - a material attached from the project's OWN list — the whole point of the
 *    feature — came back as a copy of itself.
 *
 * `selectionId` is the link that fixes all three, and these tests are the
 * proof, asserted against a fake backend so the arithmetic is checkable without
 * a Worker or a ledger. The money itself is `computeTakeoff`'s, tested next
 * door in `materialPricing.test.ts`; what is pinned here is that the number the
 * panel shows and the number the budget stores are the same number.
 */
import type {
  HomeProjectBudgetLine,
  HomeProjectOptionGroup,
  HomeProjectSelection,
} from '@api/home-projects';
import {
  computeTakeoff,
  createMaterial,
  createRoomSurfaceModel,
  rectPolygon,
} from '@features/house/surfaces';
import type { Material, RoomSurfaceModel } from '@symply/contracts';

import {
  budgetLabelFor,
  describeBudgetOutcome,
  purchaseQtyFor,
  sendTakeoffToBudget,
  withSelectionLinks,
  type SurfaceBudgetPorts,
} from '../surfaceBudget';

// ---------------------------------------------------------------------------
// A room, and a fake backend
// ---------------------------------------------------------------------------

/**
 * A 4 × 3 m room, floor only, finished in a 600 × 600 tile at $12 a tile.
 *
 * 12 m² of floor, 10% waste, and a 600 mm tile with a 3 mm joint occupies
 * 0.3636 m² — so 37 tiles and $444. Every figure below is that arithmetic, and
 * it is `computeTakeoff` that produces it here rather than the test, because a
 * test that recomputed the price would be asserting its own copy of the rule.
 */
function roomWithTiledFloor(
  over?: Partial<Material>,
  size: { width: number; depth: number } = { width: 4, depth: 3 },
): RoomSurfaceModel {
  const model = createRoomSurfaceModel({
    outline: rectPolygon(0, 0, size.width, size.depth),
    wallHeight_m: 2.4,
  });
  const tile: Material = {
    ...createMaterial({ name: 'Calacatta 600×600', kind: 'tile' }),
    // Fixed, so a room rebuilt at a new size is still finished in the SAME
    // material — which is what re-measuring a room actually is.
    id: 'mt_tile',
    unit_w_mm: 600,
    unit_h_mm: 600,
    groutMm: 3,
    wastePct: 10,
    unitPriceCents: 1200,
    unitLabel: 'tile',
    vendor: 'Tile Depot',
    ...over,
  };
  const floor = model.surfaces.find(surface => surface.kind === 'floor')!;
  return {
    ...model,
    materials: [tile],
    surfaces: model.surfaces.map(surface =>
      // Only the floor is finished; the walls stay undecided, which is also
      // what keeps the takeoff to one line.
      surface.id === floor.id ? { ...surface, materialId: tile.id } : surface,
    ),
  };
}

interface FakeBackend {
  ports: SurfaceBudgetPorts;
  selections: HomeProjectSelection[];
  budgetLines: HomeProjectBudgetLine[];
  calls: string[];
}

function selectionRow(over: Partial<HomeProjectSelection>): HomeProjectSelection {
  return {
    id: 'hpsel_x',
    project_id: 'hp_1',
    name: 'A material',
    category: 'other',
    status: 'idea',
    qty: 1,
    unit: null,
    unit_price_cents: null,
    vendor: null,
    product_url: null,
    notes: null,
    option_group_id: null,
    brand: null,
    sku: null,
    image_url: null,
    coverage_per_unit: null,
    coverage_unit: null,
    specs_json: null,
    color_hex: null,
    list_price_cents: null,
    sale_price_cents: null,
    discount_pct: null,
    sale_ends_at: null,
    extraction_source: 'manual',
    extraction_confidence: null,
    version: 1,
    ...over,
  };
}

/**
 * The two backends' shared behaviour, in twenty lines.
 *
 * The one rule worth reproducing exactly is the auto-minted budget line: both
 * the Worker and the local facade write a `materials` line worth
 * `unit_price_cents × qty` for a priced, ungrouped selection, and they do it
 * inside `createSelection` without returning it. That is the whole reason the
 * promote takes two passes, so a fake that skipped it would test a flow that
 * does not exist.
 */
function fakeBackend(
  seed: {
    selections?: HomeProjectSelection[];
    budgetLines?: HomeProjectBudgetLine[];
  } = {},
): FakeBackend {
  const state: FakeBackend = {
    selections: seed.selections ?? [],
    budgetLines: seed.budgetLines ?? [],
    calls: [],
    ports: undefined as unknown as SurfaceBudgetPorts,
  };
  let nextId = 1;

  state.ports = {
    createSelection: async input => {
      const selection = selectionRow({
        id: `hpsel_new_${nextId++}`,
        name: input.name,
        category: input.category ?? 'other',
        status: input.status ?? 'idea',
        qty: input.qty ?? 1,
        unit: input.unit ?? null,
        unit_price_cents: input.unitPriceCents ?? null,
        vendor: input.vendor ?? null,
        product_url: input.productUrl ?? null,
        sku: input.sku ?? null,
        notes: input.notes ?? null,
        coverage_per_unit: input.coveragePerUnit ?? null,
        coverage_unit: input.coverageUnit ?? null,
      });
      state.selections = [...state.selections, selection];
      state.calls.push(`createSelection:${selection.name}`);
      if (selection.unit_price_cents && selection.unit_price_cents > 0) {
        state.budgetLines = [
          ...state.budgetLines,
          {
            id: `hpbl_auto_${nextId++}`,
            project_id: 'hp_1',
            category: 'materials',
            label: selection.name,
            estimate_cents: selection.unit_price_cents * selection.qty,
            actual_cents: 0,
            selection_id: selection.id,
            version: 1,
          },
        ];
      }
      return { selection };
    },
    updateSelection: async (selectionId, patch) => {
      state.calls.push(`updateSelection:${selectionId}`);
      state.selections = state.selections.map(row =>
        row.id === selectionId
          ? {
              ...row,
              ...(patch.status !== undefined ? { status: patch.status } : {}),
              ...(patch.qty !== undefined ? { qty: patch.qty } : {}),
              ...(patch.unitPriceCents !== undefined
                ? { unit_price_cents: patch.unitPriceCents }
                : {}),
              ...(patch.coveragePerUnit !== undefined
                ? { coverage_per_unit: patch.coveragePerUnit }
                : {}),
            }
          : row,
      );
      return undefined;
    },
    createBudgetLine: async input => {
      state.calls.push(`createBudgetLine:${input.label}`);
      state.budgetLines = [
        ...state.budgetLines,
        {
          id: `hpbl_new_${nextId++}`,
          project_id: 'hp_1',
          category: input.category,
          label: input.label,
          estimate_cents: input.estimateCents,
          actual_cents: 0,
          selection_id: input.selectionId,
          version: 1,
        },
      ];
      return undefined;
    },
    updateBudgetLine: async (lineId, patch) => {
      state.calls.push(`updateBudgetLine:${lineId}`);
      state.budgetLines = state.budgetLines.map(row =>
        row.id === lineId
          ? {
              ...row,
              ...(patch.label !== undefined ? { label: patch.label } : {}),
              ...(patch.estimateCents !== undefined
                ? { estimate_cents: patch.estimateCents }
                : {}),
              version: row.version + 1,
            }
          : row,
      );
      return undefined;
    },
    reload: async () => ({
      selections: state.selections,
      budgetLines: state.budgetLines,
    }),
  };
  return state;
}

async function promote(
  model: RoomSurfaceModel,
  backend: FakeBackend,
  selections: HomeProjectSelection[] = backend.selections,
  optionGroups: HomeProjectOptionGroup[] = [],
) {
  return sendTakeoffToBudget({
    takeoff: computeTakeoff(model),
    model,
    selections,
    optionGroups,
    ports: backend.ports,
  });
}

// ---------------------------------------------------------------------------

describe('a finish that is not in the materials list yet', () => {
  it('adds it once and prices it from the measured floor', async () => {
    const model = roomWithTiledFloor();
    const expected = computeTakeoff(model).lines[0]!;
    const backend = fakeBackend();

    const outcome = await promote(model, backend);

    expect(outcome.created).toBe(1);
    expect(backend.selections).toHaveLength(1);
    // 12 m² + 10% over a 0.3636 m² tile is 37 tiles; the selection carries the
    // purchase count, so a member reading the material card sees what to buy.
    expect(expected.units).toBe(37);
    expect(backend.selections[0]!.qty).toBe(37);
    // The line says what the panel says. That equality is the feature.
    expect(backend.budgetLines).toHaveLength(1);
    expect(backend.budgetLines[0]!.estimate_cents).toBe(expected.estimateCents);
    expect(backend.budgetLines[0]!.estimate_cents).toBe(37 * 1200);
    // And it says WHICH surface the money is for, which is what a budget read
    // a month later has to answer without opening the room.
    expect(backend.budgetLines[0]!.label).toBe('Calacatta 600×600 — Floor');
  });

  it('returns the link the room document has to record', async () => {
    const model = roomWithTiledFloor();
    const backend = fakeBackend();

    const outcome = await promote(model, backend);
    const linkedModel = withSelectionLinks(model, outcome.linked);

    expect(linkedModel.materials[0]!.selectionId).toBe(
      backend.selections[0]!.id,
    );
  });
});

describe('the same room promoted twice', () => {
  it('does not duplicate the material or its money', async () => {
    const model = roomWithTiledFloor();
    const backend = fakeBackend();

    const first = await promote(model, backend);
    const linked = withSelectionLinks(model, first.linked);
    const callsAfterFirst = [...backend.calls];
    const second = await promote(linked, backend, backend.selections);

    expect(second.created).toBe(0);
    expect(backend.selections).toHaveLength(1);
    expect(backend.budgetLines).toHaveLength(1);
    // Nothing moved, so nothing at all was written — not the selection either.
    // A no-op write bumps `version` and hands whoever else has this project
    // open a conflict for free.
    expect(second.pricedLines).toBe(0);
    expect(backend.calls).toEqual(callsAfterFirst);
  });

  it('survives a rename, which the old name-matching promote did not', async () => {
    const model = roomWithTiledFloor();
    const backend = fakeBackend();
    const first = await promote(model, backend);

    const renamed = withSelectionLinks(
      {
        ...model,
        materials: model.materials.map(material => ({
          ...material,
          name: 'Calacatta — the one we picked',
        })),
      },
      first.linked,
    );
    await promote(renamed, backend, backend.selections);

    expect(backend.selections).toHaveLength(1);
    expect(backend.budgetLines).toHaveLength(1);
  });
});

describe('a room that has been re-measured', () => {
  it('moves the estimate to what the new area costs', async () => {
    const small = roomWithTiledFloor();
    const backend = fakeBackend();
    const first = await promote(small, backend);
    const before = backend.budgetLines[0]!.estimate_cents;

    // The same room, twice as long. Nothing about the material changed — the
    // link rides on the finish, so re-deriving the room's surfaces around it
    // is exactly what re-measuring does.
    const big = withSelectionLinks(
      roomWithTiledFloor(undefined, { width: 8, depth: 3 }),
      first.linked,
    );
    const expected = computeTakeoff(big).lines[0]!;

    const outcome = await promote(big, backend, backend.selections);

    expect(expected.estimateCents).toBeGreaterThan(before);
    expect(outcome.pricedLines).toBe(1);
    expect(backend.budgetLines).toHaveLength(1);
    expect(backend.budgetLines[0]!.estimate_cents).toBe(expected.estimateCents);
  });
});

describe('a material the member attached from the project', () => {
  it('reuses that row instead of making a copy of it', async () => {
    // What `materialFromSelection` produces: the finish carries the id of the
    // selection it came from, so the surface and the shopping row are already
    // the same thing before the budget is ever touched.
    const existing = selectionRow({
      id: 'hpsel_imported',
      name: 'Calacatta 600×600',
      category: 'tile',
      vendor: 'Tile Depot',
      unit_price_cents: 1200,
    });
    const model = roomWithTiledFloor({ selectionId: existing.id });
    const expected = computeTakeoff(model).lines[0]!;
    const backend = fakeBackend({ selections: [existing] });

    const outcome = await promote(model, backend);

    expect(outcome.created).toBe(0);
    expect(backend.selections).toHaveLength(1);
    expect(backend.selections[0]!.id).toBe('hpsel_imported');
    // Attached and decided — the material card says so outside the studio.
    // Status is deliberately NOT written — see the CHECK-constraint note in
    // surfaceBudget.ts. It stays whatever the shopping row already said.
    expect(backend.selections[0]!.status).toBe('idea');
    expect(backend.selections[0]!.qty).toBe(37);
    expect(backend.budgetLines).toHaveLength(1);
    expect(backend.budgetLines[0]!.selection_id).toBe('hpsel_imported');
    expect(backend.budgetLines[0]!.estimate_cents).toBe(expected.estimateCents);
  });

  it('never overwrites the price the shop published', async () => {
    const shopPriced = selectionRow({
      id: 'hpsel_imported',
      name: 'Calacatta 600×600',
      unit_price_cents: 998,
    });
    // The member typed a different price into the finish editor.
    const model = roomWithTiledFloor({
      selectionId: shopPriced.id,
      unitPriceCents: 1200,
    });
    const backend = fakeBackend({ selections: [shopPriced] });

    await promote(model, backend);

    expect(backend.selections[0]!.unit_price_cents).toBe(998);
    // The room still gets priced at the room's price: the estimate is what the
    // member is looking at in the panel, and the listing keeps its own fact.
    expect(backend.budgetLines[0]!.estimate_cents).toBe(37 * 1200);
  });

  it('fills in a price the selection never had', async () => {
    const unpriced = selectionRow({
      id: 'hpsel_imported',
      name: 'Calacatta 600×600',
      unit_price_cents: null,
    });
    const model = roomWithTiledFloor({ selectionId: unpriced.id });
    const backend = fakeBackend({ selections: [unpriced] });

    await promote(model, backend);

    expect(backend.selections[0]!.unit_price_cents).toBe(1200);
  });

  it('relinks a material whose selection was deleted', async () => {
    const model = roomWithTiledFloor({ selectionId: 'hpsel_gone' });
    const backend = fakeBackend();

    const outcome = await promote(model, backend);

    expect(outcome.created).toBe(1);
    expect(outcome.linked[model.materials[0]!.id]).toBe(
      backend.selections[0]!.id,
    );
  });
});

describe('a material that is still one option among several', () => {
  const group: HomeProjectOptionGroup = {
    id: 'hpog_floor',
    project_id: 'hp_1',
    name: 'Kitchen floor',
    category: 'finish',
    area_value: 12,
    area_unit: 'm2',
    area_source: 'manual',
    waste_factor_pct: 10,
    preferred_selection_id: 'hpsel_other',
    version: 1,
  };
  const candidate = selectionRow({
    id: 'hpsel_candidate',
    name: 'Calacatta 600×600',
    option_group_id: 'hpog_floor',
    unit_price_cents: 1200,
  });

  it('keeps a losing option out of the budget and says why', async () => {
    const model = roomWithTiledFloor({ selectionId: candidate.id });
    const backend = fakeBackend({ selections: [candidate] });

    const outcome = await promote(model, backend, [candidate], [group]);

    // The comparison stands: the money is the group's to release, and a wall
    // in the studio is not where that decision gets made.
    expect(backend.budgetLines).toHaveLength(0);
    expect(outcome.heldBack).toEqual(['Calacatta 600×600']);
    expect(describeBudgetOutcome(outcome)).toContain('one option among several');
  });

  it('prices it as soon as it is the one that won', async () => {
    const model = roomWithTiledFloor({ selectionId: candidate.id });
    const backend = fakeBackend({ selections: [candidate] });

    const outcome = await promote(
      model,
      backend,
      [candidate],
      [{ ...group, preferred_selection_id: candidate.id }],
    );

    expect(outcome.heldBack).toEqual([]);
    expect(backend.budgetLines).toHaveLength(1);
    expect(backend.budgetLines[0]!.estimate_cents).toBe(37 * 1200);
  });
});

describe('a finish with no price', () => {
  it('reaches the materials list but never the budget as a zero', async () => {
    const model = roomWithTiledFloor({ unitPriceCents: undefined });
    const backend = fakeBackend();

    const outcome = await promote(model, backend);

    expect(outcome.created).toBe(1);
    expect(backend.budgetLines).toHaveLength(0);
    expect(outcome.unpriced).toEqual(['Calacatta 600×600']);
    // Named, so the member knows which one to go and price.
    expect(describeBudgetOutcome(outcome)).toContain('Calacatta 600×600');
  });
});

describe('the small pure pieces', () => {
  it('names the surfaces the money is for', () => {
    expect(
      budgetLabelFor({
        materialId: 'mt_1',
        name: 'Soft white',
        kind: 'paint',
        colorHex: '#ffffff',
        netM2: 20,
        withWasteM2: 20,
        units: null,
        purchaseUnits: 4,
        unitLabel: 'L',
        estimateCents: 8000,
        surfaceLabels: ['N wall', 'S wall'],
      }),
    ).toBe('Soft white — N wall, S wall');
  });

  it('has no whole purchase count for a finish sold by the metre', () => {
    expect(
      purchaseQtyFor({
        materialId: 'mt_1',
        name: 'Microcement',
        kind: 'other',
        colorHex: '#cccccc',
        netM2: 12,
        withWasteM2: 13.2,
        units: null,
        purchaseUnits: null,
        unitLabel: null,
        estimateCents: 66000,
        surfaceLabels: ['Floor'],
      }),
    ).toBeNull();
  });

  it('leaves the document alone when every link is already recorded', () => {
    const model = roomWithTiledFloor({ selectionId: 'hpsel_1' });
    expect(
      withSelectionLinks(model, { [model.materials[0]!.id]: 'hpsel_1' }),
    ).toBe(model);
  });
});
