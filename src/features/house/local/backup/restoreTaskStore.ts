import { create } from 'zustand';

import { showToast } from '@services/toastManager';

import { HOUSE_ALL_HOMES_ID } from './allHomes';
import {
  confirmAndRestoreHouseBackup,
  type HouseBackupSummary,
  type HouseRestoreHouseholdResult,
  type HouseRestoreProgress,
  type HouseRestoreProgressStage,
} from './houseBackup';
import { rememberRestorePhrase } from './restorePhraseMemory';

/**
 * The one in-flight House restore, held outside any screen.
 *
 * Ported from `budget/local/backup/restoreTaskStore.ts`. Opening an archive is
 * Argon2 plus a full ledger write: minutes on a phone, not seconds. While it
 * ran, the Backup screen owned the whole story — it awaited the promise, kept
 * the progress in `useState`, and only then said what happened. Two things
 * followed from that, both of them bad:
 *
 *  - leaving the screen threw the progress away and reported the outcome to a
 *    screen nobody was looking at, so the only safe advice was "wait here";
 *  - coming back showed a fresh, idle screen while the restore was still
 *    running underneath it.
 *
 * So the run lives here instead, exactly like `backupTaskStore` holds a seal.
 * The Backup screen adds one thing on top — it presents the breakdown parked in
 * `pendingSummary` when it can, because "what did I get back?" deserves more
 * than a toast.
 *
 * Single-flight: two concurrent restores would fight over the same ledger, and
 * the second one would be writing on top of the first one's half-applied state.
 */

export type HouseRestoreTaskStatus = 'idle' | 'running' | 'ok' | 'failed';

/**
 * What the run is working from.
 *
 * Kept for the lifetime of the task so a wrong phrase can be corrected in
 * place: the archive was read from Drive, Dropbox or a document picker, and
 * making the member go find it again — because they mistyped one word — is a
 * punishment for a typo. Dropped the moment the restore succeeds; the phrase is
 * never logged and never travels through a toast.
 */
export type HouseRestoreAttempt = {
  archiveJson: string;
  phrase: string;
  /** Which home the run is writing into, and whether it was told to replace. */
  householdId: string | null;
  allowHouseholdReplace: boolean;
};

/**
 * How long the fill takes to cross a phone, roughly.
 *
 * Only the UI uses it, and only to ease a bar on the UI thread — a JS-driven
 * bar freezes solid the moment sync Argon2 starts, which is precisely the part
 * that takes minutes. Exported so the screen and the card agree on one number.
 */
export const HOUSE_RESTORE_ESTIMATE_MS = 150_000;

type HouseRestoreTaskState = {
  status: HouseRestoreTaskStatus;
  stage: HouseRestoreProgressStage | null;
  /** 0–1 floor reported by the restore itself — the UI may animate ahead. */
  progress: number;
  /** Stage wording, e.g. "Decrypting…". Frozen while Argon2 holds the thread. */
  label: string;
  startedAt: number | null;
  /** Outcome text of the last finished run — drives the toast and the panel. */
  message: string | null;
  attempt: HouseRestoreAttempt | null;
  /** A finished run's breakdown, waiting for the Backup screen to present it. */
  pendingSummary: HouseBackupSummary | null;
  /**
   * What happened to each home in the file, restored or not.
   *
   * Separate from `pendingSummary` because it is the only place a SKIPPED home
   * appears: the summary describes what came back, and a backup that held three
   * homes and could only place two has to be able to say which one it could not.
   * One entry for a per-home archive.
   */
  pendingHouseholds: HouseRestoreHouseholdResult[] | null;
};

/** A finished restore's whole story, handed to the screen exactly once. */
export type HouseRestoreOutcome = {
  summary: HouseBackupSummary;
  households: HouseRestoreHouseholdResult[];
};

type HouseRestoreTaskStore = HouseRestoreTaskState & {
  /** Monotonic id of the run holding the slot — 0 when nothing holds it. */
  runId: number;
  begin: (attempt: HouseRestoreAttempt) => number | null;
  report: (runId: number, update: HouseRestoreProgress) => void;
  finish: (
    runId: number,
    outcome: {
      status: 'ok' | 'failed';
      message: string;
      summary?: HouseBackupSummary | null;
      households?: HouseRestoreHouseholdResult[] | null;
    },
  ) => boolean;
  setPendingSummary: (summary: HouseBackupSummary | null) => void;
  takeAttempt: () => HouseRestoreAttempt | null;
  reset: () => void;
};

const initial: HouseRestoreTaskState & { runId: number } = {
  status: 'idle',
  stage: null,
  progress: 0,
  label: 'Preparing…',
  startedAt: null,
  message: null,
  attempt: null,
  pendingSummary: null,
  pendingHouseholds: null,
  runId: 0,
};

/**
 * How long a claim may sit before the next run takes the slot from it.
 *
 * Generous on purpose: a legacy-KDF archive on an old phone genuinely runs for
 * minutes, and taking the slot from a live restore would start a second one
 * writing into the same ledger. Long enough that only a run which died without
 * settling — a JS crash between two awaits — is ever displaced.
 */
const STALE_CLAIM_MS = 15 * 60 * 1000;

export const useHouseRestoreTaskStore = create<HouseRestoreTaskStore>((set, get) => ({
  ...initial,
  begin: (attempt) => {
    const current = get();
    if (current.status === 'running') {
      const age = current.startedAt == null ? Infinity : Date.now() - current.startedAt;
      if (age < STALE_CLAIM_MS) return null;
      console.warn('[house-restore] taking over a stale claim', age);
    }
    const runId = current.runId + 1;
    set({
      status: 'running',
      stage: 'preparing',
      progress: 0,
      label: 'Preparing…',
      startedAt: Date.now(),
      message: null,
      attempt,
      runId,
    });
    return runId;
  },
  // Progress from a run that already lost the slot would drag the live run's
  // bar backwards, so it is dropped like a late outcome.
  report: (runId, update) => {
    if (get().runId !== runId) return;
    set({ stage: update.stage, progress: update.progress, label: update.message });
  },
  finish: (runId, outcome) => {
    if (get().runId !== runId) return false;
    set({
      status: outcome.status,
      progress: outcome.status === 'ok' ? 1 : get().progress,
      message: outcome.message,
      // Success ends the attempt: the archive is applied and the phrase has no
      // further business sitting in memory. A failure keeps it, so the panel can
      // come back with the words already in the field.
      attempt: outcome.status === 'ok' ? null : get().attempt,
      pendingSummary: outcome.summary ?? null,
      pendingHouseholds: outcome.households ?? null,
    });
    return true;
  },
  setPendingSummary: (pendingSummary) =>
    set(pendingSummary ? { pendingSummary } : { pendingSummary: null, pendingHouseholds: null }),
  takeAttempt: () => {
    const { attempt, status } = get();
    if (!attempt) return null;
    // Handing the attempt back to a screen is the end of the failed run: the
    // member owns it again, and the status has nothing left to report.
    set({ attempt: null, status: status === 'failed' ? 'idle' : status, message: null });
    return attempt;
  },
  reset: () => set(initial),
}));

/** True while a restore is running — for a disabled control or a status line. */
export function isHouseRestoreRunning(): boolean {
  return useHouseRestoreTaskStore.getState().status === 'running';
}

/**
 * Release the slot and tell the member, wherever they are.
 *
 * An outcome from a run that already lost the slot is dropped entirely: stale
 * news, and it would talk over the run that replaced it.
 */
export function finishHouseRestoreTask(
  runId: number,
  outcome: {
    status: 'ok' | 'failed';
    message: string;
    summary?: HouseBackupSummary | null;
    households?: HouseRestoreHouseholdResult[] | null;
  },
): void {
  const applied = useHouseRestoreTaskStore.getState().finish(runId, outcome);
  if (!applied) return;
  showToast(outcome.status === 'ok' ? 'success' : 'error', outcome.message, 6000);
}

/**
 * Take the parked breakdown, clearing it — the Backup screen calls this when it
 * is ready to present the "Restored" modal, so it is shown exactly once.
 *
 * Both halves travel together (and are cleared together): the totals, and what
 * happened to each home in the file. Handing back only the totals is how a
 * skipped home becomes invisible.
 */
export function consumeHouseRestoreSummary(): HouseRestoreOutcome | null {
  const { pendingSummary, pendingHouseholds } = useHouseRestoreTaskStore.getState();
  if (!pendingSummary) return null;
  useHouseRestoreTaskStore.getState().setPendingSummary(null);
  return { summary: pendingSummary, households: pendingHouseholds ?? [] };
}

/**
 * Take back the archive + phrase a failed run was working from, so the phrase
 * panel can reopen with both already filled in. Clears the failure with it —
 * once the member has the field back, the failure is theirs to act on.
 */
export function takeHouseRestoreAttempt(): HouseRestoreAttempt | null {
  return useHouseRestoreTaskStore.getState().takeAttempt();
}

/**
 * Start a restore and return immediately.
 *
 * Fire-and-forget by design: the caller closes its panel and carries on, and
 * the member is free to leave the screen while the archive opens.
 *
 * `allowHouseholdReplace` is NOT defaulted to true the way Budget's is. Budget
 * passes it so a D1→local migration archive can adopt the open ledger; House
 * holds 1–3 homes at once (H5), so an archive whose household id differs is
 * usually the cabin's file picked while the house is open — a mis-tap, and one
 * that mixes two homes' rows irreversibly if it is waved through. The screen
 * asks first and passes the answer here.
 */
export function startHouseRestore(
  archiveJson: string,
  phrase: string,
  options: { householdId?: string | null; allowHouseholdReplace?: boolean } = {},
): boolean {
  const attempt: HouseRestoreAttempt = {
    archiveJson,
    phrase,
    householdId: options.householdId ?? null,
    allowHouseholdReplace: options.allowHouseholdReplace === true,
  };
  const runId = useHouseRestoreTaskStore.getState().begin(attempt);
  if (runId == null) {
    showToast('info', 'A restore is already running.');
    return false;
  }

  void (async () => {
    try {
      const result = await confirmAndRestoreHouseBackup(archiveJson, phrase, {
        ...(attempt.householdId ? { householdId: attempt.householdId } : {}),
        allowHouseholdReplace: attempt.allowHouseholdReplace,
        onProgress: (update) => useHouseRestoreTaskStore.getState().report(runId, update),
      });
      if (result.status !== 'ok') {
        finishHouseRestoreTask(runId, { status: 'failed', message: result.message });
        return;
      }
      // Only now is the phrase proven — remember it so the next restore on this
      // device does not ask again. Filed against every home the file actually
      // put back: a whole-device archive opens all of them with these same
      // words, and remembering it under only the first would make the next
      // restore of the cabin ask again for a phrase it already knows.
      const sections = result.households ?? [];
      const restoredIds = sections
        .filter((entry) => entry.status === 'restored')
        .map((entry) => entry.householdId);
      const rememberFor: Array<string | undefined> =
        restoredIds.length > 0 ? [...restoredIds] : [result.summary?.householdId];
      // A whole-device file is also reached by its own pseudo-id, which is what
      // the restore panel looks the phrase up under when the member picks that
      // file again.
      if (sections.length > 1) rememberFor.push(HOUSE_ALL_HOMES_ID);
      for (const householdId of rememberFor) {
        await rememberRestorePhrase(phrase, householdId);
      }
      finishHouseRestoreTask(runId, {
        status: 'ok',
        // Short enough to toast, and names any home the file could NOT put back.
        // The counts live in `summary`, which the Backup screen presents as the
        // "Restored" modal.
        message: result.message,
        summary: result.summary ?? null,
        households: result.households ?? null,
      });
    } catch (error) {
      console.error('[house-restore] background run threw', error);
      finishHouseRestoreTask(runId, { status: 'failed', message: 'Unexpected restore error.' });
    }
  })();

  return true;
}
