// Password hashing utilities using Web Crypto API
// Compatible with Cloudflare Workers

const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

/**
 * Hash a password using PBKDF2 with a random salt
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKey(password, salt);

  // Combine salt and key into a single string
  const combined = new Uint8Array(SALT_LENGTH + KEY_LENGTH);
  combined.set(salt, 0);
  combined.set(new Uint8Array(key), SALT_LENGTH);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Verify a password against a stored hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const combined = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0));

    if (combined.length !== SALT_LENGTH + KEY_LENGTH) {
      return false;
    }

    const salt = combined.slice(0, SALT_LENGTH);
    const storedKey = combined.slice(SALT_LENGTH);

    const derivedKey = await deriveKey(password, salt);

    // Constant-time comparison
    return timingSafeEqual(new Uint8Array(derivedKey), storedKey);
  } catch {
    return false;
  }
}

/**
 * Derive a key from a password and salt using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    KEY_LENGTH * 8
  );
}

/**
 * Constant-time comparison to prevent timing attacks
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }

  return result === 0;
}

/**
 * Generate a random token for verification/reset links
 */
export function generateToken(length: number = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hash a token for storage (using SHA-256)
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validate password strength
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
