import {
  EXTRACT_GARBAGE_SCHEDULE_SYSTEM_PROMPT,
  EXTRACT_GARBAGE_SCHEDULE_PROMPT_V1,
  type DetectedGarbageSchedule,
  type DetectedGarbageScheduleItem,
} from '../ai/prompts/extract-garbage-schedule';
import { createAnthropicAdapterForUser } from '../ai/provider-factory';
import type { ModelTokenUsage } from '../ai/provider-factory';
import type { Env } from '../types';

interface AddressInput {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

const VALID_TYPES = ['garbage', 'recycling', 'organics', 'yardWaste', 'bulkItem'] as const;
const VALID_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'seasonal', 'on-request'] as const;

/**
 * Garbage Schedule AI Service
 *
 * Uses Claude + the web_search server-side tool to detect a household's waste
 * collection schedule from its address. The result is returned as a DRAFT the
 * user confirms — it is never auto-saved. When nothing credible is found, the
 * caller should fall back to manual entry.
 */
export class GarbageScheduleAIService {
  private env: Env;
  private userId: string | null;
  private model: string;

  constructor(env: Env, userId?: string | null) {
    this.env = env;
    // Bill the acting user's own Anthropic key when connected (BYOK).
    this.userId = userId ?? null;
    // claude-sonnet-4-5 supports the basic web_search_20250305 server tool.
    this.model = 'claude-sonnet-4-5-20250929';
  }

  /**
   * Detect a collection schedule for the given address.
   * Returns a draft schedule + the model's token usage.
   */
  async detectFromAddress(address: AddressInput): Promise<{
    data: DetectedGarbageSchedule;
    usage: ModelTokenUsage;
  }> {
    const addressStr = this.formatAddress(address);
    if (!addressStr) {
      throw new Error('A street address (with city) is required to detect a schedule');
    }

    console.log(`[GARBAGE-AI] Detecting schedule for: ${addressStr}`);
    const startTime = Date.now();

    const userPrompt = EXTRACT_GARBAGE_SCHEDULE_PROMPT_V1.replace('{{ADDRESS}}', addressStr);

    const provider = await createAnthropicAdapterForUser(
      this.env,
      this.userId,
      { feature: 'garbage_schedule_ai', userId: this.userId },
      this.model
    );
    const { text, usage, stopReason } = await provider.generateWithWebSearch({
      systemPrompt: EXTRACT_GARBAGE_SCHEDULE_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 4096,
      model: this.model,
    });

    const processingTime = Date.now() - startTime;
    console.log(`[GARBAGE-AI] Claude response in ${processingTime}ms (stop: ${stopReason})`);

    const parsed = this.parseResponse(text);

    console.log(`[GARBAGE-AI] Detected:`, {
      municipality: parsed.municipality,
      items: parsed.schedules.length,
      confidence: parsed.confidence,
      addressSpecific: parsed.addressSpecific,
    });

    return {
      data: parsed,
      usage: {
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
      },
    };
  }

  /**
   * Build a single-line address string from household fields.
   * Requires at least a city to be useful.
   */
  private formatAddress(a: AddressInput): string | null {
    const parts = [
      a.address_line1,
      a.address_line2,
      a.city,
      a.state_province,
      a.postal_code,
      a.country,
    ]
      .map((p) => (p ? String(p).trim() : ''))
      .filter((p) => p.length > 0);

    if (!a.city || !String(a.city).trim()) {
      return null;
    }

    return parts.join(', ');
  }

  private parseResponse(response: string): DetectedGarbageSchedule {
    const json = this.extractJson(response);
    try {
      const parsed = JSON.parse(json);
      return this.normalize(parsed);
    } catch (error) {
      console.error('[GARBAGE-AI] Failed to parse response:', error, response.slice(0, 500));
      // Treat unparseable output as "nothing found" rather than a hard failure,
      // so the client cleanly falls back to manual entry.
      return {
        municipality: null,
        schedules: [],
        setOutTime: null,
        confidence: 0,
        addressSpecific: false,
        notes: 'Could not determine a schedule automatically.',
        sources: [],
      };
    }
  }

  private extractJson(response: string): string {
    const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    const obj = response.match(/\{[\s\S]*\}/);
    if (obj) return obj[0];
    return response;
  }

  private normalize(data: any): DetectedGarbageSchedule {
    const rawSchedules = Array.isArray(data?.schedules) ? data.schedules : [];

    const schedules: DetectedGarbageScheduleItem[] = rawSchedules
      .map((s: any): DetectedGarbageScheduleItem | null => {
        const type = VALID_TYPES.includes(s?.type) ? s.type : null;
        const frequency = VALID_FREQUENCIES.includes(s?.frequency) ? s.frequency : null;
        if (!type || !frequency) return null;

        const item: DetectedGarbageScheduleItem = { type, frequency };

        const dow = this.toInt(s?.dayOfWeek);
        if (dow !== null && dow >= 0 && dow <= 6) item.dayOfWeek = dow;

        if (s?.week === 'A' || s?.week === 'B') item.week = s.week;

        if (Array.isArray(s?.weekOfMonth)) {
          const weeks = s.weekOfMonth
            .map((w: any) => this.toInt(w))
            .filter((w: number | null): w is number => w !== null && w >= 1 && w <= 5);
          if (weeks.length > 0) item.weekOfMonth = weeks;
        }

        const start = this.toMonthDay(s?.seasonStart);
        const end = this.toMonthDay(s?.seasonEnd);
        if (start) item.seasonStart = start;
        if (end) item.seasonEnd = end;

        return item;
      })
      .filter((s: DetectedGarbageScheduleItem | null): s is DetectedGarbageScheduleItem => s !== null);

    const sources = Array.isArray(data?.sources)
      ? data.sources
          .filter((src: any) => src && (src.title || src.url))
          .map((src: any) => ({
            title: String(src.title || src.url || '').slice(0, 200),
            url: String(src.url || '').slice(0, 500),
          }))
      : [];

    let confidence = this.toNumber(data?.confidence) ?? 0;
    confidence = Math.max(0, Math.min(1, confidence));
    // No schedule items => not a usable result regardless of stated confidence.
    if (schedules.length === 0) confidence = Math.min(confidence, 0.3);

    return {
      municipality: data?.municipality ? String(data.municipality).slice(0, 200) : null,
      schedules,
      setOutTime: this.toTime(data?.setOutTime),
      confidence,
      addressSpecific: data?.addressSpecific === true,
      notes: data?.notes ? String(data.notes).slice(0, 500) : '',
      sources,
    };
  }

  private toInt(v: any): number | null {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }

  private toNumber(v: any): number | null {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  }

  private toMonthDay(v: any): { month: number; day: number } | null {
    if (!v) return null;
    const month = this.toInt(v.month);
    const day = this.toInt(v.day);
    if (month === null || day === null) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { month, day };
  }

  private toTime(v: any): string | null {
    if (!v || typeof v !== 'string') return null;
    return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v.trim()) ? v.trim() : null;
  }
}
