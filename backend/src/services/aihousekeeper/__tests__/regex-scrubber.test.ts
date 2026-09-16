/**
 * regex-scrubber.ts — plan §B14
 *
 * Covers: SSN, phone, CC, email redaction + idempotency.
 */

import { describe, it, expect } from 'vitest';

import { regexScrub, REDACTED } from '../regex-scrubber';

describe('regexScrub', () => {
  it('redacts a US SSN', () => {
    const out = regexScrub('Nina\'s SSN is 123-45-6789 for the forms.');
    expect(out).not.toContain('123-45-6789');
    expect(out).toContain(REDACTED);
  });

  it('redacts a North American phone with parens', () => {
    const out = regexScrub('Call me at (415) 555-2671 later.');
    expect(out).not.toContain('555-2671');
    expect(out).toContain(REDACTED);
  });

  it('redacts a 16-digit credit card number with dashes', () => {
    const out = regexScrub('Card is 4242-4242-4242-4242 expires soon.');
    expect(out).not.toContain('4242-4242-4242-4242');
    expect(out).toContain(REDACTED);
  });

  it('redacts an email address', () => {
    const out = regexScrub('Reach Ana at ana.ortiz+newsletter@example.com please.');
    expect(out).not.toContain('ana.ortiz+newsletter@example.com');
    expect(out).toContain(REDACTED);
  });

  it('leaves clean prose untouched', () => {
    const clean = 'The furnace filter needs replacing before winter.';
    expect(regexScrub(clean)).toBe(clean);
  });

  it('is idempotent — scrubbing twice equals scrubbing once', () => {
    const input = 'SSN 123-45-6789, phone +1 415-555-2671, email j@x.com';
    const once = regexScrub(input);
    const twice = regexScrub(once);
    expect(twice).toBe(once);
  });

  it('returns empty string unchanged', () => {
    expect(regexScrub('')).toBe('');
  });
});
