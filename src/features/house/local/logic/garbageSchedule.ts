/**
 * Client-side expansion of a stored garbage schedule into concrete collection
 * dates.
 *
 * Ported from `backend/src/services/garbage-collection-service.ts`
 * (`GarbageCollectionService.getNextCollectionDates`) — keep in sync.
 *
 * Why the port is mandatory (plan §6, "the hidden cost — server business logic
 * that must be re-implemented on device"): the `garbage_schedules` row is Tier A
 * and lives in the ledger, but the *dates* a member sees on the Home card and
 * the Garbage tab were computed by the Worker from that row. Offline, nobody
 * computes them, and `useGarbageSummary` renders "Not set up" for a household
 * that is in fact set up. The municipality catalogue itself stays Tier C and
 * remote — this file expands what the member already saved, it does not look
 * anything up.
 *
 * TWO DELIBERATE DIFFERENCES FROM THE SERVER, both documented rather than fixed
 * here so the two implementations stay comparable:
 *
 *  1. **Dates are formatted from local calendar fields, not `toISOString()`.**
 *     The server does `date.toISOString().split('T')[0]`, which is correct only
 *     because Workers run in UTC — there, `getDay()` and the ISO date agree. On
 *     a device in UTC-7 the same expression names the *previous* day for every
 *     pickup, so a Thursday collection renders as Wednesday. Day-of-week
 *     arithmetic here is local, so the formatting must be local too.
 *  2. **`holiday_shifts` are not applied.** The server stores them on the row
 *     and its own expansion ignores them; mirroring that keeps parity. When the
 *     shift logic is written it has to land on both sides at once, which is why
 *     `CollectionDate.isHolidayShifted` is left unset rather than hard-coded.
 */
import type { CollectionDate, GarbageScheduleType } from '@api/garbage-collection';

/** The clamp the Worker applies twice — in the route and again in the service. */
export const MIN_COLLECTION_DAYS_AHEAD = 1;
export const MAX_COLLECTION_DAYS_AHEAD = 365;
export const DEFAULT_COLLECTION_DAYS_AHEAD = 30;

/**
 * `YYYY-MM-DD` from the date's LOCAL fields — see difference (1) in the header.
 */
function toLocalDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Record one pickup, merging types that land on the same day.
 *
 * The server writes this same fold inline in all four frequency branches; one
 * helper here means the four branches cannot drift into different dedupe rules.
 */
function addCollection(dates: CollectionDate[], dateKey: string, type: string): void {
  const existing = dates.find((entry) => entry.date === dateKey);
  if (!existing) {
    dates.push({ date: dateKey, types: [type] });
    return;
  }
  if (!existing.types.includes(type)) {
    existing.types.push(type);
  }
}

/**
 * Expand every stream on a schedule into the pickups falling inside the window.
 *
 * `today` is injectable purely so the parity fixtures can pin a date; production
 * callers pass nothing and get `new Date()`, exactly as the service does.
 */
export function expandCollectionDates(
  schedules: readonly GarbageScheduleType[] | null | undefined,
  daysAhead: number = DEFAULT_COLLECTION_DAYS_AHEAD,
  today: Date = new Date(),
): CollectionDate[] {
  const dates: CollectionDate[] = [];

  // A schedule row exists from the moment the member opens the tab (the row is
  // auto-created), so "no streams yet" is the normal empty state, not an error.
  if (!schedules || schedules.length === 0) return dates;

  const validDaysAhead = Math.max(
    MIN_COLLECTION_DAYS_AHEAD,
    Math.min(MAX_COLLECTION_DAYS_AHEAD, daysAhead || DEFAULT_COLLECTION_DAYS_AHEAD),
  );
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + validDaysAhead);

  for (const item of schedules) {
    // A half-written stream from an older client would otherwise throw inside
    // the arithmetic below and take the whole card down.
    if (!item || !item.type || !item.frequency) continue;

    if (item.frequency === 'weekly' && item.dayOfWeek !== undefined) {
      const cursor = new Date(today);
      const daysUntilNext = (item.dayOfWeek - cursor.getDay() + 7) % 7;
      if (daysUntilNext === 0 && cursor.getHours() >= 7) {
        // Today is collection day but the truck has been — show next week's,
        // not a pickup the member can no longer make. 07:00 is the service's
        // hard-coded assumption about collection start.
        cursor.setDate(cursor.getDate() + 7);
      } else {
        cursor.setDate(cursor.getDate() + daysUntilNext);
      }

      while (cursor <= endDate) {
        addCollection(dates, toLocalDateKey(cursor), item.type);
        cursor.setDate(cursor.getDate() + 7);
      }
    } else if (item.frequency === 'biweekly' && item.dayOfWeek !== undefined) {
      // `week` ('A' | 'B') models alternating-week streams (e.g. Surrey:
      // garbage on week A, recycling on week B). Week B is offset by 7 days
      // from week A so the two never land on the same day.
      const weekOffset = item.week === 'B' ? 7 : 0;
      const cursor = new Date(today);
      const daysUntilNext = (item.dayOfWeek - cursor.getDay() + 7) % 7;
      cursor.setDate(cursor.getDate() + daysUntilNext + weekOffset);

      while (cursor <= endDate) {
        addCollection(dates, toLocalDateKey(cursor), item.type);
        cursor.setDate(cursor.getDate() + 14);
      }
    } else if (item.frequency === 'monthly' && item.dayOfWeek !== undefined) {
      // "Nth <weekday> of the month", one entry per requested week number.
      const weeksOfMonth = item.weekOfMonth || [1];
      const cursor = new Date(today);

      while (cursor <= endDate) {
        const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);

        for (const weekNum of weeksOfMonth) {
          let occurrenceCount = 0;
          const checkDate = new Date(firstOfMonth);

          while (checkDate.getMonth() === cursor.getMonth()) {
            if (checkDate.getDay() === item.dayOfWeek) {
              occurrenceCount += 1;
              // `>= today` compares against the current instant, so a pickup
              // earlier TODAY is excluded — same as the server.
              if (occurrenceCount === weekNum && checkDate >= today) {
                addCollection(dates, toLocalDateKey(checkDate), item.type);
                break;
              }
            }
            checkDate.setDate(checkDate.getDate() + 1);
          }
        }

        // Known server behaviour, reproduced: the month cursor is what the
        // window bounds, not `checkDate`, so the final month can emit a pickup
        // a few days past `endDate`. Fix it on both sides or on neither.
        cursor.setMonth(cursor.getMonth() + 1);
        cursor.setDate(1);
      }
    } else if (item.frequency === 'seasonal' && item.seasonStart && item.seasonEnd) {
      // Yard waste and similar: a weekly pickup, but only inside a season the
      // municipality declares as (month, day) pairs.
      const { seasonStart, seasonEnd } = item;
      const cursor = new Date(today);

      while (cursor <= endDate) {
        const currentMonth = cursor.getMonth() + 1;
        const currentDay = cursor.getDate();

        const isInSeason =
          (seasonStart.month < seasonEnd.month &&
            currentMonth >= seasonStart.month &&
            currentMonth <= seasonEnd.month) ||
          // A season that crosses the year boundary (e.g. Nov → Mar).
          (seasonStart.month > seasonEnd.month &&
            (currentMonth >= seasonStart.month || currentMonth <= seasonEnd.month));

        const isAfterSeasonStart =
          currentMonth > seasonStart.month ||
          (currentMonth === seasonStart.month && currentDay >= seasonStart.day);
        const isBeforeSeasonEnd =
          currentMonth < seasonEnd.month ||
          (currentMonth === seasonEnd.month && currentDay <= seasonEnd.day);

        if (
          isInSeason &&
          isAfterSeasonStart &&
          isBeforeSeasonEnd &&
          item.dayOfWeek !== undefined &&
          cursor.getDay() === item.dayOfWeek
        ) {
          addCollection(dates, toLocalDateKey(cursor), item.type);
        }

        cursor.setDate(cursor.getDate() + 1);
      }
    }
    // 'on-request' has no calendar — the member phones the city. The server
    // `continue`s here; falling through to the sort does the same thing.
  }

  dates.sort((a, b) => a.date.localeCompare(b.date));
  return dates;
}
