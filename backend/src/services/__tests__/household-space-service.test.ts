/**
 * B10 optimistic locking on household_spaces.version (CAS → 409).
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import { householdSpaces } from '../../db/schema';
import type { Env } from '../../types';
import { ConflictError } from '../../utils/errors';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { HouseholdSpaceService } from '../household-space-service';

const testEnv = env as unknown as Env;

const UID = 'u_space_cas';
const HID = 'hh_space_cas';
const SID = 'sp_space_cas';

const HOUSEHOLD_SPACES_DDL = `CREATE TABLE IF NOT EXISTS household_spaces (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  space_type TEXT NOT NULL,
  category TEXT,
  floor_level INTEGER,
  icon_emoji TEXT,
  icon_color TEXT,
  custom_image_key TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  area_sqft INTEGER,
  floor_plan_id TEXT,
  plan_x_percent REAL,
  plan_y_percent REAL,
  plan_width_percent REAL,
  plan_height_percent REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
)`;

async function setupSchema(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await testEnv.DB.prepare(HOUSEHOLD_SPACES_DDL.replace(/\s+/g, ' ').trim()).run();
  await resetAllTables(testEnv.DB);
  await testEnv.DB.prepare('DELETE FROM household_spaces').run().catch(() => undefined);

  await testEnv.DB.prepare(
    'INSERT INTO users (id, email, email_verified) VALUES (?, ?, 1)'
  )
    .bind(UID, 'space-cas@example.com')
    .run();
  await testEnv.DB.prepare('INSERT INTO households (id, name) VALUES (?, ?)')
    .bind(HID, 'Space CAS')
    .run();
  await testEnv.DB.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, joined_at)
     VALUES ('m_space_cas', ?, ?, 'owner', '2025-01-01T00:00:00.000Z')`
  )
    .bind(HID, UID)
    .run();

  const db = drizzle(testEnv.DB);
  await db.insert(householdSpaces).values({
    id: SID,
    household_id: HID,
    name: 'Kitchen',
    space_type: 'custom',
    display_order: 0,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    version: 1,
  });
}

describe('HouseholdSpaceService B10 optimistic lock', () => {
  beforeEach(async () => {
    await setupSchema();
  });

  it('updates when version matches and increments version', async () => {
    const svc = new HouseholdSpaceService(testEnv, testEnv.DB);
    const updated = await svc.updateSpace(HID, SID, UID, {
      name: 'Updated Kitchen',
      version: 1,
    });

    expect(updated.name).toBe('Updated Kitchen');
    expect(updated.version).toBe(2);
  });

  it('throws ConflictError (409) when version is stale', async () => {
    const svc = new HouseholdSpaceService(testEnv, testEnv.DB);
    await svc.updateSpace(HID, SID, UID, { name: 'First write', version: 1 });

    await expect(
      svc.updateSpace(HID, SID, UID, { name: 'Stale write', version: 1 })
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      svc.updateSpace(HID, SID, UID, { name: 'Stale write', version: 1 })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('throws ConflictError on reorder when version is stale', async () => {
    const svc = new HouseholdSpaceService(testEnv, testEnv.DB);
    await svc.updateSpace(HID, SID, UID, { name: 'Bump version', version: 1 });

    await expect(
      svc.reorderSpaces(HID, UID, [{ space_id: SID, display_order: 2, version: 1 }])
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws ConflictError on delete when expectedVersion is stale', async () => {
    const svc = new HouseholdSpaceService(testEnv, testEnv.DB);
    await svc.updateSpace(HID, SID, UID, { name: 'Bump version', version: 1 });

    await expect(svc.deleteSpace(HID, SID, UID, 1)).rejects.toBeInstanceOf(ConflictError);
  });
});
