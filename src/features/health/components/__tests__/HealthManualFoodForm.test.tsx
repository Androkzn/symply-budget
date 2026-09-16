/**
 * `HealthManualFoodForm` — donor `ManualFoodEntrySheet`, ported: a name, a
 * portion + unit pair (defaulting 100 g), a meal picker, and four Nutrition
 * fields. `isValid` mirrors the donor's own rule exactly: a name and a
 * positive calorie figure — nothing else blocks the save.
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { addMealEntry } from '../../healthNutritionStorage';
import { HealthManualFoodForm } from '../HealthManualFoodForm';

jest.mock('../../healthNutritionStorage', () => ({
  ...jest.requireActual('../../healthNutritionStorage'),
  addMealEntry: jest.fn(),
}));

const mockAddMealEntry = addMealEntry as jest.Mock;

function render(props: Partial<React.ComponentProps<typeof HealthManualFoodForm>> = {}) {
  const onSaved = jest.fn();
  const onCancel = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthManualFoodForm onSaved={onSaved} onCancel={onCancel} {...props} />
      </ThemeProvider>
    );
  });
  return { tree, onSaved, onCancel };
}

/** See `HealthScanReview.test.tsx` for why this filters on the host type. */
function input(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID
  );
}

function typeInto(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  act(() => input(tree, testID).props.onChangeText(text));
}

function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  act(() => tree.root.findByProps({ testID }).props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddMealEntry.mockResolvedValue([]);
});

describe('HealthManualFoodForm', () => {
  it('HEALTH-MANFOOD-001: defaults portion to 100, unit to g, and the given initial slot', () => {
    const { tree } = render({ initialSlot: 'dinner' });
    expect(input(tree, 'health-manual-food-form-portion').props.value).toBe('100');
    expect(
      tree.root.findByProps({ testID: 'health-manual-food-form-unit-g' }).props.accessibilityState
        .selected
    ).toBe(true);
    expect(
      tree.root.findByProps({ testID: 'health-manual-food-form-slot-dinner' }).props.accessibilityState
        .selected
    ).toBe(true);
    expect(tree.root.findByProps({ testID: 'health-manual-food-form-preview' }).props.children).toEqual([
      'Calculated nutrition for ',
      '100',
      ' ',
      'g',
    ]);
  });

  it('HEALTH-MANFOOD-002: Save is disabled until there is a name AND a positive calorie figure — the donor\'s own rule', () => {
    const { tree } = render();
    const save = () => tree.root.findByProps({ testID: 'health-manual-food-form-save' });
    expect(save().props.accessibilityState.disabled).toBe(true);

    typeInto(tree, 'health-manual-food-form-name', 'Omelette');
    expect(save().props.accessibilityState.disabled).toBe(true);

    typeInto(tree, 'health-manual-food-form-calories', '0');
    expect(save().props.accessibilityState.disabled).toBe(true);

    typeInto(tree, 'health-manual-food-form-calories', '350');
    expect(save().props.accessibilityState.disabled).toBe(false);
  });

  it('HEALTH-MANFOOD-003: Save writes straight to the diary via addMealEntry, not the food library', async () => {
    const { tree, onSaved } = render({ initialSlot: 'breakfast' });
    typeInto(tree, 'health-manual-food-form-name', 'Omelette');
    typeInto(tree, 'health-manual-food-form-calories', '350');
    typeInto(tree, 'health-manual-food-form-protein', '20');
    typeInto(tree, 'health-manual-food-form-carbs', '5');
    typeInto(tree, 'health-manual-food-form-fat', '25');

    await act(async () => {
      tree.root.findByProps({ testID: 'health-manual-food-form-save' }).props.onPress();
    });

    expect(mockAddMealEntry).toHaveBeenCalledWith({
      name: 'Omelette',
      slot: 'breakfast',
      calories: 350,
      protein: 20,
      carbs: 5,
      fat: 25,
      date: undefined,
      portion: 100,
      unit: 'g',
    });
    expect(onSaved).toHaveBeenCalledWith({ name: 'Omelette', slot: 'breakfast' });
  });

  it('HEALTH-MANFOOD-004: an omitted macro defaults to 0, matching the donor\'s emptyEntry', async () => {
    const { tree } = render();
    typeInto(tree, 'health-manual-food-form-name', 'Black coffee');
    typeInto(tree, 'health-manual-food-form-calories', '5');

    await act(async () => {
      tree.root.findByProps({ testID: 'health-manual-food-form-save' }).props.onPress();
    });

    expect(mockAddMealEntry).toHaveBeenCalledWith(
      expect.objectContaining({ protein: 0, carbs: 0, fat: 0 })
    );
  });

  it('HEALTH-MANFOOD-005: switching unit and meal picks are reflected before saving', async () => {
    // Defaults to 'snacks' (see HEALTH-MANFOOD-001), so picking 'dinner' here
    // actually exercises the switch rather than re-selecting the default.
    const { tree } = render();
    press(tree, 'health-manual-food-form-unit-ml');
    press(tree, 'health-manual-food-form-slot-dinner');
    typeInto(tree, 'health-manual-food-form-name', 'Smoothie');
    typeInto(tree, 'health-manual-food-form-calories', '180');
    typeInto(tree, 'health-manual-food-form-portion', '250');

    await act(async () => {
      tree.root.findByProps({ testID: 'health-manual-food-form-save' }).props.onPress();
    });

    expect(mockAddMealEntry).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 'dinner', unit: 'ml', portion: 250 })
    );
  });

  it('HEALTH-MANFOOD-006: fields reset after a successful save, ready for the next add', async () => {
    const { tree } = render();
    typeInto(tree, 'health-manual-food-form-name', 'Omelette');
    typeInto(tree, 'health-manual-food-form-calories', '350');

    await act(async () => {
      tree.root.findByProps({ testID: 'health-manual-food-form-save' }).props.onPress();
    });

    expect(input(tree, 'health-manual-food-form-name').props.value).toBe('');
    expect(input(tree, 'health-manual-food-form-calories').props.value).toBe('');
    expect(input(tree, 'health-manual-food-form-portion').props.value).toBe('100');
  });

  it('HEALTH-MANFOOD-007: Cancel calls back without writing anything, and is absent with no handler', () => {
    const { tree, onCancel } = render();
    press(tree, 'health-manual-food-form-cancel');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockAddMealEntry).not.toHaveBeenCalled();

    const { tree: noCancel } = render({ onCancel: undefined });
    expect(noCancel.root.findAllByProps({ testID: 'health-manual-food-form-cancel' })).toHaveLength(0);
  });
});
