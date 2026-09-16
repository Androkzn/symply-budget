/**
 * useGarbageDayInference — "when does my garbage go out?", answered on device.
 *
 * **What this replaces.** `garbageCollectionApi.aiDetect` asks a Worker to read
 * a municipal website (and, historically, a photo of the bins) on the
 * household's behalf. On a local-first build that Worker holds ciphertext and
 * the local api throws `HouseLocalUnsupportedError('garbage-collection.aiDetect')`
 * — so the "Find My Schedule" sheet had exactly one outcome: an error state.
 *
 * The P2 ladder has a better answer than an apology, and it was already built
 * and tested with no caller: `inferGarbageDay` (plan §9). It runs
 *
 *   - **Stage A** — deterministic expansion of the streams the member saved.
 *     No key, no network, no provider. This is the majority case.
 *   - **Stage B** — the member's own provider key infers the usual pattern for
 *     their municipality, and only the municipality name leaves the device (the
 *     street address lives on a table the egress allowlist forbids).
 *   - **Stage C** — `getHouseAiUnavailableCopy(reason)`, the deliberate
 *     member-facing sentence, never a raw provider error and never a method
 *     identifier (DoD H7).
 *
 * **Why a callback and not a `useQuery`.** The sheet runs detection on open and
 * again on "Try Again", and must not re-run because a cache went stale behind a
 * closed sheet. So this hook owns the wiring — flag gate, ledger read, ladder,
 * projection — and hands back one `detect()` the screen calls when it means it.
 *
 * **`null` means "not my path".** A non-local-first brand or build gets `null`
 * from `detect()` and the caller falls through to the server exactly as before.
 * That is deliberately not an error: there is nothing wrong with the server path
 * on the builds that still have a server holding plaintext.
 */
import { useCallback } from 'react';

import type { DetectedGarbageSchedule } from '@api/garbage-collection';
import {
  getHouseAiUnavailableCopy,
  getLocalHouseLedgerFor,
  inferGarbageDay,
  isHouseLocalFirst,
  type GarbageDayAnswer,
  type HouseAiUnavailableReason,
} from '@features/house/local';

/** What the sheet needs to render, with no ladder vocabulary left in it. */
export type GarbageDayInferenceOutcome =
  | {
      status: 'found';
      /** Shaped like the server's detect draft so the sheet renders one way. */
      draft: DetectedGarbageSchedule;
      answer: GarbageDayAnswer;
    }
  | {
      /** The ladder ran out of rungs. `title`/`message` are member-facing. */
      status: 'unavailable';
      title: string;
      message: string;
      /**
       * Which rung ran out. The screen offers the "Add AI provider" route on
       * `no_key` — that reason IS "you have not connected one yet", and an
       * explanation with no way to act on it is what made this read as broken.
       */
      reason: HouseAiUnavailableReason;
    };

/**
 * Confidence, mapped honestly rather than generously.
 *
 * Stage A is the member's own saved schedule expanded by the same code the
 * Worker used to run — there is nothing to be uncertain about, so `1`. Stage B
 * is a model's guess at a municipal pattern, which the sheet must show as
 * "Best guess — please verify": `0.5` lands in that band deliberately.
 */
const CONFIDENCE: Record<GarbageDayAnswer['source'], number> = {
  schedule: 1,
  assistant: 0.5,
};

/**
 * Project a ladder answer into the sheet's existing draft shape.
 *
 * `addressSpecific` is false on both paths and that is not a hedge: Stage A
 * expands what the member typed for their whole property and Stage B only ever
 * saw a municipality name, so neither is address-derived. Saying otherwise would
 * suppress the sheet's "double-check it matches your street" line.
 *
 * `municipality` is carried through from the ledger row rather than left null.
 * The sheet's save path writes `draft.municipality || 'Unknown'`, so dropping it
 * would quietly overwrite the town the member typed with the word "Unknown".
 */
export function toDetectedSchedule(
  answer: GarbageDayAnswer,
  municipality: string | null,
): DetectedGarbageSchedule {
  return {
    municipality,
    schedules: answer.streams,
    setOutTime: null,
    confidence: CONFIDENCE[answer.source],
    addressSpecific: false,
    notes: answer.summary,
    sources: [],
  };
}

export type UseGarbageDayInference = {
  /** True when `detect()` will do anything at all. */
  enabled: boolean;
  /**
   * Run the ladder for this property. Resolves `null` when this build is not
   * local-first, which is the caller's signal to use the server path.
   */
  detect: (householdId: string) => Promise<GarbageDayInferenceOutcome | null>;
};

export function useGarbageDayInference(): UseGarbageDayInference {
  const enabled = isHouseLocalFirst();

  const detect = useCallback(
    async (householdId: string): Promise<GarbageDayInferenceOutcome | null> => {
      if (!enabled) return null;

      const ledger = await getLocalHouseLedgerFor(householdId);
      const result = await inferGarbageDay({ ledger, householdId });

      if (result.stage === 'C') {
        const copy = getHouseAiUnavailableCopy(result.reason);
        return {
          status: 'unavailable',
          title: copy.title,
          message: copy.message,
          reason: result.reason,
        };
      }

      // Same row `inferGarbageDay` reasoned from — matched on household first so
      // a multi-property device cannot label one home with another's town.
      const rows = ledger.garbageSchedules ?? [];
      const row = rows.find((r) => r.household_id === householdId) ?? rows[0];
      const draft = toDetectedSchedule(result.value, row?.municipality ?? null);
      return { status: 'found', draft, answer: result.value };
    },
    [enabled],
  );

  return { enabled, detect };
}
