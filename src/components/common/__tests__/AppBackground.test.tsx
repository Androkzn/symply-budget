/**
 * AppBackground — verifies the theme-aware brand gradient surface:
 *  - NEVER renders the legacy house splash (in any schema / theme)
 *  - light mode paints `gradients.lightBackground` from brand tokens
 *  - dark mode paints `gradients.darkBackground`
 *  - always renders its children
 */

import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { gradients } from '@brand/tokens.generated';
import { AppBackground } from '@components/common/AppBackground';
import { SchemeScope } from '@contexts/SchemeContext';
import { ThemeProvider } from '@contexts/ThemeContext';
import { useAppStore } from '@stores/appStore';
import { getAppColors } from '@theme/appColors';

const LIGHT_BG = getAppColors('clean').backgroundMain; // solid white underfill
const DARK_BG = getAppColors('dark').backgroundMain; // true-dark underfill

function hasSplash(node: unknown): boolean {
  const json = JSON.stringify(node);
  return json.includes('splash-light') || json.includes('splash-dark');
}

function rootBackground(renderer: ReactTestRenderer.ReactTestRenderer): unknown {
  const json = renderer.toJSON() as { props?: { style?: unknown } } | null;
  const style = json?.props?.style;
  const styles = Array.isArray(style) ? style : style ? [style] : [];
  const merged = Object.assign({}, ...styles.filter(Boolean));
  return (merged as { backgroundColor?: unknown }).backgroundColor;
}

function gradientProps(renderer: ReactTestRenderer.ReactTestRenderer) {
  const grad = renderer.root.findByType(LinearGradient);
  return grad.props as {
    colors: string[];
    locations: number[];
  };
}

const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

function renderBg(scheme?: 'clean' | 'house') {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  const tree = (
    <ThemeProvider>
      <AppBackground>
        <Text>content</Text>
      </AppBackground>
    </ThemeProvider>
  );
  act(() => {
    renderer = ReactTestRenderer.create(
      scheme ? <SchemeScope scheme={scheme}>{tree}</SchemeScope> : tree
    );
  });
  renderers.push(renderer);
  return renderer;
}

function treeText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map((t) => t.props.children)
    .join('');
}

afterEach(() => {
  act(() => renderers.splice(0).forEach((r) => r.unmount()));
});

beforeEach(() => {
  useAppStore.setState({ colorScheme: 'clean', themeMode: 'light' });
});

describe('AppBackground — brand gradient surface', () => {
  it('never renders the house splash (default / clean)', () => {
    expect(hasSplash(renderBg().toJSON())).toBe(false);
    expect(hasSplash(renderBg('clean').toJSON())).toBe(false);
  });

  it('never renders the house splash even for the legacy house schema', () => {
    act(() => useAppStore.setState({ colorScheme: 'house' }));
    expect(hasSplash(renderBg().toJSON())).toBe(false);
    expect(hasSplash(renderBg('house').toJSON())).toBe(false);
  });

  it('uses a solid white underfill in light mode', () => {
    expect(rootBackground(renderBg())).toBe(LIGHT_BG);
  });

  it('paints the brand lightBackground gradient in light mode', () => {
    const props = gradientProps(renderBg());
    expect(props.colors).toEqual([...gradients.lightBackground.colors]);
    expect(props.locations).toEqual([...gradients.lightBackground.locations]);
  });

  it('uses a solid true-dark underfill in dark mode', () => {
    act(() => useAppStore.setState({ themeMode: 'dark' }));
    expect(rootBackground(renderBg())).toBe(DARK_BG);
  });

  it('paints the brand darkBackground gradient in dark mode', () => {
    act(() => useAppStore.setState({ themeMode: 'dark' }));
    const props = gradientProps(renderBg());
    expect(props.colors).toEqual([...gradients.darkBackground.colors]);
    expect(props.locations).toEqual([...gradients.darkBackground.locations]);
  });

  it('still renders its children', () => {
    expect(treeText(renderBg())).toContain('content');
  });
});
