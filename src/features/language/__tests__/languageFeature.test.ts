/**
 * Feature-barrel contract: the brand gate (`isLanguageBrand`, used by
 * src/api/auth.ts to route Language auth) and the port-phase constants that
 * downstream tooling/docs stay in sync with.
 */
import {
  LANGUAGE_FEATURE_ID,
  LANGUAGE_PORT_ORDER,
  LANGUAGE_DONOR_INVENTORY,
  isLanguageBrand,
} from '../index';

describe('isLanguageBrand', () => {
  it('is true only for the symply-language brand id', () => {
    expect(isLanguageBrand('symply-language')).toBe(true);
    expect(isLanguageBrand('symply-house')).toBe(false);
    expect(isLanguageBrand('symply-budget')).toBe(false);
  });

  it('defaults to the active brand id and returns a boolean', () => {
    expect(typeof isLanguageBrand()).toBe('boolean');
  });
});

describe('language feature constants', () => {
  it('exposes the feature id', () => {
    expect(LANGUAGE_FEATURE_ID).toBe('language');
  });

  it('lists the port phases in build order starting at shell', () => {
    expect(LANGUAGE_PORT_ORDER[0]).toBe('shell');
    expect(LANGUAGE_PORT_ORDER).toContain('assessment');
    expect(LANGUAGE_PORT_ORDER).toContain('chat');
    // No duplicate phases.
    expect(new Set(LANGUAGE_PORT_ORDER).size).toBe(LANGUAGE_PORT_ORDER.length);
  });

  it('carries the donor inventory snapshot', () => {
    expect(LANGUAGE_DONOR_INVENTORY.app).toContain('simple-language');
  });
});
