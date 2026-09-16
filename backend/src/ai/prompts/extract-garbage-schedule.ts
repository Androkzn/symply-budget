/**
 * Garbage / recycling collection schedule detection prompt.
 *
 * Unlike the document-extraction prompts (which read an uploaded PDF/image),
 * this one grounds Claude with the web_search server-side tool: given a
 * household address it searches the relevant municipality's official sanitation
 * pages and returns a structured collection schedule for the user to CONFIRM.
 *
 * The model is told to never guess — if it cannot find an address-specific (or
 * at least city-level) schedule, it returns an empty `schedules` array with a
 * low confidence so the client falls back to manual entry.
 */

export const EXTRACT_GARBAGE_SCHEDULE_SYSTEM_PROMPT = `You are an expert on municipal waste collection across Canada and the United States.

Your job is to determine the garbage, recycling, and organics (green/food waste) collection schedule for a single residential address by searching the web for the responsible municipality's official sources.

Rules:
1. Use the web_search tool to find the official municipal / regional waste collection schedule for the given address. Prefer the city, regional district, or contracted hauler's own website.
2. NEVER invent or guess a collection DAY. Only set dayOfWeek when a source actually states it. If sources disagree or you can only find a generic city-wide schedule (not address-specific), still return it but lower the confidence.
3. PARTIAL RESULTS ARE VALUABLE — return them, do NOT return empty. It is very common to find the streams (garbage/recycling/organics) and their frequency (weekly vs every-other-week) but NOT the specific pickup day, because most cities hide the day behind an address-lookup tool. In that case STILL return one schedule item per stream you found, WITH the correct frequency but OMITTING dayOfWeek, set addressSpecific=false, and use a middling confidence (0.4-0.6). The user will fill in the day manually. Only return an empty "schedules" array (confidence below 0.4) if you cannot even determine which streams exist or how often they run.
4. Collection day-of-week is an integer 0-6 where 0 = Sunday, 1 = Monday, ... 6 = Saturday. Omit it entirely when unknown — never fabricate it.
5. Many municipalities collect recycling or organics on alternating weeks ("biweekly"). Use "biweekly" frequency when the source says every other week. Use "weekly" for every week. Use "seasonal" for yard/green waste that only runs part of the year, with seasonStart/seasonEnd months.
6. Always include the sources (page titles + URLs) you relied on. Put any "look up your exact day at <tool/URL>" guidance in "notes".

You must return ONLY a single valid JSON object, no markdown, no commentary.`;

export const EXTRACT_GARBAGE_SCHEDULE_PROMPT_V1 = `Find the residential waste collection schedule for this address:

{{ADDRESS}}

Search the web for the official municipal schedule, then return a JSON object with EXACTLY this structure:

{
  "municipality": "City or regional authority name, e.g. 'City of Burnaby'",
  "schedules": [
    {
      "type": "garbage" | "recycling" | "organics" | "yardWaste" | "bulkItem",
      "frequency": "weekly" | "biweekly" | "monthly" | "seasonal" | "on-request",
      "dayOfWeek": 0,                     // 0=Sunday ... 6=Saturday — OMIT this field entirely if the day is unknown
      "week": "A" | "B",                  // optional, only for biweekly when the source names the week
      "weekOfMonth": [1, 3],              // optional, only for monthly
      "seasonStart": { "month": 4, "day": 1 },  // optional, only for seasonal
      "seasonEnd": { "month": 11, "day": 30 }   // optional, only for seasonal
    }
  ],
  "setOutTime": "07:00",                  // time bins must be out by, 24h HH:MM, best effort
  "confidence": 0.0,                      // 0..1 — how sure you are this matches THIS address
  "addressSpecific": false,               // true if the schedule is specific to this address/zone, false if city-wide
  "notes": "Short human-readable summary, e.g. 'Garbage + organics every Tuesday; recycling alternating Tuesdays.'",
  "sources": [
    { "title": "Page title", "url": "https://..." }
  ]
}

If you found the streams and their frequency but not the exact day, return those items WITHOUT dayOfWeek (do not return an empty array). Only return "schedules": [] when you can't even determine the streams/frequency. Return ONLY the JSON object.`;

export interface DetectedGarbageScheduleItem {
  type: 'garbage' | 'recycling' | 'organics' | 'yardWaste' | 'bulkItem';
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'seasonal' | 'on-request';
  dayOfWeek?: number;
  week?: 'A' | 'B';
  weekOfMonth?: number[];
  seasonStart?: { month: number; day: number };
  seasonEnd?: { month: number; day: number };
}

export interface DetectedGarbageScheduleSource {
  title: string;
  url: string;
}

export interface DetectedGarbageSchedule {
  municipality: string | null;
  schedules: DetectedGarbageScheduleItem[];
  setOutTime: string | null;
  confidence: number;
  addressSpecific: boolean;
  notes: string;
  sources: DetectedGarbageScheduleSource[];
}
