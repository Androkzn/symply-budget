/**
 * Symply Health Nutrition components — macro breakdown · meal detail · quick add.
 *
 * The Nutrition screen suite drives these through the real screen, which covers
 * one shape each. This suite drives them DIRECTLY, for the branches a screen
 * never reaches: the rounding edges where three shares would otherwise sum to 99
 * or 101, the invalid-edit path, the move picker, the per-tab empty copy, and
 * the "a portion you changed is worked out by the server" disclosure.
 *
 * The invariant it pins hardest: **no nutrition figure is derived here.** Quick
 * add renders the server's `serving` untouched, and changing the portion changes
 * NOTHING on screen — it only changes what gets sent.
 */

import React from 'react';
import { Platform } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import type { FoodItem, FoodSuggestion } from '../../healthFoodStorage';
import type { MealEntry } from '../../healthNutritionStorage';
import {
  HealthMacroBreakdown,
  MACRO_SERIES,
  macroSplitPercentages,
} from '../HealthMacroBreakdown';
import { HealthMealDetail, patchFromDraft, portionFromDraft } from '../HealthMealDetail';
import { HealthQuickAdd, emptyCopy, reasonLabel } from '../HealthQuickAdd';

/** Run `body` as if the app were on Android, then put the platform back. */
function onAndroid(body: () => void) {
  const original = Platform.OS;
  Platform.OS = 'android';
  try {
    body();
  } finally {
    Platform.OS = original;
  }
}

type Rendered = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Rendered {
  let tree!: Rendered;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

function byTestId(tree: Rendered, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

/** Flatten every string in a rendered subtree, preserving concatenation. */
function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function textOf(tree: Rendered, id: string): string {
  return allText(byTestId(tree, id)[0] ?? null);
}

/** Fire onPress on the composite carrying `testID` (Pressable, not its host View). */
function press(tree: Rendered, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  act(() => node.props.onPress());
}

function input(tree: Rendered, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID
  );
}

function type(tree: Rendered, testID: string, text: string) {
  act(() => input(tree, testID).props.onChangeText(text));
}

/**
 * A meal row's edit/move/delete now live behind one "more" button instead of
 * three permanently-visible icons. This opens the menu and presses one of the
 * three actions in a single step, mirroring how a user actually gets there.
 *
 * Kept as two SEPARATE `act()` calls at the call site rather than folded into
 * one — nesting both presses inside a single outer `act(async () => …)`
 * defers the first press's commit until the callback's promise settles, so
 * the second press's `find()` runs against the pre-toggle tree and misses.
 */
function chooseRowAction(tree: Rendered, id: string, action: 'edit' | 'move' | 'delete') {
  act(() => press(tree, `health-meal-more-${id}`));
  act(() => press(tree, `health-meal-menu-${action}-${id}`));
}

/** Flattened style of a host node (RN hands styles over as arrays). */
function styleOf(node: ReactTestRenderer.ReactTestInstance): Record<string, unknown> {
  const style = node.props?.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style.flat(3).filter(Boolean)) : style;
  return (flat ?? {}) as Record<string, unknown>;
}

function meal(over: Partial<MealEntry> = {}): MealEntry {
  return {
    id: over.id ?? 'm1',
    date: over.date ?? '2026-07-13',
    slot: over.slot ?? 'lunch',
    name: over.name ?? 'Soup',
    calories: over.calories ?? 300,
    protein: over.protein ?? 20,
    carbs: over.carbs ?? 30,
    fat: over.fat ?? 10,
    loggedAt: over.loggedAt ?? '2026-07-13T10:00:00.000Z',
    // The 0124 provenance fields (`portion` / `unit` / `canReportion`) are
    // absent by default — a hand-typed row has no basis to rescale from — so a
    // test that wants the re-portionable shape has to ask for it.
    ...over,
  };
}

function food(over: Partial<FoodItem> = {}): FoodItem {
  return {
    id: over.id ?? 'cf_1',
    name: over.name ?? 'Oats',
    brand: over.brand ?? null,
    portion: over.portion ?? 100,
    unit: over.unit ?? 'g',
    serving: over.serving ?? { calories: 380, protein: 13, carbs: 60, fat: 7 },
    isFavorite: over.isFavorite ?? false,
    useCount: over.useCount ?? 0,
    lastUsedAt: over.lastUsedAt ?? null,
    updatedAt: over.updatedAt ?? '2026-07-13T08:00:00.000Z',
  };
}

function suggestion(over: Partial<FoodSuggestion> = {}): FoodSuggestion {
  return {
    food: over.food ?? food(),
    score: over.score ?? 0.8,
    reasons: over.reasons ?? ['time_based_match'],
  };
}

/* ------------------------------------------------------------------ */
/* Macro breakdown                                                     */
/* ------------------------------------------------------------------ */

describe('macroSplitPercentages', () => {
  it('HEALTH-NUTR-070: an even three-way split still sums to exactly 100', () => {
    // The textbook failure: 33.33 three times rounds to 99.
    const split = macroSplitPercentages({ protein: 10, carbs: 10, fat: 10 });
    expect(split.protein + split.carbs + split.fat).toBe(100);
    // The leftover point goes to the first slot in the fixed series order.
    expect([split.protein, split.carbs, split.fat]).toEqual([34, 33, 33]);
  });

  it('HEALTH-NUTR-071: a two-point leftover is handed to the two largest remainders', () => {
    // 16.67 / 16.67 / 66.67 → floors 16/16/66 = 98, so two points are owed.
    const split = macroSplitPercentages({ protein: 10, carbs: 10, fat: 40 });
    expect(split.protein + split.carbs + split.fat).toBe(100);
    expect([split.protein, split.carbs, split.fat]).toEqual([17, 17, 66]);
  });

  it('HEALTH-NUTR-072: shares that are already whole are left alone', () => {
    const split = macroSplitPercentages({ protein: 50, carbs: 25, fat: 25 });
    expect([split.protein, split.carbs, split.fat]).toEqual([50, 25, 25]);
    expect(split.total).toBe(100);
  });

  it('HEALTH-NUTR-073: a single macro takes the whole 100', () => {
    const split = macroSplitPercentages({ protein: 0, carbs: 0, fat: 12 });
    expect([split.protein, split.carbs, split.fat]).toEqual([0, 0, 100]);
  });

  it('HEALTH-NUTR-074: nothing logged reports zeros AND a zero total', () => {
    // `total: 0` is what lets a caller tell "no data" from a real 0% share.
    expect(macroSplitPercentages({ protein: 0, carbs: 0, fat: 0 })).toEqual({
      protein: 0,
      carbs: 0,
      fat: 0,
      total: 0,
    });
  });

  it('HEALTH-NUTR-075: junk values are treated as zero, never as NaN percentages', () => {
    const split = macroSplitPercentages({
      protein: Number.NaN,
      carbs: -5,
      fat: 20,
    } as never);
    expect([split.protein, split.carbs, split.fat]).toEqual([0, 0, 100]);
    expect(split.total).toBe(20);
  });

  it('HEALTH-NUTR-076: awkward decimals still sum to 100', () => {
    for (const grams of [
      { protein: 1, carbs: 1, fat: 1 },
      { protein: 7, carbs: 11, fat: 13 },
      { protein: 0.1, carbs: 0.2, fat: 0.3 },
      { protein: 33, carbs: 33, fat: 34 },
      { protein: 1, carbs: 2, fat: 96 },
    ]) {
      const split = macroSplitPercentages(grams);
      expect(split.protein + split.carbs + split.fat).toBe(100);
    }
  });
});

describe('HealthMacroBreakdown', () => {
  it('HEALTH-NUTR-077: says what is missing instead of drawing an empty bar', () => {
    const tree = render(<HealthMacroBreakdown totals={{ protein: 0, carbs: 0, fat: 0 }} />);

    expect(byTestId(tree, 'health-macro-breakdown-empty').length).toBe(1);
    expect(byTestId(tree, 'health-macro-breakdown-bar').length).toBe(0);
  });

  it('HEALTH-NUTR-078: lays the bar out from the SAME rounded values it labels', () => {
    const tree = render(<HealthMacroBreakdown totals={{ protein: 10, carbs: 10, fat: 10 }} />);

    // A segment labelled 34% must be 34% wide, or the picture contradicts the text.
    for (const [key, expected] of [
      ['protein', 34],
      ['carbs', 33],
      ['fat', 33],
    ] as const) {
      const segment = byTestId(tree, `health-macro-breakdown-segment-${key}`)[0];
      expect(styleOf(segment).flexGrow).toBe(expected);
      expect(textOf(tree, `health-macro-breakdown-legend-${key}`)).toContain(`${expected}%`);
    }
  });

  it('HEALTH-NUTR-079: a zero share draws no segment but keeps its legend row', () => {
    const tree = render(<HealthMacroBreakdown totals={{ protein: 40, carbs: 60, fat: 0 }} />);

    expect(byTestId(tree, 'health-macro-breakdown-segment-fat').length).toBe(0);
    // Identity is never colour-alone: every macro keeps a labelled legend entry.
    expect(textOf(tree, 'health-macro-breakdown-legend-fat')).toContain('0%');
  });

  it('HEALTH-NUTR-080: a narrow segment drops its inline label rather than clipping it', () => {
    const tree = render(<HealthMacroBreakdown totals={{ protein: 98, carbs: 1, fat: 1 }} />);

    const sliver = byTestId(tree, 'health-macro-breakdown-segment-carbs')[0];
    expect(allText(sliver)).toBe('');
    expect(allText(byTestId(tree, 'health-macro-breakdown-segment-protein')[0])).toContain('98%');

    // The threshold is a fit judgement, not a "is it visible" one: 15% is a
    // drawable segment that still cannot hold "C 15%" on a small phone, so the
    // legend carries it — but the value is never lost.
    const narrow = render(<HealthMacroBreakdown totals={{ protein: 85, carbs: 15, fat: 0 }} />);
    expect(byTestId(narrow, 'health-macro-breakdown-segment-carbs').length).toBe(1);
    expect(allText(byTestId(narrow, 'health-macro-breakdown-segment-carbs')[0])).toBe('');
    expect(textOf(narrow, 'health-macro-breakdown-legend-carbs')).toContain('15%');
  });

  it('HEALTH-NUTR-081: the bar announces the whole split, and each legend row its grams', () => {
    const tree = render(<HealthMacroBreakdown totals={{ protein: 40, carbs: 40, fat: 20 }} />);

    expect(byTestId(tree, 'health-macro-breakdown-bar')[0].props.accessibilityLabel).toBe(
      'Macro split: Protein 40%, Carbs 40%, Fat 20%'
    );
    expect(
      byTestId(tree, 'health-macro-breakdown-legend-protein')[0].props.accessibilityLabel
    ).toBe('Protein: 40 grams, 40 percent of macro grams');
  });

  it('HEALTH-NUTR-201: a fractional gram figure keeps one decimal, and only one', () => {
    // Server macros are not whole numbers — a 37 g portion of anything lands on
    // a fraction. Rounding to integers here would print a gram total that does
    // not match the diary row it came from; printing the raw float would give a
    // legend reading "12.399999999999999 g".
    const tree = render(<HealthMacroBreakdown totals={{ protein: 12.34, carbs: 7.5, fat: 4 }} />);

    const protein = byTestId(tree, 'health-macro-breakdown-legend-protein')[0].props
      .accessibilityLabel as string;
    expect(protein).toContain('12.3 grams');
    expect(
      byTestId(tree, 'health-macro-breakdown-legend-carbs')[0].props.accessibilityLabel
    ).toContain('7.5 grams');
    // A whole number stays whole — no gratuitous "4.0 g".
    expect(byTestId(tree, 'health-macro-breakdown-legend-fat')[0].props.accessibilityLabel).toContain(
      '4 grams'
    );
  });

  it('HEALTH-NUTR-082: the split is labelled as grams, never as energy', () => {
    // Turning grams into calories means 4/4/9 on the device — the exact
    // recompute this architecture forbids. The header has to say so.
    const tree = render(<HealthMacroBreakdown totals={{ protein: 10, carbs: 10, fat: 10 }} />);
    expect(allText(tree.toJSON())).toContain('% OF MACRO GRAMS');
  });

  it('HEALTH-NUTR-083: each macro keeps its own colour, in a fixed order', () => {
    const tree = render(<HealthMacroBreakdown totals={{ protein: 30, carbs: 30, fat: 40 }} />);

    // Fat is the largest slice here, but colour follows the macro, never rank.
    for (const series of MACRO_SERIES) {
      const segment = byTestId(tree, `health-macro-breakdown-segment-${series.key}`)[0];
      expect(styleOf(segment).backgroundColor).toBe(series.color);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Meal detail                                                         */
/* ------------------------------------------------------------------ */

describe('HealthMealDetail', () => {
  function setup(entries: MealEntry[], over: Partial<React.ComponentProps<typeof HealthMealDetail>> = {}) {
    const onSaveEntry = jest.fn();
    const onMoveEntry = jest.fn();
    const onDeleteEntry = jest.fn();
    const tree = render(
      <HealthMealDetail
        slot="lunch"
        entries={entries}
        onSaveEntry={onSaveEntry}
        onMoveEntry={onMoveEntry}
        onDeleteEntry={onDeleteEntry}
        {...over}
      />
    );
    return { tree, onSaveEntry, onMoveEntry, onDeleteEntry };
  }

  it('HEALTH-NUTR-084: an empty slot says so in its own words', () => {
    const { tree } = setup([]);

    expect(byTestId(tree, 'health-meal-detail-lunch-empty').length).toBe(1);
    expect(textOf(tree, 'health-meal-detail-lunch-empty')).toContain('lunch');
  });

  it('HEALTH-NUTR-085: each item shows its calories and its three macros', () => {
    const { tree } = setup([meal({ id: 'a', name: 'Soup', calories: 300 })]);

    expect(textOf(tree, 'health-meal-item-a-kcal')).toBe('300 kcal');
    const row = allText(byTestId(tree, 'health-meal-item-a')[0]);
    expect(row).toContain('P 20g');
    expect(row).toContain('C 30g');
    expect(row).toContain('F 10g');
  });

  it('HEALTH-NUTR-086: editing an item hands the caller the parsed patch', () => {
    const { tree, onSaveEntry } = setup([meal({ id: 'a' })]);

    chooseRowAction(tree, 'a', 'edit');
    type(tree, 'health-meal-edit-name-a', 'Lentil soup');
    type(tree, 'health-meal-edit-calories-a', '420');
    type(tree, 'health-meal-edit-protein-a', '25');
    press(tree, 'health-meal-edit-save-a');

    expect(onSaveEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      { name: 'Lentil soup', calories: 420, protein: 25, carbs: 30, fat: 10 }
    );
    // The editor closes on a good save.
    expect(byTestId(tree, 'health-meal-edit-a-form').length).toBe(0);
  });

  it('HEALTH-NUTR-087: the editor opens seeded with the row it is editing', () => {
    const { tree } = setup([meal({ id: 'a', name: 'Soup', calories: 300 })]);

    chooseRowAction(tree, 'a', 'edit');
    expect(input(tree, 'health-meal-edit-name-a').props.value).toBe('Soup');
    expect(input(tree, 'health-meal-edit-calories-a').props.value).toBe('300');
    expect(input(tree, 'health-meal-edit-fat-a').props.value).toBe('10');
  });

  it('HEALTH-NUTR-088: a zero-calorie edit is refused with friendly copy, not a raw error', () => {
    const { tree, onSaveEntry } = setup([meal({ id: 'a' })]);

    chooseRowAction(tree, 'a', 'edit');
    type(tree, 'health-meal-edit-calories-a', '0');
    press(tree, 'health-meal-edit-save-a');

    expect(onSaveEntry).not.toHaveBeenCalled();
    const message = textOf(tree, 'health-meal-edit-error-a');
    expect(message).toContain('Calories must be a number above zero');
    expect(message).not.toMatch(/error|Error|undefined|null/);
    // The form stays open with the user's input intact.
    expect(byTestId(tree, 'health-meal-edit-a-form').length).toBe(1);
  });

  it('HEALTH-NUTR-089: cancelling drops the draft and reopens from the stored row', () => {
    const { tree, onSaveEntry } = setup([meal({ id: 'a', calories: 300 })]);

    chooseRowAction(tree, 'a', 'edit');
    type(tree, 'health-meal-edit-calories-a', '999');
    press(tree, 'health-meal-edit-cancel-a');
    expect(onSaveEntry).not.toHaveBeenCalled();

    chooseRowAction(tree, 'a', 'edit');
    expect(input(tree, 'health-meal-edit-calories-a').props.value).toBe('300');
  });

  it('HEALTH-NUTR-090: moving offers every OTHER slot and reports the choice', () => {
    const { tree, onMoveEntry } = setup([meal({ id: 'a', slot: 'lunch' })]);

    chooseRowAction(tree, 'a', 'move');
    expect(byTestId(tree, 'health-meal-move-a-lunch').length).toBe(0);
    for (const target of ['breakfast', 'dinner', 'snacks']) {
      expect(byTestId(tree, `health-meal-move-a-${target}`).length).toBe(1);
    }

    press(tree, 'health-meal-move-a-dinner');
    expect(onMoveEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'dinner');
    // The picker closes once a target is chosen.
    expect(byTestId(tree, 'health-meal-move-a-options').length).toBe(0);
  });

  it('HEALTH-NUTR-091: deleting reports the whole entry, and the id survives', () => {
    const { tree, onDeleteEntry } = setup([meal({ id: 'gone', name: 'Soup' })]);

    chooseRowAction(tree, 'gone', 'delete');
    expect(onDeleteEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'gone' }));
  });

  it('HEALTH-NUTR-092: a row being written locks its own controls only', () => {
    const { tree } = setup([meal({ id: 'a' }), meal({ id: 'b' })], { busyEntryId: 'a' });

    expect(byTestId(tree, 'health-meal-more-a')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(byTestId(tree, 'health-meal-more-b')[0].props.accessibilityState).toEqual({
      disabled: false,
    });
  });

  it('HEALTH-NUTR-093: every control carries a testID and a spoken label', () => {
    /** At least one node under `testID` must announce itself to a screen reader. */
    const isLabelled = (tree: Rendered, testID: string) =>
      tree.root
        .findAll((n) => n.props?.testID === testID)
        .some(
          (n) =>
            typeof n.props?.accessibilityLabel === 'string' &&
            n.props.accessibilityLabel.length > 0
        );

    const { tree } = setup([meal({ id: 'a', name: 'Soup' })]);
    press(tree, 'health-meal-more-a');

    for (const id of [
      'health-meal-more-a',
      'health-meal-menu-edit-a',
      'health-meal-menu-move-a',
      'health-meal-menu-delete-a',
    ]) {
      expect([id, isLabelled(tree, id)]).toEqual([id, true]);
    }

    press(tree, 'health-meal-menu-edit-a');
    for (const id of [
      'health-meal-edit-save-a',
      'health-meal-edit-cancel-a',
      'health-meal-edit-name-a',
      'health-meal-edit-calories-a',
      'health-meal-edit-protein-a',
      'health-meal-edit-carbs-a',
      'health-meal-edit-fat-a',
    ]) {
      expect([id, isLabelled(tree, id)]).toEqual([id, true]);
    }

    // The move picker replaces the editor, so its targets are checked after.
    chooseRowAction(tree, 'a', 'move');
    for (const target of ['breakfast', 'dinner', 'snacks']) {
      expect([target, isLabelled(tree, `health-meal-move-a-${target}`)]).toEqual([target, true]);
    }
  });

  it('HEALTH-NUTR-094: patchFromDraft rejects what the editor must not save', () => {
    // `portion` is on the draft (0124) but is NOT part of a typed patch — it
    // goes to the server's re-derive route instead, so it never reaches here.
    const good = {
      name: ' Soup ',
      calories: '300',
      protein: '20',
      carbs: '30',
      fat: '10',
      portion: '150',
    };
    expect(patchFromDraft(good)).toEqual({
      name: 'Soup',
      calories: 300,
      protein: 20,
      carbs: 30,
      fat: 10,
    });

    expect(patchFromDraft({ ...good, calories: '' })).toBeNull();
    expect(patchFromDraft({ ...good, calories: '0' })).toBeNull();
    expect(patchFromDraft({ ...good, calories: '999999' })).toBeNull();
    expect(patchFromDraft({ ...good, protein: 'lots' })).toBeNull();
    // Blank macros are a legitimate zero, not a rejection.
    expect(patchFromDraft({ ...good, fat: '' })?.fat).toBe(0);
  });

  it('HEALTH-NUTR-110: a portion keeps its halves but never leaves what the route accepts', () => {
    // Half a serving is a real portion, so this is the one figure in the editor
    // that is NOT rounded — rounding it would ask the server to re-derive from a
    // basis the user never typed.
    expect(portionFromDraft('1.5')).toBe(1.5);
    // A comma decimal separator is what most of Europe's keypads produce.
    expect(portionFromDraft('1,5')).toBe(1.5);

    // Everything the route's `z.number().positive().max(1000)` would 400 on is
    // caught here instead, so the failure is friendly copy rather than an error.
    expect(portionFromDraft('0')).toBeNull();
    expect(portionFromDraft('-2')).toBeNull();
    expect(portionFromDraft('1001')).toBeNull();
    expect(portionFromDraft('half')).toBeNull();
    // Blank is "not answered yet", not zero — the field is empty on a row that
    // has no stored portion.
    expect(portionFromDraft('')).toBeNull();
    expect(portionFromDraft('   ')).toBeNull();
    expect(portionFromDraft(undefined as unknown as string)).toBeNull();
  });

  it('HEALTH-NUTR-111: an unusable portion is refused in words, and nothing is sent', () => {
    const onReportionEntry = jest.fn();
    const { tree } = setup([meal({ id: 'a', canReportion: true, portion: 150, unit: 'g' })], {
      onReportionEntry,
    });

    chooseRowAction(tree, 'a', 'edit');
    type(tree, 'health-meal-portion-a', '0');
    press(tree, 'health-meal-portion-apply-a');

    expect(onReportionEntry).not.toHaveBeenCalled();
    const note = textOf(tree, 'health-meal-portion-note-a');
    expect(note).toContain('above zero');
    expect(note).not.toMatch(/error|Error|undefined|null|NaN/);
    // The editor stays open on the number the user typed, so it can be fixed.
    expect(byTestId(tree, 'health-meal-edit-a-form').length).toBe(1);
    expect(input(tree, 'health-meal-portion-a').props.value).toBe('0');
  });

  it('HEALTH-NUTR-112: a re-portionable row with no unit shows the bare portion', () => {
    // `unit` is optional on the wire; appending an empty one gives "150 " and
    // labels the field "Portion ()".
    const { tree } = setup([meal({ id: 'a', canReportion: true, portion: 2 })], {
      onReportionEntry: jest.fn(),
    });

    expect(textOf(tree, 'health-meal-item-a-kcal')).toBe('300 kcal · 2');
    chooseRowAction(tree, 'a', 'edit');
    expect(textOf(tree, 'health-meal-portion-a-row')).toBe('PortionRescale');
  });

  it('HEALTH-NUTR-113: the "more" menu is a toggle, and Move closes an editor left open', () => {
    // Edit/move/delete live behind one "more" button now, and leaving an
    // editor open behind a move picker gives one row two competing ways to
    // change it — so choosing Move from the menu closes an open editor.
    const { tree } = setup([meal({ id: 'a', name: 'Soup' })]);

    press(tree, 'health-meal-more-a');
    expect(byTestId(tree, 'health-meal-more-a')[0].props.accessibilityLabel).toBe(
      'Close actions for Soup'
    );
    press(tree, 'health-meal-more-a');
    expect(byTestId(tree, 'health-meal-menu-a').length).toBe(0);
    expect(byTestId(tree, 'health-meal-more-a')[0].props.accessibilityLabel).toBe(
      'Actions for Soup'
    );

    chooseRowAction(tree, 'a', 'edit');
    expect(byTestId(tree, 'health-meal-edit-a-form').length).toBe(1);

    chooseRowAction(tree, 'a', 'move');
    expect(byTestId(tree, 'health-meal-edit-a-form').length).toBe(0);
    expect(byTestId(tree, 'health-meal-move-a-options').length).toBe(1);
  });

  it('HEALTH-NUTR-114: every macro field reaches the patch, carbs and fat included', () => {
    const { tree, onSaveEntry } = setup([meal({ id: 'a' })]);

    chooseRowAction(tree, 'a', 'edit');
    type(tree, 'health-meal-edit-carbs-a', '55');
    type(tree, 'health-meal-edit-fat-a', '12');
    press(tree, 'health-meal-edit-save-a');

    expect(onSaveEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), {
      name: 'Soup',
      calories: 300,
      protein: 20,
      carbs: 55,
      fat: 12,
    });
  });

  it('HEALTH-NUTR-119: rescaling sends the portion and never writes the typed figures', () => {
    const onReportionEntry = jest.fn();
    const { tree, onSaveEntry } = setup(
      [meal({ id: 'a', canReportion: true, portion: 100, unit: 'g' })],
      { onReportionEntry }
    );

    chooseRowAction(tree, 'a', 'edit');
    type(tree, 'health-meal-portion-a', '150');
    press(tree, 'health-meal-portion-apply-a');

    // The macros are the SERVER's job — this button only says how much was eaten.
    expect(onReportionEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 150);
    expect(onSaveEntry).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-meal-edit-a-form').length).toBe(0);
  });

  it('HEALTH-NUTR-120: selection mode replaces every row action with one tick box', () => {
    const onToggleSelect = jest.fn();
    const { tree } = setup([meal({ id: 'a', name: 'Soup' }), meal({ id: 'b', name: 'Toast' })], {
      onToggleSelect,
      selectedIds: ['a'],
    });

    // Two competing ways to change one row is how the wrong row gets deleted,
    // so the "more" button is rendered AWAY rather than merely hidden.
    expect(byTestId(tree, 'health-meal-more-a').length).toBe(0);

    // The underlying Pressable always spreads the full accessibilityState
    // shape (busy/disabled/expanded included as `undefined` when unset) —
    // semantically identical to `{checked, selected}` alone, but that is what
    // the rendered tree actually carries.
    expect(byTestId(tree, 'health-meal-select-a')[0].props.accessibilityState).toEqual({
      checked: true,
      selected: true,
      busy: undefined,
      disabled: undefined,
      expanded: undefined,
    });
    expect(byTestId(tree, 'health-meal-select-b')[0].props.accessibilityState).toEqual({
      checked: false,
      selected: false,
      busy: undefined,
      disabled: undefined,
      expanded: undefined,
    });

    press(tree, 'health-meal-select-b');
    expect(onToggleSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('HEALTH-NUTR-115: the amount fields ask for a number keypad on Android as well', () => {
    onAndroid(() => {
      const { tree } = setup([meal({ id: 'a' })]);
      chooseRowAction(tree, 'a', 'edit');
      // Android has no `decimal-pad`; asking for it there falls back to the full
      // keyboard, which is a letter keyboard for a grams field.
      expect(input(tree, 'health-meal-edit-calories-a').props.keyboardType).toBe('numeric');
      expect(input(tree, 'health-meal-edit-fat-a').props.keyboardType).toBe('numeric');
    });
  });
});

/* ------------------------------------------------------------------ */
/* Quick add                                                           */
/* ------------------------------------------------------------------ */

describe('HealthQuickAdd', () => {
  function setup(over: Partial<React.ComponentProps<typeof HealthQuickAdd>> = {}) {
    const onLogFood = jest.fn();
    const onLogCalories = jest.fn();
    const tree = render(
      <HealthQuickAdd
        slot="lunch"
        suggestions={[]}
        favorites={[]}
        recents={[]}
        onLogFood={onLogFood}
        onLogCalories={onLogCalories}
        {...over}
      />
    );
    return { tree, onLogFood, onLogCalories };
  }

  it('HEALTH-NUTR-095: opens on suggestions and offers the library tabs', () => {
    const { tree } = setup();

    expect(byTestId(tree, 'health-quick-add-tab-suggested')[0].props.accessibilityState).toEqual({
      selected: true,
    });
    expect(byTestId(tree, 'health-quick-add-tab-favorites').length).toBe(1);
    expect(byTestId(tree, 'health-quick-add-tab-recent').length).toBe(1);
  });

  it('HEALTH-NUTR-096: each empty tab explains itself in its own terms', () => {
    const { tree } = setup();
    expect(textOf(tree, 'health-quick-add-empty')).toContain('suggestions for this time of day');

    press(tree, 'health-quick-add-tab-favorites');
    expect(textOf(tree, 'health-quick-add-empty')).toContain('Star a food');

    press(tree, 'health-quick-add-tab-recent');
    expect(textOf(tree, 'health-quick-add-empty')).toContain('Foods you log');
  });

  it('HEALTH-NUTR-097: an unreachable suggestions service degrades, it does not blank', () => {
    const { tree } = setup({ suggestionsUnavailable: true, favorites: [food()] });

    expect(textOf(tree, 'health-quick-add-empty')).toContain('need a connection');
    // Favourites still work offline — the cache is behind them.
    press(tree, 'health-quick-add-tab-favorites');
    expect(byTestId(tree, 'health-quick-add-food-cf_1').length).toBe(1);
  });

  it('HEALTH-NUTR-098: a suggestion shows the SERVER figures and why it was offered', () => {
    const { tree } = setup({ suggestions: [suggestion({ reasons: ['favorite'] })] });

    const row = allText(byTestId(tree, 'health-quick-add-row-cf_1')[0]);
    expect(row).toContain('380 kcal per 100 g');
    expect(row).toContain('P 13g');
    expect(textOf(tree, 'health-quick-add-reason-cf_1')).toBe('Favourite');
  });

  it('HEALTH-NUTR-099: choosing a food seeds the portion with the food’s own', () => {
    const { tree } = setup({ favorites: [food({ portion: 40, unit: 'g' })] });

    press(tree, 'health-quick-add-tab-favorites');
    expect(byTestId(tree, 'health-quick-add-portion-cf_1').length).toBe(0);

    press(tree, 'health-quick-add-food-cf_1');
    expect(input(tree, 'health-quick-add-portion-cf_1').props.value).toBe('40');
  });

  it('HEALTH-NUTR-100: logging sends the portion and lets the server do the maths', () => {
    const item = food({ portion: 100 });
    const { tree, onLogFood } = setup({ favorites: [item] });

    press(tree, 'health-quick-add-tab-favorites');
    press(tree, 'health-quick-add-food-cf_1');
    type(tree, 'health-quick-add-portion-cf_1', '250');
    press(tree, 'health-quick-add-log-cf_1');

    expect(onLogFood).toHaveBeenCalledWith(item, 250);
    // Crucially, the row still shows the food's OWN serving — 2.5× has not been
    // applied on the device anywhere.
    expect(allText(byTestId(tree, 'health-quick-add-row-cf_1')[0])).toContain('380 kcal per 100 g');
  });

  it('HEALTH-NUTR-101: a changed portion says the figures are worked out on save', () => {
    const { tree } = setup({ favorites: [food({ portion: 100 })] });

    press(tree, 'health-quick-add-tab-favorites');
    press(tree, 'health-quick-add-food-cf_1');
    expect(byTestId(tree, 'health-quick-add-portion-note-cf_1').length).toBe(0);

    type(tree, 'health-quick-add-portion-cf_1', '250');
    expect(textOf(tree, 'health-quick-add-portion-note-cf_1')).toContain('worked out when you add');
  });

  it('HEALTH-NUTR-102: a portion of zero or junk cannot be logged', () => {
    const { tree, onLogFood } = setup({ favorites: [food()] });

    press(tree, 'health-quick-add-tab-favorites');
    press(tree, 'health-quick-add-food-cf_1');
    type(tree, 'health-quick-add-portion-cf_1', '0');
    press(tree, 'health-quick-add-log-cf_1');

    expect(onLogFood).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-quick-add-log-cf_1')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
  });

  it('HEALTH-NUTR-103: a food being logged has its own Add button locked', () => {
    const { tree } = setup({ favorites: [food()], busyFoodId: 'cf_1' });

    press(tree, 'health-quick-add-tab-favorites');
    press(tree, 'health-quick-add-food-cf_1');
    expect(byTestId(tree, 'health-quick-add-log-cf_1')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
  });

  it('HEALTH-NUTR-104: calories-only logging works with an empty library', () => {
    const { tree, onLogCalories } = setup();

    type(tree, 'health-quick-add-calories-name', 'Canteen lunch');
    type(tree, 'health-quick-add-calories-input', '540');
    press(tree, 'health-quick-add-calories-button');

    expect(onLogCalories).toHaveBeenCalledWith('Canteen lunch', 540);
    // The fields clear so the next entry starts fresh.
    expect(input(tree, 'health-quick-add-calories-input').props.value).toBe('');
    expect(input(tree, 'health-quick-add-calories-name').props.value).toBe('');
  });

  it('HEALTH-NUTR-105: the calories-only button stays inert without a number', () => {
    const { tree, onLogCalories } = setup();

    type(tree, 'health-quick-add-calories-name', 'Just a name');
    press(tree, 'health-quick-add-calories-button');

    expect(onLogCalories).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-quick-add-calories-button')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
  });

  it('HEALTH-NUTR-106: loading says so rather than showing a false empty state', () => {
    const { tree } = setup({ loading: true });

    expect(byTestId(tree, 'health-quick-add-loading').length).toBe(1);
    expect(byTestId(tree, 'health-quick-add-empty').length).toBe(0);
  });

  it('HEALTH-NUTR-107: the Add button names the slot it is adding to', () => {
    const { tree } = setup({ slot: 'dinner', favorites: [food()] });

    press(tree, 'health-quick-add-tab-favorites');
    press(tree, 'health-quick-add-food-cf_1');
    expect(byTestId(tree, 'health-quick-add-log-cf_1')[0].props.accessibilityLabel).toBe(
      'Add Oats to Dinner'
    );
  });

  it('HEALTH-NUTR-108: reason copy prefers the first reason it knows', () => {
    expect(reasonLabel(['favorite', 'recently_used'])).toBe('Favourite');
    expect(reasonLabel(['time_based_match'])).toBe('Usual at this time');
    expect(reasonLabel([])).toBeNull();
    expect(reasonLabel(['nonsense' as never])).toBeNull();
  });

  it('HEALTH-NUTR-116: tapping the open food again collapses it', () => {
    // The row is the disclosure control, so the second tap has to close it —
    // otherwise the only way out of a portion field is to log something.
    const { tree } = setup({ recents: [food()] });

    press(tree, 'health-quick-add-tab-recent');
    press(tree, 'health-quick-add-food-cf_1');
    expect(byTestId(tree, 'health-quick-add-portion-cf_1').length).toBe(1);

    press(tree, 'health-quick-add-food-cf_1');
    expect(byTestId(tree, 'health-quick-add-portion-cf_1').length).toBe(0);
    expect(byTestId(tree, 'health-quick-add-food-cf_1')[0].props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('HEALTH-NUTR-117: a branded food names its brand beside the food', () => {
    // Two "Oats" in a library are told apart only by the brand the server holds.
    const { tree } = setup({ favorites: [food({ brand: 'Quaker' })] });

    press(tree, 'health-quick-add-tab-favorites');
    expect(allText(byTestId(tree, 'health-quick-add-row-cf_1')[0])).toContain('Oats · Quaker');
  });

  it('HEALTH-NUTR-118: both number fields ask for a number keypad on Android as well', () => {
    onAndroid(() => {
      const { tree } = setup({ favorites: [food()] });
      press(tree, 'health-quick-add-tab-favorites');
      press(tree, 'health-quick-add-food-cf_1');

      expect(input(tree, 'health-quick-add-portion-cf_1').props.keyboardType).toBe('numeric');
      expect(input(tree, 'health-quick-add-calories-input').props.keyboardType).toBe('numeric');
    });
  });

  it('HEALTH-NUTR-109: empty copy never leaks a raw failure string', () => {
    for (const tab of ['suggested', 'favorites', 'recent'] as const) {
      for (const unavailable of [true, false]) {
        const copy = emptyCopy(tab, unavailable);
        expect(copy.length).toBeGreaterThan(0);
        expect(copy).not.toMatch(/Error|error:|undefined|null|\[object/);
      }
    }
  });
});
