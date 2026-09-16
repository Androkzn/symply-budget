/**
 * trust-ledger-service.ts — plan §B6
 *
 * One-event → one-row. Idempotency guard on event_idempotency_key means
 * re-emitting the same event must NOT produce a second row. Undo dispatch
 * routes through the correct handler per category.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../../db/schema';
import { assistantTrustLedger } from '../../../db/schema-aihousekeeper';
import type { Env } from '../../../types';
import { AihousekeeperEventBus } from '../event-bus';
import { TrustLedgerService } from '../trust-ledger-service';

import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from './test-helpers';

const testEnv = env as unknown as Env;
const HID = 'hh_led_01';

describe('TrustLedgerService', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createAihousekeeperTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.households).values({ id: HID, name: 'Ledger Test' });
  });

  it('one event_idempotency_key → exactly one ledger row (idempotency guard)', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const bus = new AihousekeeperEventBus();
    new TrustLedgerService(db, bus);
    const event_idempotency_key = 'idem-dup-ledger-01';

    await bus.emit({
      kind: 'memory_written',
      householdId: HID,
      eventIdempotencyKey: event_idempotency_key,
      memoryId: 'mem-01',
      memoryType: 'fact',
      summary: 'Remembered: first fact',
    });
    // Re-emit with SAME idempotency key — onConflictDoNothing should swallow.
    await bus.emit({
      kind: 'memory_written',
      householdId: HID,
      eventIdempotencyKey: event_idempotency_key,
      memoryId: 'mem-01-dup',
      memoryType: 'fact',
      summary: 'Remembered: duplicate',
    });

    const rows = await db
      .select()
      .from(assistantTrustLedger)
      .where(eq(assistantTrustLedger.household_id, HID))
      .all();
    expect(rows.length).toBe(1);
    expect(rows[0].event_idempotency_key).toBe(event_idempotency_key);
  });

  it('maps outbound_sent to message_sent category with correct refs', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const bus = new AihousekeeperEventBus();
    new TrustLedgerService(db, bus);
    await bus.emit({
      kind: 'outbound_sent',
      householdId: HID,
      eventIdempotencyKey: 'idem-sent-push-01',
      channel: 'push',
      template: 'task_overdue',
      idempotencyKey: 'task_overdue:t1',
    });
    const rows = await db
      .select()
      .from(assistantTrustLedger)
      .where(eq(assistantTrustLedger.household_id, HID))
      .all();
    expect(rows.length).toBe(1);
    expect(rows[0].category).toBe('message_sent');
  });

  it('maps memory_written event to memory_added ledger row with reversible=true', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const bus = new AihousekeeperEventBus();
    new TrustLedgerService(db, bus);
    await bus.emit({
      kind: 'memory_written',
      householdId: HID,
      eventIdempotencyKey: 'idem-mem-add-01',
      memoryId: 'mem_rev_01',
      memoryType: 'preference',
      summary: 'User prefers morning.',
    });
    const rows = await db
      .select()
      .from(assistantTrustLedger)
      .where(eq(assistantTrustLedger.household_id, HID))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('memory_added');
    expect(rows[0].reversible).toBe(true);
  });

  it('undo on non-reversible entry returns { status: irreversible }', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const bus = new AihousekeeperEventBus();
    const ledger = new TrustLedgerService(db, bus);
    await bus.emit({
      kind: 'outbound_sent',
      householdId: HID,
      eventIdempotencyKey: 'idem-undo-irr-01',
      channel: 'push',
      template: 't',
      idempotencyKey: 'k',
    });
    const [entry] = await db
      .select()
      .from(assistantTrustLedger)
      .where(eq(assistantTrustLedger.household_id, HID))
      .all();
    // outbound_sent maps to reversible=false.
    const result = await ledger.undo(entry.id);
    expect(result.status).toBe('irreversible');
  });

  it('dismiss sets user_dismissed_at', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const bus = new AihousekeeperEventBus();
    const ledger = new TrustLedgerService(db, bus);
    await bus.emit({
      kind: 'memory_written',
      householdId: HID,
      eventIdempotencyKey: 'idem-dismiss-01',
      memoryId: 'mem-dismiss',
      memoryType: 'fact',
      summary: 's',
    });
    const [entry] = await db
      .select()
      .from(assistantTrustLedger)
      .where(eq(assistantTrustLedger.household_id, HID))
      .all();
    await ledger.dismiss(entry.id);
    const refreshed = await db
      .select()
      .from(assistantTrustLedger)
      .where(eq(assistantTrustLedger.id, entry.id))
      .get();
    expect(refreshed?.user_dismissed_at).toBeTruthy();
  });
});
