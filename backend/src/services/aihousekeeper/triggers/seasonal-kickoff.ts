/**
 * Trigger: `seasonal_kickoff` — plan §D10.
 *
 * Fires once per season (spring/summer/fall/winter) on the first day of that
 * season in the household's local timezone, surfacing season-specific
 * maintenance template suggestions.
 *
 * Season boundaries use Northern Hemisphere meteorological starts:
 *   - spring: March 1
 *   - summer: June 1
 *   - fall:   September 1
 *   - winter: December 1
 *
 * Southern Hemisphere support is TODO: `households.country` alone is not
 * sufficient (CA/US only for now; both northern). When we add AU/NZ etc we
 * should flip the mapping based on latitude. For now the fallback is
 * northern — documented deviation.
 *
 * Severity 2 — informational; kickoff nudge.
 */

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { assistantIdentity } from '../../../db/schema-aihousekeeper';
import type { Env } from '../../../types';
import { sha256Hex } from '../event-bus';
import { dateInTimezone } from '../timezone';

import { triggerGuard, type Trigger, type TriggerResult } from './index';

const TRIGGER_ID = 'seasonal_kickoff';

type Season = 'spring' | 'summer' | 'fall' | 'winter';

interface SeasonBoundary {
  season: Season;
  month: number;
  day: number;
}

// Northern-hemisphere meteorological season starts.
const NORTHERN_BOUNDARIES: SeasonBoundary[] = [
  { season: 'spring', month: 3, day: 1 },
  { season: 'summer', month: 6, day: 1 },
  { season: 'fall', month: 9, day: 1 },
  { season: 'winter', month: 12, day: 1 },
];

function boundaryForLocalDate(localDate: string): SeasonBoundary | null {
  // localDate is YYYY-MM-DD
  const parts = localDate.split('-');
  if (parts.length !== 3) return null;
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (Number.isNaN(month) || Number.isNaN(day)) return null;
  return (
    NORTHERN_BOUNDARIES.find((b) => b.month === month && b.day === day) ?? null
  );
}

export const seasonalKickoffTrigger: Trigger = {
  id: TRIGGER_ID,
  // Daily-ish; at most one fire per season (= 4 per year) so cadence is cheap.
  cadenceMinutes: 360,
  async evaluate(
    env: Env,
    householdId: string,
    now: Date
  ): Promise<TriggerResult | null> {
    if (!(await triggerGuard(env, householdId, TRIGGER_ID))) return null;

    const db = drizzle(env.DB);
    const identity = await db
      .select({ timezone: assistantIdentity.timezone })
      .from(assistantIdentity)
      .where(eq(assistantIdentity.household_id, householdId))
      .get();
    const tz = identity?.timezone ?? 'UTC';

    const localDate = dateInTimezone(now, tz);
    const boundary = boundaryForLocalDate(localDate);
    if (!boundary) return null;

    const year = parseInt(localDate.slice(0, 4), 10);
    const idempotencyKey = await sha256Hex(
      `${householdId}:${TRIGGER_ID}:${year}:${boundary.season}`
    );

    return {
      triggerId: TRIGGER_ID,
      householdId,
      severity: 2,
      kind: 'nudge',
      payload: {
        season: boundary.season,
        year,
        localDate,
      },
      idempotencyKey,
    };
  },
};
