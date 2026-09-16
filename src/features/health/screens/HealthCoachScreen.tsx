import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  HEALTH_FLOW_LEVEL_LABELS,
  type HealthCoachOperation,
  type HealthCoachProposal,
  type HealthGroundedInsight,
} from '@api/healthAi';
import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthSectionScreen } from '../components';
import {
  coachOperationEntryCount,
  coachOperationStatusLabel,
  coachOperationTargetLabel,
  confirmProposal,
  clearCoachTranscript,
  dismissProposal,
  generateBodyInsight,
  loadBodyInsightHistory,
  loadCoachConsent,
  loadCoachOperationReceipt,
  loadCoachOperations,
  loadCoachState,
  loadLatestBodyInsight,
  proposalHasExpired,
  sendCoachMessage,
  setCoachConsent,
  type BodyInsightHistoryEntry,
  type CoachMessage,
  type CoachState,
} from '../healthCoachStorage';

/**
 * AI health coach — the donor's `VoiceChat` / Health Coach V2, ported TEXT-FIRST.
 *
 * The donor's coach is 8,057 lines of Swift across seven files, most of it the
 * `Speech` / `AVSpeechSynthesizer` loop and a 22-case command dispatcher. What
 * makes it a coach is separable from what makes it hands-free, and this is the
 * former: one turn in, one grounded answer out, with a confirmable proposal when
 * the person asked to log something. Voice is a later, additive layer — the
 * contract it would drive is already here.
 *
 * ── WHAT THIS SCREEN DOES NOT DO ─────────────────────────────────────────────
 *
 * It does not diagnose, does not grade a condition, does not advise treatment,
 * and does not interpret a symptom back at the person. Exactly the line
 * `HealthInjuriesScreen` holds — that screen deliberately dropped the donor's
 * "Recovery Tips" / RICE card and its ACL/MCL/Meniscus picker, and pinned it
 * with a test. The coach is held to the same one, in three places at once:
 *
 *   1. the system prompt states the limits in words;
 *   2. `coach-safety.ts` matches medical emergencies DETERMINISTICALLY, before
 *      any model call, and answers with a notice that says plainly that nothing
 *      has been contacted on the person's behalf;
 *   3. `composeInsightSpeech` makes the figure layer incapable of stating a
 *      number the person's own data does not hold.
 *
 * ── FAIL CLOSED, VISIBLY ─────────────────────────────────────────────────────
 *
 * There are four states this screen must never blur into each other, because the
 * next step differs in each:
 *
 *   - **not consented** → a card explaining exactly what the coach would read,
 *     and a switch. Nothing is sent until it is on.
 *   - **not entitled** → "AI is not available on this account", and the rest of
 *     the app keeps working. No unlock nag inside the transcript.
 *   - **coach unreachable** → the person's OWN figures still render, under a
 *     banner saying the coach could not be reached. Those figures are arithmetic
 *     over their own rows, not a fabricated answer, so showing them is honest.
 *   - **offline** → the message they typed STAYS on screen, unanswered. A screen
 *     that swallows what someone wrote because the network dropped is worse than
 *     one that shows it waiting.
 */

const CONSENT_TITLE = 'Let the coach read what you have logged';

/**
 * One measurement summary, however it reached the screen.
 *
 * A freshly generated summary and one read back from `body_comprehensive_insights`
 * carry the same prose but not the same envelope — only the fresh one knows how
 * many model sentences were DROPPED for naming an ungrounded number. Rendering
 * both through one model keeps the card from growing two branches that could
 * drift, and `droppedUngrounded: null` says "not known for a stored row" rather
 * than claiming zero.
 */
interface InsightCardModel {
  observations: string[];
  whatToLogNext: string[];
  /** The day the summary describes, or null for one just generated for today. */
  date: string | null;
  /** True when a model wordsmithed the grounded figures. */
  aiWritten: boolean;
  droppedUngrounded: number | null;
}

function storedInsightCard(entry: BodyInsightHistoryEntry): InsightCardModel {
  return {
    observations: entry.observations,
    whatToLogNext: entry.whatToLogNext,
    date: entry.date,
    aiWritten: entry.aiWritten,
    droppedUngrounded: null,
  };
}

function generatedInsightCard(view: {
  observations: string[];
  whatToLogNext: string[];
  aiStatus: 'ok' | 'unavailable';
  droppedUngrounded: number;
}): InsightCardModel {
  return {
    observations: view.observations,
    whatToLogNext: view.whatToLogNext,
    date: null,
    aiWritten: view.aiStatus === 'ok',
    droppedUngrounded: view.droppedUngrounded,
  };
}

/**
 * The disclosure the consent is GIVEN AGAINST. Changing these words means
 * bumping `COACH_CONSENT_VERSION` on the Worker, which re-asks everyone — a
 * consent only means anything against the text it was shown with.
 */
const CONSENT_BODY =
  'To answer, the coach reads the figures you have logged in this app: your food diary, water, weight, the goals you set, and the names of your habits so it can tell whether you have ticked one today. It does not read your cycle log, your vitality diary, your injuries or any photo. Your message and those figures are sent to the AI provider connected to your account.';

/**
 * What the coach can OFFER to write — and the fact that it can only offer.
 *
 * This paragraph is why `COACH_CONSENT_VERSION` moved to `health-coach-2`. The
 * v1 disclosure described reads only, and the coach could log three things; it
 * can now log six, including a period day, which is the single most sensitive
 * row this app stores. Naming the cycle write while the paragraph above still
 * says the coach cannot READ the cycle log is deliberate and both halves are
 * true: it can add a day you describe to it, and it cannot look at the log.
 */
const CONSENT_LOGGING =
  'It can offer to log water, weight, food, a workout, a period day and a habit tick. Every one of those is a suggestion you read and confirm — the coach cannot save anything by itself, and it can never untick a habit or delete anything.';

const CONSENT_LIMITS =
  'The coach is not a clinician. It will not diagnose anything, will not tell you what to take, and will not give you a treatment or recovery plan. For anything medical, ask your doctor.';

export function HealthCoachScreen() {
  const colors = useAppColors();

  const [state, setState] = useState<CoachState>({ messages: [], insights: [], aiStatus: 'idle' });
  const [consented, setConsented] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [insight, setInsight] = useState<InsightCardModel | null>(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightMessage, setInsightMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<BodyInsightHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [operations, setOperations] = useState<HealthCoachOperation[]>([]);
  const [receipt, setReceipt] = useState<HealthCoachOperation | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [receiptMissing, setReceiptMissing] = useState(false);

  const hydrate = useCallback(async () => {
    // The stored summary and the ledger are read on OPEN, not only after an
    // action. Before this, generating a summary showed prose that vanished when
    // the screen closed — the row was in the table the whole time with nothing
    // asking for it — and there was no way at all to see what the coach had
    // logged on the member's behalf.
    const [transcript, consent, latest, stored, ledger] = await Promise.all([
      loadCoachState(),
      loadCoachConsent(),
      loadLatestBodyInsight(),
      loadBodyInsightHistory(),
      loadCoachOperations(),
    ]);
    setState(transcript);
    setConsented(consent.granted);
    setInsight(latest === null ? null : storedInsightCard(latest));
    setHistory(stored);
    setOperations(ledger);
    setLoading(false);
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const handleConsent = async (granted: boolean) => {
    const consent = await setCoachConsent(granted);
    setConsented(consent.granted);
    // An offline grant leaves `granted` false on purpose — only the server may
    // say a consent exists. Say so rather than showing an unlocked coach that
    // 403s on the very next turn.
    if (granted && !consent.granted) {
      setBanner('That could not be saved just now. Try again when you are back online.');
    } else {
      setBanner(null);
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    setDraft('');
    const result = await sendCoachMessage(text);
    setState(result.state);
    setBanner(result.message);
    if (result.status === 'consent_required') setConsented(false);
    setSending(false);
  };

  const handleConfirm = async (message: CoachMessage, proposal: HealthCoachProposal) => {
    setBusyProposalId(message.id);
    const result = await confirmProposal(message.id, proposal);
    setState(result.state);
    setBanner(
      result.outcome === 'saved'
        ? 'Saved.'
        : result.outcome === 'already_saved'
          ? 'That was already saved.'
          : result.message
    );
    // The ledger gained a row (or a pending one it could not finish). Either way
    // the receipt list is now out of date, so re-read it.
    if (result.outcome === 'saved' || result.outcome === 'already_saved') {
      setOperations(await loadCoachOperations());
    }
    setBusyProposalId(null);
  };

  const handleDismiss = async (messageId: string) => {
    setState(await dismissProposal(messageId));
  };

  const handleGenerateInsight = async () => {
    setInsightBusy(true);
    setInsightMessage(null);
    const result = await generateBodyInsight();
    // A failed generate leaves whatever was already on screen: the stored
    // summary is still true, and blanking it because the network dropped would
    // lose the member something they already had.
    if (result.insight !== null) {
      setInsight(generatedInsightCard(result.insight));
      setHistory(await loadBodyInsightHistory());
    }
    setInsightMessage(result.message);
    setInsightBusy(false);
  };

  /**
   * Open (or close) the receipt for one ledger row.
   *
   * The detail is fetched from `GET /ai/coach/operations/:operationId` rather
   * than read off the list row, because that route is the per-operation record
   * of truth and a member checking what happened deserves the live answer, not
   * a possibly-stale cached copy.
   */
  const handleToggleReceipt = async (operationId: string) => {
    if (receiptId === operationId) {
      setReceiptId(null);
      setReceipt(null);
      setReceiptMissing(false);
      return;
    }
    setReceiptId(operationId);
    setReceipt(null);
    setReceiptMissing(false);
    const found = await loadCoachOperationReceipt(operationId);
    // Null covers a missing id, an id on another account and a network failure —
    // the Worker answers the same way for the first two on purpose, so the copy
    // must not try to tell them apart.
    if (found === null) setReceiptMissing(true);
    setReceipt(found);
  };

  const handleClear = async () => {
    setState(await clearCoachTranscript());
    setBanner(null);
  };

  const insights = useMemo(() => state.insights, [state.insights]);

  return (
    <HealthSectionScreen title="Coach" testID="health-coach-screen" loading={loading}>
      {/* Consent — deny by default, and it names exactly what is read. */}
      {consented !== true && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-coach-consent-card"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            BEFORE YOU START
          </Typography>
          <Typography variant="body" color={colors.textPrimary}>
            {CONSENT_TITLE}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary} testID="health-coach-consent-scope">
            {CONSENT_BODY}
          </Typography>
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID="health-coach-consent-logging"
          >
            {CONSENT_LOGGING}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary} testID="health-coach-consent-limits">
            {CONSENT_LIMITS}
          </Typography>
          <Pressable
            onPress={() => void handleConsent(true)}
            accessibilityRole="button"
            accessibilityLabel="Turn on coach insights"
            testID="health-coach-consent-grant"
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          >
            <Typography variant="footnote" weight="semibold" color={colors.white}>
              Turn on coach insights
            </Typography>
          </Pressable>
        </Card>
      )}

      {banner !== null && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-coach-banner"
        >
          <Typography variant="footnote" color={colors.textSecondary} accessibilityLabel={banner}>
            {banner}
          </Typography>
        </Card>
      )}

      {/* The person's own figures. Present in EVERY state, including the one
          where the coach itself could not be reached — they are arithmetic over
          their own rows, not an AI answer. */}
      {insights.length > 0 && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-coach-insights"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            YOUR FIGURES TODAY
          </Typography>
          {state.aiStatus === 'unavailable' && (
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID="health-coach-ai-offline"
            >
              These are your own logged numbers. The coach itself could not be reached.
            </Typography>
          )}
          {insights.map((item) => (
            <InsightRow key={item.id} insight={item} />
          ))}
        </Card>
      )}

      {/* Transcript */}
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-coach-transcript"
      >
        <View style={styles.cardHead}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            CONVERSATION
          </Typography>
          {state.messages.length > 0 && (
            <Pressable
              onPress={() => void handleClear()}
              accessibilityRole="button"
              accessibilityLabel="Clear this conversation"
              testID="health-coach-clear"
            >
              <Typography variant="footnote" weight="semibold" color={colors.primary}>
                Clear
              </Typography>
            </Pressable>
          )}
        </View>

        {state.messages.length === 0 ? (
          <Typography variant="footnote" color={colors.textSecondary} testID="health-coach-empty">
            Ask about what you have logged, or tell it what you just ate or drank and it will
            offer to log it for you. Nothing is saved until you confirm it.
          </Typography>
        ) : (
          state.messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              busy={busyProposalId === message.id}
              onConfirm={() =>
                message.proposal && void handleConfirm(message, message.proposal)
              }
              onDismiss={() => void handleDismiss(message.id)}
            />
          ))
        )}

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask the coach"
            placeholderTextColor={colors.textSecondary}
            multiline
            editable={consented === true && !sending}
            accessibilityLabel="Message the coach"
            testID="health-coach-input"
            style={[
              styles.input,
              styles.composerInput,
              {
                color: colors.textPrimary,
                borderColor: colors.borderColor,
                backgroundColor: colors.backgroundMain,
              },
            ]}
          />
          <Pressable
            onPress={() => void handleSend()}
            disabled={consented !== true || sending || draft.trim().length === 0}
            accessibilityRole="button"
            accessibilityState={{
              disabled: consented !== true || sending || draft.trim().length === 0,
            }}
            accessibilityLabel="Send"
            testID="health-coach-send"
            style={[
              styles.primaryButton,
              {
                backgroundColor:
                  consented !== true || sending || draft.trim().length === 0
                    ? colors.borderColor
                    : colors.primary,
              },
            ]}
          >
            <Typography variant="footnote" weight="semibold" color={colors.white}>
              {sending ? 'Sending…' : 'Send'}
            </Typography>
          </Pressable>
        </View>
      </Card>

      {/* Measurement insight — the producer behind /health/body-insights. */}
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-coach-body-insight"
      >
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          WHAT YOUR MEASUREMENTS SHOW
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} testID="health-coach-body-scope">
          Built from the body measurements you have logged. It reports what moved
          and by how much — no posture score, no body-fat estimate, and no photo
          is involved.
        </Typography>

        {insight !== null && (
          <View style={styles.rowGroup} testID="health-coach-body-observations">
            {insight.date !== null && (
              <Typography
                variant="caption2"
                color={colors.textSecondary}
                testID="health-coach-body-date"
              >
                {`Summary of ${insight.date}`}
              </Typography>
            )}
            {insight.observations.map((line, index) => (
              <Typography
                key={`obs-${index}`}
                variant="body"
                color={colors.textPrimary}
                testID={`health-coach-body-line-${index}`}
              >
                {line}
              </Typography>
            ))}
            {insight.whatToLogNext.length > 0 && (
              <>
                <Typography variant="caption1" color={colors.textSecondary}>
                  To make more of it readable
                </Typography>
                {insight.whatToLogNext.map((line, index) => (
                  <Typography key={`next-${index}`} variant="caption1" color={colors.textSecondary}>
                    {line}
                  </Typography>
                ))}
              </>
            )}
            {!insight.aiWritten && (
              <Typography
                variant="caption2"
                color={colors.textSecondary}
                testID="health-coach-body-deterministic"
              >
                Written from your readings directly — the AI was not available.
              </Typography>
            )}
          </View>
        )}

        {insightMessage !== null && (
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID="health-coach-body-message"
          >
            {insightMessage}
          </Typography>
        )}

        <Pressable
          onPress={() => void handleGenerateInsight()}
          disabled={insightBusy}
          accessibilityRole="button"
          accessibilityState={{ disabled: insightBusy }}
          accessibilityLabel="Summarise my measurements"
          testID="health-coach-body-generate"
          style={[
            styles.secondaryButton,
            { borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
          ]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.primary}>
            {insightBusy ? 'Working…' : insight === null ? 'Summarise my measurements' : 'Refresh'}
          </Typography>
        </Pressable>

        {/* The persisted history. Every one of these was written by the producer
            and has been readable at GET /health/body-insights since P2 with
            nothing on this side asking for it. */}
        {history.length > 1 && (
          <>
            <Pressable
              onPress={() => setHistoryOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: historyOpen }}
              accessibilityLabel={
                historyOpen ? 'Hide earlier summaries' : 'Show earlier summaries'
              }
              testID="health-coach-body-history-toggle"
            >
              <Typography variant="footnote" weight="semibold" color={colors.primary}>
                {historyOpen
                  ? 'Hide earlier summaries'
                  : `Earlier summaries (${history.length - 1})`}
              </Typography>
            </Pressable>
            {historyOpen && (
              <View style={styles.rowGroup} testID="health-coach-body-history">
                {history.slice(1).map((entry) => (
                  <View
                    key={entry.id}
                    style={[styles.historyRow, { borderTopColor: colors.borderColor }]}
                    testID={`health-coach-body-history-${entry.date}`}
                  >
                    <Typography variant="caption2" color={colors.textSecondary}>
                      {entry.date}
                    </Typography>
                    {entry.observations.map((line, index) => (
                      <Typography
                        key={`h-${entry.id}-${index}`}
                        variant="caption1"
                        color={colors.textPrimary}
                      >
                        {line}
                      </Typography>
                    ))}
                    {!entry.aiWritten && (
                      <Typography variant="caption2" color={colors.textSecondary}>
                        Written from your readings directly.
                      </Typography>
                    )}
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </Card>

      {/* The commit ledger — what the coach actually did, and when. */}
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-coach-operations"
      >
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          WHAT THE COACH HAS LOGGED
        </Typography>
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID="health-coach-operations-scope"
        >
          Every row here is something you confirmed. The coach cannot save
          anything on its own, so nothing reaches this list without your tap.
        </Typography>

        {operations.length === 0 ? (
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID="health-coach-operations-empty"
          >
            Nothing yet. When you confirm one of the coach&apos;s suggestions it
            will be listed here.
          </Typography>
        ) : (
          operations.map((operation) => (
            <OperationRow
              key={operation.operation_id}
              operation={operation}
              expanded={receiptId === operation.operation_id}
              receipt={receiptId === operation.operation_id ? receipt : null}
              missing={receiptId === operation.operation_id && receiptMissing}
              onToggle={() => void handleToggleReceipt(operation.operation_id)}
            />
          ))
        )}
      </Card>
    </HealthSectionScreen>
  );
}

/* ==================================================================== */
/* Pieces                                                                */
/* ==================================================================== */

/**
 * What the receipt says was written.
 *
 * Zero is stated plainly rather than omitted: a confirmation that wrote nothing
 * is the pending case, and hiding the line would leave the member reading a
 * receipt for a row that does not exist.
 */
function receiptWroteLine(count: number): string {
  if (count === 0) return 'No entry was written for this one.';
  if (count === 1) {
    return 'Wrote 1 entry, which you can edit or delete on the normal screens.';
  }
  return `Wrote ${count} entries, which you can edit or delete on the normal screens.`;
}

/**
 * One ledger row, with its per-operation receipt underneath when opened.
 *
 * The receipt is the answer to "what did the coach do on my behalf" —
 * `GET /health/ai/coach/operations/:operationId`, which had no caller at all
 * until now. It prints what was written, how many rows it became, and whether
 * the write finished, in that order, because that is the order the questions
 * arrive in.
 *
 * A PENDING row is shown rather than hidden. The ledger is claimed before the
 * diary write, so pending means "you confirmed this and it did not finish" —
 * information the member is entitled to, and the thing that explains a missing
 * entry rather than leaving them to wonder.
 */
function OperationRow({
  operation,
  expanded,
  receipt,
  missing,
  onToggle,
}: {
  operation: HealthCoachOperation;
  expanded: boolean;
  receipt: HealthCoachOperation | null;
  missing: boolean;
  onToggle: () => void;
}) {
  const colors = useAppColors();
  const pending = operation.commit_status !== 'committed';
  const count = coachOperationEntryCount(operation);

  return (
    <View
      style={[styles.bubble, { borderTopColor: colors.borderColor }]}
      testID={`health-coach-operation-${operation.operation_id}`}
    >
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${coachOperationTargetLabel(operation.target_type)} — ${
          expanded ? 'hide details' : 'show details'
        }`}
        testID={`health-coach-operation-toggle-${operation.operation_id}`}
      >
        <Typography variant="body" color={colors.textPrimary}>
          {coachOperationTargetLabel(operation.target_type)}
          {count > 1 ? ` · ${count} entries` : ''}
        </Typography>
        <Typography
          variant="caption2"
          color={pending ? colors.error : colors.textSecondary}
          testID={`health-coach-operation-status-${operation.operation_id}`}
        >
          {coachOperationStatusLabel(operation)}
        </Typography>
      </Pressable>

      {expanded && (
        <View style={styles.rowText} testID="health-coach-operation-receipt">
          {missing ? (
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID="health-coach-operation-receipt-missing"
            >
              That receipt could not be loaded. Try again in a moment.
            </Typography>
          ) : receipt === null ? (
            <Typography variant="caption1" color={colors.textSecondary}>
              Loading…
            </Typography>
          ) : (
            <>
              <Typography variant="caption1" color={colors.textSecondary}>
                {`Confirmed ${receipt.created_at.slice(0, 10)}`}
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                {coachOperationStatusLabel(receipt)}
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                {receiptWroteLine(coachOperationEntryCount(receipt))}
              </Typography>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function InsightRow({ insight }: { insight: HealthGroundedInsight }) {
  const colors = useAppColors();
  return (
    <View style={styles.rowText} testID={`health-coach-insight-${insight.kind}`}>
      <Typography variant="body" color={colors.textPrimary}>
        {insight.speakable}
      </Typography>
      {insight.caveats.map((caveat, index) => (
        <Typography key={`c-${index}`} variant="caption2" color={colors.textSecondary}>
          {caveat}
        </Typography>
      ))}
    </View>
  );
}

function MessageBubble({
  message,
  busy,
  onConfirm,
  onDismiss,
}: {
  message: CoachMessage;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const colors = useAppColors();
  const mine = message.role === 'user';

  return (
    <View
      style={[styles.bubble, { borderTopColor: colors.borderColor }]}
      testID={`health-coach-message-${message.id}`}
    >
      <Typography variant="caption2" color={colors.textSecondary}>
        {mine ? 'You' : 'Coach'}
      </Typography>
      <Typography
        variant="body"
        color={message.escalation === true ? colors.error : colors.textPrimary}
        testID={message.escalation === true ? 'health-coach-escalation' : undefined}
      >
        {message.text}
      </Typography>
      {message.notice != null && (
        <Typography variant="caption2" color={colors.textSecondary}>
          {message.notice}
        </Typography>
      )}
      {message.proposal != null && (
        <ProposalCard
          proposal={message.proposal}
          busy={busy}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
        />
      )}
    </View>
  );
}

/**
 * The confirm card.
 *
 * It prints the figures VERBATIM from the proposal, and confirming sends that
 * proposal back untouched. No field here is editable on purpose: the numbers the
 * person accepts have to be the numbers the coach hashed, and an edited
 * suggestion is a new question rather than a confirmation. The Worker would
 * refuse an altered payload anyway (`payload_hash_mismatch`).
 */
function ProposalCard({
  proposal,
  busy,
  onConfirm,
  onDismiss,
}: {
  proposal: HealthCoachProposal;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const colors = useAppColors();
  const expired = proposalHasExpired(proposal);
  const payload = proposal.normalized_payload;

  return (
    <View
      style={[styles.proposal, { borderColor: colors.borderColor }]}
      testID="health-coach-proposal"
    >
      <View style={styles.proposalHead}>
        <Icon name="review-draft" size={14} color={colors.primary} />
        <Typography variant="caption1" weight="semibold" color={colors.primary}>
          Not saved yet
        </Typography>
      </View>

      {payload.kind === 'water' && (
        <Typography variant="body" color={colors.textPrimary} testID="health-coach-proposal-water">
          {payload.amount_ml} ml of water
        </Typography>
      )}
      {payload.kind === 'weight' && (
        <Typography variant="body" color={colors.textPrimary} testID="health-coach-proposal-weight">
          {payload.weight} {payload.unit}
        </Typography>
      )}
      {payload.kind === 'nutrition' && (
        <View style={styles.rowText} testID="health-coach-proposal-meal">
          {payload.items.map((item, index) => (
            <Typography key={`i-${index}`} variant="body" color={colors.textPrimary}>
              {item.food_name}
              {item.grams === null ? '' : ` · ${item.grams} g`}
              {/* "not known" rather than 0: the coach is told to answer null
                  when it has no reliable figure, and a zero would be a claim. */}
              {item.calories === null ? ' · calories not known' : ` · ${item.calories} kcal`}
            </Typography>
          ))}
          {payload.meal_type !== null && (
            <Typography variant="caption1" color={colors.textSecondary}>
              As {payload.meal_type}
            </Typography>
          )}
        </View>
      )}
      {payload.kind === 'workout' && (
        <View style={styles.rowText} testID="health-coach-proposal-workout">
          <Typography variant="body" color={colors.textPrimary}>
            {payload.workout_type} · {payload.minutes} min
          </Typography>
          {/* "not recorded" rather than 0 kcal: the coach is told to answer null
              unless the person read a burn off a device, and a zero would be a
              claim they never made. Same for effort. */}
          <Typography variant="caption1" color={colors.textSecondary}>
            {payload.calories === null
              ? 'Calories burned not recorded'
              : `${payload.calories} kcal burned`}
          </Typography>
          {payload.intensity !== null && (
            <Typography variant="caption1" color={colors.textSecondary}>
              Felt {payload.intensity}
            </Typography>
          )}
          {payload.note !== null && (
            <Typography variant="caption1" color={colors.textSecondary}>
              {payload.note}
            </Typography>
          )}
        </View>
      )}
      {payload.kind === 'period' && (
        <View style={styles.rowText} testID="health-coach-proposal-period">
          <Typography variant="body" color={colors.textPrimary}>
            Period day · {HEALTH_FLOW_LEVEL_LABELS[payload.flow_level] ?? `Level ${payload.flow_level}`}
          </Typography>
          {payload.notes !== null && (
            <Typography variant="caption1" color={colors.textSecondary}>
              {payload.notes}
            </Typography>
          )}
        </View>
      )}
      {payload.kind === 'habit' && (
        <View style={styles.rowText} testID="health-coach-proposal-habit">
          <Typography variant="body" color={colors.textPrimary}>
            Tick {payload.habit_name} for today
          </Typography>
          {/* Says what it CANNOT do, because a toggle that could untick would be
              a destructive write behind a button labelled "log". The server
              enforces this; the card states it. */}
          <Typography variant="caption1" color={colors.textSecondary}>
            This only marks it done. It can never untick a habit.
          </Typography>
        </View>
      )}

      {expired ? (
        <Typography variant="caption1" color={colors.textSecondary} testID="health-coach-proposal-expired">
          This suggestion has expired. Ask again and confirm the new one.
        </Typography>
      ) : (
        <View style={styles.formActions}>
          <Pressable
            onPress={onConfirm}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            accessibilityLabel="Confirm and save this"
            testID="health-coach-proposal-confirm"
            style={[
              styles.primaryButton,
              { backgroundColor: busy ? colors.borderColor : colors.primary },
            ]}
          >
            <Typography variant="footnote" weight="semibold" color={colors.white}>
              {busy ? 'Saving…' : 'Confirm and save'}
            </Typography>
          </Pressable>
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss this suggestion"
            testID="health-coach-proposal-dismiss"
            style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
          >
            <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
              Not now
            </Typography>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  rowGroup: {
    gap: Spacing.xs,
  },
  rowText: {
    gap: 2,
  },
  bubble: {
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  historyRow: {
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  proposal: {
    marginTop: Spacing.xs,
    padding: Spacing.md,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  proposalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  composer: {
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  composerInput: {
    minHeight: 72,
    paddingTop: Spacing.sm,
    textAlignVertical: 'top',
  },
  formActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  primaryButton: {
    flex: 1,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
