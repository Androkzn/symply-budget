/**
 * Symply Health — `HealthFridgeAiService`'s PURE half: the receipt→drafts
 * mapping and the meal-plan normaliser.
 *
 * ⚠️ This whole service is UNCOMMITTED working-tree work at the time of writing
 * (the fridge's P5 barcode / receipt / meals surface). It arrived with no tests
 * of any kind. If that work is reverted rather than landed, this file goes with
 * it.
 *
 * Everything below is a pure function, which is the point: a model is in the
 * loop at runtime, so the only things that can be held to a contract are the
 * mappings either side of it. Each is exported precisely so it can be reasoned
 * about without a model, and each one is load-bearing:
 *
 *  - **`normalizeReceiptDraft`** decides what a person is offered to tick. A
 *    dropped line looks like a misread; a duplicated one is a fridge they have
 *    to tidy by hand.
 *  - **`looksLikeFood`** decides what is PRE-ticked. It is deliberately
 *    generous, because a false NO hides real shopping behind an unticked box
 *    while a false YES is one tap to undo.
 *  - **`normalizeMealPlan`** holds the model to the fridge it was given. Without
 *    the filter, "uses the chicken you have" is a hope; with it, it is a fact,
 *    and anything invented is moved to `missing_ingredients` where an
 *    ingredient you do not have belongs.
 *  - **`buildIngredientLines`** is WHAT THE MODEL WAS TOLD — the interesting
 *    half of any answer it gives, and the list the screen shows as "considered".
 */

import { describe, expect, it } from 'vitest';

import {
  buildIngredientLines,
  FRIDGE_CATEGORIES,
  looksLikeFood,
  MAX_MEAL_INGREDIENTS,
  MAX_MEAL_SUGGESTIONS,
  MAX_RECEIPT_ITEMS,
  MEAL_URGENT_DAYS,
  normalizeMealPlan,
  normalizeReceiptDraft,
  suggestedShelfLifeDays,
  toFridgeCategory,
  TYPICAL_SHELF_LIFE_DAYS,
  type MealPlannerItem,
} from '../health-fridge-ai-service';

const TODAY = '2026-06-10';

/** The ten categories the RN chip row offers, copied from the mobile module. */
const CLIENT_CATEGORIES = [
  'Dairy',
  'Meat',
  'Vegetables',
  'Fruits',
  'Grains',
  'Beverages',
  'Snacks',
  'Frozen',
  'Condiments',
  'Uncategorized',
];

function plannerItem(over: Partial<MealPlannerItem> = {}): MealPlannerItem {
  return {
    name: 'Milk',
    quantity: 1,
    unit: 'L',
    expiry_date: '2026-06-12',
    category: 'Dairy',
    ...over,
  } as MealPlannerItem;
}

/* ==================================================================== */
/* Vocabulary                                                            */
/* ==================================================================== */

describe('fridge AI — the closed category list', () => {
  it('HEALTH-FRIDGE-340: the model chooses from the SAME ten categories the app renders', () => {
    // The D1 column takes any string up to 50 characters so an older client is
    // never rejected — which means nothing but this list stops the model
    // inventing "Leftovers" and the review screen's picker having no chip for it.
    expect([...FRIDGE_CATEGORIES]).toEqual(CLIENT_CATEGORIES);
    expect(Object.keys(TYPICAL_SHELF_LIFE_DAYS).sort()).toEqual([...FRIDGE_CATEGORIES].sort());
  });

  it('HEALTH-FRIDGE-341: category matching is case- and whitespace-insensitive, and refuses the rest', () => {
    // A model answers "dairy", "Dairy" or " DAIRY " on different days. All three
    // are the same category; anything outside the list is `null`, which is what
    // makes the row unplaced rather than mis-placed.
    expect(toFridgeCategory('Dairy')).toBe('Dairy');
    expect(toFridgeCategory('dairy')).toBe('Dairy');
    expect(toFridgeCategory('  VEGETABLES  ')).toBe('Vegetables');
    expect(toFridgeCategory('Leftovers')).toBeNull();
    expect(toFridgeCategory('')).toBeNull();
    expect(toFridgeCategory(null)).toBeNull();
    expect(toFridgeCategory(42)).toBeNull();
    expect(toFridgeCategory(['Dairy'])).toBeNull();
  });

  it('HEALTH-FRIDGE-342: an UNCATEGORISED line is never given a shelf life', () => {
    // Guessing a date for something we could not even categorise would put a
    // number on the expiring-soon alarm with nothing behind it.
    expect(suggestedShelfLifeDays(null)).toBeNull();
    expect(suggestedShelfLifeDays('Uncategorized')).toBeNull();
    // …and the rest are conservative supermarket-to-fridge figures, shortest
    // for the things that actually spoil.
    expect(suggestedShelfLifeDays('Meat')).toBe(3);
    expect(suggestedShelfLifeDays('Dairy')).toBe(7);
    expect(suggestedShelfLifeDays('Frozen')).toBe(90);
    expect(suggestedShelfLifeDays('Condiments')).toBe(180);
    // Meat is the shortest of everything that has a figure at all.
    const figures = FRIDGE_CATEGORIES.map((c) => TYPICAL_SHELF_LIFE_DAYS[c]).filter(
      (d): d is number => d !== null
    );
    expect(Math.min(...figures)).toBe(3);
  });
});

/* ==================================================================== */
/* What is pre-ticked                                                    */
/* ==================================================================== */

describe('fridge AI — looksLikeFood', () => {
  it('HEALTH-FRIDGE-343: a placed category is food, an unplaced one is not', () => {
    expect(looksLikeFood('Tomatoes', 'Vegetables')).toBe(true);
    expect(looksLikeFood('Anything at all', 'Uncategorized')).toBe(true);
    // Null means the model could not place it in ANY of the ten — the primary
    // signal that this is not shopping for a fridge.
    expect(looksLikeFood('Phone cable', null)).toBe(false);
  });

  it('HEALTH-FRIDGE-344: the non-food word list overrides even a food category', () => {
    // `Uncategorized` is one of the ten, so a model reaching for it would turn a
    // carrier bag into a fridge item. These are the receipt lines that are
    // reliably not food and reliably named the same way.
    for (const name of [
      'Carrier bag',
      'BAG FEE',
      'Bottle deposit',
      'Delivery fee',
      'AA Batteries',
      'Light bulb',
      'Toilet tissue',
      'Kitchen foil',
      'Dog food',
      'Gift card',
      'Lottery',
      'Newspaper',
    ]) {
      expect([name, looksLikeFood(name, 'Uncategorized')]).toEqual([name, false]);
    }
  });

  it('HEALTH-FRIDGE-345: the filter errs towards SHOWING food, because a false no hides shopping', () => {
    // A false NO leaves real shopping behind an unticked box the person may not
    // notice; a false YES is one tap to undo. These are the names most likely to
    // trip a careless word list — and none of them may.
    for (const name of ['Bagels', 'Baguette', 'Cabbage', 'Feta', 'Catfish', 'Dogfish', 'Cauliflower']) {
      expect([name, looksLikeFood(name, 'Grains')]).toEqual([name, true]);
    }
  });
});

/* ==================================================================== */
/* Receipt → drafts                                                      */
/* ==================================================================== */

describe('fridge AI — normalizeReceiptDraft', () => {
  it('HEALTH-FRIDGE-346: a clean receipt maps line for line, with the shelf life attached', () => {
    const draft = normalizeReceiptDraft({
      vendor: '  Corner Shop  ',
      purchase_date: '2026-06-09',
      items: [
        { name: 'Tomatoes', category: 'Vegetables', amount: 249 },
        { name: 'Chicken thighs', category: 'Meat', amount: 675 },
      ],
    } as never);

    expect(draft.vendor).toBe('Corner Shop');
    expect(draft.purchase_date).toBe('2026-06-09');
    expect(draft.items).toEqual([
      {
        name: 'Tomatoes',
        category: 'Vegetables',
        suggested_expiry_days: 7,
        amount_cents: 249,
        looks_like_food: true,
      },
      {
        name: 'Chicken thighs',
        category: 'Meat',
        suggested_expiry_days: 3,
        amount_cents: 675,
        looks_like_food: true,
      },
    ]);
  });

  it('HEALTH-FRIDGE-347: repeated names are collapsed, case-insensitively', () => {
    // Two images of ONE long receipt can produce a repeat even though the prompt
    // merges by simplified name. A fridge holding "Milk" twice is a mess the
    // person has to tidy by hand.
    const draft = normalizeReceiptDraft({
      items: [
        { name: 'Milk', category: 'Dairy', amount: 120 },
        { name: 'milk', category: 'Dairy', amount: 120 },
        { name: 'MILK', category: 'Dairy', amount: 120 },
        { name: 'Milk chocolate', category: 'Snacks', amount: 200 },
      ],
    } as never);

    expect(draft.items.map((i) => i.name)).toEqual(['Milk', 'Milk chocolate']);
  });

  it('HEALTH-FRIDGE-348: an unnamed line is dropped; everything else is kept and FLAGGED', () => {
    // A row with no name cannot be rendered or saved. Everything else stays —
    // flagged rather than dropped — so a wrongly-classified line looks like a
    // tick to change, not a line the reader missed.
    const draft = normalizeReceiptDraft({
      items: [
        { name: '   ', category: 'Dairy' },
        { name: null, category: 'Dairy' },
        { name: 42, category: 'Dairy' },
        { name: 'Carrier bag', category: 'Uncategorized' },
        { name: 'Phone cable', category: 'Nonsense' },
        { name: 'Milk', category: 'Dairy' },
      ],
    } as never);

    expect(draft.items.map((i) => [i.name, i.looks_like_food])).toEqual([
      ['Carrier bag', false],
      ['Phone cable', false],
      ['Milk', true],
    ]);
    // An unplaced category is null and carries no suggested date.
    expect(draft.items[1]).toMatchObject({ category: null, suggested_expiry_days: null });
  });

  it('HEALTH-FRIDGE-349: amounts are cents, and a discount line is not a purchase', () => {
    const draft = normalizeReceiptDraft({
      items: [
        { name: 'A', category: 'Dairy', amount: 249.4 },
        { name: 'B', category: 'Dairy', amount: '350' },
        { name: 'C', category: 'Dairy', amount: -100 }, // a discount leaking through
        { name: 'D', category: 'Dairy', amount: 'free' },
        { name: 'E', category: 'Dairy' },
        { name: 'F', category: 'Dairy', amount: 0 },
      ],
    } as never);

    expect(draft.items.map((i) => i.amount_cents)).toEqual([249, 350, null, null, null, 0]);
  });

  it('HEALTH-FRIDGE-350: a junk vendor or purchase date is dropped rather than rendered', () => {
    // The vendor titles the review card and the date is shown as a purchase
    // date. "undefined" or a half-parsed string in either is worse than nothing.
    expect(normalizeReceiptDraft({ items: [] } as never)).toEqual({
      vendor: null,
      purchase_date: null,
      items: [],
    });
    expect(normalizeReceiptDraft({ vendor: '   ', purchase_date: '09/06/2026' } as never)).toEqual({
      vendor: null,
      purchase_date: null,
      items: [],
    });
    expect(normalizeReceiptDraft({ purchase_date: 20260609 } as never).purchase_date).toBeNull();
    // A very long vendor name is cut rather than allowed to fill the card.
    expect(normalizeReceiptDraft({ vendor: 'x'.repeat(400) } as never).vendor).toHaveLength(120);
  });

  it('HEALTH-FRIDGE-351: the list is capped so it stays reviewable', () => {
    // Every row is a decision the person has to make. Past the cap a review list
    // is not a review, and the extra rows are the least likely to be right.
    const draft = normalizeReceiptDraft({
      items: Array.from({ length: MAX_RECEIPT_ITEMS + 25 }, (_, i) => ({
        name: `Item ${i}`,
        category: 'Dairy',
      })),
    } as never);

    expect(draft.items).toHaveLength(MAX_RECEIPT_ITEMS);
    expect(draft.items[0].name).toBe('Item 0'); // the FIRST ones survive
    expect(draft.items.map((i) => i.name)).not.toContain(`Item ${MAX_RECEIPT_ITEMS + 1}`);
  });

  it('HEALTH-FRIDGE-352: a body that is not a receipt at all reads as an empty one', () => {
    // The model returns JSON that has been through a schema, but the declared
    // element type is a claim rather than a fact — a `500` here would be a
    // failed scan the person cannot act on.
    for (const raw of [{}, { items: null }, { items: 'nope' }, { items: [null, undefined, 7] }]) {
      expect(normalizeReceiptDraft(raw as never).items).toEqual([]);
    }
  });
});

/* ==================================================================== */
/* What the model is told                                                */
/* ==================================================================== */

describe('fridge AI — buildIngredientLines', () => {
  it('HEALTH-FRIDGE-353: the fridge is offered MOST URGENT first, with the days spelled out', () => {
    // The whole feature is "what should I cook before it goes off", so the
    // ordering IS the instruction. Expired first, then today, then the rest.
    const { lines, considered } = buildIngredientLines(
      [
        plannerItem({ name: 'Rice', expiry_date: null, quantity: null, unit: null }),
        plannerItem({ name: 'Bread', expiry_date: '2026-06-17' }),
        plannerItem({ name: 'Chicken', expiry_date: '2026-06-09', quantity: 500, unit: 'g' }),
        plannerItem({ name: 'Yoghurt', expiry_date: '2026-06-08' }),
        plannerItem({ name: 'Fish', expiry_date: TODAY, quantity: 2, unit: 'pc' }),
      ],
      TODAY
    );

    expect(considered).toEqual(['Yoghurt', 'Chicken', 'Fish', 'Bread', 'Rice']);
    expect(lines[0]).toBe('Yoghurt (1 L) — EXPIRED 2 days ago');
    expect(lines[1]).toBe('Chicken (500 g) — EXPIRED 1 day ago');
    expect(lines[2]).toBe('Fish (2 pc) — expires TODAY');
    expect(lines[3]).toBe('Bread (1 L) — 7 days left');
    // Undated goes LAST and says so — an unknown date is not "far away".
    expect(lines[4]).toBe('Rice — no expiry date recorded');
  });

  it('HEALTH-FRIDGE-354: singular and plural days are both written correctly', () => {
    const { lines } = buildIngredientLines(
      [
        plannerItem({ name: 'One', expiry_date: '2026-06-11', quantity: null, unit: null }),
        plannerItem({ name: 'Two', expiry_date: '2026-06-12', quantity: null, unit: null }),
      ],
      TODAY
    );
    expect(lines).toEqual(['One — 1 day left', 'Two — 2 days left']);
  });

  it('HEALTH-FRIDGE-355: a fractional quantity is rendered to one decimal, and none is rendered as nothing', () => {
    const { lines } = buildIngredientLines(
      [
        plannerItem({ name: 'Flour', expiry_date: null, quantity: 2.55, unit: 'kg' }),
        plannerItem({ name: 'Eggs', expiry_date: null, quantity: 6, unit: null }),
        plannerItem({ name: 'Salt', expiry_date: null, quantity: null, unit: 'g' }),
      ],
      TODAY
    );
    expect(lines).toEqual([
      'Eggs (6) — no expiry date recorded',
      // `(2.55).toFixed(1)` is "2.5", not "2.6": the stored double is
      // 2.54999…, so it rounds DOWN. Pinned rather than rounded by hand,
      // because this string is what the model is told the person has.
      'Flour (2.5 kg) — no expiry date recorded',
      'Salt — no expiry date recorded',
    ]);
  });

  it('HEALTH-FRIDGE-356: the prompt is capped, and the cap keeps the URGENT end', () => {
    // Beyond the cap the prompt is mostly noise — and if the cap dropped the
    // wrong end, the one feature this exists for (eat it before it goes off)
    // would be the part thrown away.
    const items = [
      ...Array.from({ length: MAX_MEAL_INGREDIENTS + 20 }, (_, i) =>
        plannerItem({ name: `Later ${i}`, expiry_date: '2026-12-01' })
      ),
      plannerItem({ name: 'Urgent', expiry_date: '2026-06-01' }),
    ];

    const { lines, considered } = buildIngredientLines(items, TODAY);

    expect(lines).toHaveLength(MAX_MEAL_INGREDIENTS);
    expect(considered[0]).toBe('Urgent');
    expect(considered).toHaveLength(MAX_MEAL_INGREDIENTS);
  });

  it('HEALTH-FRIDGE-357: an unparseable date is treated as UNDATED, never as expired', () => {
    // A cached or drifted row can carry something that is not a day key.
    // Sorting it as "most urgent" would push real, actually-expiring food off
    // the end of the capped prompt.
    const { lines } = buildIngredientLines(
      [
        plannerItem({ name: 'Junk', expiry_date: 'soon', quantity: null, unit: null }),
        plannerItem({ name: 'Real', expiry_date: '2026-06-11', quantity: null, unit: null }),
      ],
      TODAY
    );
    expect(lines).toEqual(['Real — 1 day left', 'Junk — no expiry date recorded']);
  });

  it('HEALTH-FRIDGE-358: an empty fridge produces an empty prompt rather than a fabricated one', () => {
    expect(buildIngredientLines([], TODAY)).toEqual({ lines: [], considered: [] });
  });
});

/* ==================================================================== */
/* The model held to the fridge it was given                             */
/* ==================================================================== */

describe('fridge AI — normalizeMealPlan', () => {
  const considered = ['Tomatoes', 'Onions', 'Pasta'];

  function meal(over: Record<string, unknown> = {}) {
    return {
      name: 'Tomato pasta',
      description: 'Quick.',
      ingredients_used: ['Tomatoes', 'Pasta'],
      missing_ingredients: ['Basil'],
      calories: 480,
      protein_g: 15,
      carbs_g: 80,
      fat_g: 9,
      instructions: ['Boil', 'Stir'],
      uses_expiring: ['Tomatoes'],
      prep_minutes: 20,
      ...over,
    };
  }

  it('HEALTH-FRIDGE-359: an honest plan passes through intact', () => {
    const plan = normalizeMealPlan({ meals: [meal()], notes: null } as never, considered);

    expect(plan.meals).toHaveLength(1);
    expect(plan.meals[0]).toMatchObject({
      name: 'Tomato pasta',
      ingredients_used: ['Tomatoes', 'Pasta'],
      missing_ingredients: ['Basil'],
      uses_expiring: ['Tomatoes'],
      prep_minutes: 20,
    });
  });

  it('HEALTH-FRIDGE-360: an INVENTED ingredient is moved to "missing", not silently kept', () => {
    // This is the difference between "uses the chicken you have" and a
    // suggestion that quietly assumes chicken. The prompt says to copy the names
    // verbatim; this filter is what makes that true rather than hoped-for.
    const plan = normalizeMealPlan(
      {
        meals: [
          meal({
            ingredients_used: ['Tomatoes', 'Chicken breast', 'Pasta'],
            missing_ingredients: ['Basil'],
          }),
        ],
      } as never,
      considered
    );

    expect(plan.meals[0].ingredients_used).toEqual(['Tomatoes', 'Pasta']);
    expect(plan.meals[0].missing_ingredients).toEqual(['Basil', 'Chicken breast']);
  });

  it('HEALTH-FRIDGE-361: matching is case-insensitive and answers with the FRIDGE spelling', () => {
    // The screen shows these names beside the fridge rows, so "tomatoes" and
    // "Tomatoes" reading as two different things would look like a bug.
    const plan = normalizeMealPlan(
      { meals: [meal({ ingredients_used: ['tomatoes', 'PASTA'], uses_expiring: ['tomatoes'] })] } as never,
      considered
    );

    expect(plan.meals[0].ingredients_used).toEqual(['Tomatoes', 'Pasta']);
    expect(plan.meals[0].uses_expiring).toEqual(['Tomatoes']);
  });

  it('HEALTH-FRIDGE-362: a meal that uses NOTHING from the fridge is dropped entirely', () => {
    // It is not an answer to the question this feature asks, and rendering it
    // would make the card a generic recipe list.
    const plan = normalizeMealPlan(
      {
        meals: [
          meal({ name: 'Steak frites', ingredients_used: ['Steak', 'Potatoes'] }),
          meal(),
        ],
        notes: null,
      } as never,
      considered
    );

    expect(plan.meals.map((m) => m.name)).toEqual(['Tomato pasta']);
  });

  it('HEALTH-FRIDGE-363: `uses_expiring` can only name something the meal actually uses', () => {
    // It drives the "uses what is going off" badge. Naming an item the meal does
    // not use would send a person to eat something the recipe never touches.
    const plan = normalizeMealPlan(
      {
        meals: [meal({ ingredients_used: ['Tomatoes'], uses_expiring: ['Onions', 'Tomatoes', 'Kale'] })],
      } as never,
      considered
    );

    expect(plan.meals[0].uses_expiring).toEqual(['Tomatoes']);
  });

  it('HEALTH-FRIDGE-364: duplicates are collapsed on both lists', () => {
    const plan = normalizeMealPlan(
      {
        meals: [
          meal({
            ingredients_used: ['Tomatoes', 'tomatoes', 'Pasta'],
            missing_ingredients: ['Basil', 'Basil'],
          }),
        ],
      } as never,
      considered
    );

    expect(plan.meals[0].ingredients_used).toEqual(['Tomatoes', 'Pasta']);
    expect(plan.meals[0].missing_ingredients).toEqual(['Basil']);
  });

  it('HEALTH-FRIDGE-365: at most three meals come back, whatever the model returns', () => {
    const plan = normalizeMealPlan(
      { meals: Array.from({ length: 9 }, (_, i) => meal({ name: `Meal ${i}` })) } as never,
      considered
    );
    expect(plan.meals).toHaveLength(MAX_MEAL_SUGGESTIONS);
    expect(plan.meals.map((m) => m.name)).toEqual(['Meal 0', 'Meal 1', 'Meal 2']);
  });

  it('HEALTH-FRIDGE-366: a nameless meal is dropped, and junk figures become null, never zero', () => {
    // `null` means "could not judge"; `0` would be a claim that the dish has no
    // calories in it, which a person might act on.
    const plan = normalizeMealPlan(
      {
        meals: [
          meal({ name: '   ' }),
          meal({
            name: 'Vague soup',
            calories: 'lots',
            protein_g: -4,
            carbs_g: null,
            fat_g: undefined,
            prep_minutes: 24.6,
          }),
        ],
      } as never,
      considered
    );

    expect(plan.meals.map((m) => m.name)).toEqual(['Vague soup']);
    expect(plan.meals[0]).toMatchObject({
      calories: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      prep_minutes: 25,
    });
  });

  it('HEALTH-FRIDGE-367: with no usable meal, the model NOTE survives — that is the answer', () => {
    // "There is not much to work with yet" is a real answer to "what could I
    // cook", and the screen renders it instead of an error.
    const plan = normalizeMealPlan(
      { meals: [], notes: '  Not much in there yet.  ' } as never,
      considered
    );
    expect(plan).toEqual({ meals: [], notes: 'Not much in there yet.' });

    // …and a body that is not a plan at all is an empty plan, not a throw.
    for (const raw of [{}, { meals: null }, { meals: 'nope' }]) {
      expect(normalizeMealPlan(raw as never, considered).meals).toEqual([]);
    }
  });

  it('HEALTH-FRIDGE-368: nothing survives when the fridge list is empty', () => {
    // Every ingredient is "invented" against an empty fridge, so every meal
    // fails the uses-something test. Answering with recipes for food the person
    // does not have is exactly what the filter exists to prevent.
    const plan = normalizeMealPlan({ meals: [meal()] } as never, []);
    expect(plan.meals).toEqual([]);
  });

  it('HEALTH-FRIDGE-369: the urgent window the planner uses is the donor 3 days', () => {
    // Exported so the prompt, the badge and any future filter agree on one
    // number rather than three copies of "3".
    expect(MEAL_URGENT_DAYS).toBe(3);
  });
});
