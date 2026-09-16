/**
 * InstitutionPicker — searchable institution field with brand badges + custom add.
 * Verifies: closed by default, expands on tap, filters by search, selecting a
 * popular option reports it, and a non-matching query offers a "Use …" custom add.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { InstitutionPicker } from '../InstitutionPicker';

function render(value = '', onChange = jest.fn()) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <InstitutionPicker value={value} onChange={onChange} />
      </ThemeProvider>
    );
  });
  return { tree, onChange };
}

const tap = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  act(() => tree.root.findByProps({ testID }).props.onPress());

const type = (tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) =>
  act(() => tree.root.findByProps({ testID }).props.onChangeText(text));

describe('InstitutionPicker', () => {
  it('is collapsed until the field is tapped', () => {
    const { tree } = render();
    expect(tree.root.findAllByProps({ testID: 'institution-picker-search' })).toHaveLength(0);
    tap(tree, 'institution-picker-field');
    expect(tree.root.findAllByProps({ testID: 'institution-picker-search' }).length).toBeGreaterThan(0);
  });

  it('filters the list by the search query', () => {
    const { tree } = render();
    tap(tree, 'institution-picker-field');
    type(tree, 'institution-picker-search', 'wealth');
    expect(tree.root.findAllByProps({ testID: 'institution-picker-option-Wealthsimple' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'institution-picker-option-RBC' })).toHaveLength(0);
  });

  it('selecting a popular option reports it and collapses', () => {
    const { tree, onChange } = render();
    tap(tree, 'institution-picker-field');
    type(tree, 'institution-picker-search', 'quest');
    tap(tree, 'institution-picker-option-Questrade');
    expect(onChange).toHaveBeenCalledWith('Questrade');
    // Collapsed again (search gone).
    expect(tree.root.findAllByProps({ testID: 'institution-picker-search' })).toHaveLength(0);
  });

  it('offers a custom "Use …" row for a non-matching query', () => {
    const { tree, onChange } = render();
    tap(tree, 'institution-picker-field');
    type(tree, 'institution-picker-search', 'Neighborhood Trust');
    tap(tree, 'institution-picker-add-custom');
    expect(onChange).toHaveBeenCalledWith('Neighborhood Trust');
  });

  it('clears the selected value', () => {
    const { tree, onChange } = render('RBC');
    tap(tree, 'institution-picker-clear');
    expect(onChange).toHaveBeenCalledWith('');
  });
});
