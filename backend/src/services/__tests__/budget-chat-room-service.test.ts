/**
 * BudgetChatRoomService — coverage for the collaborative-chat enhancements:
 *   - @mention → a distinct `chat_mention` in-app notification to tagged members,
 *     while other offline members get the generic `chat_message`.
 *   - image attachments are stored only when their R2 key is under the room prefix.
 *   - edit/delete authorization (author-only edit; author-or-owner delete; soft-delete).
 *   - owner-only room delete (the AI chat protected) + participant scoping /
 *     access control (restricted rooms hidden from non-participants).
 *   - Budget auto-creates ONE room, the AI Budget Assistant: no "General" room
 *     (House keeps its own), and members create/delete their own rooms.
 *
 * Runs the service directly against a miniflare D1 with hand-written DDL (the
 * project's test convention — see aihousekeeper test-helpers). Push delivery is a
 * no-op here (no Expo tokens), so we assert on the always-written in-app
 * `notification_history` rows.
 */
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../db/schema';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import { BudgetChatRoomService } from '../budget-chat-room-service';

const testEnv = env as unknown as Env;
const db = drizzle(testEnv.DB, { schema });

const HID = 'hh_chat_1';
const OWNER = 'u_owner';
const MEMBER_A = 'u_member_a';
const MEMBER_B = 'u_member_b';

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

async function createNotificationTables(): Promise<void> {
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS notification_preferences (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, push_enabled INTEGER NOT NULL DEFAULT 1, email_enabled INTEGER NOT NULL DEFAULT 1, quiet_hours_start TEXT, quiet_hours_end TEXT, timezone TEXT DEFAULT 'America/New_York', task_reminders INTEGER NOT NULL DEFAULT 1, task_overdue INTEGER NOT NULL DEFAULT 1, task_assigned INTEGER NOT NULL DEFAULT 1, task_completed INTEGER NOT NULL DEFAULT 1, household_updates INTEGER NOT NULL DEFAULT 1, report_ready INTEGER NOT NULL DEFAULT 1, weekly_summary INTEGER NOT NULL DEFAULT 1, garbage_collection INTEGER NOT NULL DEFAULT 1, task_drafts_ready INTEGER NOT NULL DEFAULT 1, critical_findings INTEGER NOT NULL DEFAULT 1, maintenance_suggestions INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS notification_history (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, data TEXT, sent_at TEXT NOT NULL, read_at TEXT, clicked_at TEXT, reference_type TEXT, reference_id TEXT)`
  );
}

async function seed(): Promise<void> {
  const ts = new Date().toISOString();
  await db.insert(schema.users).values([
    { id: OWNER, email: 'owner@x.com', display_name: 'Olivia Owner', created_at: ts, updated_at: ts },
    { id: MEMBER_A, email: 'a@x.com', display_name: 'Adam A', created_at: ts, updated_at: ts },
    { id: MEMBER_B, email: 'b@x.com', display_name: 'Bella B', created_at: ts, updated_at: ts },
  ] as never);
  await db.insert(schema.households).values({
    id: HID,
    name: 'Test House',
    created_at: ts,
    updated_at: ts,
  } as never);
  await db.insert(schema.householdMembers).values([
    { id: 'm_o', household_id: HID, user_id: OWNER, role: 'owner', joined_at: ts },
    { id: 'm_a', household_id: HID, user_id: MEMBER_A, role: 'member', joined_at: ts },
    { id: 'm_b', household_id: HID, user_id: MEMBER_B, role: 'member', joined_at: ts },
  ] as never);
}

function service(): BudgetChatRoomService {
  return new BudgetChatRoomService(testEnv, testEnv.DB);
}

/** Collect fire-and-forget promises so we can await notifications before asserting. */
function collector() {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    flush: () => Promise.all(pending),
  };
}

/**
 * Budget auto-creates only the AI assistant chat — there is no "General" room —
 * so member-room behaviour is exercised against a room the owner creates.
 */
async function memberRoomId(name = 'Household'): Promise<string> {
  const room = await service().createRoom(HID, OWNER, { name });
  return room.id;
}

/** The one auto-created, undeletable chat. */
async function assistantRoomId(): Promise<string> {
  const rooms = await service().listRooms(HID, OWNER); // triggers ensureAssistantRoom
  return rooms.find((r) => r.is_assistant)!.id;
}

async function historyFor(userId: string): Promise<Array<{ type: string; title: string; body: string }>> {
  const res = await testEnv.DB.prepare(
    'SELECT type, title, body FROM notification_history WHERE user_id = ?'
  )
    .bind(userId)
    .all();
  return res.results as Array<{ type: string; title: string; body: string }>;
}

async function unreadNotifCount(userId: string): Promise<number> {
  const res = await testEnv.DB.prepare(
    'SELECT COUNT(*) AS n FROM notification_history WHERE user_id = ? AND read_at IS NULL'
  )
    .bind(userId)
    .all();
  return (res.results[0] as { n: number }).n;
}

beforeEach(async () => {
  await resetAllTables(testEnv.DB);
  await createCoreTables(testEnv.DB);
  await createBudgetChatTables();
  await createNotificationTables();
  await testEnv.DB.exec('DELETE FROM budget_chat_rooms');
  await testEnv.DB.exec('DELETE FROM budget_chat_messages');
  await testEnv.DB.exec('DELETE FROM budget_chat_room_participants');
  await testEnv.DB.exec('DELETE FROM notification_history');
  await testEnv.DB.exec('DELETE FROM notification_preferences');
  await seed();
});

describe('mentions → notifications', () => {
  it('sends chat_mention to tagged members and chat_message to other offline members', async () => {
    const roomId = await memberRoomId();
    const c = collector();

    await service().postMessage(
      HID,
      OWNER,
      roomId,
      { body: 'hey @Adam A can you check the sink', mentions: [MEMBER_A] },
      c.waitUntil
    );
    await c.flush();

    const aHist = await historyFor(MEMBER_A);
    expect(aHist).toHaveLength(1);
    expect(aHist[0].type).toBe('budget_chat_mention');
    expect(aHist[0].title).toContain('mentioned you');

    const bHist = await historyFor(MEMBER_B);
    expect(bHist).toHaveLength(1);
    expect(bHist[0].type).toBe('budget_chat_message');

    // The sender never notifies themselves.
    expect(await historyFor(OWNER)).toHaveLength(0);
  });

  it('does not double-notify a mentioned member with a generic chat_message', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    await service().postMessage(HID, OWNER, roomId, { body: 'yo @a', mentions: [MEMBER_A] }, c.waitUntil);
    await c.flush();

    const aHist = await historyFor(MEMBER_A);
    expect(aHist).toHaveLength(1);
    expect(aHist[0].type).toBe('budget_chat_mention');
  });

  it('ignores mention ids that are not members of the room audience', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    await service().postMessage(HID, OWNER, roomId, { body: 'hi', mentions: ['not_a_member'] }, c.waitUntil);
    await c.flush();
    expect(await historyFor('not_a_member')).toHaveLength(0);
  });
});

describe('markRead dismisses the room’s notifications', () => {
  it('marks the reader’s chat notifications for that room as read', async () => {
    const roomId = await memberRoomId();
    const c = collector();

    // OWNER mentions MEMBER_A + pings MEMBER_B → both get an unread chat notification.
    await service().postMessage(
      HID,
      OWNER,
      roomId,
      { body: 'heads up @Adam A', mentions: [MEMBER_A] },
      c.waitUntil
    );
    await c.flush();
    expect(await unreadNotifCount(MEMBER_A)).toBe(1);
    expect(await unreadNotifCount(MEMBER_B)).toBe(1);

    // MEMBER_A opens/reads the room → their room notification clears...
    await service().markRead(HID, MEMBER_A, roomId);
    expect(await unreadNotifCount(MEMBER_A)).toBe(0);
    // ...but MEMBER_B, who hasn't read it, still has an unread notification.
    expect(await unreadNotifCount(MEMBER_B)).toBe(1);
  });
});

describe('image attachments', () => {
  it('stores attachments only for keys under the room prefix', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    const goodKey = `budget-chat-images/${HID}/${roomId}/img1/photo.jpg`;
    const msg = await service().postMessage(
      HID,
      OWNER,
      roomId,
      {
        body: '',
        attachments: [
          { key: goodKey, mimeType: 'image/jpeg' },
          { key: 'budget-chat-images/other-house/x/evil.jpg' },
        ],
      },
      c.waitUntil
    );
    await c.flush();

    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments![0].key).toBe(goodKey);
    expect(msg.attachments![0].url).toContain('/files/');
  });

  it('rejects an empty message with no text and no attachments', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    await expect(
      service().postMessage(HID, OWNER, roomId, { body: '   ' }, c.waitUntil)
    ).rejects.toThrow();
  });
});

describe('reply', () => {
  it('snapshots the quoted message and exposes it as reply_to', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    const original = await service().postMessage(
      HID,
      MEMBER_A,
      roomId,
      { body: 'Where is the receipt?' },
      c.waitUntil
    );
    await c.flush();

    const reply = await service().postMessage(
      HID,
      OWNER,
      roomId,
      { body: 'here it is', replyToId: original.id },
      c.waitUntil
    );
    await c.flush();

    expect(reply.reply_to).toBeTruthy();
    expect(reply.reply_to!.id).toBe(original.id);
    expect(reply.reply_to!.preview).toContain('Where is the receipt');
    expect(reply.reply_to!.sender_name).toBeTruthy();
  });

  it('drops the reply snapshot when the target message does not exist', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    const reply = await service().postMessage(
      HID,
      OWNER,
      roomId,
      { body: 'reply to a ghost', replyToId: 'does-not-exist' },
      c.waitUntil
    );
    await c.flush();
    expect(reply.reply_to).toBeNull();
  });

  it('previews a photo-only quoted message as "📷 Photo"', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    const key = `budget-chat-images/${HID}/${roomId}/r/photo.jpg`;
    const original = await service().postMessage(
      HID,
      MEMBER_A,
      roomId,
      { body: '', attachments: [{ key, mimeType: 'image/jpeg' }] },
      c.waitUntil
    );
    await c.flush();

    const reply = await service().postMessage(
      HID,
      OWNER,
      roomId,
      { body: 'nice', replyToId: original.id },
      c.waitUntil
    );
    await c.flush();
    expect(reply.reply_to!.preview).toBe('📷 Photo');
  });
});

describe('edit / delete', () => {
  it('lets the author edit their own message and marks it edited', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    const msg = await service().postMessage(HID, MEMBER_A, roomId, { body: 'orignal' }, c.waitUntil);
    const edited = await service().editMessage(HID, MEMBER_A, roomId, msg.id, { body: 'original' });
    expect(edited.body).toBe('original');
    expect(edited.edited_at).toBeTruthy();
  });

  it('forbids editing another member’s message', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    const msg = await service().postMessage(HID, MEMBER_A, roomId, { body: 'mine' }, c.waitUntil);
    await expect(
      service().editMessage(HID, MEMBER_B, roomId, msg.id, { body: 'hacked' })
    ).rejects.toThrow();
  });

  it('keeps the existing images when an edit omits attachments', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    const key = `budget-chat-images/${HID}/${roomId}/keep/photo.jpg`;
    const msg = await service().postMessage(
      HID,
      MEMBER_A,
      roomId,
      { body: 'receipt', attachments: [{ key, mimeType: 'image/jpeg' }] },
      c.waitUntil
    );
    await c.flush();
    const edited = await service().editMessage(HID, MEMBER_A, roomId, msg.id, { body: 'updated' });
    expect(edited.body).toBe('updated');
    expect(edited.attachments).toHaveLength(1);
    expect(edited.attachments![0].key).toBe(key);
  });

  it('replaces the image set on edit: adds valid keys and strips removed ones', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    const oldKey = `budget-chat-images/${HID}/${roomId}/old/photo.jpg`;
    const newKey = `budget-chat-images/${HID}/${roomId}/new/photo.jpg`;
    const msg = await service().postMessage(
      HID,
      MEMBER_A,
      roomId,
      { body: 'first', attachments: [{ key: oldKey }] },
      c.waitUntil
    );
    await c.flush();
    // Drop oldKey, add newKey (plus a foreign key that must be rejected).
    const edited = await service().editMessage(HID, MEMBER_A, roomId, msg.id, {
      body: 'second',
      attachments: [{ key: newKey }, { key: 'budget-chat-images/other-house/x/evil.jpg' }],
    });
    expect(edited.attachments).toHaveLength(1);
    expect(edited.attachments![0].key).toBe(newKey);
  });

  it('lets an edit strip all images when text remains', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    const key = `budget-chat-images/${HID}/${roomId}/gone/photo.jpg`;
    const msg = await service().postMessage(
      HID,
      MEMBER_A,
      roomId,
      { body: 'has photo', attachments: [{ key }] },
      c.waitUntil
    );
    await c.flush();
    const edited = await service().editMessage(HID, MEMBER_A, roomId, msg.id, {
      body: 'text only',
      attachments: [],
    });
    expect(edited.attachments).toBeNull();
    expect(edited.body).toBe('text only');
  });

  it('rejects an edit that leaves neither text nor images', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    const key = `budget-chat-images/${HID}/${roomId}/last/photo.jpg`;
    const msg = await service().postMessage(
      HID,
      MEMBER_A,
      roomId,
      { body: 'has photo', attachments: [{ key }] },
      c.waitUntil
    );
    await c.flush();
    await expect(
      service().editMessage(HID, MEMBER_A, roomId, msg.id, { body: '   ', attachments: [] })
    ).rejects.toThrow();
  });

  it('soft-deletes: author delete blanks the body and sets deleted_at', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    const msg = await service().postMessage(HID, MEMBER_A, roomId, { body: 'secret' }, c.waitUntil);
    const deleted = await service().deleteMessage(HID, MEMBER_A, roomId, msg.id);
    expect(deleted.deleted_at).toBeTruthy();
    expect(deleted.body).toBe('');
  });

  it('lets a household owner delete another member’s message but forbids a peer', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    const msg = await service().postMessage(HID, MEMBER_A, roomId, { body: 'flag me' }, c.waitUntil);
    await expect(service().deleteMessage(HID, MEMBER_B, roomId, msg.id)).rejects.toThrow();
    const deleted = await service().deleteMessage(HID, OWNER, roomId, msg.id);
    expect(deleted.deleted_at).toBeTruthy();
  });
});

describe('participants + room delete', () => {
  it('restricts a room to its participant set and hides it from others', async () => {
    const room = await service().createRoom(HID, OWNER, { name: 'Owners only' });
    await service().setParticipants(HID, OWNER, room.id, [OWNER, MEMBER_A]);

    // MEMBER_B is not a participant → room is hidden + inaccessible.
    const bRooms = await service().listRooms(HID, MEMBER_B);
    expect(bRooms.find((r) => r.id === room.id)).toBeUndefined();
    await expect(service().getMessages(HID, MEMBER_B, room.id)).rejects.toThrow();

    // MEMBER_A is a participant → visible + accessible.
    const aRooms = await service().listRooms(HID, MEMBER_A);
    expect(aRooms.find((r) => r.id === room.id)).toBeDefined();
    await expect(service().getMessages(HID, MEMBER_A, room.id)).resolves.toBeInstanceOf(Array);
  });

  it('setParticipants is owner-only', async () => {
    const room = await service().createRoom(HID, MEMBER_A, { name: 'General chat' });
    await expect(
      service().setParticipants(HID, MEMBER_A, room.id, [MEMBER_A])
    ).rejects.toThrow();
  });

  it('owner can delete a room they created; the AI chat is protected', async () => {
    const room = await service().createRoom(HID, OWNER, { name: 'Temp' });
    await service().deleteRoom(HID, OWNER, room.id);
    const rows = await db.select().from(schema.budgetChatRooms).where(eq(schema.budgetChatRooms.id, room.id)).all();
    expect(rows).toHaveLength(0);

    await expect(service().deleteRoom(HID, OWNER, await assistantRoomId())).rejects.toThrow(
      /can’t be deleted/i
    );
  });

  it('non-owner cannot delete a room', async () => {
    const room = await service().createRoom(HID, OWNER, { name: 'Temp2' });
    await expect(service().deleteRoom(HID, MEMBER_A, room.id)).rejects.toThrow();
  });
});

describe('rename room', () => {
  it('owner renames a room (trimmed) and persists the new name', async () => {
    const room = await service().createRoom(HID, OWNER, { name: 'Old name' });
    const res = await service().renameRoom(HID, OWNER, room.id, '  Grocery split  ');
    expect(res.name).toBe('Grocery split');

    const row = await db
      .select()
      .from(schema.budgetChatRooms)
      .where(eq(schema.budgetChatRooms.id, room.id))
      .get();
    expect(row!.name).toBe('Grocery split');
  });

  it('allows renaming the AI chat', async () => {
    const res = await service().renameRoom(HID, OWNER, await assistantRoomId(), 'Money talk');
    expect(res.name).toBe('Money talk');
  });

  it('rejects an empty name and a non-owner', async () => {
    const room = await service().createRoom(HID, OWNER, { name: 'Keep' });
    await expect(service().renameRoom(HID, OWNER, room.id, '   ')).rejects.toThrow();
    await expect(service().renameRoom(HID, MEMBER_A, room.id, 'Nope')).rejects.toThrow();
  });
});

describe('clear history', () => {
  it('owner purges every message but keeps the room', async () => {
    const roomId = await memberRoomId();
    const c = collector();
    await service().postMessage(HID, OWNER, roomId, { body: 'one' }, c.waitUntil);
    await service().postMessage(HID, MEMBER_A, roomId, { body: 'two' }, c.waitUntil);
    await c.flush();

    const before = await db
      .select()
      .from(schema.budgetChatMessages)
      .where(eq(schema.budgetChatMessages.room_id, roomId))
      .all();
    expect(before.length).toBe(2);

    await service().clearHistory(HID, OWNER, roomId);

    const after = await db
      .select()
      .from(schema.budgetChatMessages)
      .where(eq(schema.budgetChatMessages.room_id, roomId))
      .all();
    expect(after.length).toBe(0);
    const room = await db
      .select()
      .from(schema.budgetChatRooms)
      .where(eq(schema.budgetChatRooms.id, roomId))
      .get();
    expect(room).toBeDefined();
  });

  it('is owner-only', async () => {
    const roomId = await memberRoomId();
    await expect(service().clearHistory(HID, MEMBER_A, roomId)).rejects.toThrow();
  });
});

describe('dedicated AI Budget Assistant room', () => {
  it('is the ONLY auto-created room — no "General" alongside it', async () => {
    const rooms = await service().listRooms(HID, OWNER);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].is_assistant).toBe(true);
    expect(rooms[0].name).toBe('AI Budget Assistant');
    expect(rooms[0].ai_enabled).toBe(true);

    // Not even in the table: Budget opts out of the default room entirely, so a
    // second undeletable chat can never reappear next to the AI one.
    const defaults = await db
      .select()
      .from(schema.budgetChatRooms)
      .where(eq(schema.budgetChatRooms.is_default, true))
      .all();
    expect(defaults).toHaveLength(0);

    // Idempotent across accesses.
    const again = await service().listRooms(HID, OWNER);
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(rooms[0].id);
  });

  it('stays pinned on top of the rooms members create', async () => {
    const assistantId = await assistantRoomId();
    await service().createRoom(HID, OWNER, { name: 'Groceries' });
    const rooms = await service().listRooms(HID, OWNER);
    expect(rooms).toHaveLength(2);
    expect(rooms[0].id).toBe(assistantId);
  });

  it('replies to every message without an @assistant mention', async () => {
    const rooms = await service().listRooms(HID, OWNER);
    const assistantId = rooms.find((r) => r.is_assistant)!.id;
    const c = collector();
    const msg = await service().postMessage(HID, OWNER, assistantId, { body: 'how am I doing?' }, c.waitUntil);
    expect(msg.metadata?.mentionsAssistant).toBeUndefined();
    expect(c.flush()).toBeInstanceOf(Promise);
  });

  it('cannot be deleted or have participants set', async () => {
    const rooms = await service().listRooms(HID, OWNER);
    const assistantId = rooms.find((r) => r.is_assistant)!.id;
    await expect(service().deleteRoom(HID, OWNER, assistantId)).rejects.toThrow(/can’t be deleted/i);
    await expect(
      service().setParticipants(HID, OWNER, assistantId, [OWNER, MEMBER_A])
    ).rejects.toThrow(/participants can’t be changed/i);
    // Still present after the failed delete.
    const still = await service().listRooms(HID, OWNER);
    expect(still.find((r) => r.id === assistantId)).toBeDefined();
  });
});
