/**
 * TabOverflowSection — the "MORE TABS" list rendered at the top of the More /
 * settings tab for brands with `customizableTabs` (Kaizen, House, Budget,
 * Language). Renders the REAL component under the default (customizable) brand
 * and drives it: one row per overflow tab (label + navigation), the special
 * `index` → `/` mapping, and the always-present "Customize Tabs" row. The
 * overflow list itself comes from `useEffectiveTabs`, which is mocked so the
 * rendered rows are deterministic (its own logic is covered by
 * src/navigation/__tests__/resolveEffectiveTabs.test.ts).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { TabOverflowSection } from '../TabOverflowSection';

type OverflowTab = {
  route: string;
  label?: string;
  icon?: string;
  brandIcon?: string;
  sfSymbol?: string;
};

let mockOverflow: OverflowTab[] = [];
jest.mock('@navigation/useEffectiveTabs', () => ({
  useEffectiveTabs: () => ({ visible: [], overflow: mockOverflow }),
}));

// getTabScreenBrandIcon reads the active brand's icon map; stub it so the row
// icon lookup is deterministic and brand-independent.
jest.mock('@navigation/tabRegistry', () => ({
  getTabScreenBrandIcon: () => undefined,
}));

jest.mock('@hooks/useFeature', () => ({
  useFeature: () => false,
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

// BrandSymbol pulls native icon fonts; stub it — this suite asserts rows and
// navigation, not the glyph.
jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    BrandSymbol: () => ReactMock.createElement(View, { testID: 'brand-symbol' }),
  };
});

// --- rendered-tree helpers (host string nodes only) ---
type Tree = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function instanceText(inst: Instance): string {
  return inst
    .findAll((n) => typeof n.type === 'string')
    .flatMap((n) => {
      const c = n.props?.children;
      return Array.isArray(c) ? c : [c];
    })
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .map(String)
    .join('');
}

function pressByText(tree: Tree, text: string): void {
  const match = tree.root.find(
    (n) => typeof n.props?.onPress === 'function' && instanceText(n).includes(text),
  );
  match.props.onPress();
}

async function renderSection() {
  let tree!: Tree;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <TabOverflowSection />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOverflow = [];
});

describe('TabOverflowSection — overflow rows', () => {
  it('renders a MORE TABS header and one row per overflow tab, plus Customize Tabs', async () => {
    mockOverflow = [
      { route: 'kaizen-career', label: 'Career', icon: 'briefcase' },
      { route: 'kaizen-assess', label: 'Assess', icon: 'clipboard' },
    ];
    const tree = await renderSection();
    const text = allText(tree.toJSON());

    expect(text).toContain('MORE TABS');
    expect(text).toContain('Career');
    expect(text).toContain('Assess');
    expect(text).toContain('CUSTOMIZATION');
    expect(text).toContain('Customize Tabs');
  });

  it('falls back to the route as the label when no label is set', async () => {
    mockOverflow = [{ route: 'kaizen-systems', icon: 'grid' }];
    const tree = await renderSection();
    expect(allText(tree.toJSON())).toContain('kaizen-systems');
  });
});

describe('TabOverflowSection — navigation', () => {
  it('navigates to /<route> on an overflow row press', async () => {
    mockOverflow = [{ route: 'kaizen-career', label: 'Career', icon: 'briefcase' }];
    const tree = await renderSection();

    act(() => pressByText(tree, 'Career'));
    expect(mockPush).toHaveBeenCalledWith('/kaizen-career');
  });

  it('maps the special "index" route to "/"', async () => {
    mockOverflow = [{ route: 'index', label: 'Home', icon: 'home' }];
    const tree = await renderSection();

    act(() => pressByText(tree, 'Home'));
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('navigates to /customize-tabs on the Customize Tabs row', async () => {
    mockOverflow = [{ route: 'kaizen-career', label: 'Career', icon: 'briefcase' }];
    const tree = await renderSection();

    act(() => pressByText(tree, 'Customize Tabs'));
    expect(mockPush).toHaveBeenCalledWith('/customize-tabs');
  });
});

describe('TabOverflowSection — empty overflow', () => {
  it('hides the MORE TABS header but still shows the CUSTOMIZATION section', async () => {
    mockOverflow = [];
    const tree = await renderSection();
    const text = allText(tree.toJSON());

    expect(text).not.toContain('MORE TABS');
    // The Customize Tabs row is always rendered, so its section name is too —
    // it is a section of the More hub in its own right, not a trailer on the
    // tab list above it.
    expect(text).toContain('CUSTOMIZATION');
    expect(text).toContain('Customize Tabs');

    act(() => pressByText(tree, 'Customize Tabs'));
    expect(mockPush).toHaveBeenCalledWith('/customize-tabs');
  });
});
