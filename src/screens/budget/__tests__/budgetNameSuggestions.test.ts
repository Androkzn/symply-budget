import {
  buildNameVocabulary,
  normalizeName,
  rankNameSuggestions,
  type NameAlias,
  type NameVocabularyEntry,
} from '../budgetNameSuggestions';

function logged(name: string, usageCount: number, lastUsedAt = '2026-07-01'): NameVocabularyEntry {
  return { name, usageCount, lastUsedAt };
}

function rank(query: string, vocabulary: NameVocabularyEntry[], aliases: NameAlias[] = []) {
  return rankNameSuggestions({ query, vocabulary, aliases }).map((s) => s.name);
}

describe('normalizeName', () => {
  it('folds case and collapses whitespace', () => {
    expect(normalizeName('  Ground   BEEF ')).toBe('ground beef');
  });
});

describe('buildNameVocabulary', () => {
  it('counts uses case-insensitively and keeps the most recent spelling', () => {
    const vocabulary = buildNameVocabulary([
      { title: 'nuts', expense_date: '2026-05-01' },
      { title: 'NUTS', expense_date: '2026-06-01' },
      { title: 'Nuts', expense_date: '2026-07-01' },
    ]);

    expect(vocabulary).toEqual([{ name: 'Nuts', usageCount: 3, lastUsedAt: '2026-07-01' }]);
  });

  it('ignores blank names', () => {
    expect(buildNameVocabulary([{ title: '   ', expense_date: '2026-07-01' }])).toEqual([]);
  });
});

describe('rankNameSuggestions', () => {
  it('bridges names that share no letters, via the synonym lexicon', () => {
    expect(rank('Peanuts', [logged('Nuts', 12), logged('Peanuts', 3)])).toEqual(['Nuts']);
    expect(rank('Salmon', [logged('Fish', 9)])).toEqual(['Fish']);
    expect(rank('Soda', [logged('Beverages', 7)])).toEqual(['Beverages']);
  });

  it('only offers a group relative the household actually logs', () => {
    // "Nuts" is in the lexicon, but this household has never written it down.
    expect(rank('Peanuts', [logged('Peanuts', 3), logged('Groceries', 20)])).toEqual([]);
  });

  it('will not suggest a rarer name than the one being typed', () => {
    // Editing a spending already called "Nuts" must not offer "Peanuts" back.
    expect(rank('Nuts', [logged('Nuts', 12), logged('Peanuts', 3)])).toEqual([]);
  });

  it('completes a partially typed name from the ledger', () => {
    expect(rank('bev', [logged('Beverages', 6), logged('Fish', 2)])).toEqual(['Beverages']);
  });

  it('ranks by how often the household uses each name', () => {
    expect(rank('fish', [logged('Fish sticks', 2), logged('Fish and chips', 8)])).toEqual([
      'Fish and chips',
      'Fish sticks',
    ]);
  });

  it('goes quiet once the typed name is itself the household favourite', () => {
    // "Fish" at 30 uses IS the canonical name — nothing here beats it, so the
    // row stays empty rather than nagging with "Fish and chips".
    expect(
      rank('fish', [logged('Fish', 30), logged('Fish and chips', 8), logged('Fish sticks', 2)])
    ).toEqual([]);
  });

  it('lets a remembered rename outrank everything, even unlogged', () => {
    const aliases: NameAlias[] = [{ key: 'peanuts', name: 'Nuts' }];
    expect(rank('Peanuts', [logged('Peanut butter', 40)], aliases)[0]).toBe('Nuts');
  });

  it('finds the family from a qualified name', () => {
    expect(rank('salmon fillet', [logged('Fish', 9)])).toEqual(['Fish']);
  });

  it('never suggests the name already in the field', () => {
    expect(rank('Beverages', [logged('Beverages', 12)])).toEqual([]);
  });

  it('stays quiet until there is enough to go on', () => {
    expect(rank('n', [logged('Nuts', 12)])).toEqual([]);
    expect(rank('   ', [logged('Nuts', 12)])).toEqual([]);
  });

  it('caps the row so the bubbles fit under the field', () => {
    const vocabulary = [
      logged('Fish', 30),
      logged('Salmon', 12),
      logged('Tuna', 11),
      logged('Cod', 10),
      logged('Shrimp', 9),
    ];
    expect(rank('seafood', vocabulary)).toHaveLength(3);
  });
});
