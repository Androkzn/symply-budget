/**
 * Per-app {@link ChatBackendConfig} instances. Adding a new app's chat means
 * adding one entry here (its `*_chat_*` tables + notification namespace + prompt)
 * — the shared {@link ChatRoomServiceCore} and the route factory do the rest.
 *
 * Data isolation: every app points at its own physically-separate tables and its
 * own notification `type`/`reference_type` strings, so chats never bleed across
 * apps (preserving the notification-independence guarantee).
 */
import { BUDGET_CHAT_ASSISTANT_SYSTEM_PROMPT } from '../../ai/prompts/budget-chat-assistant';
import { HOUSEHOLD_CHAT_ASSISTANT_SYSTEM_PROMPT } from '../../ai/prompts/household-chat-assistant';
import * as schema from '../../db/schema';

import { BUDGET_CHAT_ASSISTANT } from './budget-assistant-tools';
import type { ChatBackendConfig, ChatTables } from './chat-room-service-core';
import { HOUSE_CHAT_ASSISTANT } from './house-assistant-tools';

// Each app's `*_chat_*` tables are structurally identical to the House tables;
// cast to the canonical `ChatTables` shape used by the core (runtime uses the
// real table objects, so queries hit the correct physical tables).
const houseTables: ChatTables = {
  rooms: schema.chatRooms,
  messages: schema.chatMessages,
  participants: schema.chatRoomParticipants,
  reads: schema.chatRoomReads,
};

const budgetTables = {
  rooms: schema.budgetChatRooms,
  messages: schema.budgetChatMessages,
  participants: schema.budgetChatRoomParticipants,
  reads: schema.budgetChatRoomReads,
} as unknown as ChatTables;

export const HOUSE_CHAT_CONFIG: ChatBackendConfig = {
  tables: houseTables,
  notif: {
    messageType: 'chat_message',
    mentionType: 'chat_mention',
    referenceType: 'chat_room',
    screen: 'ChatRoom',
  },
  r2Prefix: 'chat-images',
  usageFeature: 'chat_assistant',
  assistantPrompt: HOUSEHOLD_CHAT_ASSISTANT_SYSTEM_PROMPT,
  logTag: 'chat',
  // A dedicated AI assistant chat pinned on top of the rooms list — auto-created,
  // undeletable, participant-locked, and answering every message without a mention.
  dedicatedAssistantRoom: { name: 'AI Assistant' },
  // Deliberately NO `defaultRoom`. House used to auto-create a "General" room
  // beside the assistant; it opened empty, stayed empty in most households, and
  // could not be deleted — an undeletable placeholder above the rooms members
  // actually made. Members still create (and delete) their own household rooms;
  // the rooms list groups them under the "General" filter. Existing "General"
  // rooms are archived by migration 0168, which only works alongside this
  // change — leave `defaultRoom` in and listRooms re-creates one on next open.
  /**
   * Rooms that belong to something: one general chat per home project, and one
   * per material inside it. Declared as opaque strings rather than imported from
   * the home-projects service on purpose — chat can never read a Tier-A project
   * row, so a type dependency would only imply an access it does not have.
   */
  subjects: {
    types: ['home_project', 'home_project_material'],
    // A material conversation without its project is unfindable in the list and
    // ungroundable for the assistant.
    requireParent: ['home_project_material'],
  },
  /**
   * House's assistant can ACT, not only answer.
   *
   * Two kinds of verb, and they run in two different places for one reason —
   * a home project is Tier A, so the Worker can neither read nor write it:
   *
   *  - **Project writes** (add/update/remove a material, budget lines, phases,
   *    blockers, tasks) are described here and PERFORMED ON THE DEVICE through
   *    `homeProjectsApi` — byte for byte the call the member's own tap makes.
   *  - **Lookups** (`find_local_pros`, `web_search`) run here, where the keys
   *    are, because they touch no household row.
   *
   * See `house-assistant-tools.ts` for the split and the reasoning.
   */
  assistant: HOUSE_CHAT_ASSISTANT,
};

export const BUDGET_CHAT_CONFIG: ChatBackendConfig = {
  tables: budgetTables,
  notif: {
    messageType: 'budget_chat_message',
    mentionType: 'budget_chat_mention',
    referenceType: 'budget_chat_room',
    screen: 'BudgetChatRoom',
  },
  r2Prefix: 'budget-chat-images',
  usageFeature: 'budget_chat_assistant',
  assistantPrompt: BUDGET_CHAT_ASSISTANT_SYSTEM_PROMPT,
  logTag: 'budget-chat',
  // Budget's ONE pre-made chat: the AI Budget Assistant — auto-created,
  // undeletable, participant-locked, and answering every message (text or
  // receipt photo) without an `@assistant` mention. Deliberately NO
  // `defaultRoom`: a second undeletable "General" room on top of it just looked
  // like a duplicate AI chat. Members still create their own rooms (and can
  // delete those). Existing "General" rooms are dropped by migration 0161.
  dedicatedAssistantRoom: { name: 'AI Budget Assistant' },
  // Budget's assistant scans a dropped receipt via `scan_receipt_for_review`
  // (budget-analysis ReceiptScanService) and returns a confirm draft — nothing
  // is saved until the member confirms in-app.
  assistant: BUDGET_CHAT_ASSISTANT,
};
