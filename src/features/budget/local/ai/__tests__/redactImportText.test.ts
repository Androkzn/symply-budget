import { redactImportText } from '../redactImportText';

/**
 * Redaction runs on every BYOK outbound call, so these assertions are about a
 * privacy boundary rather than formatting: what leaves the device is exactly
 * what these patterns fail to catch.
 */
describe('redactImportText', () => {
  it('redacts a SIN-like 9-digit run, with or without separators', () => {
    expect(redactImportText('SIN 046 454 286 on file')).toBe('SIN [redacted] on file');
    expect(redactImportText('SIN 046-454-286 on file')).toBe('SIN [redacted] on file');
    expect(redactImportText('SIN 046454286 on file')).toBe('SIN [redacted] on file');
  });

  it('redacts a card-like 16-digit run, with or without separators', () => {
    expect(redactImportText('card 4111 1111 1111 1111')).toBe('card [redacted]');
    expect(redactImportText('card 4111-1111-1111-1111')).toBe('card [redacted]');
    expect(redactImportText('card 4111111111111111')).toBe('card [redacted]');
  });

  it('redacts a long account number', () => {
    expect(redactImportText('acct 1234567890')).toBe('acct [redacted]');
    expect(redactImportText('acct 123456789012')).toBe('acct [redacted]');
  });

  it('leaves money amounts and dates alone', () => {
    // The whole point of the import text is the numbers the model must read.
    expect(redactImportText('Total 1234.56 on 2026-08-18')).toBe('Total 1234.56 on 2026-08-18');
    expect(redactImportText('12 items at 4.99')).toBe('12 items at 4.99');
  });

  it('redacts every occurrence, not just the first', () => {
    expect(redactImportText('046454286 and 046454287')).toBe('[redacted] and [redacted]');
  });

  it('returns empty and separator-only input unchanged', () => {
    expect(redactImportText('')).toBe('');
    expect(redactImportText('---')).toBe('---');
  });

  /**
   * Documents a real hole rather than asserting it is correct: the patterns
   * cover 9-12 digits and exactly 16, so a 13-15 digit account number — a
   * length several banks actually use — reaches the provider intact. Change
   * the implementation and this test should be updated to match, not deleted.
   */
  it('does NOT redact 13-15 digit numbers (known gap between the 12- and 16-digit patterns)', () => {
    expect(redactImportText('acct 1234567890123')).toBe('acct 1234567890123');
    expect(redactImportText('acct 123456789012345')).toBe('acct 123456789012345');
  });
});
