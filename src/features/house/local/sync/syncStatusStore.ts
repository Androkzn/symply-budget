import { create } from 'zustand';

import type { SyncErrorCode } from '@symply/local-first';

export type SyncPhase = 'idle' | 'syncing' | 'ok' | 'error' | 'offline';

/**
 * WHERE in a sync run the active property currently is.
 *
 * `phase` answers "is it working", which is all a banner needed while a sync was
 * a two-second mailbox round. A joiner's first sync is not that: it reaches the
 * control plane, waits to be handed the household key, downloads a multi-chunk
 * snapshot of a whole home, then drains a mailbox backlog — and every one of
 * those steps can be the slow one. A single spinner over the lot is why "it is
 * stuck" and "it is downloading your home" look identical.
 *
 * Ordered as the run performs them, so a screen can render the list as steps.
 */
export type SyncStage =
  | 'idle'
  /** Asking the control plane who the peers are. */
  | 'connecting'
  /** Enrolled but the household key has not been handed over yet. */
  | 'enrolling'
  /** Downloading the home's snapshot — the joiner's history. */
  | 'downloading'
  /** Merging the snapshot and the mailbox backlog into the ledger. */
  | 'applying'
  /** Sending this device's own changes onward. */
  | 'publishing'
  | 'done';

export type HouseSyncStatus = {
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
   * This property is a JOIN whose history has not landed yet.
   *
   * Distinct from `phase === 'syncing'`, and load-bearing for the UI: while it is
   * true the member is looking at a PARTIAL home, and telling them so is the
   * difference between "the app lost my house" and "it is still arriving".
   */
  backfilling: boolean;
  /**
   * Rows in the snapshot being installed, or null when none is.
   *
   * The count the member actually cares about during a first sync. Chunks
   * measure the download; this measures the home — "1,204 records" says a real
   * amount of history is landing, where "4/7" could be either a studio flat or a
   * decade of a house. Known only once the snapshot is decrypted (the manifest
   * does not carry it), so it appears partway through the download rather than
   * at the start.
   */
  snapshotRecords: number | null;
  /**
   * Records merged from peers since the current run started — the number that
   * moves while a member watches.
   *
   * Distinct from {@link HouseSyncStatus.snapshotRecords}, which counts one
   * checkpoint install and is null outside a join. This one covers BOTH: the
   * install and every ordinary op merged afterwards, which is what makes it move
   * during a normal sync rather than only on a first arrival.
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
  /** Ops merged from household peers on the last sync run. */
  lastAppliedFromPeers: number;
  /** Ops this device sent onward on the last sync run — the other direction. */
  lastPushedOps: number;
  /** Auto-merges that discarded a member's intent, pending acknowledgement. */
  conflicts: number;
  /**
   * This property is stuck in `enrolling` with NOBODY left who could approve it.
   *
   * `stage === 'enrolling'` says the household key has not arrived; it does not
   * say whether it ever will. When every other enrolled device has stopped
   * reaching the home there is no one to deposit the wrap, and the two cases
   * render identically — "Waiting for the home key", forever. This is the field
   * that separates them, so the UI can stop promising an approval that is not
   * coming. See `canEnrolmentStillBeApproved`.
   */
  enrolmentUnreachable: boolean;
};

type SyncStatusStore = HouseSyncStatus & {
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
  setResult: (patch: Partial<HouseSyncStatus>) => void;
  reset: () => void;
};

const initial: HouseSyncStatus = {
  phase: 'idle',
  stage: 'idle',
  snapshotProgress: null,
  backfilling: false,
  snapshotRecords: null,
  recordsThisSession: 0,
  lastSyncedAt: null,
  pendingOutbound: 0,
  lastError: null,
  lastErrorCode: null,
  lastTransport: null,
  peersOnline: 0,
  lastAppliedFromPeers: 0,
  lastPushedOps: 0,
  conflicts: 0,
  enrolmentUnreachable: false,
};

export const useHouseSyncStatusStore = create<SyncStatusStore>((set) => ({
  ...initial,
  setPhase: (phase) => set({ phase }),
  setStage: (stage) => set({ stage }),
  setSnapshotProgress: (snapshotProgress) => set({ snapshotProgress }),
  addRecords: (rows) => set((state) => ({ recordsThisSession: state.recordsThisSession + rows })),
  resetRecords: () => set({ recordsThisSession: 0 }),
  setResult: (patch) => set(patch),
  reset: () => set(initial),
}));

/** Human-readable step label. One place, so banner and panel cannot drift. */
export function describeSyncStage(stage: SyncStage): string {
  switch (stage) {
    case 'connecting':
      return 'Connecting to the home';
    case 'enrolling':
      return 'Waiting for the home key';
    case 'downloading':
      return 'Downloading home history';
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
