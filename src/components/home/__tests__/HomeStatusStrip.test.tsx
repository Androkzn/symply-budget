/**
 * HomeStatusStrip — the compact glanceable stat pills at the top of Home.
 * Covers: empty → renders nothing, the icon uses the main brand green by
 * default, a "hot" tint overrides the green on both icon + value, and the icon
 * colour is decoupled from the value text colour for a normal (untinted) stat.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { getAppColors } from '@theme';

import { HomeStatusStrip, type HomeStatItem } from '../HomeStatusStrip';

// primary === palette.pastel.teal (#4ECDC4) across every scheme (light/clean/dark).
const PRIMARY = getAppColors('light').primary;
const HOT = '#FF3B30';

const ITEMS: HomeStatItem[] = [
  { key: 'overdue', value: '2', label: 'Overdue', icon: 'alert-circle', tint: HOT },
  { key: 'week', value: '1', label: 'This week', icon: 'calendar' },
];

async function renderStrip(items: HomeStatItem[]) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HomeStatusStrip items={items} />
      </ThemeProvider>
    );
  });
  // Flush the vector-icons async font-load state update so it doesn't warn.
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
}

const pillFor = (tree: ReactTestRenderer.ReactTestRenderer, key: string) =>
  tree.root.findAll((n) => n.props?.testID === `home-stat-${key}`)[0];

const iconColor = (tree: ReactTestRenderer.ReactTestRenderer, key: string, iconName: string) =>
  pillFor(tree, key).findAll((n) => n.props?.name === iconName)[0].props.color;

// The big number uses variant "title3"; grab its resolved colour.
const valueColor = (tree: ReactTestRenderer.ReactTestRenderer, key: string) =>
  pillFor(tree, key).findAll((n) => n.props?.variant === 'title3')[0].props.color;

describe('HomeStatusStrip', () => {
  it('renders nothing when there are no items', async () => {
    expect((await renderStrip([])).toJSON()).toBeNull();
  });

  it('tints an untinted stat icon with the main brand green', async () => {
    const tree = await renderStrip(ITEMS);
    expect(iconColor(tree, 'week', 'calendar')).toBe(PRIMARY);
  });

  it('lets a "hot" tint override the green on both the icon and the value', async () => {
    const tree = await renderStrip(ITEMS);
    expect(iconColor(tree, 'overdue', 'alert-circle')).toBe(HOT);
    expect(valueColor(tree, 'overdue')).toBe(HOT);
  });

  it('decouples the icon colour from the value text colour on a normal stat', async () => {
    const tree = await renderStrip(ITEMS);
    // Icon is the brand green while the value keeps the neutral text colour.
    expect(iconColor(tree, 'week', 'calendar')).toBe(PRIMARY);
    expect(valueColor(tree, 'week')).not.toBe(PRIMARY);
  });
});
