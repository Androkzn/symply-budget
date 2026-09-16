import { describe, expect, it } from 'vitest';

import { isAdminAllowlistedEmail, normalizeAdminEmail } from '../admin-emails';

describe('admin-emails', () => {
  it('normalizes email case and whitespace', () => {
    expect(normalizeAdminEmail('  Andrei.Tekhtelev@Gmail.com ')).toBe(
      'andrei.tekhtelev@gmail.com'
    );
  });

  it('matches allowlisted admin emails', () => {
    expect(isAdminAllowlistedEmail('a.tekhtelev@gmail.com')).toBe(true);
    expect(isAdminAllowlistedEmail('andrei.tekhtelev@gmail.com')).toBe(true);
    expect(isAdminAllowlistedEmail('andrei.tekhytelev@gmail.com')).toBe(true);
    expect(isAdminAllowlistedEmail('a.tekhteleva@gmail.com')).toBe(true);
    expect(isAdminAllowlistedEmail('atextel@gmail.com')).toBe(true);
  });

  it('rejects non-admin emails', () => {
    expect(isAdminAllowlistedEmail('other@example.com')).toBe(false);
    expect(isAdminAllowlistedEmail(null)).toBe(false);
  });
});
