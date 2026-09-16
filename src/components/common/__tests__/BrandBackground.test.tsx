/**
 * BrandBackground — per-brand "atmosphere" backdrop.
 *
 * The wave ribbon/highlight hues are picked from BRAND_WAVES by the ACTIVE
 * brand id, with a Kaizen fallback. A missing entry is invisible in code but
 * paints the Language app in Kaizen's mint/teal, so this pins the Symply
 * Language entry (gold → orange → coral → pink) in both themes and proves the
 * Kaizen fallback is not what is being drawn.
 *
 * `@brand` is mocked behind a getter so the active brand can be flipped per
 * test without touching the generated brand files (the Jest run is House).
 */

import React from 'react';
import { processColor } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

let mockBrandId = 'symply-language';
jest.mock('@brand', () => ({
  get brandId() {
    return mockBrandId;
  },
}));

let mockIsDark = false;
jest.mock('@contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
}));

import { BrandBackground } from '@components/common/BrandBackground';

// Expected brand hexes, mirroring the bespoke decorative stops in the component
// (which disables the same rule for the same reason).
/* eslint-disable no-restricted-syntax */
// The Language ribbon/highlight stops declared in BRAND_WAVES['symply-language'].
const LANGUAGE_DARK_RIBBON = ['#FFE47C', '#FFC44E', '#FFA24E', '#FF875A', '#FF7A6E', '#FF7CA0'];
const LANGUAGE_LIGHT_RIBBON = ['#F5DCA2', '#F0C288', '#EEA882', '#EC9884', '#EA9896', '#E69CB2'];
const LANGUAGE_DARK_HIGHLIGHT = ['#FFF0BA', '#FFD6A0', '#FFB0AE'];
const LANGUAGE_LIGHT_HIGHLIGHT = ['#E8A64E', '#E88A5E', '#E48A84'];
// A Kaizen-only stop — must never appear while the Language brand is active.
const KAIZEN_ONLY_DARK_STOP = '#7CFFB2';
const KAIZEN_ONLY_LIGHT_STOP = '#7FE3C4';
/* eslint-enable no-restricted-syntax */

/**
 * react-native-svg flattens `<Stop stopColor>` children into a packed numeric
 * `gradient` array on the host node, so the hex strings never survive to the
 * rendered tree — compare against `processColor` instead.
 */
function paintedColors(): Set<number> {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<BrandBackground />);
  });
  const found = new Set<number>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const n = node as { props?: { gradient?: unknown }; children?: unknown };
    if (Array.isArray(n.props?.gradient)) {
      // [offset, colorInt, offset, colorInt, …]
      n.props.gradient.forEach((v, i) => {
        if (i % 2 === 1 && typeof v === 'number') found.add(v);
      });
    }
    if (n.children) walk(n.children);
  };
  walk(tree.toJSON());
  act(() => {
    tree.unmount();
  });
  return found;
}

function expectPainted(colors: readonly string[], painted: Set<number>, present: boolean) {
  for (const color of colors) {
    // `| 0` — processColor yields an unsigned ARGB int off-Android, while
    // react-native-svg stores the signed int32 form of the same colour.
    const argb = (processColor(color) as number) | 0; // eslint-disable-line no-bitwise
    expect({ color, painted: painted.has(argb) }).toEqual({
      color,
      painted: present,
    });
  }
}

describe('BrandBackground — Symply Language brand', () => {
  beforeEach(() => {
    mockBrandId = 'symply-language';
  });

  it('paints the Language light ribbon + highlight, not Kaizen', () => {
    mockIsDark = false;
    const painted = paintedColors();
    expectPainted([...LANGUAGE_LIGHT_RIBBON, ...LANGUAGE_LIGHT_HIGHLIGHT], painted, true);
    expectPainted([KAIZEN_ONLY_LIGHT_STOP], painted, false);
  });

  it('paints the Language dark ribbon + highlight, not Kaizen', () => {
    mockIsDark = true;
    const painted = paintedColors();
    expectPainted([...LANGUAGE_DARK_RIBBON, ...LANGUAGE_DARK_HIGHLIGHT], painted, true);
    expectPainted([KAIZEN_ONLY_DARK_STOP], painted, false);
  });
});

describe('BrandBackground — unknown brand', () => {
  it('falls back to the Kaizen wave', () => {
    mockBrandId = 'symply-nope';
    mockIsDark = true;
    const painted = paintedColors();
    expectPainted([KAIZEN_ONLY_DARK_STOP], painted, true);
    expectPainted([LANGUAGE_DARK_RIBBON[0]], painted, false);
  });
});
