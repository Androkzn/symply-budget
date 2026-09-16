/**
 * WeatherKit — real weather for the Aihousekeeper morning briefing (House).
 *
 * Feature-gated: if the WeatherKit Worker secrets aren't set, every call returns
 * null and the briefing simply omits weather (no error). To enable, register the
 * WeatherKit capability + key for com.symply.house (see PROVISIONING §5a) and set:
 *   WEATHERKIT_KEY_ID, WEATHERKIT_PRIVATE_KEY (the .p8 PEM), WEATHERKIT_SERVICE_ID
 *   (com.symply.house), APPLE_TEAM_ID (already set).
 *
 * Location comes from the household's postal_code + country, geocoded via the free
 * keyless zippopotam.us service. WeatherKit REST needs lat/lon.
 */
import { eq } from 'drizzle-orm';
import * as jose from 'jose';

import { households } from '../db/schema';
import type { Database, Env } from '../types';

import type { BriefingWeather } from './aihousekeeper/briefing-composer';

const WEATHERKIT_HOST = 'https://weatherkit.apple.com';

/** Mint the ES256 WeatherKit REST token, or null if not configured. */
async function mintWeatherKitToken(env: Env): Promise<string | null> {
  const keyId = env.WEATHERKIT_KEY_ID;
  const privateKey = env.WEATHERKIT_PRIVATE_KEY;
  const serviceId = env.WEATHERKIT_SERVICE_ID;
  const teamId = env.APPLE_TEAM_ID;
  if (!keyId || !privateKey || !serviceId || !teamId) return null;
  try {
    const key = await jose.importPKCS8(privateKey, 'ES256');
    return await new jose.SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId, id: `${teamId}.${serviceId}` })
      .setIssuer(teamId)
      .setSubject(serviceId)
      .setIssuedAt()
      .setExpirationTime('30m')
      .sign(key);
  } catch (err) {
    console.error('WeatherKit token mint failed:', err);
    return null;
  }
}

/** Geocode a postal code to lat/lon via the free keyless zippopotam.us API. */
async function geocodePostal(country: string, postal: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch(
      `https://api.zippopotam.us/${encodeURIComponent(country)}/${encodeURIComponent(postal.split('-')[0].trim())}`
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { places?: Array<{ latitude: string; longitude: string }> };
    const place = body.places?.[0];
    if (!place) return null;
    const lat = Number.parseFloat(place.latitude);
    const lon = Number.parseFloat(place.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  } catch {
    return null;
  }
}

const round = (n: unknown): number | undefined => (typeof n === 'number' ? Math.round(n) : undefined);

/** "MostlyClear" → "Mostly clear". */
function humanizeCondition(code: unknown): string | undefined {
  if (typeof code !== 'string' || !code) return undefined;
  const spaced = code.replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

interface WeatherKitResponse {
  currentWeather?: { conditionCode?: string; temperature?: number };
  forecastDaily?: {
    days?: Array<{
      conditionCode?: string;
      temperatureMax?: number;
      temperatureMin?: number;
      precipitationChance?: number;
    }>;
  };
  weatherAlerts?: { alerts?: Array<{ description?: string }> };
}

/**
 * Returns the household's weather for the briefing, or null if WeatherKit is not
 * configured, the household has no usable location, or the upstream call fails.
 */
export async function getHouseholdWeather(
  env: Env,
  db: Database,
  householdId: string
): Promise<BriefingWeather | null> {
  const token = await mintWeatherKitToken(env);
  if (!token) return null; // feature off — no secrets set

  const rows = await db
    .select({ postal: households.postal_code, country: households.country })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1);
  const hh = rows[0];
  if (!hh?.postal || !hh?.country) return null;

  const geo = await geocodePostal(hh.country, hh.postal);
  if (!geo) return null;

  try {
    const url = `${WEATHERKIT_HOST}/api/v1/weather/en/${geo.lat}/${geo.lon}?dataSets=currentWeather,forecastDaily,weatherAlerts&countryCode=${encodeURIComponent(hh.country)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error('WeatherKit API error:', res.status);
      return null;
    }
    const data = (await res.json()) as WeatherKitResponse;
    const today = data.forecastDaily?.days?.[0];
    const conditionCode = data.currentWeather?.conditionCode ?? today?.conditionCode;
    const summary = humanizeCondition(conditionCode);
    if (!summary && !today) return null;

    const alerts = (data.weatherAlerts?.alerts ?? [])
      .map((a) => a.description)
      .filter((d): d is string => Boolean(d));

    return {
      summary: summary ?? 'Weather available',
      highC: round(today?.temperatureMax),
      lowC: round(today?.temperatureMin),
      precipitationProb:
        typeof today?.precipitationChance === 'number'
          ? Math.round(today.precipitationChance * 100)
          : undefined,
      alerts: alerts.length ? alerts : undefined,
    };
  } catch (err) {
    console.error('WeatherKit fetch failed:', err);
    return null;
  }
}
