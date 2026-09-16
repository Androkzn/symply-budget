import { create } from 'zustand';

import { showToast, type ToastOptions } from '@services/toastManager';

import {
  saveBudgetBackupTo,
  type BudgetBackupDestination,
} from './backupDestinations';
import type { BudgetBackupLocation } from './backupFileAccess';
import { recordBudgetBackupSuccessFor } from './backupHistory';
import { ensureBudgetBackupPhrase } from './backupPhrase';

/**
 * The one in-flight budget backup, held outside any screen.
 *
 * Sealing an archive is Argon2 + a full ledger read: seconds, not milliseconds.
 * While it ran, the screen that started it owned the whole story — it awaited
 * the promise, disabled its buttons, and only then said what happened. Navigate
 * away mid-seal and the outcome was told to a screen nobody was looking at.
 *
 * So the run lives here instead:
 *
 *  - starting one never blocks navigation — the caller fires and forgets;
 *  - anything mounted can render "Backing up…" by reading `status`;
 *  - the result arrives as a toast, wherever the member happens to be;
 *  - the phrase, on the ONE run that mints it, is parked in `pendingPhrase`
 *    until the Backup screen can present it — the member may be three screens
 *    away when a slow seal finishes, and words nobody was shown are words
 *    nobody wrote down.
 *
 * Single-flight across manual AND scheduled runs: two concurrent seals would
 * fight over the same destination and the same CPU, and `runBudgetAutoBackupIfDue`
 * already refuses to overlap itself.
 */

export type BudgetBackupTaskKind = 'manual' | 'scheduled';

export type BudgetBackupTaskStatus = 'idle' | 'running' | 'ok' | 'failed';

/**
 * The phrase sheet's whole payload: the words, why it opened, and where the
 * archive those words seal actually landed. `savedTo` rides along rather than
 * being re-derived later because only the run that wrote the file knows the
 * uri, and the member may not reach the Backup screen for another minute.
 */
export type PendingBudgetBackupPhrase = {
  phrase: string;
  intro: string;
  savedTo: BudgetBackupLocation | null;
};

/**
 * What a finished run reports, in the vocabulary both callers already speak.
 *
 * `shared` is its own outcome because it is neither of the two it kept being
 * folded into. It is not `ok` — the OS sheet never says whether the file was
 * saved, so nothing may be recorded as a backup (see `recordBudgetBackupSuccess`)
 * — but it is not `failed` either: the archive sealed, the bytes were handed
 * over, and nothing went wrong. Collapsing it into `failed` put a red ✗ toast
 * reading "Handed to the share sheet." on a run that had just done exactly what
 * was asked of it.
 */
export type BudgetBackupTaskOutcome = {
  status: 'ok' | 'shared' | 'failed' | 'needs_auth' | 'cancelled';
  message: string;
};

type BudgetBackupTaskState = {
  status: BudgetBackupTaskStatus;
  kind: BudgetBackupTaskKind | null;
  destination: BudgetBackupDestination | null;
  startedAt: number | null;
  /** Outcome text of the last finished run — drives the toast and any inline note. */
  message: string | null;
  /**
   * The 12 words a run just MINTED, waiting for the Backup screen to show them.
   * Never toasted, never logged. Set only when the device had no phrase yet:
   * once it has one, the words live on the "Recovery phrase" row and a sheet
   * over every backup would be noise.
   */
  pendingPhrase: PendingBudgetBackupPhrase | null;
};

type BudgetBackupTaskStore = BudgetBackupTaskState & {
  /** Monotonic id of the run holding the slot — 0 when nothing holds it. */
  runId: number;
  begin: (kind: BudgetBackupTaskKind, destination: BudgetBackupDestination | null) => number | null;
  finish: (runId: number, outcome: BudgetBackupTaskOutcome) => boolean;
  setPendingPhrase: (phrase: PendingBudgetBackupPhrase | null) => void;
  reset: () => void;
};

const initial: BudgetBackupTaskState & { runId: number } = {
  status: 'idle',
  kind: null,
  destination: null,
  startedAt: null,
  message: null,
  pendingPhrase: null,
  runId: 0,
};

/**
 * How long a claim may sit before the next run takes the slot from it.
 *
 * A seal is seconds of Argon2, but the promise around it can outlive that by
 * any amount: `saveBudgetBackupTo` awaits the OS share sheet, and a member who
 * swipes away from it (or from an OAuth screen) never resolves it. That is not
 * hypothetical — it happened on device, and every scheduled backup afterwards
 * went silent because the slot still looked busy. Nothing may be able to wedge
 * the slot permanently, so a stale claim is taken over rather than waited on.
 */
const STALE_CLAIM_MS = 5 * 60 * 1000;

export const useBudgetBackupTaskStore = create<BudgetBackupTaskStore>((set, get) => ({
  ...initial,
  begin: (kind, destination) => {
    const current = get();
    if (current.status === 'running') {
      const age = current.startedAt == null ? Infinity : Date.now() - current.startedAt;
      if (age < STALE_CLAIM_MS) return null;
      console.warn('[budget-backup] taking over a stale claim', current.kind, age);
    }
    const runId = current.runId + 1;
    set({
      status: 'running',
      kind,
      destination,
      startedAt: Date.now(),
      message: null,
      runId,
    });
    return runId;
  },
  // Late outcomes from an abandoned run must not overwrite the run that
  // replaced it, nor toast about work nobody is waiting on any more.
  finish: (runId, outcome) => {
    if (get().runId !== runId) return false;
    set({
      // `shared` settles the slot without claiming either way, same as a
      // cancel: the sheet took the bytes and told us nothing, so there is no
      // success to advertise and no failure to accuse the destination of. Its
      // message is kept — unlike a cancel's — because it is worth saying once.
      status:
        outcome.status === 'ok'
          ? 'ok'
          : outcome.status === 'cancelled' || outcome.status === 'shared'
            ? 'idle'
            : 'failed',
      message: outcome.status === 'cancelled' ? null : outcome.message,
    });
    return true;
  },
  setPendingPhrase: (pendingPhrase) => set({ pendingPhrase }),
  reset: () => set(initial),
}));

/** True while a backup is sealing — for a button label or a row subtitle. */
export function isBudgetBackupRunning(): boolean {
  return useBudgetBackupTaskStore.getState().status === 'running';
}

/**
 * Claim the single slot.
 *
 * Returns the run's token, or null when a fresh run already holds it — so the
 * caller can say "already running" instead of starting a second seal.
 */
export function beginBudgetBackupTask(
  kind: BudgetBackupTaskKind,
  destination: BudgetBackupDestination | null = null,
): number | null {
  return useBudgetBackupTaskStore.getState().begin(kind, destination);
}

/**
 * Release the slot and tell the member.
 *
 * A cancelled run (they dismissed the share sheet) is not an outcome worth
 * announcing — it is what they asked for. An outcome from a run that already
 * lost the slot is dropped entirely: stale news, and it would talk over the
 * run that replaced it.
 */
export function finishBudgetBackupTask(runId: number, outcome: BudgetBackupTaskOutcome): void {
  const applied = useBudgetBackupTaskStore.getState().finish(runId, outcome);
  if (!applied || outcome.status === 'cancelled') return;
  // Longer than the 3s default: this is the answer to something the member
  // started minutes ago and then walked away from, so it has to survive them
  // looking back at the screen — and a failure needs to be read, not glimpsed.
  // "Google Drive needs to be reconnected before backups can run" names a
  // problem that can only be fixed on the Backup screen, so the toast has to be
  // the way there. Announced from a scheduled run, the member is wherever they
  // happen to be — usually Home — and left to find that screen through
  // More → Backup & Restore before the banner fades. Most never do, and the
  // backups stay off for as long as the reconnect goes unmade.
  //
  // Spread rather than a trailing `undefined`, so every other outcome makes the
  // same plain three-argument call it always has.
  const reconnect: [ToastOptions] | [] =
    outcome.status === 'needs_auth'
      ? [{ onPress: openBudgetBackupScreen, actionLabel: 'Reconnect' }]
      : [];
  showToast(
    outcome.status === 'ok' ? 'success' : outcome.status === 'shared' ? 'info' : 'error',
    outcome.message,
    6000,
    ...reconnect,
  );
}

/**
 * Required lazily: `@services/navigation` imports `@features/budget`, which
 * re-exports this module — a static import here would close that cycle and
 * leave one of the two half-initialised at require time.
 */
function openBudgetBackupScreen(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nav = require('@services/navigation') as typeof import('@services/navigation');
  nav.navigateToBudgetBackup();
}

/**
 * Take the pending phrase, clearing it — the Backup screen calls this when it
 * is ready to present the sheet, so the words are handed over exactly once.
 */
export function consumeBudgetBackupPhrase(): PendingBudgetBackupPhrase | null {
  const pending = useBudgetBackupTaskStore.getState().pendingPhrase;
  if (pending) useBudgetBackupTaskStore.getState().setPendingPhrase(null);
  return pending;
}

/**
 * Start a manual backup and return immediately.
 *
 * Fire-and-forget by design: the caller closes its sheet and carries on, and
 * the member is free to navigate anywhere while the seal runs.
 *
 * Seals under the DEVICE's phrase (`ensureBudgetBackupPhrase`) rather than
 * minting one per archive. Before this, every tap on "Back up now" produced a
 * new set of twelve words and a sheet demanding they be written down — so a
 * member who backed up weekly accumulated a pile of phrases, could not tell
 * which opened which file, and lost an archive for every slip they mislaid.
 * Scheduled runs had always reused one stored phrase; this is the manual half
 * catching up, and it is why the sheet now appears on the first backup only.
 */
export function startManualBudgetBackup(destination: BudgetBackupDestination): boolean {
  const runId = beginBudgetBackupTask('manual', destination);
  if (runId == null) {
    showToast('info', 'A backup is already running.');
    return false;
  }

  void (async () => {
    try {
      // Minted here at the latest, so the words exist before anything is sealed
      // under them — a phrase that only ever lived inside a failed run would
      // leave a written file nothing on this device could open.
      const { phrase: devicePhrase, created: phraseIsNew } = await ensureBudgetBackupPhrase();
      const result = await saveBudgetBackupTo(destination, { phrase: devicePhrase });
      if (result.status === 'cancelled') {
        finishBudgetBackupTask(runId, { status: 'cancelled', message: result.message });
        return;
      }
      // Only a written file counts. `shared` means the OS sheet was handed the
      // bytes and told us nothing about what happened next, so it is not
      // evidence of a backup — see recordBudgetBackupSuccess.
      if (result.status === 'saved') {
        // Against every household in the bundle, not just the active one — the
        // file protects all of them, and recording it against one would leave
        // the others' status cards saying "No backup yet" over data sitting in
        // that same file.
        await recordBudgetBackupSuccessFor(result.householdIds, {
          at: new Date().toISOString(),
          destination,
          kind: 'manual',
          fileName: result.fileName,
        });
      }
      // Only the run that CREATED the phrase interrupts with it. Every later
      // backup is sealed with words the member has already been shown once and
      // can re-read any time from the "Recovery phrase" row, so a sheet here
      // would be a modal repeating something they were told and did not ask to
      // hear again — which is precisely what made the old per-archive phrase
      // feel like a chore instead of a safeguard.
      if (phraseIsNew) {
        // Park it BEFORE the toast: the toast is what sends the member back to
        // the Backup screen to collect these words.
        useBudgetBackupTaskStore.getState().setPendingPhrase({
          phrase: devicePhrase,
          // Where the file went is `savedTo`'s job now — it renders as a card
          // with its own Open button above this text, so the intro is free to
          // talk about nothing but the words.
          intro:
            'Your backups are sealed with the 12 words below. They are the same every time, so you only have to save them once — this device remembers them, but that copy goes with the phone.',
          savedTo: result.savedTo,
        });
      }
      finishBudgetBackupTask(runId, {
        status:
          result.status === 'saved'
            ? 'ok'
            : result.status === 'shared'
              ? 'shared'
              : result.status === 'needs_auth'
                ? 'needs_auth'
                : 'failed',
        message:
          result.status === 'saved' && phraseIsNew
            ? 'Backup saved — open Backup & Restore for the recovery phrase.'
            : result.message,
      });
    } catch (error) {
      console.error('[budget-backup] manual run threw', error);
      finishBudgetBackupTask(runId, { status: 'failed', message: 'Could not create a backup.' });
    }
  })();

  return true;
}
