/**
 * OptionWheelPickerSheet — the native wheel-in-a-bottom-sheet for a small
 * fixed set of string choices (gender, activity level, ...). `description`/
 * `icon` are optional per-option fields that drive a small live panel below
 * the wheel, keyed off whichever row is currently highlighted (`draft`) —
 * NOT the confirmed `value`, so scrolling previews a level before "Done" is
 * tapped. Fields that don't set them (e.g. gender) render no panel at all.
 */
import { Picker } from '@react-native-picker/picker';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { OptionWheelPickerSheet, type OptionWheelPickerOption } from '../OptionWheelPickerSheet';

const ACTIVITY_OPTIONS: OptionWheelPickerOption<string>[] = [
  { key: 'sedentary', label: 'Sedentary', description: 'Little or no exercise.', icon: 'bed-outline' },
  { key: 'veryActive', label: 'Very active', description: 'Hard exercise 6-7 days a week.', icon: 'barbell-outline' },
];

const GENDER_OPTIONS: OptionWheelPickerOption<string>[] = [
  { key: 'female', label: 'Female' },
  { key: 'male', label: 'Male' },
];

function renderSheet(options: OptionWheelPickerOption<string>[], value: string) {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <OptionWheelPickerSheet
          visible
          title="Activity level"
          options={options}
          value={value}
          onConfirm={onConfirm}
          onClose={onClose}
          testID="activity-picker"
        />
      </ThemeProvider>,
    );
  });
  return { tree, onConfirm, onClose };
}

describe('OptionWheelPickerSheet description/icon panel', () => {
  it('shows the description for the initially-selected option', () => {
    const { tree } = renderSheet(ACTIVITY_OPTIONS, 'sedentary');
    expect(tree.root.findAllByProps({ children: 'Little or no exercise.' }).length).toBeGreaterThan(0);
  });

  it('updates live as the wheel is scrolled, before "Done" confirms it', () => {
    const { tree } = renderSheet(ACTIVITY_OPTIONS, 'sedentary');

    act(() => tree.root.findByType(Picker).props.onValueChange('veryActive'));

    expect(tree.root.findAllByProps({ children: 'Hard exercise 6-7 days a week.' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ children: 'Little or no exercise.' }).length).toBe(0);
  });

  it('renders no panel at all for an option list with no descriptions', () => {
    const { tree } = renderSheet(GENDER_OPTIONS, 'female');
    const labels = tree.root
      .findByType(Picker)
      .props.children.map((item: { props: { label: string } }) => item.props.label);
    expect(labels).toEqual(['Female', 'Male']);
    // Assert the PANEL is gone, not "no icon anywhere in the tree": the sheet's
    // shared header draws a ✕ of its own, so counting icons globally would now
    // pass or fail on the chrome rather than on the description row.
    expect(
      tree.root.findAllByProps({ testID: 'option-wheel-picker-description' }).length
    ).toBe(0);
  });
});
