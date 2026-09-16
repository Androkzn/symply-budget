/**
 * The AI Housekeeper's STATE, on the ledger (H13 B-wave).
 *
 * ## What moved and what did not
 *
 * This module is the sharpest example in the programme of a distinction the
 * Tier-B label was hiding. "Server-authoritative" conflated two things:
 *
 *  - **What the assistant DID** — its persona, the briefings it composed, the
 *    trust-ledger entries recording each action. These are records. They are
 *    read on device, edited on device (renaming the assistant, dismissing an
 *    entry, marking a briefing read), and nothing about them needs a server.
 *    They are here.
 *  - **What the assistant DOES** — chat, voice, tool approvals, memory recall.
 *    These run a model. The device holds none, and the household's data is
 *    sealed under the HDK so the Worker cannot run one over it either. Those
 *    stay remote-by-design on the Proxy, declared rather than fallen through.
 *
 * Splitting the two is the whole value: a member offline can still read
 * yesterday's briefing, see what the assistant did and why, rename it, and turn
 * its channels off. Before this, all of that 404'd with no signal.
 *
 * ## The three shape divergences, all in the same direction
 *
 * D1 stores `bullets_json`, `source_signals_json`, `related_refs_json` and
 * `channels_enabled_json` as TEXT; the client DTOs expose them PARSED
 * (`bullets`, `source_signals`, `related_refs`, `channels_enabled`). The Worker
 * parses on the way out. The ledger table is the D1 table, so rows are stored
 * as TEXT and parsed at this boundary — same rule as
 * `localMaintenanceSuggestionsApi`'s `home_feature_id`. Storing the parsed form
 * would make a device's row disagree with a server-written one on the wire, and
 * they would never converge.
 *
 * `AssistantBriefing.push_sent` and `AssistantTrustLedgerEntry.reversible` are
 * DERIVED, not stored: D1 has `push_message_id` and `undo_token` and the Worker
 * computes the booleans. Reproduced here rather than added as columns.
 */
// Polyfill before the engine / @symply/local-first graph loads (@noble captures
// globalThis.crypto at module load) — plan §6.1.
import './cryptoPolyfill';

import type {
  AssistantBriefing,
  AssistantIdentity,
  AssistantIdentityPatch,
  AssistantTrustLedgerEntry,
  ListLedgerOptions,
} from '@/types/aihousekeeper';

import { houseDeterministicIds } from './ids';
import { nowIso, requireActiveProperty, rowsOf, writeLocal } from './localWrite';
import type {
  LocalAssistantBriefing,
  LocalAssistantIdentity,
  LocalAssistantTrustLedger,
} from './types';

/**
 * Parse a TEXT column that the client DTO exposes parsed.
 *
 * Never throws. A row whose JSON is malformed — hand-edited, truncated by a
 * partial write, or written by an older shape — must not take down the screen
 * that renders it; the fallback is the empty form of whatever was expected.
 */
function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Ledger row → the DTO screens read, including the two derived booleans. */
function briefingToDto(row: LocalAssistantBriefing): AssistantBriefing {
  return {
    id: row.id,
    household_id: row.household_id,
    date: row.date,
    composed_at: row.composed_at ?? '',
    paragraph: row.paragraph,
    bullets: parseJson<string[]>(row.bullets_json, []),
    // Derived on the Worker from `push_message_id`; derived here for the same
    // reason rather than stored, so the two backends cannot disagree.
    push_sent: row.push_message_id !== null && row.push_message_id !== undefined,
    push_message_id: row.push_message_id ?? null,
    read_at: row.read_at ?? null,
    empty_reason: row.empty_reason,
    source_signals: parseJson<Array<Record<string, unknown>>>(row.source_signals_json, []),
    composed_by_model: row.composed_by_model ?? null,
  } as AssistantBriefing;
}

function ledgerEntryToDto(row: LocalAssistantTrustLedger): AssistantTrustLedgerEntry {
  return {
    id: row.id,
    household_id: row.household_id,
    occurred_at: row.occurred_at ?? '',
    category: row.category,
    summary: row.summary,
    rationale: row.rationale,
    // Derived from `undo_token`, as on the Worker.
    reversible: row.undo_token !== null && row.undo_token !== undefined,
    undo_token: row.undo_token ?? null,
    related_refs: parseJson<Array<Record<string, unknown>> | null>(row.related_refs_json, null),
    user_dismissed_at: row.user_dismissed_at ?? null,
    event_idempotency_key: row.event_idempotency_key ?? null,
  } as AssistantTrustLedgerEntry;
}

function identityToDto(row: LocalAssistantIdentity): AssistantIdentity {
  return {
    household_id: row.household_id,
    name: row.name,
    tone: row.tone,
    pronouns: row.pronouns ?? null,
    briefing_time: row.briefing_time,
    quiet_hours_start: row.quiet_hours_start,
    quiet_hours_end: row.quiet_hours_end,
    daily_interrupt_budget: row.daily_interrupt_budget,
    channels_enabled: parseJson(row.channels_enabled_json, {}),
    timezone: row.timezone,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
  } as AssistantIdentity;
}

/**
 * The persona a household starts with.
 *
 * `getIdentity` MATERIALISES this rather than 404ing, because the server's
 * equivalent is a get-or-create and a screen that reads an assistant's name has
 * no sensible empty state. The id is deterministic on `household_id` — the
 * table is PK'd on that column in D1 and has no `id` at all — so two devices
 * that both materialise before syncing produce one row, not two personas.
 */
function defaultIdentity(householdId: string, now: string): LocalAssistantIdentity {
  return {
    id: houseDeterministicIds.assistantIdentityId(householdId),
    household_id: householdId,
    name: 'Mira',
    tone: 'warm',
    pronouns: null,
    briefing_time: '07:30',
    quiet_hours_start: '21:00',
    quiet_hours_end: '07:00',
    daily_interrupt_budget: 3,
    channels_enabled_json: JSON.stringify({ push: true, inApp: true }),
    // Not `Intl` — Hermes ships a reduced ICU and a missing time zone here
    // would be written into a synced row. UTC is wrong-but-stable; the member
    // sets it in settings and that write is what corrects it.
    timezone: 'UTC',
    created_at: now,
    updated_at: now,
  };
}

export const localAihousekeeperApi = {
  /** Get-or-create, mirroring the server. See `defaultIdentity`. */
  getIdentity: async (householdId: string): Promise<{ identity: AssistantIdentity }> => {
    const target = requireActiveProperty(householdId);
    const existing = rowsOf<LocalAssistantIdentity>('assistantIdentity')[0];
    if (existing) return { identity: identityToDto(existing) };

    const row = defaultIdentity(target, nowIso());
    await writeLocal(
      (draft) => {
        draft.assistantIdentity.push(row);
      },
      { opType: 'create', entityType: 'assistantIdentity', entityId: row.id },
    );
    return { identity: identityToDto(row) };
  },

  updateIdentity: async (
    householdId: string,
    patch: AssistantIdentityPatch,
  ): Promise<{ identity: AssistantIdentity }> => {
    const target = requireActiveProperty(householdId);
    // Materialise first so a patch against a household that has never opened
    // the assistant behaves like the server's get-or-create rather than a no-op.
    await localAihousekeeperApi.getIdentity(target);
    const now = nowIso();
    const id = houseDeterministicIds.assistantIdentityId(target);

    await writeLocal(
      (draft) => {
        const row = draft.assistantIdentity.find((r) => r.id === id);
        if (!row) return;
        const p = patch as Record<string, unknown>;
        // Field-by-field rather than a spread: the DTO carries `channels_enabled`
        // (parsed) and the row carries `channels_enabled_json` (TEXT), so a
        // spread would write the parsed key onto the row and lose the column.
        if (typeof p.name === 'string') row.name = p.name;
        if (typeof p.tone === 'string') row.tone = p.tone;
        if ('pronouns' in p) row.pronouns = (p.pronouns as string | null) ?? null;
        if (typeof p.briefing_time === 'string') row.briefing_time = p.briefing_time;
        if (typeof p.quiet_hours_start === 'string') row.quiet_hours_start = p.quiet_hours_start;
        if (typeof p.quiet_hours_end === 'string') row.quiet_hours_end = p.quiet_hours_end;
        if (typeof p.daily_interrupt_budget === 'number') {
          row.daily_interrupt_budget = p.daily_interrupt_budget;
        }
        if (typeof p.timezone === 'string') row.timezone = p.timezone;
        if (p.channels_enabled !== undefined) {
          row.channels_enabled_json = JSON.stringify(p.channels_enabled);
        }
        row.updated_at = now;
      },
      { opType: 'update', entityType: 'assistantIdentity', entityId: id },
    );

    const row = rowsOf<LocalAssistantIdentity>('assistantIdentity').find((r) => r.id === id);
    return { identity: identityToDto(row ?? defaultIdentity(target, now)) };
  },

  /** Newest first, matching the server's ordering. */
  listBriefings: async (householdId: string): Promise<{ briefings: AssistantBriefing[] }> => {
    requireActiveProperty(householdId);
    const briefings = rowsOf<LocalAssistantBriefing>('assistantBriefings')
      .slice()
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .map(briefingToDto);
    return { briefings };
  },

  /**
   * One day's briefing.
   *
   * Throws when absent rather than returning an empty briefing: a day the
   * assistant did not compose for and a day whose briefing failed to load must
   * not render identically.
   */
  getBriefing: async (
    householdId: string,
    date: string,
  ): Promise<{ briefing: AssistantBriefing }> => {
    requireActiveProperty(householdId);
    const row = rowsOf<LocalAssistantBriefing>('assistantBriefings').find((r) => r.date === date);
    if (!row) throw new Error(`No briefing for ${date}`);
    return { briefing: briefingToDto(row) };
  },

  /** Idempotent: re-marking keeps the FIRST read time, as the server does. */
  markBriefingRead: async (
    householdId: string,
    date: string,
  ): Promise<{ briefing: AssistantBriefing }> => {
    requireActiveProperty(householdId);
    const now = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.assistantBriefings.find((r) => r.date === date);
        if (!row || row.read_at) return;
        row.read_at = now;
      },
      { opType: 'update', entityType: 'assistantBriefings', entityId: date },
    );
    return localAihousekeeperApi.getBriefing(householdId, date);
  },

  listTrustLedger: async (
    householdId: string,
    opts?: ListLedgerOptions,
  ): Promise<{ entries: AssistantTrustLedgerEntry[] }> => {
    requireActiveProperty(householdId);
    const limit = (opts as { limit?: number } | undefined)?.limit;
    const rows = rowsOf<LocalAssistantTrustLedger>('assistantTrustLedger')
      .slice()
      // Dismissed entries stay in the list — the ledger is a record of what the
      // assistant did, and hiding a dismissal would make it a record of what the
      // member has not yet objected to.
      .sort((a, b) => (b.occurred_at ?? '').localeCompare(a.occurred_at ?? ''));
    const entries = (typeof limit === 'number' ? rows.slice(0, limit) : rows).map(ledgerEntryToDto);
    return { entries };
  },

  dismissLedgerEntry: async (householdId: string, entryId: string): Promise<void> => {
    requireActiveProperty(householdId);
    const now = nowIso();
    await writeLocal(
      (draft) => {
        const row = draft.assistantTrustLedger.find((r) => r.id === entryId);
        if (!row || row.user_dismissed_at) return;
        row.user_dismissed_at = now;
      },
      { opType: 'dismiss', entityType: 'assistantTrustLedger', entityId: entryId },
    );
  },
};

export type LocalAihousekeeperApi = typeof localAihousekeeperApi;

/**
 * Remote by design — the model surfaces.
 *
 * Named explicitly rather than left to fall through, so "this one goes to the
 * server" is a decision in the code. Every entry runs inference or reaches a
 * server-side queue: `chat` and `createVoiceSession` call a model; `listMemory`
 * / `forgetMemory` hit the FTS memory store; the followup and approval families
 * are the assistant's own server-side work queues; `getHomeInsight` is H7 and
 * already derives on device through `useHomeInsight` rather than this facade;
 * `undoLedgerEntry` replays a server-side action from an `undo_token` the
 * device cannot execute; `attachments` transfers bytes.
 */
export const HOUSE_LOCAL_AIHOUSEKEEPER_REMOTE_METHODS = [
  'getHomeInsight',
  'listMemory',
  'forgetMemory',
  'undoLedgerEntry',
  'listFollowups',
  'cancelFollowup',
  'listApprovals',
  'approveApproval',
  'cancelApproval',
  'chat',
  'createVoiceSession',
  'attachments',
] as const;
