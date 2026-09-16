import { create } from 'zustand';

import { showToast } from '@services/toastManager';

import {
  confirmAndRestoreBudgetBackupFile,
  type BudgetRestoreHouseholdOutcome,
  type BudgetRestoreProgress,
  type BudgetRestoreProgressStage,
  type BudgetRestoreSummary,
} from './budgetBackup';
import { rememberRestorePhrase } from './restorePhraseMemory';

/**
 * The one in-flight restore, held outside any screen.
 *
 * Opening an archive is Argon2 plus a full ledger write: minutes on a phone,
 * not seconds. While it ran, the Backup screen owned the whole story — it
 * awaited the promise, kept the progress in `useState`, and only then said what
 * happened. Two things followed from that, both of them bad:
 *
 *  - leaving the screen threw the progress away and reported the outcome to a
 *    screen nobody was looking at, so the only safe advice was "wait here";
 *  - coming back showed a fresh, idle screen while the restore was still
 *    running underneath it.
 *
 * So the run lives here instead, exactly like `backupTaskStore` holds a seal:
 * starting one returns immediately, anything mounted can render live progress
 * by reading this store, and the result arrives as a toast wherever the member
 * happens to be. The Backup screen adds one thing on top — it presents the
 * breakdown parked in `pendingSummary` when it can, because "what did I get
 * back?" deserves more than a toast.
 *
 * Single-flight: two concurrent restores would fight over the same ledger, and
 * the second one would be writing on top of the first one's half-applied state.
 */

export type BudgetRestoreTaskStatus = 'idle' | 'running' | 'ok' | 'failed';

/**
 * What the run is working from.
 *
 * Kept for the lifetime of the task so a wrong phrase can be corrected in
 * place: the archive was read from Drive, Dropbox or a document picker, and
 * making the member go find it again — because they mistyped one word — is a
 * punishment for a typo. Dropped the moment the restore succeeds; the phrase is
 * never logged and never travels through a toast.
 */
export type BudgetRestoreAttempt = {
  archiveJson: string;
  phrase: string;
};

/**
 * How long the fill takes to cross a phone, roughly.
 *
 * Only the UI uses it, and only to ease a bar on the UI thread — a JS-driven
 * bar freezes solid the moment sync Argon2 starts, which is precisely the part
 * that takes minutes. Exported so the screen and the card agree on one number.
 */
export const BUDGET_RESTORE_ESTIMATE_MS = 150_000;

type BudgetRestoreTaskState = {
  status: BudgetRestoreTaskStatus;
  stage: BudgetRestoreProgressStage | null;
  /** 0–1 floor reported by the restore itself — the UI may animate ahead. */
  progress: number;
  /** Stage wording, e.g. "Decrypting…". Frozen while Argon2 holds the thread. */
  label: string;
  startedAt: number | null;
  /** Outcome text of the last finished run — drives the toast and the panel. */
  message: string | null;
  attempt: BudgetRestoreAttempt | null;
  /**
   * A finished run's breakdown, waiting for the Backup screen to present it.
   *
   * The FIRST restored household, for the single-household modal that predates
   * bundles. `pendingOutcomes` is the whole story.
   */
  pendingSummary: BudgetRestoreSummary | null;
  /**
   * Every household the run touched, restored or not.
   *
   * A bundle can land three budgets and fail a fourth, and a single summary has
   * nowhere to say so — the member would see "Restored" and a breakdown of one
   * household while another had silently not come back.
   */
  pendingOutcomes: BudgetRestoreHouseholdOutcome[];
};

type BudgetRestoreTaskStore = BudgetRestoreTaskState & {
  /** Monotonic id of the run holding the slot — 0 when nothing holds it. */
  runId: number;
  begin: (attempt: BudgetRestoreAttempt) => number | null;
  report: (runId: number, update: BudgetRestoreProgress) => void;
  finish: (
    runId: number,
    outcome: {
      status: 'ok' | 'failed';
      message: string;
      summary?: BudgetRestoreSummary | null;
      households?: BudgetRestoreHouseholdOutcome[];
    },
  ) => boolean;
  setPendingSummary: (summary: BudgetRestoreSummary | null) => void;
  clearPendingOutcomes: () => void;
  takeAttempt: () => BudgetRestoreAttempt | null;
  reset: () => void;
};

const initial: BudgetRestoreTaskState & { runId: number } = {
  status: 'idle',
  stage: null,
  progress: 0,
  label: 'Preparing…',
  startedAt: null,
  message: null,
  attempt: null,
  pendingSummary: null,
  pendingOutcomes: [],
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

export const useBudgetRestoreTaskStore = create<BudgetRestoreTaskStore>((set, get) => ({
  ...initial,
  begin: (attempt) => {
    const current = get();
    if (current.status === 'running') {
      const age = current.startedAt == null ? Infinity : Date.now() - current.startedAt;
      if (age < STALE_CLAIM_MS) return null;
      console.warn('[budget-restore] taking over a stale claim', age);
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
      pendingOutcomes: outcome.households ?? [],
    });
    return true;
  },
  setPendingSummary: (pendingSummary) => set({ pendingSummary }),
  clearPendingOutcomes: () => set({ pendingOutcomes: [] }),
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
export function isBudgetRestoreRunning(): boolean {
  return useBudgetRestoreTaskStore.getState().status === 'running';
}

/**
 * Release the slot and tell the member, wherever they are.
 *
 * An outcome from a run that already lost the slot is dropped entirely: stale
 * news, and it would talk over the run that replaced it.
 */
export function finishBudgetRestoreTask(
  runId: number,
  outcome: {
    status: 'ok' | 'failed';
    message: string;
    summary?: BudgetRestoreSummary | null;
    households?: BudgetRestoreHouseholdOutcome[];
  },
): void {
  const applied = useBudgetRestoreTaskStore.getState().finish(runId, outcome);
  if (!applied) return;
  // Longer than the 3s default, for the same reason the backup slot uses 6s:
  // this answers something the member started minutes ago and then walked away
  // from, and a failure needs to be read rather than glimpsed.
  showToast(outcome.status === 'ok' ? 'success' : 'error', outcome.message, 6000);
}

/**
 * Take the parked breakdown, clearing it — the Backup screen calls this when it
 * is ready to present the "Restored" modal, so it is shown exactly once.
 */
export function consumeBudgetRestoreSummary(): BudgetRestoreSummary | null {
  const pending = useBudgetRestoreTaskStore.getState().pendingSummary;
  if (pending) useBudgetRestoreTaskStore.getState().setPendingSummary(null);
  return pending;
}

/**
 * Take the parked per-household outcomes, clearing them — the companion to
 * `consumeBudgetRestoreSummary` for a bundle that restored several budgets.
 */
export function consumeBudgetRestoreOutcomes(): BudgetRestoreHouseholdOutcome[] {
  const pending = useBudgetRestoreTaskStore.getState().pendingOutcomes;
  if (pending.length > 0) useBudgetRestoreTaskStore.getState().clearPendingOutcomes();
  return pending;
}

/**
 * Take back the archive + phrase a failed run was working from, so the phrase
 * panel can reopen with both already filled in. Clears the failure with it —
 * once the member has the field back, the failure is theirs to act on.
 */
export function takeBudgetRestoreAttempt(): BudgetRestoreAttempt | null {
  return useBudgetRestoreTaskStore.getState().takeAttempt();
}

/**
 * Start a restore and return immediately.
 *
 * Fire-and-forget by design: the caller closes its panel and carries on, and
 * the member is free to leave the screen while the archive opens.
 */
export function startBudgetRestore(archiveJson: string, phrase: string): boolean {
  const runId = useBudgetRestoreTaskStore.getState().begin({ archiveJson, phrase });
  if (runId == null) {
    showToast('info', 'A restore is already running.');
    return false;
  }

  void (async () => {
    try {
      // Handles both file shapes: a v3 bundle restores every household in it,
      // a pre-bundle single archive restores its one.
      const result = await confirmAndRestoreBudgetBackupFile(archiveJson, phrase, {
        onProgress: (update) => useBudgetRestoreTaskStore.getState().report(runId, update),
      });
      if (result.status === 'failed') {
        finishBudgetRestoreTask(runId, { status: 'failed', message: result.message });
        return;
      }
      // Only now is the phrase proven — remember it so the next restore on this
      // device does not ask again.
      await rememberRestorePhrase(phrase);
      const landed = result.households.filter(
        (entry) => entry.status === 'restored' || entry.status === 'adopted',
      );
      finishBudgetRestoreTask(runId, {
        status: 'ok',
        // Short enough to toast. The counts live in `summary`/`households`,
        // which the Backup screen presents as the "Restored" modal. A partial
        // restore says so here rather than in the modal alone — the member may
        // never open it.
        message:
          result.status === 'partial'
            ? result.message
            : landed.length > 1
              ? `Restore finished — ${landed.length} budgets are back on this device.`
              : 'Restore finished — your budget is back on this device.',
        summary: landed[0]?.summary ?? null,
        households: result.households,
      });
    } catch (error) {
      console.error('[budget-restore] background run threw', error);
      finishBudgetRestoreTask(runId, { status: 'failed', message: 'Unexpected restore error.' });
    }
  })();

  return true;
}
