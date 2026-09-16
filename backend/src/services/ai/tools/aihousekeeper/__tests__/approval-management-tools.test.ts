/**
 * approval-management-tools.ts — list_pending_approvals + cancel_pending_approval.
 *
 * These tools were added to fix Mira hallucinating "I'm canceling both
 * approvals" without an actual tool call backing it. Tests exercise:
 *
 *   - LIST returns scoped, projected rows (no ids from other households).
 *   - LIST returns count=0 when nothing is parked (so the prompt rule
 *     "say so honestly" has a deterministic ground truth).
 *   - CANCEL flips the row to 'cancelled' and returns ok=true.
 *   - CANCEL refuses cross-household ids (returns 'not_found' even when
 *     the row exists, so a fabricated id can't reach across tenants).
 *   - CANCEL refuses non-pending rows (already-approved row stays
 *     untouched and Mira gets the current_status to surface).
 *
 * The tests use a real D1 (Miniflare) so we cover the actual SQL paths
 * in ApprovalQueueShim.cancel — the bug we're guarding against was
 * specifically that the chat path skipped the household check, so a unit
 * test with a stubbed shim would be useless.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as schema from '../../../../../db/schema';
import { aiToolPending } from '../../../../../db/schema-ai-chat';
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
import {
  listPendingApprovals,
  cancelPendingApproval,
} from '../approval-management-tools';

const testEnv = env as unknown as Env;

const HID = 'hh_amt_01';
const UID = 'u_amt_01';
const OTHER_HID = 'hh_amt_other';
const OTHER_UID = 'u_amt_other';

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([
    { id: UID, email: 'amt@example.com', email_verified: true },
    { id: OTHER_UID, email: 'amt-other@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values([
    { id: HID, name: 'AMT Household' },
    { id: OTHER_HID, name: 'Other Household' },
  ]);
}

async function insertPending(
  householdId: string,
  userId: string,
  overrides: Partial<{
    id: string;
    tool_name: string;
    input_json: string;
    status: 'pending' | 'approved' | 'cancelled' | 'executed' | 'failed' | 'expired';
    created_at: string;
  }> = {}
): Promise<string> {
  const id = overrides.id ?? `p_${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(aiToolPending).values({
    id,
    household_id: householdId,
    user_id: userId,
    tool_name: overrides.tool_name ?? 'create_garden_site_plan',
    input_json:
      overrides.input_json ??
      JSON.stringify({
        plan_type: 'front_yard',
        area_label: 'Front yard',
        diagram_prompt: 'A simple top-down sketch.',
      }),
    idempotency_key: `idem_${id}`,
    status: overrides.status ?? 'pending',
    expires_at: expires,
    created_at: overrides.created_at ?? now,
    updated_at: now,
  });
  return id;
}

function mkContext(): AihousekeeperToolContext {
  const db = drizzle(testEnv.DB, { schema });
  return {
    env: testEnv,
    db: db as unknown as AihousekeeperToolContext['db'],
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
      park: vi.fn(),
    } as unknown as ApprovalQueueFacade,
    integrations: {
      sendgrid: {} as never,
      googleCalendar: {} as never,
    },
  };
}

describe('list_pending_approvals tool', () => {
  beforeEach(seed);

  it('returns count=0 with empty list when nothing is parked', async () => {
    const ctx = mkContext();
    const result = (await listPendingApprovals.execute(ctx, {})) as {
      ok: true;
      pending_approvals: unknown[];
      count: number;
    };
    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
    expect(result.pending_approvals).toEqual([]);
  });

  it('returns only pending rows for THIS household, projected to a safe shape', async () => {
    const myPendingId = await insertPending(HID, UID, {
      tool_name: 'create_garden_site_plan',
      input_json: JSON.stringify({
        plan_type: 'back_yard',
        area_label: 'Back yard',
        diagram_prompt: 'Top-down with deck.',
      }),
    });
    // Cross-household row that must NOT leak.
    await insertPending(OTHER_HID, OTHER_UID, {
      tool_name: 'create_garden_site_plan',
    });
    // Same household but already approved — must NOT appear in pending list.
    await insertPending(HID, UID, { status: 'approved' });

    const ctx = mkContext();
    const result = (await listPendingApprovals.execute(ctx, {})) as {
      ok: true;
      pending_approvals: Array<{
        pending_id: string;
        tool_name: string;
        summary: string;
        created_at: string;
      }>;
      count: number;
    };
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.pending_approvals[0].pending_id).toBe(myPendingId);
    expect(result.pending_approvals[0].tool_name).toBe('create_garden_site_plan');
    expect(result.pending_approvals[0].summary).toBe('Back yard (back yard)');
    // Only safe fields are exposed — no idempotency_key, no expires_at, no
    // input_json blob (those are implementation details Mira shouldn't talk
    // about and that bloat token cost).
    expect(result.pending_approvals[0]).not.toHaveProperty('idempotency_key');
    expect(result.pending_approvals[0]).not.toHaveProperty('expires_at');
    expect(result.pending_approvals[0]).not.toHaveProperty('input_json');
  });

  it('survives a row with malformed input_json (no crash, summary falls back)', async () => {
    await insertPending(HID, UID, { input_json: 'not-json{' });
    const ctx = mkContext();
    const result = (await listPendingApprovals.execute(ctx, {})) as {
      ok: true;
      pending_approvals: Array<{ summary: string }>;
    };
    expect(result.ok).toBe(true);
    // No specific fields recovered → falls back to the generic plan summary.
    expect(result.pending_approvals[0].summary).toBe('Garden site plan');
  });
});

describe('cancel_pending_approval tool', () => {
  beforeEach(seed);

  it('flips a pending row to cancelled and returns ok=true', async () => {
    const pid = await insertPending(HID, UID);
    const ctx = mkContext();
    const result = (await cancelPendingApproval.execute(ctx, {
      pending_id: pid,
      reason: 'changed my mind',
    })) as { ok: true; status: string };
    expect(result.ok).toBe(true);
    expect(result.status).toBe('cancelled');

    const db = drizzle(testEnv.DB, { schema });
    const row = await db
      .select({ status: aiToolPending.status, cancelled_by: aiToolPending.cancelled_by })
      .from(aiToolPending)
      .where(eq(aiToolPending.id, pid))
      .get();
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelled_by).toBe(UID);
  });

  it('refuses cross-household ids with not_found (security)', async () => {
    // Real row, but belongs to a different household. The chat-side scope
    // check in cancel_pending_approval must reject it BEFORE the underlying
    // ApprovalQueueShim mutation, otherwise a fabricated id would let one
    // tenant cancel another's approvals.
    const otherPid = await insertPending(OTHER_HID, OTHER_UID);
    const ctx = mkContext();
    const result = (await cancelPendingApproval.execute(ctx, {
      pending_id: otherPid,
    })) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_found');

    const db = drizzle(testEnv.DB, { schema });
    const row = await db
      .select({ status: aiToolPending.status })
      .from(aiToolPending)
      .where(eq(aiToolPending.id, otherPid))
      .get();
    // Row in the other household is untouched.
    expect(row?.status).toBe('pending');
  });

  it('refuses unknown ids with not_found', async () => {
    const ctx = mkContext();
    const result = (await cancelPendingApproval.execute(ctx, {
      pending_id: 'p_does_not_exist',
    })) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_found');
  });

  it('refuses non-pending rows with not_pending + current_status', async () => {
    const pid = await insertPending(HID, UID, { status: 'approved' });
    const ctx = mkContext();
    const result = (await cancelPendingApproval.execute(ctx, {
      pending_id: pid,
    })) as {
      ok: false;
      error: string;
      current_status: string;
      tool_name: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_pending');
    expect(result.current_status).toBe('approved');
    expect(result.tool_name).toBe('create_garden_site_plan');

    const db = drizzle(testEnv.DB, { schema });
    const row = await db
      .select({ status: aiToolPending.status })
      .from(aiToolPending)
      .where(eq(aiToolPending.id, pid))
      .get();
    // Already-approved row was NOT clobbered by the cancel attempt.
    expect(row?.status).toBe('approved');
  });
});
