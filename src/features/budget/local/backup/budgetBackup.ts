// See autoBackup.ts — must precede `@symply/local-first` or sealing an archive
// dies on "crypto.getRandomValues must be defined".
import '../cryptoPolyfill';

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import {
  createBackupArchive,
  createBackupBundle,
  openBackupArchive,
  readBackupFileKind,
  verifyBackupArchive,
  verifyBackupBundle,
  type BackupBundleSectionPayload,
  type BackupCreateResult,
  type BackupFileKind,
  type BackupPlaintextPayload,
  type BackupVerifyResult,
} from '@symply/local-first';

import {
  applyLocalLedgerRestore,
  createLocalBudgetHousehold,
  getActiveBudgetHouseholdId,
  getLocalBudgetSession,
  getLocalLedger,
  getLocalLedgerFor,
  hasLocalBudgetHousehold,
  isLocalBudgetSessionOpen,
  listLocalBudgetHouseholds,
  runOnHousehold,
  type LocalBudgetLedger,
} from '../engine';
// Static, not `await import(...)`: nothing under budget/local imports this
// module back, so there is no cycle to break — and the dynamic form throws
// "dynamic import callback was invoked without --experimental-vm-modules"
// under Jest, which took the restore test down with it.
import { ensureBudgetLocalSession, syncHouseholdStoreFromLocalLedger } from '../ensureSession';
import { BudgetLocalNotReadyError } from '../errors';
import { newLocalId } from '../ids';
import { LEDGER_TABLE_NAMES } from '../projection';
import { localWishImageUriForKey } from '../wishes/localWishMedia';

import {
  BUDGET_BACKUP_ATTACHMENT_BUDGET_BYTES,
  collectAttachmentBlobs,
  restoreAttachmentBlobs,
} from './backupAttachments';

/**
 * Budget V2 Phase 4 — encrypted backup of the local ledger.
 *
 * Sealed under a 12-word recovery phrase. Restore dry-run verifies decrypt
 * before any overwrite. Merge-on-restore: the apply replaces the snapshot
 * projection tables but keeps the current device identity (live wins for device
 * keys — D-20 simplified).
 *
 * ## Two file shapes, and only one of them is written
 *
 * **v3 bundle (current).** One file, one phrase, every household on the device,
 * each sealed as its own section. `buildBudgetBackupBundle` writes it and
 * `restoreBudgetBackupBundle` applies it. See the section header further down
 * for why the per-household archives were collapsed back into one file.
 *
 * **v2 archive (read-only).** One household per file. Nothing writes these any
 * more; they are still restored, because a member's existing backups have to
 * keep working. `verifyBudgetBackupFile` sniffs the version and routes.
 *
 * ## Reading is household-addressed; writing is active-household only
 *
 * The two halves pull in opposite directions and always have:
 *
 *  - **Reading.** `getLocalBudgetSession` hydrates a cold household on demand,
 *    which is what lets one seal cover households the member has not opened
 *    since launch. It is also why building is async: there is no synchronous
 *    way to decrypt a household's rows into memory.
 *  - **Writing.** `applyLocalLedgerRestore` resolves the ACTIVE session by
 *    design (engine `requireEngine()`). A bundle restore therefore activates
 *    each target through `runOnHousehold` before applying its section, rather
 *    than passing a household id into a write path that would ignore it — the
 *    exact silent cross-contamination BR-016 B5 exists to prevent. The v2 path
 *    below keeps its `householdId` *assertion* for the same reason: it refuses
 *    when the id does not name the open household.
 */

/**
 * Crypto material stays inside AEAD ciphertext only (never in archive meta).
 * Ops are omitted: restore merges tables via LWW. Encoding the log as
 * `Array.from(Uint8Array)` was a ~3.6× blow-up before Argon2id.
 */
const SNAPSHOT_OMITTED_KEYS = new Set(['ops', 'crypto']);

function snapshotFromLedger(ledger: LocalBudgetLedger): string {
  // An explicit omit-list rather than a `const { ops: _ops, crypto: _crypto,
  // ...tables }` destructure: that form trips `no-unused-vars` (the repo config
  // sets `argsIgnorePattern` but not `varsIgnorePattern`) and stood as an
  // unfixed lint error here until BR-016 rewrote the function around it.
  // Naming the excluded keys also states the security intent — `crypto` is
  // omitted deliberately, not incidentally. Ported back from House's
  // `snapshotFromHouseLedger`, which hit the same rule.
  const tables: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ledger)) {
    if (SNAPSHOT_OMITTED_KEYS.has(key)) continue;
    tables[key] = value;
  }
  return JSON.stringify({ ...tables, ops: [] });
}

/**
 * Backfill surrogate ids on tables that used to be keyed by a natural key
 * (savingsMonthlyTargets by `period`, wishAttachments by `key`).
 *
 * An archive written before the re-key has rows with no `id`. Without a key
 * those rows are invisible to the projection — they would restore into the local
 * ledger and then never sync to anyone.
 */
function withSurrogateIds<T extends { id?: string }>(rows: T[] | undefined, prefix: string): T[] {
  return (rows ?? []).map((row) => (row.id ? row : { ...row, id: newLocalId(prefix) }));
}

/**
 * Re-derive every restored attachment's `localUri` from its image key.
 *
 * The archived value is a path on the phone that MADE the backup, and it is
 * dead here even when the backup came from this same device: iOS gives each
 * install a fresh container UUID, so `documentDirectory` — and therefore every
 * `file:///…/Application/<uuid>/Documents/wish-images/x.jpg` ever stored — is
 * stale the moment the app is reinstalled, which is the single most likely
 * reason someone is restoring at all.
 *
 * `localWishImageUriForKey` is derived from the key alone and is exactly where
 * `restoreAttachmentBlobs` just wrote the bytes, so re-pointing the row makes
 * the picture resolve on the first render rather than falling through to the
 * convention path only for keys that happen to look local.
 */
function withLocalAttachmentUris<T extends { key?: string; localUri?: string }>(
  rows: T[],
): T[] {
  return rows.map((row) =>
    row.key ? { ...row, localUri: localWishImageUriForKey(row.key) } : row,
  );
}

export type BuildBudgetBackupOptions = {
  /**
   * Which household to archive. Defaults to the active one.
   *
   * The scheduler names every household in turn, so most of the archives it
   * writes are of households nobody is looking at — hence the hydrate-on-demand
   * resolution below rather than a read of the active ledger.
   */
  householdId?: string;
  /**
   * Seal under a caller-supplied phrase instead of minting a fresh one.
   *
   * In practice every real caller supplies one: manual and scheduled backups
   * both pass the device's stored phrase (see `backupPhrase.ts`), so one set of
   * twelve words opens every archive a phone has written. Minting is the
   * fallback for a caller with nowhere to keep a phrase — and it is a trap for
   * anything unattended, which would seal a file nobody can ever open.
   */
  phrase?: string;
};

/**
 * What was sealed, alongside the sealed bytes.
 *
 * The household travels back out because the caller has to name the file after
 * it: with N households on one device, N archives called
 * `symply-budget-backup-2026-08-17.json` are indistinguishable in Files or
 * Drive, and restoring one is then a guess. See `timestampedBackupFileName`.
 */
export type BudgetBackupArchiveResult = BackupCreateResult & {
  householdId: string;
  householdName: string;
};

/**
 * Seal one household's ledger.
 *
 * Async since BR-016: a household the member has not opened this launch is
 * *cold* — its rows are on disk but not decrypted — and `getLocalBudgetSession`
 * hydrates it. Backing up only what happens to be warm would mean the schedule
 * silently covered one household out of three.
 */
export async function buildBudgetBackupArchive(
  options: BuildBudgetBackupOptions = {},
): Promise<BudgetBackupArchiveResult> {
  if (!isLocalBudgetSessionOpen()) {
    throw new BudgetLocalNotReadyError();
  }
  const householdId = options.householdId ?? getActiveBudgetHouseholdId();
  if (!householdId) {
    throw new BudgetLocalNotReadyError();
  }

  const session = await getLocalBudgetSession(householdId);
  const ledger = session.ledger;
  const archive = createBackupArchive(
    {
      snapshotJson: snapshotFromLedger(ledger),
      householdId: ledger.household.id,
      deviceId: ledger.deviceId,
      keyEpoch: session.householdKeys.keyEpoch,
      createdAt: new Date().toISOString(),
    },
    options.phrase ? { phrase: options.phrase } : undefined,
  );
  return {
    ...archive,
    householdId: ledger.household.id,
    householdName: ledger.household.name?.trim() || 'Household',
  };
}

export function verifyBudgetBackup(
  archiveJson: string,
  phrase: string,
): BackupVerifyResult {
  return verifyBackupArchive(archiveJson, phrase);
}

export type BudgetRestoreProgressStage =
  | 'preparing'
  | 'deriving_key'
  | 'decrypting'
  | 'applying'
  | 'done';

export type BudgetRestoreProgress = {
  stage: BudgetRestoreProgressStage;
  /** Rough 0–1 floor for UI; decrypt may animate ahead on the UI thread. */
  progress: number;
  message: string;
};

export type RestoreBudgetBackupOptions = {
  /**
   * Assert which household is being restored into. Defaults to the active one.
   *
   * Not a router: the restore write path is active-household only (see the
   * module header), so naming a household that is not open is refused rather
   * than silently redirected. Passing it is how a multi-household caller proves
   * it is about to write where it thinks it is.
   */
  householdId?: string;
  /**
   * Allow replacing the open local household with the backup's household
   * (D1 → V2 migration). Default false — same-household merge only.
   */
  allowHouseholdReplace?: boolean;
  /**
   * Already-decrypted payload from `verifyBudgetBackup` — skip a second
   * Argon2 pass (Hermès hangs for minutes on legacy KDF otherwise).
   */
  verifiedPayload?: BackupPlaintextPayload;
  onProgress?: (update: BudgetRestoreProgress) => void;
};

export type BudgetRestoreSummary = {
  householdId: string;
  householdName: string;
  spendings: number;
  categories: number;
  monthlyBudgets: number;
  plannedItems: number;
  income: number;
  monthlyPayments: number;
  loans: number;
  mortgages: number;
  mortgageStatements: number;
  registeredAccounts: number;
  savingsGoals: number;
};

function summarizeRestoredLedger(ledger: LocalBudgetLedger): BudgetRestoreSummary {
  return {
    householdId: ledger.household.id,
    householdName: ledger.household.name?.trim() || 'Household',
    spendings: ledger.expenses.length,
    categories: ledger.categories.length,
    monthlyBudgets: ledger.goals.length,
    plannedItems: ledger.items.length,
    income: ledger.savingsIncome.length,
    monthlyPayments: ledger.savingsRecurringPayments.length,
    loans: ledger.budgetLoans.length,
    mortgages: ledger.mortgages.length,
    mortgageStatements: ledger.mortgageStatements.length,
    registeredAccounts: ledger.registeredAccounts.length,
    savingsGoals: ledger.savingsGoals.length,
  };
}

export type BudgetRestoreBreakdownLine = {
  count: number;
  label: string;
};

/** Structured restore rows for UI (green checkmarks, not plain bullets). */
export function getBudgetRestoreBreakdownLines(
  summary: BudgetRestoreSummary,
): BudgetRestoreBreakdownLine[] {
  const line = (n: number, one: string, many: string): BudgetRestoreBreakdownLine => ({
    count: n,
    label: n === 1 ? one : many,
  });
  return [
    line(summary.spendings, 'spending', 'spendings'),
    line(summary.categories, 'category', 'categories'),
    line(summary.monthlyBudgets, 'monthly budget', 'monthly budgets'),
    line(summary.plannedItems, 'planned item', 'planned items'),
    line(summary.income, 'income entry', 'income entries'),
    line(summary.monthlyPayments, 'monthly payment', 'monthly payments'),
    line(summary.loans, 'loan', 'loans'),
    line(summary.mortgages, 'mortgage', 'mortgages'),
    line(summary.mortgageStatements, 'mortgage statement', 'mortgage statements'),
    line(summary.registeredAccounts, 'registered account', 'registered accounts'),
    line(summary.savingsGoals, 'savings goal', 'savings goals'),
  ];
}

/** Plain-text breakdown for logs / accessibility. */
export function formatBudgetRestoreBreakdown(summary: BudgetRestoreSummary): string {
  return [
    `${summary.householdName} restored onto this device.`,
    '',
    ...getBudgetRestoreBreakdownLines(summary).map((row) => `• ${row.count} ${row.label}`),
  ].join('\n');
}

/**
 * Name a household the way the member does, when this device holds it.
 *
 * Returns null for a household that is not on this device — a real case now
 * that archives travel between members, and one the caller has to word
 * differently because "switch to it" is not advice anyone can act on.
 */
function localHouseholdName(householdId: string): string | null {
  const known = listLocalBudgetHouseholds().find((entry) => entry.householdId === householdId);
  const name = known?.name.trim();
  return name ? name : null;
}

/**
 * Apply a verified backup into the open session's projection.
 * By default live household id must match. Pass `allowHouseholdReplace` for
 * D1→local migration archives whose household id differs from greenfield.
 */
export async function restoreBudgetBackup(
  archiveJson: string,
  phrase: string,
  options: RestoreBudgetBackupOptions = {},
): Promise<{ householdId: string; expenseCount: number; summary: BudgetRestoreSummary }> {
  if (!isLocalBudgetSessionOpen()) {
    throw new BudgetLocalNotReadyError();
  }
  const payload = options.verifiedPayload ?? openBackupArchive(archiveJson, phrase);
  return applyRestorePayload(payload, options);
}

/**
 * The merge itself, once the bytes are already open.
 *
 * Split out of `restoreBudgetBackup` so the v3 bundle path can reuse it per
 * section without re-deriving a recovery key it has already derived — the
 * bundle stretches the phrase ONCE for every household in the file, and routing
 * each section back through a function that takes `(archiveJson, phrase)` would
 * throw that away and pay Argon2 per household again.
 *
 * Writes to the ACTIVE household, exactly as before; the bundle path activates
 * each target through `runOnHousehold` before calling in.
 */
async function applyRestorePayload(
  payload: BackupPlaintextPayload,
  options: RestoreBudgetBackupOptions = {},
): Promise<{ householdId: string; expenseCount: number; summary: BudgetRestoreSummary }> {
  const live = getLocalLedger();

  // Asserted household ≠ open household: refuse before decrypting anything into
  // it. `applyLocalLedgerRestore` writes to the ACTIVE session, so honouring the
  // request here would mean writing the caller's data into someone else's
  // ledger while reporting success.
  if (options.householdId && options.householdId !== live.household.id) {
    const target = localHouseholdName(options.householdId);
    throw new Error(
      target
        ? `Switch to “${target}” and try again — a restore always writes into the household that is open.`
        : 'That household is not open on this device. Switch to it and try again.',
    );
  }

  const replaceHousehold =
    options.allowHouseholdReplace === true && live.household.id !== payload.householdId;
  if (live.household.id !== payload.householdId && !replaceHousehold) {
    // Worded for the member, not the engineer. Before BR-016 this could only
    // mean a corrupt or foreign file, so "belongs to a different household" was
    // the whole story. With several households on one device it is an ordinary
    // mis-tap — picking the holiday budget's archive while the main one is open
    // — and the only useful thing to say is what to do about it.
    const owner = localHouseholdName(payload.householdId);
    throw new Error(
      owner
        ? `This backup belongs to “${owner}”. Switch to that household and try again.`
        : "This backup belongs to a household that isn't on this device. Join that household here first, then restore.",
    );
  }

  const parsed = JSON.parse(payload.snapshotJson) as LocalBudgetLedger & {
    ops: Array<Omit<LocalBudgetLedger['ops'][number], 'payload' | 'signature'> & {
      payload: number[];
      signature: number[];
    }>;
  };

  const backup = {
    ...parsed,
    savingsMonthlyTargets: withSurrogateIds(parsed.savingsMonthlyTargets, 'smt'),
    wishAttachments: withLocalAttachmentUris(
      withSurrogateIds(parsed.wishAttachments, 'wat'),
    ),
  } as LocalBudgetLedger;

  console.log(
    '[budget-restore] merge start',
    'replaceHousehold=',
    replaceHousehold,
    'from=',
    live.household.id,
    'to=',
    payload.householdId,
    'expenses=',
    (backup.expenses ?? []).length,
  );
  const tMutate = Date.now();
  await applyLocalLedgerRestore(backup, {
    entityId: replaceHousehold ? payload.householdId : live.household.id,
    replaceHousehold,
    payload: {
      fromBackupAt: payload.createdAt,
      sourceDeviceId: payload.deviceId,
      householdReplaced: replaceHousehold,
      restoreEpoch: Date.now(),
    },
  });
  console.log('[budget-restore] mutate done', 'ms=', Date.now() - tMutate);

  // Household replace updates the ledger id but not Zustand — without this,
  // screens keep calling APIs with the old hh_local_* and every domain
  // (savings/mortgage/loans) throws mismatch → empty UI despite data on disk.
  syncHouseholdStoreFromLocalLedger();

  const liveAfter = getLocalLedger();
  const summary = summarizeRestoredLedger(liveAfter);
  console.log('[budget-restore] domain counts', summary);

  return {
    householdId: summary.householdId,
    expenseCount: summary.spendings,
    summary,
  };
}

export type BudgetRestorePickResult =
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }
  | {
      status: 'needs_phrase';
      archiveJson: string;
      householdHint: string | null;
      /**
       * The hinted household's name, when this device holds it. Lets the caller
       * say "this is your Holiday budget" — or, when it is null, warn before
       * Argon2 spends a minute proving the archive was never for this device.
       *
       * Always null for a bundle: its sections' names are inside the ciphertext
       * by design, and it holds several households anyway. `householdCount` is
       * what a bundle can honestly say before the phrase arrives.
       */
      householdName: string | null;
      /** `bundle` for a v3 file, `archive` for a pre-bundle single household. */
      kind: BackupFileKind;
      /**
       * How many households the file claims to hold, read from its cleartext
       * meta. Zero when the file is unrecognisable — the verify step reports
       * that properly; this is only a hint for the phrase prompt.
       */
      householdCount: number;
    };

/** Pick a backup archive file; caller collects the recovery phrase next. */
export async function pickBudgetBackupArchive(): Promise<BudgetRestorePickResult> {
  try {
    // Prefer */* so AirDropped `*.backup.json` files show up — MIME filters
    // often hide custom double-extensions on iOS Files.
    const picked = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) {
      return { status: 'cancelled' };
    }
    const archiveJson = await FileSystem.readAsStringAsync(picked.assets[0].uri);
    const kind = readBackupFileKind(archiveJson);
    let householdHint: string | null = null;
    let householdCount = 0;
    try {
      const meta = JSON.parse(archiveJson) as {
        meta?: { householdId?: string; householdIds?: string[] };
      };
      if (kind === 'bundle') {
        const ids = meta.meta?.householdIds ?? [];
        householdCount = ids.length;
        // Only meaningful as a hint when the bundle holds exactly one household
        // — with three, naming one would be arbitrary.
        householdHint = ids.length === 1 ? ids[0] : null;
      } else {
        householdHint = meta.meta?.householdId ?? null;
        householdCount = householdHint ? 1 : 0;
      }
    } catch {
      // verify step will report corrupt
    }
    return {
      status: 'needs_phrase',
      archiveJson,
      householdHint,
      // A bundle's names are sealed, so there is nothing to offer until the
      // phrase has been entered — see `BudgetRestorePickResult`.
      householdName:
        kind === 'archive' && householdHint ? localHouseholdName(householdHint) : null,
      kind,
      householdCount,
    };
  } catch {
    return { status: 'failed', message: 'Could not open that backup file.' };
  }
}

/*
 * `confirmAndRestoreBudgetBackup` — the single-archive UI entry point — was
 * removed here rather than kept for symmetry. `confirmAndRestoreBudgetBackupFile`
 * below does everything it did and also handles bundles, so leaving both in place
 * left a function that silently restores only the FIRST household of a file a
 * future caller could reasonably reach for. The v2 *read* path it wrapped is very
 * much alive — see `verifyBudgetBackupFile`'s `archive` branch.
 */

// ---------------------------------------------------------------------------
// Multi-household bundles (v3) — one file, every household on the device
// ---------------------------------------------------------------------------

/**
 * ## Why the bundle replaced one-file-per-household
 *
 * BR-016 gave a device several households and this module answered by sealing
 * each one separately: N files, N twelve-word phrases, N schedules, N retention
 * caps. Every one of those N had to be right for the member to actually be
 * covered, and when one was not — a phrase never written down, a schedule that
 * had silently failed — nothing looked wrong, because the other archives were
 * still there and still restored. "Backed up" stopped meaning "my data is safe".
 *
 * A bundle collapses that back to one thing: one file holding every household,
 * one phrase, one schedule. Inside, each household is its own AEAD section (see
 * `@symply/local-first/backup/bundle`), so selective restore and per-household
 * damage containment survive the merge. The Argon2 pass is paid once for the
 * whole file rather than once per household, which is the only reason a bundle
 * is openable at all on a phone.
 *
 * Archives written before this still restore — `verifyBudgetBackupFile` sniffs
 * the version and routes to the v2 path. Nothing writes v2 any more.
 */

/** Rows carried for one household, per table and in total. */
export type BudgetBackupRowCounts = {
  total: number;
  byTable: Record<string, number>;
};

function countLedgerRows(ledger: LocalBudgetLedger): BudgetBackupRowCounts {
  const byTable: Record<string, number> = {};
  let total = 0;
  // Driven off the table registry rather than a hand-written list, so a table
  // added to the ledger is counted — and therefore reported as backed up —
  // without anyone remembering to come back here.
  for (const table of LEDGER_TABLE_NAMES) {
    const rows = (ledger as unknown as Record<string, unknown>)[table];
    const count = Array.isArray(rows) ? rows.length : 0;
    byTable[table] = count;
    total += count;
  }
  return { total, byTable };
}

/** What one household contributed to a bundle. */
export type BudgetBackupHouseholdCoverage = {
  householdId: string;
  householdName: string;
  rows: BudgetBackupRowCounts;
  attachments: {
    total: number;
    included: number;
    /** Left out — over the shared byte budget, missing, or unreadable. */
    skipped: number;
  };
};

export type BudgetBackupBundleResult = {
  phrase: string;
  bundleJson: string;
  /** Every household sealed, in file order. */
  households: BudgetBackupHouseholdCoverage[];
  /** Base64 attachment payload across the whole bundle. */
  attachmentBytes: number;
};

export type BuildBudgetBackupBundleOptions = {
  /**
   * Narrow to specific households. Omit for every household on the device,
   * which is what a backup should mean.
   */
  householdIds?: string[];
  /** Seal under an existing phrase (scheduled backups) instead of minting one. */
  phrase?: string;
  /** Total base64 attachment payload allowed across the bundle. */
  attachmentBudgetBytes?: number;
};

/**
 * Seal every household this device holds into one bundle.
 *
 * Households are hydrated one at a time and in turn: a cold household's rows are
 * on disk but not decrypted, and `getLocalBudgetSession` is what brings them in.
 * Sequential rather than `Promise.all` because hydration decrypts every row of a
 * household — three at once is three times the peak memory on the device class
 * least able to spare it, to save time nobody is watching.
 */
export async function buildBudgetBackupBundle(
  options: BuildBudgetBackupBundleOptions = {},
): Promise<BudgetBackupBundleResult> {
  if (!isLocalBudgetSessionOpen()) {
    throw new BudgetLocalNotReadyError();
  }

  const held = listLocalBudgetHouseholds();
  const wanted = options.householdIds?.length
    ? held.filter((entry) => options.householdIds!.includes(entry.householdId))
    : held;
  if (wanted.length === 0) {
    throw new BudgetLocalNotReadyError();
  }

  let attachmentBudget = options.attachmentBudgetBytes ?? BUDGET_BACKUP_ATTACHMENT_BUDGET_BYTES;
  const sections: BackupBundleSectionPayload[] = [];
  const coverage: BudgetBackupHouseholdCoverage[] = [];
  const createdAt = new Date().toISOString();

  for (const entry of wanted) {
    const session = await getLocalBudgetSession(entry.householdId);
    const ledger = session.ledger;
    const householdName = ledger.household.name?.trim() || 'Household';

    // The budget is shared across the whole bundle and spent in household
    // order, so a first household full of photos can consume it. That is the
    // honest behaviour for a device-wide cap; the alternative (a per-household
    // slice) would refuse to carry a lone household's photos because two other
    // households theoretically might have some.
    const attachments = await collectAttachmentBlobs(ledger, attachmentBudget);
    attachmentBudget -= attachments.bytes;

    sections.push({
      snapshotJson: snapshotFromLedger(ledger),
      householdId: ledger.household.id,
      householdName,
      deviceId: ledger.deviceId,
      keyEpoch: session.householdKeys.keyEpoch,
      createdAt,
      ...(attachments.blobs.length > 0
        ? { attachmentsJson: JSON.stringify(attachments.blobs) }
        : {}),
    });
    coverage.push({
      householdId: ledger.household.id,
      householdName,
      rows: countLedgerRows(ledger),
      attachments: {
        total: attachments.totalCount,
        included: attachments.includedCount,
        skipped: attachments.skippedCount,
      },
    });
  }

  const created = createBackupBundle(sections, {
    ...(options.phrase ? { phrase: options.phrase } : {}),
    deviceId: sections[0].deviceId,
    createdAt,
  });

  const attachmentBytes =
    (options.attachmentBudgetBytes ?? BUDGET_BACKUP_ATTACHMENT_BUDGET_BYTES) - attachmentBudget;
  console.log(
    '[budget-backup] bundle sealed',
    'households=',
    coverage.length,
    'rows=',
    coverage.reduce((sum, entry) => sum + entry.rows.total, 0),
    'attachmentBytes=',
    attachmentBytes,
  );

  return {
    phrase: created.phrase,
    bundleJson: created.bundleJson,
    households: coverage,
    attachmentBytes,
  };
}

/** One household inside a backup file, as the restore UI needs to describe it. */
export type BudgetBackupFileHousehold = {
  householdId: string;
  /** From inside the ciphertext; null when the section could not be opened. */
  householdName: string | null;
  /** Whether this device already holds it — decides merge vs. adopt. */
  onThisDevice: boolean;
  /** The name this device knows it by, when it holds it. */
  localName: string | null;
  status: 'ok' | 'damaged';
  payload?: BackupBundleSectionPayload;
};

export type BudgetBackupFileVerifyResult = {
  status: 'ok' | 'partial' | 'failed';
  /** Which shape the file turned out to be. */
  kind: 'bundle' | 'archive';
  households: BudgetBackupFileHousehold[];
  message: string;
};

/**
 * Open a backup file of either shape, without applying anything (BR-051).
 *
 * One Argon2 pass, whatever is inside. A v2 archive is presented as a
 * one-household bundle so callers have a single shape to render — the format
 * difference is this function's problem, not the restore screen's.
 */
export function verifyBudgetBackupFile(
  fileJson: string,
  phrase: string,
): BudgetBackupFileVerifyResult {
  const kind = readBackupFileKind(fileJson);

  if (kind === 'archive') {
    const verified = verifyBackupArchive(fileJson, phrase);
    if (verified.status !== 'ok' || !verified.payload) {
      return { status: 'failed', kind: 'archive', households: [], message: verified.message };
    }
    const householdId = verified.payload.householdId;
    return {
      status: 'ok',
      kind: 'archive',
      households: [
        {
          householdId,
          // A v2 archive never carried the name — it predates the bundle — so
          // the only name available is the one this device knows.
          householdName: localHouseholdName(householdId),
          onThisDevice: hasLocalBudgetHousehold(householdId),
          localName: localHouseholdName(householdId),
          status: 'ok',
          payload: {
            ...verified.payload,
            householdName: localHouseholdName(householdId) ?? 'Household',
          },
        },
      ],
      message: verified.message,
    };
  }

  if (kind !== 'bundle') {
    return {
      status: 'failed',
      kind: 'bundle',
      households: [],
      message: 'This backup file is damaged or not a Symply backup.',
    };
  }

  const verified = verifyBackupBundle(fileJson, phrase);
  if (verified.status !== 'ok' && verified.status !== 'partial') {
    return { status: 'failed', kind: 'bundle', households: [], message: verified.message };
  }

  return {
    status: verified.status === 'partial' ? 'partial' : 'ok',
    kind: 'bundle',
    households: verified.households.map((section) => ({
      householdId: section.householdId,
      householdName: section.payload?.householdName ?? null,
      onThisDevice: hasLocalBudgetHousehold(section.householdId),
      localName: localHouseholdName(section.householdId),
      status: section.status === 'ok' ? ('ok' as const) : ('damaged' as const),
      ...(section.payload ? { payload: section.payload } : {}),
    })),
    message: verified.message,
  };
}

export type BudgetRestoreHouseholdOutcome = {
  householdId: string;
  householdName: string;
  status: 'restored' | 'adopted' | 'skipped' | 'failed';
  message: string;
  summary?: BudgetRestoreSummary;
  attachments?: { restored: number; failed: number };
};

export type BudgetBundleRestoreResult = {
  status: 'ok' | 'partial' | 'failed';
  message: string;
  households: BudgetRestoreHouseholdOutcome[];
};

export type RestoreBudgetBundleOptions = {
  /**
   * Restore only these households. Omit for every household in the file, which
   * is what "restore my backup" means to the member who made it.
   */
  householdIds?: string[];
  /**
   * Bring in households the file has and this device does not, by creating a
   * local household and adopting the archived one's identity into it.
   *
   * Default true: a bundle restored onto a replaced phone is exactly the case
   * where every household is missing, and refusing them all would restore
   * nothing while reporting success on an empty list.
   */
  adoptMissingHouseholds?: boolean;
  onProgress?: (update: BudgetRestoreProgress) => void;
};

/**
 * Apply an already-verified bundle, household by household.
 *
 * Each household is restored inside `runOnHousehold`, which activates it and
 * holds the session chain across the whole merge. That is not tidiness: the one
 * write path (`mutateLocalLedger` / `applyLocalLedgerRestore`) binds the ACTIVE
 * session synchronously, so restoring three households by activating between
 * awaits would be the cross-household write BR-016 B5 exists to make impossible.
 *
 * The household the member was standing in is restored as the active one at the
 * end. Finishing a restore in a different budget than you started in reads as a
 * bug even when every byte landed correctly.
 */
export async function restoreBudgetBackupBundle(
  verified: BudgetBackupFileVerifyResult,
  options: RestoreBudgetBundleOptions = {},
): Promise<BudgetBundleRestoreResult> {
  if (!isLocalBudgetSessionOpen()) {
    throw new BudgetLocalNotReadyError();
  }
  const startedIn = getActiveBudgetHouseholdId();
  const adoptMissing = options.adoptMissingHouseholds !== false;
  const wanted = verified.households.filter(
    (entry) => !options.householdIds?.length || options.householdIds.includes(entry.householdId),
  );

  const outcomes: BudgetRestoreHouseholdOutcome[] = [];
  let done = 0;

  for (const entry of wanted) {
    const label = entry.householdName ?? entry.localName ?? 'Household';
    options.onProgress?.({
      stage: 'applying',
      // Reserve the first 90% for the (single) Argon2 pass the caller already
      // paid; the merges share what is left.
      progress: 0.9 + (0.1 * done) / Math.max(1, wanted.length),
      message: wanted.length > 1 ? `Restoring ${label}…` : 'Writing ledger…',
    });
    done += 1;

    if (entry.status !== 'ok' || !entry.payload) {
      outcomes.push({
        householdId: entry.householdId,
        householdName: label,
        status: 'failed',
        message: 'This household could not be opened from the backup file.',
      });
      continue;
    }

    try {
      outcomes.push(await restoreOneSection(entry, entry.payload, adoptMissing));
    } catch (error) {
      console.error('[budget-restore] household failed', entry.householdId, error);
      outcomes.push({
        householdId: entry.householdId,
        householdName: label,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Restore failed.',
      });
    }
  }

  // Land back where the member started, when that household still exists.
  if (startedIn && hasLocalBudgetHousehold(startedIn) && getActiveBudgetHouseholdId() !== startedIn) {
    await runOnHousehold(startedIn, async () => undefined).catch(() => undefined);
  }
  syncHouseholdStoreFromLocalLedger();

  return summarizeBundleRestore(outcomes);
}

/**
 * A household on this device that holds nothing the member put there, or null.
 *
 * "Nothing" means every synced table is empty except `categories`, and those are
 * all still the mint's own seeds (`cat_default_<n>`). That is precisely the
 * shape `createLocalBudgetHousehold` and a first sign-in leave behind, and it is
 * the only shape safe to adopt an archived household into: anything else is a
 * budget somebody has started using, and taking it over would replace their data
 * with the file's under a different name.
 *
 * Hydrates each candidate in turn, because a cold household's rows are on disk
 * and not in memory — asking an unhydrated ledger whether it is empty gets
 * "yes" for every household on the device, which would hand a member's real
 * budget to the first section of the file.
 */
async function findEmptyLocalHousehold(): Promise<string | null> {
  for (const entry of listLocalBudgetHouseholds()) {
    const ledger = await getLocalLedgerFor(entry.householdId).catch(() => null);
    if (!ledger) continue;
    const untouched = LEDGER_TABLE_NAMES.every((table) => {
      const rows = (ledger as unknown as Record<string, unknown>)[table];
      if (!Array.isArray(rows) || rows.length === 0) return true;
      if (table !== 'categories') return false;
      return rows.every(
        (row) => typeof (row as { id?: unknown }).id === 'string' &&
          (row as { id: string }).id.startsWith('cat_default_'),
      );
    });
    if (untouched) return entry.householdId;
  }
  return null;
}

async function restoreOneSection(
  entry: BudgetBackupFileHousehold,
  payload: BackupBundleSectionPayload,
  adoptMissing: boolean,
): Promise<BudgetRestoreHouseholdOutcome> {
  const label = payload.householdName?.trim() || entry.localName || 'Household';

  // Attachment bytes go to device storage, which is shared by every household
  // and addressed by image key — so this is deliberately outside the
  // household-pinned block below. Failures here never fail the ledger merge:
  // a wish with a missing photo is a wish; a wish that never arrived is a loss.
  const attachments = await restoreAttachmentBlobs(payload.attachmentsJson).catch(() => ({
    restoredCount: 0,
    failedCount: 0,
    uriByKey: new Map<string, string>(),
  }));

  if (hasLocalBudgetHousehold(entry.householdId)) {
    const summary = await runOnHousehold(entry.householdId, () =>
      applyRestorePayload(payload, { householdId: entry.householdId }),
    );
    return {
      householdId: summary.householdId,
      householdName: summary.summary.householdName,
      status: 'restored',
      message: `${summary.summary.spendings} spendings restored.`,
      summary: summary.summary,
      attachments: { restored: attachments.restoredCount, failed: attachments.failedCount },
    };
  }

  if (!adoptMissing) {
    return {
      householdId: entry.householdId,
      householdName: label,
      status: 'skipped',
      message: 'Not on this device — skipped.',
    };
  }

  /*
   * A household the file has and this device does not: take an empty local
   * household, then restore INTO it with `allowHouseholdReplace`, which adopts
   * the archived household's id and name wholesale (`applyLocalLedgerRestore`
   * → `rekeySessionTo`).
   *
   * Taking an empty one rather than replacing whatever happens to be open is
   * what makes a multi-household restore non-destructive: the old single-archive
   * path could only ever replace the ACTIVE household, so restoring a
   * three-household bundle that way would have overwritten the member's live
   * budget with the first section and dropped the other two.
   *
   * The empty household is REUSED where one exists, and only minted otherwise.
   * That is the fresh-install case and it is the common one: signing in creates
   * an empty household before the member ever reaches the restore screen, so
   * minting unconditionally would leave a device that restored three budgets
   * holding four — three restored and one stray empty one the member has to
   * work out how to remove. It is also what keeps the D1→V2 migration archives
   * landing where they always did.
   *
   * A mint seeds ten default categories with positional ids (`cat_default_1`
   * …). Those are the same ids the archived household's own seeds carry, so LWW
   * collapses them into one row rather than leaving twenty categories behind.
   */
  const placeholderId =
    (await findEmptyLocalHousehold()) ??
    (await createLocalBudgetHousehold({ displayName: label })).household.id;
  /*
   * The pin names the PLACEHOLDER, and the work inside renames the session out
   * from under it (`applyLocalLedgerRestore` → `rekeySessionTo` moves the
   * session to the archived id and follows the active pointer with it). So for
   * the tail of this call `pinnedHouseholdId` names an id the registry no
   * longer has.
   *
   * That is inert rather than merely tolerated. The pin is only ever read to
   * admit a rider — `runOnHousehold(sameId, …)` running inline — and no caller
   * can hold the placeholder's id: it was minted three lines ago and never
   * escapes this function. Every other caller queues on the session chain,
   * which this link holds until it returns.
   */
  const summary = await runOnHousehold(placeholderId, () =>
    applyRestorePayload(payload, { allowHouseholdReplace: true }),
  );
  return {
    householdId: summary.householdId,
    householdName: summary.summary.householdName,
    status: 'adopted',
    message: `Added to this device with ${summary.summary.spendings} spendings.`,
    summary: summary.summary,
    attachments: { restored: attachments.restoredCount, failed: attachments.failedCount },
  };
}

function summarizeBundleRestore(
  outcomes: BudgetRestoreHouseholdOutcome[],
): BudgetBundleRestoreResult {
  const landed = outcomes.filter(
    (entry) => entry.status === 'restored' || entry.status === 'adopted',
  );
  if (outcomes.length === 0) {
    return { status: 'failed', message: 'Nothing in this backup to restore.', households: [] };
  }
  if (landed.length === 0) {
    return {
      status: 'failed',
      message: outcomes[0].message,
      households: outcomes,
    };
  }
  if (landed.length < outcomes.length) {
    const lost = outcomes.length - landed.length;
    return {
      status: 'partial',
      message: `Restored ${landed.length} of ${outcomes.length} budgets — ${lost} could not be restored.`,
      households: outcomes,
    };
  }
  return {
    status: 'ok',
    message:
      landed.length === 1
        ? formatBudgetRestoreBreakdown(landed[0].summary!)
        : `Restored ${landed.length} budgets.`,
    households: outcomes,
  };
}

/**
 * The restore entry point for the UI: verify, then apply, for either file shape.
 *
 * Replaces `confirmAndRestoreBudgetBackup` for new callers — that one is kept
 * for the single-archive path it was written for and is what the v2 branch here
 * ends up doing anyway.
 */
export async function confirmAndRestoreBudgetBackupFile(
  fileJson: string,
  phrase: string,
  options: RestoreBudgetBundleOptions = {},
): Promise<BudgetBundleRestoreResult> {
  const report = (update: BudgetRestoreProgress) => {
    try {
      options.onProgress?.(update);
    } catch {
      // UI progress must never fail the restore.
    }
  };

  report({ stage: 'preparing', progress: 0.02, message: 'Preparing…' });
  // Double yield so the progress button can paint + start its UI-thread
  // animation before synchronous Argon2 blocks Hermes.
  await new Promise<void>((resolve) => setTimeout(resolve, 32));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => setTimeout(resolve, 48));

  report({ stage: 'deriving_key', progress: 0.08, message: 'Decrypting…' });
  const t0 = Date.now();
  let verified: BudgetBackupFileVerifyResult;
  try {
    verified = verifyBudgetBackupFile(fileJson, phrase);
  } catch (error) {
    console.error('[budget-restore] verify threw', error);
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Verify crashed.',
      households: [],
    };
  }
  console.log(
    '[budget-restore] verify done',
    'ms=',
    Date.now() - t0,
    'kind=',
    verified.kind,
    'status=',
    verified.status,
    'households=',
    verified.households.length,
  );
  if (verified.status === 'failed') {
    return { status: 'failed', message: verified.message, households: [] };
  }

  report({ stage: 'decrypting', progress: 0.9, message: 'Opening backup…' });
  await new Promise<void>((resolve) => setTimeout(resolve, 16));

  try {
    // A long Argon2 pass can outlive an in-flight `ensureSession` (or a fresh
    // install holding tokens but no open ledger yet). Re-open before mutating.
    if (!isLocalBudgetSessionOpen()) {
      report({ stage: 'applying', progress: 0.92, message: 'Opening local ledger…' });
      await ensureBudgetLocalSession();
    }
    if (!isLocalBudgetSessionOpen()) {
      return {
        status: 'failed',
        message: 'Budget local-first session is not open. Sign in once, then retry restore.',
        households: [],
      };
    }

    const restored = await restoreBudgetBackupBundle(verified, { ...options, onProgress: report });
    report({ stage: 'done', progress: 1, message: 'Restored' });
    return restored;
  } catch (error) {
    console.error('[budget-restore] apply failed', error);
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Restore failed.',
      households: [],
    };
  }
}
