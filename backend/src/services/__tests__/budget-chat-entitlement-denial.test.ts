/**
 * BUDGET-BCHAT-040 — entitlement denial is silent (warn + return, no throw).
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '../../db/schema';
import type { Env } from '../../types';
import { AIAccessError } from '../../utils/errors';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { BudgetChatRoomService } from '../budget-chat-room-service';

const mockAssertCanUseAI = vi.fn();
const mockResolveProviderApiKey = vi.fn();

vi.mock('../entitlement-service', () => ({
  assertCanUseAI: (...args: unknown[]) => mockAssertCanUseAI(...args),
}));

vi.mock('../ai-credential-resolver', () => ({
  resolveProviderApiKey: (...args: unknown[]) => mockResolveProviderApiKey(...args),
  hasUsableProviderKey: async (...args: unknown[]) => {
    const { apiKey } = await mockResolveProviderApiKey(...args);
    return apiKey.length > 0;
  },
}));

vi.mock('../../ai/provider', () => ({
  createProviderAdapter: (config: { provider: string }) => ({
    provider: config.provider,
    generate: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
  }),
}));

const testEnv = env as unknown as Env;
const HID = 'hh_chat_entitlement';
const OWNER = 'u_owner';

async function createBudgetChatTables(): Promise<void> {
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS budget_chat_rooms (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, created_by TEXT NOT NULL, ai_enabled INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0, is_assistant INTEGER NOT NULL DEFAULT 0, subject_type TEXT, subject_id TEXT, subject_parent_id TEXT, subject_label TEXT, subject_parent_label TEXT, subject_context_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT)`
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS budget_chat_messages (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, household_id TEXT NOT NULL, sender_type TEXT NOT NULL, sender_user_id TEXT, body TEXT NOT NULL, metadata_json TEXT, attachments_json TEXT, edited_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS budget_chat_room_participants (room_id TEXT NOT NULL, user_id TEXT NOT NULL, added_by TEXT, added_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (room_id, user_id))`
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS budget_chat_room_reads (room_id TEXT NOT NULL, user_id TEXT NOT NULL, last_read_message_id TEXT, last_read_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (room_id, user_id))`
  );
}

async function seed(): Promise<void> {
  const ts = new Date().toISOString();
  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({
    id: OWNER,
    email: 'owner@example.com',
    display_name: 'Owner',
    created_at: ts,
    updated_at: ts,
  } as never);
  await db.insert(schema.households).values({
    id: HID,
    name: 'Chat House',
    created_at: ts,
    updated_at: ts,
  } as never);
  await db.insert(schema.householdMembers).values({
    id: 'm_o',
    household_id: HID,
    user_id: OWNER,
    role: 'owner',
    joined_at: ts,
  } as never);
}

function service(): BudgetChatRoomService {
  return new BudgetChatRoomService(testEnv, testEnv.DB);
}

function collector() {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    flush: () => Promise.all(pending),
  };
}

describe('budget chat entitlement denial (BUDGET-BCHAT-040)', () => {
  beforeEach(async () => {
    await resetAllTables(testEnv.DB);
    await createCoreTables(testEnv.DB);
    await createBudgetChatTables();
    await seed();
    vi.clearAllMocks();
    mockResolveProviderApiKey.mockResolvedValue({ apiKey: 'sk-test' });
    testEnv.ANTHROPIC_API_KEY = 'platform-key';
  });

  it('returns the user message without throwing when assertCanUseAI denies', async () => {
    mockAssertCanUseAI.mockRejectedValue(AIAccessError.fromReason('AI_ACCESS_REQUIRED'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Budget auto-creates only the AI chat, so the @assistant path is exercised
    // in a member room the owner creates.
    const { id: roomId } = await service().createRoom(HID, OWNER, { name: 'Household' });
    const c = collector();

    const message = await service().postMessage(
      HID,
      OWNER,
      roomId,
      { body: 'hey @assistant what is our budget?' },
      c.waitUntil
    );
    await c.flush();

    expect(message.body).toContain('@assistant');
    expect(mockResolveProviderApiKey).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[budget-chat] entitlement denied; skipping assistant reply',
      expect.objectContaining({ code: expect.any(String) })
    );

    warnSpy.mockRestore();
  });
});
