/**
 * What a material attached to a surface costs.
 *
 * ## The half of the bridge that carries money
 *
 * A member attaches a material they have already shopped for to a wall or a
 * floor — `materialFromSelection` converts the selection into a finish and the
 * finish carries `selectionId`, which is the link. That is the picture. This
 * module is the money: it walks the takeoff and makes each attached material's
 * budget line say what covering that measured surface actually costs.
 *
 * Before it, the promote step matched selections **by name** and created a new
 * one whenever it missed — so renaming a finish silently doubled the budget,
 * re-measuring a room never moved it, and a material the member had chosen from
 * the project's own list came back as a second copy of itself. `selectionId` is
 * the link that replaces all of that, and it is the one the contract always
 * documented: "the back-pointer that stops a second promotion creating a
 * duplicate line".
 *
 * ## One owner for the number
 *
 * `computeTakeoff` is the only thing here that prices anything, because it is
 * the arithmetic the member is looking at when they tap the button. The panel
 * says "12 boxes · $1,240"; the budget line says $1,240. A second pricing pass
 * — deriving the estimate again from the selection's own coverage, say — would
 * agree until the day it did not, and the day it did not the member would be
 * holding two totals for one floor.
 *
 * The corollary is what this module refuses to write: **it never overwrites what
 * a shop said.** A selection's `unit_price_cents` is filled in only when it is
 * empty. The quantity and the estimate belong to the room; the price belongs to
 * the listing. For the same reason it never DELETES a budget line: a material
 * whose price has since been cleared keeps whatever the last priced run wrote,
 * because removing money from a member's budget on their behalf is a decision
 * they did not ask anyone to make.
 *
 * ## The status column is not ours to write
 *
 * `home_project_selections.status` has carried a CHECK constraint since
 * migration 0105 admitting only
 * `('idea','shortlisted','approved','rejected','ordered','installed')`. The
 * service's own `setPreferredSelection` writes `'chosen'` and `'considering'`,
 * which D1 refuses — so **picking the winning option 500s against a real
 * database**, and has since migration 0162 shipped. The backend unit tests do
 * not catch it because their hand-written schema omits the CHECK.
 *
 * That is a pre-existing defect and its fix is a migration on `main`, not a
 * client change. This module simply does not write the column: nothing on the
 * client reads the string, and a decision is already recorded by
 * `option_groups.preferred_selection_id` or by the budget line itself.
 *
 * ## Why two passes and a reload
 *
 * `createSelection` mints a `materials` budget line of its own for a priced,
 * ungrouped selection — that behaviour predates this feature on both backends
 * and is not ours to change — and it returns the selection without the line. So
 * the first pass makes sure every takeoff line HAS a selection, the caller's
 * `reload` reads back the lines that came with them, and the second pass sets
 * every line to the takeoff's figure. Re-running the whole thing is therefore
 * idempotent: nothing is duplicated and the estimate simply catches up with a
 * room that has been re-measured.
 */

import type {
  AreaUnit,
  HomeProjectBudgetLine,
  HomeProjectOptionGroup,
  HomeProjectSelection,
  MaterialSpec,
} from '@api/home-projects';
import { describeQuantity } from '@features/house/surfaces';
import type {
  RoomSurfaceModel,
  Takeoff,
  TakeoffLine,
} from '@symply/contracts';

export interface SurfaceBudgetPorts {
  createSelection(input: {
    name: string;
    category?: string;
    status?: string;
    qty?: number;
    unit?: string;
    unitPriceCents?: number;
    vendor?: string;
    productUrl?: string;
    sku?: string;
    notes?: string;
    coveragePerUnit?: number;
    coverageUnit?: AreaUnit;
    specs?: MaterialSpec[];
  }): Promise<{ selection: HomeProjectSelection }>;
  updateSelection(
    selectionId: string,
    patch: {
      status?: string;
      qty?: number;
      unit?: string | null;
      unitPriceCents?: number | null;
      coveragePerUnit?: number | null;
      coverageUnit?: AreaUnit | null;
    },
  ): Promise<unknown>;
  createBudgetLine(input: {
    category: 'materials';
    label: string;
    estimateCents: number;
    selectionId: string;
  }): Promise<unknown>;
  updateBudgetLine(
    lineId: string,
    patch: { label?: string; estimateCents?: number },
  ): Promise<unknown>;
  /** Re-read the project after the first pass. See the module header. */
  reload(): Promise<{
    selections: readonly HomeProjectSelection[];
    budgetLines: readonly HomeProjectBudgetLine[];
  }>;
}

export interface SurfaceBudgetOutcome {
  /** `material.id → selection.id`, for the links the room document must store. */
  linked: Record<string, string>;
  /** Materials that had no row in the project's list and now do. */
  created: number;
  /** Budget lines written or corrected. */
  pricedLines: number;
  /**
   * Materials attached to a surface that carry no price, by name.
   *
   * Reported rather than counted so the member is told WHICH finish is still
   * missing its price — that is the one thing they can act on, and a bare
   * "2 without prices" sends them hunting.
   */
  unpriced: string[];
  /**
   * Materials that are a LOSING option in a comparison, by name.
   *
   * A selection inside an option group is a candidate, and the group's
   * `preferred_selection_id` is the decision — that is the whole reason five
   * flooring options do not put five floors in the estimate. Attaching one to a
   * wall in the studio must not quietly overrule that comparison, so its money
   * is held back and the member is told to go and pick it.
   */
  heldBack: string[];
}

/**
 * What one takeoff line costs, and what to call it in the budget.
 *
 * The label names the material and the surfaces it covers, because a budget
 * read a month later has to answer "what is this $1,240 for" without opening
 * the room. `line.surfaceLabels` is already sorted and de-duplicated.
 */
export function budgetLabelFor(line: TakeoffLine): string {
  return line.surfaceLabels.length
    ? `${line.name} — ${line.surfaceLabels.join(', ')}`
    : line.name;
}

/**
 * The notes a promoted material carries.
 *
 * Every figure the member would need to check the quantity by hand, plus the
 * warning. The takeoff panel says the same things on screen and this is what
 * survives into the materials list, where the surface it came from is otherwise
 * invisible.
 */
export function promotedNotesFor(line: TakeoffLine): string {
  return `${describeQuantity(line)} · ${line.netM2.toFixed(2)} m² net · ${
    line.surfaceLabels.join(', ') || 'this room'
  }. From the room layout — check before ordering.`;
}

/**
 * The whole purchase count for a line, when there is one.
 *
 * `qty` is an integer column and a purchase count is what it means — 12 boxes,
 * 4 litres. A continuous finish priced by the square metre has no whole count,
 * so it keeps `qty: 1` and its money lives entirely in the budget line, which
 * is the only place that can hold a non-integral quantity's worth.
 */
export function purchaseQtyFor(line: TakeoffLine): number | null {
  const qty = line.purchaseUnits ?? line.units;
  return qty != null && Number.isInteger(qty) && qty > 0 ? qty : null;
}

/**
 * Attach every takeoff line to the project's materials and budget.
 *
 * Returns the `material.id → selection.id` links the caller must write back
 * into the room document; without them the next run would create a second copy
 * of every material, which is the exact bug the name-based dedup this replaces
 * used to have whenever a member renamed a finish.
 */
export async function sendTakeoffToBudget(input: {
  takeoff: Takeoff;
  model: RoomSurfaceModel;
  selections: readonly HomeProjectSelection[];
  /**
   * The project's comparisons, so a losing option's money stays out. Omitted
   * means "this project has none", which is the common case.
   */
  optionGroups?: readonly HomeProjectOptionGroup[];
  ports: SurfaceBudgetPorts;
}): Promise<SurfaceBudgetOutcome> {
  const { takeoff, model, ports } = input;
  const materialsById = new Map(model.materials.map(m => [m.id, m]));
  const known = new Map(input.selections.map(row => [row.id, row]));
  const groups = new Map(
    (input.optionGroups ?? []).map(group => [group.id, group]),
  );

  const linked: Record<string, string> = {};
  const unpriced: string[] = [];
  const heldBack: string[] = [];
  let created = 0;

  // ---- pass 1: every line has a selection --------------------------------
  for (const line of takeoff.lines) {
    const material = materialsById.get(line.materialId);
    if (!material) continue;
    if (line.estimateCents === null) unpriced.push(line.name);

    const existing = material.selectionId
      ? known.get(material.selectionId)
      : undefined;
    const qty = purchaseQtyFor(line);

    if (existing) {
      linked[material.id] = existing.id;
      const patch = {
        // NO `status` write. `home_project_selections.status` carries a CHECK
        // constraint from migration 0105 —
        // `('idea','shortlisted','approved','rejected','ordered','installed')`
        // — and 'chosen' is not in it, so D1 rejects the whole UPDATE and the
        // promote 500s. Nothing on the client reads the string anyway: a
        // decision is `option_groups.preferred_selection_id`, and for an
        // ungrouped material it is the budget line this writes. See the note on
        // `setPreferredSelection` below.
        ...(qty !== null && existing.qty !== qty ? { qty } : {}),
        // Only ever FILLS IN. A price or a coverage figure that came off a shop
        // page is the listing's fact, not the room's — see the module header.
        ...(existing.unit_price_cents == null &&
        material.unitPriceCents !== undefined
          ? { unitPriceCents: material.unitPriceCents }
          : {}),
        ...(existing.coverage_per_unit == null && material.coverageM2PerUnit
          ? {
              coveragePerUnit: material.coverageM2PerUnit,
              coverageUnit: 'm2' as AreaUnit,
            }
          : {}),
      };
      // Nothing to say, nothing written. Promoting an unchanged room must be a
      // read: every write bumps `version`, and a bump that carries no new fact
      // is a conflict handed to whoever else has this project open.
      if (Object.keys(patch).length > 0) {
        await ports.updateSelection(existing.id, patch);
      }
      continue;
    }

    const { selection } = await ports.createSelection({
      name: material.name,
      // The finish kind IS the category word `finishKindForCategory` reads
      // back, so a material promoted here converts to the same finish if it is
      // ever attached to another surface.
      category: material.kind,
      // Status left at the service default ('idea') for the CHECK-constraint
      // reason above — an INSERT of 'chosen' is refused exactly as an UPDATE is.
      ...(qty !== null ? { qty } : {}),
      ...(material.unitLabel ? { unit: material.unitLabel } : {}),
      ...(material.unitPriceCents !== undefined
        ? { unitPriceCents: material.unitPriceCents }
        : {}),
      ...(material.vendor ? { vendor: material.vendor } : {}),
      ...(material.productUrl ? { productUrl: material.productUrl } : {}),
      ...(material.sku ? { sku: material.sku } : {}),
      ...(material.coverageM2PerUnit
        ? {
            coveragePerUnit: material.coverageM2PerUnit,
            coverageUnit: 'm2' as AreaUnit,
          }
        : {}),
      notes: promotedNotesFor(line),
    });
    linked[material.id] = selection.id;
    created += 1;
  }

  if (Object.keys(linked).length === 0) {
    return { linked, created, pricedLines: 0, unpriced, heldBack };
  }

  // ---- pass 2: every line's money is the takeoff's --------------------
  const fresh = await ports.reload();
  const lineBySelection = new Map<string, HomeProjectBudgetLine>();
  for (const row of fresh.budgetLines) {
    if (row.selection_id) lineBySelection.set(row.selection_id, row);
  }
  const freshById = new Map(fresh.selections.map(row => [row.id, row]));

  let pricedLines = 0;
  for (const line of takeoff.lines) {
    if (line.estimateCents === null) continue;
    const selectionId = linked[line.materialId];
    if (!selectionId) continue;

    // A candidate in a comparison the member has not settled. Its money is the
    // group's to release, via `preferred_selection_id`, and a wall in the
    // studio is not where that decision gets made. See `heldBack`.
    const groupId = freshById.get(selectionId)?.option_group_id;
    if (groupId && groups.get(groupId)?.preferred_selection_id !== selectionId) {
      heldBack.push(line.name);
      continue;
    }

    const label = budgetLabelFor(line);
    const existing = lineBySelection.get(selectionId);

    if (!existing) {
      await ports.createBudgetLine({
        category: 'materials',
        label,
        estimateCents: line.estimateCents,
        selectionId,
      });
      pricedLines += 1;
      continue;
    }
    // A line already saying the right thing is left alone: every write bumps
    // `version`, and a no-op bump is a conflict waiting for the other device
    // that is looking at the same project.
    if (
      existing.estimate_cents === line.estimateCents &&
      existing.label === label
    ) {
      continue;
    }
    await ports.updateBudgetLine(existing.id, {
      label,
      estimateCents: line.estimateCents,
    });
    pricedLines += 1;
  }

  return { linked, created, pricedLines, unpriced, heldBack };
}

/**
 * Record the `material → selection` links in the room document.
 *
 * Separate from the write above so the caller can put it inside its own
 * `update()` — the document is saved by the studio's autosave, not by us, and
 * a module that reached into that would be a second writer of the same JSON.
 */
export function withSelectionLinks(
  model: RoomSurfaceModel,
  linked: Record<string, string>,
): RoomSurfaceModel {
  if (Object.keys(linked).length === 0) return model;
  let changed = false;
  const materials = model.materials.map(material => {
    const selectionId = linked[material.id];
    if (!selectionId || material.selectionId === selectionId) return material;
    changed = true;
    return { ...material, selectionId };
  });
  // The SAME object when every link was already recorded, so a caller can use
  // identity to decide whether the document is worth writing. A promote that
  // changed nothing must not put a byte-identical document through the ledger.
  return changed ? { ...model, materials } : model;
}

/**
 * What to tell the member after a promote.
 *
 * One sentence, and it names the thing that needs their attention rather than
 * counting successes — "12 boxes went in" is not information, "the panelling
 * still has no price" is.
 */
export function describeBudgetOutcome(outcome: SurfaceBudgetOutcome): string {
  const parts: string[] = [];
  if (outcome.created > 0) {
    parts.push(
      `${outcome.created} material${outcome.created === 1 ? '' : 's'} added`,
    );
  }
  if (outcome.pricedLines > 0) {
    parts.push(
      `${outcome.pricedLines} budget line${
        outcome.pricedLines === 1 ? '' : 's'
      } updated from your measurements`,
    );
  }
  if (parts.length === 0) parts.push('The budget already matched this room');
  const lines = [`${parts.join(' · ')}.`];
  if (outcome.unpriced.length) {
    lines.push(`Still without a price: ${outcome.unpriced.join(', ')}.`);
  }
  if (outcome.heldBack.length) {
    lines.push(
      `Not costed yet, because ${
        outcome.heldBack.length === 1 ? 'it is' : 'they are'
      } still one option among several: ${outcome.heldBack.join(
        ', ',
      )}. Pick ${outcome.heldBack.length === 1 ? 'it' : 'them'} in the project's materials to add the money.`,
    );
  }
  return lines.join(' ');
}
