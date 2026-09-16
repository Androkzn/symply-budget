import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { apiClient } from './client';

// Types
export interface GarbageScheduleType {
  type: 'garbage' | 'recycling' | 'organics' | 'yardWaste' | 'bulkItem';
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'seasonal' | 'on-request';
  dayOfWeek?: number;
  week?: 'A' | 'B';
  weekOfMonth?: number[]; // [1, 3] = 1st and 3rd weeks only
  seasonStart?: { month: number; day: number };
  seasonEnd?: { month: number; day: number };
}

export interface CustomReminder {
  id: string;
  type: 'evening_before' | 'morning_of' | 'custom';
  time: string; // "19:00" (24-hour format)
  daysOffset: number; // -1 for day before, 0 for same day, -2 for 2 days before
  label: string; // "Evening Before", "Morning Of", "2 Days Prior"
  enabled: boolean;
}

export interface WasteRegulations {
  garbage: Array<{ title: string; url: string }>;
  recycling: Array<{ title: string; url: string }>;
  organics: Array<{ title: string; url: string }>;
}

export interface GarbageSchedule {
  id: string;
  household_id: string;
  municipality: string;
  schedules: GarbageScheduleType[];
  set_out_time?: string;
  collection_start_time?: string;
  remove_by_time?: string;
  holiday_shifts?: Array<{
    holiday: string;
    date: string;
    shiftDays: number;
    affectedDays: number[];
  }>;
  reminders?: {
    nightBefore: { enabled: boolean; time: string };
    morningOf: { enabled: boolean; time: string };
    custom?: CustomReminder[];
  };
  source: 'municipal_api' | 'manual' | 'scraped';
  created_at: string;
  updated_at: string;
}

export interface Municipality {
  id: string;
  name: string;
  code: string;
  garbage_provider?: string;
  garbage_schedule_lookup_url?: string;
  bylaws?: {
    noiseRestrictions?: {
      quietHoursWeekday?: { start: string; end: string };
      quietHoursWeekend?: { start: string; end: string };
      lawnEquipmentHours?: { start: string; end: string };
    };
    lawnHeightMax?: number;
    snowRemovalHours?: number;
  };
  contacts?: {
    bylawEnforcement?: string;
    wasteCollection?: string;
    general?: string;
  };
}

export interface CollectionDate {
  date: string;
  types: string[];
  isHolidayShifted?: boolean;
}

// AI detection types (mirror backend DetectedGarbageSchedule)
export interface DetectedGarbageScheduleSource {
  title: string;
  url: string;
}

export interface DetectedGarbageSchedule {
  municipality: string | null;
  schedules: GarbageScheduleType[];
  setOutTime: string | null;
  confidence: number;
  addressSpecific: boolean;
  notes: string;
  sources: DetectedGarbageScheduleSource[];
}

// Request types
interface CreateGarbageScheduleRequest {
  municipality: string;
  schedules: GarbageScheduleType[];
  set_out_time?: string;
  collection_start_time?: string;
  remove_by_time?: string;
  reminders?: {
    nightBefore: { enabled: boolean; time: string };
    morningOf: { enabled: boolean; time: string };
  };
  source?: 'municipal_api' | 'manual' | 'scraped';
}

interface UpdateGarbageScheduleRequest extends Partial<CreateGarbageScheduleRequest> {}

// Response types
interface ScheduleResponse {
  schedule: GarbageSchedule;
}

interface MunicipalitiesResponse {
  municipalities: Municipality[];
}

interface CollectionDatesResponse {
  dates: CollectionDate[];
}

interface DetectResponse {
  draft: DetectedGarbageSchedule;
}

const remoteGarbageCollectionApi = {
  getSchedule: (householdId: string) =>
    apiClient
      .get<ScheduleResponse>(`/households/${householdId}/garbage-collection`)
      .then((res) => res.data),

  createSchedule: (householdId: string, data: CreateGarbageScheduleRequest) =>
    apiClient
      .post<ScheduleResponse>(`/households/${householdId}/garbage-collection`, data)
      .then((res) => res.data),

  updateSchedule: (householdId: string, scheduleId: string, data: UpdateGarbageScheduleRequest) =>
    apiClient
      .patch<ScheduleResponse>(`/households/${householdId}/garbage-collection/${scheduleId}`, data)
      .then((res) => res.data),

  getNextCollections: (householdId: string, scheduleId: string, days: number = 30) =>
    apiClient
      .get<CollectionDatesResponse>(
        `/households/${householdId}/garbage-collection/${scheduleId}/next-collections`,
        { params: { days } }
      )
      .then((res) => res.data),

  // AI-detect a collection schedule from the household address (web-search grounded).
  // Returns a DRAFT for the user to confirm — does not persist anything.
  // Web search runs several queries server-side, so this can take ~30-60s —
  // override the default 30s API timeout (otherwise axios aborts mid-search).
  aiDetect: (householdId: string) =>
    apiClient
      .post<DetectResponse>(
        `/households/${householdId}/garbage-collection/ai-detect`,
        undefined,
        { timeout: 120000 }
      )
      .then((res) => res.data),

  // Municipality endpoints
  getMunicipalities: () =>
    apiClient
      .get<MunicipalitiesResponse>('/municipalities')
      .then((res) => res.data),

  getMunicipality: (name: string) =>
    apiClient
      .get<{ municipality: Municipality }>(`/municipalities/${name}`)
      .then((res) => res.data),

  // Waste regulations endpoints
  getWasteRegulations: (municipality: string) =>
    apiClient
      .get<{ regulations: WasteRegulations }>(`/municipalities/${municipality}/waste-regulations`)
      .then((res) => res.data),

  // Custom reminders endpoints
  updateReminders: (householdId: string, scheduleId: string, reminders: CustomReminder[]) =>
    apiClient
      .patch<ScheduleResponse>(
        `/households/${householdId}/garbage-collection/${scheduleId}/reminders`,
        { reminders }
      )
      .then((res) => res.data),
};

// Time formatting helper functions
export function formatTime12Hour(time24: string): string {
  if (!time24 || !time24.includes(':')) return '';

  const [hourStr, minuteStr] = time24.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  if (isNaN(hour) || isNaN(minute)) return '';

  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12; // Convert 0 to 12, 13-23 to 1-11

  return `${displayHour}:${minute.toString().padStart(2, '0')} ${ampm}`;
}

export function formatTime24Hour(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function parseTime24Hour(time24: string): Date {
  const date = new Date();
  const [hourStr, minuteStr] = time24.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  date.setHours(hour, minute, 0, 0);
  return date;
}

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens and stores call
 * `garbageCollectionApi` exactly as before; the Proxy is what makes the H3 cutover cost
 * zero screen edits. See `documents/requirements/House v2/` §6.
 */
export const garbageCollectionApi: typeof remoteGarbageCollectionApi = createHouseLocalProxy(remoteGarbageCollectionApi, {
  moduleName: 'garbage-collection',
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localGarbageApi').localGarbageApi,
  // Tier C global reference data (plan §1.2): fetched over HTTP and cached,
  // never ledgered. Declared here so "this one goes to the server" is a
  // decision in the code rather than the absence of a local method.
  remoteMethods: ['getMunicipalities', 'getMunicipality', 'getWasteRegulations'],
});
