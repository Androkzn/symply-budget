/**
 * Timezone-aware date helpers for task enrichment.
 *
 * The async enrichment handler resolves user-spoken deadlines ("July 10",
 * "next Friday", "tomorrow") relative to the *household's* local calendar day,
 * not UTC. Doing the math in UTC (the old `addDays` behaviour) shifted dates by
 * up to a day for anyone west of Greenwich — a task spoken as "due July 10"
 * could land on July 9 or today. These helpers keep every calculation anchored
 * to the household's IANA timezone.
 *
 * No external deps: we lean on `Intl.DateTimeFormat`, which ships in the
 * Workers runtime and knows every IANA zone + its DST rules.
 */

/** Today's calendar date in the given IANA zone, split into parts. */
export function todayPartsInTz(timezone: string): { year: number; month: number; day: number } {
  const zone = timezone || 'UTC';
  try {
    // en-CA emits YYYY-MM-DD, trivial to split.
    const iso = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
    return { year: y, month: m, day: d };
  } catch {
    const now = new Date();
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  }
}

/**
 * Today's date for prompt context: an ISO date + a human label + the resolved
 * zone. Mirrors the chat endpoint's `formatTodayContext` so the enrichment
 * model gets the same "what day is it" anchor the interactive chat does.
 */
export function formatTodayInTz(timezone: string): {
  iso: string;
  human: string;
  zone: string;
} {
  const now = new Date();
  let zone = timezone || 'UTC';
  try {
    const iso = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const human = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(now);
    return { iso, human, zone };
  } catch {
    zone = 'UTC';
    return {
      iso: now.toISOString().slice(0, 10),
      human: new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(now),
      zone,
    };
  }
}

/**
 * The UTC offset (ms) a zone had at a given instant. Standard trick: format the
 * instant into the zone's wall-clock parts, read those back as if they were
 * UTC, and diff. Correct across DST because the offset is sampled at `instant`.
 */
function tzOffsetMs(instant: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);
    const o: Record<string, number> = {};
    for (const p of parts) if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10);
    // Intl can emit hour "24" at midnight in some engines — normalise.
    const hour = o.hour === 24 ? 0 : o.hour;
    const asUtc = Date.UTC(o.year, o.month - 1, o.day, hour, o.minute, o.second);
    return asUtc - instant.getTime();
  } catch {
    return 0;
  }
}

/**
 * Convert a wall-clock time in a zone to the UTC instant (ISO string).
 * e.g. "2026-07-10 17:00 America/Los_Angeles" → the matching UTC ISO.
 */
export function zonedWallTimeToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): string {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = tzOffsetMs(new Date(utcGuess), timezone);
  return new Date(utcGuess - offset).toISOString();
}

/**
 * Whole days between two YYYY-MM-DD calendar dates (b - a). Both are treated as
 * pure calendar dates (UTC midnight), so DST never skews the count.
 */
export function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map((n) => parseInt(n, 10));
  const [ty, tm, td] = toIso.split('-').map((n) => parseInt(n, 10));
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Resolve "N days from today, in the household's zone" to a concrete UTC ISO
 * timestamp anchored at 17:00 local (a sensible "end of workday" due time).
 * `daysFromToday` may be 0 (today) or larger.
 */
export function dueDateFromDaysInTz(
  daysFromToday: number,
  timezone: string,
  hourLocal = 17
): string {
  const today = todayPartsInTz(timezone);
  // Add the day delta on the calendar (UTC midnight math avoids DST drift),
  // then re-anchor to the local wall-clock hour and convert back to UTC.
  const base = Date.UTC(today.year, today.month - 1, today.day) + daysFromToday * 86_400_000;
  const bd = new Date(base);
  return zonedWallTimeToUtcIso(
    bd.getUTCFullYear(),
    bd.getUTCMonth() + 1,
    bd.getUTCDate(),
    hourLocal,
    0,
    timezone
  );
}
