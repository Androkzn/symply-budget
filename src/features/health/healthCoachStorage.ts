import {
  healthApi,
  parseHealthInsightList,
  type HealthBodyInsight,
} from '@api/health';
import {
  healthAiApi,
  type HealthCoachConsent,
  type HealthCoachOperation,
  type HealthCoachProposal,
  type HealthCoachTurn,
  type HealthGroundedInsight,
  type HealthMeasurementFacts,
} from '@api/healthAi';
import { storageHelpers } from '@services/storage';

import { todayDateKey } from './healthLocalStorage';
import { readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — AI COACH store (ported donor `HealthCoachService` +
 * `VoiceChatViewModel`, text-first).
 *
 * ── WHY THE TRANSCRIPT LIVES ON THE DEVICE ───────────────────────────────────
 *
 * Unlike every other Health store, this one is not a cache OVER a server record:
 * there is no server record. `backend/migrations/0128_health_ai.sql` deliberately
 * ships no conversation table, and the donor has none either — its
 * `CoachTurnRequest.history` arrives FROM the client on every turn. So the
 * transcript under `health.coach.v1` IS the conversation, and the six most recent
 * turns are what get sent back up as context.
 *
 * That makes the sign-out clear in `healthCacheKeys.ts` load-bearing rather than
 * hygienic: a coach transcript is the most revealing thing this app stores about
 * a person, because it is in their own words.
 *
 * What IS server-backed here: the consent receipt, the proposal ledger, the
 * stored body insights, and every figure the coach reasons about. The Worker
 * reads the member's own rows at turn time — this module never sends a health
 * figure up, only the message and the recent turns.
 *
 * Those three server-backed surfaces are read through `healthRepository.ts` like
 * every other Health store, and their cache keys are registered in
 * `healthCacheKeys.ts`. Two of them existed on the Worker for a whole phase with
 * nothing on this side asking for them — `GET /health/body-insights` (+ `/latest`
 * and `/photo`) and `GET /ai/coach/operations/:operationId` — which meant a
 * summary the producer had persisted was visible only in the response that
 * created it, and a member had no way to see what the coach had done for them.
 * `loadBodyInsightHistory` / `loadLatestBodyInsight` and `loadCoachOperations` /
 * `loadCoachOperationReceipt` are those readers.
 *
 * ── THE RULE THIS MODULE PROTECTS ────────────────────────────────────────────
 *
 * **A proposal is committed with the hash it was shown with, or not at all.**
 * `confirmProposal` passes the whole proposal object through untouched;
 * `src/api/healthAi.ts` derives `confirmed_payload_hash` from it, and the Worker
 * re-hashes the payload it receives and refuses a mismatch. No screen may
 * reconstruct, edit or re-round a proposal before confirming it — an edited
 * suggestion is a NEW question for the coach, not a confirmation of the old one.
 * `__tests__/healthCoachStorage.test.ts` pins that.
 *
 * ── SAFETY STANCE ────────────────────────────────────────────────────────────
 *
 * Identical to `healthInjuryStorage.ts`: this module carries no health claim of
 * its own. The escalation notice, the insights and the coach's words all arrive
 * from the Worker already grounded; nothing here interprets, grades or adds to
 * them. The one piece of judgement it does exercise is refusing to render an
 * empty AI reply as an empty bubble — see `appendTurn`.
 */

export const HEALTH_COACH_KEY = 'health.coach.v1';
export const HEALTH_COACH_CONSENT_KEY = 'health.coachConsent.v1';
export const HEALTH_BODY_INSIGHTS_KEY = 'health.bodyInsights.v1';
export const HEALTH_COACH_OPERATIONS_KEY = 'health.coachOperations.v1';

/** How far back the Body-insight history and the coach ledger are read. */
export const BODY_INSIGHT_HISTORY_LIMIT = 30;
export const COACH_OPERATIONS_LIMIT = 30;

/** How many turns the transcript keeps on the device. */
const MAX_STORED_TURNS = 60;

/** The Worker caps history at six; sending more is wasted tokens. */
export const HISTORY_TURNS_SENT = 6;

export type CoachMessageRole = 'user' | 'assistant';

export interface CoachMessage {
  id: string;
  role: CoachMessageRole;
  text: string;
  createdAt: string;
  /** Present on the assistant turn that offered it. Cleared once acted on. */
  proposal?: HealthCoachProposal | null;
  /** True when the Worker answered from the deterministic emergency layer. */
  escalation?: boolean;
  /** Set when the coach could not be reached; the bubble says so plainly. */
  notice?: string | null;
}

export interface CoachState {
  messages: CoachMessage[];
  insights: HealthGroundedInsight[];
  /** Mirrors the last turn's `ai_status` so the screen can show one banner. */
  aiStatus: 'ok' | 'unavailable' | 'skipped' | 'idle';
}

const EMPTY_STATE: CoachState = { messages: [], insights: [], aiStatus: 'idle' };

/* ==================================================================== */
/* Consent                                                               */
/* ==================================================================== */

const UNKNOWN_CONSENT: HealthCoachConsent = {
  granted: false,
  version: null,
  granted_at: null,
  revoked_at: null,
  required_version: '',
};

/**
 * The consent receipt.
 *
 * DENY-BY-DEFAULT ON EVERY FAILURE PATH: an offline read with no cached value
 * falls back to `granted: false`, never to true. A cached `true` is only ever
 * written after the server said so.
 */
export async function loadCoachConsent(): Promise<HealthCoachConsent> {
  return readThrough(
    HEALTH_COACH_CONSENT_KEY,
    async () => (await healthAiApi.getCoachConsent()).consent,
    UNKNOWN_CONSENT
  );
}

export async function setCoachConsent(granted: boolean): Promise<HealthCoachConsent> {
  return writeThrough(
    HEALTH_COACH_CONSENT_KEY,
    () => healthAiApi.setCoachConsent(granted),
    async () => (await healthAiApi.getCoachConsent()).consent,
    // The optimistic value for a GRANT is still the unknown state, not
    // `granted: true`: only the server may say a consent exists, and an
    // offline grant that showed an unlocked coach would be a lie the very next
    // turn corrects with a 403.
    UNKNOWN_CONSENT,
    `coach consent granted=${granted}`
  );
}

/* ==================================================================== */
/* Transcript                                                            */
/* ==================================================================== */

function normalizeState(raw: unknown): CoachState {
  const state = (raw ?? {}) as Partial<CoachState>;
  const messages = Array.isArray(state.messages) ? state.messages : [];
  return {
    messages: messages
      .filter(
        (m): m is CoachMessage =>
          Boolean(m) && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant')
      )
      .slice(-MAX_STORED_TURNS),
    insights: Array.isArray(state.insights) ? state.insights : [],
    aiStatus: state.aiStatus ?? 'idle',
  };
}

export async function loadCoachState(): Promise<CoachState> {
  const cached = await storageHelpers.getObject<CoachState>(HEALTH_COACH_KEY);
  return normalizeState(cached);
}

async function persist(state: CoachState): Promise<CoachState> {
  const trimmed: CoachState = { ...state, messages: state.messages.slice(-MAX_STORED_TURNS) };
  await storageHelpers.setObject(HEALTH_COACH_KEY, trimmed);
  return trimmed;
}

/** Wipe the conversation on this device. The server holds no copy to clear. */
export async function clearCoachTranscript(): Promise<CoachState> {
  return persist(EMPTY_STATE);
}

let seq = 0;
function nextId(role: CoachMessageRole): string {
  seq += 1;
  return `${role}_${Date.now()}_${seq}`;
}

/* ==================================================================== */
/* One turn                                                              */
/* ==================================================================== */

export const COACH_OFFLINE_MESSAGE =
  'The coach could not be reached. Your message was not sent — try again when you are back online.';

export const COACH_CONSENT_MESSAGE =
  'Turn on coach insights above so it can read the health data you have logged.';

/**
 * The entitlement denial.
 *
 * It names the ROUTE to fixing it — More → AI access is the shared
 * `/ai-access` hub every brand unlocks through — because "not available" with no
 * next step is where members give up. The gate itself is the platform's
 * `assertCanUseAI` on the Worker, not a client check, so this copy is a
 * signpost rather than the enforcement.
 */
export const COACH_LOCKED_MESSAGE =
  'AI is not switched on for this account. Open More → AI access to turn it on. Everything else in Symply Health keeps working.';

export type CoachSendStatus = 'answered' | 'consent_required' | 'locked' | 'offline';

export interface CoachSendResult {
  state: CoachState;
  status: CoachSendStatus;
  /** Plain-words banner, or null when the turn was answered normally. */
  message: string | null;
}

/**
 * Send one message and fold the answer into the transcript.
 *
 * The USER message is appended before the request and stays even when the turn
 * fails: a screen that swallows what someone typed because the network dropped
 * is worse than one that shows it unanswered.
 */
export async function sendCoachMessage(text: string): Promise<CoachSendResult> {
  const trimmed = text.trim();
  const before = await loadCoachState();
  if (trimmed.length === 0) {
    return { state: before, status: 'answered', message: null };
  }

  const withUser: CoachState = {
    ...before,
    messages: [
      ...before.messages,
      { id: nextId('user'), role: 'user', text: trimmed, createdAt: new Date().toISOString() },
    ],
  };
  const pending = await persist(withUser);

  let turn: HealthCoachTurn;
  try {
    const payload = await healthAiApi.coachTurn({
      message: trimmed,
      today: todayDateKey(),
      history: before.messages.slice(-HISTORY_TURNS_SENT).map((m) => ({
        role: m.role,
        text: m.text,
      })),
    });
    turn = payload.turn;
  } catch (error) {
    const status = httpStatusOf(error);
    // 403 has two meanings on this route and they are not interchangeable: one
    // is fixable by the member here and now, the other is an account state.
    if (status === 403) {
      const code = errorCodeOf(error);
      if (code === 'coach_consent_required') {
        return { state: pending, status: 'consent_required', message: COACH_CONSENT_MESSAGE };
      }
      return { state: pending, status: 'locked', message: COACH_LOCKED_MESSAGE };
    }
    return { state: pending, status: 'offline', message: COACH_OFFLINE_MESSAGE };
  }

  return { state: await persist(appendTurn(pending, turn)), status: 'answered', message: null };
}

/**
 * Fold a server turn into the transcript.
 *
 * Exported for the tests, because this is where the fail-closed rule becomes
 * visible: a turn with `reply: null` produces a bubble carrying the server's
 * NOTICE, never an empty bubble and never invented text. An empty assistant
 * bubble reads as "the coach had nothing to say"; the notice says the coach
 * could not be reached, which is a different fact.
 */
export function appendTurn(state: CoachState, turn: HealthCoachTurn): CoachState {
  const text = (turn.reply ?? '').trim();
  const message: CoachMessage = {
    id: nextId('assistant'),
    role: 'assistant',
    text: text.length > 0 ? text : (turn.notice ?? COACH_OFFLINE_MESSAGE),
    createdAt: new Date().toISOString(),
    proposal: turn.proposal ?? null,
    escalation: turn.kind === 'escalation',
    notice: text.length > 0 ? turn.notice : null,
  };
  return {
    messages: [...state.messages, message],
    // An escalation turn carries no insights; keeping the previous set would
    // put a calorie card under an emergency notice.
    insights: turn.kind === 'escalation' ? [] : turn.insights,
    aiStatus: turn.ai_status,
  };
}

/* ==================================================================== */
/* Proposals                                                             */
/* ==================================================================== */

export const PROPOSAL_EXPIRED_MESSAGE =
  'That suggestion has expired. Ask the coach again and confirm the new one.';

export const PROPOSAL_CHANGED_MESSAGE =
  'Those numbers changed since the coach suggested them. Ask again and confirm the new suggestion.';

export const PROPOSAL_SAVE_FAILED_MESSAGE =
  'That could not be saved just now. Please try again.';

/**
 * The habit the suggestion pointed at is gone, was renamed, or was never theirs.
 *
 * Kept distinct from `PROPOSAL_CHANGED_MESSAGE` because "those numbers changed"
 * would be false and unactionable here — nothing about the figures moved, the
 * target did. It does not say WHICH of the three it was: the Worker deliberately
 * answers the same way for all of them so that a 404 cannot be used to discover
 * whether an id exists on another account.
 */
export const PROPOSAL_TARGET_GONE_MESSAGE =
  'That is no longer one of your habits, so nothing was saved. Ask the coach again.';

export type ProposalOutcome =
  | 'saved'
  | 'already_saved'
  | 'expired'
  | 'changed'
  | 'target_gone'
  | 'failed';

export interface ProposalResult {
  state: CoachState;
  outcome: ProposalOutcome;
  message: string | null;
}

/** True once the 15-minute window has passed. Checked before the request. */
export function proposalHasExpired(
  proposal: HealthCoachProposal,
  now: Date = new Date()
): boolean {
  const at = Date.parse(proposal.expires_at);
  return !Number.isFinite(at) || at < now.getTime();
}

/**
 * Confirm a proposal.
 *
 * The proposal is passed through UNTOUCHED — see the module header. The screen
 * may not adjust a figure and then confirm; that is a new question for the
 * coach, and the Worker would refuse it anyway.
 */
export async function confirmProposal(
  messageId: string,
  proposal: HealthCoachProposal
): Promise<ProposalResult> {
  const before = await loadCoachState();

  if (proposalHasExpired(proposal)) {
    return {
      state: await persist(clearProposal(before, messageId)),
      outcome: 'expired',
      message: PROPOSAL_EXPIRED_MESSAGE,
    };
  }

  try {
    const result = await healthAiApi.commitProposal({ proposal, today: todayDateKey() });
    // The ledger just gained a row. Refresh it so the receipt list reflects what
    // the member just confirmed without waiting for the next open.
    await refreshCoachOperations();
    return {
      state: await persist(clearProposal(before, messageId)),
      outcome: result.status === 'idempotent_replay' ? 'already_saved' : 'saved',
      message: null,
    };
  } catch (error) {
    const status = httpStatusOf(error);
    if (status === 409) {
      const code = errorCodeOf(error);
      // Three distinct 409s, three distinct next steps. `target_unavailable`
      // must not be reported as "the numbers changed" — nothing about the
      // figures moved, and the member would go looking for a change that is
      // not there.
      const outcome: ProposalOutcome =
        code === 'proposal_expired'
          ? 'expired'
          : code === 'target_unavailable'
            ? 'target_gone'
            : 'changed';
      const message =
        outcome === 'expired'
          ? PROPOSAL_EXPIRED_MESSAGE
          : outcome === 'target_gone'
            ? PROPOSAL_TARGET_GONE_MESSAGE
            : PROPOSAL_CHANGED_MESSAGE;
      return {
        state: await persist(clearProposal(before, messageId)),
        outcome,
        message,
      };
    }
    // The card STAYS on a transient failure — the member can retry the same
    // confirmation, and the ledger makes a duplicate impossible.
    return { state: before, outcome: 'failed', message: PROPOSAL_SAVE_FAILED_MESSAGE };
  }
}

/** Dismiss without saving. The suggestion simply goes away. */
export async function dismissProposal(messageId: string): Promise<CoachState> {
  return persist(clearProposal(await loadCoachState(), messageId));
}

function clearProposal(state: CoachState, messageId: string): CoachState {
  return {
    ...state,
    messages: state.messages.map((m) => (m.id === messageId ? { ...m, proposal: null } : m)),
  };
}

/* ==================================================================== */
/* Body insight                                                          */
/* ==================================================================== */

export const BODY_INSIGHT_NEEDS_DATA_MESSAGE =
  'Log some body measurements first — there is nothing to summarise yet.';

export const BODY_INSIGHT_FAILED_MESSAGE =
  'That could not be generated just now. Please try again.';

export interface BodyInsightView {
  observations: string[];
  whatToLogNext: string[];
  facts: HealthMeasurementFacts;
  aiStatus: 'ok' | 'unavailable';
  /** Model sentences dropped for naming a number the readings do not hold. */
  droppedUngrounded: number;
}

export type BodyInsightOutcome = 'generated' | 'needs_data' | 'consent_required' | 'failed';

export interface BodyInsightResult {
  insight: BodyInsightView | null;
  outcome: BodyInsightOutcome;
  message: string | null;
}

export async function generateBodyInsight(
  date: string = todayDateKey()
): Promise<BodyInsightResult> {
  try {
    const result = await healthAiApi.generateBodyInsight(date);
    const row = result.insight ?? {};
    // The producer just wrote a row. Refresh the cached history so the card and
    // the "Earlier summaries" list agree without waiting for the next open —
    // and so an immediate offline read shows the summary that was just made.
    await refreshBodyInsightHistory();
    return {
      insight: {
        observations: parseHealthInsightList(row.strengths),
        whatToLogNext: parseHealthInsightList(row.areas_of_improvement),
        facts: result.facts,
        aiStatus: result.ai_status,
        droppedUngrounded: result.dropped_ungrounded,
      },
      outcome: 'generated',
      message: null,
    };
  } catch (error) {
    const status = httpStatusOf(error);
    if (status === 422) {
      return { insight: null, outcome: 'needs_data', message: BODY_INSIGHT_NEEDS_DATA_MESSAGE };
    }
    if (status === 403) {
      return { insight: null, outcome: 'consent_required', message: COACH_CONSENT_MESSAGE };
    }
    return { insight: null, outcome: 'failed', message: BODY_INSIGHT_FAILED_MESSAGE };
  }
}

/* ==================================================================== */
/* Body-insight HISTORY — the reader for what the producer persists      */
/* ==================================================================== */

/**
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * `POST /ai/body-insights/generate` has persisted a row through
 * `measurement-insight-service.ts` since P3, and `GET /health/body-insights`,
 * `/latest` and `/photo` have been serving them since P2 — with no caller on
 * this side. The effect was a summary that existed only in the response that
 * created it: generating showed prose, closing the screen lost it, and re-opening
 * showed an empty card over a table that already held the answer.
 *
 * These readers close that. They are READ-ONLY on purpose — there is no client
 * write path to `body_comprehensive_insights`, because a device that could POST
 * an "AI analysis" would be indistinguishable from the producer.
 *
 * ── WHAT IS DELIBERATELY NOT READ ────────────────────────────────────────────
 *
 * No score, no body-fat range, no lean-mass estimate. Those columns are null by
 * product decision (body photos are unported — privacy, audit §8) and this
 * reader does not surface them, does not compute a substitute, and does not
 * treat a null as a zero. What it reads is the honest part: which sites moved,
 * by how much, and over what window.
 */
export interface BodyInsightHistoryEntry {
  id: string;
  /** The member's own local day the summary describes. */
  date: string;
  observations: string[];
  whatToLogNext: string[];
  /** Sites with a single reading, so they have no trend yet. */
  singleReadingSites: string[];
  /**
   * True when a model wordsmithed the grounded figures, false when the text is
   * the deterministic arithmetic. Surfaced because a reader is entitled to know
   * which one they are reading — never as a quality signal.
   */
  aiWritten: boolean;
  createdAt: string;
}

function toBodyInsightHistoryEntry(row: HealthBodyInsight): BodyInsightHistoryEntry {
  return {
    id: String(row.id ?? ''),
    date: String(row.date ?? ''),
    observations: parseHealthInsightList(row.strengths),
    whatToLogNext: parseHealthInsightList(row.areas_of_improvement),
    singleReadingSites: parseHealthInsightList(row.recommended_focus_areas),
    aiWritten: row.analysis_provider === 'symply-health-coach',
    createdAt: String(row.created_at ?? ''),
  };
}

/** Refresh the cached rows from the server, ignoring a failure. */
async function refreshBodyInsightHistory(): Promise<void> {
  try {
    const { insights } = await healthApi.listBodyInsights({ limit: BODY_INSIGHT_HISTORY_LIMIT });
    await storageHelpers.setObject(HEALTH_BODY_INSIGHTS_KEY, insights);
  } catch {
    // The generate call already succeeded; a stale list is not worth surfacing.
  }
}

/**
 * Stored summaries, newest first.
 *
 * The RAW rows are what gets cached, so `loadLatestBodyInsight` can fall back to
 * the head of this list offline without a second key.
 */
export async function loadBodyInsightHistory(
  limit: number = BODY_INSIGHT_HISTORY_LIMIT
): Promise<BodyInsightHistoryEntry[]> {
  const rows = await readThrough<HealthBodyInsight[]>(
    HEALTH_BODY_INSIGHTS_KEY,
    async () => (await healthApi.listBodyInsights({ limit })).insights,
    []
  );
  return rows.map(toBodyInsightHistoryEntry);
}

/**
 * The newest stored summary, or null when there is none.
 *
 * Hits `/body-insights/latest` — the route exists precisely so the card does not
 * have to pull a whole history to render one thing — and falls back to the
 * cached head when the network is down.
 */
export async function loadLatestBodyInsight(): Promise<BodyInsightHistoryEntry | null> {
  try {
    const { insight } = await healthApi.latestBodyInsight();
    return insight ? toBodyInsightHistoryEntry(insight) : null;
  } catch {
    const cached = await storageHelpers.getObject<HealthBodyInsight[]>(HEALTH_BODY_INSIGHTS_KEY);
    const rows = Array.isArray(cached) ? cached : [];
    return rows.length > 0 ? toBodyInsightHistoryEntry(rows[0]) : null;
  }
}

/* ==================================================================== */
/* Coach ledger — the receipt for what the coach did                     */
/* ==================================================================== */

/**
 * The commit ledger, newest first.
 *
 * This is the member-facing answer to "what has the coach actually done on my
 * behalf". Every row here is something THEY confirmed: the coach cannot write,
 * so a receipt with no matching confirmation cannot exist.
 *
 * A `pending` row is not a failure to hide. The ledger is claimed BEFORE the
 * diary write, so `pending` means the confirmation was recorded and the write
 * did not finish — the state a retry of the same operation is designed to
 * complete, and one the person is entitled to see rather than have smoothed over.
 */
export async function loadCoachOperations(
  limit: number = COACH_OPERATIONS_LIMIT
): Promise<HealthCoachOperation[]> {
  return readThrough<HealthCoachOperation[]>(
    HEALTH_COACH_OPERATIONS_KEY,
    async () => (await healthAiApi.listCoachOperations(limit)).operations,
    []
  );
}

/** Re-read the ledger into the cache after a commit, ignoring a failure. */
async function refreshCoachOperations(): Promise<void> {
  try {
    const { operations } = await healthAiApi.listCoachOperations(COACH_OPERATIONS_LIMIT);
    await storageHelpers.setObject(HEALTH_COACH_OPERATIONS_KEY, operations);
  } catch {
    // The commit itself succeeded; a stale receipt list is not worth a banner.
  }
}

/**
 * ONE receipt, fetched fresh.
 *
 * Deliberately NOT cached: a per-id key cannot be enumerated by the sign-out
 * clear in `healthCacheKeys.ts`, and a Health key that survives sign-out is the
 * cross-user leak that file exists to prevent. The list above is the cached
 * surface; this is the detail, and it is cheap.
 *
 * Returns null for a missing id, an id belonging to someone else (the Worker
 * answers 404 for both, on purpose) and for a network failure. The caller may
 * not distinguish them in copy — doing so would confirm that an id exists on
 * another account.
 */
export async function loadCoachOperationReceipt(
  operationId: string
): Promise<HealthCoachOperation | null> {
  try {
    return (await healthAiApi.getCoachOperation(operationId)).operation;
  } catch {
    return null;
  }
}

/** Member-facing name for a ledger row's domain. Never the raw column value. */
export function coachOperationTargetLabel(targetType: string): string {
  switch (targetType) {
    case 'water':
      return 'Water';
    case 'weight':
      return 'Weight';
    case 'nutrition':
      return 'Food diary';
    case 'workout':
      return 'Workout';
    case 'period':
      return 'Period day';
    case 'habit':
      return 'Habit';
    default:
      // A target type this build does not know about — a newer Worker, or a row
      // from a later version. Say so plainly rather than printing the column.
      return 'Something else';
  }
}

export const COACH_OPERATION_PENDING_LABEL =
  'Started but not finished — nothing was saved for this one.';

/** Plain words for `commit_status`. No raw server string ever reaches the UI. */
export function coachOperationStatusLabel(operation: HealthCoachOperation): string {
  if (operation.commit_status === 'committed') return 'Saved';
  if (operation.commit_status === 'pending') return COACH_OPERATION_PENDING_LABEL;
  return 'Unknown';
}

/**
 * How many rows the operation wrote, from `result_json` (`{ "ids": [...] }`).
 *
 * A meal can be several diary entries from one confirmation, so the count is
 * worth showing. Returns 0 for a pending row, a malformed blob or a missing one
 * — never a guess.
 */
export function coachOperationEntryCount(operation: HealthCoachOperation): number {
  if (typeof operation.result_json !== 'string') return 0;
  try {
    const parsed: unknown = JSON.parse(operation.result_json);
    const ids = (parsed as { ids?: unknown } | null)?.ids;
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id.length > 0).length : 0;
  } catch {
    return 0;
  }
}

/* ==================================================================== */
/* Error readers                                                         */
/* ==================================================================== */

function httpStatusOf(error: unknown): number | undefined {
  const response = (error as { response?: { status?: unknown } } | null | undefined)?.response;
  const status = response?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * The Worker's own error CODE, never its message.
 *
 * Reading the code is what lets the screen tell "you have not consented" from
 * "your account cannot use AI" — two 403s that need different copy and
 * different next steps. The message is deliberately not used: it is server
 * wording, and the repo-wide rule is that the app owns what the member reads.
 */
function errorCodeOf(error: unknown): string | undefined {
  const data = (error as { response?: { data?: unknown } } | null | undefined)?.response?.data as
    | { error?: { code?: unknown } }
    | undefined;
  const code = data?.error?.code;
  return typeof code === 'string' ? code : undefined;
}
