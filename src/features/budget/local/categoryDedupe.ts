/**
 * Collapsing categories that share a name.
 *
 * Sync merges rows by ID and knows nothing about names, so one category
 * authored under two ids by two devices lands in the household twice. That
 * happened for real: the seed used to number its rows by position
 * (`cat_default_25`, icon `paw`) and now derives them from the name
 * (`cat_default_pets`, icon `leaf`), so a household minted on the old build and
 * re-seeded by a device on the new one — an owner's fresh phone, a joiner that
 * adopted before its checkpoint landed — shows "Pets" twice, one per glyph.
 * `backfillDefaultCategories` guards by name on ONE device; this is the
 * cross-device half, and it also catches two members creating "Vet" offline.
 *
 * Deterministic on purpose. Two devices that both notice the duplicate must pick
 * the SAME survivor and write the SAME rows, so their two merge ops converge
 * under LWW instead of fighting:
 *
 *   1. The name-derived default id wins when it is in the group — it is the id
 *      every current build authors, so a future backfill would pick it again.
 *   2. Otherwise the oldest `created_at`, ties broken by id.
 *
 * The survivor remembers every id it absorbed (`merged_from`). A spending that
 * still points at one of those — written by a peer that had not merged yet and
 * delivered after this device did — is re-pointed on the next pass, which is
 * why the pass is cheap enough to run after every ledger change.
 */
import type { BudgetCategory, BudgetItem, Expense, SubBudget } from '@api/budget';
import { defaultCategoryId } from '@symply/contracts';

export interface CategoryMergeGroup {
  /** The survivor's display name. */
  name: string;
  winner: BudgetCategory;
  losers: BudgetCategory[];
}

export interface CategoryMergePlan {
  groups: CategoryMergeGroup[];
  /** Every id a row may still carry → the id it must carry instead. */
  remap: Map<string, string>;
}

/** The ledger tables a merge touches — structural, so the engine's ledger fits. */
export interface CategoryMergeTables {
  categories: BudgetCategory[];
  expenses: Expense[];
  items: BudgetItem[];
  subBudgets: SubBudget[];
}

export interface CategoryMergeOutcome {
  merged: Array<{ name: string; keptId: string; droppedIds: string[] }>;
  /** Spendings, planned items and sub-budgets moved onto a survivor. */
  repointed: number;
  /** Sub-budgets dropped because the survivor already had one for that month. */
  droppedSubBudgets: number;
}

export const EMPTY_CATEGORY_MERGE: CategoryMergeOutcome = Object.freeze({
  merged: [],
  repointed: 0,
  droppedSubBudgets: 0,
}) as CategoryMergeOutcome;

export function normalizeCategoryName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function olderFirst(a: BudgetCategory, b: BudgetCategory): number {
  return compareText(a.created_at ?? '', b.created_at ?? '') || compareText(a.id, b.id);
}

/** The row every device keeps — see the module note for why this order. */
export function pickCategoryWinner(rows: readonly BudgetCategory[]): BudgetCategory {
  if (rows.length === 0) throw new Error('pickCategoryWinner: empty group');
  const canonical = defaultCategoryId(rows[0]!.name);
  const byCanonical = rows.find((row) => row.id === canonical);
  if (byCanonical) return byCanonical;
  return [...rows].sort(olderFirst)[0]!;
}

export function planCategoryMerge(
  categories: readonly BudgetCategory[],
  householdId: string,
): CategoryMergePlan {
  const own = categories.filter((c) => c.household_id === householdId);
  const byName = new Map<string, BudgetCategory[]>();
  for (const category of own) {
    const key = normalizeCategoryName(category.name);
    if (!key) continue;
    const group = byName.get(key);
    if (group) group.push(category);
    else byName.set(key, [category]);
  }

  const groups: CategoryMergeGroup[] = [];
  const remap = new Map<string, string>();
  for (const rows of byName.values()) {
    if (rows.length < 2) continue;
    const winner = pickCategoryWinner(rows);
    const losers = rows.filter((row) => row !== winner).sort(olderFirst);
    groups.push({ name: winner.name, winner, losers });
    for (const loser of losers) {
      remap.set(loser.id, winner.id);
      for (const absorbed of loser.merged_from ?? []) remap.set(absorbed, winner.id);
    }
  }

  // Ids absorbed by an EARLIER merge. A row pointing at one arrived after that
  // merge — a peer that had not merged yet — and the survivor still knows where
  // it belongs. An absorbed id that is somehow live again is a real row and is
  // left alone.
  const live = new Set(own.map((c) => c.id));
  for (const category of own) {
    for (const absorbed of category.merged_from ?? []) {
      if (live.has(absorbed) || remap.has(absorbed)) continue;
      remap.set(absorbed, category.id);
    }
  }
  // A survivor of an earlier merge can itself lose this one: chase X → A → B
  // down to the row that stays.
  for (const [from, to] of remap) {
    let target = to;
    const seen = new Set<string>([from]);
    while (remap.has(target) && !seen.has(target)) {
      seen.add(target);
      target = remap.get(target)!;
    }
    if (target !== to) remap.set(from, target);
  }
  return { groups, remap };
}

/** Rows that still carry an id the plan retires. Zero means nothing to write. */
export function countCategoryReferences(
  tables: CategoryMergeTables,
  remap: ReadonlyMap<string, string>,
): number {
  if (remap.size === 0) return 0;
  let count = 0;
  for (const row of tables.expenses) if (row.category_id && remap.has(row.category_id)) count += 1;
  for (const row of tables.items) if (row.category_id && remap.has(row.category_id)) count += 1;
  for (const row of tables.subBudgets) if (remap.has(row.category_id)) count += 1;
  return count;
}

/**
 * Fold the losers' fields onto the survivor. Every rule is order-independent
 * and every write is skipped when it would not change the row, so two devices
 * emit byte-identical field deltas.
 */
function foldFields(winner: BudgetCategory, losers: readonly BudgetCategory[]): void {
  const all = [winner, ...losers];

  const usage = all.reduce((sum, c) => sum + (c.usage_count ?? 0), 0);
  if ((winner.usage_count ?? 0) !== usage) winner.usage_count = usage;

  // Visible if ANY duplicate was: a category reappearing is recoverable, a
  // category vanishing from the picker is a support ticket.
  const hidden = all.every((c) => c.hidden === true);
  if ((winner.hidden ?? false) !== hidden) winner.hidden = hidden;

  const orders = all.map((c) => c.sort_order).filter((o): o is number => typeof o === 'number');
  if (orders.length > 0) {
    const min = Math.min(...orders);
    if (winner.sort_order !== min) winner.sort_order = min;
  }

  // A seed stays a seed (hide, never delete) whichever row carried the flag.
  if (!winner.is_default && all.some((c) => c.is_default)) winner.is_default = true;

  if (!winner.icon?.trim()) {
    const icon = losers.find((c) => c.icon?.trim())?.icon;
    if (icon) winner.icon = icon;
  }
  if (!winner.color?.trim()) {
    const color = losers.find((c) => c.color?.trim())?.color;
    if (color) winner.color = color;
  }

  const absorbed = new Set(winner.merged_from ?? []);
  for (const loser of losers) {
    absorbed.add(loser.id);
    for (const id of loser.merged_from ?? []) absorbed.add(id);
  }
  absorbed.delete(winner.id);
  const next = [...absorbed].sort(compareText);
  if (JSON.stringify(next) !== JSON.stringify(winner.merged_from ?? [])) {
    winner.merged_from = next;
  }
}

/**
 * Apply a plan to the tables in place: fold and drop the duplicates, then move
 * every reference. Pure over the tables — the caller wraps it in the one write
 * path so it lands as a single op.
 */
export function applyCategoryMerge(
  tables: CategoryMergeTables,
  plan: CategoryMergePlan,
  householdId: string,
): CategoryMergeOutcome {
  const { groups, remap } = plan;
  if (remap.size === 0) return EMPTY_CATEGORY_MERGE;

  // Resolve by id against the live table rather than trusting the plan's
  // references — the plan may have been built off an earlier read.
  const byId = new Map(tables.categories.map((c) => [c.id, c]));
  const merged: CategoryMergeOutcome['merged'] = [];
  const dropped = new Set<string>();
  for (const group of groups) {
    const winner = byId.get(group.winner.id);
    if (!winner || winner.household_id !== householdId) continue;
    const losers = group.losers
      .map((loser) => byId.get(loser.id))
      .filter((loser): loser is BudgetCategory => !!loser && loser.household_id === householdId);
    if (losers.length === 0) continue;
    foldFields(winner, losers);
    for (const loser of losers) dropped.add(loser.id);
    merged.push({ name: winner.name, keptId: winner.id, droppedIds: losers.map((l) => l.id) });
  }
  if (dropped.size > 0) {
    tables.categories = tables.categories.filter((c) => !dropped.has(c.id));
  }

  let repointed = 0;
  const retarget = (row: { household_id: string; category_id: string | null }): boolean => {
    if (row.household_id !== householdId || !row.category_id) return false;
    const target = remap.get(row.category_id);
    if (!target || target === row.category_id) return false;
    row.category_id = target;
    repointed += 1;
    return true;
  };
  for (const row of tables.expenses) retarget(row);
  for (const row of tables.items) retarget(row);

  // Sub-budgets are one cap per (category, year, month). Moving the loser's cap
  // onto the survivor can collide with a cap the survivor already had; the
  // survivor's own wins, then the older, then the smaller id — deterministic,
  // so both devices drop the same row.
  const moved = new Set<string>();
  for (const row of tables.subBudgets) {
    if (retarget(row)) moved.add(row.id);
  }
  let droppedSubBudgets = 0;
  if (moved.size > 0) {
    const targets = new Set(remap.values());
    const contenders = tables.subBudgets
      .filter((row) => row.household_id === householdId && targets.has(row.category_id))
      .sort(
        (a, b) =>
          Number(moved.has(a.id)) - Number(moved.has(b.id)) ||
          compareText(a.created_at ?? '', b.created_at ?? '') ||
          compareText(a.id, b.id),
      );
    const keepers = new Set<string>();
    const drop = new Set<string>();
    for (const row of contenders) {
      const key = `${row.category_id}|${row.year}|${row.month ?? 'year'}`;
      if (keepers.has(key)) drop.add(row.id);
      else keepers.add(key);
    }
    if (drop.size > 0) {
      tables.subBudgets = tables.subBudgets.filter((row) => !drop.has(row.id));
      droppedSubBudgets = drop.size;
    }
  }

  return { merged, repointed, droppedSubBudgets };
}
