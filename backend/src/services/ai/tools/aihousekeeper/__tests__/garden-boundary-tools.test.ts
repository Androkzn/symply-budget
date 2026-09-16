import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as schema from '../../../../../db/schema';
import { gardenPlanBoundaryDrafts } from '../../../../../db/schema-garden-plans';
import type { Env } from '../../../../../types';
import { MAP_PREVIEW_REMOVED } from '../../../../../types/geo';
import {
  createAihousekeeperTables,
  createCoreTables,
  resetAllTables,
} from '../../../../aihousekeeper/__tests__/test-helpers';
import { AihousekeeperEventBus } from '../../../../aihousekeeper/event-bus';
import { FamilyRouter } from '../../../../aihousekeeper/family-router';
import { MemoryService } from '../../../../aihousekeeper/memory-service';
import type { OutboundDispatcher } from '../../../../aihousekeeper/outbound-dispatcher';
import type { HouseholdService } from '../../../../household-service';
import type { ApprovalQueueFacade, AihousekeeperToolContext } from '../../index';
import {
  createPendingGardenBoundary,
  deletePendingGardenBoundary,
  editPendingGardenBoundary,
  listPendingGardenBoundaries,
} from '../garden-boundary-tools';


const testEnv = env as unknown as Env;

const HID = 'hh_boundary_tools_01';
const UID = 'u_boundary_tools_01';
const OTHER_HID = 'hh_boundary_tools_other';
const OTHER_UID = 'u_boundary_tools_other';

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createAihousekeeperTables(testEnv.DB);
  await resetAllTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([
    { id: UID, email: 'boundary-tools@example.com', email_verified: true },
    { id: OTHER_UID, email: 'boundary-tools-other@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values([
    {
      id: HID,
      name: 'Boundary Tool Home',
      address_line1: '8135 138 st',
      city: 'Surrey',
      state_province: 'BC',
      country: 'CA',
    },
    { id: OTHER_HID, name: 'Other Boundary Home' },
  ]);
  await db.insert(schema.householdMembers).values([
    {
      id: 'm_boundary_tools_owner',
      household_id: HID,
      user_id: UID,
      role: 'owner',
      joined_at: '2025-01-01T00:00:00Z',
    },
    {
      id: 'm_boundary_tools_other',
      household_id: OTHER_HID,
      user_id: OTHER_UID,
      role: 'owner',
      joined_at: '2025-01-01T00:00:00Z',
    },
  ]);
}

function mkContext(): AihousekeeperToolContext {
  const db = drizzle(testEnv.DB, { schema });
  return {
    env: {
      ...testEnv,
      API_URL: 'https://api.test',
    } as Env,
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

async function insertBoundary(overrides: Partial<typeof gardenPlanBoundaryDrafts.$inferInsert> = {}) {
  const now = '2026-04-27T00:00:00.000Z';
  const row = {
    id: overrides.id ?? `gb_${Math.random().toString(36).slice(2, 10)}`,
    household_id: overrides.household_id ?? HID,
    user_id: overrides.user_id ?? UID,
    address_json:
      overrides.address_json ??
      JSON.stringify({
        address_line1: '8135 138 st',
        city: 'Surrey',
        state_province: 'BC',
        country: 'CA',
      }),
    formatted_address:
      overrides.formatted_address ?? '8135 138 st, Surrey, BC, CA',
    geocode_json: overrides.geocode_json ?? null,
    geocode_place_name: overrides.geocode_place_name ?? '8135 138 Street',
    geocode_lat: overrides.geocode_lat ?? 49.15,
    geocode_lon: overrides.geocode_lon ?? -122.84,
    parcel_provider: overrides.parcel_provider ?? null,
    parcel_id: overrides.parcel_id ?? null,
    parcel_geojson: overrides.parcel_geojson ?? null,
    parcel_confidence: overrides.parcel_confidence ?? null,
    parcel_match_json: overrides.parcel_match_json ?? null,
    confirmed_geojson: overrides.confirmed_geojson ?? null,
    boundary_source: overrides.boundary_source ?? null,
    preview_image_key: overrides.preview_image_key ?? 'garden-plans/_boundary-previews/test.jpg',
    reference_image_key: overrides.reference_image_key ?? null,
    status: overrides.status ?? 'draft',
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
    expires_at: overrides.expires_at ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(gardenPlanBoundaryDrafts).values(row);
  return row.id;
}

describe('garden boundary tools', () => {
  beforeEach(async () => {
    await seed();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns map_preview_removed when creating a pending boundary', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ctx = mkContext();

    const result = (await createPendingGardenBoundary.execute(ctx, {
      address_line: '8135 138 st Surrey BC',
    })) as {
      ok: false;
      error: string;
      ui?: { actions: Array<{ action: { screen: string } }> };
    };

    expect(result.ok).toBe(false);
    expect(result.error).toBe(MAP_PREVIEW_REMOVED);
    expect(result.ui?.actions[0].action.screen).toBe('GardenPlanUpload');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists only this user’s unexpired pending boundaries', async () => {
    const mine = await insertBoundary({ id: 'gb_mine' });
    await insertBoundary({ id: 'gb_confirmed', status: 'confirmed' });
    await insertBoundary({
      id: 'gb_other',
      household_id: OTHER_HID,
      user_id: OTHER_UID,
    });
    await insertBoundary({
      id: 'gb_expired',
      expires_at: '2020-01-01T00:00:00.000Z',
    });

    const result = (await listPendingGardenBoundaries.execute(mkContext(), {})) as {
      ok: true;
      count: number;
      pending_boundaries: Array<{ boundary_draft_id: string }>;
    };

    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.pending_boundaries.map((draft) => draft.boundary_draft_id)).toEqual(
      expect.arrayContaining([mine, 'gb_confirmed'])
    );
  });

  it('returns map_preview_removed when editing a pending boundary', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const draftId = await insertBoundary({ id: 'gb_edit' });

    const result = (await editPendingGardenBoundary.execute(mkContext(), {
      boundary_draft_id: draftId,
      boundary_geojson: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.8405, 49.1496],
            [-122.8395, 49.1496],
            [-122.8395, 49.1504],
            [-122.8405, 49.1504],
            [-122.8405, 49.1496],
          ],
        ],
      },
      boundary_source: 'user_adjusted',
    })) as { ok: false; error: string };

    expect(result.ok).toBe(false);
    expect(result.error).toBe(MAP_PREVIEW_REMOVED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deletes only a boundary owned by the current household/user', async () => {
    const draftId = await insertBoundary({ id: 'gb_delete' });
    const otherId = await insertBoundary({
      id: 'gb_delete_other',
      household_id: OTHER_HID,
      user_id: OTHER_UID,
    });

    const result = (await deletePendingGardenBoundary.execute(mkContext(), {
      boundary_draft_id: draftId,
    })) as { ok: true; status: string };

    expect(result.ok).toBe(true);
    expect(result.status).toBe('garden_boundary_deleted');

    const db = drizzle(testEnv.DB, { schema });
    const deleted = await db
      .select()
      .from(gardenPlanBoundaryDrafts)
      .where(eq(gardenPlanBoundaryDrafts.id, draftId))
      .get();
    const other = await db
      .select()
      .from(gardenPlanBoundaryDrafts)
      .where(eq(gardenPlanBoundaryDrafts.id, otherId))
      .get();
    expect(deleted).toBeUndefined();
    expect(other).toBeTruthy();
  });
});
