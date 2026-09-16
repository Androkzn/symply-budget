/**
 * institution-logos — brand resolution for the account institution picker.
 * Curated brands resolve to their preset badge; anything else derives a stable
 * custom badge (initials + deterministic color); badge text color adapts to
 * background luminance for legibility.
 */
import {
  POPULAR_INSTITUTIONS,
  getInstitutionInfo,
  badgeTextColor,
} from '../institution-logos';

describe('getInstitutionInfo', () => {
  it('returns null for empty / whitespace names', () => {
    expect(getInstitutionInfo(null)).toBeNull();
    expect(getInstitutionInfo(undefined)).toBeNull();
    expect(getInstitutionInfo('   ')).toBeNull();
  });

  it('resolves a curated institution case-insensitively', () => {
    const info = getInstitutionInfo('wealthsimple');
    expect(info?.name).toBe('Wealthsimple');
    expect(info?.short).toBe('W');
    expect(info?.color).toMatch(/^#/);
  });

  it('derives a custom badge from a free-text name (multi-word → initials)', () => {
    const info = getInstitutionInfo('My Local Credit Union');
    expect(info?.name).toBe('My Local Credit Union');
    expect(info?.short).toBe('ML');
    expect(info?.color).toMatch(/^#/);
  });

  it('derives a 2-letter monogram for a single-word custom name', () => {
    expect(getInstitutionInfo('Acme')?.short).toBe('AC');
  });

  it('gives the same custom name a stable color across calls', () => {
    expect(getInstitutionInfo('Acme Trust')?.color).toBe(getInstitutionInfo('Acme Trust')?.color);
  });
});

describe('badgeTextColor', () => {
  it('uses white text on a dark brand color', () => {
    expect(badgeTextColor('#1A1A1A')).toBe('#FFFFFF');
  });

  it('uses dark text on a light brand color', () => {
    expect(badgeTextColor('#FDB913')).toBe('#1A1A1A'); // Sun Life yellow
  });
});

describe('POPULAR_INSTITUTIONS', () => {
  it('every entry has a name, monogram, and hex color', () => {
    for (const i of POPULAR_INSTITUTIONS) {
      expect(i.name.length).toBeGreaterThan(0);
      expect(i.short.length).toBeGreaterThanOrEqual(1);
      expect(i.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
