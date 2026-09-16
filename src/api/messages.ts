import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { apiClient } from './client';

// ============ TYPES ============

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_CHANNELS = ['email', 'sms', 'in_app'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_STATUSES = ['draft', 'sent', 'delivered', 'read', 'failed'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_TEMPLATE_TYPES = [
  'quote_request',
  'schedule_appointment',
  'confirm_appointment',
  'request_reschedule',
  'thank_you',
  'follow_up',
  'report_issue',
  'warranty_service',
] as const;
export type MessageTemplateType = (typeof MESSAGE_TEMPLATE_TYPES)[number];

export interface ContractorMessage {
  id: string;
  household_id: string;
  contractor_id: string;
  direction: MessageDirection;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  attachments: string | null; // JSON array
  status: MessageStatus;
  sent_at: string | null;
  read_at: string | null;
  template_used: string | null;
  created_at: string;
}

export interface MessageWithContractor extends ContractorMessage {
  contractor: {
    id: string;
    name: string;
    company_name: string | null;
    specialty: string;
    phone: string | null;
    email: string | null;
  };
}

export interface ConversationSummary {
  contractor_id: string;
  contractor_name: string;
  contractor_company: string | null;
  contractor_specialty: string;
  last_message: ContractorMessage;
  unread_count: number;
  total_messages: number;
}

export interface MessageTemplate {
  id: string;
  type: MessageTemplateType;
  title: string;
  subject_template: string | null;
  body_template: string;
  is_system: boolean;
  household_id: string | null;
  created_at: string;
}

// ============ REQUEST TYPES ============

interface CreateMessageRequest {
  contractor_id: string;
  direction?: MessageDirection;
  channel: MessageChannel;
  subject?: string;
  body: string;
  attachments?: string[];
}

interface MessageFilters {
  contractor_id?: string;
  direction?: MessageDirection;
  channel?: MessageChannel;
  status?: MessageStatus;
}

interface ApplyTemplateRequest {
  variables: Record<string, string>;
}

// ============ RESPONSE TYPES ============

interface MessagesResponse {
  messages: MessageWithContractor[];
}

interface MessageResponse {
  message: MessageWithContractor;
}

interface ConversationsResponse {
  conversations: ConversationSummary[];
}

interface TemplatesResponse {
  templates: MessageTemplate[];
}

interface TemplateResponse {
  template: MessageTemplate;
}

interface ApplyTemplateResponse {
  subject: string;
  body: string;
}

// ============ API CLIENT ============

const remoteMessagesApi = {
  // List all messages
  getAll: (householdId: string, filters?: MessageFilters) =>
    apiClient
      .get<MessagesResponse>(`/households/${householdId}/messages`, { params: filters })
      .then((res) => res.data),

  // Get conversation summaries
  getConversations: (householdId: string) =>
    apiClient
      .get<ConversationsResponse>(`/households/${householdId}/messages/conversations`)
      .then((res) => res.data),

  // Get conversation with specific contractor
  getConversation: (householdId: string, contractorId: string) =>
    apiClient
      .get<MessagesResponse>(`/households/${householdId}/messages/conversation/${contractorId}`)
      .then((res) => res.data),

  // Get single message
  getOne: (householdId: string, messageId: string) =>
    apiClient
      .get<MessageResponse>(`/households/${householdId}/messages/${messageId}`)
      .then((res) => res.data),

  // Create/send message
  create: (householdId: string, data: CreateMessageRequest) =>
    apiClient
      .post<MessageResponse>(`/households/${householdId}/messages`, data)
      .then((res) => res.data),

  // Mark message as read
  markAsRead: (householdId: string, messageId: string) =>
    apiClient
      .post<MessageResponse>(`/households/${householdId}/messages/${messageId}/read`)
      .then((res) => res.data),

  // Mark entire conversation as read
  markConversationAsRead: (householdId: string, contractorId: string) =>
    apiClient
      .post<{ success: boolean }>(`/households/${householdId}/messages/conversation/${contractorId}/read`)
      .then((res) => res.data),

  // Delete message
  delete: (householdId: string, messageId: string) =>
    apiClient.delete(`/households/${householdId}/messages/${messageId}`),

  // Get all message templates
  getTemplates: (householdId: string) =>
    apiClient
      .get<TemplatesResponse>(`/households/${householdId}/messages/templates/all`)
      .then((res) => res.data),

  // Get single template
  getTemplate: (householdId: string, templateId: string) =>
    apiClient
      .get<TemplateResponse>(`/households/${householdId}/messages/templates/${templateId}`)
      .then((res) => res.data),

  // Apply template with variables
  applyTemplate: (householdId: string, templateId: string, data: ApplyTemplateRequest) =>
    apiClient
      .post<ApplyTemplateResponse>(`/households/${householdId}/messages/templates/${templateId}/apply`, data)
      .then((res) => res.data),
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens call `messagesApi`
 * exactly as before; the Proxy is what makes the H11 B4 cutover cost zero screen
 * edits. See `documents/requirements/House v2/` §6, §11 (sub-wave B4).
 *
 * **Nothing in this module sends anything**, which is the finding that makes
 * eight of the eleven methods local rather than thrown. `message-service.ts` has
 * no mail transport and no SMS gateway: it writes a row. The member sends from
 * their own mail or messages app and this table records that they did — the same
 * shape `contractorsApi.requestReceipt` turned out to have.
 *
 * `remoteMethods` names the three Tier C reads over `message_templates` — the
 * same eight canned messages for every household, carrying nothing of theirs.
 * `applyTemplate` is one of them despite taking `variables`: it substitutes
 * placeholders in template text and returns a string, touching no household row.
 *
 * There is no throw site at all in this module.
 */
export const messagesApi: typeof remoteMessagesApi = createHouseLocalProxy(remoteMessagesApi, {
  moduleName: 'messages',
  remoteMethods: ['getTemplates', 'getTemplate', 'applyTemplate'],
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localMessagesApi').localMessagesApi,
});
