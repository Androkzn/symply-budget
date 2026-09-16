import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type {
  MessageWithContractor,
  ConversationSummary,
  MessageTemplate,
} from '@api/messages';

interface MessageState {
  messages: MessageWithContractor[];
  conversations: ConversationSummary[];
  currentConversation: MessageWithContractor[];
  selectedContractorId: string | null;
  templates: MessageTemplate[];
  totalUnreadCount: number;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
}

interface MessageActions {
  setMessages: (messages: MessageWithContractor[]) => void;
  setConversations: (conversations: ConversationSummary[]) => void;
  setCurrentConversation: (messages: MessageWithContractor[]) => void;
  setSelectedContractorId: (contractorId: string | null) => void;
  setTemplates: (templates: MessageTemplate[]) => void;
  addMessage: (message: MessageWithContractor) => void;
  updateMessage: (messageId: string, updates: Partial<MessageWithContractor>) => void;
  removeMessage: (messageId: string) => void;
  markConversationAsRead: (contractorId: string) => void;
  setLoading: (loading: boolean) => void;
  setSending: (sending: boolean) => void;
  setError: (error: string | null) => void;
  updateUnreadCount: () => void;
  reset: () => void;
}

type MessageStore = MessageState & MessageActions;

const initialState: MessageState = {
  messages: [],
  conversations: [],
  currentConversation: [],
  selectedContractorId: null,
  templates: [],
  totalUnreadCount: 0,
  isLoading: false,
  isSending: false,
  error: null,
};

export const useMessageStore = create<MessageStore>()(
  immer((set) => ({
    ...initialState,

      setMessages: (messages) =>
        set((state) => {
          state.messages = messages;
        }),

      setConversations: (conversations) =>
        set((state) => {
          state.conversations = conversations;
          // Calculate total unread count
          state.totalUnreadCount = conversations.reduce((sum, conv) => sum + conv.unread_count, 0);
        }),

      setCurrentConversation: (messages) =>
        set((state) => {
          state.currentConversation = messages;
        }),

      setSelectedContractorId: (contractorId) =>
        set((state) => {
          state.selectedContractorId = contractorId;
        }),

      setTemplates: (templates) =>
        set((state) => {
          state.templates = templates;
        }),

      addMessage: (message) =>
        set((state) => {
          // Add to all messages
          state.messages.unshift(message);

          // Add to current conversation if it's the active one
          if (state.selectedContractorId === message.contractor_id) {
            state.currentConversation.push(message);
          }

          // Update conversation summary
          const convIndex = state.conversations.findIndex(
            (c) => c.contractor_id === message.contractor_id
          );

          if (convIndex !== -1) {
            state.conversations[convIndex].last_message = message;
            state.conversations[convIndex].total_messages += 1;
            if (message.direction === 'inbound' && message.status !== 'read') {
              state.conversations[convIndex].unread_count += 1;
              state.totalUnreadCount += 1;
            }
          } else {
            // Create new conversation summary
            state.conversations.unshift({
              contractor_id: message.contractor_id,
              contractor_name: message.contractor?.name || 'Unknown',
              contractor_company: message.contractor?.company_name || null,
              contractor_specialty: message.contractor?.specialty || 'other',
              last_message: message,
              unread_count: message.direction === 'inbound' && message.status !== 'read' ? 1 : 0,
              total_messages: 1,
            });
          }
        }),

      updateMessage: (messageId, updates) =>
        set((state) => {
          const messageIndex = state.messages.findIndex((m) => m.id === messageId);
          if (messageIndex !== -1) {
            state.messages[messageIndex] = { ...state.messages[messageIndex], ...updates };
          }

          const convMsgIndex = state.currentConversation.findIndex((m) => m.id === messageId);
          if (convMsgIndex !== -1) {
            state.currentConversation[convMsgIndex] = {
              ...state.currentConversation[convMsgIndex],
              ...updates,
            };
          }
        }),

      removeMessage: (messageId) =>
        set((state) => {
          state.messages = state.messages.filter((m) => m.id !== messageId);
          state.currentConversation = state.currentConversation.filter((m) => m.id !== messageId);
        }),

      markConversationAsRead: (contractorId) =>
        set((state) => {
          // Update current conversation messages
          state.currentConversation = state.currentConversation.map((msg) =>
            msg.direction === 'inbound' && !msg.read_at
              ? { ...msg, read_at: new Date().toISOString(), status: 'read' as const }
              : msg
          );

          // Update conversation summary
          const convIndex = state.conversations.findIndex((c) => c.contractor_id === contractorId);
          if (convIndex !== -1) {
            const unreadCount = state.conversations[convIndex].unread_count;
            state.conversations[convIndex].unread_count = 0;
            state.totalUnreadCount = Math.max(0, state.totalUnreadCount - unreadCount);
          }
        }),

      setLoading: (loading) =>
        set((state) => {
          state.isLoading = loading;
        }),

      setSending: (sending) =>
        set((state) => {
          state.isSending = sending;
        }),

      setError: (error) =>
        set((state) => {
          state.error = error;
        }),

      updateUnreadCount: () =>
        set((state) => {
          state.totalUnreadCount = state.conversations.reduce(
            (sum, conv) => sum + conv.unread_count,
            0
          );
        }),

      reset: () => set(initialState),
    }))
);
