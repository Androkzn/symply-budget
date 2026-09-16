/**
 * assign-tool.ts — plan §C5
 *
 * HIGH_WRITE — tool must NOT mutate directly. It parks via
 * ApprovalQueueShim for user approval.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as schema from '../../../../../db/schema';
import type { Env } from '../../../../../types';
import {
  createCoreTables,
  createAihousekeeperTables,
  resetAllTables,
} from '../../../../aihousekeeper/__tests__/test-helpers';
import { AihousekeeperEventBus } from '../../../../aihousekeeper/event-bus';
import { FamilyRouter } from '../../../../aihousekeeper/family-router';
import { MemoryService } from '../../../../aihousekeeper/memory-service';
import type { OutboundDispatcher } from '../../../../aihousekeeper/outbound-dispatcher';
import type { HouseholdService } from '../../../../household-service';
import type { ApprovalQueueFacade, AihousekeeperToolContext } from '../../index';
import { assignTaskToMember } from '../assign-tool';

const testEnv = env as unknown as Env;
const HID = 'hh_at_01';
const UID = 'u_at_01';

async function seed() {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({
    id: UID,
    email: 'alice@example.com',
    email_verified: true,
  });
  await db.insert(schema.households).values({ id: HID, name: 'AT' });
  await db.insert(schema.householdMembers).values({
    id: 'm_owner',
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
    responsibilities_json: JSON.stringify(['hvac']),
  });
  await db.insert(schema.tasks).values({
    id: 't_assign_01',
    household_id: HID,
    title: 'Service furnace',
    frequency: 'yearly',
    system_category: 'hvac',
  });
}

function mkContext(parkSpy: ReturnType<typeof vi.fn>): AihousekeeperToolContext {
  const db = drizzle(testEnv.DB, { schema });
  return {
    env: testEnv,
    db,
    householdId: HID,
    userId: UID,
    householdService: {
      getHousehold: vi.fn(async () => ({ id: HID })),
    } as unknown as HouseholdService,
    memory: {} as unknown as MemoryService,
    dispatcher: {} as unknown as OutboundDispatcher,
    familyRouter: new FamilyRouter(db),
    events: new AihousekeeperEventBus(),
    approvalQueue: {
      park: parkSpy,
    } as unknown as ApprovalQueueFacade,
    integrations: {
      sendgrid: { sendHtml: vi.fn(async () => ({ messageId: 'x' })) } as never,
      googleCalendar: {} as never,
    },
  };
}

describe('assign_task_to_member tool', () => {
  beforeEach(async () => {
    await seed();
  });

  it('parks the intent rather than mutating directly (HIGH_WRITE invariant)', async () => {
    const parkSpy = vi.fn(async () => ({
      pendingId: 'pending-xyz',
      status: 'parked',
    }));
    const ctx = mkContext(parkSpy);
    const result = (await assignTaskToMember.execute(ctx, {
      task_id: 't_assign_01',
    })) as { ok: true; status: string; member_id: string };
    expect(result.ok).toBe(true);
    expect(result.status).toBe('parked_for_approval');
    expect(result.member_id).toBe('m_owner');
    expect(parkSpy).toHaveBeenCalledTimes(1);
    const calls = parkSpy.mock.calls as unknown as Array<[{ toolName: string }]>;
    const parkArg = calls[0][0];
    expect(parkArg.toolName).toBe('assign_task_to_member');
  });

  it('returns task_not_found for cross-household task', async () => {
    const parkSpy = vi.fn(async () => ({ pendingId: 'x', status: 'parked' }));
    const ctx = mkContext(parkSpy);
    const result = (await assignTaskToMember.execute(ctx, {
      task_id: 'nonexistent',
    })) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe('task_not_found');
    expect(parkSpy).not.toHaveBeenCalled();
  });

  it('returns member_not_found when explicit member_id is not in the household', async () => {
    const parkSpy = vi.fn(async () => ({ pendingId: 'x', status: 'parked' }));
    const ctx = mkContext(parkSpy);
    const result = (await assignTaskToMember.execute(ctx, {
      task_id: 't_assign_01',
      member_id: 'unknown-member',
    })) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe('member_not_found');
  });
});
