/**
 * Shared household-chat module — ONE implementation of chat reused by every app.
 * Per-app differences live in a small {@link ChatConfig} (see `configs.ts`);
 * colors come from the brand theme automatically. A change here applies to all
 * apps at once.
 */
export { ChatNavigator } from './ChatNavigator';
export { ChatFab } from './ChatFab';
export { ChatConfigProvider, useChatConfig } from './ChatConfigContext';
export { refreshChatUnread } from './refreshChatUnread';
export { useChatSocket } from './useChatSocket';
export { createChatApi } from './createChatApi';
export { createChatStore, selectTotalUnread } from './createChatStore';
export { houseChatConfig, budgetChatConfig, CHAT_CONFIGS } from './configs';
export { chatRoomsQueryKey, useChatRooms } from './useChatRooms';
export { useSubjectChat } from './useSubjectChat';
export {
  filterRoomsByTab,
  findSubjectRoom,
  groupRoomsBySubject,
  groupUnread,
  isMaterialRoom,
  isProjectRoom,
  isProjectScopedRoom,
  projectIdOf,
  CHAT_FILTER_ALL,
  CHAT_FILTER_ASSISTANT,
  CHAT_FILTER_GENERAL,
  CHAT_FILTER_PROJECTS,
  HOUSEHOLD_GROUP_KEY,
  HOUSEHOLD_GROUP_TITLE,
} from './subjects';
export { ChatRoomScreen } from './screens/ChatRoomScreen';
export { ChatRoomSettingsScreen } from './screens/ChatRoomSettingsScreen';
export { SubjectChatButton } from './SubjectChatButton';

export { CHAT_SUBJECT_MATERIAL, CHAT_SUBJECT_PROJECT } from './types';

export type { ChatConfig } from './ChatConfig';
export type { ChatApi, OpenSubjectRoomRequest } from './createChatApi';
export type { ChatStoreHook, ChatStoreState } from './createChatStore';
export type { ChatRoomFilter, ChatRoomGroup } from './subjects';
export type { SubjectChatTarget, UseSubjectChatResult } from './useSubjectChat';
export type {
  ChatAttachment,
  ChatMessage,
  ChatParticipants,
  ChatReplyPreview,
  ChatRoom,
  ChatRoomSubject,
  ChatSenderType,
  ChatStackParamList,
  ChatSubjectType,
  OutgoingAttachment,
} from './types';
