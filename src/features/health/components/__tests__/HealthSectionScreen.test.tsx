/**
 * HealthSectionScreen — the shared chrome behind every Symply Health section tab
 * (Nutrition / Activity / Trends / Body / Habits).
 *
 * The five section screens all mount it with `loading` already resolved, so the
 * loading gate and the derived testIDs are never exercised by those suites. This
 * one drives the component directly: both sides of the gate, the scroll/scroll-end
 * ids each caller depends on for E2E, and the guarantee that children are NOT
 * mounted while loading (a section that fetched during the gate would fire its
 * effects twice).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View: RNView } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(RNView, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(RNView, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      ReactMock.createElement(RNView, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

import { HealthSectionScreen } from '../HealthSectionScreen';

type Rendered = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Rendered {
  let tree!: Rendered;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

function byTestId(tree: Rendered, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

const child = <Text testID="section-child">Body content</Text>;

describe('HealthSectionScreen — loaded state', () => {
  it('HEALTH-SECT-001: mounts the root, scroll container and scroll-end sentinel from one testID', () => {
    const tree = render(
      <HealthSectionScreen title="Nutrition" testID="health-nutrition-screen">
        {child}
      </HealthSectionScreen>,
    );
    // Every section's E2E flow targets these three ids; they all derive from one prop.
    expect(byTestId(tree, 'health-nutrition-screen')).toHaveLength(1);
    expect(byTestId(tree, 'health-nutrition-screen-scroll')).toHaveLength(1);
    expect(byTestId(tree, 'health-nutrition-screen-scroll-end')).toHaveLength(1);
  });

  it('HEALTH-SECT-002: renders its children when not loading', () => {
    const tree = render(
      <HealthSectionScreen title="Activity" testID="health-activity-screen">
        {child}
      </HealthSectionScreen>,
    );
    expect(byTestId(tree, 'section-child')).toHaveLength(1);
  });

  it('HEALTH-SECT-003: defaults to NOT loading when the prop is omitted', () => {
    const tree = render(
      <HealthSectionScreen title="Trends" testID="health-trends-screen">
        {child}
      </HealthSectionScreen>,
    );
    expect(byTestId(tree, 'section-child')).toHaveLength(1);
    expect(byTestId(tree, 'health-trends-screen-scroll')).toHaveLength(1);
  });

  it('HEALTH-SECT-004: passes the section title to the shared header', () => {
    const tree = render(
      <HealthSectionScreen title="Body" testID="health-body-screen">
        {child}
      </HealthSectionScreen>,
    );
    expect(byTestId(tree, 'screen-header')[0].props.accessibilityLabel).toBe('Body');
  });

  it('HEALTH-SECT-005: keeps taps working while a keyboard is up', () => {
    const tree = render(
      <HealthSectionScreen title="Nutrition" testID="health-nutrition-screen">
        {child}
      </HealthSectionScreen>,
    );
    // The Nutrition/Body/Habits forms all blur-to-save, so a single tap outside
    // the field must reach its target rather than being swallowed by the scroll.
    const scroll = byTestId(tree, 'health-nutrition-screen-scroll')[0];
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  });
});

describe('HealthSectionScreen — loading gate', () => {
  it('HEALTH-SECT-006: shows the spinner and mounts no scroll container', () => {
    const tree = render(
      <HealthSectionScreen title="Habits" testID="health-habits-screen" loading>
        {child}
      </HealthSectionScreen>,
    );
    expect(byTestId(tree, 'health-habits-screen-scroll')).toHaveLength(0);
    expect(byTestId(tree, 'health-habits-screen-scroll-end')).toHaveLength(0);
  });

  it('HEALTH-SECT-007: does not mount children while loading', () => {
    const tree = render(
      <HealthSectionScreen title="Habits" testID="health-habits-screen" loading>
        {child}
      </HealthSectionScreen>,
    );
    // Children mounted behind the gate would run their effects before the data
    // they render arrives — and again once it does.
    expect(byTestId(tree, 'section-child')).toHaveLength(0);
  });

  it('HEALTH-SECT-008: keeps the root testID mounted so E2E can wait on the screen', () => {
    const tree = render(
      <HealthSectionScreen title="Habits" testID="health-habits-screen" loading>
        {child}
      </HealthSectionScreen>,
    );
    // The root must exist during the gate, otherwise a flow that waits for the
    // screen id times out on a slow hydrate instead of waiting it out.
    expect(byTestId(tree, 'health-habits-screen')).toHaveLength(1);
    expect(byTestId(tree, 'screen-header')).toHaveLength(1);
  });

  it('HEALTH-SECT-009: swaps back to the content once loading resolves', () => {
    let tree!: Rendered;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <HealthSectionScreen title="Habits" testID="health-habits-screen" loading>
            {child}
          </HealthSectionScreen>
        </ThemeProvider>,
      );
    });
    expect(byTestId(tree, 'section-child')).toHaveLength(0);

    act(() => {
      tree.update(
        <ThemeProvider>
          <HealthSectionScreen title="Habits" testID="health-habits-screen" loading={false}>
            {child}
          </HealthSectionScreen>
        </ThemeProvider>,
      );
    });
    expect(byTestId(tree, 'section-child')).toHaveLength(1);
    expect(byTestId(tree, 'health-habits-screen-scroll-end')).toHaveLength(1);
  });
});

describe('HealthSectionScreen — layout', () => {
  it('HEALTH-SECT-010: spaces stacked cards from the container, not the scroll content', () => {
    const tree = render(
      <HealthSectionScreen title="Nutrition" testID="health-nutrition-screen">
        <View testID="card-a" />
        <View testID="card-b" />
      </HealthSectionScreen>,
    );
    // Same trap as HealthHomeScreen (HOME-097): the ScrollView has a single
    // child, so a gap on contentContainerStyle is inert.
    const { AdaptiveContainer } = require('@components/layout');
    const stack = tree.root.findByType(AdaptiveContainer);
    const { StyleSheet } = require('react-native');
    expect(StyleSheet.flatten(stack.props.style)?.gap).toBeGreaterThan(0);
    expect(byTestId(tree, 'card-a')).toHaveLength(1);
    expect(byTestId(tree, 'card-b')).toHaveLength(1);
  });
});
