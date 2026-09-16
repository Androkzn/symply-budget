/**
 * Per-app {@link ChatConfig} instances + the registry that notification wiring
 * iterates. Adding a new app's chat = add one config here (its route segment,
 * store, notification namespace, presentation) and mount `<ChatNavigator
 * config={...}/>` (tab) or `<ChatFab config={...}/>` (FAB). Nothing else in the
 * shared module changes. Colors come from the brand theme automatically.
 */
import type { ChatConfig } from './ChatConfig';
import { createChatApi } from './createChatApi';
import { createChatStore } from './createChatStore';
import { CHAT_SUBJECT_PROJECT } from './types';

/** House household chat — the chat tab shared by House (and reachable on Kaizen/Health). */
export const houseChatConfig: ChatConfig = {
  id: 'house',
  routeSegment: 'chat-rooms',
  socketLabel: 'house-chat',
  rememberScope: 'chat',
  presentation: 'tab',
  api: createChatApi('chat-rooms'),
  store: createChatStore(),
  notif: { messageType: 'chat_message', mentionType: 'chat_mention' },
  route: { host: '/chat', screen: 'ChatRoom' },
  /**
   * Both project and material chats lead back to the project hub — a material
   * has no standalone deep link, and the hub is where its card lives anyway, so
   * this lands the member one tap from it rather than nowhere.
   */
  subjectHref: (subject) => {
    const projectId = subject.type === CHAT_SUBJECT_PROJECT ? subject.id : subject.parent_id;
    if (!projectId) return null;
    return `/projects?screen=HomeProjectHub&projectId=${encodeURIComponent(projectId)}`;
  },
};

/** Budget household chat — opened from the floating chat button (`/budget-chat`). */
export const budgetChatConfig: ChatConfig = {
  id: 'budget',
  routeSegment: 'budget-chat-rooms',
  socketLabel: 'budget-chat',
  rememberScope: 'budget-chat',
  presentation: 'fab',
  api: createChatApi('budget-chat-rooms'),
  store: createChatStore(),
  notif: { messageType: 'budget_chat_message', mentionType: 'budget_chat_mention' },
  route: { host: '/budget-chat', screen: 'BudgetChatRoom' },
};

/** All chat configs — notification handling iterates this to stay app-agnostic. */
export const CHAT_CONFIGS: ChatConfig[] = [houseChatConfig, budgetChatConfig];
