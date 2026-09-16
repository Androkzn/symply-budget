import type { TabConfigEntry } from '../tabRegistry';
import { resolveEffectiveTabs } from '../useEffectiveTabs';

/** A Budget-like pool: Home + More locked; Pension/Bills/Wishes default-hidden. */
const POOL: TabConfigEntry[] = [
  { route: 'index', icon: 'grid', label: 'Home', locked: true },
  { route: 'planning', icon: 'clipboard', label: 'Planning' },
  { route: 'spending', icon: 'card', label: 'Spending' },
  { route: 'savings', icon: 'trending-up', label: 'Savings' },
  { route: 'pension', icon: 'shield-checkmark', label: 'Pension', defaultHidden: true },
  { route: 'bills', icon: 'receipt', label: 'Bills', defaultHidden: true },
  { route: 'wishes', icon: 'gift', label: 'Wishes', defaultHidden: true },
  { route: 'settings', icon: 'ellipsis-horizontal', label: 'More', locked: true },
];

const routes = (tabs: TabConfigEntry[]) => tabs.map((t) => t.route);

describe('resolveEffectiveTabs', () => {
  it('uses brand defaults when there are no overrides', () => {
    const { pinned, overflow } = resolveEffectiveTabs(POOL, null, 5);
    // 4 visible defaults + More last = 5 pinned; hidden three overflow.
    expect(routes(pinned)).toEqual(['index', 'planning', 'spending', 'savings', 'settings']);
    expect(routes(overflow)).toEqual(['pension', 'bills', 'wishes']);
  });

  it('keeps More as the final pinned slot', () => {
    const { pinned } = resolveEffectiveTabs(POOL, null, 5);
    expect(pinned[pinned.length - 1].route).toBe('settings');
  });

  it('caps the pinned bar and overflows the excess visible tabs', () => {
    // Pin all six non-More tabs; max 5 → only first 4 (+ More) stay pinned.
    const overrides = [
      { route: 'index' as const, order: 0, visible: true },
      { route: 'planning' as const, order: 1, visible: true },
      { route: 'spending' as const, order: 2, visible: true },
      { route: 'savings' as const, order: 3, visible: true },
      { route: 'pension' as const, order: 4, visible: true },
      { route: 'bills' as const, order: 5, visible: true },
      { route: 'wishes' as const, order: 6, visible: false },
      { route: 'settings' as const, order: 7, visible: true },
    ];
    const { pinned, overflow } = resolveEffectiveTabs(POOL, overrides, 5);
    expect(routes(pinned)).toEqual(['index', 'planning', 'spending', 'savings', 'settings']);
    // pension overflowed by the cap; wishes hidden; bills overflowed by the cap.
    expect(routes(overflow)).toEqual(['pension', 'bills', 'wishes']);
  });

  it('respects a user reorder + hide', () => {
    const overrides = [
      { route: 'index' as const, order: 0, visible: true },
      { route: 'savings' as const, order: 1, visible: true },
      { route: 'planning' as const, order: 2, visible: false },
      { route: 'spending' as const, order: 3, visible: true },
      { route: 'settings' as const, order: 4, visible: true },
    ];
    const { pinned, overflow } = resolveEffectiveTabs(POOL, overrides, 5);
    expect(routes(pinned)).toEqual(['index', 'savings', 'spending', 'settings']);
    // planning hidden joins the default-hidden three; order: hidden-by-order.
    expect(overflow.map((t) => t.route)).toContain('planning');
    expect(overflow.map((t) => t.route)).toEqual(
      expect.arrayContaining(['planning', 'pension', 'bills', 'wishes']),
    );
  });

  it('never hides a locked tab even if an override marks it hidden', () => {
    const overrides = [
      { route: 'index' as const, order: 0, visible: false },
      { route: 'settings' as const, order: 1, visible: false },
    ];
    const { pinned } = resolveEffectiveTabs(POOL, overrides, 5);
    expect(routes(pinned)).toContain('index');
    expect(routes(pinned)).toContain('settings');
  });
});

/**
 * The iPad sidebar.
 *
 * `defaultHidden` exists because the phone bar has five slots for a pool of
 * eleven. The sidebar is a tall column capped at 15, so the same flag was
 * burying Mira, Garden, Spaces, Pros and Reports one tap into "More" for no
 * gain — which is what a 13-inch iPad showed: four icons and a More button.
 */
describe('resolveEffectiveTabs — tablet sidebar defaults', () => {
  it('pins every default-hidden tab when defaults are ignored', () => {
    const { pinned, overflow } = resolveEffectiveTabs(POOL, null, 15, true);
    expect(routes(pinned)).toEqual([
      'index',
      'planning',
      'spending',
      'savings',
      'pension',
      'bills',
      'wishes',
      'settings',
    ]);
    expect(overflow).toEqual([]);
  });

  it('still keeps More last on the sidebar', () => {
    const { pinned } = resolveEffectiveTabs(POOL, null, 15, true);
    expect(pinned[pinned.length - 1].route).toBe('settings');
  });

  it('still honours an explicit user hide — ignoring DEFAULTS is not ignoring choices', () => {
    const overrides = [{ route: 'bills' as const, order: 5, visible: false }];
    const { pinned, overflow } = resolveEffectiveTabs(POOL, overrides, 15, true);
    expect(routes(pinned)).not.toContain('bills');
    expect(routes(overflow)).toContain('bills');
    // …while the other default-hidden tabs still come through.
    expect(routes(pinned)).toEqual(expect.arrayContaining(['pension', 'wishes']));
  });

  it('still caps at maxVisible, so a pool larger than the rail overflows', () => {
    const { pinned, overflow } = resolveEffectiveTabs(POOL, null, 4, true);
    expect(pinned).toHaveLength(4);
    expect(pinned[pinned.length - 1].route).toBe('settings');
    expect(overflow.length).toBeGreaterThan(0);
  });

  it('leaves the phone bar untouched (flag off = previous behaviour)', () => {
    const { pinned } = resolveEffectiveTabs(POOL, null, 5, false);
    expect(routes(pinned)).toEqual(['index', 'planning', 'spending', 'savings', 'settings']);
  });
});
