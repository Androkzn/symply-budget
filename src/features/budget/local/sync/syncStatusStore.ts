import { create } from 'zustand';

import type { SyncErrorCode } from './syncErrors';

export type SyncPhase = 'idle' | 'syncing' | 'ok' | 'error' | 'offline';

/**
 * WHERE in a sync run the active household currently is.
 *
 * `phase` answers "is it working", which is all a banner needed while a sync was
 * a two-second mailbox round. A joiner's first sync is not that: it reaches the
 * control plane, waits to be handed the household key, downloads a multi-chunk
 * snapshot of years of budget, then drains a mailbox backlog — and every one of
 * those steps can be the slow one. A single spinner over the lot is why "it is
 * stuck" and "it is downloading your history" look identical.
 *
 * Ordered as the run performs them, so a screen can render the list as steps.
 */
export type SyncStage =
  | 'idle'
  /** Asking the control plane who the peers are. */
  | 'connecting'
  /** Enrolled but the household key has not been handed over yet. */
  | 'enrolling'
  /** Downloading the household snapshot — the joiner's history. */
  | 'downloading'
  /** Merging the snapshot and the mailbox backlog into the ledger. */
  | 'applying'
  /** Sending this device's own changes onward. */
  | 'publishing'
  | 'done';

export type BudgetSyncStatus = {
  phase: SyncPhase;
  /** Fine-grained position within the run — see {@link SyncStage}. */
  stage: SyncStage;
  /**
   * Snapshot download progress, or null when nothing is downloading.
   *
   * Chunks, not bytes: the control plane hands out a checkpoint chunk at a time
   * and the manifest names how many there are, so this is a real fraction rather
   * than an animation pretending to be one.
   */
  snapshotProgress: { done: number; total: number } | null;
  /**
   * This household is a JOIN whose history has not landed yet.
   *
   * Distinct from `phase === 'syncing'`, and load-bearing for the UI: while it
   * is true the member is looking at a PARTIAL budget, and telling them so is
   * the difference between "the app lost my data" and "it is still arriving".
   */
  backfilling: boolean;
  /**
   * Records merged from peers since the current run started — the number that
   * moves while a member watches.
   *
   * Reset at the top of each run rather than accumulated for the life of the
   * app: "1,203 records" means nothing without a window, and the window a person
   * cares about is the sync they are looking at. Rows, not ops — see
   * `setRemoteApplyListener`.
   */
  recordsThisSession: number;
  lastSyncedAt: number | null;
  pendingOutbound: number;
  lastError: string | null;
  /**
   * Why the last sync failed, as a code the UI can map to copy. `lastError` is
   * kept for logs only — never render it (raw system strings must not reach the
   * UI), and never treat a terminal failure as "we are just offline".
   */
  lastErrorCode: SyncErrorCode | null;
  lastTransport: 'mailbox' | 'webrtc' | null;
  peersOnline: number;
  /** Peers with a recent server-confirmed sync; null before the first roster fetch. */
  recentlyActivePeers: number | null;
  membershipConfirmed: boolean | null;
  /** Ops merged from household peers on the last sync run. */
  lastAppliedFromPeers: number;
  /** Auto-merges that discarded a member's intent, pending acknowledgement. */
  conflicts: number;
};

type SyncStatusStore = BudgetSyncStatus & {
  setPhase: (phase: SyncPhase) => void;
  setStage: (stage: SyncStage) => void;
  setSnapshotProgress: (progress: { done: number; total: number } | null) => void;
  /**
   * Add to the running count. An adder rather than a setter because the rows
   * arrive one merge at a time from the engine, which has no idea what the total
   * so far is — and a setter would make every caller responsible for reading
   * before writing.
   */
  addRecords: (rows: number) => void;
  /** Start a fresh window. Called once at the top of a run. */
  resetRecords: () => void;
  setResult: (patch: Partial<BudgetSyncStatus>) => void;
  reset: () => void;
};

const initial: BudgetSyncStatus = {
  phase: 'idle',
  stage: 'idle',
  snapshotProgress: null,
  backfilling: false,
  recordsThisSession: 0,
  lastSyncedAt: null,
  pendingOutbound: 0,
  lastError: null,
  lastErrorCode: null,
  lastTransport: null,
  peersOnline: 0,
  recentlyActivePeers: null,
  membershipConfirmed: null,
  lastAppliedFromPeers: 0,
  conflicts: 0,
};

export const useBudgetSyncStatusStore = create<SyncStatusStore>((set) => ({
  ...initial,
  setPhase: (phase) => set({ phase }),
  setStage: (stage) => set({ stage }),
  setSnapshotProgress: (snapshotProgress) => set({ snapshotProgress }),
  addRecords: (rows) =>
    set((state) => ({ recordsThisSession: state.recordsThisSession + rows })),
  resetRecords: () => set({ recordsThisSession: 0 }),
  setResult: (patch) => set(patch),
  reset: () => set(initial),
}));

/** Human-readable step label. One place, so banner and panel cannot drift. */
export function describeSyncStage(stage: SyncStage): string {
  switch (stage) {
    case 'connecting':
      return 'Connecting to the household';
    case 'enrolling':
      return 'Waiting for the household key';
    case 'downloading':
      return 'Downloading household history';
    case 'applying':
      return 'Merging changes';
    case 'publishing':
      return 'Sending your changes';
    case 'done':
      return 'Up to date';
    case 'idle':
      return 'Idle';
  }
}
