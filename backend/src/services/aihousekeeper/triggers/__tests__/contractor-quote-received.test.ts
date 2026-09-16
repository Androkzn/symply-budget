/**
 * contractor_quote_received trigger — plan §D12
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../../../db/schema';
import { contractorQuotes, contractors } from '../../../../db/schema-contractors';
import type { Env } from '../../../../types';
import {
  createCoreTables,
  resetAllTables,
} from '../../__tests__/test-helpers';
import { contractorQuoteReceivedTrigger } from '../contractor-quote-received';

const testEnv = env as unknown as Env;
const HID = 'hh_cq_01';

async function seed() {
  await createCoreTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.households).values({ id: HID, name: 'CQ' });
  await db.insert(schema.tasks).values({
    id: 't_cq',
    household_id: HID,
    title: 'Roof repair',
    frequency: 'one_time',
  });
  await db.insert(contractors).values({
    id: 'c1',
    household_id: HID,
    name: 'Acme Roofing',
    specialty: 'roofer',
  });
  await testEnv.CONFIG_KV.delete(`aihousekeeper:trigger-guard:${HID}:contractor_quote_received`);
}

describe('contractorQuoteReceivedTrigger', () => {
  beforeEach(async () => {
    await seed();
  });

  it('fires when a pending quote was submitted within the last 24h', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const now = new Date('2026-04-23T12:00:00Z');
    const submittedAt = new Date(now.getTime() - 2 * 3600_000).toISOString();
    await db.insert(contractorQuotes).values({
      id: 'q_new',
      task_id: 't_cq',
      contractor_id: 'c1',
      household_id: HID,
      amount: 500000,
      currency: 'USD',
      status: 'pending',
      submitted_at: submittedAt,
      entry_method: 'manual',
    });
    const result = await contractorQuoteReceivedTrigger.evaluate(testEnv, HID, now);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.severity).toBe(4);
      const payload = result.payload as { quotes: Array<{ id: string }> };
      expect(payload.quotes[0].id).toBe('q_new');
    }
  });

  it('does not fire when the quote is older than the lookback window', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const now = new Date('2026-04-23T12:00:00Z');
    const submittedAt = new Date(now.getTime() - 48 * 3600_000).toISOString();
    await db.insert(contractorQuotes).values({
      id: 'q_old',
      task_id: 't_cq',
      contractor_id: 'c1',
      household_id: HID,
      amount: 500000,
      currency: 'USD',
      status: 'pending',
      submitted_at: submittedAt,
      entry_method: 'manual',
    });
    const result = await contractorQuoteReceivedTrigger.evaluate(testEnv, HID, now);
    expect(result).toBeNull();
  });

  it('does not fire when all recent quotes are non-pending', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const now = new Date('2026-04-23T12:00:00Z');
    const submittedAt = new Date(now.getTime() - 2 * 3600_000).toISOString();
    await db.insert(contractorQuotes).values({
      id: 'q_accepted',
      task_id: 't_cq',
      contractor_id: 'c1',
      household_id: HID,
      amount: 500000,
      currency: 'USD',
      status: 'accepted',
      submitted_at: submittedAt,
      entry_method: 'manual',
    });
    const result = await contractorQuoteReceivedTrigger.evaluate(testEnv, HID, now);
    expect(result).toBeNull();
  });
});
