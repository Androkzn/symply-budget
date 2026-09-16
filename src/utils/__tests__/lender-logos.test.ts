/**
 * lender-logos — the curated Canadian lender registry + resolvers behind the
 * mortgage LenderPicker. Verifies alias resolution, the custom-lender monogram
 * fallback, query matching, that no real logos are bundled by default, and the
 * registry's structural invariants (unique kebab slugs/names, sane monograms).
 */
import {
  POPULAR_LENDERS,
  getLenderInfo,
  getLenderLogo,
  lenderMatchesQuery,
  matchLender,
} from '@utils/lender-logos';

describe('lender-logos registry', () => {
  it('has unique, kebab-case slugs and unique display names', () => {
    const slugs = POPULAR_LENDERS.map((l) => l.slug);
    const names = POPULAR_LENDERS.map((l) => l.name.toLowerCase());
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(names).size).toBe(names.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('has a legible monogram and a hex color for every lender', () => {
    for (const l of POPULAR_LENDERS) {
      expect(l.short.length).toBeGreaterThanOrEqual(1);
      expect(l.short.length).toBeLessThanOrEqual(4);
      expect(l.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('never maps one alias/name to two different lenders', () => {
    const keyToSlug = new Map<string, string>();
    for (const l of POPULAR_LENDERS) {
      for (const key of [l.name, ...(l.aliases ?? [])]) {
        const k = key.toLowerCase();
        const prev = keyToSlug.get(k);
        expect(prev === undefined || prev === l.slug).toBe(true);
        keyToSlug.set(k, l.slug);
      }
    }
  });
});

describe('matchLender', () => {
  it('resolves the canonical name (case-insensitive)', () => {
    expect(matchLender('TD')?.slug).toBe('td');
    expect(matchLender('  rbc ')?.slug).toBe('rbc');
    expect(matchLender('scotiabank')?.slug).toBe('scotiabank');
  });

  it('resolves known aliases to the canonical lender', () => {
    expect(matchLender('TD Canada Trust')?.name).toBe('TD');
    expect(matchLender('Royal Bank of Canada')?.name).toBe('RBC');
    expect(matchLender('Bank of Montreal')?.name).toBe('BMO');
    expect(matchLender('EQ Bank')?.name).toBe('Equitable Bank');
  });

  it('returns null for unknown or empty names', () => {
    expect(matchLender('Some Local Broker')).toBeNull();
    expect(matchLender('')).toBeNull();
    expect(matchLender(null)).toBeNull();
    expect(matchLender(undefined)).toBeNull();
  });
});

describe('getLenderInfo', () => {
  it('returns the curated entry for a known lender', () => {
    expect(getLenderInfo('CIBC')?.slug).toBe('cibc');
  });

  it('derives a deterministic monogram badge for a custom lender', () => {
    const a = getLenderInfo('Neighbourhood Trust');
    const b = getLenderInfo('neighbourhood trust');
    expect(a?.short).toBe('NT');
    expect(a?.slug).toBe(''); // custom → no bundled asset
    expect(a?.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(a?.color).toBe(b?.color); // same name → same color, regardless of case
  });

  it('returns null for empty input', () => {
    expect(getLenderInfo('   ')).toBeNull();
  });
});

describe('lenderMatchesQuery', () => {
  const td = POPULAR_LENDERS.find((l) => l.slug === 'td')!;

  it('matches by name, alias, and monogram', () => {
    expect(lenderMatchesQuery(td, 'td')).toBe(true);
    expect(lenderMatchesQuery(td, 'canada trust')).toBe(true); // alias
    expect(lenderMatchesQuery(td, '')).toBe(true); // empty query matches all
    expect(lenderMatchesQuery(td, 'rbc')).toBe(false);
  });
});

describe('getLenderLogo', () => {
  it('bundles no real logos by default (custom + curated both fall back to monogram)', () => {
    expect(getLenderLogo('TD')).toBeUndefined();
    expect(getLenderLogo('Some Local Broker')).toBeUndefined();
  });
});
