const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Basic shape check (has an `@`, a domain, a TLD) — not RFC 5322 exhaustive, just enough to catch typos before a network round trip. */
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}
