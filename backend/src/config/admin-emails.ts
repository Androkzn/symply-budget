/**
 * Internal admin emails — granted full paid access without RevenueCat or
 * household admin roles. Matched case-insensitively after trim.
 */
export const ADMIN_EMAIL_ALLOWLIST = [
  'a.tekhtelev@gmail.com',
  'andrei.tekhtelev@gmail.com',
  'andrei.tekhytelev@gmail.com',
  'a.tekhteleva@gmail.com',
  'atextel@gmail.com',
] as const;

const ADMIN_EMAIL_SET = new Set<string>(ADMIN_EMAIL_ALLOWLIST);

export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAdminAllowlistedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAIL_SET.has(normalizeAdminEmail(email));
}
