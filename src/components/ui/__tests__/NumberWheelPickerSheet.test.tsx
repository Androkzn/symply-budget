/**
 * NumberWheelPickerSheet — the native wheel-in-a-bottom-sheet used by the
 * onboarding calorie field and (via `OnboardingWheelNumberField`) every other
 * onboarding numeric field, including weight's 1-decimal-place wheel.
 *
 * A fractional `step` (e.g. 0.1 for weight) built via repeated float addition
 * drifts — 0.1 + 0.1 + 0.1 !== 0.3 in IEEE754 — which used to surface as
 * labels like "70.30000000000001". These tests pin the fix: values and
 * labels stay clean at any step, and confirming a value never hands the
 * caller float garbage.
 */
import { Picker } from '@react-native-picker/picker';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { NumberWheelPickerSheet } from '../NumberWheelPickerSheet';

function renderSheet(props: Partial<React.ComponentProps<typeof NumberWheelPickerSheet>> = {}) {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  const onManualEntry = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <NumberWheelPickerSheet
          visible
          title="Target weight"
          value={70}
          min={30}
          max={250}
          step={0.1}
          unitLabel="kg"
          onConfirm={onConfirm}
          onClose={onClose}
          onManualEntry={onManualEntry}
          testID="weight-picker"
          {...props}
        />
      </ThemeProvider>
    );
  });
  return { tree, onConfirm, onClose };
}

function itemLabels(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return tree.root.findByType(Picker).props.children.map((item: { props: { label: string } }) => item.props.label);
}

function findPickerByTestID(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.findAllByType(Picker).find((n) => n.props.testID === testID)!;
}

/** Walks up from the matching text node to the `Pressable` that actually owns `onPress`. */
function findPressableByText(tree: ReactTestRenderer.ReactTestRenderer, text: string) {
  let node = tree.root.findAllByProps({ children: text })[0];
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent as ReactTestRenderer.ReactTestInstance;
  }
  return node;
}

describe('NumberWheelPickerSheet decimal precision', () => {
  it('never renders a float-drifted label for a fractional step', () => {
    const { tree } = renderSheet({ min: 0, max: 1, step: 0.1, value: 0.3 });
    const labels = itemLabels(tree);
    // The classic IEEE754 drift case — 0.1 added three times is
    // 0.30000000000000004, not 0.3.
    expect(labels).toContain('0.3 kg');
    expect(labels.some((label) => label.length > '0.3 kg'.length)).toBe(false);
  });

  it('formats every value to the same fixed decimal count as the step', () => {
    const { tree } = renderSheet({ min: 30, max: 30.3, step: 0.1, value: 30 });
    expect(itemLabels(tree)).toEqual(['30.0 kg', '30.1 kg', '30.2 kg', '30.3 kg']);
  });

  it('keeps whole-number steps (e.g. calories) exactly as before — no decimal point', () => {
    const { tree } = renderSheet({ min: 500, max: 500, step: 50, value: 500, unitLabel: 'kcal' });
    expect(itemLabels(tree)).toEqual(['500 kcal']);
  });

  it('snaps a value that does not land on a step to the nearest clean one, and "Done" confirms that clean value', () => {
    const { tree, onConfirm } = renderSheet({ min: 0, max: 1, step: 0.1, value: 0.31 });
    // 0.31 is not on the 0.1 grid — the wheel opens on the nearest step (0.3),
    // not a value carrying float drift from the snap-to-step math.
    expect(tree.root.findByType(Picker).props.selectedValue).toBe(0.3);

    const done = findPressableByText(tree, 'Done');
    act(() => done.props.onPress());
    expect(onConfirm).toHaveBeenCalledWith(0.3);
  });
});

describe('NumberWheelPickerSheet splitDecimal', () => {
  it('renders one wheel (not two) when splitDecimal is left off, even for a fractional step', () => {
    const { tree } = renderSheet({ min: 30, max: 250, step: 0.1, value: 70 });
    expect(tree.root.findAllByType(Picker)).toHaveLength(1);
  });

  it('splits into a whole-number wheel and a decimal-digit wheel when splitDecimal is set', () => {
    const { tree } = renderSheet({ min: 30, max: 250, step: 0.1, value: 70.5, splitDecimal: true });
    const wholePicker = findPickerByTestID(tree, 'weight-picker-whole');
    const decimalPicker = findPickerByTestID(tree, 'weight-picker-decimal');

    expect(wholePicker.props.selectedValue).toBe(70);
    expect(decimalPicker.props.selectedValue).toBe(0.5);

    const decimalLabels = decimalPicker.props.children.map((item: { props: { label: string } }) => item.props.label);
    expect(decimalLabels).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

    const wholeLabels = wholePicker.props.children.map((item: { props: { label: string } }) => item.props.label);
    expect(wholeLabels[0]).toBe('30');
    expect(wholeLabels[wholeLabels.length - 1]).toBe('250');
  });

  it('combines the whole and decimal wheels and confirms the combined value on Done', () => {
    const { tree, onConfirm } = renderSheet({ min: 30, max: 250, step: 0.1, value: 70, splitDecimal: true });

    act(() => findPickerByTestID(tree, 'weight-picker-whole').props.onValueChange(82));
    act(() => findPickerByTestID(tree, 'weight-picker-decimal').props.onValueChange(0.5));

    const done = findPressableByText(tree, 'Done');
    act(() => done.props.onPress());
    expect(onConfirm).toHaveBeenCalledWith(82.5);
  });

  it('keeps the manual-entry row at the plain `-manual` testID in split mode', () => {
    // e2e/maestro/health/onboarding.yaml opens the weight wheel and taps
    // straight through to manual entry — it must find this row regardless of
    // whether the wheel above it is one Picker or two.
    const { tree } = renderSheet({ min: 30, max: 250, step: 0.1, value: 70, splitDecimal: true });
    expect(tree.root.findAllByProps({ testID: 'weight-picker-manual' })).not.toHaveLength(0);
  });

  it('clamps a split selection that lands outside [min, max] on Done', () => {
    const { tree, onConfirm } = renderSheet({ min: 30, max: 250, step: 0.1, value: 70, splitDecimal: true });

    act(() => findPickerByTestID(tree, 'weight-picker-whole').props.onValueChange(250));
    act(() => findPickerByTestID(tree, 'weight-picker-decimal').props.onValueChange(0.5));

    const done = findPressableByText(tree, 'Done');
    act(() => done.props.onPress());
    expect(onConfirm).toHaveBeenCalledWith(250);
  });
});
