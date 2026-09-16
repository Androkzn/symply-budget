/**
 * Generate a UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Canonical UTC timestamp for application writes (ISO-8601 with `Z` suffix).
 *
 * Prefer this over `new Date().toISOString()` and over SQLite `datetime('now')`
 * defaults (`YYYY-MM-DD HH:MM:SS`) so TEXT columns sort and range correctly.
 */
export function now(): string {
  return new Date().toISOString();
}

/** Explicit alias for {@link now} — use when migrating call sites off raw `toISOString()`. */
export const nowIso = now;

/**
 * Add duration to current time and return ISO string
 */
export function addTime(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/**
 * Check if a date string is in the past
 */
export function isExpired(dateString: string): boolean {
  return new Date(dateString) < new Date();
}

/**
 * Format a date for display
 */
export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Add days to current date and return ISO string
 */
export function addDays(days: number, fromDate?: Date): string {
  const date = fromDate ? new Date(fromDate) : new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

/**
 * Calculate next due date based on frequency
 */
export function calculateNextDueDate(
  frequency: 'one_time' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom',
  customIntervalDays?: number,
  fromDate?: Date
): string {
  const date = fromDate ? new Date(fromDate) : new Date();

  switch (frequency) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'quarterly':
      date.setMonth(date.getMonth() + 3);
      break;
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1);
      break;
    case 'custom':
      if (customIntervalDays) {
        date.setDate(date.getDate() + customIntervalDays);
      }
      break;
  }

  return date.toISOString();
}
