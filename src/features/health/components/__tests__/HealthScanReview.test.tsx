/**
 * `HealthScanReview` — the review step that closes `HealthScanScreen`'s old
 * meal-photo dead end ("adding these to your diary is not built yet").
 *
 * The storage call (`logScannedFoodsToDiary`) is mocked here — its own wire
 * contract is pinned in `healthNutritionStorage.test.ts` (HEALTH-SCANLOG-*).
 * This suite is about the CARD: what it prefills, what a member can edit,
 * which rows are actually sent, and that nothing is saved until Save is
 * pressed.
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { HealthMealPhotoDraft } from '@api/healthAi';
import { ThemeProvider } from '@contexts/ThemeContext';

import { logScannedFoodsToDiary } from '../../healthNutritionStorage';
import { HealthScanReview, sourceLabelFor } from '../HealthScanReview';

jest.mock('../../healthNutritionStorage', () => ({
  ...jest.requireActual('../../healthNutritionStorage'),
  logScannedFoodsToDiary: jest.fn(),
}));

const mockLogScannedFoods = logScannedFoodsToDiary as jest.Mock;

function draft(over: Partial<HealthMealPhotoDraft> = {}): HealthMealPhotoDraft {
  return {
    foods: [
      {
        food_name: 'Chicken breast',
        brand: null,
        cooking_state: 'cooked',
        portion: 150,
        unit: 'g',
        calories: 248,
        proteins: 46,
        carbohydrates: 0,
        fats: 5,
        fiber: null,
        sugar: null,
        calories_per_100g: 165,
        proteins_per_100g: 31,
        carbs_per_100g: 0,
        fats_per_100g: 3.6,
        confidence: 0.9,
        data_source: 'nutrition_label',
      },
    ],
    scale_reading: null,
    meal_type: null,
    total_calories: 248,
    image_quality: 'good',
    notes: null,
    ...over,
  };
}

function render(props: Partial<React.ComponentProps<typeof HealthScanReview>> = {}) {
  const onDiscard = jest.fn();
  const onSaved = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthScanReview draft={draft()} onDiscard={onDiscard} onSaved={onSaved} {...props} />
      </ThemeProvider>
    );
  });
  return { tree, onDiscard, onSaved };
}

/**
 * The amount fields are wrapped by a local `AmountField` helper, whose OWN
 * composite instance also carries `testID` — `findByProps({ testID })` would
 * be ambiguous between that wrapper (props named `onChange`) and the actual
 * `TextInput` (props named `onChangeText`) it renders. Filtering on the host
 * type, same as `HealthNutritionComponents.test.tsx`'s own `input` helper,
 * is what makes this deterministic.
 */
function input(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID
  );
}

function typeInto(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  act(() => input(tree, testID).props.onChangeText(text));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLogScannedFoods.mockResolvedValue({ entries: [], logged: 1, status: 'logged', message: null });
});

describe('sourceLabelFor', () => {
  it('HEALTH-SCANREV-001: names the donor ladder, flags an unnamed rung, and is silent for null', () => {
    expect(sourceLabelFor('nutrition_label')).toBe('From the label');
    expect(sourceLabelFor('estimation')).toBe('Estimated');
    expect(sourceLabelFor('visual_guess' as never)).toBe('Source not stated');
    expect(sourceLabelFor(null)).toBeNull();
  });
});

describe('HealthScanReview', () => {
  it('HEALTH-SCANREV-002: prefills every row from the draft, checked when it has a calorie figure', () => {
    const { tree } = render();
    expect(input(tree, 'health-scan-review-food-0-name').props.value).toBe('Chicken breast');
    expect(input(tree, 'health-scan-review-food-0-calories').props.value).toBe('248');
    expect(input(tree, 'health-scan-review-food-0-protein').props.value).toBe('46');
    expect(input(tree, 'health-scan-review-food-0-portion').props.value).toBe('150');
    expect(
      tree.root.findByProps({ testID: 'health-scan-review-food-0-toggle' }).props.accessibilityState
        .checked
    ).toBe(true);
  });

  it('HEALTH-SCANREV-003: a row with no calorie figure starts unchecked, not included at zero', () => {
    const { tree } = render({
      draft: draft({ foods: [{ ...draft().foods[0], calories: null }] }),
    });
    expect(
      tree.root.findByProps({ testID: 'health-scan-review-food-0-toggle' }).props.accessibilityState
        .checked
    ).toBe(false);
    expect(input(tree, 'health-scan-review-food-0-calories').props.value).toBe('');
  });

  it('HEALTH-SCANREV-004: the meal slot defaults from the draft when the model named one', () => {
    const { tree } = render({ draft: draft({ meal_type: 'dinner' }) });
    expect(
      tree.root.findByProps({ testID: 'health-scan-review-slot-dinner' }).props.accessibilityState
        .selected
    ).toBe(true);
  });

  it('HEALTH-SCANREV-005: Save is disabled with nothing checked, and enables once a row is checked', async () => {
    const { tree } = render({
      draft: draft({ foods: [{ ...draft().foods[0], calories: null }] }),
    });
    expect(
      tree.root.findByProps({ testID: 'health-scan-review-save' }).props.accessibilityState.disabled
    ).toBe(true);

    typeInto(tree, 'health-scan-review-food-0-calories', '300');
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-review-food-0-toggle' }).props.onPress();
    });
    expect(
      tree.root.findByProps({ testID: 'health-scan-review-save' }).props.accessibilityState.disabled
    ).toBe(false);
  });

  it('HEALTH-SCANREV-006: Save sends only the checked rows, with the picked slot on each', async () => {
    const { tree, onSaved } = render({
      draft: draft({
        foods: [
          { ...draft().foods[0], food_name: 'Chicken breast' },
          { ...draft().foods[0], food_name: 'Rice', calories: 200, proteins: 4, carbohydrates: 45, fats: 0 },
        ],
      }),
    });

    // Exclude the second row before saving.
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-review-food-1-toggle' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-review-slot-breakfast' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-review-save' }).props.onPress();
    });

    expect(mockLogScannedFoods).toHaveBeenCalledTimes(1);
    const [entries, date] = mockLogScannedFoods.mock.calls[0];
    expect(entries).toEqual([
      expect.objectContaining({ name: 'Chicken breast', slot: 'breakfast', calories: 248 }),
    ]);
    expect(date).toBeUndefined();
    expect(onSaved).toHaveBeenCalledWith('Added 1 food to Breakfast.');
  });

  it('HEALTH-SCANREV-007: an edited figure is what gets sent, not the model\'s original reading', async () => {
    const { tree } = render();
    typeInto(tree, 'health-scan-review-food-0-calories', '300');
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-review-save' }).props.onPress();
    });

    const [entries] = mockLogScannedFoods.mock.calls[0];
    expect(entries[0]).toEqual(expect.objectContaining({ calories: 300 }));
  });

  it('HEALTH-SCANREV-008: a non-"logged" answer shows the message and does not fire onSaved', async () => {
    mockLogScannedFoods.mockResolvedValue({
      entries: [],
      logged: 0,
      status: 'failed',
      message: 'That did not save. Check your connection and try again.',
    });
    const { tree, onSaved } = render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-review-save' }).props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'health-scan-review-message' })).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('HEALTH-SCANREV-009: Discard calls back without ever calling the write path', async () => {
    const { tree, onDiscard } = render();
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-review-discard' }).props.onPress();
    });
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(mockLogScannedFoods).not.toHaveBeenCalled();
  });

  it('HEALTH-SCANREV-010: shows the scale reading when the shot detected one', () => {
    const { tree } = render({
      draft: draft({ scale_reading: { value: 150, unit: 'g', detected: true } }),
    });
    expect(tree.root.findByProps({ testID: 'health-scan-review-scale' })).toBeTruthy();
  });

  it('HEALTH-SCANREV-011: the total line reflects what the draft carried', () => {
    const { tree: withTotal } = render({ draft: draft({ total_calories: 248 }) });
    expect(withTotal.root.findByProps({ testID: 'health-scan-review-total' }).props.children).toBe(
      'Total 248 kcal'
    );

    const { tree: withoutTotal } = render({ draft: draft({ total_calories: null }) });
    expect(
      withoutTotal.root.findByProps({ testID: 'health-scan-review-total' }).props.children
    ).toContain('Total not known');
  });
});
