/**
 * Brand-decoupling invariants for the House → child split.
 *
 *  - `isHouseBrand()` is the client gate for House-only "home domain" features
 *    (tasks, contractors, spaces, gardening, reports, the AI Housekeeper).
 *  - Symply Budget must NOT ship the AI Housekeeper ("Mira") tab; House keeps it.
 */

import { getBrandById, isHouseBrand } from '@brand';

describe('isHouseBrand', () => {
  it('is true only for the parent Symply House brand', () => {
    expect(isHouseBrand('symply-house')).toBe(true);
  });

  it('is false for every child brand', () => {
    for (const id of ['symply-budget', 'symply-kaizen', 'symply-language', 'symply-health']) {
      expect(isHouseBrand(id)).toBe(false);
    }
  });
});

describe('brand tab packs — Mira / AI Housekeeper decoupling', () => {
  const tabRoutes = (id: string) => getBrandById(id).tabs.map(t => t.route);

  it('Symply Budget has no Mira/AI-Housekeeper tab', () => {
    expect(tabRoutes('symply-budget')).not.toContain('mira');
  });

  it('Symply Budget keeps Home + More locked routes (customizable pool)', () => {
    const routes = tabRoutes('symply-budget');
    expect(routes).toContain('index');
    expect(routes).toContain('settings');
    expect(routes).not.toContain('mira');
    // Budget domain tabs (no House home-domain mira)
    expect(routes).toEqual(
      expect.arrayContaining([
        'index',
        'planning',
        'spending',
        'savings',
        'pension',
        'wishes',
        'mortgage',
        'settings',
      ])
    );
  });

  it('Symply House keeps its Mira tab', () => {
    expect(tabRoutes('symply-house')).toContain('mira');
  });
});
