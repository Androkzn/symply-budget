/**
 * `HealthScienceInfoSheet` — the deep-dive "science behind your numbers"
 * sheet linked from `HealthGoalsBiometricsScreen`. Asserts: closed by
 * default, every section renders when open, sources are collapsed until
 * toggled, and tapping a source opens it in the system browser.
 */
import React from 'react';
import { Linking } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthScienceInfoSheet } from '../HealthScienceInfoSheet';

function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.findAllByProps({ testID })[0];
  node.props.onPress?.();
}

function renderSheet(visible: boolean, onClose: () => void = jest.fn()) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthScienceInfoSheet visible={visible} onClose={onClose} />
      </ThemeProvider>,
    );
  });
  return tree;
}

describe('HealthScienceInfoSheet', () => {
  it('renders nothing while closed', () => {
    const tree = renderSheet(false);
    expect(tree.root.findAllByProps({ testID: 'health-science-sheet-content' }).length).toBe(0);
  });

  it('renders every section when open', () => {
    const tree = renderSheet(true);
    expect(
      tree.root.findAllByProps({ testID: 'health-science-sheet-content' }).length,
    ).toBeGreaterThan(0);

    for (const heading of [
      'Sex & body composition',
      'Age & metabolism',
      'Height & your BMR formula',
      'Activity level & everyday movement',
      "What's shaping the science in 2026",
    ]) {
      expect(tree.root.findAllByProps({ children: heading }).length).toBeGreaterThan(0);
    }
  });

  it('keeps sources collapsed until the toggle is pressed', () => {
    const tree = renderSheet(true);
    expect(tree.root.findAllByProps({ testID: 'health-science-sheet-sources-content' }).length).toBe(0);

    act(() => pressByTestId(tree, 'health-science-sheet-sources-toggle'));

    expect(
      tree.root.findAllByProps({ testID: 'health-science-sheet-sources-content' }).length,
    ).toBeGreaterThan(0);
    // 18 curated citations back the claims made above.
    const links = tree.root.findAll(
      (node) =>
        typeof node.props.testID === 'string' &&
        node.props.testID.startsWith('health-science-sheet-sources-source-') &&
        typeof node.props.onPress === 'function',
    );
    expect(links.length).toBe(18);
  });

  it('opens a source link in the system browser', () => {
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const tree = renderSheet(true);

    act(() => pressByTestId(tree, 'health-science-sheet-sources-toggle'));
    const link = tree.root
      .findAll((node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('health-science-sheet-sources-source-'))
      .find((node) => typeof node.props.onPress === 'function');
    act(() => link?.props.onPress?.());

    expect(openURLSpy).toHaveBeenCalledWith(expect.stringContaining('https://'));
    openURLSpy.mockRestore();
  });

  it('calls onClose when the sheet close button is pressed', () => {
    const onClose = jest.fn();
    const tree = renderSheet(true, onClose);

    act(() => pressByTestId(tree, 'bottom-sheet-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
