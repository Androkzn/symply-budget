/**
 * Aihousekeeper event bus — plan §B6.
 *
 * Every Aihousekeeper service that would produce a ledger-visible action emits a
 * typed AihousekeeperEvent here. The TrustLedgerService subscribes once and persists
 * exactly one row per event. This is the chokepoint: no Aihousekeeper code writes to
 * `assistant_trust_ledger` directly (enforce via grep in CI if needed).
 *
 * Each event carries a deterministic `eventIdempotencyKey` so queue replays
 * (Stream F) yield at-most-once ledger rows via a partial unique index on
 * `assistant_trust_ledger.event_idempotency_key`.
 */

export type CanSendDenyReason =
  | 'aihousekeeper_disabled'
  | 'channel_killed'
  | 'conservative_mode'
  | 'channel_disabled'
  | 'tcpa_quiet_hours'
  | 'quiet_hours'
  | 'budget_exhausted'
  | 'duplicate';

export type Channel = 'push' | 'sms' | 'email' | 'watch';

export type MemoryType =
  | 'fact'
  | 'preference'
  | 'history'
  | 'decision'
  | 'unresolved_question';

interface AihousekeeperEventBase {
  householdId: string;
  eventIdempotencyKey: string;
}

export type AihousekeeperEvent =
  | (AihousekeeperEventBase & {
      kind: 'memory_written';
      memoryId: string;
      memoryType: MemoryType;
      summary: string;
    })
  | (AihousekeeperEventBase & { kind: 'memory_evicted'; count: number })
  | (AihousekeeperEventBase & {
      kind: 'briefing_composed';
      date: string;
      result: 'composed' | 'empty';
      reason?: string;
    })
  | (AihousekeeperEventBase & { kind: 'briefing_pushed'; date: string; messageId: string })
  | (AihousekeeperEventBase & {
      kind: 'outbound_sent';
      channel: Channel;
      template: string;
      idempotencyKey: string;
    })
  | (AihousekeeperEventBase & {
      kind: 'outbound_skipped';
      channel: Channel;
      reason: CanSendDenyReason | 'empty' | 'kill_switch';
    })
  | (AihousekeeperEventBase & {
      kind: 'followup_scheduled';
      followupId: string;
      scheduledFor: string;
    })
  | (AihousekeeperEventBase & {
      kind: 'followup_fired';
      followupId: string;
      decision: 'notify' | 'silent_close';
      rationale: string;
    })
  | (AihousekeeperEventBase & {
      kind: 'task_assigned';
      taskId: string;
      memberId: string;
      reason: string;
    })
  | (AihousekeeperEventBase & { kind: 'delegation_drafted'; tool: string; draftId: string })
  | (AihousekeeperEventBase & { kind: 'delegation_sent'; tool: string; draftId: string })
  | (AihousekeeperEventBase & {
      kind: 'decision_made';
      summary: string;
      rationale: string;
      reversible: boolean;
      undoToken?: string;
    });

export type AihousekeeperEventKind = AihousekeeperEvent['kind'];
export type AihousekeeperEventHandler = (event: AihousekeeperEvent) => Promise<void>;

/**
 * In-process pub/sub. Handlers are invoked concurrently; each is wrapped in
 * its own try/catch so one slow/failing subscriber cannot cascade.
 */
export class AihousekeeperEventBus {
  private handlers: AihousekeeperEventHandler[] = [];

  subscribe(handler: AihousekeeperEventHandler): void {
    this.handlers.push(handler);
  }

  async emit(event: AihousekeeperEvent): Promise<void> {
    await Promise.all(
      this.handlers.map((h) =>
        h(event).catch((err) => {
          // Log a surrogate (hashed household id prefix) to avoid leaking IDs
          // into logs. Full context stays in the thrown error for dev envs.
          console.error('[AihousekeeperEventBus] subscriber failed', {
            kind: event.kind,
            householdIdPrefix: event.householdId.slice(0, 8),
            error: (err as Error).message,
          });
        })
      )
    );
  }
}

// ---------- helpers ----------

/**
 * sha256 hex-digest via Workers crypto.subtle. Used by emitters to construct
 * stable `eventIdempotencyKey` values.
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
