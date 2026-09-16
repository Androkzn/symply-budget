import { storageHelpers } from '@services/storage';

export const RECEIPT_ALIASES_KEY = 'budget.receiptAliases.v1';
export const RECEIPT_ALIASES_LRU_CAP = 500;

export interface ReceiptAliasEntry {
  name: string;
  categoryId?: string | null;
  hits: number;
  updatedAt: number;
}

export interface ReceiptAliasHint {
  key: string;
  name: string;
  categoryId?: string | null;
}

export type ReceiptAliasMap = Record<string, ReceiptAliasEntry>;

/** Worker + local match key: UPC/SKU when present, else lowercase printed name. */
export function aliasKeyForItem(rawCode?: string | null, rawName?: string): string {
  const code = rawCode?.trim();
  if (code) return code;
  return (rawName ?? '').trim().toLowerCase();
}

export async function loadAliasMap(): Promise<ReceiptAliasMap> {
  const stored = await storageHelpers.getObject<ReceiptAliasMap>(RECEIPT_ALIASES_KEY);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  return stored;
}

export async function listAliasHints(): Promise<ReceiptAliasHint[]> {
  const map = await loadAliasMap();
  return Object.entries(map).map(([key, entry]) => ({
    key,
    name: entry.name,
    categoryId: entry.categoryId,
  }));
}

export function applyAliasHints<
  T extends {
    raw_code?: string | null;
    raw_name?: string;
    name: string;
    category_id?: string | null;
  },
>(items: T[], aliases: ReceiptAliasHint[]): T[] {
  if (aliases.length === 0) return items;
  return items.map((item) => {
    const keys = [item.raw_code, item.raw_name?.trim().toLowerCase()].filter(
      (k): k is string => !!k,
    );
    const hit = aliases.find(
      (a) => keys.includes(a.key.trim().toLowerCase()) || keys.includes(a.key),
    );
    if (!hit) return item;
    return {
      ...item,
      name: hit.name.trim() || item.name,
      category_id: hit.categoryId ?? item.category_id,
    };
  });
}

export async function upsertAliases(
  entries: Array<{ key: string; name: string; categoryId?: string | null }>,
): Promise<void> {
  if (entries.length === 0) return;
  const map = await loadAliasMap();
  const now = Date.now();
  for (const entry of entries) {
    const key = entry.key.trim();
    if (!key || !entry.name.trim()) continue;
    const prev = map[key];
    map[key] = {
      name: entry.name.trim(),
      categoryId: entry.categoryId ?? prev?.categoryId ?? null,
      hits: (prev?.hits ?? 0) + 1,
      updatedAt: now,
    };
  }
  const pruned = evictLru(map, RECEIPT_ALIASES_LRU_CAP);
  await storageHelpers.setObject(RECEIPT_ALIASES_KEY, pruned);
}

/**
 * Re-file learned aliases after categories merged (`mergeDuplicateCategories`):
 * an alias still pointing at a dropped id would file the next scanned line
 * under a category that no longer exists. Device-local, so it rides outside the
 * ledger op; returns how many entries moved.
 */
export async function remapAliasCategories(remap: ReadonlyMap<string, string>): Promise<number> {
  if (remap.size === 0) return 0;
  const map = await loadAliasMap();
  let changed = 0;
  for (const entry of Object.values(map)) {
    const target = entry.categoryId ? remap.get(entry.categoryId) : undefined;
    if (!target || target === entry.categoryId) continue;
    entry.categoryId = target;
    changed += 1;
  }
  if (changed > 0) await storageHelpers.setObject(RECEIPT_ALIASES_KEY, map);
  return changed;
}

/**
 * Remember that one spending name was replaced by another — typing "Peanuts"
 * and settling on "Nuts" teaches the Name field to offer "Nuts" next time.
 *
 * Deliberately the same store the receipt scanner writes to: a scanned line
 * renamed by hand and a typed name corrected by hand are the same statement
 * about what this household calls things, and sharing the map means the Name
 * shortcuts start out already knowing every rename made during a scan.
 *
 * Carries no category — `null` leaves any category already learned for this key
 * untouched (see `upsertAliases`), so renaming never re-files a spending.
 */
export async function recordNameRename(from: string, to: string): Promise<void> {
  const key = from.trim().toLowerCase();
  const name = to.trim();
  if (!key || !name || key === name.toLowerCase()) return;
  await upsertAliases([{ key, name, categoryId: null }]);
}

function evictLru(map: ReceiptAliasMap, cap: number): ReceiptAliasMap {
  const keys = Object.keys(map);
  if (keys.length <= cap) return map;
  const ranked = keys
    .map((key) => ({ key, updatedAt: map[key]?.updatedAt ?? 0 }))
    .sort((a, b) => a.updatedAt - b.updatedAt);
  const drop = ranked.slice(0, keys.length - cap);
  const next = { ...map };
  for (const row of drop) delete next[row.key];
  return next;
}
