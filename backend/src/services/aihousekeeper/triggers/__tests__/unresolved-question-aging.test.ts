/**
 * unresolved_question_aging trigger — plan §D7
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../../../db/schema';
import { assistantMemory } from '../../../../db/schema-aihousekeeper';
import type { Env } from '../../../../types';
import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from '../../__tests__/test-helpers';
import { unresolvedQuestionAgingTrigger } from '../unresolved-question-aging';

const testEnv = env as unknown as Env;
const HID = 'hh_uqa_01';

async function seed() {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.households).values({ id: HID, name: 'UQA' });
  await testEnv.CONFIG_KV.delete(`aihousekeeper:trigger-guard:${HID}:unresolved_question_aging`);
}

describe('unresolvedQuestionAgingTrigger', () => {
  beforeEach(async () => {
    await seed();
  });

  it('fires when an unresolved_question is older than 14 days', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const twentyDaysAgo = new Date(Date.now() - 20 * 86_400_000).toISOString();
    await db.insert(assistantMemory).values({
      id: 'mem_q_aged',
      household_id: HID,
      type: 'unresolved_question',
      body: 'Did we decide on a new water heater?',
      redacted_body: 'Did we decide on a new water heater?',
      source: 'inferred',
      created_at: twentyDaysAgo,
    });
    const result = await unresolvedQuestionAgingTrigger.evaluate(
      testEnv,
      HID,
      new Date()
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result.severity).toBe(2);
    }
  });

  it('does not fire on fresh unresolved questions', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(assistantMemory).values({
      id: 'mem_q_fresh',
      household_id: HID,
      type: 'unresolved_question',
      body: 'just asked',
      redacted_body: 'just asked',
      source: 'inferred',
      created_at: new Date().toISOString(),
    });
    const result = await unresolvedQuestionAgingTrigger.evaluate(
      testEnv,
      HID,
      new Date()
    );
    expect(result).toBeNull();
  });
});
