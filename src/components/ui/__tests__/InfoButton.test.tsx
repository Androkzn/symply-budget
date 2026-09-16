/**
 * InfoButton — the app's one "why is this number what it is" affordance.
 *
 * Drives the real component and asserts: the sheet is closed until the toggle
 * is pressed; it shows plain `info` text, OR `children` when given (rich
 * content wins over `info`); real citation `sources` render as tappable links
 * that open the given URL; and a source-less explanation renders no
 * "Sources" block at all (nothing to fabricate a citation for).
 */
import React from 'react';
import { Linking } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { InfoButton } from '../InfoButton';

function pressByTestId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.findAllByProps({ testID })[0];
  node.props.onPress?.();
}

function isVisible(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({ testID }).length > 0;
}

function renderInfoButton(props: React.ComponentProps<typeof InfoButton>) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <InfoButton {...props} />
      </ThemeProvider>
    );
  });
  return tree;
}

describe('InfoButton', () => {
  it('is closed until the toggle is pressed', () => {
    const tree = renderInfoButton({ testID: 'nutrition-info', info: 'Why this number.' });
    expect(isVisible(tree, 'nutrition-info-content')).toBe(false);

    act(() => pressByTestId(tree, 'nutrition-info-toggle'));
    expect(isVisible(tree, 'nutrition-info-content')).toBe(true);
  });

  it('shows the plain info text once opened', () => {
    const tree = renderInfoButton({ testID: 'nutrition-info', info: 'Why this number.' });
    act(() => pressByTestId(tree, 'nutrition-info-toggle'));

    const text = tree.root
      .findAllByProps({ testID: 'nutrition-info-content' })[0]
      .findAllByType('Text' as never)
      .map((n) => n.props.children)
      .flat()
      .join('');
    expect(text).toContain('Why this number.');
  });

  it('renders rich children instead of info when both are given', () => {
    const Chart = () => <>{'chart-stand-in'}</>;
    const tree = renderInfoButton({
      testID: 'preset-info',
      info: 'This text must not appear.',
      children: <Chart />,
    });
    act(() => pressByTestId(tree, 'preset-info-toggle'));

    expect(tree.root.findAllByType(Chart).length).toBeGreaterThan(0);
  });

  it('renders no Sources block when none are given', () => {
    const tree = renderInfoButton({ testID: 'nutrition-info', info: 'Why this number.' });
    act(() => pressByTestId(tree, 'nutrition-info-toggle'));

    expect(isVisible(tree, 'nutrition-info-sources')).toBe(false);
  });

  it('renders each source as a tappable link that opens its real URL', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const tree = renderInfoButton({
      testID: 'preset-info',
      info: 'Why this number.',
      sources: [
        { label: 'Feinman et al. (2015), Nutrition', url: 'https://doi.org/10.1016/j.nut.2014.06.011' },
        { label: 'Jäger et al. (2017), ISSN', url: 'https://doi.org/10.1186/s12970-017-0177-8' },
      ],
    });
    act(() => pressByTestId(tree, 'preset-info-toggle'));

    expect(isVisible(tree, 'preset-info-sources')).toBe(true);

    act(() => {
      pressByTestId(tree, 'preset-info-source-https://doi.org/10.1016/j.nut.2014.06.011');
    });
    expect(openURL).toHaveBeenCalledWith('https://doi.org/10.1016/j.nut.2014.06.011');

    openURL.mockRestore();
  });
});
