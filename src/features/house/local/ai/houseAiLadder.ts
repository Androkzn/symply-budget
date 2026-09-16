/**
 * The P2 BYOK ladder for House (plan §9, Q6).
 *
 * Three stages, tried in order, exactly as Budget's `localImportLadder`:
 *
 *   **Stage A — deterministic, on device.** No key, no network, no provider.
 *     Rules over the ledger. This is the stage that must work for the majority
 *     of asks, because it is the only one that works for a member who has not
 *     supplied a key — which is most of them.
 *   **Stage B — the member's own provider key.** Context assembled from the
 *     ledger through the egress allowlist, sent to an allowlisted endpoint with
 *     the member's key from `aiKeyVault`.
 *   **Stage C — say so.** A named error carrying member-facing copy, never a
 *     raw provider error and never a silent empty state.
 *
 * **Why the grounding is better here than the server's ever was.** The plan
 * makes this point and it is worth keeping in the code: under the old model the
 * assistant saw whatever subset had synced to D1. Assembling on device means it
 * sees the whole current ledger — so Stage A can answer more without a key at
 * all, which is the stage that costs the member nothing.
 */
import type { HouseLedgerTableName } from '../schema';

import {
  isTableAllowedForEgress,
  projectAllowedRows,
  redactContext,
  type HouseAiContextRow,
} from './egressAllowlist';

export type HouseAiStage = 'A' | 'B' | 'C';

export type HouseAiLadderResult<T> =
  | { stage: 'A'; value: T }
  | { stage: 'B'; value: T }
  | { stage: 'C'; reason: HouseAiUnavailableReason };

/** Why the ladder ran out of rungs — each maps to distinct member-facing copy. */
export type HouseAiUnavailableReason =
  | 'no_key' // the member has supplied no provider key
  | 'provider_failed' // the key exists but the call did not succeed
  | 'not_supported'; // nothing on the ladder can answer this at all

export class HouseAiUnavailableError extends Error {
  readonly code = 'house_ai_unavailable';
  constructor(
    readonly reason: HouseAiUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = 'HouseAiUnavailableError';
  }
}

/** Member-facing copy per reason — Stage C must never surface a provider error. */
export function getHouseAiUnavailableCopy(reason: HouseAiUnavailableReason): {
  title: string;
  message: string;
} {
  switch (reason) {
    case 'no_key':
      return {
        title: 'Add an AI key to use this',
        message:
          'Your home data stays on your devices, so Symply cannot send it to an assistant on your behalf. Add your own provider key in Settings and the assistant will work using it — the key stays on this device too.',
      };
    case 'provider_failed':
      return {
        title: 'Your AI provider did not answer',
        message:
          'The request reached your provider but did not come back with an answer. That is usually a temporary outage or a key that has expired. Everything else in your home keeps working.',
      };
    case 'not_supported':
    default:
      return {
        title: 'The assistant cannot answer that yet',
        message:
          'This one is beyond what Symply can work out on your device. You can still see and edit everything in your home directly.',
      };
  }
}

export type HouseAiContext = {
  /** Only allowlisted tables and fields, already redacted. */
  tables: Partial<Record<HouseLedgerTableName, HouseAiContextRow[]>>;
  /** Tables the caller asked for but the allowlist refused, for observability. */
  excludedTables: HouseLedgerTableName[];
  /** Rows included, for a token-budget sanity check before sending. */
  rowCount: number;
};

/**
 * Assemble the context a Stage-B call is allowed to send.
 *
 * The ONLY sanctioned way to build a BYOK payload from the ledger. Callers pass
 * the tables they want; the allowlist decides what they get. A caller that
 * hand-rolls a payload from raw ledger rows bypasses the control entirely, which
 * is why the ladder takes a context rather than a ledger.
 */
export function buildHouseAiContext(
  ledger: Record<string, unknown>,
  requestedTables: readonly HouseLedgerTableName[],
  options: { maxRowsPerTable?: number } = {},
): HouseAiContext {
  const maxRows = options.maxRowsPerTable ?? 200;
  const tables: Partial<Record<HouseLedgerTableName, HouseAiContextRow[]>> = {};
  const excludedTables: HouseLedgerTableName[] = [];
  let rowCount = 0;

  for (const table of requestedTables) {
    if (!isTableAllowedForEgress(table)) {
      excludedTables.push(table);
      continue;
    }
    const raw = ledger[table];
    const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
    // Bounded before projection: a ten-year ledger has tens of thousands of
    // rows and a prompt is not the place to discover that.
    const projected = projectAllowedRows(table, rows.slice(0, maxRows));
    if (projected.length === 0) continue;
    tables[table] = redactContext(projected);
    rowCount += projected.length;
  }

  return { tables, excludedTables, rowCount };
}

export type HouseAiLadderInput<T> = {
  /** Deterministic answer from the ledger. Return null to fall through. */
  stageA: () => T | null;
  /**
   * The BYOK call. Receives ONLY the allowlisted context — it never sees the
   * ledger, which is what makes the allowlist unbypassable from here.
   */
  stageB?: (context: HouseAiContext) => Promise<T | null>;
  context: HouseAiContext;
  /** Whether the member has a usable provider key (checked by the caller). */
  hasProviderKey: boolean;
};

/**
 * Run the ladder.
 *
 * Stage A is always attempted first, even when a key exists: it is free,
 * instant, offline and private, and a deterministic answer beats a probabilistic
 * one whenever it is available.
 */
export async function runHouseAiLadder<T>(
  input: HouseAiLadderInput<T>,
): Promise<HouseAiLadderResult<T>> {
  const deterministic = input.stageA();
  if (deterministic !== null && deterministic !== undefined) {
    return { stage: 'A', value: deterministic };
  }

  if (!input.stageB) {
    return { stage: 'C', reason: 'not_supported' };
  }
  if (!input.hasProviderKey) {
    return { stage: 'C', reason: 'no_key' };
  }

  try {
    const answer = await input.stageB(input.context);
    if (answer !== null && answer !== undefined) {
      return { stage: 'B', value: answer };
    }
    return { stage: 'C', reason: 'provider_failed' };
  } catch {
    // A provider error must never reach the member as a raw string — Stage C
    // owns the copy (DoD H7: "Stage C copy shown, never a raw error").
    return { stage: 'C', reason: 'provider_failed' };
  }
}

/** Turn a Stage-C result into the throwable the UI layer branches on. */
export function houseAiUnavailable(reason: HouseAiUnavailableReason): HouseAiUnavailableError {
  return new HouseAiUnavailableError(reason, getHouseAiUnavailableCopy(reason).message);
}
