import { apiClient } from './client';

/** Mirrors the backend `BriefingWeather` shape (see weather-service.ts). */
export interface Weather {
  summary: string;
  highC?: number;
  lowC?: number;
  precipitationProb?: number;
  alerts?: string[];
}

export interface WeatherResponse {
  weather: Weather | null;
}

export const weatherApi = {
  /**
   * Current weather for a household's Home tile. Returns `{ weather: null }` when
   * WeatherKit isn't configured server-side or the household has no usable location.
   */
  get: (householdId: string) =>
    apiClient
      .get<WeatherResponse>(`/households/${householdId}/aihousekeeper/weather`)
      .then((res) => res.data),
};
