import type { Expense } from '@api/budget';

import { describeBulkSuggestion, estimateBulkMonths, type BulkEstimateInput } from '../bulkEstimate';

let seq = 0;
function row(overrides: Partial<Expense>): Expense {
  seq += 1;
  return {
    id: `exp-${seq}`,
    household_id: 'hh',
    budget_item_id: null,
    category_id: 'cat-fish',
    title: 'Salmon',
    description: null,
    amount: 10000,
    saved_amount: 0,
    tax_amount: 0,
    deposit_amount: 0,
    expense_date: '2026-03-10',
    vendor: null,
    receipt_key: null,
    created_by: null,
    created_at: '2026-03-10T00:00:00.000Z',
    ...overrides,
  };
}

const CATEGORIES = [
  { id: 'cat-fish', name: 'Fish' },
  { id: 'cat-groceries', name: 'Groceries' },
];

function estimate(overrides: Partial<BulkEstimateInput>) {
  return estimateBulkMonths({
    title: 'Salmon',
    categoryId: 'cat-fish',
    amountCents: 40000,
    savedCents: 0,
    purchaseDate: '2026-09-11',
    expenses: [],
    categories: CATEGORIES,
    ...overrides,
  });
}

const money = (cents: number) => `$${(cents / 100).toFixed(0)}`;

describe('estimateBulkMonths', () => {
  it('falls back to an honest default with no history', () => {
    const s = estimate({});
    expect(s.months).toBe(3);
    expect(s.basis).toBe('default');
    expect(s.confidence).toBe('none');
    expect(s.looksRegularSize).toBe(false);
    expect(describeBulkSuggestion(s, '2026-09-11', money)).toBe(
      'No history for Salmon yet. Pick how many months it should last.',
    );
  });

  it('R1: uses the product rate over the span, counting the months without a purchase', () => {
    // $100 in Mar, May, Jul → $300 over Mar..Aug (6 months) = $50 a month → $400 lasts 8.
    const expenses = [
      row({ expense_date: '2026-03-10' }),
      row({ expense_date: '2026-05-12' }),
      row({ expense_date: '2026-07-08' }),
    ];
    const s = estimate({ expenses });
    expect(s.basis).toBe('product_rate');
    expect(s.months).toBe(8);
    expect(s.evidence.monthlyRateCents).toBe(5000);
    expect(s.evidence.eventCount).toBe(3);
    expect(s.evidence.firstEventDate).toBe('2026-03-10');
    // Cadence agrees (every ~60 days at $100 → 8 months), so confidence moves up from medium.
    expect(s.confidence).toBe('high');
    expect(describeBulkSuggestion(s, '2026-09-11', money)).toBe(
      'Based on 3 purchases of Salmon since March, about $50 a month.',
    );
  });

  it('R0: the household’s own previous plan wins, scaled by purchase size', () => {
    // One $600 stock-up in January spread over 6 months, plus one $100 regular buy in
    // July. The precedent decides: 6 months × (400 / 600) = 4.
    const expenses = [
      row({
        expense_date: '2026-01-05',
        amount: 60000,
        bulk: { months: 6, start_month: '2026-01', suggested_months: null, basis: null },
      }),
      row({ expense_date: '2026-07-20' }),
    ];
    const s = estimate({ expenses });
    expect(s.basis).toBe('own_precedent');
    expect(s.months).toBe(4);
    expect(s.confidence).toBe('high');
    expect(s.evidence.precedentMonths).toBe(6);
    expect(describeBulkSuggestion(s, '2026-09-11', money)).toBe('Last time you spread Salmon over 6 months.');
  });

  it('R0: scales the precedent by quantity when both sides carry the same unit', () => {
    const expenses = [
      row({
        expense_date: '2026-02-05',
        amount: 30000,
        bulk: { months: 3, start_month: '2026-02', suggested_months: null, basis: null, quantity: 15, unit: 'kg' },
      }),
    ];
    const s = estimate({ expenses, quantity: 30, unit: 'KG', amountCents: 40000 });
    expect(s.basis).toBe('own_precedent');
    expect(s.months).toBe(6);
  });

  it('R1: a recorded discount compares at regular price so a cheap bulk unit does not shorten the estimate', () => {
    const expenses = [
      row({ expense_date: '2026-05-10' }),
      row({ expense_date: '2026-06-10' }),
      row({ expense_date: '2026-07-10' }),
      row({ expense_date: '2026-08-10' }),
    ];
    const full = estimate({ expenses, amountCents: 40000, savedCents: 0 });
    const discounted = estimate({ expenses, amountCents: 40000, savedCents: 20000 });
    expect(discounted.rawMonths).toBeGreaterThan(full.rawMonths);
    expect(discounted.months).toBe(6);
    expect(full.months).toBe(4);
  });

  it('R2: lowers confidence when the cadence disagrees with the rate', () => {
    // Rate: $100 in Mar + $300 in Aug → $400 / 6 months → 6 months. Cadence: the median
    // gap is 2 days at $100 a time → $400 lasts ~8 days → 0.26 months. They disagree, so
    // four events over four months (otherwise "high") land on "medium".
    const expenses = [
      row({ expense_date: '2026-03-10' }),
      row({ expense_date: '2026-08-01' }),
      row({ expense_date: '2026-08-03' }),
      row({ expense_date: '2026-08-05' }),
    ];
    const s = estimate({ expenses });
    expect(s.basis).toBe('product_rate');
    expect(s.confidence).toBe('medium');
    expect(s.evidence.medianGapDays).toBe(2);
    expect(s.months).toBe(3);
  });

  it('R2: runs alone when every purchase sits in one calendar month', () => {
    const expenses = [
      row({ expense_date: '2026-08-02' }),
      row({ expense_date: '2026-08-12' }),
      row({ expense_date: '2026-08-22' }),
    ];
    const s = estimate({ expenses });
    expect(s.basis).toBe('product_cadence');
    expect(s.confidence).toBe('medium');
    // $400 / $100 = 4 gaps of 10 days = 40 days ≈ 1.3 months → looks regular-size, clamps to 2.
    expect(s.months).toBe(2);
    expect(s.looksRegularSize).toBe(true);
    expect(describeBulkSuggestion(s, '2026-09-11', money)).toBe(
      'Based on how often you buy Salmon: about every 10 days. Looks like a normal-size purchase for you, so two months is the minimum.',
    );
  });

  it('R3: learns from what the household calls the same thing through the lexicon', () => {
    const expenses = [
      row({ title: 'Fish', expense_date: '2026-04-10' }),
      row({ title: 'Fish', expense_date: '2026-06-10' }),
      row({ title: 'fish', expense_date: '2026-08-10' }),
    ];
    const s = estimate({
      expenses,
      lexiconRelatives: (name) => (name === 'salmon' ? ['fish', 'salmon', 'cod'] : []),
    });
    expect(s.basis).toBe('related_products');
    expect(s.confidence).toBe('medium');
    // $300 over Apr..Aug (5 months) = $60 → 6.67 → 7.
    expect(s.months).toBe(7);
    expect(s.evidence.relatedLabels).toEqual(['fish']);
    expect(describeBulkSuggestion(s, '2026-09-11', money)).toBe('Based on what you usually spend on fish.');
  });

  it('R3: learns through a receipt alias in either direction', () => {
    const expenses = [
      row({ title: 'ATL SALMON FLT', expense_date: '2026-05-10' }),
      row({ title: 'ATL SALMON FLT', expense_date: '2026-07-10' }),
    ];
    const s = estimate({
      expenses,
      aliases: [{ key: 'atl salmon flt', name: 'Salmon' }],
    });
    expect(s.basis).toBe('related_products');
    expect(s.evidence.relatedLabels).toEqual(['ATL SALMON FLT']);
  });

  it('R4: uses a narrow category, and refuses a broad one', () => {
    const narrow = [
      row({ title: 'Cod', expense_date: '2026-06-05', amount: 6000 }),
      row({ title: 'Tuna', expense_date: '2026-07-05', amount: 6000 }),
      row({ title: 'Cod', expense_date: '2026-08-05', amount: 6000 }),
    ];
    const s = estimate({ title: 'Halibut', expenses: narrow });
    expect(s.basis).toBe('category_rate');
    expect(s.confidence).toBe('low');
    // $180 over Jun..Aug = $60 a month → 6.67 → 7.
    expect(s.months).toBe(7);
    expect(describeBulkSuggestion(s, '2026-09-11', money)).toBe('Based on what you usually spend on Fish.');

    const broad = ['Milk', 'Bread', 'Eggs', 'Apples', 'Rice', 'Pasta', 'Cheese'].flatMap((title, i) => [
      row({ title, category_id: 'cat-groceries', expense_date: `2026-0${6 + (i % 3)}-1${i}`, amount: 3000 }),
    ]);
    const b = estimate({ title: 'Halibut', categoryId: 'cat-groceries', expenses: broad });
    expect(b.basis).toBe('default');
    expect(b.months).toBe(3);
  });

  it('never learns from the row being edited, and anchors the window on the purchase month', () => {
    const edited = row({ id: 'editing', expense_date: '2026-09-11', amount: 40000 });
    const expenses = [
      edited,
      row({ expense_date: '2026-03-10' }),
      row({ expense_date: '2026-05-12' }),
      row({ expense_date: '2026-07-08' }),
      // Later than the purchase — not history for it.
      row({ expense_date: '2026-11-01', amount: 99999 }),
    ];
    const s = estimate({ expenses, excludeExpenseId: 'editing' });
    expect(s.basis).toBe('product_rate');
    expect(s.months).toBe(8);
    expect(s.evidence.eventCount).toBe(3);
  });

  it('R0: the most recent precedent wins, whatever order the rows arrive in', () => {
    const older = row({
      expense_date: '2026-01-05',
      amount: 40000,
      bulk: { months: 8, start_month: '2026-01', suggested_months: null, basis: null },
    });
    const newer = row({
      expense_date: '2026-06-05',
      amount: 40000,
      bulk: { months: 2, start_month: '2026-06', suggested_months: null, basis: null },
    });
    expect(estimate({ expenses: [older, newer] }).months).toBe(2);
    expect(estimate({ expenses: [newer, older] }).months).toBe(2);
    // A precedent older than two years is history for the rate, not a decision to reuse.
    const ancient = row({
      expense_date: '2024-01-05',
      amount: 40000,
      bulk: { months: 8, start_month: '2024-01', suggested_months: null, basis: null },
    });
    expect(estimate({ expenses: [ancient] }).basis).toBe('default');
  });

  it('R3: reads a related stock-up as steady consumption and names the relatives newest first', () => {
    // A $600 "Fish" stock-up in March spread over 6 months, a $100 "Cod" in August.
    // Consumption Mar..Aug = $600 + $100 = $700 over 6 months = $116.67 → 3.43 → 3.
    const expenses = [
      row({
        title: 'Fish',
        expense_date: '2026-03-02',
        amount: 60000,
        bulk: { months: 6, start_month: '2026-03', suggested_months: null, basis: null },
      }),
      row({ title: 'Cod', expense_date: '2026-08-14' }),
    ];
    const s = estimate({
      expenses,
      lexiconRelatives: (name) => (name === 'salmon' ? ['fish', 'salmon', 'cod'] : []),
    });
    expect(s.basis).toBe('related_products');
    expect(s.months).toBe(3);
    expect(s.evidence.relatedLabels).toEqual(['Cod', 'Fish']);
  });

  it('R4: a broad category still counts as narrow when this product dominates it', () => {
    // Seven products, but one $1,000 halibut in June holds 85% of the category's
    // spend — a single event, so the product rungs stay silent and R4 decides.
    const expenses = [
      row({ title: 'Halibut', expense_date: '2026-06-03', amount: 100000 }),
      ...['Milk', 'Bread', 'Eggs', 'Apples', 'Rice', 'Pasta'].map((title, i) =>
        row({ title, expense_date: `2026-0${6 + (i % 3)}-1${i}`, amount: 3000 }),
      ),
    ];
    const s = estimate({ title: 'Halibut', expenses });
    expect(s.basis).toBe('category_rate');
    // $1,180 over Jun..Aug = $393.33 a month → $400 lasts 1.02 → looks regular-size → 2.
    expect(s.months).toBe(2);
    expect(s.looksRegularSize).toBe(true);
  });

  it('treats zero-amount history as no history', () => {
    const product = [
      row({ expense_date: '2026-06-10', amount: 0 }),
      row({ expense_date: '2026-07-10', amount: 0 }),
    ];
    expect(estimate({ expenses: product }).basis).toBe('default');

    const category = [
      row({ title: 'Cod', expense_date: '2026-06-05', amount: 0 }),
      row({ title: 'Cod', expense_date: '2026-07-05', amount: 0 }),
      row({ title: 'Cod', expense_date: '2026-08-05', amount: 0 }),
    ];
    expect(estimate({ title: 'Halibut', expenses: category }).basis).toBe('default');
  });

  it('describes a category estimate without a category name, and a related estimate without labels', () => {
    const noCategory = { ...estimate({ categoryId: null }), basis: 'category_rate' as const };
    expect(describeBulkSuggestion(noCategory, '2026-09-11', money)).toBe(
      'Based on what you usually spend on this category.',
    );
    const noLabels = { ...estimate({}), basis: 'related_products' as const };
    expect(describeBulkSuggestion(noLabels, '2026-09-11', money)).toBe('Based on what you usually spend on Salmon.');
    const priorYear = {
      ...estimate({}),
      basis: 'product_rate' as const,
      evidence: { ...estimate({}).evidence, eventCount: 2, firstEventDate: '2025-11-03', monthlyRateCents: null },
    };
    expect(describeBulkSuggestion(priorYear, '2026-09-11', money)).toBe(
      'Based on 2 purchases of Salmon since November 2025.',
    );
  });

  it('R1: two purchases in two months are enough for a medium-confidence rate, in any row order', () => {
    // Jul first, then Mar: the first-event date is still March. No cadence (needs 3).
    const expenses = [row({ expense_date: '2026-07-08' }), row({ expense_date: '2026-03-10' })];
    const s = estimate({ expenses });
    expect(s.basis).toBe('product_rate');
    expect(s.confidence).toBe('medium');
    expect(s.evidence.firstEventDate).toBe('2026-03-10');
    expect(s.evidence.medianGapDays).toBeNull();
  });

  it('R1: four purchases squeezed into three months stay medium before the cadence check', () => {
    // Events ≥ 4 but the span is only Jun..Aug: not "high" on its own. Cadence
    // agrees (monthly at $100 → 4 months), so it lifts the answer one notch.
    const expenses = [
      row({ expense_date: '2026-06-10' }),
      row({ expense_date: '2026-07-10' }),
      row({ expense_date: '2026-07-24' }),
      row({ expense_date: '2026-08-10' }),
    ];
    const s = estimate({ expenses });
    expect(s.basis).toBe('product_rate');
    expect(s.evidence.eventCount).toBe(4);
    expect(['medium', 'high']).toContain(s.confidence);
  });

  it('R3: names the relatives newest first whatever order the rows arrive in', () => {
    const expenses = [
      row({ title: 'Cod', expense_date: '2026-08-14' }),
      row({ title: 'Fish', expense_date: '2026-03-02' }),
      row({ title: 'Tuna', expense_date: '2026-06-01' }),
    ];
    const s = estimate({
      expenses,
      lexiconRelatives: (name) => (name === 'salmon' ? ['fish', 'cod', 'tuna', 'salmon'] : []),
    });
    expect(s.basis).toBe('related_products');
    expect(s.evidence.relatedLabels).toEqual(['Cod', 'Tuna', 'Fish']);
  });

  it('R2: three zero-amount days in one month are not a cadence', () => {
    const expenses = [
      row({ expense_date: '2026-08-02', amount: 0 }),
      row({ expense_date: '2026-08-12', amount: 0 }),
      row({ expense_date: '2026-08-22', amount: 0 }),
    ];
    expect(estimate({ expenses }).basis).toBe('default');
  });

  it('R3: a typed printed name learns from the household’s own name for it', () => {
    const expenses = [row({ title: 'Salmon', expense_date: '2026-05-10' }), row({ title: 'Salmon', expense_date: '2026-07-10' })];
    const s = estimate({
      title: 'ATL SALMON FLT',
      expenses,
      aliases: [{ key: 'atl salmon flt', name: 'Salmon' }],
    });
    expect(s.basis).toBe('related_products');
    expect(s.evidence.relatedLabels).toEqual(['Salmon']);
    expect(s.evidence.productLabel).toBe('ATL SALMON FLT');
  });

  it('R3: relatives the household never bought, or bought once, do not estimate', () => {
    const lexicon = (name: string) => (name === 'salmon' ? ['fish', 'salmon'] : []);
    expect(estimate({ expenses: [], lexiconRelatives: lexicon }).basis).toBe('default');
    const once = [row({ title: 'Fish', expense_date: '2026-06-10' })];
    expect(estimate({ expenses: once, lexiconRelatives: lexicon }).basis).toBe('default');
  });

  it('records the unit only when one was given, and a category name only when it exists', () => {
    const blank = estimate({ unit: '   ', quantity: 30 });
    expect(blank.evidence.unit).toBeNull();
    const unknown = estimate({ categoryId: 'cat-unknown' });
    expect(unknown.evidence.categoryName).toBeNull();
    expect(unknown.basis).toBe('default');
  });

  it('describes a rate without a first date or a monthly figure', () => {
    const bare = {
      ...estimate({}),
      basis: 'product_rate' as const,
      evidence: { ...estimate({}).evidence, eventCount: 5, firstEventDate: null, monthlyRateCents: null },
    };
    expect(describeBulkSuggestion(bare, '2026-09-11', money)).toBe('Based on 5 purchases of Salmon.');
    const nameless = { ...estimate({ title: '   ' }), evidence: { ...estimate({ title: '   ' }).evidence, productLabel: '' } };
    expect(describeBulkSuggestion(nameless, '2026-09-11', money)).toBe(
      'No history for this yet. Pick how many months it should last.',
    );
  });

  it('clamps to the 2..12 range', () => {
    const expenses = [
      row({ expense_date: '2026-07-01', amount: 100 }),
      row({ expense_date: '2026-08-01', amount: 100 }),
    ];
    const s = estimate({ expenses, amountCents: 1_000_000 });
    expect(s.months).toBe(12);
    expect(s.rawMonths).toBeGreaterThan(12);
  });
});
