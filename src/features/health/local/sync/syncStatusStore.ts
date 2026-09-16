import { create } from 'zustand';

import type { SyncErrorCode } from '@symply/local-first';

export type HealthSyncPhase = 'idle' | 'syncing' | 'ok' | 'error' | 'offline';

/**
 * Sync status for the ONE personal household (plan §1.2).
 *
 * House keeps the same shape but gates every write on "is this the active
 * property", because a landlord syncs several ledgers and a background failure
 * must not paint an error over the screen they are looking at. Health has one
 * ledger, so there is nothing to gate: every run is the run the user can see.
 *
 * `peersOnline` counts THIS USER'S other devices — never other people. A
 * personal household holds one `user_id` (the control plane refuses a second,
 * He5), so a non-zero value here means "your other device", never "a member".
 */
export type HealthSyncStatus = {
  phase: HealthSyncPhase;
  lastSyncedAt: number | null;
  pendingOutbound: number;
  /**
   * Raw failure text, for logs only. Never render it: system strings must not
   * reach a health surface, and a terminal failure must not read as "offline".
   */
  lastError: string | null;
  /** Why the last sync failed, as a code the UI maps to copy. */
  lastErrorCode: SyncErrorCode | null;
  /**
   * Always `'mailbox'` in Wave A. `EXPO_PUBLIC_HEALTH_P2P` is off (plan §1.7)
   * and Health ships no SSE/WebSocket client at all (§5 He4), so the union has
   * exactly one transport by construction — kept as a union only so the field
   * reads the same as its siblings.
   */
  lastTransport: 'mailbox' | null;
  /** This user's other enrolled devices seen active on the control plane. */
  peersOnline: number;
  /** Ops merged from another device of this user on the last run. */
  lastAppliedFromPeers: number;
};

type HealthSyncStatusStore = HealthSyncStatus & {
  setPhase: (phase: HealthSyncPhase) => void;
  setResult: (patch: Partial<HealthSyncStatus>) => void;
  reset: () => void;
};

const initial: HealthSyncStatus = {
  phase: 'idle',
  lastSyncedAt: null,
  pendingOutbound: 0,
  lastError: null,
  lastErrorCode: null,
  lastTransport: null,
  peersOnline: 0,
  lastAppliedFromPeers: 0,
};

export const useHealthSyncStatusStore = create<HealthSyncStatusStore>((set) => ({
  ...initial,
  setPhase: (phase) => set({ phase }),
  setResult: (patch) => set(patch),
  reset: () => set(initial),
}));
