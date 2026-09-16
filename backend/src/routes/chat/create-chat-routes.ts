/**
 * Shared household-chat HTTP + WebSocket routes.
 *
 * ONE Hono route topology for every app's chat, built by {@link createChatRoutes}
 * from a small {@link ChatRoutesConfig} (route segment, rate-limit key, R2 prefix,
 * and a service factory). House / Budget / future apps each call this with their
 * own config; the logic (schemas, handlers, image upload) is shared, so a change
 * here applies to all apps at once. Data isolation lives one layer down in the
 * service (each app's service targets its own tables + notification namespace).
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../../middleware/auth';
import { rateLimitDO } from '../../middleware/rate-limit';
import type { ChatRoomServiceCore } from '../../services/chat/chat-room-service-core';
import { HouseholdService } from '../../services/household-service';
import type { Env } from '../../types';
import { verifyAccessToken } from '../../utils/jwt';

/** Everything a chat's routes need that differs between apps. */
export interface ChatRoutesConfig {
  /** URL segment under `/households/:householdId/`, e.g. `chat-rooms`. */
  routeSegment: string;
  /** Durable-object rate-limit bucket key for send, e.g. `chat:message`. */
  rateLimitKey: string;
  /** R2 key prefix for uploaded attachments, e.g. `chat-images`. */
  r2Prefix: string;
  /** Constructs the app's chat service (bound to its tables + notif namespace). */
  createService: (env: Env, db: D1Database) => ChatRoomServiceCore;
}

const attachmentSchema = z.object({
  key: z.string().min(1),
  mimeType: z.string().optional(),
  name: z.string().max(200).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const createRoomSchema = z.object({
  name: z.string().min(1).max(80),
  ai_enabled: z.boolean().optional(),
  participant_ids: z.array(z.string()).optional(),
});

const renameRoomSchema = z.object({
  name: z.string().min(1).max(80),
});

/**
 * "Open the chat about this thing." One idempotent call that creates the room on
 * first use and returns the existing one afterwards — the caller is a button on
 * a project or material screen, not a creation flow.
 *
 * `context` is the assistant's grounding snapshot, sent by the client because
 * for a local-first household the Worker cannot read the project this chat is
 * about (see migration 0167).
 */
const openSubjectRoomSchema = z.object({
  subject_type: z.string().min(1).max(40),
  subject_id: z.string().min(1).max(120),
  subject_label: z.string().min(1).max(80),
  subject_parent_id: z.string().max(120).nullish(),
  subject_parent_label: z.string().max(80).nullish(),
  context: z.string().max(8000).nullish(),
  participant_ids: z.array(z.string()).max(50).optional(),
  name: z.string().min(1).max(80).optional(),
});

const sendMessageSchema = z.object({
  body: z.string().max(4000).optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
  mentions: z.array(z.string()).max(50).optional(),
  /** Id of the message this one is a reply to (renders a quoted preview). */
  reply_to_id: z.string().optional(),
});

const editMessageSchema = z.object({
  body: z.string().max(4000).optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
});

const setParticipantsSchema = z.object({
  participant_ids: z.array(z.string()),
});

const markReadSchema = z.object({
  last_read_message_id: z.string().optional(),
});

const uploadUrlSchema = z.object({
  filename: z.string().min(1).max(200),
  content_type: z.string().min(1).max(100),
});

/**
 * WebSocket-upgrade router — intentionally has NO auth middleware.
 *
 * It must be mounted in index.ts BEFORE the `/households` router (whose broad
 * `authMiddleware` on `/*` would otherwise reject the upgrade, since React
 * Native's WebSocket can't send an Authorization header). Auth happens inside
 * the handler via the `?token=` query param. It only owns `/:roomId/ws`, so all
 * other chat-rooms paths fall through to the authenticated REST router.
 */
export function createChatWsRoutes(): Hono<{ Bindings: Env }> {
  const wsRoutes = new Hono<{ Bindings: Env }>();

  wsRoutes.get('/:roomId/ws', async (c) => {
    if (c.req.header('Upgrade') !== 'websocket') {
      return c.json({ error: { code: 'bad_request', message: 'Expected websocket upgrade' } }, 426);
    }

    const householdId = c.req.param('householdId') as string;
    const roomId = c.req.param('roomId');
    const token = c.req.query('token');

    if (!token) {
      return c.json({ error: { code: 'unauthorized', message: 'Missing token' } }, 401);
    }

    const payload = await verifyAccessToken(token, c.env);
    if (!payload) {
      return c.json({ error: { code: 'unauthorized', message: 'Invalid or expired token' } }, 401);
    }

    // Membership check — throws ForbiddenError (→ 403 via onError) if not a member.
    const householdService = new HouseholdService(c.env, c.env.DB);
    await householdService.verifyAccess(householdId, payload.sub);

    const stub = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(roomId));
    const url = `https://chat-room/connect?userId=${encodeURIComponent(payload.sub)}`;
    return stub.fetch(new Request(url, c.req.raw));
  });

  return wsRoutes;
}

/** Build the authenticated REST router for one app's chat. */
export function createChatRoutes(config: ChatRoutesConfig): Hono<{ Bindings: Env }> {
  const { routeSegment, rateLimitKey, r2Prefix, createService } = config;
  const chatRooms = new Hono<{ Bindings: Env }>();
  chatRooms.use('/*', authMiddleware());

  /** GET / — list rooms with last message + unread counts. */
  chatRooms.get('/', async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const service = createService(c.env, c.env.DB);
    const rooms = await service.listRooms(householdId, userId);
    return c.json({ rooms });
  });

  /** POST / — create a room (optionally restricted to a participant set). */
  chatRooms.post('/', zValidator('json', createRoomSchema), async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const input = c.req.valid('json');
    const service = createService(c.env, c.env.DB);
    const room = await service.createRoom(householdId, userId, input);
    return c.json({ room }, 201);
  });

  /**
   * POST /subject — open (creating on first use) the ONE room for a subject.
   *
   * Registered before the `/:roomId` routes so `subject` is never read as a room
   * id. Idempotent: two devices tapping "Chat" on the same project at the same
   * moment both land in the same conversation.
   */
  chatRooms.post('/subject', zValidator('json', openSubjectRoomSchema), async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const input = c.req.valid('json');
    const service = createService(c.env, c.env.DB);
    const room = await service.getOrCreateSubjectRoom(householdId, userId, {
      type: input.subject_type,
      id: input.subject_id,
      label: input.subject_label,
      parent_id: input.subject_parent_id ?? null,
      parent_label: input.subject_parent_label ?? null,
      context: input.context ?? null,
      participant_ids: input.participant_ids,
      name: input.name,
    });
    return c.json({ room });
  });

  /**
   * DELETE /subject/:subjectType/:subjectId — drop the subject's room and every
   * room hanging off it (a project takes its material chats with it).
   *
   * Cleanup called after the subject itself is already gone, so it is permitted
   * to the household owner or to whoever started the chat — see
   * `deleteSubjectRooms`.
   */
  chatRooms.delete('/subject/:subjectType/:subjectId', async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const service = createService(c.env, c.env.DB);
    const result = await service.deleteSubjectRooms(
      householdId,
      userId,
      c.req.param('subjectType'),
      c.req.param('subjectId')
    );
    return c.json({ success: true, ...result });
  });

  /** PATCH /:roomId — owner-only: rename a room (General included). */
  chatRooms.patch('/:roomId', zValidator('json', renameRoomSchema), async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const roomId = c.req.param('roomId');
    const { name } = c.req.valid('json');
    const service = createService(c.env, c.env.DB);
    const room = await service.renameRoom(householdId, userId, roomId, name);
    return c.json({ room });
  });

  /** DELETE /:roomId — owner-only: delete a non-default room + its messages. */
  chatRooms.delete('/:roomId', async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const roomId = c.req.param('roomId');
    const service = createService(c.env, c.env.DB);
    await service.deleteRoom(householdId, userId, roomId);
    return c.json({ success: true });
  });

  /** GET /:roomId/participants — members + who's in the room. */
  chatRooms.get('/:roomId/participants', async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const roomId = c.req.param('roomId');
    const service = createService(c.env, c.env.DB);
    const result = await service.getParticipants(householdId, userId, roomId);
    return c.json(result);
  });

  /** PUT /:roomId/participants — owner-only: set the room's participant set. */
  chatRooms.put('/:roomId/participants', zValidator('json', setParticipantsSchema), async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const roomId = c.req.param('roomId');
    const { participant_ids } = c.req.valid('json');
    const service = createService(c.env, c.env.DB);
    const result = await service.setParticipants(householdId, userId, roomId, participant_ids);
    return c.json(result);
  });

  /** GET /:roomId/messages?before=&limit= — paginated history (oldest → newest). */
  chatRooms.get('/:roomId/messages', async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const roomId = c.req.param('roomId');
    const before = c.req.query('before');
    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

    const service = createService(c.env, c.env.DB);
    const messages = await service.getMessages(householdId, userId, roomId, { before, limit });
    return c.json({ messages });
  });

  /** POST /:roomId/messages — send a message (text and/or images; triggers broadcast + notify + AI). */
  chatRooms.post(
    '/:roomId/messages',
    rateLimitDO(rateLimitKey),
    zValidator('json', sendMessageSchema),
    async (c) => {
      const householdId = c.req.param('householdId') as string;
      const userId = c.get('userId');
      const roomId = c.req.param('roomId');
      const { body, attachments, mentions, reply_to_id } = c.req.valid('json');

      const service = createService(c.env, c.env.DB);
      const message = await service.postMessage(
        householdId,
        userId,
        roomId,
        { body: body ?? '', attachments, mentions, replyToId: reply_to_id },
        (p) => c.executionCtx.waitUntil(p)
      );
      return c.json({ message }, 201);
    }
  );

  /** PATCH /:roomId/messages/:messageId — edit your own message (text and/or image set). */
  chatRooms.patch('/:roomId/messages/:messageId', zValidator('json', editMessageSchema), async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const roomId = c.req.param('roomId');
    const messageId = c.req.param('messageId');
    const { body, attachments } = c.req.valid('json');

    const service = createService(c.env, c.env.DB);
    // `waitUntil` so an edit that ADDS an @assistant mention can schedule the
    // reply on the execution context, the same way posting one does.
    const message = await service.editMessage(
      householdId,
      userId,
      roomId,
      messageId,
      { body, attachments },
      (p) => c.executionCtx.waitUntil(p)
    );
    return c.json({ message });
  });

  /** DELETE /:roomId/messages — owner-only: permanently purge ALL messages in the room. */
  chatRooms.delete('/:roomId/messages', async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const roomId = c.req.param('roomId');
    const service = createService(c.env, c.env.DB);
    await service.clearHistory(householdId, userId, roomId);
    return c.json({ success: true });
  });

  /** DELETE /:roomId/messages/:messageId — delete your own (or, as owner, any) message. */
  chatRooms.delete('/:roomId/messages/:messageId', async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const roomId = c.req.param('roomId');
    const messageId = c.req.param('messageId');

    const service = createService(c.env, c.env.DB);
    const message = await service.deleteMessage(householdId, userId, roomId, messageId);
    return c.json({ message });
  });

  /** POST /:roomId/read — mark the room read up to a message. */
  chatRooms.post('/:roomId/read', zValidator('json', markReadSchema), async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const roomId = c.req.param('roomId');
    const { last_read_message_id } = c.req.valid('json');

    const service = createService(c.env, c.env.DB);
    await service.markRead(householdId, userId, roomId, last_read_message_id);
    return c.json({ success: true });
  });

  // ============ IMAGE ATTACHMENTS ============

  /** POST /:roomId/images/upload-url — reserve an R2 key + a direct-PUT upload URL. */
  chatRooms.post('/:roomId/images/upload-url', zValidator('json', uploadUrlSchema), async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const roomId = c.req.param('roomId');
    const { content_type } = c.req.valid('json');

    // Membership check (existence of the room is enforced on send).
    await new HouseholdService(c.env, c.env.DB).verifyAccess(householdId, userId);

    // Key is filename-independent so the follow-up PUT (which has no reliable
    // filename) stores under the exact key the client references on send.
    const imageId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const imageKey = `${r2Prefix}/${householdId}/${roomId}/${imageId}`;
    // Relative so the client's axios instance (with the API base + bearer token)
    // resolves + authenticates it, matching the aihousekeeper-attachments flow.
    const uploadUrl = `/households/${householdId}/${routeSegment}/${roomId}/images/${imageId}/upload`;

    return c.json({
      image_id: imageId,
      image_key: imageKey,
      upload_url: uploadUrl,
      content_type,
    });
  });

  /** PUT /:roomId/images/:imageId/upload — upload raw image bytes to R2. */
  chatRooms.put('/:roomId/images/:imageId/upload', async (c) => {
    const householdId = c.req.param('householdId') as string;
    const userId = c.get('userId');
    const roomId = c.req.param('roomId');
    const imageId = c.req.param('imageId');

    await new HouseholdService(c.env, c.env.DB).verifyAccess(householdId, userId);

    const contentType = c.req.header('content-type') || 'image/jpeg';
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) {
      return c.json({ error: 'File is empty' }, 400);
    }

    const imageKey = `${r2Prefix}/${householdId}/${roomId}/${imageId}`;
    await c.env.REPORTS_BUCKET.put(imageKey, body, {
      httpMetadata: { contentType },
    });

    return c.json({ image_key: imageKey });
  });

  return chatRooms;
}
