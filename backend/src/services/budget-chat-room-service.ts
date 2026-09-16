/**
 * Budget household-chat service — a thin instantiation of the shared
 * {@link ChatRoomServiceCore} bound to the `budget_chat_*` tables + Budget
 * notification namespace (see `BUDGET_CHAT_CONFIG`). All logic lives in the core
 * so a change there applies to every app; only the config differs. Data stays
 * isolated: this service reads/writes only the Budget `budget_chat_*` tables and
 * emits `budget_chat_*` notifications, so it shares no data with House chat.
 */
import type { Env } from '../types';

import { ChatRoomServiceCore } from './chat/chat-room-service-core';
import { BUDGET_CHAT_CONFIG } from './chat/configs';

export type {
  ChatAttachment as BudgetChatAttachment,
  ChatMessageResponse as BudgetChatMessageResponse,
  ChatRoomResponse as BudgetChatRoomResponse,
} from './chat/chat-room-service-core';

export class BudgetChatRoomService extends ChatRoomServiceCore {
  constructor(env: Env, d1: D1Database) {
    super(env, d1, BUDGET_CHAT_CONFIG);
  }
}
