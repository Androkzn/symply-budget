/**
 * LenderPicker — searchable lender field with brand tiles + custom add, used by
 * the mortgage setup/edit forms. Verifies: collapsed by default, expands on tap,
 * filters by search (name + alias), selecting a predefined lender reports its
 * canonical name, a non-matching query offers a "Use …" custom add, a known
 * alias does NOT offer a custom row, and the value clears.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { LenderPicker } from '../LenderPicker';

function render(value = '', onChange = jest.fn()) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LenderPicker value={value} onChange={onChange} />
      </ThemeProvider>
    );
  });
  return { tree, onChange };
}

const tap = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  act(() => tree.root.findByProps({ testID }).props.onPress());

const type = (tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) =>
  act(() => tree.root.findByProps({ testID }).props.onChangeText(text));

describe('LenderPicker', () => {
  it('is collapsed until the field is tapped', () => {
    const { tree } = render();
    expect(tree.root.findAllByProps({ testID: 'lender-picker-search' })).toHaveLength(0);
    tap(tree, 'lender-picker-field');
    expect(tree.root.findAllByProps({ testID: 'lender-picker-search' }).length).toBeGreaterThan(0);
  });

  it('filters the list by the search query', () => {
    const { tree } = render();
    tap(tree, 'lender-picker-field');
    type(tree, 'lender-picker-search', 'scotia');
    expect(tree.root.findAllByProps({ testID: 'lender-picker-option-Scotiabank' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'lender-picker-option-RBC' })).toHaveLength(0);
  });

  it('matches lenders by alias too', () => {
    const { tree } = render();
    tap(tree, 'lender-picker-field');
    type(tree, 'lender-picker-search', 'royal bank');
    expect(tree.root.findAllByProps({ testID: 'lender-picker-option-RBC' }).length).toBeGreaterThan(0);
  });

  it('selecting a predefined lender reports its canonical name and collapses', () => {
    const { tree, onChange } = render();
    tap(tree, 'lender-picker-field');
    type(tree, 'lender-picker-search', 'cibc');
    tap(tree, 'lender-picker-option-CIBC');
    expect(onChange).toHaveBeenCalledWith('CIBC');
    expect(tree.root.findAllByProps({ testID: 'lender-picker-search' })).toHaveLength(0);
  });

  it('offers a custom "Use …" row for a non-matching query', () => {
    const { tree, onChange } = render();
    tap(tree, 'lender-picker-field');
    type(tree, 'lender-picker-search', 'My Local Broker');
    tap(tree, 'lender-picker-add-custom');
    expect(onChange).toHaveBeenCalledWith('My Local Broker');
  });

  it('does NOT offer a custom row when the query matches a known alias', () => {
    const { tree } = render();
    tap(tree, 'lender-picker-field');
    type(tree, 'lender-picker-search', 'TD Canada Trust');
    expect(tree.root.findAllByProps({ testID: 'lender-picker-add-custom' })).toHaveLength(0);
  });

  it('clears the selected value', () => {
    const { tree, onChange } = render('RBC');
    tap(tree, 'lender-picker-clear');
    expect(onChange).toHaveBeenCalledWith('');
  });
});
