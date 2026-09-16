import { describe, expect, it, vi } from 'vitest';

import type { AihousekeeperToolContext } from '../../index';
import {
  createHouseholdProperty,
  deleteHouseholdProperty,
  listHouseholdProperties,
  updateHouseholdProperty,
} from '../household-settings-tools';

const USER_ID = 'user-1';
const CURRENT_HOUSEHOLD_ID = 'hh-current';

function household(overrides: Record<string, unknown> = {}) {
  return {
    id: CURRENT_HOUSEHOLD_ID,
    name: 'Main Home',
    address_line1: '8135 138 St',
    address_line2: null,
    city: 'Surrey',
    state_province: 'BC',
    postal_code: null,
    country: 'CA',
    photo_key: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    member_count: 1,
    my_role: 'owner',
    floor_plan_count: 0,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<AihousekeeperToolContext> = {}) {
  const householdService = {
    getUserHouseholds: vi.fn().mockResolvedValue([household()]),
    getHousehold: vi.fn().mockResolvedValue(household()),
    createHousehold: vi.fn().mockResolvedValue(household({ id: 'hh-new', name: 'Cabin' })),
    updateHousehold: vi.fn().mockResolvedValue(household({ name: 'Updated Home' })),
  };
  const approvalQueue = {
    park: vi.fn().mockResolvedValue({ pendingId: 'pending-1', status: 'parked' }),
  };

  return {
    env: {},
    db: {},
    householdId: CURRENT_HOUSEHOLD_ID,
    userId: USER_ID,
    householdService,
    approvalQueue,
    memory: {},
    dispatcher: {},
    familyRouter: {},
    events: {},
    integrations: {
      sendgrid: {},
      googleCalendar: {},
    },
    ...overrides,
  } as unknown as AihousekeeperToolContext & {
    householdService: typeof householdService;
    approvalQueue: typeof approvalQueue;
  };
}

describe('household settings tools', () => {
  it('lists all saved properties for the current user', async () => {
    const ctx = makeCtx();

    const result = await listHouseholdProperties.execute(ctx, {});

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.households).toEqual([
      expect.objectContaining({
        id: CURRENT_HOUSEHOLD_ID,
        name: 'Main Home',
        address_line1: '8135 138 St',
      }),
    ]);
    expect(ctx.householdService.getUserHouseholds).toHaveBeenCalledWith(USER_ID);
  });

  it('creates a new property owned by the current user', async () => {
    const ctx = makeCtx();

    const result = await createHouseholdProperty.execute(ctx, {
      name: 'Cabin',
      address_line1: '1 Lake Rd',
      country: 'CA',
    });

    expect(result.ok).toBe(true);
    expect(result.household).toEqual(expect.objectContaining({ id: 'hh-new', name: 'Cabin' }));
    expect(ctx.householdService.createHousehold).toHaveBeenCalledWith(USER_ID, {
      name: 'Cabin',
      address_line1: '1 Lake Rd',
      country: 'CA',
    });
  });

  it('updates a specific saved property when household_id is supplied', async () => {
    const ctx = makeCtx();

    const result = await updateHouseholdProperty.execute(ctx, {
      household_id: 'hh-cabin',
      name: 'Updated Home',
      city: 'Vancouver',
    });

    expect(result.ok).toBe(true);
    expect(ctx.householdService.updateHousehold).toHaveBeenCalledWith('hh-cabin', USER_ID, {
      name: 'Updated Home',
      city: 'Vancouver',
    });
  });

  it('parks property deletion for approval', async () => {
    const ctx = makeCtx();

    const result = await deleteHouseholdProperty.execute(ctx, {
      household_id: 'hh-cabin',
      property_name: 'Cabin',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('parked_for_approval');
    expect(ctx.householdService.getHousehold).toHaveBeenCalledWith('hh-cabin', USER_ID);
    expect(ctx.approvalQueue.park).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: CURRENT_HOUSEHOLD_ID,
        userId: USER_ID,
        toolName: 'delete_household_property',
        input: {
          household_id: 'hh-cabin',
          property_name: 'Cabin',
        },
      })
    );
  });
});
