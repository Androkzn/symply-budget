/**
 * Kaizen iconset shim (`@features/kaizen/brand/iconset`).
 *
 * Covers the pure state resolver (`brandIconState`), its hook form
 * (`useBrandIconState`), the donor→ecosystem prop `adapt()` (gradient / branded /
 * inactive / disabled), and renders every exported glyph so each adapter
 * component is exercised.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

// The ecosystem <Icon> falls back to a vector-icons glyph for names with no
// brand-kit art; that glyph asynchronously loads its font and setState()s after
// the test (a benign "not wrapped in act" warning). We only assert on <Icon>'s
// props here, never the glyph, so stub the font-icons out for a quiet, sync render.
jest.mock('@expo/vector-icons', () => {
  const ReactMock = require('react');
  const { Text: RNText } = require('react-native');
  const Glyph = (props: Record<string, unknown>) => ReactMock.createElement(RNText, props);
  return new Proxy(
    { __esModule: true },
    { get: (_t, key) => (key === '__esModule' ? true : Glyph) },
  );
});

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

import { Icon } from '@components/ui/Icon';
import { ThemeProvider } from '@contexts/ThemeContext';
import { useAppStore } from '@stores/appStore';

import { allText } from '../../../test-utils/kaizenScreenTestKit';
import * as iconset from '../index';
import { InboxIcon, brandIconState, useBrandIconState } from '../index';

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

function renderTree(node: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  mounted.push(tree);
  return tree;
}

afterEach(() => {
  // Unmount before resetting the theme so no still-mounted Icon subscribes to
  // the store update (which would re-render outside act()).
  act(() => mounted.splice(0).forEach((t) => t.unmount()));
  act(() => useAppStore.getState().setThemeMode('system'));
});

/* --------------------------------------------------------------- brandIconState */

describe('brandIconState', () => {
  it('returns "disabled" regardless of theme/active when disabled', () => {
    expect(brandIconState(false, true, true)).toBe('disabled');
    expect(brandIconState(true, false, true)).toBe('disabled');
  });

  it('returns branded-* when active', () => {
    expect(brandIconState(true, true)).toBe('branded-dark');
    expect(brandIconState(false, true)).toBe('branded-light');
  });

  it('returns inactive-* when not active', () => {
    expect(brandIconState(true, false)).toBe('inactive-dark');
    expect(brandIconState(false, false)).toBe('inactive-light');
  });
});

/* ------------------------------------------------------------ useBrandIconState */

function IconStateProbe({ active, disabled }: { active: boolean; disabled?: boolean }) {
  return <Text>{useBrandIconState(active, disabled)}</Text>;
}

describe('useBrandIconState', () => {
  it('reads the light theme (default disabled param)', () => {
    act(() => useAppStore.getState().setThemeMode('light'));
    expect(allText(renderTree(<IconStateProbe active />).toJSON())).toBe('branded-light');
    expect(allText(renderTree(<IconStateProbe active={false} />).toJSON())).toBe('inactive-light');
  });

  it('reads the dark theme', () => {
    act(() => useAppStore.getState().setThemeMode('dark'));
    expect(allText(renderTree(<IconStateProbe active />).toJSON())).toBe('branded-dark');
  });

  it('honours an explicit disabled flag', () => {
    act(() => useAppStore.getState().setThemeMode('light'));
    expect(allText(renderTree(<IconStateProbe active disabled />).toJSON())).toBe('disabled');
  });
});

/* --------------------------------------------------------------------- adapt() */

describe('adapt (via a rendered glyph)', () => {
  function iconProps(node: React.ReactElement) {
    return renderTree(node).root.findByType(Icon).props;
  }

  it('marks the glyph active when gradient is true', () => {
    expect(iconProps(<InboxIcon gradient />).active).toBe(true);
  });

  it('marks the glyph active for branded-dark / branded-light states', () => {
    expect(iconProps(<InboxIcon state="branded-dark" />).active).toBe(true);
    expect(iconProps(<InboxIcon state="branded-light" />).active).toBe(true);
  });

  it('leaves the glyph inactive with an untouched style for inactive states', () => {
    const props = iconProps(<InboxIcon state="inactive-dark" style={{ margin: 3 }} />);
    expect(props.active).toBe(false);
    expect(props.style).toEqual({ margin: 3 });
  });

  it('dims the glyph (opacity 0.42) when the state is disabled', () => {
    const props = iconProps(<InboxIcon state="disabled" style={{ margin: 3 }} />);
    expect(props.active).toBe(false);
    expect(props.style).toEqual([{ opacity: 0.42 }, { margin: 3 }]);
  });

  it('defaults to inactive and no style when passed no props', () => {
    const props = iconProps(<InboxIcon />);
    expect(props.active).toBe(false);
    expect(props.style).toBeUndefined();
  });

  it('forwards size / color / accessibilityLabel / testID', () => {
    const props = iconProps(
      <InboxIcon size={40} color="#abcdef" accessibilityLabel="Inbox" testID="inbox" />,
    );
    expect(props.size).toBe(40);
    expect(props.color).toBe('#abcdef');
    expect(props.accessibilityLabel).toBe('Inbox');
    expect(props.testID).toBe('inbox');
  });
});

/* ---------------------------------------------------------- every glyph renders */

describe('all exported glyphs', () => {
  const glyphNames = Object.keys(iconset).filter(
    (k) => k.endsWith('Icon') && typeof (iconset as Record<string, unknown>)[k] === 'function',
  );

  it('renders every exported glyph component', () => {
    expect(glyphNames.length).toBeGreaterThan(30);
    const tree = renderTree(
      <>
        {glyphNames.map((name) => {
          const Glyph = (iconset as unknown as Record<string, React.ComponentType>)[name];
          return <Glyph key={name} />;
        })}
      </>,
    );
    // One <Icon> per glyph adapter.
    expect(tree.root.findAllByType(Icon).length).toBe(glyphNames.length);
  });
});
