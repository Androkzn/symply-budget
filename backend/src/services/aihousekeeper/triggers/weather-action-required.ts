/**
 * Trigger: `weather_action_required` — plan §D4.
 *
 * Fetches the next 48 hours from Open-Meteo (free, no API key) and fires
 * when a household-relevant weather action is indicated, e.g.:
 *   - freeze warning (min temp ≤ -5°C): disconnect hoses, drain irrigation
 *   - high wind (max gust ≥ 60 km/h): secure patio furniture
 *   - heavy precipitation (24h sum ≥ 25mm): clear gutters / check sump
 *
 * DEVIATION / TODO: the `households` table has no lat/lon columns (only an
 * unstructured `address_line1` + city/state/postal_code). A proper fix needs
 * a geocoding pass on household save. Until then we extract a best-effort
 * lat/lon from the `postal_code` country pair using a coarse, statically
 * hard-coded fallback per supported country, and skip (return null) when we
 * cannot resolve one. This keeps the trigger inert for edge-case households
 * rather than spamming the free Open-Meteo endpoint with a bogus location.
 *
 * Severity 3 — advisory. Lifted to 4 for freeze warnings below -10°C.
 */

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { households } from '../../../db/schema';
import type { Env } from '../../../types';
import { sha256Hex } from '../event-bus';

import { triggerGuard, type Trigger, type TriggerResult, type TriggerSeverity } from './index';

const TRIGGER_ID = 'weather_action_required';

// Coarse per-country fallback centroids. Not remotely accurate — intentional
// placeholder so the trigger's shape is exercised without promising precision.
// TODO(triggers): replace with a per-household geocoded lat/lon (plan §D4
// notes this as a follow-up; schema change required on `households`).
const COUNTRY_FALLBACK_LATLON: Record<string, { lat: number; lon: number }> = {
  CA: { lat: 49.2827, lon: -123.1207 }, // Vancouver, BC
  US: { lat: 40.7128, lon: -74.006 }, // New York, NY
};

interface OpenMeteoDaily {
  daily?: {
    temperature_2m_min?: number[];
    temperature_2m_max?: number[];
    wind_gusts_10m_max?: number[];
    precipitation_sum?: number[];
    time?: string[];
  };
}

export const weatherActionRequiredTrigger: Trigger = {
  id: TRIGGER_ID,
  // Three hours — weather changes slowly enough that more frequent polls of
  // a free public API aren't justified, and this leaves headroom under
  // Open-Meteo's 10k-req/day shared quota.
  cadenceMinutes: 180,
  async evaluate(
    env: Env,
    householdId: string,
    now: Date
  ): Promise<TriggerResult | null> {
    if (!(await triggerGuard(env, householdId, TRIGGER_ID))) return null;

    const db = drizzle(env.DB);
    const hh = await db
      .select({
        country: households.country,
        postal_code: households.postal_code,
      })
      .from(households)
      .where(eq(households.id, householdId))
      .get();

    if (!hh || !hh.country) return null;
    const latlon = COUNTRY_FALLBACK_LATLON[hh.country];
    if (!latlon) return null;

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latlon.lat}&longitude=${latlon.lon}` +
      `&daily=temperature_2m_min,temperature_2m_max,wind_gusts_10m_max,precipitation_sum` +
      `&forecast_days=2&timezone=UTC`;

    let data: OpenMeteoDaily;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      data = (await res.json()) as OpenMeteoDaily;
    } catch {
      // Transient fetch error — silently skip this tick.
      return null;
    }

    const daily = data.daily;
    if (!daily) return null;

    const minTemps = daily.temperature_2m_min ?? [];
    const maxGusts = daily.wind_gusts_10m_max ?? [];
    const precipSums = daily.precipitation_sum ?? [];
    const times = daily.time ?? [];

    // Look at next 2 days.
    const freezeDays: string[] = [];
    let severeFreeze = false;
    const windDays: string[] = [];
    const precipDays: string[] = [];

    for (let i = 0; i < Math.min(2, times.length); i++) {
      const day = times[i] ?? '';
      const minT = minTemps[i];
      const gust = maxGusts[i];
      const precip = precipSums[i];
      if (typeof minT === 'number' && minT <= -5) {
        freezeDays.push(day);
        if (minT <= -10) severeFreeze = true;
      }
      if (typeof gust === 'number' && gust >= 60) windDays.push(day);
      if (typeof precip === 'number' && precip >= 25) precipDays.push(day);
    }

    if (freezeDays.length === 0 && windDays.length === 0 && precipDays.length === 0) {
      return null;
    }

    const severity: TriggerSeverity = severeFreeze ? 4 : 3;
    const today = now.toISOString().slice(0, 10);
    const idempotencyKey = await sha256Hex(
      `${householdId}:${TRIGGER_ID}:${today}:${freezeDays.join(',')}|${windDays.join(',')}|${precipDays.join(',')}`
    );

    return {
      triggerId: TRIGGER_ID,
      householdId,
      severity,
      kind: 'nudge',
      payload: {
        freezeDays,
        windDays,
        precipDays,
        location: { lat: latlon.lat, lon: latlon.lon, country: hh.country },
      },
      idempotencyKey,
    };
  },
};
