/**
 * Unit tests for AppBarChart's grouped-bar flattening. This is the pure geometry
 * that turns compare-screen year groups into the linear bar list gifted-charts
 * renders — small gaps between sibling bars, a larger gap between groups, and the
 * shared x-axis label on the first bar of each group.
 */
import { flattenBarGroups, type AppBarGroup } from '../AppBarChart';

const OPTS = { intraSpacing: 2, groupSpacing: 12 };

describe('flattenBarGroups', () => {
  const groups: AppBarGroup[] = [
    { label: 'Jan', bars: [{ value: 10, frontColor: 'a' }, { value: 20, frontColor: 'b' }] },
    { label: 'Feb', bars: [{ value: 5, frontColor: 'a' }, { value: 6, frontColor: 'b' }] },
  ];

  it('emits one bar per group bar, in order', () => {
    expect(flattenBarGroups(groups, OPTS)).toHaveLength(4);
  });

  it('labels only the first bar of each group and flags it as the group start', () => {
    const flat = flattenBarGroups(groups, OPTS);
    expect(flat[0]).toEqual({ value: 10, frontColor: 'a', label: 'Jan', spacing: 2, isGroupStart: true });
    expect(flat[1]).toEqual({ value: 20, frontColor: 'b', label: '', spacing: 12, isGroupStart: false });
    expect(flat[2].label).toBe('Feb');
    expect(flat[2].isGroupStart).toBe(true);
    expect(flat[3].label).toBe('');
  });

  it('uses the group gap after the last sibling and the intra gap between siblings', () => {
    const flat = flattenBarGroups(groups, OPTS);
    expect(flat[0].spacing).toBe(2); // between Jan's two bars
    expect(flat[1].spacing).toBe(12); // after Jan's last bar → group gap
  });

  it('gives a single-bar group the group gap immediately', () => {
    const flat = flattenBarGroups([{ label: 'Solo', bars: [{ value: 3, frontColor: 'x' }] }], OPTS);
    expect(flat).toHaveLength(1);
    expect(flat[0]).toEqual({ value: 3, frontColor: 'x', label: 'Solo', spacing: 12, isGroupStart: true });
  });

  it('returns [] for no groups', () => {
    expect(flattenBarGroups([], OPTS)).toEqual([]);
  });
});
