/**
 * SchemeContext — verifies the effective color-schema resolution:
 *  - falls back to the persisted `appStore.colorScheme`
 *  - an enclosing <SchemeScope> overrides the store for its subtree
 *  - `useAppColors()` now follows the light/dark THEME, not the legacy schema
 *    (the flat skin: light → off-white surfaces, dark → true-dark surfaces)
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { SchemeScope, useAppColorScheme } from '@contexts/SchemeContext';
import { useAppStore } from '@stores/appStore';
import { useAppColors } from '@theme/appColors';

function SchemeProbe() {
  return <Text>{useAppColorScheme()}</Text>;
}

function CardProbe() {
  return <Text>{useAppColors().card}</Text>;
}

const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

function render(node: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(node);
  });
  renderers.push(renderer);
  return renderer;
}

function textOf(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return renderer.root.findByType(Text).props.children as string;
}

afterEach(() => {
  act(() => renderers.splice(0).forEach((r) => r.unmount()));
});

beforeEach(() => {
  useAppStore.setState({ colorScheme: 'clean', themeMode: 'light' });
});

describe('useAppColorScheme — store fallback', () => {
  it('returns the persisted schema when there is no scope', () => {
    expect(textOf(render(<SchemeProbe />))).toBe('clean');

    act(() => useAppStore.setState({ colorScheme: 'house' }));
    expect(textOf(render(<SchemeProbe />))).toBe('house');
  });
});

describe('SchemeScope — subtree override', () => {
  it('forces house even when the store says clean', () => {
    expect(
      textOf(
        render(
          <SchemeScope scheme="house">
            <SchemeProbe />
          </SchemeScope>
        )
      )
    ).toBe('house');
  });

  it('forces clean even when the store says house', () => {
    act(() => useAppStore.setState({ colorScheme: 'house' }));
    expect(
      textOf(
        render(
          <SchemeScope scheme="clean">
            <SchemeProbe />
          </SchemeScope>
        )
      )
    ).toBe('clean');
  });
});

describe('useAppColors follows the light/dark theme (not the legacy schema)', () => {
  it('light → clean off-white card surface', () => {
    expect(textOf(render(<CardProbe />))).toBe('#F7FAFA');
  });

  it('dark → true-dark card surface', () => {
    act(() => useAppStore.setState({ themeMode: 'dark' }));
    expect(textOf(render(<CardProbe />))).toBe('#202632');
  });

  it('ignores the legacy house scope for color resolution', () => {
    // Scheme scope still resolves for `useAppColorScheme`, but colors no longer
    // branch on it — a house-scoped subtree stays on the clean light surfaces.
    expect(
      textOf(
        render(
          <SchemeScope scheme="house">
            <CardProbe />
          </SchemeScope>
        )
      )
    ).toBe('#F7FAFA');
  });
});
