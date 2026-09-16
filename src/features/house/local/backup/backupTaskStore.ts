import { create } from 'zustand';

import type { BackupLocation } from '@services/backup/backupFileAccess';
import { showToast, type ToastOptions } from '@services/toastManager';

import { saveHouseBackupTo, type HouseBackupDestination } from './backupDestinations';
import { recordHouseBackupSuccess } from './backupHistory';

/**
 * The one in-flight House backup, held outside any screen.
 *
 * Ported from `budget/local/backup/backupTaskStore.ts`. Sealing an archive is
 * Argon2 plus a full ledger read: seconds, not milliseconds. While it ran, the
 * screen that started it owned the whole story — it awaited the promise,
 * disabled its buttons, and only then said what happened. Navigate away
 * mid-seal and the outcome was told to a screen nobody was looking at.
 *
 * So the run lives here instead:
 *
 *  - starting one never blocks navigation — the caller fires and forgets;
 *  - anything mounted can render "Backing up…" by reading `status`;
 *  - the result arrives as a toast, wherever the member happens to be;
 *  - a manual run's fresh phrase is parked in `pendingPhrase` until the Backup
 *    screen can present it, because that phrase is shown exactly once and
 *    losing it would mean losing the archive it sealed.
 *
 * Single-flight across manual AND scheduled runs: two concurrent seals would
 * fight over the same destination and the same CPU, and `runHouseAutoBackupIfDue`
 * already refuses to overlap itself.
 */

export type HouseBackupTaskKind = 'manual' | 'scheduled';

export type HouseBackupTaskStatus = 'idle' | 'running' | 'ok' | 'failed';

/**
 * The phrase sheet's whole payload: the words, why it opened, and where the
 * archive those words seal actually landed. `savedTo` rides along rather than
 * being re-derived later because only the run that wrote the file knows the
 * uri, and the member may not reach the Backup screen for another minute.
 */
export type PendingHouseBackupPhrase = {
  phrase: string;
  intro: string;
  savedTo: BackupLocation | null;
};

/** What a finished run reports, in the vocabulary both callers already speak. */
export type HouseBackupTaskOutcome = {
  status: 'ok' | 'failed' | 'needs_auth' | 'cancelled';
  message: string;
};

type HouseBackupTaskState = {
  status: HouseBackupTaskStatus;
  kind: HouseBackupTaskKind | null;
  destination: HouseBackupDestination | null;
  startedAt: number | null;
  /** Outcome text of the last finished run — drives the toast and any inline note. */
  message: string | null;
  /**
   * A manual run's 12 words, waiting for the Backup screen to show them once.
   * Never toasted, never logged: this is the only copy.
   */
  pendingPhrase: PendingHouseBackupPhrase | null;
};

type HouseBackupTaskStore = HouseBackupTaskState & {
  /** Monotonic id of the run holding the slot — 0 when nothing holds it. */
  runId: number;
  begin: (kind: HouseBackupTaskKind, destination: HouseBackupDestination | null) => number | null;
  finish: (runId: number, outcome: HouseBackupTaskOutcome) => boolean;
  setPendingPhrase: (phrase: PendingHouseBackupPhrase | null) => void;
  reset: () => void;
};

const initial: HouseBackupTaskState & { runId: number } = {
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
 * any amount: `saveHouseBackupTo` awaits the OS share sheet, and a member who
 * swipes away from it (or from an OAuth screen) never resolves it. Nothing may
 * be able to wedge the slot permanently, so a stale claim is taken over rather
 * than waited on.
 */
const STALE_CLAIM_MS = 5 * 60 * 1000;

export const useHouseBackupTaskStore = create<HouseBackupTaskStore>((set, get) => ({
  ...initial,
  begin: (kind, destination) => {
    const current = get();
    if (current.status === 'running') {
      const age = current.startedAt == null ? Infinity : Date.now() - current.startedAt;
      if (age < STALE_CLAIM_MS) return null;
      console.warn('[house-backup] taking over a stale claim', current.kind, age);
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
      status: outcome.status === 'ok' ? 'ok' : outcome.status === 'cancelled' ? 'idle' : 'failed',
      message: outcome.status === 'cancelled' ? null : outcome.message,
    });
    return true;
  },
  setPendingPhrase: (pendingPhrase) => set({ pendingPhrase }),
  reset: () => set(initial),
}));

/** True while a backup is sealing — for a button label or a row subtitle. */
export function isHouseBackupRunning(): boolean {
  return useHouseBackupTaskStore.getState().status === 'running';
}

/**
 * Claim the single slot.
 *
 * Returns the run's token, or null when a fresh run already holds it — so the
 * caller can say "already running" instead of starting a second seal.
 */
export function beginHouseBackupTask(
  kind: HouseBackupTaskKind,
  destination: HouseBackupDestination | null = null,
): number | null {
  return useHouseBackupTaskStore.getState().begin(kind, destination);
}

/**
 * Release the slot and tell the member.
 *
 * A cancelled run (they dismissed the share sheet) is not an outcome worth
 * announcing — it is what they asked for. An outcome from a run that already
 * lost the slot is dropped entirely: stale news, and it would talk over the
 * run that replaced it.
 */
export function finishHouseBackupTask(runId: number, outcome: HouseBackupTaskOutcome): void {
  const applied = useHouseBackupTaskStore.getState().finish(runId, outcome);
  if (!applied || outcome.status === 'cancelled') return;
  // Longer than the 3s default: this is the answer to something the member
  // started minutes ago and then walked away from, so it has to survive them
  // looking back at the screen — and a failure needs to be read, not glimpsed.
  // Same reasoning as Budget's: a "reconnect the provider" message is only
  // actionable on the Backup screen, so the toast has to be the way there.
  // Spread rather than a trailing `undefined` — every other outcome keeps the
  // plain three-argument call.
  const reconnect: [ToastOptions] | [] =
    outcome.status === 'needs_auth'
      ? [{ onPress: openHouseBackupScreen, actionLabel: 'Reconnect' }]
      : [];
  showToast(outcome.status === 'ok' ? 'success' : 'error', outcome.message, 6000, ...reconnect);
}

/** Lazy for the same import-cycle reason as Budget's — see its counterpart. */
function openHouseBackupScreen(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nav = require('@services/navigation') as typeof import('@services/navigation');
  nav.navigateToHouseBackup();
}

/**
 * Take the pending phrase, clearing it — the Backup screen calls this when it
 * is ready to present the sheet, so the words are handed over exactly once.
 */
export function consumeHouseBackupPhrase(): PendingHouseBackupPhrase | null {
  const pending = useHouseBackupTaskStore.getState().pendingPhrase;
  if (pending) useHouseBackupTaskStore.getState().setPendingPhrase(null);
  return pending;
}

/**
 * Start a manual backup and return immediately.
 *
 * Fire-and-forget by design: the caller closes its sheet and carries on, and
 * the member is free to navigate anywhere while the seal runs. `householdId`
 * names what is being sealed — one home, or `HOUSE_ALL_HOMES_ID` for a single
 * file holding every home in its own section. The Backup screen's picker is what
 * chooses between them.
 */
export function startManualHouseBackup(
  destination: HouseBackupDestination,
  householdId?: string,
): boolean {
  const runId = beginHouseBackupTask('manual', destination);
  if (runId == null) {
    showToast('info', 'A backup is already running.');
    return false;
  }

  void (async () => {
    try {
      const result = await saveHouseBackupTo(destination, {
        ...(householdId ? { householdId } : {}),
      });
      if (result.status === 'cancelled') {
        finishHouseBackupTask(runId, { status: 'cancelled', message: result.message });
        return;
      }
      // Only a written file counts. `shared` means the OS sheet was handed the
      // bytes and told us nothing about what happened next, so it is not
      // evidence of a backup — see recordHouseBackupSuccess.
      if (result.status === 'saved') {
        await recordHouseBackupSuccess({
          at: new Date().toISOString(),
          destination,
          kind: 'manual',
          fileName: result.fileName,
          ...(result.householdId ? { householdId: result.householdId } : {}),
        });
      }
      if (result.phrase) {
        // Park it BEFORE the toast: the toast is what sends the member back to
        // the Backup screen to collect these words.
        useHouseBackupTaskStore.getState().setPendingPhrase({
          phrase: result.phrase,
          // Where the file went is `savedTo`'s job now — it renders as a card
          // with its own Open button above this text, so the intro is free to
          // talk about nothing but the words.
          intro:
            'This backup is sealed with the 12 words below, and they are shown only now. Copy or save them before you close this.',
          savedTo: result.savedTo,
        });
      }
      finishHouseBackupTask(runId, {
        status:
          result.status === 'saved'
            ? 'ok'
            : result.status === 'needs_auth'
              ? 'needs_auth'
              : 'failed',
        message:
          result.status === 'saved' && result.phrase
            ? 'Backup saved — open Backup & Restore for the recovery phrase.'
            : result.message,
      });
    } catch (error) {
      console.error('[house-backup] manual run threw', error);
      finishHouseBackupTask(runId, { status: 'failed', message: 'Could not create a backup.' });
    }
  })();

  return true;
}
