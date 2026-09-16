/**
 * FilterTabs — scrollable mode filling the row it is given.
 *
 * A horizontal ScrollView measures its content on an unbounded main axis, so
 * `flexGrow` on the tabs has no free space to divide and the strip hugs its
 * labels on the left of a wide screen. The component therefore MEASURES: the
 * ScrollView's `onLayout` is the viewport, `onContentSizeChange` is the strip's
 * natural width, and when the second fits inside the first the row is pinned to
 * an explicit width so the tabs can share it.
 *
 * These tests drive those two callbacks in the order React Native fires them —
 * content size FIRST, layout second — because that order is exactly what an
 * earlier attempt got wrong: keying the stored measurement on the viewport made
 * `onLayout` invalidate the only reading that would ever arrive.
 */
import React from 'react';
import { ScrollView } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { FilterTabs } from '../FilterTabs';
import type { FilterTab } from '../FilterTabs';

const TABS: FilterTab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tax', label: 'Property Tax' },
  { id: 'assessment', label: 'Assessment' },
  { id: 'members', label: 'Members', count: 1 },
];

async function render(tabs: FilterTab[] = TABS) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <FilterTabs tabs={tabs} activeTab="tax" onTabChange={() => {}} scrollable />
      </ThemeProvider>
    );
  });
  return tree;
}

/** The strip row itself — not the ScrollView's internal content container. */
function row(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findByProps({ testID: 'filter-tabs-row' });
}

function flatten(style: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (s: unknown) => {
    if (!s) return;
    if (Array.isArray(s)) {
      s.forEach(walk);
      return;
    }
    if (typeof s === 'object') Object.assign(out, s as Record<string, unknown>);
  };
  walk(style);
  return out;
}

/** Report the natural content width, then the viewport — RN's real order. */
async function layout(
  tree: ReactTestRenderer.ReactTestRenderer,
  { content, viewport }: { content: number; viewport: number }
) {
  const scroll = tree.root.findByType(ScrollView);
  await act(async () => {
    scroll.props.onContentSizeChange(content, 44);
  });
  await act(async () => {
    scroll.props.onLayout({ nativeEvent: { layout: { width: viewport, height: 44 } } });
  });
}

describe('FilterTabs — scrollable strip fills the available width', () => {
  it('pins the row to the viewport when the tabs fit inside it', async () => {
    const tree = await render();
    await layout(tree, { content: 420, viewport: 1180 });

    expect(flatten(row(tree).props.style).width).toBe(1180);
  });

  it('gives every tab a share of the leftover width once pinned', async () => {
    const tree = await render();
    await layout(tree, { content: 420, viewport: 1180 });

    const tab = tree.root.findByProps({ testID: 'filter-tab-overview' });
    const style = flatten(tab.props.style);
    expect(style.flexGrow).toBe(1);
    // Natural label width stays the floor, so a long label is never squeezed.
    expect(style.flexBasis).toBe('auto');
    expect(style.flexShrink).toBe(0);
  });

  it('leaves the row alone and scrolls when the tabs do NOT fit', async () => {
    const tree = await render();
    await layout(tree, { content: 900, viewport: 390 });

    expect(flatten(row(tree).props.style).width).toBeUndefined();
    expect(flatten(tree.root.findByProps({ testID: 'filter-tab-overview' }).props.style).flex).toBe(
      0
    );
  });

  it('holds the natural width when the stretched row reports its new size back', async () => {
    const tree = await render();
    await layout(tree, { content: 420, viewport: 1180 });

    // The pinned row now measures a full viewport wide. Recording that would
    // overwrite the input with the answer; the row must stay pinned.
    await act(async () => {
      tree.root.findByType(ScrollView).props.onContentSizeChange(1180, 44);
    });
    expect(flatten(row(tree).props.style).width).toBe(1180);
  });

  it('re-measures a changed tab set instead of stretching off the old reading', async () => {
    const tree = await render();
    await layout(tree, { content: 420, viewport: 1180 });
    expect(flatten(row(tree).props.style).width).toBe(1180);

    // A wider set of tabs arrives: the stored width no longer applies, so the
    // row drops back to natural size until the new measurement lands.
    const wider = [...TABS, { id: 'docs', label: 'Documents and Warranties' }];
    await act(async () => {
      tree.update(
        <ThemeProvider>
          <FilterTabs tabs={wider} activeTab="tax" onTabChange={() => {}} scrollable />
        </ThemeProvider>
      );
    });
    expect(flatten(row(tree).props.style).width).toBeUndefined();

    await act(async () => {
      tree.root.findByType(ScrollView).props.onContentSizeChange(1600, 44);
    });
    expect(flatten(row(tree).props.style).width).toBeUndefined();
  });

  it('re-decides on rotation without needing a fresh content measurement', async () => {
    const tree = await render();
    await layout(tree, { content: 420, viewport: 1180 });
    expect(flatten(row(tree).props.style).width).toBe(1180);

    // Narrower than the strip's natural width — must unpin and scroll again.
    await act(async () => {
      tree.root
        .findByType(ScrollView)
        .props.onLayout({ nativeEvent: { layout: { width: 320, height: 44 } } });
    });
    expect(flatten(row(tree).props.style).width).toBeUndefined();
  });
});
