/**
 * Per-brand onboarding + legal content (src/config/brandContent.ts).
 *
 * The onboarding welcome UI and the legal screens are SHARED across brands and
 * only read their copy from these maps — a missing brand entry silently makes
 * an app render House's copy (the documented fallback), which for the legal
 * screens would describe the wrong product. Asserts the Symply Language entries
 * exist and are genuinely Language copy rather than the House fallback.
 */

import {
  HOUSE_BRAND_ID,
  getLegalContent,
  getWelcomeContent,
} from '@config/brandContent';

describe('getWelcomeContent — Symply Language', () => {
  const content = getWelcomeContent('symply-language');

  it('is not the House fallback', () => {
    expect(content).not.toBe(getWelcomeContent(HOUSE_BRAND_ID));
  });

  it('uses the language-learning subtitle', () => {
    expect(content.subtitle).toBe(
      'Learn a new language with a personal tutor and a plan that fits you.'
    );
  });

  it('ships three value-prop cards with brand icons and a fallback icon', () => {
    expect(content.features).toHaveLength(3);
    expect(content.features.map(f => f.title)).toEqual([
      'Learn Your Way',
      'Practice Speaking',
      'Track Progress',
    ]);
    for (const feature of content.features) {
      expect(feature.brandIcons?.length).toBeGreaterThan(0);
      expect(feature.fallbackIcon).toBeTruthy();
      expect(feature.description).toBeTruthy();
    }
  });
});

describe('getLegalContent — Symply Language', () => {
  const content = getLegalContent('symply-language');

  it('is not the House fallback', () => {
    expect(content).not.toBe(getLegalContent(HOUSE_BRAND_ID));
  });

  it('describes the service in predicate form (the builder prepends APP_NAME)', () => {
    expect(content.serviceDescription).toBe(
      'is a language-learning application that helps you learn and practice a new language with a personal tutor.'
    );
    expect(content.serviceDescription.startsWith('is a')).toBe(true);
  });

  it('lists the Language-specific collected data items', () => {
    expect(content.dataItems).toEqual([
      'Your learner profile and language preferences',
      'Practice activity and learning progress',
    ]);
  });
});

describe('unknown brands still fall back to House', () => {
  it('falls back for both content maps', () => {
    expect(getWelcomeContent('symply-nope')).toBe(getWelcomeContent(HOUSE_BRAND_ID));
    expect(getLegalContent('symply-nope')).toBe(getLegalContent(HOUSE_BRAND_ID));
  });
});
