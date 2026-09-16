/**
 * The picker against the catalogue.
 *
 * The wizard's grid is hand-written — it carries a short title, an icon and a
 * group, none of which the catalogue holds — so it is the one place a template
 * can go missing without anything failing. A key in the catalogue with no tile is
 * a template nobody can pick; a tile with no key seeds a project with no phases,
 * because `getHomeProjectTemplateSeed` answers `null` for an unknown key and
 * `createProject` falls through to a bare project rather than throwing.
 *
 * Neither shows up in a type error, a lint run or any other suite, so it is
 * asserted here.
 */
import { HOME_PROJECT_TEMPLATE_KEYS } from '@features/house/local/logic/homeProjects';

import { TEMPLATE_GROUPS } from '../CreateHomeProjectWizard';

// Spread each group: `TEMPLATE_GROUPS` is `as const`, so `group.templates` is a
// readonly TUPLE, which `flatMap` will not flatten on its own.
const tiles: ReadonlyArray<{ key: string; title: string; icon: string }> =
  TEMPLATE_GROUPS.flatMap((group) => [...group.templates]);

describe('the create wizard’s template grid', () => {
  it('offers every catalogue template, in the catalogue’s order', () => {
    expect(tiles.map((tile) => tile.key)).toEqual([...HOME_PROJECT_TEMPLATE_KEYS]);
  });

  it('gives every tile a title and an icon', () => {
    for (const tile of tiles) {
      expect(tile.title.length).toBeGreaterThan(0);
      expect(tile.icon).toMatch(/-outline$/);
    }
  });

  /**
   * The icon is the thing the grid is scanned by, so two tiles wearing the same
   * one defeats the point of having them.
   */
  it('does not repeat an icon across tiles', () => {
    const icons = tiles.map((tile) => tile.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('files every tile under a named group', () => {
    for (const group of TEMPLATE_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.templates.length).toBeGreaterThan(0);
    }
  });
});
