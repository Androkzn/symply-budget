/**
 * Kaizen Coach Chat — Kaizen Master route
 *
 * POST /api/v1/kaizen/coach-chat/messages
 *
 * One user turn for Kaizen Master. Auth + rate limit, a Kaizen Master system
 * prompt assembled from a client-provided KaizenContextSnapshot + redacted
 * memory, a BOUNDED tool-use loop (MAX_TOOL_LOOP_ITERATIONS = 5), structured
 * tool results, proposed memory updates, context freshness, and a decision
 * trace.
 *
 * v1 is a plain Worker HTTP handler. NOTE: Cloudflare Workflows (per-step retry
 * / checkpoint of the tool loop) are a deliberate POST-V1 hardening.
 *
 * GATING (mirrors the `kaizenAi.ts` Kaizen routes):
 *   - kaizenAIScoring feature flag MUST be enabled (read from the feature_flags
 *     D1 table — provisioned by migration 0095_kaizen_feature_flags.sql) before
 *     any LLM turn.
 *   - A one-time disclosure acknowledgment must be present. The acknowledgment
 *     is stored LOCAL-ONLY on the device (UserDefaults, intentionally NOT synced),
 *     so the server cannot read it from D1; the client asserts it per request via
 *     the `X-Kaizen-AI-Disclosure-Ack` header (or `context.disclosureAck`). No ack
 *     => no off-device LLM call.
 *   - Cost guard: a thin LOCAL per-user/day request check.
 *
 * Brand-gated to `symply-kaizen` in src/index.ts.
 */

import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth';
import { rateLimitDO } from '../middleware/rate-limit';
import { requireAIEntitlement } from '../middleware/require-ai-entitlement';
import {
  sanitizeHistory,
  latestUserText,
  resolveSessionId,
} from '../services/kaizen/coach-chat/historySanitizer';
import { buildKaizenSystemPrompt } from '../services/kaizen/coach-chat/promptBuilder';
import {
  resolveChatProvider,
  type GenerateMessage,
  type GenerateContentBlock,
} from '../services/kaizen/coach-chat/providerAdapter';
import {
  toolDefinitions,
  executeTool,
  type ToolContext,
} from '../services/kaizen/coach-chat/toolRegistry';
import type { AnyToolResult } from '../services/kaizen/coach-chat/toolResults';
import { TraceBuilder } from '../services/kaizen/coach-chat/trace';
import type {
  MemoryRecord,
  ProposedMemoryUpdate,
} from '../services/kaizen/context/memorySchema';
import type {
  KaizenContextSnapshot,
  SnapshotFreshnessMeta,
} from '../services/kaizen/context/snapshotRenderer';
import type { Env } from '../types';
import { nowIso } from '../utils/id';

const coachChat = new Hono<{ Bindings: Env }>();

// Auth on every route (target platform JWT).
coachChat.use('*', authMiddleware());

// GATE 0 — AI entitlement (PRO subscription or a connected BYOK key). This runs
// AHEAD of the flag / disclosure / cost gates below because it is the one that
// decides WHOSE key pays: without it a free user's turn falls through to the
// platform-managed key. Kaizen Master is a pure-AI surface, so the whole router
// carries it; every manual Kaizen tool stays reachable without AI.
coachChat.use('*', requireAIEntitlement());

// Rate limit (coach turns are LLM calls — see RATE_LIMITS 'kaizen:coach').
const coachRateLimit = rateLimitDO('kaizen:coach');

/** Bounded tool-use loop ceiling (plan: v1 default 5). */
const MAX_TOOL_LOOP_ITERATIONS = 5;

/**
 * Thin, self-contained cost guard. Per-user/day request ceiling held in the
 * Worker instance. This is a deliberately local stand-in.
 */
const COACH_DAILY_CEILING = 200;
const costStore = new Map<string, { count: number; day: string }>();
function checkCostGuard(userId: string): { ok: boolean; remaining: number } {
  const day = nowIso().slice(0, 10);
  const key = `coach:${userId}`;
  let rec = costStore.get(key);
  if (!rec || rec.day !== day) {
    rec = { count: 0, day };
    costStore.set(key, rec);
  }
  rec.count++;
  return { ok: rec.count <= COACH_DAILY_CEILING, remaining: Math.max(0, COACH_DAILY_CEILING - rec.count) };
}

/** Read a single feature flag from the feature_flags D1 table (migration 0095). */
async function isFlagEnabled(env: Env, key: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      'SELECT enabled FROM feature_flags WHERE key = ?'
    )
      .bind(key)
      .first<{ enabled: number }>();
    // Safe-by-default mirrors features.ts intent, BUT the AI kill switch is
    // fail-CLOSED: a missing row means "not yet enabled" => block LLM calls.
    return row ? Boolean(row.enabled) : false;
  } catch (e) {
    console.error('[coach-chat] feature flag read failed:', e);
    return false; // fail closed on the AI gate
  }
}

/** Load approved + opted-in memories for recall/context (best-effort). */
async function loadMemories(env: Env, userId: string): Promise<MemoryRecord[]> {
  try {
    const res = await env.DB.prepare(
      `SELECT * FROM kaizen_user_memory
       WHERE user_id = ? AND deleted_at IS NULL AND is_archived = 0 AND is_approved = 1
       ORDER BY COALESCE(last_seen_at, updated_at) DESC
       LIMIT 100`
    )
      .bind(userId)
      .all<MemoryRecord>();
    return res.results ?? [];
  } catch (e) {
    // Table may not exist in every environment yet; degrade to no memory.
    console.warn('[coach-chat] memory load skipped:', String(e).slice(0, 120));
    return [];
  }
}

coachChat.post('/messages', coachRateLimit, async (c) => {
  const user = c.get('user');
  const userId = user.sub;

  const body = (await c.req.json().catch(() => null)) as any;
  if (!body) return c.json({ error: 'invalid JSON body' }, 400);

  // --- Validate envelope: { sessionId?, messages:[{role,content}], context? } ---
  const messages: GenerateMessage[] = sanitizeHistory(body.messages);
  if (messages.length === 0) {
    return c.json({ error: 'messages must be a non-empty array of {role, content}' }, 400);
  }
  if (messages[messages.length - 1].role !== 'user') {
    return c.json({ error: 'the last message must be a user turn' }, 400);
  }

  const sessionId = resolveSessionId(body.sessionId ?? body.session_id);
  const ctxIn = (body.context ?? {}) as {
    snapshot?: KaizenContextSnapshot;
    freshness?: SnapshotFreshnessMeta;
    disclosureAck?: boolean;
  };
  // The iOS client (KaizenCoachChatRequest) sends the context snapshot as a
  // top-level JSON *string* under `snapshot`, not a nested `context.snapshot`
  // object. Accept every shape so the coach actually receives context instead
  // of silently degrading to no-context. A malformed string is non-fatal.
  let snapshot: KaizenContextSnapshot | undefined = ctxIn.snapshot;
  if (!snapshot && body.snapshot) {
    if (typeof body.snapshot === 'string') {
      try {
        snapshot = JSON.parse(body.snapshot) as KaizenContextSnapshot;
      } catch {
        snapshot = undefined;
      }
    } else if (typeof body.snapshot === 'object') {
      snapshot = body.snapshot as KaizenContextSnapshot;
    }
  }
  const freshness: SnapshotFreshnessMeta | undefined =
    ctxIn.freshness ??
    (snapshot
      ? {
          freshness: snapshot.freshness,
          generatedAt: snapshot.generatedAt,
          sourceSummary: snapshot.sourceSummary,
          lastUpdated: snapshot.lastUpdated,
        }
      : undefined);

  // --- GATE 1: kaizenAIScoring feature flag (kill switch) ---
  const aiEnabled = await isFlagEnabled(c.env, 'kaizenAIScoring');
  if (!aiEnabled) {
    return c.json(
      {
        error: 'Kaizen AI is disabled',
        code: 'ai_scoring_disabled',
        sessionId,
        message: 'Kaizen Master AI is currently turned off. Manual Kaizen tools remain available.',
      },
      403
    );
  }

  // --- GATE 2: one-time disclosure acknowledgment (local-only; client asserts) ---
  const ackHeader = c.req.header('X-Kaizen-AI-Disclosure-Ack');
  const disclosureAck =
    ackHeader === '1' ||
    ackHeader === 'true' ||
    ctxIn.disclosureAck === true ||
    body.disclosureAck === true ||
    body.disclosure_ack === true;
  if (!disclosureAck) {
    return c.json(
      {
        error: 'AI disclosure not acknowledged',
        code: 'disclosure_required',
        sessionId,
        message: 'The user must acknowledge the AI disclosure before Kaizen Master can use the AI.',
      },
      403
    );
  }

  // --- GATE 3: cost guard (thin local per-user/day ceiling) ---
  const cost = checkCostGuard(userId);
  if (!cost.ok) {
    return c.json(
      {
        error: 'Daily AI coach budget reached',
        code: 'cost_ceiling',
        sessionId,
        message: 'Daily Kaizen Master AI budget reached. Try again tomorrow or use manual tools.',
      },
      429
    );
  }

  // --- Provider resolution ---
  const provider = await resolveChatProvider(c.env, userId);
  if (!provider) {
    return c.json({ error: 'AI service not configured', sessionId }, 503);
  }

  // --- Build the Kaizen Master system prompt (context assembly) ---
  const memories = await loadMemories(c.env, userId);
  const { system, contextTrace, retrievedKnowledge } = buildKaizenSystemPrompt({
    scope: snapshot?.privacyScope ?? 'coachChat',
    snapshot,
    freshness,
    memories,
    knowledge: [],
    latestUserText: latestUserText(messages),
    // Standard coachChat keeps opted-in sensitive memory OUT unless the user
    // has acknowledged the disclosure (they have, to reach here).
    allowOptedInSensitive: disclosureAck,
  });

  const trace = new TraceBuilder(sessionId, provider.providerName, provider.model);
  trace.setContextAssembly(contextTrace);

  // Shared tool context; proposedMemoryUpdates is mutated by remember_about_user.
  const proposedMemoryUpdates: ProposedMemoryUpdate[] = [];
  const toolCtx: ToolContext = {
    userId,
    sessionId,
    snapshot,
    freshness,
    memories,
    proposedMemoryUpdates,
    allowOptedInSensitive: disclosureAck,
  };

  const tools = toolDefinitions();
  // Working transcript grows as the loop appends assistant tool_use + tool_result.
  const transcript: GenerateMessage[] = [...messages];
  const allToolResults: AnyToolResult[] = [];

  let finalText = '';
  let lastUsage: Record<string, number> | null = null;

  try {
    // ----- BOUNDED TOOL-USE LOOP -----
    for (let i = 0; i < MAX_TOOL_LOOP_ITERATIONS; i++) {
      trace.markIteration();
      const result = await provider.generate({ system, messages: transcript, tools });
      lastUsage = result.usage;

      if (result.stopReason !== 'tool_use' || result.toolUses.length === 0) {
        // Final assistant turn.
        finalText = result.text;
        trace.setFinishReason('final');
        break;
      }

      // Record the assistant's tool_use turn in the transcript.
      const assistantBlocks: GenerateContentBlock[] = [];
      if (result.text) assistantBlocks.push({ type: 'text', text: result.text });
      for (const tu of result.toolUses) {
        assistantBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
      }
      transcript.push({ role: 'assistant', content: assistantBlocks });

      // Execute each requested tool and append a tool_result block.
      const resultBlocks: GenerateContentBlock[] = [];
      for (const tu of result.toolUses) {
        const started = Date.now();
        const toolResult = executeTool(tu.name, tu.input, toolCtx);
        allToolResults.push(toolResult);
        trace.recordToolCall({
          iteration: i,
          toolName: tu.name,
          arguments: tu.input,
          ok: toolResult.ok,
          error: toolResult.ok ? undefined : toolResult.error,
          durationMs: Date.now() - started,
        });
        resultBlocks.push({
          type: 'tool_result',
          toolUseId: tu.id,
          content: JSON.stringify(toolResult),
        });
      }
      transcript.push({ role: 'tool', content: resultBlocks });

      // If we just consumed the last allowed iteration, stop without a final call.
      if (i === MAX_TOOL_LOOP_ITERATIONS - 1) {
        trace.setFinishReason('max_iterations');
      }
    }

    trace.setUsage(lastUsage);

    if (!finalText && trace.build().finishReason === 'max_iterations') {
      finalText =
        'I gathered what I could but reached my tool limit for this turn. Here is the summary above — ask me to continue if you need the next step.';
    }

    const decisionTrace = trace.build();

    // Surface the first open_route tool result as the convenience `openedRoute`.
    const openedRouteResult = allToolResults.find(
      (r) => r.tool === 'open_route' && r.ok
    );
    const openedRoute =
      openedRouteResult && openedRouteResult.tool === 'open_route'
        ? openedRouteResult.data.route
        : undefined;

    // The iOS client decodes a FLAT, snake_case shape (KaizenCoachChatResponse
    // in KaizenAIContracts.swift): assistant_message (string), tool_results
    // (each { tool, result: JSON string, opened_route? }), proposed_memory_updates
    // ({ category, fact, sensitivity }), and decision_trace (string[]). Emit that
    // contract alongside the richer internal fields (Swift Codable ignores the
    // extra keys) so a successful turn actually decodes on device.
    const clientToolResults = allToolResults.map((r) => {
      const routed =
        r.ok && typeof (r as any).data?.route === 'string'
          ? ((r as any).data.route as string)
          : undefined;
      return {
        tool: r.tool,
        result: JSON.stringify(r.ok ? (r as any).data ?? {} : { error: (r as any).error }),
        opened_route: routed,
      };
    });
    const clientMemoryUpdates = proposedMemoryUpdates.map((m) => ({
      category: m.category,
      fact: m.fact,
      sensitivity: m.sensitivity,
    }));
    const clientDecisionTrace = [
      `finish:${decisionTrace.finishReason}`,
      `iterations:${decisionTrace.iterations}`,
      ...decisionTrace.toolCalls.map(
        (t) => `tool:${t.toolName} ${t.ok ? 'ok' : `err(${t.error ?? 'unknown'})`}`
      ),
    ];

    return c.json({
      // --- snake_case contract consumed by the iOS client ---
      session_id: sessionId,
      assistant_message: finalText,
      tool_results: clientToolResults,
      proposed_memory_updates: clientMemoryUpdates,
      decision_trace: clientDecisionTrace,
      // --- richer internal fields (ignored by the client's Codable) ---
      sessionId,
      message: { role: 'assistant', content: finalText },
      toolResults: allToolResults,
      openedRoute,
      proposedMemoryUpdates,
      contextFreshness: freshness?.freshness ?? contextTrace.freshness,
      retrievedKnowledge,
      model: provider.model,
      trace: decisionTrace,
    });
  } catch (e) {
    trace.setFinishReason('error');
    console.error('[coach-chat] turn failed:', e);
    return c.json(
      {
        sessionId,
        error: 'coach turn failed',
        details: String(e).slice(0, 300),
        toolResults: allToolResults,
        trace: trace.build(),
      },
      502
    );
  }
});

export default coachChat;
