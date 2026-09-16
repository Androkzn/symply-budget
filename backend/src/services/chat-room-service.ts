/**
 * House household-chat service — a thin instantiation of the shared
 * {@link ChatRoomServiceCore} bound to the `chat_*` tables + House notification
 * namespace (see `HOUSE_CHAT_CONFIG`). All logic lives in the core so a change
 * there applies to every app; only the config differs. Data stays isolated:
 * this service reads/writes only the House `chat_*` tables.
 */
import type { Env } from '../types';

import { ChatRoomServiceCore } from './chat/chat-room-service-core';
import { HOUSE_CHAT_CONFIG } from './chat/configs';

export type {
  ChatAttachment,
  ChatMessageResponse,
  ChatRoomResponse,
  ChatRoomSubject,
  OpenSubjectRoomInput,
} from './chat/chat-room-service-core';

export class ChatRoomService extends ChatRoomServiceCore {
  constructor(env: Env, d1: D1Database) {
    super(env, d1, HOUSE_CHAT_CONFIG);
  }
}
