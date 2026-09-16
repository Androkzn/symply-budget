/**
 * Symply Health AI coach — consent, context assembly, one turn, and commit.
 *
 * Ported from the donor's Health Coach V2
 * (`~/Desktop/Symply Ecosystem/Simply Health/backend/src/routes/healthCoach.ts`
 * + `src/services/healthCoach/**`).
 *
 * ── THE ORDER OF THE GATES IS THE DESIGN ─────────────────────────────────────
 *
 *   1. ESCALATION (`coach-safety.ts`) — deterministic, before anything else. A
 *      matched turn calls no model, spends no token, and needs no entitlement.
 *      The donor runs this only on its non-LLM path, so on any account with AI
 *      configured it never fires; see that file's header.
 *   2. CONSENT — deny-by-default. No live `insights` receipt for the current
 *      disclosure version means the turn is refused BEFORE any health row is
 *      read, let alone sent to a provider. The donor auto-grants all five scopes
 *      on first use and leaves a comment admitting it is a placeholder.
 *   3. ENTITLEMENT — `assertCanUseAI`, the platform's canonical gate. Throws
 *      `AIAccessError`, which the route maps to the shared denial codes.
 *   4. CONTEXT — the Worker reads the user's OWN rows. Nothing about this person
 *      that the model sees comes from the request body.
 *   5. MODEL — bounded tool loop, proposals only.
 *
 * ── THE SIX VERBS, AND WHY COMMIT IS THE ONLY WRITER ─────────────────────────
 *
 * The coach can propose water, weight, food, a workout, a period day and a habit
 * tick. It writes none of them. `runTurn` produces a PROPOSAL; `commit` is the
 * only method in this file that touches a domain table, and it re-derives the
 * payload through `validateCommit` before it does — the client's copy of the
 * payload is never what gets written, because `payload_hash` is a checksum a
 * client can mint rather than a signature it cannot.
 *
 * Two of the three added verbs needed a rule that no schema could express, and
 * both live in `writeDomain`:
 *
 *   * A habit tick is MARK-DONE-ONLY. The underlying service method is a toggle,
 *     so committing one against an already-ticked habit would DELETE a
 *     completion and break a streak — a destructive write behind a card that
 *     said "log". Already-done is a no-op success.
 *   * A habit's id and the name the card DISPLAYED must both match the stored
 *     row. The hash covers both fields equally, so it cannot tell a mismatched
 *     pair from an honest one; only the database can.
 *
 * ── FAIL CLOSED, AND WHAT THAT MEANS HERE ────────────────────────────────────
 *
 * A provider error, a timeout, a refusal, or an unparseable turn NEVER produces
 * an invented reply. `reply` comes back null with `ai_status: 'unavailable'` and
 * a plain-words `notice`, and the screen says the coach could not be reached.
 *
 * The grounded insights are still returned in that case, and that is not a
 * fabricated result: they are the person's own logged figures added up by
 * `coach-insights.ts`, with `composeInsightSpeech` refusing any sentence
 * containing a number that is not in the facts. Showing someone their own
 * arithmetic while telling them the AI is down is honest; inventing a coach
 * reply would not be.
 *
 * No raw provider string ever reaches the caller — the repo-wide no-raw-error
 * rule. The real error is logged, scrubbed, and dropped.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import {
  buildHealthCoachContextBlock,
  buildHealthCoachSystemPrompt,
  HEALTH_COACH_TOOLS,
  HEALTH_COACH_TOOL_NAMES,
  type HealthCoachContextLine,
} from '../../ai/prompts/health-coach';
import type { AIProvider, GenerateMessage, GenerateResult } from '../../ai/provider';
import { healthCoachConsentReceipts, healthCoachOperations } from '../../db/schema-health-ai';
import { HealthService } from '../health-service';

import { computeGroundedInsights, type GroundedInsight, type InsightFreshness } from './coach-insights';
import {
  buildProposal,
  validateCommit,
  type CoachProposal,
  type CommitRefusal,
  type ProposalPayload,
} from './coach-proposals';
import { matchEscalation, type EscalationMatch } from './coach-safety';

/* ------------------------------------------------------------------ */
/* Consent                                                             */
/* ------------------------------------------------------------------ */

/**
 * The scope the coach turn requires. The other four donor scopes
 * (`food_logging`, `weight_logging`, `water_logging`, `workout_logging`) exist
 * in the CHECK constraint but gate nothing yet: this port never lets the model
 * write, so there is no write to scope. See migration 0128.
 */
export const COACH_CONSENT_SCOPE = 'insights';

/** How many habits are named in CONTEXT. Bounded so the prompt cannot grow unboundedly. */
export const MAX_CONTEXT_HABITS = 20;

/**
 * Bump this when the disclosure TEXT the user is shown changes materially.
 *
 * A consent is only meaningful against the words it was given for, so a bump
 * invalidates every stored receipt and re-asks. The donor uses `'ga-1.0'`; this
 * is the same idea with a name that says which app it belongs to.
 *
 * `health-coach-2` is the bump for the three added logging verbs. It was
 * required in both directions: the coach now READS the person's habit list to
 * name one back to them (the v1 text enumerated food, water, weight and goals,
 * and habits were not among them), and it can now OFFER TO WRITE a workout, a
 * period day and a habit tick (the v1 text described no writes at all). Every
 * stored v1 receipt therefore reads `granted: false` until the person agrees to
 * the new words — which is the deny-by-default direction, and the reason the
 * version exists rather than being a comment.
 */
export const COACH_CONSENT_VERSION = 'health-coach-2';

export interface CoachConsentState {
  granted: boolean;
  version: string | null;
  granted_at: string | null;
  revoked_at: string | null;
  /** The version the app must currently ask against. */
  required_version: string;
}

/* ------------------------------------------------------------------ */
/* Turn                                                                */
/* ------------------------------------------------------------------ */

export type CoachTurnKind = 'reply' | 'proposal' | 'escalation' | 'unavailable';

export interface CoachTurnResult {
  kind: CoachTurnKind;
  /** Null whenever the model did not produce a usable turn. Never invented. */
  reply: string | null;
  proposal: CoachProposal | null;
  escalation: EscalationMatch | null;
  insights: GroundedInsight[];
  ai_status: 'ok' | 'unavailable' | 'skipped';
  /** Plain-words explanation when `ai_status` is not `ok`. Never a provider string. */
  notice: string | null;
  model: string | null;
}

/** One prior turn, supplied by the client — the donor's design; nothing is stored. */
export interface CoachHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** The donor caps history at six turns (`Array(history.suffix(6))`). Kept. */
export const MAX_HISTORY_TURNS = 6;

/** The donor's tool-loop ceiling. */
export const MAX_TOOL_ITERATIONS = 5;

const UNAVAILABLE_NOTICE =
  'The coach could not be reached just now. The figures below are your own logged data.';

const NO_REPLY_NOTICE =
  'The coach did not return an answer for that. Your own logged figures are below.';

export interface CoachTurnInput {
  userId: string;
  message: string;
  history?: CoachHistoryTurn[];
  /** The client's OWN local day (YYYY-MM-DD) — never a UTC stamp. */
  today: string;
}

export class HealthCoachService {
  private db: DrizzleD1Database<Record<string, never>>;
  private health: HealthService;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
    this.health = new HealthService(d1);
  }

  /* ---------------- Consent ---------------- */

  /**
   * The live receipt, if any. A receipt stored against an OLD disclosure version
   * reports `granted: false` — the person agreed to different words.
   */
  async getConsent(userId: string): Promise<CoachConsentState> {
    const [row] = await this.db
      .select()
      .from(healthCoachConsentReceipts)
      .where(
        and(
          eq(healthCoachConsentReceipts.user_id, userId),
          eq(healthCoachConsentReceipts.scope, COACH_CONSENT_SCOPE),
          isNull(healthCoachConsentReceipts.deleted_at)
        )
      )
      .limit(1);

    if (!row) {
      return {
        granted: false,
        version: null,
        granted_at: null,
        revoked_at: null,
        required_version: COACH_CONSENT_VERSION,
      };
    }
    return {
      granted: Boolean(row.granted) && row.version === COACH_CONSENT_VERSION,
      version: row.version,
      granted_at: row.granted_at,
      revoked_at: row.revoked_at,
      required_version: COACH_CONSENT_VERSION,
    };
  }

  /**
   * Grant or revoke. Revoking keeps the row and stamps `revoked_at`, so the
   * audit records WHEN the person withdrew — the donor can only flip a flag and
   * loses that.
   */
  async setConsent(userId: string, granted: boolean): Promise<CoachConsentState> {
    const ts = new Date().toISOString();
    const existing = await this.db
      .select()
      .from(healthCoachConsentReceipts)
      .where(
        and(
          eq(healthCoachConsentReceipts.user_id, userId),
          eq(healthCoachConsentReceipts.scope, COACH_CONSENT_SCOPE),
          isNull(healthCoachConsentReceipts.deleted_at)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(healthCoachConsentReceipts)
        .set({
          granted,
          version: COACH_CONSENT_VERSION,
          granted_at: granted ? ts : existing[0].granted_at,
          revoked_at: granted ? null : ts,
          updated_at: ts,
        })
        .where(eq(healthCoachConsentReceipts.id, existing[0].id))
        .run();
    } else {
      await this.db
        .insert(healthCoachConsentReceipts)
        .values({
          id: `hcc_${crypto.randomUUID()}`,
          user_id: userId,
          scope: COACH_CONSENT_SCOPE,
          granted,
          version: COACH_CONSENT_VERSION,
          granted_at: granted ? ts : null,
          revoked_at: granted ? null : ts,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        })
        .run();
    }

    return this.getConsent(userId);
  }

  /* ---------------- Context ---------------- */

  /**
   * Read the user's own figures for `today`, plus the goal in force.
   *
   * Every read is user-scoped through `HealthService`, which is the same entry
   * point the deployed routes use — so the coach cannot see a figure the person
   * could not see themselves on a screen.
   */
  async buildContext(userId: string, today: string) {
    const [nutrition, water, latestWeight, habits] = await Promise.all([
      this.health.nutritionSummary(userId, today),
      this.health.waterDailySummary(userId, today),
      this.health.listWeight(userId, { limit: 1 }),
      // Read so the coach can name a habit the person actually has, and so it can
      // see one is already ticked. Nothing else about habits enters the prompt —
      // no streaks, no history, no judgement about a missed day.
      this.health.listHabits(userId),
    ]);

    const weightRow = latestWeight[0] ?? null;

    return {
      today,
      calories: nutrition.entry_count > 0 ? nutrition.totals.calories : null,
      calorie_goal: nutrition.goal?.calories ?? null,
      protein_g: nutrition.entry_count > 0 ? nutrition.totals.proteins : null,
      protein_goal_g: nutrition.goal?.proteins ?? null,
      water_ml: water.entry_count > 0 ? water.total_ml : null,
      water_goal_ml: water.goal_ml ?? null,
      meals_logged: nutrition.entry_count,
      latest_weight:
        weightRow !== null
          ? { value: weightRow.weight, unit: weightRow.unit, date: weightRow.date }
          : null,
      habits: habits.slice(0, MAX_CONTEXT_HABITS).map((h) => ({
        id: h.id,
        name: h.name,
        done_today: h.days.includes(today),
      })),
    };
  }

  /**
   * `missing` when the person has logged nothing at all today AND has no weight
   * on record — the honest "I have nothing to go on". Anything else is `fresh`,
   * because these rows come from this Worker rather than a device sync, so the
   * donor's `stale`/`partial` states (which describe HealthKit lag) have no
   * counterpart here yet.
   */
  private freshnessOf(ctx: Awaited<ReturnType<HealthCoachService['buildContext']>>): InsightFreshness {
    const nothingToday =
      ctx.calories === null && ctx.protein_g === null && ctx.water_ml === null;
    return nothingToday && ctx.latest_weight === null ? 'missing' : 'fresh';
  }

  private contextLines(
    ctx: Awaited<ReturnType<HealthCoachService['buildContext']>>
  ): HealthCoachContextLine[] {
    return [
      { label: 'Calories logged today', value: ctx.calories === null ? null : `${Math.round(ctx.calories)} kcal` },
      { label: 'Calorie goal', value: ctx.calorie_goal === null ? null : `${Math.round(ctx.calorie_goal)} kcal` },
      { label: 'Protein logged today', value: ctx.protein_g === null ? null : `${Math.round(ctx.protein_g)} g` },
      { label: 'Protein goal', value: ctx.protein_goal_g === null ? null : `${Math.round(ctx.protein_goal_g)} g` },
      { label: 'Water logged today', value: ctx.water_ml === null ? null : `${Math.round(ctx.water_ml)} ml` },
      { label: 'Water target', value: ctx.water_goal_ml === null ? null : `${Math.round(ctx.water_goal_ml)} ml` },
      { label: 'Diary entries today', value: String(ctx.meals_logged) },
      {
        label: 'Most recent weight',
        value:
          ctx.latest_weight === null
            ? null
            : `${ctx.latest_weight.value} ${ctx.latest_weight.unit} on ${ctx.latest_weight.date}`,
      },
      {
        // The ONLY place a habit id is ever shown to the model. Stated as an
        // explicit list with the id beside the name so `prepare_log_habit` can
        // quote both exactly; a habit that is not on this line does not exist as
        // far as the coach is concerned, and the commit path enforces that.
        //
        // An empty list is stated as a FACT, not left null. Null renders as
        // "not logged (unknown, NOT zero)", which is right for a metric someone
        // might have failed to record and wrong here: "this person has no habits
        // set up" is known, and reading it as unknown is what would let the coach
        // guess at one.
        label: 'Your habits (id — name — state today)',
        value:
          ctx.habits.length === 0
            ? 'none set up in this app — do not propose a habit'
            : ctx.habits
                .map((h) => `${h.id} — ${h.name} — ${h.done_today ? 'done today' : 'not done today'}`)
                .join('; '),
      },
    ];
  }

  /* ---------------- One turn ---------------- */

  /**
   * The escalation check, run BEFORE any I/O.
   *
   * Separate from `runTurn` so the route can call it before it resolves
   * entitlement: a person describing chest pain must get the notice whether or
   * not they pay for AI.
   */
  checkEscalation(message: string): EscalationMatch | null {
    return matchEscalation(message);
  }

  /**
   * Run one coach turn.
   *
   * `provider` is null when the caller could not construct one (no key
   * configured) — that is the fail-closed path, NOT an error, and it returns the
   * same shape as a provider that threw.
   */
  async runTurn(
    input: CoachTurnInput,
    provider: AIProvider | null,
    opts: { model: string; now?: Date; newId?: () => string } = { model: 'claude-sonnet-5' }
  ): Promise<CoachTurnResult> {
    const now = opts.now ?? new Date();
    const newId = opts.newId ?? (() => `hop_${crypto.randomUUID()}`);

    // 1 — escalation, deterministic, before any read or any token.
    const escalation = this.checkEscalation(input.message);
    if (escalation) {
      return {
        kind: 'escalation',
        reply: escalation.message,
        proposal: null,
        escalation,
        insights: [],
        ai_status: 'skipped',
        notice: null,
        model: null,
      };
    }

    // 2 — the user's own figures.
    const ctx = await this.buildContext(input.userId, input.today);
    const insights = computeGroundedInsights({
      today_calories: ctx.calories,
      calorie_goal: ctx.calorie_goal,
      today_protein_g: ctx.protein_g,
      protein_goal_g: ctx.protein_goal_g,
      today_water_ml: ctx.water_ml,
      water_goal_ml: ctx.water_goal_ml,
      freshness: this.freshnessOf(ctx),
      consent_insights: true,
      window: { start: `${input.today}T00:00:00.000Z`, end: `${input.today}T23:59:59.999Z` },
    });

    if (!provider) {
      return {
        kind: 'unavailable',
        reply: null,
        proposal: null,
        escalation: null,
        insights,
        ai_status: 'unavailable',
        notice: UNAVAILABLE_NOTICE,
        model: null,
      };
    }

    const systemPrompt = buildHealthCoachSystemPrompt({
      contextBlock: buildHealthCoachContextBlock(this.contextLines(ctx)),
      nowIso: now.toISOString(),
      today: input.today,
    });

    const transcript: GenerateMessage[] = [
      ...(input.history ?? [])
        .slice(-MAX_HISTORY_TURNS)
        .map((t) => ({ role: t.role, content: t.text }) as GenerateMessage),
      { role: 'user', content: input.message },
    ];

    let proposal: CoachProposal | null = null;
    let replyText = '';
    let model: string | null = null;

    try {
      for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
        const result: GenerateResult = await provider.generate({
          model: opts.model,
          systemPrompt,
          messages: transcript,
          tools: HEALTH_COACH_TOOLS.map((t) => ({ ...t })),
          maxTokens: 1200,
        });
        model = result.model ?? model;

        const text = result.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        if (text) replyText = text;

        const toolUses = result.content.filter(
          (b): b is { type: 'tool_use'; id: string; name: string; input: unknown } =>
            b.type === 'tool_use'
        );
        if (result.stopReason !== 'tool_use' || toolUses.length === 0) break;

        // Record the assistant turn, then answer every tool it asked for. Only
        // the FIRST prepare_log_* becomes a proposal — the donor's rule, and the
        // reason is that a single confirm card cannot represent two writes.
        transcript.push({
          role: 'assistant',
          content: [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...toolUses.map((t) => ({
              type: 'tool_use' as const,
              id: t.id,
              name: t.name,
              input: t.input,
            })),
          ],
        });

        const results: Extract<GenerateMessage['content'], unknown[]> = [];
        for (const call of toolUses) {
          if (!HEALTH_COACH_TOOL_NAMES.has(call.name)) {
            results.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: JSON.stringify({ ok: false, error: 'unknown_tool' }),
            });
            continue;
          }
          if (proposal) {
            results.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: JSON.stringify({ ok: false, error: 'proposal already prepared this turn' }),
            });
            continue;
          }
          const built = buildProposal({
            toolName: call.name,
            input: call.input,
            originalText: input.message,
            now,
            newId,
          });
          if (!built) {
            results.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: JSON.stringify({
                ok: false,
                error: 'those values are outside what this app will store; ask the person to restate',
              }),
            });
            continue;
          }
          proposal = built;
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: JSON.stringify({ ok: true, prepared: built.normalized_payload }),
          });
        }
        transcript.push({ role: 'user', content: results });
      }
    } catch (err) {
      // The real message is logged and never returned — no raw provider strings
      // in a member-facing payload.
      console.error('[health-coach] turn failed:', String(err).slice(0, 200));
      return {
        kind: 'unavailable',
        reply: null,
        proposal: null,
        escalation: null,
        insights,
        ai_status: 'unavailable',
        notice: UNAVAILABLE_NOTICE,
        model: null,
      };
    }

    if (!replyText && !proposal) {
      // An empty turn is not an answer. Say so rather than shipping "".
      return {
        kind: 'unavailable',
        reply: null,
        proposal: null,
        escalation: null,
        insights,
        ai_status: 'unavailable',
        notice: NO_REPLY_NOTICE,
        model,
      };
    }

    return {
      kind: proposal ? 'proposal' : 'reply',
      reply: replyText || null,
      proposal,
      escalation: null,
      insights,
      ai_status: 'ok',
      notice: null,
      model,
    };
  }

  /* ---------------- Commit ---------------- */

  /**
   * Commit a proposal the person confirmed.
   *
   * LEDGER FIRST (as `pending`), THEN the domain write, THEN the ledger is
   * confirmed. That ordering is what makes a retry safe, and it is the ordering
   * this comment has always described — the code used to do the reverse, and the
   * reverse is exactly the failure the comment warns about: with the diary
   * written first, any failure of the ledger insert (a D1 hiccup, a constraint)
   * left a meal in the diary that NOTHING recorded, so the client's retry saw no
   * receipt and logged it a second time.
   *
   * Claiming the row first means a crash before the diary write leaves a
   * `pending` receipt and no entry, which the next retry of the same
   * `operation_id` finishes. The residual window — the diary landed but the
   * confirm did not — is narrow, and unlike before it is RECORDED: the pending
   * receipt names the operation, so the double is visible rather than silent.
   *
   * Same deliberate ordering the donor's `/commit` uses, and the same reasoning
   * the Activity screen's edit path used before 0124 ("a mid-flight failure left
   * a recoverable duplicate rather than a lost session").
   */
  async commit(args: {
    userId: string;
    proposal: unknown;
    confirmedHash: unknown;
    today: string;
    now?: Date;
  }): Promise<
    | { ok: true; status: 'committed' | 'idempotent_replay'; target_id: string; target_type: string }
    | { ok: false; reason: CommitRefusal }
  > {
    const now = args.now ?? new Date();
    const validated = validateCommit({
      proposal: args.proposal,
      confirmedHash: args.confirmedHash,
      now,
    });
    if (!validated.ok) return validated;

    const proposal = validated.proposal;
    const ts = now.toISOString();

    // Idempotent replay: the same (user, operation_id) has already landed. Only
    // a CONFIRMED receipt is a replay — a `pending` one means the last attempt
    // did not finish, and answering "already done" would strand the person's
    // confirmation with nothing written.
    const [existing] = await this.db
      .select()
      .from(healthCoachOperations)
      .where(
        and(
          eq(healthCoachOperations.user_id, args.userId),
          eq(healthCoachOperations.operation_id, proposal.operation_id)
        )
      )
      .limit(1);

    if (existing && existing.commit_status === 'committed') {
      return {
        ok: true,
        status: 'idempotent_replay',
        target_id: existing.target_id,
        target_type: existing.target_type,
      };
    }

    if (!existing) {
      // Claim the operation BEFORE anything is written to the domain. The
      // composite PK (user_id, operation_id) is what makes the claim exclusive.
      await this.db
        .insert(healthCoachOperations)
        .values({
          operation_id: proposal.operation_id,
          user_id: args.userId,
          target_type: proposal.target_type,
          // NOT NULL, and there is no target yet — the confirm below fills it.
          target_id: '',
          payload_hash: proposal.payload_hash,
          commit_status: 'pending',
          expected_target_version: null,
          result_json: null,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        })
        .run();
    }

    const written = await this.writeDomain(args.userId, args.today, proposal.normalized_payload);

    // The domain refused. The `pending` receipt STAYS: it is the record that
    // this person confirmed something and nothing was written, and it is what
    // lets a retry of the same operation_id finish the job if the target comes
    // back. Marking it committed here would claim a write that did not happen;
    // deleting it would erase the audit of a confirmation the person made.
    if (!written.ok) return { ok: false, reason: written.reason };

    await this.db
      .update(healthCoachOperations)
      .set({
        target_id: written.id,
        commit_status: 'committed',
        result_json: JSON.stringify({ ids: written.ids }),
        updated_at: ts,
      })
      .where(
        and(
          eq(healthCoachOperations.user_id, args.userId),
          eq(healthCoachOperations.operation_id, proposal.operation_id)
        )
      )
      .run();

    return { ok: true, status: 'committed', target_id: written.id, target_type: proposal.target_type };
  }

  /**
   * The actual write, through the SAME `HealthService` methods the deployed
   * routes use. There is no coach-only write path — a row the coach created is
   * indistinguishable from one the person typed, which is what makes it
   * editable and deletable on the normal screens.
   *
   * Returns a REFUSAL rather than throwing when the target is not writable for
   * this user. The only case today is a habit id that is not theirs, was
   * deleted, or no longer answers to the name the confirm card displayed —
   * facts `validateCommit` cannot check, because it is pure and has no database.
   * A refusal here leaves the ledger row `pending`, which is exactly the state a
   * retry is designed to finish, and is honest about what happened.
   */
  private async writeDomain(
    userId: string,
    today: string,
    payload: ProposalPayload
  ): Promise<
    { ok: true; id: string; ids: string[] } | { ok: false; reason: 'target_unavailable' }
  > {
    if (payload.kind === 'water') {
      const row = await this.health.createWater(userId, {
        date: today,
        amount_ml: payload.amount_ml,
      });
      return { ok: true, id: row.id, ids: [row.id] };
    }

    if (payload.kind === 'weight') {
      const row = await this.health.createWeight(userId, {
        date: today,
        weight: payload.weight,
        unit: payload.unit,
      });
      return { ok: true, id: row.id, ids: [row.id] };
    }

    if (payload.kind === 'workout') {
      // The generic entry table with the typed payload `POST /entries/workouts`
      // writes — same shape, same `intensity` column, so an edit on the Activity
      // screen finds exactly the row it expects.
      const row = await this.health.createHealthEntry(userId, {
        date: today,
        entry_type: 'workout',
        data: {
          workout_type: payload.workout_type,
          minutes: payload.minutes,
          // The route defaults these two rather than storing null, and a coach
          // row that differed would render differently on the same card.
          calories: payload.calories ?? 0,
          note: payload.note ?? '',
        },
        intensity: payload.intensity,
      });
      return { ok: true, id: row.id, ids: [row.id] };
    }

    if (payload.kind === 'period') {
      // `logPeriodDay` upserts on (user, date) and re-anchors the cycle exactly
      // as the ordinary route does, so a confirmed proposal and a tap on the
      // Cycle screen are the same write. It returns the whole list, not a row,
      // so the ledger records the DAY as the target id — which is the stable
      // identifier for an upsert anyway.
      await this.health.logPeriodDay(userId, today, payload.flow_level, payload.notes ?? undefined);
      return { ok: true, id: today, ids: [today] };
    }

    if (payload.kind === 'habit') {
      const habits = await this.health.listHabits(userId);
      const habit = habits.find((h) => h.id === payload.habit_id);
      // Not theirs, archived, or deleted since the proposal was made.
      if (!habit) return { ok: false, reason: 'target_unavailable' };
      // The card SAID one thing; the row must agree. Without this a proposal
      // pairing name A with id B would display habit A and tick habit B, and the
      // payload hash cannot catch it because it covers both fields equally.
      if (habit.name.trim().toLowerCase() !== payload.habit_name.trim().toLowerCase()) {
        return { ok: false, reason: 'target_unavailable' };
      }
      // MARK DONE, NEVER UNTICK. `toggleHabit` flips, so calling it on a habit
      // that is already done today would silently DELETE the person's completion
      // and break their streak — a destructive write arriving through a card
      // that said "log my meditation". Already-done is success, and idempotent.
      if (!habit.days.includes(today)) {
        const result = await this.health.toggleHabit(userId, habit.id, today);
        if (!result || !result.done) return { ok: false, reason: 'target_unavailable' };
      }
      return { ok: true, id: habit.id, ids: [habit.id] };
    }

    const ids: string[] = [];
    for (const item of payload.items) {
      const row = await this.health.createNutrition(userId, {
        date: today,
        food_name: item.food_name,
        meal_type: payload.meal_type ?? 'snack',
        calories: item.calories ?? 0,
        proteins: item.protein_g ?? 0,
        carbohydrates: item.carbs_g ?? 0,
        fats: item.fat_g ?? 0,
        portion: item.grams ?? undefined,
        unit: item.grams !== null ? 'g' : undefined,
      });
      if (row) ids.push(row.id);
    }
    return { ok: true, id: ids[0] ?? '', ids };
  }

  /** Read one ledger receipt — the donor's `GET /operations/:operationId`. */
  async getOperation(userId: string, operationId: string) {
    const [row] = await this.db
      .select()
      .from(healthCoachOperations)
      .where(
        and(
          eq(healthCoachOperations.user_id, userId),
          eq(healthCoachOperations.operation_id, operationId)
        )
      )
      .limit(1);
    return row ?? null;
  }

  /** Recent receipts, newest first — what the screen shows as "logged by coach". */
  async listOperations(userId: string, limit = 20) {
    return this.db
      .select()
      .from(healthCoachOperations)
      .where(
        and(
          eq(healthCoachOperations.user_id, userId),
          isNull(healthCoachOperations.deleted_at)
        )
      )
      .orderBy(desc(healthCoachOperations.created_at))
      .limit(limit)
      .all();
  }
}
