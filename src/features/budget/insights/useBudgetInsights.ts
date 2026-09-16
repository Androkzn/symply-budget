/**
 * The dashboard's Insights card, as a policy rather than a pile of effects.
 *
 * WHAT WENT WRONG
 * ---------------
 * The card used to regenerate on every signal that "something happened":
 * every screen focus, and every `dataRevision` bump — with `forceRefresh: true`,
 * which skips the cache on BOTH transports. `dataRevision` is bumped by any
 * local edit, by the chat mutation bridge, and by the ledger-refresh bridge on
 * every merged peer op / restore / enrolment. A single sync burst therefore
 * produced a burst of model calls, none of them deduplicated, each resolving a
 * second or two after the last — so the member watched the card rewrite itself
 * ten times while they were just scrolling the page.
 *
 * THE RULE
 * --------
 * Regenerate when, and only when, the month's numbers changed. The backend
 * already works this way (`budget_insights.input_hash`); this hook is the
 * client-side equivalent, so the rule holds for the local-first transport too —
 * where a generation is not just latency but a call billed to the member's own
 * provider key.
 *
 * FOUR GUARDS, IN ORDER
 * ---------------------
 * 1. FINGERPRINT — the answer is cached under `budgetInsightsFingerprint(overview)`.
 *    An unchanged month reuses it forever; no call is made at all.
 * 2. DEBOUNCE — a burst of merges walks the overview through intermediate
 *    states. Only the state it settles in is worth summarizing.
 * 3. SINGLE-FLIGHT — one generation per household+period at a time, process-wide,
 *    so concurrent callers (two mounted views, a focus racing a revision bump)
 *    share one call instead of stacking.
 * 4. STALE-GUARD — a late answer is dropped unless it is still the newest
 *    request for the month on screen. This is what stops the visible rewriting.
 *
 * A failed automatic generation is not retried for the same fingerprint: a
 * rejected provider key would otherwise re-fail on every revision bump for the
 * rest of the session. The member's own Refresh always overrides all of it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { budgetApi, type BudgetInsights, type MonthlyOverview } from '@api/budget';
import { useBudgetStore } from '@stores/budgetStore';

import { budgetInsightsFingerprint } from './budgetInsightsFingerprint';

/**
 * Trailing window before an existing answer is REPLACED automatically. Long
 * enough to swallow a sync burst (the ledger bridge coalesces at 120ms, then
 * each merge reloads the overview), short enough that the member's own edit
 * feels answered. The first answer for a month is never delayed by it.
 */
export const INSIGHTS_AUTO_DEBOUNCE_MS = 1500;

/** Manual refreshes and cache misses of a month whose overview never loaded. */
const UNKNOWN_FINGERPRINT = 'unknown';

type InFlight = { promise: Promise<BudgetInsights> };

/** Process-wide, so two mounted dashboards can't both generate the same month. */
const inFlight = new Map<string, InFlight>();

function periodKey(householdId: string, period: string): string {
  return `${householdId}|${period}`;
}

/** Test seam — module state outlives a test's render tree. */
export function __resetBudgetInsightsInFlight(): void {
  inFlight.clear();
}

/**
 * One generation per household+period at a time. A caller that arrives while
 * another is running joins it rather than starting a second; if its inputs have
 * since moved on, the hook's fingerprint check simply schedules another pass
 * once this one settles.
 */
function singleFlight(key: string, run: () => Promise<BudgetInsights>): Promise<BudgetInsights> {
  const existing = inFlight.get(key);
  if (existing) return existing.promise;

  const promise = run();
  inFlight.set(key, { promise });
  // Detached settle-handler: the returned promise still carries the rejection
  // to the caller, this one only clears the slot (and swallows its own copy so
  // it is never an unhandled rejection).
  void promise.then(
    () => {
      if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
    },
    () => {
      if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
    },
  );
  return promise;
}

export interface UseBudgetInsightsArgs {
  householdId?: string;
  year: number;
  month: number;
  /**
   * The month the card is summarizing. Insights follow the overview rather than
   * fetching their own copy — that is what makes "did anything change?"
   * answerable without a round trip. Null while it loads: nothing is generated
   * until the numbers are known.
   */
  overview: MonthlyOverview | null;
  /** False on minimal-budget brands, which have no Insights card. */
  enabled?: boolean;
  /** Called only for a member-initiated Refresh — automatic failures stay silent. */
  onRefreshError?: (error: unknown) => void;
}

export interface UseBudgetInsightsResult {
  /** The month's answer — the cached one until a newer generation lands. */
  insights: BudgetInsights | null;
  /** True while a generation is in flight; the previous answer stays on screen. */
  loading: boolean;
  /** The Refresh control: always regenerates, whatever the fingerprint says. */
  refresh: () => void;
}

export function useBudgetInsights({
  householdId,
  year,
  month,
  overview,
  enabled = true,
  onRefreshError,
}: UseBudgetInsightsArgs): UseBudgetInsightsResult {
  const cacheInsights = useBudgetStore((s) => s.cacheInsights);
  const getCachedInsights = useBudgetStore((s) => s.getCachedInsights);
  // Held in a ref rather than listed as dependencies. These are stable store
  // actions, but an effect that re-runs on a FUNCTION identity is precisely the
  // shape of bug this hook exists to remove — one unstable caller would put
  // generation back on a per-render footing. The effects below fire on data.
  const storeRef = useRef({ cacheInsights, getCachedInsights });
  storeRef.current = { cacheInsights, getCachedInsights };

  const period = `${year}-${String(month).padStart(2, '0')}`;
  // Memoized on the loaded month: a reload hands over a new object with the same
  // contents (that is the common case), and hashing every row on every render of
  // a screen this size would be a waste even though the result is identical.
  const fingerprint = useMemo(
    () => (overview ? budgetInsightsFingerprint(overview) : null),
    [overview],
  );

  const [insights, setInsights] = useState<BudgetInsights | null>(null);
  const [loading, setLoading] = useState(false);

  // Whether the card currently shows an answer — read inside effects to tell a
  // first generation (immediate) from a replacement (debounced), without making
  // the answer itself a dependency of the decision.
  const hasAnswerRef = useRef(false);
  const applyInsights = useCallback((next: BudgetInsights | null) => {
    hasAnswerRef.current = !!next;
    setInsights(next);
  }, []);

  // Held in a ref, not a dependency: callers pass an inline handler, and a
  // handler that changes identity every render would reschedule the debounce
  // every render — which is to say, never let it fire.
  const onRefreshErrorRef = useRef(onRefreshError);
  onRefreshErrorRef.current = onRefreshError;

  // What the newest request was issued for. A response is applied only if all
  // three still match — the month may have been swapped, or a newer generation
  // started, while it was in flight.
  const requestRef = useRef({ id: 0, key: '' });
  const targetRef = useRef({ householdId, period });
  targetRef.current = { householdId, period };

  // Fingerprints whose automatic generation already failed. Cleared by any new
  // fingerprint or by a manual refresh.
  const failedRef = useRef(new Set<string>());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPending = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const generate = useCallback(
    async (opts: { force: boolean; fingerprint: string | null; manual: boolean }) => {
      const hid = targetRef.current.householdId;
      const forPeriod = targetRef.current.period;
      if (!hid) return;

      const key = periodKey(hid, forPeriod);
      const id = requestRef.current.id + 1;
      requestRef.current = { id, key };
      setLoading(true);

      try {
        const data = await singleFlight(key, () =>
          budgetApi.getInsights(hid, year, month, opts.force),
        );
        // Stale-guard: the month on screen moved, or a newer generation for it
        // has started. Dropping the answer here is what keeps the card still.
        if (requestRef.current.id !== id || targetRef.current.householdId !== hid) return;
        if (targetRef.current.period !== forPeriod) return;

        applyInsights(data);
        storeRef.current.cacheInsights(
          hid,
          forPeriod,
          data,
          opts.fingerprint ?? UNKNOWN_FINGERPRINT,
        );
        failedRef.current.delete(opts.fingerprint ?? UNKNOWN_FINGERPRINT);
      } catch (error) {
        console.error('Error loading budget insights:', error);
        // Don't re-ask a provider that just refused for inputs it already saw.
        if (opts.fingerprint) failedRef.current.add(opts.fingerprint);
        if (opts.manual) onRefreshErrorRef.current?.(error);
      } finally {
        if (requestRef.current.id === id) setLoading(false);
      }
    },
    [applyInsights, month, year],
  );

  // Month / household switch: adopt that month's cached answer immediately (or
  // nothing) so the card never lingers on the previous month's prose, and drop
  // any pending generation aimed at the month we just left.
  useEffect(() => {
    cancelPending();
    applyInsights(
      householdId ? storeRef.current.getCachedInsights(householdId, period) : null,
    );
  }, [applyInsights, cancelPending, householdId, period]);

  // The decision. Runs whenever the month's fingerprint moves — which is the
  // only thing that can justify a new generation.
  useEffect(() => {
    if (!enabled || !householdId || !fingerprint) return;

    const cached = storeRef.current.getCachedInsights(householdId, period);
    if (cached?.inputHash === fingerprint) {
      // Nothing changed — keep the previous answer, ask nobody.
      cancelPending();
      applyInsights(cached);
      return;
    }
    if (failedRef.current.has(fingerprint)) return;

    cancelPending();
    // Nothing on screen yet — the member is looking at an empty card, so the
    // first answer for the month is asked for straight away. The debounce
    // exists to stop a settling month from REPLACING an answer repeatedly;
    // there is nothing to replace here.
    if (!hasAnswerRef.current) {
      void generate({ force: false, fingerprint, manual: false });
      return;
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void generate({ force: false, fingerprint, manual: false });
    }, INSIGHTS_AUTO_DEBOUNCE_MS);

    return cancelPending;
  }, [applyInsights, cancelPending, enabled, fingerprint, generate, householdId, period]);

  useEffect(() => cancelPending, [cancelPending]);

  const refresh = useCallback(() => {
    if (!householdId) return;
    cancelPending();
    if (fingerprint) failedRef.current.delete(fingerprint);
    void generate({ force: true, fingerprint, manual: true });
  }, [cancelPending, fingerprint, generate, householdId]);

  return { insights, loading, refresh };
}
