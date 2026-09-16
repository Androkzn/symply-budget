/**
 * OnboardingWheelNumberField — the shared "tap opens a wheel picker, 'Enter
 * manually' falls back to the keyboard" numeric field used across the Health
 * goals mini-flow (weight, age, steps, minutes, water), mirroring the pattern
 * `HealthGoalsNutritionScreen` established for its calorie field.
 */
import React from 'react';
import { TextInput } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { NumberWheelPickerSheet } from '@components/ui';
import { ThemeProvider } from '@contexts/ThemeContext';

import { OnboardingWheelNumberField } from '../OnboardingWheelNumberField';

function renderField(
  props: Partial<React.ComponentProps<typeof OnboardingWheelNumberField>> = {}
) {
  const onChange = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <OnboardingWheelNumberField
          label="Target weight (kg)"
          value=""
          onChange={onChange}
          min={30}
          max={250}
          step={0.1}
          defaultValue={70}
          unitLabel="kg"
          testID="weight-field"
          {...props}
        />
      </ThemeProvider>
    );
  });
  return { tree, onChange };
}

// `testID` is intentionally NOT on this element while `!manualMode` (see
// OnboardingWheelNumberField.tsx — it lives on the outer `Card` instead,
// since that is the real, accessible tap target until "Enter manually" is
// used). There is only ever one `TextInput` in this component, so find it by
// type rather than by an identifier that deliberately moves.
function findField(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findByType(TextInput);
}

describe('OnboardingWheelNumberField', () => {
  it('opens the wheel picker on focus rather than the keyboard', () => {
    const { tree } = renderField();
    const field = findField(tree);
    expect(field.props.showSoftInputOnFocus).toBe(false);
    expect(field.props.caretHidden).toBe(true);
    expect(tree.root.findByType(NumberWheelPickerSheet).props.visible).toBe(false);

    act(() => field.props.onFocus());
    expect(tree.root.findByType(NumberWheelPickerSheet).props.visible).toBe(true);
  });

  it('opens the wheel at defaultValue when the field is empty', () => {
    const { tree } = renderField({ value: '' });
    expect(tree.root.findByType(NumberWheelPickerSheet).props.value).toBe(70);
  });

  it('opens the wheel at the current value when the field already has one', () => {
    const { tree } = renderField({ value: '82.5' });
    expect(tree.root.findByType(NumberWheelPickerSheet).props.value).toBe(82.5);
  });

  it('confirming a wheel value calls onChange with that value', () => {
    const { tree, onChange } = renderField();
    act(() => tree.root.findByType(NumberWheelPickerSheet).props.onConfirm(82.5));
    expect(onChange).toHaveBeenCalledWith('82.5');
  });

  it('"Enter manually" closes the wheel and switches the field over to the keyboard', () => {
    const { tree } = renderField();
    const field = () => findField(tree);

    act(() => field().props.onFocus());
    act(() => tree.root.findByType(NumberWheelPickerSheet).props.onManualEntry());

    expect(tree.root.findByType(NumberWheelPickerSheet).props.visible).toBe(false);
    expect(field().props.showSoftInputOnFocus).toBe(true);
    expect(field().props.caretHidden).toBe(false);
  });

  it('shows the unit label only once the field has a value', () => {
    const { tree: empty } = renderField({ value: '' });
    expect(empty.root.findAllByProps({ children: 'kg' }).length).toBe(0);

    const { tree: filled } = renderField({ value: '70' });
    expect(filled.root.findAllByProps({ children: 'kg' }).length).toBeGreaterThan(0);
  });

  it('typing while in manual mode reports through onChange directly', () => {
    const { tree, onChange } = renderField();
    act(() => findField(tree).props.onFocus());
    act(() => tree.root.findByType(NumberWheelPickerSheet).props.onManualEntry());

    act(() => findField(tree).props.onChangeText('82.5'));
    expect(onChange).toHaveBeenCalledWith('82.5');
  });

  // Regression: the TextInput is `pointerEvents: 'none'` while `!manualMode`
  // (picker mode, the default), which also drops it out of the accessibility
  // tree on a real device/simulator — VoiceOver and Maestro/XCUITest can no
  // longer find it by `testID`/label there, even though `testID` is still on
  // it (react-test-renderer has no concept of `pointerEvents`, so Jest alone
  // never caught this). The outer `Card` — the REAL tap target while
  // `!manualMode`, via `onPress={handleWellPress}` — must carry the SAME
  // `testID` so there is always something on-screen a real tap-by-id can
  // land on, in either mode.
  it('the Card wrapping the field also carries its testID (real tap target while pointerEvents: none hides the field)', () => {
    const { tree } = renderField();
    const card = tree.root.find((n) => typeof n.props.onPress === 'function' && n.props.testID === 'weight-field');
    expect(card.props.testID).toBe('weight-field');
  });
});
