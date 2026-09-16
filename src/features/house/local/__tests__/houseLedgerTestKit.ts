/**
 * Shared fixtures for the House H1 projection suites. Mirrors
 * `src/features/budget/local/__tests__/ledgerTestKit.ts` so a reader who knows
 * the Budget suites can read these without re-learning the shape.
 */
import { emptyHouseTables, type HouseLedger } from '../engine';
import type { OpStamp } from '../projection';

export const TEST_HOUSEHOLD_ID = 'hh_test';

export function emptyHouseLedger(
  householdId = TEST_HOUSEHOLD_ID,
  memberId = 'member-local',
  deviceId = 'dev-local',
): HouseLedger {
  return {
    version: 1,
    household: {
      id: householdId,
      name: 'Shared home',
      address_line1: null,
      address_line2: null,
      city: null,
      state_province: null,
      postal_code: null,
      country: 'CA',
      unit_system: null,
      photo_key: null,
      photo_url: null,
      purchase_price: null,
      purchase_date: null,
      created_at: '2026-08-10T00:00:00.000Z',
      updated_at: '2026-08-10T00:00:00.000Z',
      member_count: 2,
      my_role: 'owner',
    },
    memberId,
    deviceId,
    ...emptyHouseTables(),
    ops: [],
    lww: {},
    conflicts: [],
  };
}

/** A Wave-A task row — the widest table, and the one every screen reads. */
export function taskRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    household_id: TEST_HOUSEHOLD_ID,
    system_category: 'hvac',
    title: `Task ${id}`,
    description: null,
    frequency: 'monthly',
    custom_interval_days: null,
    next_due_date: '2026-09-01',
    last_completed_at: null,
    assigned_to: null,
    space_id: null,
    is_active: true,
    source: 'manual',
    reminder_enabled: true,
    reminder_days_before: 3,
    reminder_time: '09:00',
    reminder_repeat: false,
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

/** House's highest-cardinality table — one row per occurrence of a task. */
export function completionRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    household_id: TEST_HOUSEHOLD_ID,
    task_id: 'task-1',
    completed_by: { id: 'member-local', display_name: 'Local' },
    completed_at: '2026-08-10T12:00:00.000Z',
    notes: null,
    photo_keys: [],
    ...overrides,
  };
}

/** HLCs sort by wall clock first, so `at` alone orders these deterministically. */
export function stampAt(at: number, author = 'member-peer', opId = `op-${at}`): OpStamp {
  return {
    hlc: `${String(1_800_000_000_000 + at).padStart(15, '0')}-0-devpeer1`,
    authorMemberId: author,
    opId,
  };
}
