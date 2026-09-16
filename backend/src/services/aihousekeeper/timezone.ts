/**
 * Aihousekeeper timezone helpers — plan §B5.
 *
 * DST-correct wrappers over `Intl.DateTimeFormat`. No external library —
 * `Intl` is supported in workerd with `compatibility_flags = ["nodejs_compat"]`
 * (confirmed in backend/wrangler.toml).
 *
 * CRITICAL (v3.1 fix): use `hourCycle: 'h23'` to avoid the `"24"` edge case.
 * `hour: '2-digit'` alone can emit `"24"` at midnight in some zones/locales
 * (see https://github.com/tc39/proposal-intl-hour-cycle). Pinning the hour
 * cycle keeps the return value in `[0, 23]`.
 */

/**
 * Returns the current hour (0–23) in the given IANA timezone.
 */
export function hourInTimezone(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(now);
  const hourPart = parts.find((p) => p.type === 'hour');
  const hour = hourPart ? parseInt(hourPart.value, 10) : 0;
  // Defensive clamp — should never fire with hourCycle:'h23' but cheap.
  if (hour < 0 || hour > 23 || Number.isNaN(hour)) return 0;
  return hour;
}

/**
 * Returns the current date as 'YYYY-MM-DD' in the given IANA timezone.
 * Uses 'en-CA' locale because it natively yields YYYY-MM-DD.
 */
export function dateInTimezone(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Returns total minutes past local midnight in the given timezone.
 * Handles minute resolution only; seconds are dropped.
 */
export function minutesFromMidnight(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return hour * 60 + minute;
}

/**
 * Returns true if `now` is within [start, end) quiet hours in the given
 * timezone. `start` / `end` are 'HH:MM' strings. Handles wrap-around where
 * `end < start` (e.g. '22:00' → '07:00' crosses midnight).
 */
export function isInQuietHours(
  now: Date,
  timezone: string,
  start: string,
  end: string
): boolean {
  const current = minutesFromMidnight(now, timezone);
  const startMin = parseHhmmToMinutes(start);
  const endMin = parseHhmmToMinutes(end);
  if (startMin === endMin) return false; // degenerate — no quiet window
  if (startMin < endMin) {
    // Same-day window (e.g. 13:00–15:00)
    return current >= startMin && current < endMin;
  }
  // Wrap-around window (e.g. 22:00 → 07:00)
  return current >= startMin || current < endMin;
}

/**
 * Parse 'HH:MM' to minutes-from-midnight. Defensive on malformed input.
 */
function parseHhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  const hour = parseInt(h ?? '0', 10);
  const minute = parseInt(m ?? '0', 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return 0;
  return hour * 60 + minute;
}

/**
 * The tz's UTC offset (ms, positive east of UTC) at `now`. Computed by
 * formatting `now` into the tz and treating the resulting wall-clock as if it
 * were UTC; the difference from `now` is the offset. DST-correct for `now`.
 */
function tzOffsetMs(now: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const localEpochIfUtc = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    parseInt(parts.hour, 10),
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10)
  );
  return localEpochIfUtc - now.getTime();
}

/**
 * Returns the UTC timestamp (Date) of midnight-local at `now`'s local date in
 * the given timezone. Used by OutboundDispatcher.canSend check 7
 * (`start_of_day_local` for daily budget counting).
 */
export function startOfDayLocalUtc(now: Date, timezone: string): Date {
  const offsetMs = tzOffsetMs(now, timezone);
  const dateStr = dateInTimezone(now, timezone); // YYYY-MM-DD in the tz
  const [y, mo, d] = dateStr.split('-').map((v) => parseInt(v, 10));
  const utcMidnightOfLocalDate = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
  return new Date(utcMidnightOfLocalDate - offsetMs);
}

/**
 * Returns the UTC instant of a LOCAL wall-clock time (hour:minute) on `now`'s
 * local calendar date in the given timezone. Hour/minute overflow normalizes
 * (e.g. minute 63 → next hour). Uses the tz offset at `now` (correct for
 * same-day targets). Building the instant with Date.UTC directly — as the
 * quiet-hours resend once did — treats the local time as UTC and lands hours
 * off in any non-UTC zone.
 */
export function localTimeToUtc(
  now: Date,
  timezone: string,
  hour: number,
  minute: number
): Date {
  const offsetMs = tzOffsetMs(now, timezone);
  const dateStr = dateInTimezone(now, timezone); // YYYY-MM-DD in the tz
  const [y, mo, d] = dateStr.split('-').map((v) => parseInt(v, 10));
  return new Date(Date.UTC(y, mo - 1, d, hour, minute, 0, 0) - offsetMs);
}
