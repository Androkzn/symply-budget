/**
 * The invite landing page (and the deep link it emits) must speak the brand of
 * the Worker that served it — a Budget invite must open `simplebudget://` and
 * say "Symply Budget", never House. This pins the branding + scheme per brand.
 */
import { describe, expect, it } from 'vitest';

import { getBrandPresentation } from '../../config/brand-presentation';
import type { Env } from '../../types';
import { inviteLandingHtml } from '../invite-landing';

const mkEnv = (brand?: string): Env => ({ APP_BRAND: brand } as unknown as Env);

describe('inviteLandingHtml — brand-aware', () => {
  const cases = [
    { brand: 'symply-house', scheme: 'simplehouse', name: 'Symply House' },
    { brand: 'symply-budget', scheme: 'simplebudget', name: 'Symply Budget' },
    { brand: 'symply-kaizen', scheme: 'kaizen', name: 'Symply Kaizen' },
    { brand: 'symply-health', scheme: 'simplehealth', name: 'Symply Health' },
    { brand: 'symply-language', scheme: 'simplelanguage', name: 'Symply Language' },
  ] as const;

  for (const { brand, scheme, name } of cases) {
    it(`${brand} → ${scheme}:// + "${name}" copy`, () => {
      const presentation = getBrandPresentation(mkEnv(brand));
      const html = inviteLandingHtml(`${presentation.scheme}://join/abc123`, {
        householdName: 'Sweet Home',
        inviterName: 'Andrei',
        brand: presentation,
      });

      expect(html).toContain(`${scheme}://join/abc123`);
      expect(html).toContain(`Join Sweet Home`);
      expect(html).toContain(`Open ${name} to request to join`);
      expect(html).toContain(`og:site_name" content="${name}"`);
      // Never leak a different brand's scheme or name.
      for (const other of cases) {
        if (other.brand === brand) continue;
        expect(html).not.toContain(`${other.scheme}://`);
      }
    });
  }

  it('falls back to House for an unknown/missing brand (page never crashes)', () => {
    const presentation = getBrandPresentation(mkEnv(undefined));
    expect(presentation.displayName).toBe('Symply House');
    expect(presentation.scheme).toBe('simplehouse');

    const html = inviteLandingHtml(`${presentation.scheme}://join/x`, { brand: presentation });
    expect(html).toContain('simplehouse://join/x');
    expect(html).toContain('Symply House');
  });

  it('escapes a user-controlled household name in the branded copy', () => {
    const presentation = getBrandPresentation(mkEnv('symply-budget'));
    const html = inviteLandingHtml('simplebudget://join/x', {
      householdName: '<script>alert(1)</script>',
      brand: presentation,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
