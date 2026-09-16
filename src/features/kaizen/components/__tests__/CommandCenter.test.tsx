/**
 * CommandCenter — Symply Kaizen (`symply-kaizen`) brand progress ring + glass card.
 *
 * Renders the REAL components through <ThemeProvider>, exercising every clamp /
 * completion branch of <ProgressRing> and both fills of <CommandCenterCard>.
 */
import React from 'react';
import { Text } from 'react-native';
import { Circle } from 'react-native-svg';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { KAIZEN_GRADIENT_BRAND } from '@features/kaizen/theme/appColors';

import { allText } from '../../test-utils/kaizenScreenTestKit';
import { CommandCenterCard, ProgressRing } from '../CommandCenter';

function renderTree(node: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

describe('ProgressRing', () => {
  it('renders the rounded percentage and default "done" label at a mid value', () => {
    const tree = renderTree(<ProgressRing progress={0.5} />);
    const text = allText(tree.toJSON());
    expect(text).toContain('50%');
    expect(text).toContain('done');
  });

  it('clamps a negative progress to 0%', () => {
    const tree = renderTree(<ProgressRing progress={-2} />);
    expect(allText(tree.toJSON())).toContain('0%');
  });

  it('clamps a >1 progress to 100% and uses the solid complete tone', () => {
    const tree = renderTree(<ProgressRing progress={1.7} size={120} stroke={10} label="complete" />);
    const text = allText(tree.toJSON());
    expect(text).toContain('100%');
    expect(text).toContain('complete');

    const circles = tree.root.findAllByType(Circle);
    expect(circles).toHaveLength(2);
    // Progress arc (2nd circle) is painted with the solid complete tone when done.
    expect(circles[1].props.stroke).toBe(KAIZEN_GRADIENT_BRAND[1]);
  });

  it('paints the progress arc with the gradient url when not complete', () => {
    const tree = renderTree(<ProgressRing progress={0.25} />);
    const circles = tree.root.findAllByType(Circle);
    expect(String(circles[1].props.stroke)).toMatch(/^url\(#/);
  });
});

describe('CommandCenterCard', () => {
  it('renders children in a plain glass card (no tint → not strong)', () => {
    const tree = renderTree(
      <CommandCenterCard>
        <Text>plain-card-child</Text>
      </CommandCenterCard>,
    );
    expect(allText(tree.toJSON())).toContain('plain-card-child');
  });

  it('renders children in a strong glass card when a hero tint is supplied', () => {
    const tree = renderTree(
      <CommandCenterCard tint="#5B7CFF">
        <Text>hero-card-child</Text>
      </CommandCenterCard>,
    );
    expect(allText(tree.toJSON())).toContain('hero-card-child');
  });
});
