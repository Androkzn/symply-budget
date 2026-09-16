// Must precede @symply/local-first — @noble caches crypto at module load.
import './cryptoPolyfill';

import type {
  BudgetCategory,
  BudgetGoal,
  BudgetItem,
  BudgetTransferRecord,
  Expense,
  SubBudget,
} from '@api/budget';
import type { BudgetLoan } from '@api/budgetLoans';
import { recordE2EPersistEntry } from '@api/e2eTestObservability';
import type { Household } from '@api/households';
import type {
  Mortgage,
  MortgageEvent,
  MortgageOfferView,
  MortgageStatement,
} from '@api/mortgage';
import type {
  RegisteredAccount,
  RegisteredTransaction,
  SavingsCategory,
  SavingsGoal,
  SavingsIncomeEntry,
  SavingsIncomeTemplate,
  SavingsRecurringPayment,
  SavingsSpendingEntry,
} from '@api/savings';
import type { Wish, WishEntry } from '@api/wishes';
import {
  MemoryLocalFirstStore,
  OpLog,
  aeadDecrypt,
  aeadEncrypt,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  createOpId,
  createUnlockMaterial,
  generateDeviceIdentity,
  generateHouseholdKeys,
  hexToBytes,
  minVersionVector,
  openRowBody,
  randomBytes,
  rowAad,
  sealRowBody,
  utf8Decode,
  utf8Encode,
  type CheckpointPlaintext,
  type DeviceIdentity,
  type HouseholdKeys,
  type LocalFirstStore,
  type StoredOperation,
  type VersionVector,
} from '@symply/local-first';

import { openBudgetLocalFirstStore } from './budget-local-first-store';
import { defaultCategories } from './defaults';
import {
  BudgetLocalEnrolmentPendingError,
  BudgetLocalNotReadyError,
  BudgetLocalUnknownHouseholdError,
} from './errors';
import type { LocalMortgageTerm } from './mortgage/localMortgageProjector';
import {
  archiveLocalBudgetPersistence,
  clearLocalBudgetPersistence,
  loadDbKeyHex,
  saveDbKeyHex,
} from './persistence';
import {
  applyLedgerDelta,
  captureLedgerSnapshot,
  chunkLedgerDelta,
  collectRowWrites,
  decodeLedgerOpPayload,
  diffLedger,
  drainParkedRows,
  encodeLedgerOpPayload,
  installRowEnvelopes,
  LEDGER_TABLE_KEYS,
  LEDGER_TABLE_NAMES,
  RESTORE_HLC,
  restoreDeltaFromBackup,
  type LedgerConflict,
  type LedgerDelta,
  type LedgerLww,
  type LedgerTableName,
  type RowEnvelope,
} from './projection';

/** Projection target row (period = YYYY-MM). */
/**
 * `id` is a surrogate key, deliberately NOT the period.
 *
 * Keying this table on `period` made it diverge permanently: setting a month's
 * target to null DELETES the row (localSavingsProjector.applyProjectionTargets),
 * and setting it again re-creates the SAME key — which every peer rejects
 * forever, because a delete records an absorbing tombstone under that key. The
 * authoring device kept the row and the peers never got it. A surrogate key
 * makes the re-create a genuinely new row, so it merges normally.
 */
export type LocalSavingsMonthlyTarget = {
  id: string;
  period: string;
  target_cents: number;
  /** Disambiguates concurrent targets for the same period. See targetsByPeriod(). */
  updated_at: string;
};

/**
 * Offline wish image bytes live as local URIs keyed by image_key.
 *
 * `id` is a surrogate key for the same reason as LocalSavingsMonthlyTarget:
 * attachments are deleted with their wish/entry, and keying the table on the
 * image key made any later row with that key unmergeable on peers.
 */
export type LocalWishAttachment = {
  id: string;
  key: string;
  localUri: string;
  mime: string;
};

/** Minimal renewal metadata for Monthly Payments pills (no R2 docs offline). */
export type LocalBudgetRenewal = {
  id: string;
  household_id: string;
  recurring_payment_id: string;
  next_renewal_date: string;
  status: 'upcoming' | 'renewed' | 'lapsed' | 'cancelled';
  reminder_lead_days: number;
  created_at: string;
  updated_at: string;
};


export interface LocalBudgetLedger {
  version: 1;
  household: Household;
  memberId: string;
  deviceId: string;
  categories: BudgetCategory[];
  expenses: Expense[];
  items: BudgetItem[];
  goals: BudgetGoal[];
  subBudgets: SubBudget[];
  transfers: BudgetTransferRecord[];
  /** Debt instruments (Phase 1 local amortisation). */
  mortgages: Mortgage[];
  mortgageTerms: LocalMortgageTerm[];
  mortgageStatements: MortgageStatement[];
  mortgageEvents: MortgageEvent[];
  mortgageOffers: MortgageOfferView[];
  /** Savings / pension / wishes / loans (V2 local-first completeness). */
  savingsIncome: SavingsIncomeEntry[];
  savingsSpending: SavingsSpendingEntry[];
  savingsRecurringPayments: SavingsRecurringPayment[];
  savingsGoals: SavingsGoal[];
  savingsCategories: SavingsCategory[];
  savingsIncomeTemplates: SavingsIncomeTemplate[];
  savingsMonthlyTargets: LocalSavingsMonthlyTarget[];
  budgetLoans: BudgetLoan[];
  budgetRenewals: LocalBudgetRenewal[];
  registeredAccounts: RegisteredAccount[];
  registeredTransactions: RegisteredTransaction[];
  wishes: Wish[];
  wishEntries: WishEntry[];
  wishAttachments: LocalWishAttachment[];
  ops: StoredOperation[];
  /** Per-row/field merge watermarks for multi-member LWW (TRD §8.4). */
  lww?: LedgerLww;
  /** Auto-merges that discarded a member's intent, for the UI (BR-044). */
  conflicts?: LedgerConflict[];
  /** Set between claiming an invite and receiving the household data key. */
  pendingEnrolment?: boolean;
  /** Persisted crypto material (Phase 3 — required for multi-device sync). */
  crypto?: {
    signingPrivateKeyHex: string;
    signingPublicKeyHex: string;
    agreementPrivateKeyHex: string;
    agreementPublicKeyHex: string;
    hdkHex: string;
    keyEpoch: number;
    /**
     * Retired household keys for THIS household, `epoch → hdk` hex.
     *
     * Retire, do not discard: a revoke replaces the HDK wholesale, and anything
     * sealed under the outgoing epoch — ops still in the log, checkpoints,
     * attachments — stays sealed under it long after the key is gone. Retaining
     * the old key is what keeps that readable. It does NOT weaken the revoke:
     * the revoked device never receives this keyring, and what it could still
     * open with its stale copy is what it already held. Absent on every session
     * written before BR-016, which is why every read is `?? {}`.
     */
    retiredHdksByEpoch?: Record<string, string>;
  };
}

function emptyDebtTables(): Pick<
  LocalBudgetLedger,
  'mortgages' | 'mortgageTerms' | 'mortgageStatements' | 'mortgageEvents' | 'mortgageOffers'
> {
  return {
    mortgages: [],
    mortgageTerms: [],
    mortgageStatements: [],
    mortgageEvents: [],
    mortgageOffers: [],
  };
}

function emptySavingsTables(): Pick<
  LocalBudgetLedger,
  | 'savingsIncome'
  | 'savingsSpending'
  | 'savingsRecurringPayments'
  | 'savingsGoals'
  | 'savingsCategories'
  | 'savingsIncomeTemplates'
  | 'savingsMonthlyTargets'
  | 'budgetLoans'
  | 'budgetRenewals'
  | 'registeredAccounts'
  | 'registeredTransactions'
  | 'wishes'
  | 'wishEntries'
  | 'wishAttachments'
> {
  return {
    savingsIncome: [],
    savingsSpending: [],
    savingsRecurringPayments: [],
    savingsGoals: [],
    savingsCategories: [],
    savingsIncomeTemplates: [],
    savingsMonthlyTargets: [],
    budgetLoans: [],
    budgetRenewals: [],
    registeredAccounts: [],
    registeredTransactions: [],
    wishes: [],
    wishEntries: [],
    wishAttachments: [],
  };
}

/** Backfill tables for snapshots that predate mortgage/savings local paths. */
function normalizeLedger(ledger: LocalBudgetLedger): LocalBudgetLedger {
  return {
    ...ledger,
    mortgages: ledger.mortgages ?? [],
    mortgageTerms: ledger.mortgageTerms ?? [],
    mortgageStatements: ledger.mortgageStatements ?? [],
    mortgageEvents: ledger.mortgageEvents ?? [],
    mortgageOffers: ledger.mortgageOffers ?? [],
    savingsIncome: ledger.savingsIncome ?? [],
    savingsSpending: ledger.savingsSpending ?? [],
    savingsRecurringPayments: ledger.savingsRecurringPayments ?? [],
    savingsGoals: ledger.savingsGoals ?? [],
    savingsCategories: ledger.savingsCategories ?? [],
    savingsIncomeTemplates: ledger.savingsIncomeTemplates ?? [],
    savingsMonthlyTargets: ledger.savingsMonthlyTargets ?? [],
    budgetLoans: ledger.budgetLoans ?? [],
    budgetRenewals: ledger.budgetRenewals ?? [],
    registeredAccounts: ledger.registeredAccounts ?? [],
    registeredTransactions: ledger.registeredTransactions ?? [],
    wishes: ledger.wishes ?? [],
    wishEntries: ledger.wishEntries ?? [],
    wishAttachments: ledger.wishAttachments ?? [],
    lww: ledger.lww ?? {},
    conflicts: ledger.conflicts ?? [],
    pendingEnrolment: ledger.pendingEnrolment ?? false,
  };
}

/**
 * One open household. BR-016 turned the single module-level `engine` into a map
 * of these — see the session registry below.
 *
 * `dbKey`, `store` and `identity` are DEVICE-scoped and shared by every session:
 * one SQLite file, one DEK, one device keypair. `householdKeys` (the HDK), the
 * OpLog and the ledger are HOUSEHOLD-scoped, because each household is its own
 * membership with its own key epoch — a member can be owner of one and a
 * still-pending invitee of another.
 *
 * One database is correct here and splitting it would be a regression: every row
 * is sealed with `rowAad(householdId, table, rowKey, keyEpoch)` (see
 * `sealWrites`), so a row that lands under the wrong household simply fails to
 * decrypt. Isolation is cryptographic per row, not per file (plan §1).
 */
type EngineState = {
  householdId: string;
  dbKey: Uint8Array;
  store: LocalFirstStore;
  identity: DeviceIdentity;
  householdKeys: HouseholdKeys;
  /**
   * Retired HDKs for THIS household, `epoch → key`. Household-scoped like
   * `householdKeys` itself — each household rotates on its own schedule, so one
   * shared retired-key map would hand household A's outgoing key to B.
   */
  retiredHouseholdKeys: Map<number, Uint8Array>;
  opLog: OpLog;
  ledger: LocalBudgetLedger;
  /**
   * False until this household's rows have been decrypted into memory. Lazy
   * hydration is the whole point of the registry: cold open opens and parses
   * every row of a household, and a member with three households must not pay
   * that three times over to look at one of them.
   */
  hydrated: boolean;
  /** Set between claiming an invite and receiving THIS household's HDK. */
  awaitingKeys: boolean;
  /** Remote deltas merged but not yet persisted, for THIS household. */
  pendingRemoteDeltas: LedgerDelta[];
};

/**
 * The session registry (BR-016 B2).
 *
 * `lf_rows` is keyed `(household_id, tbl, row_key)`, ops are unique on
 * `(household_id, device_id, seq)`, and the frontier and sync cursors are
 * household-scoped too — so nothing in `@symply/local-first` had to change for
 * this. The household was always a column, never a database.
 */
const sessions = new Map<string, EngineState>();
let activeHouseholdId: string | null = null;

/**
 * Bumped whenever a *remote* op changes the projections, so React Query caches
 * (which read `getLocalLedger()` synchronously and would otherwise keep serving
 * a stale snapshot until their own staleTime elapsed) can be invalidated the
 * moment a peer's change lands.
 */
let ledgerRevision = 0;

/**
 * What a listener is told when the ledger moves.
 *
 * `householdId` is the BR-016 addition and the reason there is a payload object
 * at all: a background household syncing must not repaint the screen the member
 * is looking at, so a subscriber compares it against the active id before
 * invalidating anything. `tables` carries WHICH tables moved; an empty array
 * means "something changed but not a table" — a conflict list cleared, an
 * enrolment completed — and reads as a session-level bump, not a data
 * invalidation.
 */
export type BudgetLedgerChange = {
  revision: number;
  tables: readonly LedgerTableName[];
  householdId: string | null;
};

const ledgerListeners = new Set<(revision: number, change: BudgetLedgerChange) => void>();

export function getLedgerRevision(): number {
  return ledgerRevision;
}

/**
 * The revision stays the FIRST argument, deliberately.
 *
 * House puts a single object in its listener slot, but every Budget subscriber
 * today takes `(revision: number)` and two screens pass a `useState` setter
 * straight in. Swapping the argument would have been a compile break across
 * files this stage does not own, for a field most of them ignore. Extra
 * arguments cost a caller nothing in TypeScript, so the household rides along in
 * `change` for the subscribers that need to filter on it.
 */
export function subscribeToLedgerChanges(
  listener: (revision: number, change: BudgetLedgerChange) => void,
): () => void {
  ledgerListeners.add(listener);
  return () => {
    ledgerListeners.delete(listener);
  };
}

/** Tables a delta actually touched — upserts and tombstones alike. */
function tablesInDelta(delta: LedgerDelta): LedgerTableName[] {
  const touched = new Set<LedgerTableName>();
  for (const table of Object.keys(delta.u ?? {}) as LedgerTableName[]) touched.add(table);
  for (const table of Object.keys(delta.d ?? {}) as LedgerTableName[]) touched.add(table);
  return [...touched];
}

/**
 * Notifications held back while a batch of incoming work lands (BR-016 §B5).
 *
 * A sync run merges ops ONE AT A TIME — `projectionFor().apply` fires per op —
 * and every one of them used to reach the screen: `ledgerRefresh` bumps four
 * Zustand stores and invalidates the whole React Query cache per event, so a
 * joiner receiving a household's history repainted every budget surface
 * hundreds of times in a row. That is the flicker: not a rendering bug, a
 * notification storm, and the only fix that removes it rather than smoothing it
 * over is to stop emitting the intermediate states at all.
 *
 * Scoped PER HOUSEHOLD, not globally, and that is not a detail. The fan-out
 * syncs every household CONCURRENTLY, so a single global gate would hold the
 * foreground household's repaint until the slowest background household — one
 * the member cannot see and may not have opened in weeks — finished its round.
 * A household's batch covers only its own notifications, which is also the
 * grouping `ledgerRefresh` needs: it filters on `householdId`, and merging two
 * households into one event would repaint the foreground off a background sync.
 *
 * Depth-counted rather than boolean, because the apply region nests: a
 * checkpoint install sits inside a sync run, and a boolean would let the inner
 * one flush the outer.
 *
 * `ledgerRevision` does not move while a batch is open, deliberately: it is the
 * `useSyncExternalStore` snapshot, so a revision that moved without a delivered
 * event would let React re-read a half-merged ledger.
 */
const ledgerBatchDepth = new Map<string | null, number>();
const batchedLedgerTables = new Map<string | null, Set<LedgerTableName>>();

/** Open a batch for one household. ALWAYS pair with `endLedgerBatch`. */
export function beginLedgerBatch(householdId: string | null): void {
  ledgerBatchDepth.set(householdId, (ledgerBatchDepth.get(householdId) ?? 0) + 1);
}

/** Close a batch, emitting one coalesced event if that household moved. */
export function endLedgerBatch(householdId: string | null): void {
  const depth = ledgerBatchDepth.get(householdId) ?? 0;
  if (depth === 0) return;
  if (depth > 1) {
    ledgerBatchDepth.set(householdId, depth - 1);
    return;
  }
  ledgerBatchDepth.delete(householdId);
  const held = batchedLedgerTables.get(householdId);
  if (!held) return;
  batchedLedgerTables.delete(householdId);
  dispatchLedgerChange([...held], householdId);
}

/**
 * Run `work` with this household's ledger notifications coalesced into one
 * event at the end.
 *
 * The `finally` is the whole point: a sync that throws mid-merge must not leave
 * the batch open, or every subsequent change to that household is swallowed and
 * its screens freeze on stale data with nothing in the log to say why.
 */
export async function withLedgerBatch<T>(
  householdId: string | null,
  work: () => Promise<T>,
): Promise<T> {
  beginLedgerBatch(householdId);
  try {
    return await work();
  } finally {
    endLedgerBatch(householdId);
  }
}

function dispatchLedgerChange(
  tables: readonly LedgerTableName[],
  householdId: string | null,
): void {
  ledgerRevision += 1;
  const change: BudgetLedgerChange = { revision: ledgerRevision, tables, householdId };
  for (const listener of ledgerListeners) {
    try {
      listener(ledgerRevision, change);
    } catch (error) {
      console.warn('[budget.local] ledger listener failed', error);
    }
  }
}

function notifyLedgerChanged(
  tables: readonly LedgerTableName[] = [],
  // Default expression, evaluated per call: it must read the live active id, not
  // whatever was active when the module loaded.
  householdId: string | null = activeHouseholdId,
): void {
  if ((ledgerBatchDepth.get(householdId) ?? 0) > 0) {
    let held = batchedLedgerTables.get(householdId);
    if (!held) {
      held = new Set<LedgerTableName>();
      batchedLedgerTables.set(householdId, held);
    }
    // An empty `tables` is a session-level bump and stays one: the entry exists,
    // so the household still gets its single event at the end of the batch.
    for (const table of tables) held.add(table);
    return;
  }
  dispatchLedgerChange(tables, householdId);
}

/**
 * Projection handler wired into a household's OpLog so *every* verified op —
 * local echo and peer alike — merges into THAT household's ledger under LWW.
 * Without a projection the op log converges while the UI never changes, which is
 * exactly the state V2 was in before multi-member sync landed.
 *
 * Bound per household rather than shared. The single shared literal this
 * replaces read the module-level `engine`, so household B's `applyRemote()`
 * merged B's deltas into whichever ledger happened to be active — correctly
 * signed, correctly sealed, wrong household, and invisible until the two
 * diverged (plan §2 hazard 2).
 *
 * It closes over the household ID and re-reads `sessions.get()` on every apply
 * rather than capturing the `EngineState`: `installHouseholdKeys` and
 * `adoptJoinedHousehold` swap fields on that object and re-key the map, and a
 * captured reference would go stale.
 */
function projectionFor(householdId: string) {
  return {
    async apply(args: {
      opId: string;
      opType: string;
      entityType: string;
      entityId: string;
      plaintextPayload: Uint8Array;
      authorMemberId: string;
      hlc: string;
    }): Promise<void> {
      // A removed household whose OpLog is still draining no-ops rather than
      // throwing into sync's error path.
      const session = sessions.get(householdId);
      if (!session) return;
      let delta;
      try {
        delta = decodeLedgerOpPayload(JSON.parse(utf8Decode(args.plaintextPayload)));
      } catch {
        console.warn('[budget.local] unparsable op payload', args.opId, args.opType);
        return;
      }
      if (!delta) return;

      const isLocalEcho = args.authorMemberId === session.ledger.memberId;
      const result = applyLedgerDelta(session.ledger, delta, {
        hlc: args.hlc,
        authorMemberId: args.authorMemberId,
        opId: args.opId,
      });
      if (!isLocalEcho) {
        session.pendingRemoteDeltas.push(delta);
        if (result.applied > 0 || result.deleted > 0) {
          reportRemoteRows(householdId, result.applied + result.deleted);
          notifyLedgerChanged(tablesInDelta(delta), householdId);
        }
      }
    },
  };
}

/**
 * The ACTIVE session — what the UI means by "the ledger".
 *
 * Two tiers, and the split is load-bearing: UI reads active, background work
 * names its household. A sync that reached for the active session would seal
 * household B's ops under A's HDK and address them to A's peers.
 */
function requireEngine(): EngineState {
  const session = activeHouseholdId ? sessions.get(activeHouseholdId) : null;
  if (!session) {
    throw new BudgetLocalNotReadyError();
  }
  return session;
}

/** The session for one household, whether or not it is the active one. */
function requireSession(householdId: string): EngineState {
  const session = sessions.get(householdId);
  if (!session) {
    // An engine holding NOTHING is "not ready", never "unknown household" —
    // that is the contract on `BudgetLocalUnknownHouseholdError`, which exists
    // to mean "a session IS open and something named a household outside it".
    // The two have opposite fixes, so reporting one as the other sends the
    // member to the wrong recovery.
    //
    // Not hypothetical: on a cold launch `useHouseholdStore` rehydrates its
    // persisted `currentHousehold` before `ensureBudgetLocalSession` has opened
    // anything, so every screen loader fires against a real id with an empty
    // session map. On an iPhone 13 (2026-09-03) that produced 12 errors reading
    // "No local ledger for household ebaa46a9… No sessions are open on this
    // device." in the first second — a session that had not opened yet
    // described as a household the device does not hold.
    if (sessions.size === 0) {
      throw new BudgetLocalNotReadyError();
    }
    throw new BudgetLocalUnknownHouseholdError(householdId, [...sessions.keys()], activeHouseholdId);
  }
  return session;
}

export function isLocalBudgetSessionOpen(): boolean {
  return activeHouseholdId !== null && sessions.has(activeHouseholdId);
}

export function getLocalLedger(): LocalBudgetLedger {
  return requireEngine().ledger;
}

export function getLocalMemberId(): string {
  return requireEngine().ledger.memberId;
}

export function getLocalIdentity(): DeviceIdentity {
  return requireEngine().identity;
}

export function getLocalHouseholdKeys(): HouseholdKeys {
  return requireEngine().householdKeys;
}

/**
 * The retired HDK ring, `epoch → hdk`, for opening anything sealed before the
 * last rotation. Checkpoints already receive this via `openCheckpoint`; shared
 * AI keys need it for the same reason — a share published before a device
 * revocation carries the old epoch and is otherwise unopenable.
 */
export function getLocalRetiredHouseholdKeys(): Map<number, Uint8Array> {
  return requireEngine().retiredHouseholdKeys;
}

export function getLocalOpLog(): OpLog {
  return requireEngine().opLog;
}

export function getLocalStore(): LocalFirstStore {
  return requireEngine().store;
}

/**
 * True between claiming an invite and receiving that household's data key. While
 * set, this device holds the joined household id but still a placeholder HDK, so
 * it must not author ops (see BudgetLocalEnrolmentPendingError).
 *
 * Per household, not per device. As one global flag it meant joining B blocked
 * every write to fully-enrolled A, and enrolling into B unblocked A prematurely
 * (plan §2 hazard 5).
 *
 * Reads `sessions.get`, not `requireSession`: this is called from render paths
 * and a predicate that throws for an unknown household would take a screen down
 * with it. An unknown household is simply not awaiting anything here.
 */
export function isAwaitingHouseholdEnrolment(householdId?: string): boolean {
  const session = householdId
    ? sessions.get(householdId)
    : activeHouseholdId
      ? sessions.get(activeHouseholdId)
      : null;
  return session?.awaitingKeys === true;
}

/**
 * Install HDK received from an approved peer (enrolment). Rebuilds OpLog.
 *
 * `retired` is the rest of the key ring — the epochs this household used before
 * `next`. It matters most for the case it was added for: a device joining a
 * household that has ALREADY rotated. Handed only the current key, such a
 * device receives the household's whole history and rejects every op of it as
 * `key_epoch_mismatch`, and cannot open the checkpoint either, because that was
 * sealed under whichever epoch was current when it was published. Zero rows, no
 * error, for ever. (Production, `Sweet Home` at epoch 5: 136 KB of ops
 * downloaded and refused, a 659 KB checkpoint downloaded and refused.)
 *
 * Merged, never replaced: a device that already holds epochs 2 and 3 must not
 * lose them to a wrap that only carried 4.
 */
export async function installHouseholdKeys(
  next: HouseholdKeys,
  forHouseholdId?: string,
  retired?: ReadonlyMap<number, Uint8Array>,
): Promise<void> {
  const state = forHouseholdId ? requireSession(forHouseholdId) : requireEngine();
  if (next.householdId !== state.householdId || !Number.isSafeInteger(next.keyEpoch) ||
      next.keyEpoch < 1 || next.hdk.length !== 32) {
    throw new Error('Invalid household key installation');
  }
  if (!state.awaitingKeys && next.keyEpoch < state.householdKeys.keyEpoch) {
    throw new Error('Household key epoch cannot move backwards');
  }
  // Retire, do not discard. A revoke replaces the HDK wholesale and everything
  // already sealed under the outgoing epoch stays sealed under it. Only retire a
  // genuinely OLDER epoch: enrolment lands here too (installing the FIRST real
  // key, and re-installing the same epoch), and neither of those is a rotation.
  //
  // NOT while awaiting enrolment. `adoptJoinedHousehold` mints a THROWAWAY
  // epoch-1 key that nothing is ever sealed under; retiring it would put a
  // key that opens nothing into the ring at epoch 1 and — worse — would make
  // the merge below skip the household's REAL epoch-1 key when the wrap
  // delivers it.
  const previous = state.householdKeys;
  if (!state.awaitingKeys && previous?.hdk?.length && previous.keyEpoch < next.keyEpoch) {
    state.retiredHouseholdKeys.set(previous.keyEpoch, previous.hdk);
  }
  for (const [epoch, hdk] of retired ?? []) {
    // Never over the incoming epoch itself, and never over a key this device
    // already retired — ours came from our own rotation and is first-hand.
    if (epoch === next.keyEpoch) continue;
    if (!state.retiredHouseholdKeys.has(epoch) && hdk.length > 0) {
      state.retiredHouseholdKeys.set(epoch, hdk);
    }
  }
  state.householdKeys = next;
  state.awaitingKeys = false;
  state.ledger.pendingEnrolment = false;
  state.opLog = new OpLog({
    store: state.store,
    identity: state.identity,
    householdKeys: next,
    // The freshly retired epoch is already in the map above, so the new log can
    // open everything sealed before the rotation as well as everything after.
    retiredHdks: state.retiredHouseholdKeys,
    projection: projectionFor(state.householdId),
  });
  state.ledger.crypto = cryptoBundle(state.identity, next, state.retiredHouseholdKeys);
  await persistSession(state, null);
  // Enrolment just completed (or the epoch rotated) — let the settings screen
  // drop the "waiting for approval" state without a manual reload. No tables
  // moved, so this is a session-level bump.
  //
  // Delivered IMMEDIATELY, past any open batch, and that exception is
  // deliberate. This runs inside the sync run's apply batch, and holding it
  // would keep "Waiting to be let in" on screen for the whole history download
  // — beside a progress card already saying the history is downloading. Two
  // panels contradicting each other is worse than one extra repaint, and the
  // repaint is cheap: nothing has been merged at this point in the run, so the
  // screen it paints is the empty one already showing.
  dispatchLedgerChange([], state.householdId);
}

function cryptoBundle(
  identity: DeviceIdentity,
  householdKeys: HouseholdKeys,
  retired?: Map<number, Uint8Array>,
) {
  const retiredHdksByEpoch: Record<string, string> = {};
  for (const [epoch, hdk] of retired ?? []) {
    retiredHdksByEpoch[String(epoch)] = bytesToHex(hdk);
  }
  return {
    signingPrivateKeyHex: bytesToHex(identity.signingPrivateKey),
    signingPublicKeyHex: bytesToHex(identity.signingPublicKey),
    agreementPrivateKeyHex: bytesToHex(identity.agreementPrivateKey),
    agreementPublicKeyHex: bytesToHex(identity.agreementPublicKey),
    hdkHex: bytesToHex(householdKeys.hdk),
    keyEpoch: householdKeys.keyEpoch,
    // Omitted entirely when empty, so a household that never rotated seals a
    // blob byte-identical to the pre-BR-016 one.
    ...(Object.keys(retiredHdksByEpoch).length > 0 ? { retiredHdksByEpoch } : {}),
  };
}

/** Rehydrate the retired-key map from a persisted crypto bundle. */
function retiredKeysFromCrypto(
  crypto: NonNullable<LocalBudgetLedger['crypto']> | undefined,
): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  for (const [epoch, hex] of Object.entries(crypto?.retiredHdksByEpoch ?? {})) {
    const parsedEpoch = Number(epoch);
    if (Number.isInteger(parsedEpoch) && hex) out.set(parsedEpoch, hexToBytes(hex));
  }
  return out;
}

function identityFromCrypto(
  deviceId: string,
  crypto: NonNullable<LocalBudgetLedger['crypto']>,
): DeviceIdentity {
  return {
    deviceId,
    signingPrivateKey: hexToBytes(crypto.signingPrivateKeyHex),
    signingPublicKey: hexToBytes(crypto.signingPublicKeyHex),
    agreementPrivateKey: hexToBytes(crypto.agreementPrivateKeyHex),
    agreementPublicKey: hexToBytes(crypto.agreementPublicKeyHex),
  };
}

/**
 * Per-household identity record. BR-016 made this a FAMILY of keys rather than
 * one blob: `ledger.identity.v2:<householdId>`.
 *
 * `lf_meta` is `key TEXT PRIMARY KEY` and household-blind — `getMeta`/`setMeta`
 * are the only two methods in `LocalFirstStore` that take no household id, and
 * that asymmetry, not the shared database, was the entire isolation gap. One
 * global identity key holds household + memberId + deviceId + hdkHex + keyEpoch,
 * so two sessions meant last-write-wins: the next cold open reconstructed
 * household A's ledger under household B's HDK, or lost one household outright
 * (plan §2 hazard 1).
 *
 * Isolation of the identity record therefore comes from the key NAME. The AAD
 * stays the constant `lf-meta:identity` — row isolation is the separate,
 * already-correct mechanism, and it does bind the household (`rowAad`).
 */
const identityMetaKey = (householdId: string) => `ledger.identity.v2:${householdId}`;
/** The index a cold open enumerates before it decides which household to hydrate. */
const HOUSEHOLDS_META = 'ledger.households.v1';
/** The household a cold open prefers to activate. */
const ACTIVE_META = 'ledger.active_household.v1';
/**
 * Stays DEVICE-global, and correctly so: it answers "which account does the data
 * on this disk belong to", which is not a per-household question. It is the
 * different-account guard in `openLocalBudgetSessionInner`.
 */
const MEMBER_META = 'ledger.member_id';
/**
 * Repurposed as a second, legacy-shaped active pointer, as House did. Written
 * and never read by this engine — `ACTIVE_META` is authoritative — but the
 * migration below reads it as a fallback source of the legacy household id, and
 * it is cheap to keep honest for anything outside this module.
 */
const HOUSEHOLD_META = 'ledger.household_id';
/**
 * Per household: two households publish checkpoints independently, so one shared
 * watermark lets a compaction on A truncate below what B still needs to prove it
 * holds — unrecoverable, because the ops are gone (plan §2 hazard 4).
 */
const checkpointVvMetaKey = (householdId: string) => `lf.checkpoint.vv:${householdId}`;
/**
 * "This household was JOINED and its history has not landed yet."
 *
 * Written by `adoptJoinedHousehold`, cleared only when the backfill provably
 * succeeded, and durable so an app killed mid-join resumes instead of giving up.
 *
 * It exists because the old bootstrap gate was `the version vector is empty`,
 * which is not a fact about whether the history arrived — it is a fact about
 * whether ANY op has been stored. The owner deposits the household key and the
 * checkpoint independently, so a joiner routinely gets the key first, finds no
 * checkpoint published yet, and then applies one live op from the mailbox. That
 * single op makes the vector non-empty and closes the only window the joiner
 * ever had: the ops that carry the older months are long since compacted at the
 * owner, so the member is left holding the current month and nothing else —
 * no goals, no income, no earlier history — with every log line reporting a
 * healthy sync. This marker replaces the inference with a record.
 */
const bootstrapPendingMetaKey = (householdId: string) => `lf.bootstrap.pending:${householdId}`;
/** Pre-BR-016 layout. Read exactly once, by the migration, then blanked. */
const LEGACY_IDENTITY_META = 'ledger.identity.v2';
const LEGACY_CHECKPOINT_VV_META = 'lf.checkpoint.vv';
const IDENTITY_AAD = utf8Encode('lf-meta:identity');

type PersistedIdentity = {
  household: Household;
  memberId: string;
  deviceId: string;
  pendingEnrolment?: boolean;
  conflicts?: LedgerConflict[];
  crypto?: LocalBudgetLedger['crypto'];
};

async function persistIdentity(state: EngineState): Promise<void> {
  state.ledger.crypto = cryptoBundle(
    state.identity,
    state.householdKeys,
    state.retiredHouseholdKeys,
  );
  const payload: PersistedIdentity = {
    household: state.ledger.household,
    memberId: state.ledger.memberId,
    deviceId: state.ledger.deviceId,
    pendingEnrolment: state.ledger.pendingEnrolment ?? false,
    conflicts: state.ledger.conflicts ?? [],
    crypto: state.ledger.crypto,
  };
  const sealed = aeadEncrypt(state.dbKey, utf8Encode(JSON.stringify(payload)), IDENTITY_AAD);
  await state.store.setMeta(identityMetaKey(state.householdId), bytesToBase64(sealed));
  await state.store.setMeta(MEMBER_META, state.ledger.memberId);
  await state.store.setMeta(HOUSEHOLD_META, state.ledger.household.id);
  // The index entry is not bookkeeping — an identity blob nothing enumerates is
  // an invisible ledger, and a cold open that enumerates nothing mints a fresh
  // household over the top of it.
  await rememberHousehold(state.store, state.householdId);
}

/** Append a household to the on-disk index a cold open enumerates. */
async function rememberHousehold(store: LocalFirstStore, householdId: string): Promise<void> {
  const known = await listPersistedHouseholds(store);
  if (known.includes(householdId)) return;
  await store.setMeta(HOUSEHOLDS_META, JSON.stringify([...known, householdId]));
}

async function forgetHousehold(store: LocalFirstStore, householdId: string): Promise<void> {
  const known = await listPersistedHouseholds(store);
  await store.setMeta(HOUSEHOLDS_META, JSON.stringify(known.filter((id) => id !== householdId)));
}

/**
 * Every read is defensive, and the degradation is dangerous: a corrupt index
 * reads as "no households", which routes a cold open to `mintNewHousehold`.
 * That is survivable only because `migrateLegacySingleHouseholdLayout` runs
 * first and because the identity blobs themselves are never deleted on this
 * path — the rows stay on disk, sealed and re-enumerable, rather than shredded.
 */
async function listPersistedHouseholds(store: LocalFirstStore): Promise<string[]> {
  const raw = await store.getMeta(HOUSEHOLDS_META);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function sealWrites(
  state: EngineState,
  writes: ReturnType<typeof collectRowWrites>,
  updatedHlc: string,
) {
  const householdId = state.ledger.household.id;
  const keyEpoch = state.householdKeys.keyEpoch;
  return writes.map((write) => {
    const sealed = sealRowBody(
      state.dbKey,
      utf8Encode(JSON.stringify(write.envelope)),
      rowAad(householdId, write.table, write.rowKey, keyEpoch),
    );
    return {
      householdId,
      table: write.table,
      rowKey: write.rowKey,
      bucket: write.bucket,
      deleted: write.deleted,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
      keyEpoch,
      updatedHlc,
    };
  });
}

function recordBudgetLocalWrite(
  writes: ReadonlyArray<{ table: string; deleted: boolean }>,
  opIds: readonly string[],
): void {
  if (writes.length > 0) {
    const tables = [...new Set(writes.map((write) => write.table))].join(',');
    recordE2EPersistEntry({
      store: 'budget_sqlite',
      operation: writes.every((write) => write.deleted) ? 'delete' : 'upsert',
      detail: `rows=${writes.length} tables=${tables}`,
    });
    return;
  }
  if (opIds.length > 0) {
    recordE2EPersistEntry({
      store: 'budget_sqlite',
      operation: 'update',
      detail: `projected=${opIds.length}`,
    });
  }
}

async function persistRows(
  state: EngineState,
  delta: LedgerDelta | 'all' | null,
  opIds: readonly string[] = [],
): Promise<void> {
  await persistIdentity(state);
  let writes: ReturnType<typeof collectRowWrites> = [];
  if (delta) {
    writes = collectRowWrites(state.ledger, delta);
    const hlc = state.ledger.ops[state.ledger.ops.length - 1]?.hlc ?? String(Date.now());
    await state.store.putRows(sealWrites(state, writes, hlc));
  }
  if (opIds.length > 0) {
    await state.store.markProjected(opIds, Date.now());
  }
  recordBudgetLocalWrite(writes, opIds);
}

/**
 * Persist ONE named session, in one store transaction.
 *
 * This replaced a `persist(delta, opIds)` helper that resolved `requireEngine()`
 * itself, and the replacement is not cosmetic: every caller now has to name the
 * session it is writing, so there is no longer any way to persist "whatever is
 * active" from a path that is holding a different household. That was hazard 3 —
 * `noteRemoteOpsApplied` writing household B's deltas as A's rows — and deleting
 * the ambient helper is what makes it unrepeatable rather than merely fixed.
 */
async function persistSession(
  state: EngineState,
  delta: LedgerDelta | 'all' | null = 'all',
  opIds: readonly string[] = [],
): Promise<void> {
  await state.store.runInTransaction(async () => {
    await persistRows(state, delta, opIds);
  });
}

async function loadIdentity(
  store: LocalFirstStore,
  dbKey: Uint8Array,
  householdId: string,
): Promise<PersistedIdentity | null> {
  const sealedB64 = await store.getMeta(identityMetaKey(householdId));
  // Null on both "absent" and "undecryptable", which is what makes the
  // `setMeta(key, '')` tombstone work — there is no `deleteMeta` on the store.
  if (!sealedB64) return null;
  try {
    const plain = aeadDecrypt(dbKey, base64ToBytes(sealedB64), IDENTITY_AAD);
    return JSON.parse(utf8Decode(plain)) as PersistedIdentity;
  } catch {
    return null;
  }
}

async function loadRowsIntoLedger(
  state: Pick<EngineState, 'dbKey' | 'store' | 'householdKeys' | 'ledger'>,
): Promise<number> {
  const stored = await state.store.listRows({ householdId: state.ledger.household.id });
  const writes: Array<{
    table: LedgerTableName;
    rowKey: string;
    deleted: boolean;
    envelope: RowEnvelope;
  }> = [];
  for (const row of stored) {
    try {
      const plain = openRowBody(
        state.dbKey,
        row.nonce,
        row.ciphertext,
        rowAad(row.householdId, row.table, row.rowKey, row.keyEpoch),
      );
      writes.push({
        table: row.table as LedgerTableName,
        rowKey: row.rowKey,
        deleted: row.deleted,
        envelope: JSON.parse(utf8Decode(plain)) as RowEnvelope,
      });
    } catch {
      console.warn('[BudgetLocal] skipping undecryptable row', row.table, row.rowKey);
    }
  }
  installRowEnvelopes(state.ledger, writes);
  return writes.length;
}

async function replayUnprojected(state: EngineState): Promise<void> {
  const pending = await state.store.listUnprojectedOperations(state.ledger.household.id);
  if (pending.length === 0) return;
  for (const op of pending) {
    try {
      const aad = utf8Encode(`${op.householdId}:${op.keyEpoch}:${op.opId}`);
      const plaintext = aeadDecrypt(state.householdKeys.hdk, op.payload, aad);
      const delta = decodeLedgerOpPayload(JSON.parse(utf8Decode(plaintext)));
      if (!delta) continue;
      applyLedgerDelta(state.ledger, delta, {
        hlc: op.hlc,
        authorMemberId: op.authorMemberId,
        opId: op.opId,
      });
    } catch {
      console.warn('[BudgetLocal] unprojected op failed to replay', op.opId);
    }
  }
  await persistRows(state, 'all', pending.map((op) => op.opId));
}

function buildHousehold(id: string, name: string): Household {
  const now = new Date().toISOString();
  return {
    id,
    name,
    address_line1: null,
    address_line2: null,
    city: null,
    state_province: null,
    postal_code: null,
    country: 'CA',
    unit_system: null,
    photo_key: null,
    photo_url: null,
    purchase_price: null,
    purchase_date: null,
    created_at: now,
    updated_at: now,
    member_count: 1,
    my_role: 'owner',
  };
}

/**
 * "This device just authored an op for household X."
 *
 * A CALLBACK rather than a direct call into the sync layer, and that is the
 * whole reason it exists: `sync/orchestrator` imports this module, so the engine
 * cannot import it back. The auto-sync module registers itself at session open
 * and deregisters at teardown, which also means a build that never syncs never
 * pays for this.
 *
 * Fired from `appendLedgerOp`, the single funnel every local write goes through
 * (`mutateLocalLedger`, the bulk paths, restore, household create). Anything
 * registered here MUST return immediately without awaiting: the call happens
 * inside `runInTransaction`, so real work started synchronously would hold a
 * SQLite write transaction open across a network round trip.
 */
type LocalWriteListener = (householdId: string) => void;
let localWriteListener: LocalWriteListener | null = null;

export function setLocalWriteListener(listener: LocalWriteListener | null): void {
  localWriteListener = listener;
}

/**
 * "N records from peers just landed in household X."
 *
 * Same callback shape and the same reason as the write listener: the sync status
 * store lives under `sync/`, which imports this module, so the engine reports
 * outward rather than reaching in.
 *
 * ROWS, not ops. A member watching a sync wants to know how much of their budget
 * has arrived, and one op can carry a single edited amount or four hundred rows
 * from a bulk import — so an op counter tells them almost nothing. This is fired
 * from both places rows enter a ledger from outside: the per-op projection
 * handler, and the checkpoint install (which is the one that matters on a join,
 * where a single "op" is the household's entire history).
 */
type RemoteApplyListener = (householdId: string, rows: number) => void;
let remoteApplyListener: RemoteApplyListener | null = null;

export function setRemoteApplyListener(listener: RemoteApplyListener | null): void {
  remoteApplyListener = listener;
}

function reportRemoteRows(householdId: string, rows: number): void {
  if (rows <= 0) return;
  try {
    remoteApplyListener?.(householdId, rows);
  } catch (error) {
    // A progress number must never be the reason a merge fails.
    console.warn('[BudgetLocal] remote-apply listener failed', error);
  }
}

async function appendLedgerOp(
  state: EngineState,
  opType: string,
  entityType: string,
  entityId: string,
  payload: unknown,
  extra?: { hlc?: string },
): Promise<StoredOperation> {
  const stored = await state.opLog.append({
    opId: createOpId(),
    authorMemberId: state.ledger.memberId,
    parents: [],
    opType,
    entityType,
    entityId,
    plaintextPayload: utf8Encode(JSON.stringify(payload)),
    ...(extra?.hlc ? { hlc: extra.hlc } : {}),
  });
  state.ledger.ops.push(stored);
  try {
    localWriteListener?.(state.householdId);
  } catch (error) {
    // A write that succeeded must never be reported as failed because the thing
    // that schedules its delivery threw. The op is durable either way; the worst
    // case is that it leaves on the next trigger instead of this one.
    console.warn('[BudgetLocal] local-write listener failed', error);
  }
  return stored;
}

/**
 * Serializes session open/close.
 *
 * Both callers are floated promises — `void import(...).then(...)` in authStore
 * on sign-in and on logout — so a fast sign-out/sign-in can run teardown and
 * open concurrently. Without a queue the open can observe the outgoing user's
 * still-live engine, and the disk-level different-user guard below never runs
 * because the early return fires first.
 */
let sessionChain: Promise<unknown> = Promise.resolve();

function queueSessionWork<T>(work: () => Promise<T>): Promise<T> {
  const next = sessionChain.then(work, work);
  // Keep the chain alive even when a link rejects; the caller still sees the error.
  sessionChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * What a device with NO ledger on disk is allowed to do.
 *
 * The engine cannot settle this itself: the fact that decides it — "does this
 * account already hold households?" — lives on the control plane, one network
 * round trip away, and the engine is the layer that must work with no network
 * at all. So the caller decides and the engine executes. Mirrors House's
 * `HouseEmptyDeviceDecision`.
 */
export type BudgetEmptyDeviceDecision =
  /** Nothing anywhere, or the question could not be asked. Mint, as before. */
  | { allowMint: true }
  /**
   * Do not mint. `adopt` names the households the account already holds: each
   * gets a session in the pending-enrolment shape a joined household has
   * between claiming an invite and the key arriving, so the member lands on
   * their REAL households (awaiting device sync) instead of on a new empty one.
   */
  | { allowMint: false; adopt?: Array<{ householdId: string; displayName?: string | null }> };

export function openLocalBudgetSession(input: {
  userId: string;
  displayName?: string | null;
  /**
   * Omitted means "mint", which is what every caller did before this existed —
   * so a caller that cannot ask the control plane keeps the old behaviour
   * rather than being stranded with no household.
   */
  decideEmptyDevice?: () => Promise<BudgetEmptyDeviceDecision>;
}): Promise<LocalBudgetLedger> {
  return queueSessionWork(() => openLocalBudgetSessionInner(input));
}

/**
 * Build a session for one household WITHOUT decrypting its rows.
 *
 * The split from hydration is the point: opening the app enumerates every
 * household the device holds (cheap — one meta read and one AEAD open each), but
 * only the active one pays cold open, which opens and parses every row. Returns
 * null for an index entry whose identity blob is missing, blanked or written by
 * a pre-Phase-3 build; the caller skips it rather than failing the whole open.
 */
async function buildSessionFromDisk(input: {
  store: LocalFirstStore;
  dbKey: Uint8Array;
  householdId: string;
  userId: string;
}): Promise<EngineState | null> {
  const parsed = await loadIdentity(input.store, input.dbKey, input.householdId);
  if (!parsed?.crypto?.hdkHex || !parsed.crypto.signingPrivateKeyHex) return null;

  const deviceId = parsed.deviceId || `dev_${input.userId.slice(0, 8)}`;
  const identity = identityFromCrypto(deviceId, parsed.crypto);
  const householdKeys: HouseholdKeys = {
    householdId: parsed.household.id,
    hdk: hexToBytes(parsed.crypto.hdkHex),
    keyEpoch: parsed.crypto.keyEpoch ?? 1,
  };
  // Rebuilt BEFORE the OpLog, not after: the log needs the ring to open ops
  // sealed under a retired epoch, and one built without it rejects every op
  // older than the last rotation as `key_epoch_mismatch`.
  const retiredHouseholdKeys = retiredKeysFromCrypto(parsed.crypto);
  const opLog = new OpLog({
    store: input.store,
    identity,
    householdKeys,
    retiredHdks: retiredHouseholdKeys,
    projection: projectionFor(parsed.household.id),
  });
  const ops = await input.store.listOperationsByHlc(parsed.household.id);
  const ledger: LocalBudgetLedger = normalizeLedger({
    version: 1,
    household: parsed.household,
    memberId: parsed.memberId,
    deviceId,
    categories: [],
    expenses: [],
    items: [],
    goals: [],
    subBudgets: [],
    transfers: [],
    ...emptyDebtTables(),
    ...emptySavingsTables(),
    ops,
    lww: {},
    conflicts: parsed.conflicts ?? [],
    pendingEnrolment: parsed.pendingEnrolment ?? false,
    crypto: cryptoBundle(identity, householdKeys, retiredHouseholdKeys),
  });
  return {
    householdId: parsed.household.id,
    dbKey: input.dbKey,
    store: input.store,
    identity,
    householdKeys,
    // Restored from the persisted bundle: a cold open after a rotation must
    // still be able to read what was sealed under the previous epoch.
    retiredHouseholdKeys,
    opLog,
    ledger,
    hydrated: false,
    // Reconstructed from the persisted flag, so an app killed mid-enrolment
    // reopens still blocked rather than authoring ops no peer can read.
    awaitingKeys: ledger.pendingEnrolment === true,
    pendingRemoteDeltas: [],
  };
}

/** Decrypt a household's rows into memory, once. Idempotent. */
async function hydrateSession(state: EngineState): Promise<EngineState> {
  if (state.hydrated) return state;
  await loadRowsIntoLedger(state);
  await replayUnprojected(state);
  state.hydrated = true;
  return state;
}

/**
 * Migrate the pre-BR-016 single-household meta layout to the namespaced one.
 *
 * House shipped nothing here, deliberately — it authorized a wipe and had no
 * client in the field holding the old shape. Budget cannot: it has live ledgers,
 * which is why `persistence.ts` archives instead of deleting after the observed
 * 2026-08-14 data-loss incident.
 *
 * Without this the failure is silent and total. A device holding the legacy
 * un-namespaced `ledger.identity.v2` has no index entry, so
 * `listPersistedHouseholds` returns [], `sessions.size === 0`, and the open
 * falls through to `mintNewHousehold` — a fresh empty household written over
 * every category, expense and budget the member had, with the real data left on
 * disk correctly sealed and permanently unreachable.
 *
 * Idempotent by construction: the index key is the marker, so once it exists
 * this costs one `getMeta` and a return, forever.
 *
 * `lf_rows` and `lf_operations` need NO data migration — they have always
 * carried `household_id`, which is the whole reason one database is enough.
 */
async function migrateLegacySingleHouseholdLayout(
  store: LocalFirstStore,
  dbKey: Uint8Array,
): Promise<void> {
  const rawIndex = await store.getMeta(HOUSEHOLDS_META);
  if (rawIndex) return;

  const legacySealed = await store.getMeta(LEGACY_IDENTITY_META);
  if (!legacySealed) return; // Fresh device, or already migrated and swept.

  let parsed: PersistedIdentity;
  try {
    parsed = JSON.parse(
      utf8Decode(aeadDecrypt(dbKey, base64ToBytes(legacySealed), IDENTITY_AAD)),
    ) as PersistedIdentity;
  } catch {
    // Undecryptable under this DEK. Leave it EXACTLY where it is: blanking it
    // destroys the only copy of a ledger a recovered key could still open, and
    // the caller degrades to the mint path either way.
    console.warn('[BudgetLocal] legacy identity blob did not decrypt — layout migration skipped');
    return;
  }

  // The id the sealed record itself describes. `HOUSEHOLD_META` is a
  // denormalized copy written by the same `persistIdentity` and is only the
  // fallback: re-keying under a stale copy would orphan the ledger exactly as
  // thoroughly as not migrating at all.
  const fromBlob = (parsed as { household?: { id?: unknown } }).household?.id;
  const householdId =
    typeof fromBlob === 'string' && fromBlob ? fromBlob : ((await store.getMeta(HOUSEHOLD_META)) ?? '');
  if (!householdId) {
    console.warn('[BudgetLocal] legacy identity carries no household id — layout migration skipped');
    return;
  }

  await store.runInTransaction(async () => {
    // Copied SEALED, byte for byte. `IDENTITY_AAD` is the constant
    // `lf-meta:identity` and carries no household, so a re-seal would buy
    // nothing and risks a re-encode that no longer round-trips.
    await store.setMeta(identityMetaKey(householdId), legacySealed);
    await store.setMeta(HOUSEHOLDS_META, JSON.stringify([householdId]));
    await store.setMeta(ACTIVE_META, householdId);
    await store.setMeta(HOUSEHOLD_META, householdId);

    // The checkpoint watermark moves with it. Left behind it is merely lost
    // (compaction stops, recoverable); left GLOBAL it would later be
    // intersected against a second household's version vector and truncate ops
    // nobody can resend, which is not.
    const legacyVv = await store.getMeta(LEGACY_CHECKPOINT_VV_META);
    if (legacyVv) {
      await store.setMeta(checkpointVvMetaKey(householdId), legacyVv);
      await store.setMeta(LEGACY_CHECKPOINT_VV_META, '');
    }

    // Blank, not delete: `LocalFirstStore` exposes no `deleteMeta`, and every
    // reader already treats '' as absent. Last on purpose — a crash before this
    // point re-runs the whole migration on the next open instead of losing the
    // source blob.
    await store.setMeta(LEGACY_IDENTITY_META, '');
  });

  console.log(`[BudgetLocal] migrated legacy single-household layout → ${householdId}`);
}

async function openLocalBudgetSessionInner(input: {
  userId: string;
  displayName?: string | null;
  decideEmptyDevice?: () => Promise<BudgetEmptyDeviceDecision>;
}): Promise<LocalBudgetLedger> {
  const open = activeHouseholdId ? sessions.get(activeHouseholdId) : null;
  if (open) {
    // An open session belongs to ONE account. Returning it without checking who
    // asked handed the new user the previous user's ledger — their spending, on
    // a household they are not a member of.
    if (open.ledger.memberId === input.userId) {
      return open.ledger;
    }
    console.log('[BudgetLocal] session open for a different user — closing before reopen');
    await closeLocalBudgetSessionInner();
  }

  let dbKeyHex = await loadDbKeyHex();
  let dbKey: Uint8Array;
  if (dbKeyHex) {
    dbKey = hexToBytes(dbKeyHex);
  } else {
    const material = createUnlockMaterial();
    dbKey = material.localDatabaseKey;
    await saveDbKeyHex(bytesToHex(dbKey));
  }

  const store = await openBudgetLocalFirstStore(dbKey);
  const storedMemberId = await store.getMeta(MEMBER_META);
  if (storedMemberId && storedMemberId !== input.userId) {
    // Take the outgoing member's ledger out of reach WITHOUT shredding it —
    // this used to delete the database and its key outright, so one unexpected
    // account switch permanently destroyed every category, expense and budget
    // on the device with no warning and no export.
    await store.close();
    const label = storedMemberId.replace(/[^a-zA-Z0-9]/g, '');
    const archivedPath = await archiveLocalBudgetPersistence(label);
    console.log(
      `[BudgetLocal] different user on this device — ledger for ${storedMemberId} ${
        archivedPath ? 'archived, not deleted' : 'had nothing to archive'
      }; minting a fresh one`,
    );
    const material = createUnlockMaterial();
    dbKey = material.localDatabaseKey;
    dbKeyHex = bytesToHex(dbKey);
    await saveDbKeyHex(dbKeyHex);
    const fresh = await openBudgetLocalFirstStore(dbKey);
    return openEmptyDevice(input, dbKey, fresh);
  }

  // BEFORE anything reads the index, and after the different-account guard —
  // migrating a ledger that is about to be archived would be wasted work, and
  // the archive branch above returns with a fresh store anyway.
  await migrateLegacySingleHouseholdLayout(store, dbKey);

  // Enumerate every household this device holds, cheaply; hydrate only one.
  const known = await listPersistedHouseholds(store);
  for (const householdId of known) {
    if (sessions.has(householdId)) continue;
    const session = await buildSessionFromDisk({ store, dbKey, householdId, userId: input.userId });
    if (session) sessions.set(householdId, session);
  }

  // Genuinely nothing on disk — first launch, or an index whose every identity
  // blob is unreadable. The migration above is what keeps a legacy device out of
  // this branch, because reaching it with real data on disk is a silent wipe.
  if (sessions.size === 0) {
    return openEmptyDevice(input, dbKey, store);
  }

  const preferred = (await store.getMeta(ACTIVE_META)) ?? known[0]!;
  const target = sessions.has(preferred) ? preferred : [...sessions.keys()][0]!;
  activeHouseholdId = target;
  await hydrateSession(sessions.get(target)!);
  return sessions.get(target)!.ledger;
}

/**
 * A device with no ledger at all mints its own private household.
 *
 * The only path that generates a NEW device identity — this is the device's
 * first-ever session. `createLocalBudgetHousehold` reuses it, because one device
 * has one keypair no matter how many households it belongs to.
 */
/**
 * What a device with no ledger for this account does about it.
 *
 * Minting unconditionally is what made a fresh install look like data loss: the
 * account already held households, the device knew nothing of them, so it
 * created a NEW empty one, registered it on the control plane, and showed the
 * member an empty budget with sync reporting success. It was syncing correctly
 * — just a household that genuinely had nothing in it.
 *
 * So the caller is asked first. When the account already holds households they
 * are adopted in the pending-enrolment shape a joined household has between
 * claiming an invite and the key arriving: the member sees their real
 * households, and the first peer to come online wraps the key and backfills.
 *
 * NARROWER than House on purpose. House refuses to open at all when it cannot
 * reach the control plane; Budget still mints there, because `openLocalBudgetSession`
 * promises a ledger to every caller and teaching them all to handle "nothing
 * opened" is a far larger change than the bug being fixed. Offline first-launch
 * therefore behaves exactly as it did before.
 */
async function openEmptyDevice(
  input: {
    userId: string;
    displayName?: string | null;
    decideEmptyDevice?: () => Promise<BudgetEmptyDeviceDecision>;
  },
  dbKey: Uint8Array,
  store: LocalFirstStore,
): Promise<LocalBudgetLedger> {
  const decision = input.decideEmptyDevice
    ? await input.decideEmptyDevice()
    : ({ allowMint: true } as const);

  const adopt = decision.allowMint ? [] : (decision.adopt ?? []);
  if (adopt.length === 0) return mintNewHousehold(input, dbKey, store);

  // ONE device identity across every household adopted here, matching a device
  // that grew its households one at a time (a join reuses the current
  // identity). A per-household keypair would make the member's own households
  // see each other as different devices.
  const deviceId = `dev_${bytesToHex(randomBytes(6))}`;
  const identity = generateDeviceIdentity(deviceId);
  for (const household of adopt) {
    await adoptHouseholdSession({
      householdId: household.householdId,
      displayName: household.displayName,
      store,
      dbKey,
      identity,
      memberId: input.userId,
      deviceId,
    });
  }

  // Each adopt activates itself (it is written for the join, where the member
  // has just walked into that household); land on the first instead, so a
  // member with three households opens the same one every launch rather than
  // whichever the control plane happened to list last.
  const primary = adopt[0]!.householdId;
  activeHouseholdId = primary;
  await store.setMeta(ACTIVE_META, primary);
  await store.setMeta(HOUSEHOLD_META, primary);
  notifyLedgerChanged(LEDGER_TABLE_NAMES, primary);
  return sessions.get(primary)!.ledger;
}

async function mintNewHousehold(
  input: { userId: string; displayName?: string | null },
  dbKey: Uint8Array,
  store: LocalFirstStore,
): Promise<LocalBudgetLedger> {
  const householdId = `hh_local_${bytesToHex(randomBytes(8))}`;
  const deviceId = `dev_${bytesToHex(randomBytes(6))}`;
  const identity = generateDeviceIdentity(deviceId);
  const householdKeys = generateHouseholdKeys(householdId, 1);
  const opLog = new OpLog({ store, identity, householdKeys, projection: projectionFor(householdId) });
  const household = buildHousehold(
    householdId,
    input.displayName?.trim() || 'My household',
  );

  const ledger: LocalBudgetLedger = {
    version: 1,
    household,
    memberId: input.userId,
    deviceId,
    categories: defaultCategories(householdId),
    expenses: [],
    items: [],
    goals: [],
    subBudgets: [],
    transfers: [],
    ...emptyDebtTables(),
    ...emptySavingsTables(),
    ops: [],
    lww: {},
    conflicts: [],
    crypto: cryptoBundle(identity, householdKeys),
  };

  const session: EngineState = {
    householdId,
    dbKey,
    store,
    identity,
    householdKeys,
    retiredHouseholdKeys: new Map(),
    opLog,
    ledger,
    // Minted in memory, so hydrated by construction — there is nothing on disk
    // to read back.
    hydrated: true,
    awaitingKeys: false,
    pendingRemoteDeltas: [],
  };
  sessions.set(householdId, session);
  activeHouseholdId = householdId;
  await appendLedgerOp(session, 'HOUSEHOLD_CREATE', 'household', householdId, {
    name: household.name,
  });
  const createdId = session.ledger.ops[session.ledger.ops.length - 1]?.opId;
  await persistSession(session, 'all', createdId ? [createdId] : []);
  await store.setMeta(ACTIVE_META, householdId);
  return ledger;
}

async function closeLocalBudgetSessionInner(): Promise<void> {
  if (sessions.size === 0) return;
  // Every session shares ONE store (one SQLite file, one DEK), so it is closed
  // once, not once per household. The per-session state — awaitingKeys,
  // pendingRemoteDeltas — dies with the sessions themselves.
  const store = [...sessions.values()][0]!.store;
  sessions.clear();
  activeHouseholdId = null;
  await store.close();
}

export function closeLocalBudgetSession(): Promise<void> {
  return queueSessionWork(closeLocalBudgetSessionInner);
}

/** Close every household. Alias kept explicit so callers read as they intend. */
export function closeAllLocalBudgetSessions(): Promise<void> {
  return closeLocalBudgetSession();
}

export function resetLocalBudgetSession(): Promise<void> {
  return queueSessionWork(async () => {
    await closeLocalBudgetSessionInner();
    await clearLocalBudgetPersistence();
  });
}

// ---------------------------------------------------------------------------
// Multi-household session manager (BR-016 B2/B5)
// ---------------------------------------------------------------------------

export type BudgetHouseholdSummary = {
  householdId: string;
  /** This device's id — the same for every household; one device, one identity. */
  deviceId: string;
  name: string;
  role: string;
  isActive: boolean;
  /** False until this household's rows have been decrypted into memory. */
  hydrated: boolean;
  awaitingEnrolment: boolean;
  /**
   * The household's whole sealed record — photo key, address, timestamps.
   *
   * A COPY, never the live object: `useHouseholdStore` deep-freezes what it
   * stores and `ledger.household` is the engine's own mutable record (see the
   * note in `ensureSession.syncHouseholdStoreFromLocalLedger`).
   *
   * It costs nothing to carry: the identity blob is already decrypted for every
   * session at cold open, which is where `name` and `role` above come from. It
   * exists because `name` and `role` alone were all a background household could
   * publish, so a device that had not yet activated a household showed it with
   * no photo and no address — fields that were sitting right there.
   */
  record: Household;
};

/**
 * Every household this device holds, active first-class rather than implied.
 *
 * Synchronous, and reads only cold-session fields, so a switcher renders the
 * whole list without hydrating anything.
 */
export function listLocalBudgetHouseholds(): BudgetHouseholdSummary[] {
  return [...sessions.values()].map((session) => ({
    householdId: session.householdId,
    deviceId: session.ledger.deviceId,
    name: String(session.ledger.household.name ?? ''),
    role: String(session.ledger.household.my_role ?? 'member'),
    isActive: session.householdId === activeHouseholdId,
    hydrated: session.hydrated,
    awaitingEnrolment: session.awaitingKeys,
    record: { ...session.ledger.household },
  }));
}

export function getActiveBudgetHouseholdId(): string | null {
  return activeHouseholdId;
}

/**
 * Does this device hold a session for that household at all?
 *
 * The distinction `isAwaitingHouseholdEnrolment` cannot draw: it answers false
 * both for a household that finished enrolling and for one that is not here —
 * dropped, never adopted, or named by a stale id. Callers deciding whether a
 * wait ended in success need to tell those apart, because "no longer waiting"
 * on a household that is GONE is not an enrolment, it is an abandonment.
 */
export function hasLocalBudgetHousehold(householdId: string): boolean {
  return sessions.has(householdId);
}

/**
 * A live handle on ONE household's session.
 *
 * Everything sync needs, bound to a household rather than to "whatever is
 * active". The global `getLocal*` accessors read the active session, which is
 * right for the UI and catastrophically wrong for a background sync: it would
 * seal household B's ops under A's HDK and address them to A's peers. Sync uses
 * this instead, and must RE-READ it after enrolment, because installing an HDK
 * swaps both `householdKeys` and `opLog` and this is a snapshot copy.
 */
export type BudgetSessionHandle = {
  householdId: string;
  ledger: LocalBudgetLedger;
  identity: DeviceIdentity;
  householdKeys: HouseholdKeys;
  /** Epochs this device held for this household before the current one. */
  retiredHouseholdKeys: Map<number, Uint8Array>;
  opLog: OpLog;
  store: LocalFirstStore;
  awaitingEnrolment: boolean;
};

/** Hydrates on demand — background sync gets real rows, not an empty ledger. */
export async function getLocalBudgetSession(householdId: string): Promise<BudgetSessionHandle> {
  const session = await hydrateSession(requireSession(householdId));
  return {
    householdId: session.householdId,
    ledger: session.ledger,
    identity: session.identity,
    householdKeys: session.householdKeys,
    retiredHouseholdKeys: session.retiredHouseholdKeys,
    opLog: session.opLog,
    store: session.store,
    awaitingEnrolment: session.awaitingKeys,
  };
}

/** Conflicts for one household, whether or not it is active. */
export function getLocalConflictsFor(householdId: string): LedgerConflict[] {
  return requireSession(householdId).ledger.conflicts ?? [];
}

/** The ledger for a household, whether or not it is active. Hydrates on demand. */
export async function getLocalLedgerFor(householdId: string): Promise<LocalBudgetLedger> {
  const session = await hydrateSession(requireSession(householdId));
  return session.ledger;
}

/**
 * Add a second (third, …) household to this device.
 *
 * Reuses the DEVICE identity — one device, one keypair, registered per household
 * on the control plane. Only the HDK is new, because the new household is a new
 * membership with its own key epoch.
 *
 * It does NOT activate. Creating and switching are separate acts and the caller
 * decides; follow it with `activateLocalBudgetHousehold(...)` to land in it.
 *
 * `details` is how a household arrives already carrying its photo and address:
 * the create form asks for all three at once, and applying them here — inside
 * the same sealed identity write that mints the household — means there is no
 * window in which a just-created household exists with only a name, and no
 * second save that can fail on its own.
 */
export function createLocalBudgetHousehold(input: {
  displayName?: string | null;
  details?: LocalHouseholdEdits;
}): Promise<LocalBudgetLedger> {
  return queueSessionWork(async () => {
    const current = requireEngine();
    const householdId = `hh_local_${bytesToHex(randomBytes(8))}`;
    const identity = current.identity;
    const householdKeys = generateHouseholdKeys(householdId, 1);
    const opLog = new OpLog({
      store: current.store,
      identity,
      householdKeys,
      projection: projectionFor(householdId),
    });
    const household: Household = {
      ...buildHousehold(householdId, input.displayName?.trim() || 'My household'),
      ...(input.details ?? {}),
      // The id and the name are the engine's, never the caller's: `details` is a
      // record patch and a stray `id` in it would mint a household whose sealed
      // record disagrees with the session that holds it.
      id: householdId,
      name: input.displayName?.trim() || input.details?.name?.trim() || 'My household',
    };

    const ledger: LocalBudgetLedger = {
      version: 1,
      household,
      memberId: current.ledger.memberId,
      deviceId: current.ledger.deviceId,
      // Seeded like a minted household: the 10 default categories, in the ONE
      // creation op. Looping single writes here is quadratic — every
      // `mutateLocalLedger` re-captures and re-diffs the whole ledger.
      categories: defaultCategories(householdId),
      expenses: [],
      items: [],
      goals: [],
      subBudgets: [],
      transfers: [],
      ...emptyDebtTables(),
      ...emptySavingsTables(),
      ops: [],
      lww: {},
      conflicts: [],
      crypto: cryptoBundle(identity, householdKeys),
    };

    const session: EngineState = {
      householdId,
      dbKey: current.dbKey,
      store: current.store,
      identity,
      householdKeys,
      retiredHouseholdKeys: new Map(),
      opLog,
      ledger,
      hydrated: true,
      awaitingKeys: false,
      pendingRemoteDeltas: [],
    };
    sessions.set(householdId, session);
    await appendLedgerOp(session, 'HOUSEHOLD_CREATE', 'household', householdId, {
      name: household.name,
    });
    const createdId = session.ledger.ops[session.ledger.ops.length - 1]?.opId;
    await persistSession(session, 'all', createdId ? [createdId] : []);
    return ledger;
  });
}

/**
 * Per-household meta written by modules OTHER than this one, listed here
 * because this is the only place a household is taken off the device and a
 * watermark left behind outlives everything it describes.
 *
 * The strings are duplicated rather than imported: both owners import the
 * engine, and closing that loop to reach a key builder is not worth a cycle.
 * `multiHousehold.test.ts` pins them, and each owner carries a comment pointing
 * back here.
 *
 * Not cosmetic. A member who leaves a household and is later invited back gets
 * the SAME household id, and `lf.checkpoint.vv` is what
 * `tryInstallLatestCheckpoint` reads to decide it is "already holding
 * everything in gen=N" — a stale one closes the fresh ledger's single bootstrap
 * window, and the rejoined device sits empty over a household that has data.
 */
const FOREIGN_HOUSEHOLD_META_KEYS = [
  /** `sync/checkpoints.ts` — publishedEpochMetaKey. */
  (householdId: string) => `lf.checkpoint.epoch:${householdId}`,
  /** `controlPlaneClient.ts` — registeredMetaKey. */
  (householdId: string) => `lf.cp.registered:${householdId}`,
];

/**
 * Drop a household from this device: its rows, its identity and key material,
 * its sync cursors, its watermarks and its index entry — leaving every other
 * household untouched.
 *
 * This is the ONLY path that clears rows. `adoptJoinedHousehold` used to, which
 * is how joining destroyed the member's existing budget; removal is now an
 * explicit act with an explicit call.
 *
 * It is also what "leave this household" is built on, and that is why the
 * cleanup has to be total rather than merely enough to hide the household: the
 * promise made to the member at the confirm is that everything of that
 * household's is gone from this phone.
 */
export function removeLocalBudgetHousehold(householdId: string): Promise<void> {
  return queueSessionWork(async () => {
    const session = requireSession(householdId);
    if (sessions.size === 1) {
      throw new Error('removeLocalBudgetHousehold: cannot remove the last household');
    }
    await session.store.clearSyncPeerStates(householdId);
    await session.store.clearRows(householdId);
    // The identity blob carries this household's device keypair AND its
    // household key ring, so blanking it is what makes the erasure real rather
    // than a matter of the rows being unreachable.
    await session.store.setMeta(identityMetaKey(householdId), '');
    await session.store.setMeta(checkpointVvMetaKey(householdId), '');
    // Left behind, a stale "1" would put a household the member re-joins into a
    // backfill it has already completed; left behind on the other side, a stale
    // '' would deny the re-join its backfill entirely. Both are wrong, so the
    // key is cleared with the rest of the household.
    await session.store.setMeta(bootstrapPendingMetaKey(householdId), '');
    for (const key of FOREIGN_HOUSEHOLD_META_KEYS) {
      await session.store.setMeta(key(householdId), '');
    }
    await forgetHousehold(session.store, householdId);
    sessions.delete(householdId);
    if (activeHouseholdId === householdId) {
      const next = [...sessions.keys()][0]!;
      activeHouseholdId = next;
      await hydrateSession(sessions.get(next)!);
      await session.store.setMeta(ACTIVE_META, next);
      await session.store.setMeta(HOUSEHOLD_META, next);
      notifyLedgerChanged(LEDGER_TABLE_NAMES, next);
    }
  });
}

/**
 * Give up a claim that can never be approved, and take the half-joined
 * household off this device with it.
 *
 * `adoptJoinedHousehold` registers the claimed household immediately and makes
 * it ACTIVE, holding a throwaway key until the owner approves. That is right
 * while the wait is live. Once the invite is revoked or expired the wait can
 * never end, and what is left behind is worse than useless: a household whose
 * every request the control plane answers 403 (`state`, `mailbox`, `devices`,
 * `join-requests` — 194 of them in one staging session), a members list with
 * nobody in it, and — because every join control is disabled while this device
 * is awaiting enrolment — no way to claim the replacement invite the owner has
 * already sent. The device is not waiting at that point; it is stuck.
 *
 * Dropping is safe precisely because the household never held anything: no HDK
 * ever arrived, so there are no readable rows and nothing of the person's to
 * lose. It is the same removal the member can perform by hand, done for them at
 * the moment the reason to keep it disappears.
 *
 * Refuses to touch a household that is NOT awaiting keys — an enrolled
 * household holds real money data and only an explicit act may remove it — and
 * refuses to drop the last one, which would leave the app with no ledger at
 * all. Returns whether anything was dropped.
 */
export async function abandonHouseholdEnrolment(householdId: string): Promise<boolean> {
  const session = sessions.get(householdId);
  if (!session?.awaitingKeys) return false;
  // Unreachable in practice — adopting requires an open session to adopt
  // BESIDE — but a device with one household and nothing to fall back to is
  // better left stuck than left empty.
  if (sessions.size === 1) return false;
  // NOT wrapped in `queueSessionWork`: the removal takes the chain itself, and
  // taking it twice would queue the inner link behind the outer one forever.
  await removeLocalBudgetHousehold(householdId);
  return true;
}

/**
 * Activation itself, WITHOUT taking the session chain.
 *
 * Split out so `runOnHousehold` can activate from inside a link it is already
 * holding: re-entering `queueSessionWork` there would queue the activation behind
 * the very link that is awaiting it, and the app would hang on the first write to
 * a background household. Everything that is not already inside the chain must
 * call the queued export below, never this.
 */
async function activateLocalBudgetHouseholdInner(
  householdId: string,
): Promise<LocalBudgetLedger> {
  const session = requireSession(householdId);
  await hydrateSession(session);
  activeHouseholdId = householdId;
  await session.store.setMeta(ACTIVE_META, householdId);
  await session.store.setMeta(HOUSEHOLD_META, householdId);
  notifyLedgerChanged(LEDGER_TABLE_NAMES, householdId);
  return session.ledger;
}

/**
 * Make a household the active one, hydrating it if this is its first activation.
 *
 * Cheap on re-activation: a hydrated session keeps its rows, so switching back
 * and forth costs nothing after the first visit to each household. The
 * whole-table notification is honest here — every visible number changed.
 */
export function activateLocalBudgetHousehold(householdId: string): Promise<LocalBudgetLedger> {
  return queueSessionWork(() => activateLocalBudgetHouseholdInner(householdId));
}

/**
 * The household a live `runOnHousehold` link has pinned, and the calls riding
 * along inside that pin. Both are null/empty whenever no link is in flight.
 *
 * `pinnedHouseholdId` is set only AFTER activation has completed and cleared only
 * after every rider has settled, so its non-null value carries a real guarantee
 * rather than an intention: `activeHouseholdId === pinnedHouseholdId`, and the
 * session chain is held, so nothing can move the active pointer until it clears.
 */
let pinnedHouseholdId: string | null = null;
let pinnedRiders: Promise<unknown>[] = [];

/** Riders are awaited for completion, never for their value — errors ride home with the caller. */
const settled = () => undefined;

/**
 * Run `work` with `householdId` active, holding the session chain across BOTH the
 * activation and the work (BR-016 B5).
 *
 * This exists because the seven facades each carried their own
 * `withHousehold(id, run)` — `if (active !== id) await activate(id); return run()`
 * — and that shape is racy in a way that corrupts data. Activation is queued on
 * the session chain; `mutateLocalLedger` is not, and it binds `requireEngine()`
 * synchronously when it is called. So two facade calls for DIFFERENT households
 * left in flight together interleave at the first `await` inside `run`:
 *
 *     A: (hh1 already active) run() ─ await getLocalLedgerFor ──┐
 *     B:            await activate(hh2) ── activeHouseholdId=hh2 ┤
 *     A:                          mutateLocalLedger → requireEngine() → hh2
 *
 * and household A's expense is authored into household B's ledger — sealed under
 * B's HDK, verifying, syncing to B's peers, invisible to every integrity check
 * the engine has. A per-facade queue could not have fixed it either: savings,
 * wishes, loans and mortgage all write the same ledger, so the lock has to live
 * where the ledger does.
 *
 * ## Why riders, instead of simply queueing everything
 *
 * Queueing `work` unconditionally deadlocks on the nesting that already exists:
 * `recordPlannedSpending` awaits `addExpense`, `confirmIncome` awaits
 * `updateIncome`, `commitImport` awaits `setMemberLine` — each an outer link
 * awaiting an inner call that would be queued behind it. Those compositions are
 * deliberate (one gesture must not be split across a household switch), so the
 * lock has to admit them.
 *
 * A "am I nested?" flag cannot decide this. Hermes has no async-context
 * primitive, and a module-level flag cannot tell a NESTED call from an unrelated
 * SIBLING call that arrived while the link sat at an `await` — the two are
 * indistinguishable from inside the callee.
 *
 * So the guard asks the question that actually matters instead: *is the household
 * I want already active and pinned by a live link?* If it is, running inline is
 * correct for BOTH cases — nested or sibling, the household cannot change
 * underneath the work, because the link holding the chain does not release it
 * until every rider it admitted has settled. Two calls for the same household
 * overlapping is not a hazard; they were never mutually exclusive before this and
 * they share one ledger by definition. Two calls for different households
 * overlapping is the hazard, and that pair can never both be riders.
 *
 * The one shape this cannot serve is a nested call naming a DIFFERENT household,
 * which would queue behind its own parent and hang. That is not a call anyone has
 * a reason to write — nesting means "one gesture, one household" — and refusing
 * it is impossible to distinguish from the sibling case that MUST wait, which is
 * the whole point of the lock.
 */
export async function runOnHousehold<T>(
  householdId: string,
  work: () => Promise<T>,
): Promise<T> {
  if (pinnedHouseholdId === householdId) {
    // Registered synchronously, before any `await` — a rider that announced
    // itself one tick late could be admitted after the link had already drained
    // and released, which is the hole this whole function exists to close.
    const running = work();
    pinnedRiders.push(running.then(settled, settled));
    return running;
  }

  return queueSessionWork(async () => {
    if (activeHouseholdId !== householdId) {
      await activateLocalBudgetHouseholdInner(householdId);
    } else {
      // Already active: skip activation rather than re-running it. Its tail is
      // `notifyLedgerChanged(LEDGER_TABLE_NAMES, …)`, a whole-ledger
      // invalidation, and firing that on every write would repaint every Budget
      // screen once per edited row. `requireSession` keeps the refusal the old
      // facade helper got from `activateLocalBudgetHousehold`: an id this device
      // holds no ledger for fails HERE, with
      // `BudgetLocalUnknownHouseholdError`, rather than writing into whatever
      // happened to be active.
      requireSession(householdId);
    }

    // After activation, never before. A rider admitted while the activation was
    // still in flight would run against the OUTGOING household — the same
    // cross-household write, one layer down.
    pinnedHouseholdId = householdId;
    try {
      return await work();
    } finally {
      try {
        // Drain in waves: a rider can admit further riders (nested compositions
        // do exactly that), and the pin may not clear while any of them is still
        // mid-write. Rejections were neutralized at registration, so this settles
        // rather than throwing over the caller's own error.
        while (pinnedRiders.length > 0) {
          const batch = pinnedRiders;
          pinnedRiders = [];
          await Promise.all(batch);
        }
      } finally {
        pinnedHouseholdId = null;
      }
    }
  });
}

/**
 * Move a live session from one household id to another, keeping the SAME
 * `EngineState` object so nothing holding a reference goes stale.
 *
 * Only the restore path needs this, and it needs it badly. Under the old single
 * global identity key a household-replacing restore could swap
 * `ledger.household.id` and nothing else had to move. Under per-household keys
 * that silently orphans the ledger: the blob keeps being written to
 * `identityMetaKey(oldId)` while it describes the NEW id, so the next cold open
 * builds a session whose `householdId` disagrees with its own map key.
 *
 * The write order is the safety property. New identity FIRST, old one blanked
 * after — reversed, a crash in between leaves an index entry with no identity
 * blob behind it, the next cold open reads that as "no households", and the
 * member is wiped through a different door than the one §4's migration guards.
 */
async function rekeySessionTo(state: EngineState, nextHouseholdId: string): Promise<void> {
  const previousHouseholdId = state.householdId;
  if (previousHouseholdId === nextHouseholdId) return;

  state.householdId = nextHouseholdId;
  state.householdKeys = { ...state.householdKeys, householdId: nextHouseholdId };
  state.opLog = new OpLog({
    store: state.store,
    identity: state.identity,
    householdKeys: state.householdKeys,
    retiredHdks: state.retiredHouseholdKeys,
    projection: projectionFor(nextHouseholdId),
  });
  sessions.delete(previousHouseholdId);
  sessions.set(nextHouseholdId, state);
  if (activeHouseholdId === previousHouseholdId) activeHouseholdId = nextHouseholdId;

  await persistIdentity(state);
  await state.store.setMeta(identityMetaKey(previousHouseholdId), '');
  await forgetHousehold(state.store, previousHouseholdId);
  if (activeHouseholdId === nextHouseholdId) {
    await state.store.setMeta(ACTIVE_META, nextHouseholdId);
  }
}

/**
 * The one write path, and it writes to the ACTIVE household only.
 *
 * Deliberately has no `forHouseholdId`: a caller that could write to a
 * background household would be one `await` away from putting B's expense in A's
 * ledger. Writing to a non-active household goes through `runOnHousehold(id,
 * work)`, which activates first or refuses (BR-016 B5).
 *
 * It binds `requireEngine()` SYNCHRONOUSLY, which is why `runOnHousehold` has to
 * hold the session chain across the whole of `work` rather than just the
 * activation: between an `await` inside `work` and this line, a sibling call's
 * activation is free to move the active pointer, and this would then write into
 * the household it moved to.
 */
export async function mutateLocalLedger(
  mutator: (ledger: LocalBudgetLedger) => void,
  op: { opType: string; entityType: string; entityId: string; payload: unknown },
): Promise<LocalBudgetLedger> {
  const state = requireEngine();
  if (state.awaitingKeys) {
    throw new BudgetLocalEnrolmentPendingError();
  }
  // Snapshot BEFORE the mutator: mutators edit rows in place, so the pre-image
  // has to be materialized eagerly or the diff has nothing to compare against.
  const before = captureLedgerSnapshot(state.ledger);
  mutator(state.ledger);
  state.ledger.household.updated_at = new Date().toISOString();
  const delta = diffLedger(before, state.ledger);
  await state.store.runInTransaction(async () => {
    await appendLedgerOp(
      state,
      op.opType,
      op.entityType,
      op.entityId,
      encodeLedgerOpPayload(op.payload, delta),
    );
    const opId = state.ledger.ops[state.ledger.ops.length - 1]?.opId;
    await persistRows(state, delta ?? null, opId ? [opId] : []);
  });
  // Publish only after persistence succeeds. Every local facade uses this
  // boundary, so imports and edits refresh forecasts without caller markDirty.
  if (delta) notifyLedgerChanged(tablesInDelta(delta), state.householdId);
  return state.ledger;
}

/**
 * Device-local backup restore: merge backup tables through LWW with a synthetic
 * ancient stamp so live field writes and tombstones win (D-20). The op payload
 * carries a real delta so peers converge instead of silently forking.
 */
export async function applyLocalLedgerRestore(
  backup: LocalBudgetLedger,
  op: { entityId: string; payload: Record<string, unknown>; replaceHousehold?: boolean },
): Promise<LocalBudgetLedger> {
  const state = requireEngine();
  if (state.awaitingKeys) {
    throw new BudgetLocalEnrolmentPendingError();
  }
  if (op.replaceHousehold && backup.household) {
    state.ledger.household = backup.household;
    // `memberId` is DELIBERATELY not taken from the backup. It identifies who
    // is signed in on THIS device, and `openLocalBudgetSession` compares the
    // persisted copy against the caller's `userId`: anything else reads as
    // "different user on this device" and retires the ledger on the very next
    // launch. A migration archive (`mig_*`) carries the server-side member id,
    // which can never equal a local user id — so adopting it turned every
    // household-replacing restore into a one-launch fuse that archived the data
    // it had just restored (observed 2026-08-16: restored 12:58, retired 13:10).
    // The household is the backup's; the member is this device's.
    //
    // A replacing restore can carry a DIFFERENT household id, and under
    // per-household meta keys the session has to follow it or the identity blob
    // is written under a key that no longer describes it. See `rekeySessionTo`.
    await rekeySessionTo(state, state.ledger.household.id);
  }
  state.ledger.household.updated_at = new Date().toISOString();

  const delta = restoreDeltaFromBackup(state.ledger, backup);
  const restoreEpoch =
    typeof op.payload.restoreEpoch === 'number' ? op.payload.restoreEpoch : Date.now();
  const chunks = delta ? chunkLedgerDelta(delta) : [];
  const opIds: string[] = [];

  await state.store.runInTransaction(async () => {
    if (chunks.length === 0) {
      const stored = await appendLedgerOp(
        state,
        'BACKUP_RESTORE',
        'household',
        op.entityId,
        encodeLedgerOpPayload({ ...op.payload, restoreEpoch }, { v: 1 }),
        { hlc: RESTORE_HLC },
      );
      opIds.push(stored.opId);
    } else {
      for (const chunk of chunks) {
        const stored = await appendLedgerOp(
          state,
          'BACKUP_RESTORE',
          'household',
          op.entityId,
          encodeLedgerOpPayload({ ...op.payload, restoreEpoch }, chunk),
          { hlc: RESTORE_HLC },
        );
        opIds.push(stored.opId);
      }
    }
    drainParkedRows(state.ledger);
    await persistRows(state, delta ?? 'all', opIds);
  });
  // A restore can touch any table, so this is one of the few legitimate
  // whole-ledger invalidations.
  notifyLedgerChanged(LEDGER_TABLE_NAMES, state.householdId);
  return state.ledger;
}

/**
 * Record ops that sync already verified, decrypted and projected (the OpLog's
 * projection handler runs inside `applyRemote`), then persist the merged
 * ledger so a relaunch keeps the peer's changes.
 *
 * `forHouseholdId` is not optional decoration — this used to resolve the ACTIVE
 * session and drain a module-global delta buffer, so a background sync of
 * household B persisted B's deltas as A's rows: correctly sealed, wrong
 * household, invisible until the two diverged (plan §2 hazard 3).
 */
export async function noteRemoteOpsApplied(
  ops: StoredOperation[],
  forHouseholdId?: string,
): Promise<void> {
  const state = forHouseholdId ? requireSession(forHouseholdId) : requireEngine();
  for (const op of ops) {
    if (!state.ledger.ops.some((existing) => existing.opId === op.opId)) {
      state.ledger.ops.push(op);
    }
  }
  // Drain-then-clear BEFORE the transaction opens: a concurrent `projectionFor`
  // apply during the transaction pushes onto the fresh array and is not lost.
  const deltas = state.pendingRemoteDeltas;
  state.pendingRemoteDeltas = [];
  await state.store.runInTransaction(async () => {
    if (deltas.length === 0) {
      await persistIdentity(state);
    } else {
      for (const delta of deltas) {
        await persistRows(state, delta);
      }
    }
    await state.store.markProjected(
      ops.map((op) => op.opId),
      Date.now(),
    );
  });
}

/**
 * Bind this device to a household it just joined (BR-011), as an ADDITION
 * (BR-016 B6).
 *
 * This used to REPLACE: it rebound the one session to the joined id and then
 * called `clearRows`/`clearSyncPeerStates` on the household the member was
 * standing in. That was defensible only while the engine could hold exactly one
 * household — accepting an invite destroyed every category, expense and budget
 * on the device, and the invite screen had to warn about it. With a registry
 * there is nothing to trade: the joined household becomes a NEW session
 * alongside the existing ones, and the member keeps both.
 *
 * The device identity and keypair are reused — one device, one keypair,
 * registered per household on the control plane. The shared history then arrives
 * as ops from peers (TRD §8.3 bootstrap), which is why the tables start empty
 * and why there are no default categories here: seeding 10 locally-invented
 * categories into a household that already has its own would push ten duplicates
 * at every peer the moment the HDK lands.
 */
export async function adoptJoinedHousehold(input: {
  householdId: string;
  displayName?: string | null;
}): Promise<LocalBudgetLedger> {
  const current = requireEngine();
  return adoptHouseholdSession({
    householdId: input.householdId,
    displayName: input.displayName,
    store: current.store,
    dbKey: current.dbKey,
    identity: current.identity,
    memberId: current.ledger.memberId,
    deviceId: current.ledger.deviceId,
  });
}

/**
 * Build a pending-enrolment session for one household, WITHOUT requiring an
 * open session to build it beside.
 *
 * Split out of `adoptJoinedHousehold` so an empty device can adopt too: a join
 * borrows the open session's store/identity, but a device recovering an account
 * has no session to borrow from and must be handed them. Everything else — the
 * throwaway key, `awaitingKeys`, the bootstrap-pending marker — is identical,
 * because a recovered household and a joined one are in exactly the same state:
 * known, listed, and waiting for the key to arrive.
 */
async function adoptHouseholdSession(input: {
  householdId: string;
  displayName?: string | null;
  store: LocalFirstStore;
  dbKey: Uint8Array;
  identity: DeviceIdentity;
  memberId: string;
  deviceId: string;
}): Promise<LocalBudgetLedger> {
  // Idempotent: claiming the same invite twice, or joining a household this
  // device already holds, activates it rather than building a second session
  // over the top of the first.
  const existing = sessions.get(input.householdId);
  if (existing) {
    activeHouseholdId = input.householdId;
    await existing.store.setMeta(ACTIVE_META, input.householdId);
    await existing.store.setMeta(HOUSEHOLD_META, input.householdId);
    notifyLedgerChanged(LEDGER_TABLE_NAMES, input.householdId);
    return existing.ledger;
  }

  const household = buildHousehold(
    input.householdId,
    input.displayName?.trim() || 'Shared household',
  );
  household.my_role = 'member';

  // A THROWAWAY key, not the current household's.
  //
  // House carries the pre-join HDK across because its join replaces the session
  // and the key is about to be overwritten anyway. Adding a session cannot do
  // that: copying household A's key bytes into household B's sealed identity
  // blob is precisely the cross-household key smear BR-016 exists to prevent.
  // Nothing is ever sealed with this — `awaitingKeys` refuses every write until
  // the real wrap arrives, and rows are sealed with the device DEK, not the HDK.
  const householdKeys = generateHouseholdKeys(input.householdId, 1);
  const opLog = new OpLog({
    store: input.store,
    identity: input.identity,
    householdKeys,
    projection: projectionFor(input.householdId),
  });

  const ledger: LocalBudgetLedger = {
    version: 1,
    household,
    memberId: input.memberId,
    deviceId: input.deviceId,
    categories: [],
    expenses: [],
    items: [],
    goals: [],
    subBudgets: [],
    transfers: [],
    ...emptyDebtTables(),
    ...emptySavingsTables(),
    ops: [],
    lww: {},
    conflicts: [],
    pendingEnrolment: true,
    crypto: cryptoBundle(input.identity, householdKeys),
  };

  const session: EngineState = {
    householdId: input.householdId,
    dbKey: input.dbKey,
    store: input.store,
    identity: input.identity,
    householdKeys,
    retiredHouseholdKeys: new Map(),
    opLog,
    ledger,
    // Built in memory and empty; there is nothing on disk for this household
    // yet, so there is nothing to hydrate.
    hydrated: true,
    awaitingKeys: true,
    pendingRemoteDeltas: [],
  };
  sessions.set(input.householdId, session);
  activeHouseholdId = input.householdId;

  await persistSession(session, 'all');
  // Set BEFORE the household is announced, and durable: from this moment every
  // sync pass owes this household a full backfill, and an app killed between
  // here and the first successful install resumes owing it.
  await input.store.setMeta(bootstrapPendingMetaKey(input.householdId), '1');
  await input.store.setMeta(ACTIVE_META, input.householdId);
  await input.store.setMeta(HOUSEHOLD_META, input.householdId);
  // The member is now looking at an entirely different household.
  notifyLedgerChanged(LEDGER_TABLE_NAMES, input.householdId);
  return session.ledger;
}

/**
 * The parts of a household record a member may edit.
 *
 * Name, a photo key, and an optional address — nothing else. `member_count`,
 * `my_role` and the timestamps are the engine's and the control plane's to
 * write, and `unit_system` / `purchase_*` belong to House's property model,
 * which a shared budget has no use for.
 */
export type LocalHouseholdEdits = Partial<
  Pick<
    Household,
    | 'name'
    | 'photo_key'
    | 'photo_url'
    | 'address_line1'
    | 'address_line2'
    | 'city'
    | 'state_province'
    | 'postal_code'
    | 'country'
  >
>;

/**
 * Edit the household record this device holds.
 *
 * The record lives in the sealed identity blob, NOT in the projection:
 * `LEDGER_TABLE_KEYS` has no `household` table, so the `HOUSEHOLD_CREATE` op
 * emitted at mint time is dropped by the reducer and these fields are only ever
 * written here. An edit is therefore an identity write plus a re-seal, with no
 * new op type — there is nothing for a peer to merge.
 *
 * `persistIdentity` rather than `persist`: the latter only writes projection
 * rows, so an edit that went through it would be lost on the next session open.
 *
 * Peers keep their own copy of this record until the control plane hands them
 * ours — `syncLocalHouseholdToControlPlane` pushes the name outward, and a
 * checkpoint carries the whole record. The photo's BYTES travel with neither:
 * see `householdMedia.ts`.
 */
export async function updateLocalHousehold(
  edits: LocalHouseholdEdits,
  forHouseholdId?: string,
): Promise<Household> {
  const state = forHouseholdId ? requireSession(forHouseholdId) : requireEngine();

  // A name is the one field that cannot be blanked: every switcher, notification
  // and export names the household, and "" names nothing. Absent means
  // "unchanged"; present means it must be real.
  const next: LocalHouseholdEdits = { ...edits };
  if (next.name !== undefined) {
    const trimmed = next.name.trim();
    if (!trimmed) throw new Error('Household name is required');
    next.name = trimmed;
  }

  state.ledger.household = {
    ...state.ledger.household,
    ...next,
    updated_at: new Date().toISOString(),
  };
  await persistIdentity(state);
  // No table moved — the record lives in the identity blob — so this is a
  // session-level bump for whichever household was edited.
  notifyLedgerChanged([], state.householdId);
  return state.ledger.household;
}

/** Rename a household — {@link updateLocalHousehold} for its commonest edit. */
export async function renameLocalHousehold(
  name: string,
  forHouseholdId?: string,
): Promise<Household> {
  return updateLocalHousehold({ name }, forHouseholdId);
}

/**
 * Bring `my_role` back in line with the control plane.
 *
 * `my_role` is written once — at join, from the role the invite carried — and
 * never again. A promotion or demotion is made on somebody ELSE's phone, so the
 * member it happens to has no path by which to learn of it: the roster screen
 * renders the server's answer, but nothing writes it back to the sealed record.
 *
 * That is not cosmetic. `maybePublishCheckpoint` is owner-only and reads THIS
 * field, so a member promoted to owner goes on declining to publish on every
 * sync — silently, by design, since a non-owner declining is the normal case —
 * and a joining member waiting on that snapshot receives nothing at all. It is
 * the failure the `force` escape hatch in `checkpoints.ts` was added to work
 * around; this is the writer whose absence it was working around.
 *
 * Deliberately NOT part of `LocalHouseholdEdits`: a role is not a field a member
 * may edit, and the control plane is its only honest source.
 *
 * `updated_at` is deliberately not bumped. This mirrors what the server already
 * believes rather than authoring a change, and stamping it would push a
 * household record outward on the next sync for a field the peers do not read.
 *
 * Returns whether anything moved, so a caller can skip republishing a store that
 * did not change.
 */
export async function reconcileLocalHouseholdRole(
  householdId: string,
  controlPlaneRole: string | null | undefined,
): Promise<boolean> {
  // The two-role shape the ledger stores: the control plane's `OWNER` / `ADULT`
  // collapse to `owner` / `member`, as `toLegacyRole` in `householdRoster.ts`
  // already does for the roster screen.
  //
  // Anything else — absent, empty, a role this build does not know — is NO
  // ANSWER and changes nothing. `toLegacyRole` may fold the unknown into
  // `member` because it is labelling a row on screen; here it would DEMOTE, and
  // a wrongly demoted owner stops publishing the household's snapshot with
  // nothing on any screen to say why. Silence is not an answer, which is the
  // rule the rest of the membership watch is built on.
  const upper = (controlPlaneRole ?? '').trim().toUpperCase();
  const next = upper === 'OWNER' ? 'owner' : upper === 'ADULT' || upper === 'MEMBER' ? 'member' : null;
  if (!next) return false;

  const state = requireSession(householdId);
  if ((state.ledger.household.my_role ?? '').toLowerCase() === next) return false;

  state.ledger.household = { ...state.ledger.household, my_role: next };
  // `persistIdentity`, not `persist`: the record lives in the identity blob, and
  // a projection write would be lost on the next session open.
  await persistIdentity(state);
  notifyLedgerChanged([], householdId);
  return true;
}

/** Auto-merges that discarded a member's intent, newest last (BR-044). */
export function getLocalConflicts(): LedgerConflict[] {
  return requireEngine().ledger.conflicts ?? [];
}

/** Dismiss the surfaced conflict log once the member has seen it. */
export async function clearLocalConflicts(): Promise<void> {
  const state = requireEngine();
  state.ledger.conflicts = [];
  await persistSession(state, null);
  notifyLedgerChanged([], state.householdId);
}

/** Snapshot a household's projection as HDK-sealable checkpoint plaintext. */
export async function exportCheckpointPlaintext(
  forHouseholdId?: string,
): Promise<CheckpointPlaintext> {
  // Hydrates when named: a checkpoint published from a cold session would carry
  // the store's rows but an empty in-memory ledger, and `household` with it.
  const state = forHouseholdId
    ? await hydrateSession(requireSession(forHouseholdId))
    : requireEngine();
  const householdId = state.ledger.household.id;
  const records = await state.store.listRows({ householdId });
  const rows: CheckpointPlaintext['rows'] = [];
  for (const record of records) {
    const body = openRowBody(
      state.dbKey,
      record.nonce,
      record.ciphertext,
      rowAad(householdId, record.table, record.rowKey, record.keyEpoch),
    );
    rows.push({
      table: record.table,
      rowKey: record.rowKey,
      bucket: record.bucket,
      deleted: record.deleted,
      bodyJson: utf8Decode(body),
      updatedHlc: record.updatedHlc,
    });
  }
  return {
    v: 1,
    householdId,
    keyEpoch: state.householdKeys.keyEpoch,
    versionVector: await state.store.getVersionVector(householdId),
    household: state.ledger.household,
    rows,
  };
}

/**
 * Replace the projection with a verified checkpoint, then replay local ops
 * newer than the checkpoint watermark (unpublished tail).
 */
export async function installCheckpointPlaintext(
  plain: CheckpointPlaintext,
  forHouseholdId?: string,
): Promise<void> {
  const state = forHouseholdId
    ? await hydrateSession(requireSession(forHouseholdId))
    : requireEngine();
  if (state.awaitingKeys) {
    throw new BudgetLocalEnrolmentPendingError();
  }
  const householdId = state.ledger.household.id;
  if (plain.householdId !== householdId) {
    throw new Error('installCheckpointPlaintext: household mismatch');
  }
  const writes: Array<{
    table: LedgerTableName;
    rowKey: string;
    deleted: boolean;
    envelope: RowEnvelope;
  }> = [];
  for (const row of plain.rows) {
    if (!(row.table in LEDGER_TABLE_KEYS)) continue;
    const envelope = JSON.parse(row.bodyJson) as RowEnvelope;
    writes.push({
      table: row.table as LedgerTableName,
      rowKey: row.rowKey,
      deleted: row.deleted,
      envelope,
    });
  }
  await state.store.clearRows(householdId);
  installRowEnvelopes(state.ledger, writes);
  // The joiner's whole budget, in one step — a checkpoint installs atomically,
  // so this is genuinely one event and the counter jumps rather than climbs.
  // What climbs during the download is the CHUNK fraction
  // (`tryInstallLatestCheckpoint`'s `onProgress`); this is the count that tells
  // the member what the download turned out to contain.
  reportRemoteRows(householdId, writes.length);
  if (plain.household && typeof plain.household === 'object') {
    state.ledger.household = {
      ...state.ledger.household,
      ...(plain.household as Household),
      id: householdId,
    };
  }
  for (const [deviceId, seq] of Object.entries(plain.versionVector)) {
    await state.store.setAuthorBaseline(householdId, deviceId, seq);
  }
  await persistSession(state, 'all');

  const tail = await state.store.listOperationsSince(householdId, plain.versionVector);
  for (const op of tail) {
    try {
      const aad = utf8Encode(`${op.householdId}:${op.keyEpoch}:${op.opId}`);
      const payload = JSON.parse(utf8Decode(aeadDecrypt(state.householdKeys.hdk, op.payload, aad)));
      const delta = decodeLedgerOpPayload(payload);
      if (!delta) continue;
      applyLedgerDelta(state.ledger, delta, {
        hlc: op.hlc,
        authorMemberId: op.authorMemberId,
        opId: op.opId,
      });
    } catch {
      console.warn('[BudgetLocal] checkpoint tail replay failed', op.opId);
    }
  }
  await persistSession(state, 'all');
  await state.store.setMeta(
    checkpointVvMetaKey(state.householdId),
    JSON.stringify(plain.versionVector),
  );
  // The checkpoint replaced the whole projection.
  notifyLedgerChanged(LEDGER_TABLE_NAMES, state.householdId);
}

/**
 * Truncate the op log below checkpoint VV ∩ every active peer VV.
 *
 * `compactOperations` was always household-scoped; only the WATERMARK was
 * global, and that was enough to be unrecoverable. Household A's checkpoint VV
 * is a version vector over DEVICE ids, so intersecting it with B's vector over
 * the same device ids yields a `retain` describing neither history — and the ops
 * it drops are gone, because a compacted op is not re-derivable.
 */
export async function compactLocalLogIfSafe(forHouseholdId?: string): Promise<number> {
  const state = forHouseholdId ? requireSession(forHouseholdId) : requireEngine();
  const raw = await state.store.getMeta(checkpointVvMetaKey(state.householdId));
  if (!raw) return 0;
  let checkpointVv: VersionVector;
  try {
    checkpointVv = JSON.parse(raw) as VersionVector;
  } catch {
    return 0;
  }
  const householdId = state.ledger.household.id;
  const ours = await state.store.getVersionVector(householdId);
  const peers = await state.store.listSyncPeerStates(householdId);
  const retain = minVersionVector([
    checkpointVv,
    ours,
    ...peers.map((peer) => peer.knownVv),
  ]);
  if (Object.keys(retain).length === 0) return 0;
  return state.store.compactOperations(householdId, retain);
}

/**
 * Does this household still owe the member the history that predates their join?
 *
 * False for every household this device MINTED — there is no history elsewhere
 * to fetch — and false for a joined household whose backfill has completed. The
 * sync run retries the backfill on every pass for as long as this is true, which
 * is what makes the delivery guaranteed rather than a single race the owner's
 * upload timing decides.
 *
 * Answers false for an unknown household rather than throwing: callers are
 * background passes, and a household removed mid-flight owes nobody anything.
 */
export async function isHouseholdBootstrapPending(householdId: string): Promise<boolean> {
  const state = sessions.get(householdId);
  if (!state) return false;
  return (await state.store.getMeta(bootstrapPendingMetaKey(householdId))) === '1';
}

/** The backfill landed (or provably had nothing to land) — stop retrying. */
export async function clearHouseholdBootstrapPending(householdId: string): Promise<void> {
  const state = sessions.get(householdId);
  if (!state) return;
  await state.store.setMeta(bootstrapPendingMetaKey(householdId), '');
}

/**
 * Re-arm the backfill for a household already on this device.
 *
 * The repair path, and the only reason it is exported: devices that joined
 * BEFORE the marker existed are sitting on a partial ledger right now, and
 * nothing about their state distinguishes them from a fully-synced member. The
 * member asks for the history from Device sync, this marks the household, and
 * the next run installs the checkpoint — which replaces the projection and then
 * replays every local op newer than the snapshot, so nothing written on this
 * device is lost by asking.
 */
export async function requestHouseholdBackfill(householdId: string): Promise<void> {
  const state = requireSession(householdId);
  await state.store.setMeta(bootstrapPendingMetaKey(householdId), '1');
}

export async function rememberPublishedCheckpoint(
  vv: VersionVector,
  forHouseholdId?: string,
): Promise<void> {
  const state = forHouseholdId ? requireSession(forHouseholdId) : requireEngine();
  await state.store.setMeta(checkpointVvMetaKey(state.householdId), JSON.stringify(vv));
}

/** Test helper — inject an in-memory session without SecureStore/MMKV. */
export async function openLocalBudgetSessionForTests(input: {
  userId: string;
  householdName?: string;
}): Promise<LocalBudgetLedger> {
  // Inner, not the queued export: this helper builds its own engine directly, so
  // going through the chain would let it deadlock if ever called from within a
  // queued operation.
  await closeLocalBudgetSessionInner();
  const dbKey = randomBytes(32);
  const store = new MemoryLocalFirstStore();
  await store.open(dbKey);
  const householdId = `hh_test_${bytesToHex(randomBytes(4))}`;
  const deviceId = `dev_test_${bytesToHex(randomBytes(4))}`;
  const identity = generateDeviceIdentity(deviceId);
  const householdKeys = generateHouseholdKeys(householdId, 1);
  const opLog = new OpLog({ store, identity, householdKeys, projection: projectionFor(householdId) });
  const household = buildHousehold(householdId, input.householdName ?? 'Test household');
  const ledger: LocalBudgetLedger = {
    version: 1,
    household,
    memberId: input.userId,
    deviceId,
    categories: defaultCategories(householdId),
    expenses: [],
    items: [],
    goals: [],
    subBudgets: [],
    transfers: [],
    ...emptyDebtTables(),
    ...emptySavingsTables(),
    ops: [],
    lww: {},
    conflicts: [],
    crypto: cryptoBundle(identity, householdKeys),
  };
  sessions.set(householdId, {
    householdId,
    dbKey,
    store,
    identity,
    householdKeys,
    retiredHouseholdKeys: new Map(),
    opLog,
    ledger,
    hydrated: true,
    awaitingKeys: false,
    pendingRemoteDeltas: [],
  });
  activeHouseholdId = householdId;
  return ledger;
}
