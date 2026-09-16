/**
 * Kaizen brand-primitive adapters (`@features/kaizen/brand`).
 *
 * Exercises every adapter: useBrandMode (light/dark), GlassCard (plain / strong /
 * tint / custom radius+padding), BrandButton (default + full prop pass-through),
 * GradientText (all text/size/weight/width/align derivations), GradientButton
 * (default + custom colors, pressed style), BrandBackground, and BrandKaizenRingIcon.
 *
 * The two ecosystem leaf primitives that need no coverage here — AppBackground and
 * the SVG GradientText — are stubbed; GradientText's stub captures the derived
 * props so the shim's string/size/weight math can be asserted directly.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Text } from 'react-native';
import Svg from 'react-native-svg';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { useAppStore } from '@stores/appStore';

import { allText, pressByText } from '../../test-utils/kaizenScreenTestKit';
import {
  BrandBackground,
  BrandButton,
  BrandKaizenRingIcon,
  GlassCard,
  GradientButton,
  GradientText,
  useBrandMode,
} from '../index';

// Toggling the theme writes through appStore → settingsSync, which schedules a
// debounced flush that later does a dynamic import (crashes the Jest VM). Stub it.
jest.mock('@services/settings-sync', () => ({
  __esModule: true,
  settingsSync: {
    queueSync: jest.fn(),
    setOnlineStatus: jest.fn(),
    flushNow: jest.fn(),
  },
}));

jest.mock('@components/common/AppBackground', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
  };
});

jest.mock('@components/common/GradientText', () => {
  const ReactMock = require('react');
  const { Text: RNText } = require('react-native');
  const calls: Array<Record<string, unknown>> = [];
  const MockGradientText = (props: Record<string, unknown>) => {
    calls.push(props);
    return ReactMock.createElement(RNText, null, String(props.text));
  };
  (MockGradientText as unknown as { calls: typeof calls }).calls = calls;
  return { __esModule: true, GradientText: MockGradientText };
});

// The capture buffer attached to the GradientText stub above.
const gradientCalls = (
  require('@components/common/GradientText').GradientText as unknown as {
    calls: Array<Record<string, unknown>>;
  }
).calls;

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

function renderTree(node: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  mounted.push(tree);
  return tree;
}

function renderBare(node: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(node);
  });
  mounted.push(tree);
  return tree;
}

afterEach(() => {
  // Unmount before resetting the theme so no still-mounted subscriber re-renders
  // outside act() when the store update fires.
  act(() => mounted.splice(0).forEach((t) => t.unmount()));
  act(() => useAppStore.getState().setThemeMode('system'));
  gradientCalls.length = 0;
});

/* ------------------------------------------------------------------ useBrandMode */

function BrandModeProbe() {
  return <Text>{useBrandMode()}</Text>;
}

describe('useBrandMode', () => {
  it('resolves "light" when the theme is not dark', () => {
    act(() => useAppStore.getState().setThemeMode('light'));
    const tree = renderTree(<BrandModeProbe />);
    expect(allText(tree.toJSON())).toBe('light');
  });

  it('resolves "dark" when the theme is dark', () => {
    act(() => useAppStore.getState().setThemeMode('dark'));
    const tree = renderTree(<BrandModeProbe />);
    expect(allText(tree.toJSON())).toBe('dark');
  });
});

/* ------------------------------------------------------------------- GlassCard */

describe('GlassCard', () => {
  it('renders a plain (non-strong, untinted) card', () => {
    const tree = renderTree(
      <GlassCard>
        <Text>glass-plain</Text>
      </GlassCard>,
    );
    expect(allText(tree.toJSON())).toContain('glass-plain');
  });

  it('renders the strong fill', () => {
    const tree = renderTree(
      <GlassCard strong>
        <Text>glass-strong</Text>
      </GlassCard>,
    );
    expect(allText(tree.toJSON())).toContain('glass-strong');
  });

  it('honours an explicit tint, radius, padding and style', () => {
    const tree = renderTree(
      <GlassCard tint="#123456" radius={8} padding={4} style={{ margin: 2 }}>
        <Text>glass-tint</Text>
      </GlassCard>,
    );
    expect(allText(tree.toJSON())).toContain('glass-tint');
  });
});

/* ------------------------------------------------------------------ BrandButton */

describe('BrandButton', () => {
  it('renders a default primary button and fires onPress', () => {
    const onPress = jest.fn();
    const tree = renderTree(<BrandButton title="Save" onPress={onPress} />);
    act(() => pressByText(tree, 'Save'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('passes icon / variant / disabled / fullWidth / style through', () => {
    const tree = renderTree(
      <BrandButton
        title="Go"
        icon={<Text>ic</Text>}
        variant="outline"
        disabled
        fullWidth={false}
        style={{ marginTop: 1 }}
      />,
    );
    expect(allText(tree.toJSON())).toContain('Go');
  });

  it('renders a loading button', () => {
    const tree = renderTree(<BrandButton title="Load" loading />);
    expect(tree.toJSON()).toBeTruthy();
  });
});

/* ----------------------------------------------------------------- GradientText */

describe('GradientText', () => {
  it('uses explicit text / fontSize / width / fontWeight / align / colors', () => {
    renderBare(
      <GradientText
        text="Hello"
        colors={['#000000']}
        fontSize={40}
        width={200}
        fontWeight="900"
        align="center"
        style={{ color: 'red' }}
      />,
    );
    const p = gradientCalls[gradientCalls.length - 1];
    expect(p).toMatchObject({
      text: 'Hello',
      fontSize: 40,
      width: 200,
      fontWeight: '900',
      align: 'center',
      colors: ['#000000'],
    });
  });

  it('derives text/size/weight from a string child and a style object', () => {
    renderBare(<GradientText style={{ fontSize: 30, fontWeight: '500' }}>WorldText</GradientText>);
    const p = gradientCalls[gradientCalls.length - 1];
    expect(p.text).toBe('WorldText');
    expect(p.fontSize).toBe(30);
    expect(p.fontWeight).toBe('500');
    expect(p.align).toBe('left');
    // width auto-estimated from the text length.
    expect(typeof p.width).toBe('number');
    expect(p.width as number).toBeGreaterThan(0);
  });

  it('stringifies a non-string child and defaults size 28 / weight 700', () => {
    renderBare(<GradientText>{42}</GradientText>);
    const p = gradientCalls[gradientCalls.length - 1];
    expect(p.text).toBe('42');
    expect(p.fontSize).toBe(28);
    expect(p.fontWeight).toBe('700');
  });

  it('falls back to an empty string when there is neither text nor children', () => {
    renderBare(<GradientText />);
    const p = gradientCalls[gradientCalls.length - 1];
    expect(p.text).toBe('');
  });
});

/* --------------------------------------------------------------- GradientButton */

describe('GradientButton', () => {
  it('renders default action colors, fires onPress, and toggles the pressed style', () => {
    const onPress = jest.fn();
    const tree = renderBare(
      <GradientButton onPress={onPress}>
        <Text>Go</Text>
      </GradientButton>,
    );
    // Resolve the outermost Pressable via its function style prop.
    const btn = tree.root.findAll((n) => typeof n.props?.style === 'function')[0];
    expect(btn.props.style({ pressed: true })).toBeTruthy();
    expect(btn.props.style({ pressed: false })).toBeTruthy();
    act(() => btn.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(tree.root.findAllByType(LinearGradient)).toHaveLength(1);
  });

  it('accepts custom gradient colors', () => {
    const tree = renderBare(
      <GradientButton colors={['#111111', '#222222']}>
        <Text>Custom</Text>
      </GradientButton>,
    );
    expect(tree.root.findByType(LinearGradient).props.colors).toEqual(['#111111', '#222222']);
  });
});

/* --------------------------------------------------------------- BrandBackground */

describe('BrandBackground', () => {
  it('wraps children in the ecosystem AppBackground', () => {
    const tree = renderBare(
      <BrandBackground>
        <Text>bg-child</Text>
      </BrandBackground>,
    );
    expect(allText(tree.toJSON())).toContain('bg-child');
  });
});

/* ----------------------------------------------------------- BrandKaizenRingIcon */

describe('BrandKaizenRingIcon', () => {
  it('renders with defaults (size 32, "Kaizen" label)', () => {
    const tree = renderBare(<BrandKaizenRingIcon />);
    const svg = tree.root.findByType(Svg);
    expect(svg.props.accessibilityLabel).toBe('Kaizen');
    expect(svg.props.width).toBe(32);
  });

  it('honours explicit size / label / testID / style', () => {
    const tree = renderBare(
      <BrandKaizenRingIcon size={48} accessibilityLabel="Loop" testID="ring" style={{ margin: 2 }} />,
    );
    const svg = tree.root.findByType(Svg);
    expect(svg.props.accessibilityLabel).toBe('Loop');
    expect(svg.props.width).toBe(48);
    expect(svg.props.testID).toBe('ring');
  });
});
