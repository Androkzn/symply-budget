import { storageHelpers } from '@services/storage';

import {
  RECEIPT_ALIASES_KEY,
  RECEIPT_ALIASES_LRU_CAP,
  aliasKeyForItem,
  applyAliasHints,
  listAliasHints,
  loadAliasMap,
  remapAliasCategories,
  upsertAliases,
} from '../receiptAliases';

describe('receiptAliases', () => {
  beforeEach(async () => {
    await storageHelpers.delete(RECEIPT_ALIASES_KEY);
  });

  it('keys by raw_code when present, else lowercase raw_name', () => {
    expect(aliasKeyForItem('  4011  ', 'BANANAS')).toBe('4011');
    expect(aliasKeyForItem(null, 'ICE CREAM 4L')).toBe('ice cream 4l');
    expect(aliasKeyForItem('', 'Milk')).toBe('milk');
  });

  it('upserts via storageHelpers and returns hints for the next scan', async () => {
    await upsertAliases([{ key: '4011', name: 'Bananas', categoryId: 'cat-groc' }]);
    const hints = await listAliasHints();
    expect(hints).toEqual([
      expect.objectContaining({ key: '4011', name: 'Bananas', categoryId: 'cat-groc' }),
    ]);
    const stored = await storageHelpers.getObject(RECEIPT_ALIASES_KEY);
    expect(stored).toEqual(
      expect.objectContaining({
        '4011': expect.objectContaining({ name: 'Bananas', hits: 1 }),
      }),
    );
  });

  it('re-files learned aliases onto the surviving category after a merge', async () => {
    await upsertAliases([
      { key: '4011', name: 'Kibble', categoryId: 'cat_default_25' },
      { key: 'leash', name: 'Leash', categoryId: 'cat_default_pets' },
      { key: 'milk', name: 'Milk', categoryId: 'cat_default_groceries' },
    ]);
    const remap = new Map([['cat_default_25', 'cat_default_pets']]);

    expect(await remapAliasCategories(remap)).toBe(1);

    const map = await loadAliasMap();
    expect(map['4011'].categoryId).toBe('cat_default_pets');
    expect(map.leash.categoryId).toBe('cat_default_pets');
    expect(map.milk.categoryId).toBe('cat_default_groceries');
    // Nothing left to move — and nothing written.
    expect(await remapAliasCategories(remap)).toBe(0);
  });

  it('increments hits on a second save of the same key', async () => {
    await upsertAliases([{ key: '4011', name: 'Bananas' }]);
    await upsertAliases([{ key: '4011', name: 'Organic Bananas', categoryId: 'cat-groc' }]);
    const map = await loadAliasMap();
    expect(map['4011'].name).toBe('Organic Bananas');
    expect(map['4011'].hits).toBe(2);
    expect(map['4011'].categoryId).toBe('cat-groc');
  });

  it('applies a matching alias as the default name and category', () => {
    const items = applyAliasHints(
      [
        { raw_code: '4011', raw_name: 'BANANAS', name: 'Bananas', category_id: 'cat-old' },
        { raw_code: null, raw_name: 'MILK 4L', name: 'Milk 4l', category_id: null },
      ],
      [
        { key: '4011', name: 'Chiquita', categoryId: 'cat-groc' },
        { key: 'milk 4l', name: 'Milk', categoryId: 'cat-dairy' },
      ],
    );
    expect(items[0]).toEqual(
      expect.objectContaining({ name: 'Chiquita', category_id: 'cat-groc' }),
    );
    expect(items[1]).toEqual(expect.objectContaining({ name: 'Milk', category_id: 'cat-dairy' }));
  });

  it('evicts the oldest entries when the map exceeds the LRU cap', async () => {
    const now = 1_700_000_000_000;
    const oversized: Record<string, { name: string; hits: number; updatedAt: number }> = {};
    for (let i = 0; i < RECEIPT_ALIASES_LRU_CAP; i += 1) {
      oversized[`old-${i}`] = { name: `Item ${i}`, hits: 1, updatedAt: now + i };
    }
    await storageHelpers.setObject(RECEIPT_ALIASES_KEY, oversized);
    await upsertAliases([{ key: 'fresh', name: 'Fresh' }]);
    const map = await loadAliasMap();
    expect(Object.keys(map)).toHaveLength(RECEIPT_ALIASES_LRU_CAP);
    expect(map.fresh).toBeTruthy();
    expect(map['old-0']).toBeUndefined();
  });
});
