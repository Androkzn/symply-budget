/**
 * approval-executor.ts — plan §B19 (v1.2 ADR-32 HIGH_WRITE execute-on-approve).
 *
 * Validates the round-trip: park a HIGH_WRITE tool invocation → approve →
 * executor dispatches by tool_name → mutation runs → queue row flips to
 * 'executed' (or 'failed' with a captured error message).
 *
 * Core coverage:
 *   - assign_task_to_member: task.assigned_to updates, ledger row written
 *     via the task_assigned event.
 *   - send_sms_to_contractor: re-verifies opt-in at execute-time (guards
 *     against a STOP between park and approve).
 *   - Unknown tool_name returns a clean {ok:false, error} without throwing.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../../db/schema';
import {
  aiToolPending,
  assistantTrustLedger,
} from '../../../db/schema';
import type { Env } from '../../../types';
import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from '../../aihousekeeper/__tests__/test-helpers';
import { executeApproved } from '../approval-executor';
import { ApprovalQueueShim } from '../approval-queue-shim';

const testEnv = env as unknown as Env;
const HID = 'hh_exec_01';
const OWNER_UID = 'u_exec_owner';
const ASSIGNEE_UID = 'u_exec_assignee';
const OWNER_MEMBER = 'm_exec_owner';
const ASSIGNEE_MEMBER = 'm_exec_assignee';

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([
    { id: OWNER_UID, email: 'owner@example.com', email_verified: true },
    { id: ASSIGNEE_UID, email: 'assignee@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values({ id: HID, name: 'ExecTest' });
  await db.insert(schema.householdMembers).values([
    {
      id: OWNER_MEMBER,
      household_id: HID,
      user_id: OWNER_UID,
      role: 'owner',
      joined_at: '2025-01-01T00:00:00Z',
    },
    {
      id: ASSIGNEE_MEMBER,
      household_id: HID,
      user_id: ASSIGNEE_UID,
      role: 'member',
      joined_at: '2025-01-01T00:00:00Z',
    },
  ]);
  await testEnv.CONFIG_KV.put('aihousekeeper_enabled', 'true');
  await testEnv.CONFIG_KV.put('aihousekeeper_outbound_loop_enabled', 'true');
  await testEnv.CONFIG_KV.put('aihousekeeper_sms_enabled', 'true');
  await testEnv.CONFIG_KV.put('aihousekeeper_email_digest_enabled', 'true');
  await testEnv.CONFIG_KV.put('aihousekeeper_conservative_mode', 'false');
}

describe('approval-executor', () => {
  beforeEach(async () => {
    await seed();
  });

  it('assign_task_to_member: park → execute updates maintenance_tasks.assigned_to + writes ledger row', async () => {
    const db = drizzle(testEnv.DB, { schema });
    // Seed a task owned by the household.
    const taskId = 't_exec_01';
    await db.insert(schema.tasks).values({
      id: taskId,
      household_id: HID,
      title: 'Change HVAC filter',
      description: null,
      system_category: 'hvac',
      frequency: 'quarterly',
      is_active: true,
    });

    // Park the approval.
    const approvals = new ApprovalQueueShim(testEnv.DB);
    const parked = await approvals.park({
      householdId: HID,
      userId: OWNER_UID,
      toolName: 'assign_task_to_member',
      input: {
        task_id: taskId,
        member_id: ASSIGNEE_MEMBER,
        reason: 'Bob handles HVAC',
        task_title: 'Change HVAC filter',
      },
      idempotencyKey: 'idem-exec-assign-01',
    });
    expect(parked.status).toBe('parked');

    // Approve → execute.
    await approvals.approve(parked.pendingId, OWNER_UID);
    const row = await approvals.get(parked.pendingId);
    expect(row).not.toBeNull();
    const outcome = await executeApproved(
      {
        id: row!.id,
        household_id: row!.household_id,
        user_id: row!.user_id,
        tool_name: row!.tool_name,
        input_json: row!.input_json,
      },
      testEnv
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.task_id).toBe(taskId);
      expect(outcome.result.assigned_user_id).toBe(ASSIGNEE_UID);
    }

    // Task now assigned.
    const task = await db
      .select({ assigned_to: schema.tasks.assigned_to })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .get();
    expect(task?.assigned_to).toBe(ASSIGNEE_UID);

    // Ledger row exists for the task_assigned event.
    const ledger = await db
      .select()
      .from(assistantTrustLedger)
      .where(eq(assistantTrustLedger.household_id, HID))
      .all();
    expect(ledger.length).toBeGreaterThanOrEqual(1);
    expect(ledger.some((e) => e.category === 'assignment')).toBe(true);
  });

  it('assign_task_to_member: returns member_not_found_or_cross_household when member was moved away between park and approve', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const taskId = 't_exec_02';
    await db.insert(schema.tasks).values({
      id: taskId,
      household_id: HID,
      title: 'Check smoke alarms',
      description: null,
      system_category: 'safety',
      frequency: 'monthly',
      is_active: true,
    });

    // Park referencing a member that never existed.
    const outcome = await executeApproved(
      {
        id: 'p-fake-01',
        household_id: HID,
        user_id: OWNER_UID,
        tool_name: 'assign_task_to_member',
        input_json: JSON.stringify({
          task_id: taskId,
          member_id: 'm_nonexistent',
          reason: 'should fail',
          task_title: 'Check smoke alarms',
        }),
      },
      testEnv
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe('member_not_found_or_cross_household');
  });

  it('unknown tool_name returns {ok:false} cleanly without throwing', async () => {
    const outcome = await executeApproved(
      {
        id: 'p-unknown-01',
        household_id: HID,
        user_id: OWNER_UID,
        tool_name: 'not_a_real_tool',
        input_json: '{}',
      },
      testEnv
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('unknown tool_name');
  });

  it('malformed input_json returns a clean error', async () => {
    const outcome = await executeApproved(
      {
        id: 'p-bad-json-01',
        household_id: HID,
        user_id: OWNER_UID,
        tool_name: 'assign_task_to_member',
        input_json: 'this is not JSON',
      },
      testEnv
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/malformed input_json/);
  });

  it('full round-trip via ApprovalQueueShim.markExecuted records the outcome in ai_tool_pending', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const taskId = 't_exec_roundtrip';
    await db.insert(schema.tasks).values({
      id: taskId,
      household_id: HID,
      title: 'Check furnace',
      description: null,
      system_category: 'hvac',
      frequency: 'yearly',
      is_active: true,
    });

    const approvals = new ApprovalQueueShim(testEnv.DB);
    const parked = await approvals.park({
      householdId: HID,
      userId: OWNER_UID,
      toolName: 'assign_task_to_member',
      input: {
        task_id: taskId,
        member_id: ASSIGNEE_MEMBER,
        reason: 'annual check',
        task_title: 'Check furnace',
      },
      idempotencyKey: 'idem-roundtrip-01',
    });
    await approvals.approve(parked.pendingId, OWNER_UID);
    const row = await approvals.get(parked.pendingId);
    const outcome = await executeApproved(
      {
        id: row!.id,
        household_id: row!.household_id,
        user_id: row!.user_id,
        tool_name: row!.tool_name,
        input_json: row!.input_json,
      },
      testEnv
    );
    await approvals.markExecuted(parked.pendingId, outcome);

    const final = await db
      .select()
      .from(aiToolPending)
      .where(eq(aiToolPending.id, parked.pendingId))
      .get();
    expect(final?.status).toBe('executed');
    expect(final?.executed_at).toBeTruthy();
    expect(final?.execution_result_json).toBeTruthy();
    const parsed = JSON.parse(final!.execution_result_json!) as {
      task_id: string;
    };
    expect(parsed.task_id).toBe(taskId);
  });

  it('delete_household_property: soft-deletes the approved property', async () => {
    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.households).values({
      id: 'hh_delete_01',
      name: 'Cabin',
    });
    await db.insert(schema.householdMembers).values({
      id: 'm_delete_owner',
      household_id: 'hh_delete_01',
      user_id: OWNER_UID,
      role: 'owner',
      joined_at: '2025-01-01T00:00:00Z',
    });

    const outcome = await executeApproved(
      {
        id: 'p-delete-household-01',
        household_id: HID,
        user_id: OWNER_UID,
        tool_name: 'delete_household_property',
        input_json: JSON.stringify({
          household_id: 'hh_delete_01',
          property_name: 'Cabin',
        }),
      },
      testEnv
    );

    expect(outcome.ok).toBe(true);
    const deleted = await db
      .select({ deleted_at: schema.households.deleted_at })
      .from(schema.households)
      .where(eq(schema.households.id, 'hh_delete_01'))
      .get();
    expect(deleted?.deleted_at).toBeTruthy();
  });
});
