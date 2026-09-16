/**
 * Aihousekeeper briefing composer — plan §B3.
 *
 * Gathers today's context via injected deps and calls Claude with
 * tool_use over two tools (compose_briefing, empty_briefing). Returns a
 * typed BriefingResult for the dispatcher to persist.
 *
 * Retry once on malformed tool output; default to empty on second failure.
 */

import { generateWithFallback } from '../../ai/fallback';
import {
  BRIEFING_PROMPT_VERSION,
  BRIEFING_SYSTEM_PROMPT,
  BRIEFING_TOOLS,
} from '../../ai/prompts/aihousekeeper/briefing-v1';
import type { AIProvider, GenerateResult } from '../../ai/provider';
import type { Env } from '../../types';

// ---------- deps ----------

export interface BriefingTaskSummary {
  id: string;
  title: string;
  category?: string | null;
  dueDate?: string | null;
}

export interface BriefingAppointment {
  id: string;
  title: string;
  startsAt: string;
  withMember?: string | null;
}

export interface BriefingWeather {
  summary: string;
  highC?: number;
  lowC?: number;
  precipitationProb?: number;
  alerts?: string[];
}

export interface BriefingSuggestion {
  id: string;
  title: string;
  reason?: string;
}

export interface BriefingOpenQuestion {
  id: string;
  question: string;
  ageDays: number;
}

export interface BriefingHistoryItem {
  id: string;
  summary: string;
  at: string;
}

/**
 * Dependency interface injected by the caller (Stream F). Keep this as a
 * plain interface rather than a service class so briefing composition can
 * be tested with fixtures.
 */
export interface BriefingDeps {
  listOverdueTasks(householdId: string, date: string): Promise<BriefingTaskSummary[]>;
  listAppointments(householdId: string, date: string): Promise<BriefingAppointment[]>;
  getWeather(householdId: string): Promise<BriefingWeather | null>;
  topMaintenanceSuggestion(householdId: string): Promise<BriefingSuggestion | null>;
  listOpenQuestions(householdId: string): Promise<BriefingOpenQuestion[]>;
  listRecentHistory(householdId: string, days: number): Promise<BriefingHistoryItem[]>;
}

// ---------- result ----------

export type BriefingResult =
  | {
      kind: 'composed';
      paragraph: string;
      bullets: string[];
      sourceSignals: Array<{ kind: string; ref: string }>;
      composedByModel: string;
      promptVersion: string;
    }
  | {
      kind: 'empty';
      reason: string;
      sourceSignals: Array<{ kind: string; ref: string }>;
    };

interface ComposeBriefingToolInput {
  paragraph: string;
  bullets: string[];
  source_signals: Array<{ kind: string; ref: string }>;
}

interface EmptyBriefingToolInput {
  reason: string;
  source_signals: Array<{ kind: string; ref: string }>;
}

export class BriefingComposer {
  private ai: AIProvider;
  private env: Env;
  private deps: BriefingDeps;

  constructor(params: { ai: AIProvider; env: Env; deps: BriefingDeps }) {
    this.ai = params.ai;
    this.env = params.env;
    this.deps = params.deps;
  }

  async composeFor(householdId: string, date: string): Promise<BriefingResult> {
    const ctx = await this.gatherContext(householdId, date);
    const userPrompt = this.renderContext(ctx, date);

    // First attempt.
    let attempt = 0;
    while (attempt < 2) {
      attempt += 1;
      try {
        const response = await generateWithFallback(
          this.ai,
          this.env.AIHOUSEKEEPER_BRIEFING_MODEL,
          this.env.AIHOUSEKEEPER_FALLBACK_MODEL,
          {
            systemPrompt: BRIEFING_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
            tools: BRIEFING_TOOLS,
            toolChoice: { type: 'any' },
            maxTokens: 1024,
            cacheControl: {
              onSystem: { type: 'ephemeral', ttl: '1h' },
              onLastToolDef: true,
            },
          }
        );
        const parsed = this.parseToolCall(response);
        if (parsed) return parsed;
        // Malformed: fall through for retry.
      } catch {
        // Network / transport error — also retry.
      }
    }

    // Second failure → empty with malformed reason.
    return {
      kind: 'empty',
      reason: 'malformed_output',
      sourceSignals: [],
    };
  }

  // ---------- internals ----------

  private async gatherContext(householdId: string, date: string) {
    const [overdue, appointments, weather, suggestion, questions, history] =
      await Promise.all([
        this.deps.listOverdueTasks(householdId, date),
        this.deps.listAppointments(householdId, date),
        this.deps.getWeather(householdId),
        this.deps.topMaintenanceSuggestion(householdId),
        this.deps.listOpenQuestions(householdId),
        this.deps.listRecentHistory(householdId, 3),
      ]);
    return { overdue, appointments, weather, suggestion, questions, history };
  }

  private renderContext(
    ctx: Awaited<ReturnType<BriefingComposer['gatherContext']>>,
    date: string
  ): string {
    const lines: string[] = [];
    lines.push(`Today's date: ${date}`);
    lines.push('');
    lines.push(`Overdue tasks (${ctx.overdue.length}):`);
    for (const t of ctx.overdue) {
      lines.push(
        `  - [${t.id}] ${t.title}${t.category ? ` (${t.category})` : ''}${t.dueDate ? ` — was due ${t.dueDate}` : ''}`
      );
    }
    lines.push('');
    lines.push(`Appointments today (${ctx.appointments.length}):`);
    for (const a of ctx.appointments) {
      lines.push(
        `  - [${a.id}] ${a.title} at ${a.startsAt}${a.withMember ? ` (with ${a.withMember})` : ''}`
      );
    }
    lines.push('');
    if (ctx.weather) {
      const alerts = ctx.weather.alerts?.length
        ? `; alerts: ${ctx.weather.alerts.join(', ')}`
        : '';
      lines.push(
        `Weather: ${ctx.weather.summary}${
          ctx.weather.highC != null ? `; high ${ctx.weather.highC}°C` : ''
        }${ctx.weather.lowC != null ? `; low ${ctx.weather.lowC}°C` : ''}${
          ctx.weather.precipitationProb != null
            ? `; ${ctx.weather.precipitationProb}% precip`
            : ''
        }${alerts}`
      );
    } else {
      lines.push('Weather: unavailable');
    }
    lines.push('');
    if (ctx.suggestion) {
      lines.push(
        `Top maintenance suggestion: [${ctx.suggestion.id}] ${ctx.suggestion.title}${ctx.suggestion.reason ? ` — ${ctx.suggestion.reason}` : ''}`
      );
    }
    if (ctx.questions.length > 0) {
      lines.push('');
      lines.push(`Open questions (${ctx.questions.length}):`);
      for (const q of ctx.questions) {
        lines.push(`  - [${q.id}] (${q.ageDays}d open) ${q.question}`);
      }
    }
    if (ctx.history.length > 0) {
      lines.push('');
      lines.push(`Recent history (last 3 days):`);
      for (const h of ctx.history) {
        lines.push(`  - [${h.id}] ${h.summary} (${h.at})`);
      }
    }
    return lines.join('\n');
  }

  private parseToolCall(response: GenerateResult): BriefingResult | null {
    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') return null;

    if (toolBlock.name === 'compose_briefing') {
      const input = toolBlock.input as Partial<ComposeBriefingToolInput>;
      if (
        typeof input?.paragraph !== 'string' ||
        !Array.isArray(input?.bullets) ||
        input.bullets.some((b) => typeof b !== 'string')
      ) {
        return null;
      }
      return {
        kind: 'composed',
        paragraph: input.paragraph,
        bullets: input.bullets,
        sourceSignals: Array.isArray(input.source_signals)
          ? input.source_signals
          : [],
        composedByModel: response.model,
        promptVersion: BRIEFING_PROMPT_VERSION,
      };
    }
    if (toolBlock.name === 'empty_briefing') {
      const input = toolBlock.input as Partial<EmptyBriefingToolInput>;
      if (typeof input?.reason !== 'string') return null;
      return {
        kind: 'empty',
        reason: input.reason,
        sourceSignals: Array.isArray(input.source_signals)
          ? input.source_signals
          : [],
      };
    }
    return null;
  }
}
