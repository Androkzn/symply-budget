/**
 * useWeather — the household's current weather for the Home status strip, backed by
 * WeatherKit (see backend weather-service.ts). Returns null while loading, when
 * WeatherKit is not configured server-side, or when the household has no location —
 * so the caller simply omits the tile.
 */
import { useQuery } from '@tanstack/react-query';

import { weatherApi } from '@api/weather';
import type { Weather } from '@api/weather';

export interface WeatherTile {
  /** Big value, e.g. "18°" (today's high) — falls back to the summary if no temp. */
  value: string;
  /** Small label, e.g. "Mostly clear". */
  label: string;
  /** Ionicon name matching the condition. */
  icon: string;
  raw: Weather;
}

function iconForCondition(summary: string): string {
  const s = summary.toLowerCase();
  if (/(rain|drizzle|shower)/.test(s)) return 'rainy';
  if (/(snow|sleet|flurr|blizzard)/.test(s)) return 'snow';
  if (/(thunder|storm)/.test(s)) return 'thunderstorm';
  if (/(fog|haze|mist|smoke)/.test(s)) return 'cloud';
  if (/(cloud|overcast)/.test(s)) return 'cloudy';
  if (/(partly|mostly)/.test(s)) return 'partly-sunny';
  if (/(clear|sunny|fair)/.test(s)) return 'sunny';
  return 'partly-sunny';
}

export function useWeather(householdId?: string): WeatherTile | null {
  const { data } = useQuery({
    queryKey: ['weather', householdId],
    enabled: !!householdId,
    staleTime: 30 * 60 * 1000, // 30 min — weather doesn't change fast
    queryFn: async (): Promise<Weather | null> => {
      const { weather } = await weatherApi.get(householdId!);
      return weather;
    },
  });

  if (!data?.summary) return null;
  const hasTemp = typeof data.highC === 'number';
  return {
    value: hasTemp ? `${data.highC}°` : data.summary,
    label: hasTemp ? data.summary : 'Weather',
    icon: iconForCondition(data.summary),
    raw: data,
  };
}
