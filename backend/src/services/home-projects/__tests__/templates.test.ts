import { describe, expect, it } from 'vitest';

import { getTemplate, HOME_PROJECT_TEMPLATES } from '../templates';

describe('home project templates', () => {
  it('includes required template keys', () => {
    expect(Object.keys(HOME_PROJECT_TEMPLATES).sort()).toEqual(
      [
        'appliance_replace',
        'basement_finish',
        'bathroom_reno',
        'blank',
        'electrical_upgrade',
        'expand_space',
        'flooring_replace',
        'furniture_replace',
        'hvac_replace',
        'kitchen_reno',
        'outdoor_refresh',
        'paint_refresh',
        'plumbing_replace',
        'replace_fixture',
        'roof_replace',
        'window_door_replace',
      ].sort()
    );
  });

  it('bathroom reno has phases and budget rows to price', () => {
    const t = getTemplate('bathroom_reno');
    expect(t).not.toBeNull();
    expect(t!.phases.length).toBeGreaterThanOrEqual(4);
    expect(t!.budgetLines.map((l) => l.category)).toEqual([
      'materials',
      'labor',
      'permits',
    ]);
    expect(t!.contingencyPct).toBe(0);
  });

  it('returns null for unknown key', () => {
    expect(getTemplate('nope')).toBeNull();
  });

  /**
   * Every template's `key` must equal the record key it is filed under —
   * `createProject` writes `template.key` to `template_key`, so a copy-paste slip
   * here files a kitchen project as a bathroom and nothing else would catch it.
   */
  it('files every template under its own key', () => {
    for (const [key, template] of Object.entries(HOME_PROJECT_TEMPLATES)) {
      expect(template.key).toBe(key);
    }
  });

  /**
   * No template may carry money. A seeded figure is a national average invented
   * without this household's city, contractor or scope, and it lands in the hub's
   * Estimate the moment the project exists — the anchor the wizard's "~$12k avg"
   * caption was removed for.
   *
   * `estimateCents` is off the seed type, so this guards the other half: a
   * `contingency` LINE. `computeRollups` prefers an explicit line to the
   * percentage (`??`, and zero is a value), so seeding one — even at zero — would
   * peg the buffer for the life of the project.
   */
  it('seeds no money and no contingency line', () => {
    for (const [key, template] of Object.entries(HOME_PROJECT_TEMPLATES)) {
      for (const line of template.budgetLines) {
        expect(Object.keys(line).sort(), `${key} budget seed`).toEqual([
          'category',
          'label',
          'sortOrder',
        ]);
        expect(line.category, `${key} seeds a contingency line`).not.toBe('contingency');
      }
    }
  });

  /**
   * The RATE went the same way as the amounts.
   *
   * A per-template 10/15/20% buffer is a smaller lie than a seeded dollar figure
   * but it is the same kind of lie — a guess about a job nobody has scoped — and
   * it is worse in one respect: it compounds. Every real figure the member types
   * silently grows by it, so a project priced at $5,000 announces $5,750 and the
   * member cannot see where the extra came from.
   *
   * Contingency is opt-in now. This asserts no template turns it on for them.
   */
  it('seeds no contingency RATE either — the buffer is the member’s to set', () => {
    for (const [key, template] of Object.entries(HOME_PROJECT_TEMPLATES)) {
      expect(template.contingencyPct, `${key} contingency rate`).toBe(0);
    }
  });

  /**
   * Every phase list must be densely ordered from 0. `reorderPhases` and the hub's
   * render both sort on `sort_order`, and a duplicate would make two phases swap
   * places between renders.
   */
  it('numbers phases from zero without gaps', () => {
    for (const [key, template] of Object.entries(HOME_PROJECT_TEMPLATES)) {
      expect(
        template.phases.map((p) => p.sortOrder),
        `${key} phases`
      ).toEqual(template.phases.map((_, i) => i));
    }
  });

  /**
   * A template seeds a project's SHAPE and nothing a member has to shop for.
   *
   * The materials shortlists that used to be here — "Toilet", "Vanity",
   * "Tile" — were guesses at someone else's renovation presented as this
   * project's contents, and had to be read and deleted before the list said
   * anything true. This asserts they do not come back by way of a new template
   * copied from an old one.
   */
  it('seeds no materials', () => {
    for (const [key, template] of Object.entries(HOME_PROJECT_TEMPLATES)) {
      expect(
        Object.keys(template),
        `${key} should not carry a materials shortlist`
      ).not.toContain('selections');
    }
  });
});
