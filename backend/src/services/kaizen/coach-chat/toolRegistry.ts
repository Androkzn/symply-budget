/**
 * Kaizen Coach Chat — tool registry
 *
 * v1 tool definitions (JSON Schema) + handler stubs returning STRUCTURED results
 * (plan: "The coach tool registry is Kaizen-specific. v1 tools").
 *
 * Handlers return deterministic placeholder data with `clientMustResolve = true`
 * where the live repositories live on the iOS client — but the result SHAPE is
 * the real contract (see toolResults.ts). The bounded loop appends these results
 * to the transcript and continues.
 *
 * GUARDRAILS encoded here:
 *  - get_progress_snapshot / explain_progress CONSUME the provided snapshot; they
 *    never recompute mastery/judge/FSRS/achievements.
 *  - remember_about_user PROPOSES memory only (is_approved=0), never persists.
 *  - destructive/import flows are flagged requiresConfirmation=true.
 */

import {
  isMemoryCategory,
  normalizeConfidence,
  type MemoryRecord,
  type ProposedMemoryUpdate,
} from '../context/memorySchema';
import { redactMemories } from '../context/redaction';
import type { KaizenContextSnapshot, SnapshotFreshnessMeta } from '../context/snapshotRenderer';
import { renderKaizenSnapshot } from '../context/snapshotRenderer';

import type { GenerateToolDef } from './providerAdapter';
import {
  type AnyToolResult,
  type CoachToolName,
  toolError,
} from './toolResults';

/** Read-only context passed to every handler (no DB writes from the loop). */
export interface ToolContext {
  userId: string;
  sessionId: string;
  snapshot?: KaizenContextSnapshot;
  freshness?: SnapshotFreshnessMeta;
  /** Approved + opted-in memories already loaded for recall_about_user. */
  memories: MemoryRecord[];
  /** Collected here so the route can return them as proposedMemoryUpdates. */
  proposedMemoryUpdates: ProposedMemoryUpdate[];
  allowOptedInSensitive: boolean;
}

type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext
) => AnyToolResult;

interface ToolEntry {
  def: GenerateToolDef;
  handler: ToolHandler;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

// ---------------------------------------------------------------------------
// Tool definitions + handlers
// ---------------------------------------------------------------------------

const TOOLS: Record<CoachToolName, ToolEntry> = {
  get_context_snapshot: {
    def: {
      name: 'get_context_snapshot',
      description:
        'Read the latest redacted Kaizen context snapshot and its freshness metadata. Use to ground a "here and now" answer in real evidence.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    handler: (_args, ctx) => ({
      tool: 'get_context_snapshot',
      ok: true,
      clientMustResolve: false,
      data: {
        freshness: ctx.freshness?.freshness ?? 'partial',
        summary: renderKaizenSnapshot(ctx.snapshot, 'coachChat'),
        sourceSummary: ctx.freshness?.sourceSummary,
        generatedAt: ctx.freshness?.generatedAt,
      },
    }),
  },

  get_progress_snapshot: {
    def: {
      name: 'get_progress_snapshot',
      description:
        "Read today's/weekly/monthly Kaizen progress and career momentum from the provided snapshot. Does NOT compute scores; it reads deterministic analytics already in the snapshot.",
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', 'week', 'month', 'custom'],
            description: 'Which progress window to summarize.',
          },
        },
        required: ['period'],
        additionalProperties: false,
      },
    },
    handler: (args, ctx) => {
      const period = (str(args.period) ?? 'today') as
        | 'today'
        | 'week'
        | 'month'
        | 'custom';
      // GUARDRAIL: consume the provided snapshot; never recompute.
      const trends = ctx.snapshot?.progressTrends ?? {};
      const highlights = [
        trends.summary,
        ctx.snapshot?.careerState?.summary,
        ...(Array.isArray(ctx.snapshot?.careerState?.skillDeltas)
          ? (ctx.snapshot!.careerState!.skillDeltas as string[])
          : []),
      ].filter((x): x is string => Boolean(x && x.trim()));
      return {
        tool: 'get_progress_snapshot',
        ok: true,
        clientMustResolve: true, // client holds the authoritative progress snapshot
        data: {
          period,
          highlights: highlights.slice(0, 6),
          momentum: trends.momentum,
          regressions: Array.isArray(trends.regressions)
            ? (trends.regressions as string[]).slice(0, 4)
            : undefined,
        },
      };
    },
  },

  explain_progress: {
    def: {
      name: 'explain_progress',
      description:
        'Explain deterministic analytics (e.g. why a skill moved) using evidence already present in the snapshot. Does NOT recompute or invent numbers.',
      parameters: {
        type: 'object',
        properties: {
          subject: {
            type: 'string',
            description: 'What to explain, e.g. a skill name or "this week".',
          },
        },
        required: ['subject'],
        additionalProperties: false,
      },
    },
    handler: (args, ctx) => {
      const subject = str(args.subject);
      if (!subject) return toolError('explain_progress', 'subject is required');
      // GUARDRAIL: lift evidence from the snapshot; do not score.
      const evidence = [
        ctx.snapshot?.progressTrends?.summary,
        ctx.snapshot?.careerState?.summary,
        ...(Array.isArray(ctx.snapshot?.recentChanges)
          ? (ctx.snapshot!.recentChanges as Array<{ description?: string }>)
              .map((c) => c.description)
              .filter((x): x is string => Boolean(x))
          : []),
      ].filter((x): x is string => Boolean(x && x.trim()));
      return {
        tool: 'explain_progress',
        ok: true,
        clientMustResolve: true,
        data: {
          subject,
          evidence: evidence.slice(0, 6),
          explanation:
            'Explanation is grounded only in the deterministic snapshot evidence above; the coach must not state numbers not present here.',
        },
      };
    },
  },

  recommend_next_rep: {
    def: {
      name: 'recommend_next_rep',
      description:
        'Fetch the next due technical/behavioral practice from the deterministic scheduler. The coach surfaces it; it does not compute the schedule.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['technical', 'behavioral', 'any'],
            description: 'Preferred practice kind.',
          },
        },
        additionalProperties: false,
      },
    },
    handler: (args) => {
      const kindArg = str(args.kind);
      const kind =
        kindArg === 'technical' || kindArg === 'behavioral' ? kindArg : null;
      return {
        tool: 'recommend_next_rep',
        ok: true,
        clientMustResolve: true, // FSRS scheduler / due queue lives on the client
        data: {
          questionId: null,
          questionBank: null,
          kind,
          dueCount: 0,
          reason: 'Pending: the client resolves the due queue from the deterministic FSRS scheduler.',
        },
      };
    },
  },

  start_assessment: {
    def: {
      name: 'start_assessment',
      description: 'Open a selected skill assessment route. Requires user confirmation in the UI.',
      parameters: {
        type: 'object',
        properties: {
          skillId: { type: 'string', description: 'Skill node id to assess.' },
        },
        additionalProperties: false,
      },
    },
    handler: (args) => ({
      tool: 'start_assessment',
      ok: true,
      clientMustResolve: true,
      data: {
        skillId: str(args.skillId),
        route: 'kaizen://career/assessment',
        requiresConfirmation: true,
      },
    }),
  },

  import_questions: {
    def: {
      name: 'import_questions',
      description:
        'Open the question import flow. Importing is a confirmation-gated flow; the coach only opens it.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    handler: () => ({
      tool: 'import_questions',
      ok: true,
      clientMustResolve: true,
      data: {
        route: 'kaizen://career/import',
        requiresConfirmation: true,
        note: 'Import is destructive-adjacent; the UI must confirm before importing.',
      },
    }),
  },

  start_practice_session: {
    def: {
      name: 'start_practice_session',
      description:
        'Start a practice session from the due queue or a selected question bank. The client resolves the actual queue.',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['due_queue', 'question_bank'] },
          questionBankId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    handler: (args) => {
      const source = str(args.source) === 'question_bank' ? 'question_bank' : 'due_queue';
      return {
        tool: 'start_practice_session',
        ok: true,
        clientMustResolve: true,
        data: {
          source,
          questionBankId: str(args.questionBankId),
          estimatedCount: 0,
          route: 'kaizen://career/practice',
        },
      };
    },
  },

  log_kaizen_action: {
    def: {
      name: 'log_kaizen_action',
      description:
        'Log a Daily Core / Kaizen action. The client routes the write through the repository path.',
      parameters: {
        type: 'object',
        properties: {
          actionId: { type: 'string', description: 'Kaizen action id to log.' },
        },
        required: ['actionId'],
        additionalProperties: false,
      },
    },
    handler: (args) => {
      const actionId = str(args.actionId);
      if (!actionId) return toolError('log_kaizen_action', 'actionId is required');
      return {
        tool: 'log_kaizen_action',
        ok: true,
        clientMustResolve: true, // write goes through the iOS repository path
        data: {
          actionId,
          accepted: true,
          note: 'Queued for the client to persist via KaizenRepository.',
        },
      };
    },
  },

  remember_about_user: {
    def: {
      name: 'remember_about_user',
      description:
        'PROPOSE a durable memory about the user (preference, goal, constraint, etc.). It is NOT saved until the user approves it. Also known as update_user_profile_memory.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: [
              'goal',
              'preference',
              'constraint',
              'habit_pattern',
              'motivation',
              'career_context',
              'technical_weakness',
              'behavioral_story',
              'mental_energy_pattern',
              'health_context',
              'communication_style',
            ],
          },
          fact: { type: 'string', description: 'The concise fact to remember.' },
          confidence: { type: 'number', description: '0..1 self-reported confidence.' },
          sensitivity: { type: 'string', enum: ['normal', 'sensitive'] },
          rationale: { type: 'string', description: 'Why this is worth remembering.' },
        },
        required: ['category', 'fact'],
        additionalProperties: false,
      },
    },
    handler: (args, ctx) => {
      const category = str(args.category);
      const fact = str(args.fact);
      if (!category || !isMemoryCategory(category)) {
        return toolError('remember_about_user', 'a valid memory category is required');
      }
      if (!fact) return toolError('remember_about_user', 'fact is required');
      // Health/mental/career-fear categories default to sensitive consent gate.
      const inferredSensitive =
        category === 'health_context' || category === 'mental_energy_pattern';
      const sensitivity =
        str(args.sensitivity) === 'sensitive' || inferredSensitive ? 'sensitive' : 'normal';

      // GUARDRAIL: PROPOSE only — is_approved is always 0, never persisted here.
      const proposal: ProposedMemoryUpdate = {
        proposalId: `${ctx.sessionId}:${ctx.proposedMemoryUpdates.length}`,
        category,
        fact,
        confidence: normalizeConfidence(args.confidence),
        sensitivity,
        rationale: str(args.rationale) ?? undefined,
        is_approved: 0,
        source_session_id: ctx.sessionId,
        source_kind: 'coach_chat',
      };
      ctx.proposedMemoryUpdates.push(proposal);

      return {
        tool: 'remember_about_user',
        ok: true,
        clientMustResolve: false,
        data: {
          proposal,
          note: 'Proposed only. Persisted with is_approved=0; the user must approve it in settings.',
        },
      };
    },
  },

  recall_about_user: {
    def: {
      name: 'recall_about_user',
      description:
        'Recall approved, opted-in memories about the user, optionally filtered by category. Check this before asking the user to repeat themselves.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional category filter.' },
          query: { type: 'string', description: 'Optional free-text filter.' },
        },
        additionalProperties: false,
      },
    },
    handler: (args, ctx) => {
      const category = str(args.category);
      const query = str(args.query)?.toLowerCase();
      // Only approved + opted-in + non-sensitive (unless allowed) memories.
      const { allowed } = redactMemories(ctx.memories, {
        allowOptedInSensitive: ctx.allowOptedInSensitive,
      });
      const matches = allowed
        .filter((m) => (category ? m.category === category : true))
        .filter((m) => (query ? m.fact.toLowerCase().includes(query) : true))
        .slice(0, 10)
        .map((m) => ({ category: m.category, fact: m.fact, confidence: m.confidence }));
      return {
        tool: 'recall_about_user',
        ok: true,
        clientMustResolve: false,
        data: { category, matches },
      };
    },
  },

  open_route: {
    def: {
      name: 'open_route',
      description:
        'Ask the Kaizen navigation provider to open an in-app route inside KaizenAppShell.',
      parameters: {
        type: 'object',
        properties: {
          route: { type: 'string', description: 'Route key, e.g. kaizen://career/dashboard.' },
          params: {
            type: 'object',
            description: 'String params forwarded to the navigation provider.',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['route'],
        additionalProperties: false,
      },
    },
    handler: (args) => {
      const route = str(args.route);
      if (!route) return toolError('open_route', 'route is required');
      const rawParams = args.params;
      let params: Record<string, string> | undefined;
      if (rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)) {
        params = {};
        for (const [k, v] of Object.entries(rawParams as Record<string, unknown>)) {
          if (typeof v === 'string') params[k] = v;
        }
      }
      return {
        tool: 'open_route',
        ok: true,
        clientMustResolve: true, // navigation happens on the client
        data: { route, params },
      };
    },
  },
};

/** All tool definitions for the provider request. */
export function toolDefinitions(): GenerateToolDef[] {
  return Object.values(TOOLS).map((t) => t.def);
}

/** Whether a name is a known coach tool. */
export function isKnownTool(name: string): name is CoachToolName {
  return Object.prototype.hasOwnProperty.call(TOOLS, name);
}

/**
 * Execute a tool by name. Unknown tools return a structured error rather than
 * throwing, so the bounded loop can feed the error back to the model.
 */
export function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): AnyToolResult {
  if (!isKnownTool(name)) {
    return toolError('open_route', `unknown tool: ${name}`);
  }
  try {
    return TOOLS[name].handler(args ?? {}, ctx);
  } catch (e) {
    return toolError(name, `tool execution failed: ${String(e).slice(0, 200)}`);
  }
}
