/**
 * Subject-scoped chat rooms — "the chat ABOUT this project / this material".
 *
 * Four things are worth pinning down here, because each of them is a way the
 * feature could look like it works and not:
 *
 *  1. **Opening is idempotent.** The control is a button on a screen, so it gets
 *     tapped twice and gets tapped by two members at once. A second room for the
 *     same material would be invisible — both members would be typing into
 *     conversations neither can see.
 *  2. **The assistant is actually grounded.** The whole reason the client ships a
 *     context snapshot is that the Worker cannot read a local-first project. If
 *     that text does not reach the model's prompt, project chat is a general
 *     chatbot wearing a project's name, which is worse than not shipping it.
 *  3. **`@ai` pulls the assistant in.** It is the handle members type; a mention
 *     the app ignores reads as a broken assistant.
 *  4. **A private project's chat stays private.** The rooms list is the one place
 *     a draft project would otherwise become visible to the whole household.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '../../db/schema';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { ChatRoomService } from '../chat-room-service';

const mockGenerate = vi.fn();

vi.mock('../entitlement-service', () => ({
  assertCanUseAI: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../ai-credential-resolver', () => ({
  resolveProviderApiKey: vi.fn().mockResolvedValue({ apiKey: 'sk-test' }),
  hasUsableProviderKey: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../ai/provider-factory', () => ({
  createProviderAdapter: () => ({ generate: (...args: unknown[]) => mockGenerate(...args) }),
}));

const testEnv = env as unknown as Env;
const db = drizzle(testEnv.DB, { schema });

const HID = 'hh_subject_chat';
const OWNER = 'u_owner';
const MEMBER = 'u_member';

const PROJECT_ID = 'proj_kitchen';
const MATERIAL_ID = 'sel_oak';

async function createChatTables(): Promise<void> {
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS chat_rooms (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, created_by TEXT NOT NULL, ai_enabled INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0, is_assistant INTEGER NOT NULL DEFAULT 0, subject_type TEXT, subject_id TEXT, subject_parent_id TEXT, subject_label TEXT, subject_parent_label TEXT, subject_context_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT)`
  );
  // The partial unique index is what arbitrates the two-devices-at-once race, so
  // the test schema carries it too — without it the idempotency case below would
  // pass for the wrong reason (the read, not the constraint).
  await testEnv.DB.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS chat_rooms_subject_idx ON chat_rooms(household_id, subject_type, subject_id) WHERE subject_type IS NOT NULL`
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, household_id TEXT NOT NULL, sender_type TEXT NOT NULL, sender_user_id TEXT, body TEXT NOT NULL, metadata_json TEXT, attachments_json TEXT, edited_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS chat_room_participants (room_id TEXT NOT NULL, user_id TEXT NOT NULL, added_by TEXT, added_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (room_id, user_id))`
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS chat_room_reads (room_id TEXT NOT NULL, user_id TEXT NOT NULL, last_read_message_id TEXT, last_read_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (room_id, user_id))`
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS notification_history (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, data TEXT, sent_at TEXT NOT NULL, read_at TEXT, clicked_at TEXT, reference_type TEXT, reference_id TEXT)`
  );
}

async function seed(): Promise<void> {
  const ts = new Date().toISOString();
  await db.insert(schema.users).values([
    { id: OWNER, email: 'owner@x.com', display_name: 'Olivia', created_at: ts, updated_at: ts },
    { id: MEMBER, email: 'm@x.com', display_name: 'Marco', created_at: ts, updated_at: ts },
  ] as never);
  await db.insert(schema.households).values({
    id: HID,
    name: 'Test House',
    created_at: ts,
    updated_at: ts,
  } as never);
  await db.insert(schema.householdMembers).values([
    { id: 'm_o', household_id: HID, user_id: OWNER, role: 'owner', joined_at: ts },
    { id: 'm_m', household_id: HID, user_id: MEMBER, role: 'member', joined_at: ts },
  ] as never);
}

function service(): ChatRoomService {
  return new ChatRoomService(testEnv, testEnv.DB);
}

function collector() {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    flush: () => Promise.all(pending),
  };
}

/** Open the project's chat with a grounding snapshot. */
function openProjectChat(context?: string) {
  return service().getOrCreateSubjectRoom(HID, OWNER, {
    type: 'home_project',
    id: PROJECT_ID,
    label: 'Kitchen Reno',
    context: context ?? null,
  });
}

describe('subject-scoped chat rooms', () => {
  beforeEach(async () => {
    await resetAllTables(testEnv.DB);
    await createCoreTables(testEnv.DB);
    await createChatTables();
    // `resetAllTables` does not know about the chat tables (they are created
    // here, not by the shared helper), so they carry over between cases —
    // which showed up as one test reading the previous one's transcript.
    await testEnv.DB.exec('DELETE FROM chat_rooms');
    await testEnv.DB.exec('DELETE FROM chat_messages');
    await testEnv.DB.exec('DELETE FROM chat_room_participants');
    await testEnv.DB.exec('DELETE FROM chat_room_reads');
    await testEnv.DB.exec('DELETE FROM notification_history');
    await seed();
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue({
      content: [{ type: 'text', text: 'Sure — here is what I think.' }],
      stopReason: 'end_turn',
    });
  });

  it('creates one room per subject and returns the same room on re-open', async () => {
    const first = await openProjectChat('Target budget: $42,000');
    const second = await openProjectChat('Target budget: $48,000');

    expect(second.id).toBe(first.id);
    expect(first.subject).toEqual(
      expect.objectContaining({ type: 'home_project', id: PROJECT_ID, label: 'Kitchen Reno' })
    );

    const rows = await db.select().from(schema.chatRooms).all();
    expect(rows.filter((r) => r.subject_id === PROJECT_ID)).toHaveLength(1);
    // Re-opening refreshes the brief; a plan that has moved on must not keep
    // briefing the assistant with last week's numbers.
    expect(rows.find((r) => r.subject_id === PROJECT_ID)?.subject_context_json).toContain('48,000');
  });

  it('follows a project rename into the room title, but not over a custom one', async () => {
    const room = await openProjectChat();
    await service().getOrCreateSubjectRoom(HID, OWNER, {
      type: 'home_project',
      id: PROJECT_ID,
      label: 'Kitchen Reno v2',
    });

    let rows = await db.select().from(schema.chatRooms).all();
    expect(rows.find((r) => r.id === room.id)?.name).toBe('Kitchen Reno v2');

    // Once an owner names the room themselves, a later project rename must not
    // silently undo it.
    await service().renameRoom(HID, OWNER, room.id, 'Tile arguments');
    await service().getOrCreateSubjectRoom(HID, OWNER, {
      type: 'home_project',
      id: PROJECT_ID,
      label: 'Kitchen Reno v3',
    });

    rows = await db.select().from(schema.chatRooms).all();
    const after = rows.find((r) => r.id === room.id);
    expect(after?.name).toBe('Tile arguments');
    // The subject label still tracks the project, so the chat list groups under
    // the current name even when the room keeps a custom title.
    expect(after?.subject_label).toBe('Kitchen Reno v3');
  });

  it('groups a material chat under its project and rejects one without a project', async () => {
    const material = await service().getOrCreateSubjectRoom(HID, OWNER, {
      type: 'home_project_material',
      id: MATERIAL_ID,
      label: 'Herringbone Oak',
      parent_id: PROJECT_ID,
      parent_label: 'Kitchen Reno',
    });

    expect(material.subject?.parent_id).toBe(PROJECT_ID);
    expect(material.subject?.parent_label).toBe('Kitchen Reno');

    await expect(
      service().getOrCreateSubjectRoom(HID, OWNER, {
        type: 'home_project_material',
        id: 'sel_orphan',
        label: 'Orphan',
      })
    ).rejects.toThrow(/project it belongs to/i);
  });

  it('refuses a subject type the app has not declared', async () => {
    await expect(
      service().getOrCreateSubjectRoom(HID, OWNER, {
        type: 'grocery_list',
        id: 'g1',
        label: 'Groceries',
      })
    ).rejects.toThrow(/does not support/i);
  });

  it('deleting a project takes its material chats with it', async () => {
    const project = await openProjectChat();
    const material = await service().getOrCreateSubjectRoom(HID, OWNER, {
      type: 'home_project_material',
      id: MATERIAL_ID,
      label: 'Herringbone Oak',
      parent_id: PROJECT_ID,
      parent_label: 'Kitchen Reno',
    });

    const result = await service().deleteSubjectRooms(HID, OWNER, 'home_project', PROJECT_ID);
    expect(result.deleted).toBe(2);

    const remaining = await db.select().from(schema.chatRooms).all();
    const ids = remaining.map((r) => r.id);
    expect(ids).not.toContain(project.id);
    expect(ids).not.toContain(material.id);
  });

  it('keeps a private project’s chat out of other members’ rooms list', async () => {
    await service().getOrCreateSubjectRoom(HID, OWNER, {
      type: 'home_project',
      id: PROJECT_ID,
      label: 'Kitchen Reno (draft)',
      // A draft project is private to its creator; its chat must inherit that.
      participant_ids: [OWNER],
    });

    const ownerRooms = await service().listRooms(HID, OWNER);
    const memberRooms = await service().listRooms(HID, MEMBER);

    expect(ownerRooms.some((r) => r.subject?.id === PROJECT_ID)).toBe(true);
    expect(memberRooms.some((r) => r.subject?.id === PROJECT_ID)).toBe(false);
  });

  it('feeds the subject brief to the assistant when a member tags @ai', async () => {
    const room = await openProjectChat(
      'Project: Kitchen Reno\nTarget budget: $42,000\nEstimated so far: $38,400'
    );
    const c = collector();

    await service().postMessage(
      HID,
      OWNER,
      room.id,
      { body: '@ai are we still under budget?' },
      c.waitUntil
    );
    await c.flush();

    // `@ai` alone must pull the assistant in — it is the handle members type.
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    const prompt = JSON.stringify(mockGenerate.mock.calls[0]?.[0]);
    expect(prompt).toContain('Kitchen Reno');
    expect(prompt).toContain('42,000');
    expect(prompt).toContain('38,400');

    const messages = await service().getMessages(HID, OWNER, room.id);
    expect(messages.some((m) => m.sender_type === 'ai')).toBe(true);
  });

  it('says nothing about the subject when no brief has been written', async () => {
    // A heading with no facts under it is worse than silence: it reads to the
    // model as "here is what is known" and invites it to fill the gap.
    const room = await openProjectChat();
    const c = collector();

    await service().postMessage(HID, OWNER, room.id, { body: '@ai hello' }, c.waitUntil);
    await c.flush();

    const prompt = JSON.stringify(mockGenerate.mock.calls[0]?.[0]);
    expect(prompt).not.toContain('This conversation is about');
  });

  it('leaves an ordinary room ungrounded and unmentioned', async () => {
    const room = await service().createRoom(HID, OWNER, { name: 'Household' });
    expect(room.subject).toBeNull();

    const c = collector();
    await service().postMessage(HID, OWNER, room.id, { body: 'morning all' }, c.waitUntil);
    await c.flush();

    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
