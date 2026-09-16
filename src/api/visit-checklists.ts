import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { apiClient } from './client';

// ============ TYPES ============

export const CHECKLIST_PRIORITIES = ['must_ask', 'nice_to_have', 'optional'] as const;
export type ChecklistPriority = (typeof CHECKLIST_PRIORITIES)[number];

export const PRIORITY_INFO: Record<ChecklistPriority, { label: string; color: string }> = {
  must_ask: { label: 'Must Ask', color: '#FF3B30' },
  nice_to_have: { label: 'Nice to Have', color: '#FF9500' },
  optional: { label: 'Optional', color: '#8E8E93' },
};

export interface VisitChecklist {
  id: string;
  household_id: string;
  appointment_id: string | null;
  visit_id: string | null;
  title: string;
  template_id: string | null;
  contractor_specialty: string | null;
  // AI-powered checklist fields
  task_id: string | null;
  source: 'manual' | 'ai_generated' | 'template';
  ai_generation_context: string | null; // JSON: task details, images, category
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  checklist_id: string;
  text: string;
  checked: boolean;
  checked_at: string | null;
  comment: string | null;
  voice_note_key: string | null;
  voice_note_transcription: string | null;
  has_info_icon: boolean;
  technical_term: string | null;
  category: string | null;
  priority: ChecklistPriority;
  sort_order: number;
  // AI suggestion fields
  source: 'manual' | 'ai_suggested';
  ai_confidence: number | null;
  suggested_at: string | null;
  accepted_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

export interface ChecklistItemPhoto {
  id: string;
  checklist_item_id: string;
  household_id: string;
  photo_key: string;
  thumbnail_key: string | null;
  caption: string | null;
  taken_at: string;
  file_size: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface ChecklistWithItems extends VisitChecklist {
  items: ChecklistItem[];
}

export interface ChecklistTemplate {
  id: string;
  specialty: string;
  title: string;
  description: string | null;
  items: TemplateItem[];
  is_system: boolean;
  household_id: string | null;
  created_at: string;
}

export interface TemplateItem {
  text: string;
  hasInfoIcon: boolean;
  technicalTerm?: string;
  category?: string;
  priority: ChecklistPriority;
  sortOrder: number;
}

export interface TechnicalTerm {
  id: string;
  term_key: string;
  display_name: string;
  category: string;
  short_description: string | null;
  base_prompt: string;
  related_terms: string | null;
  created_at: string;
}

export interface AIConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AIInfoConversation {
  id: string;
  household_id: string;
  checklist_item_id: string | null;
  technical_term: string;
  context_json: string | null;
  messages_json: string; // JSON array of AIConversationMessage
  created_at: string;
  updated_at: string;
}

// ============ REQUEST TYPES ============

interface CreateChecklistRequest {
  title: string;
  appointment_id?: string;
  visit_id?: string;
  template_id?: string;
}

interface UpdateChecklistRequest {
  title?: string;
  appointment_id?: string;
  visit_id?: string;
}

interface CreateFromTemplateRequest {
  appointment_id?: string;
  visit_id?: string;
}

interface AddItemRequest {
  text: string;
  has_info_icon?: boolean;
  technical_term?: string;
  category?: string;
  priority?: ChecklistPriority;
}

interface UpdateItemRequest {
  text?: string;
  has_info_icon?: boolean;
  technical_term?: string;
  category?: string;
  priority?: ChecklistPriority;
  comment?: string;
  sort_order?: number;
}

interface ReorderItemsRequest {
  item_order: string[];
}

interface AIConversationRequest {
  technical_term: string;
  checklist_item_id?: string;
  context?: Record<string, unknown>;
}

interface AIMessageRequest {
  content: string;
}

interface GenerateAISuggestionsRequest {
  task_id?: string;
  task_category?: string;
  task_title?: string;
  task_description?: string;
  contractor_specialty?: string;
  visit_purpose?: string;
  image_descriptions?: string[];
}

interface AddPhotoRequest {
  photo_key: string;
  thumbnail_key?: string;
  caption?: string;
  taken_at?: string;
  file_size?: number;
  mime_type?: string;
  width?: number;
  height?: number;
}

// ============ RESPONSE TYPES ============

interface ChecklistsResponse {
  checklists: ChecklistWithItems[];
}

interface ChecklistResponse {
  checklist: ChecklistWithItems;
}

interface ItemResponse {
  item: ChecklistItem;
}

interface TemplatesResponse {
  templates: ChecklistTemplate[];
}

interface TemplateResponse {
  template: ChecklistTemplate;
}

interface TechnicalTermResponse {
  term: TechnicalTerm | null;
}

interface AIConversationResponse {
  conversation: AIInfoConversation;
  term_info: TechnicalTerm | null;
}

interface AISuggestionsResponse {
  suggestions: ChecklistItem[];
  ai_context: Record<string, unknown>;
}

interface PhotoResponse {
  photo: ChecklistItemPhoto;
}

interface PhotosResponse {
  photos: ChecklistItemPhoto[];
}

interface ChecklistsForTaskResponse {
  checklists: Array<{
    checklist: VisitChecklist;
    visit?: any;
    contractor?: any;
    itemsCompleted: number;
    itemsTotal: number;
  }>;
}

interface MultiContractorComparisonResponse {
  task: any | null;
  contractors: Array<{
    contractor: any;
    visit?: any;
    checklist?: VisitChecklist;
    quote?: any;
    checklistProgress: { completed: number; total: number };
    keyResponses: Array<{ question: string; answer: string; priority: string }>;
  }>;
}

// ============ API CLIENT ============

const remoteVisitChecklistsApi = {
  // Checklists
  getAll: (householdId: string) =>
    apiClient
      .get<ChecklistsResponse>(`/households/${householdId}/visit-checklists`)
      .then((res) => res.data),

  getOne: (householdId: string, checklistId: string) =>
    apiClient
      .get<ChecklistResponse>(`/households/${householdId}/visit-checklists/${checklistId}`)
      .then((res) => res.data),

  create: (householdId: string, data: CreateChecklistRequest) =>
    apiClient
      .post<ChecklistResponse>(`/households/${householdId}/visit-checklists`, data)
      .then((res) => res.data),

  createFromTemplate: (householdId: string, templateId: string, data: CreateFromTemplateRequest) =>
    apiClient
      .post<ChecklistResponse>(`/households/${householdId}/visit-checklists/from-template/${templateId}`, data)
      .then((res) => res.data),

  update: (householdId: string, checklistId: string, data: UpdateChecklistRequest) =>
    apiClient
      .patch<ChecklistResponse>(`/households/${householdId}/visit-checklists/${checklistId}`, data)
      .then((res) => res.data),

  delete: (householdId: string, checklistId: string) =>
    apiClient.delete(`/households/${householdId}/visit-checklists/${checklistId}`),

  // Items
  addItem: (householdId: string, checklistId: string, data: AddItemRequest) =>
    apiClient
      .post<ItemResponse>(`/households/${householdId}/visit-checklists/${checklistId}/items`, data)
      .then((res) => res.data),

  updateItem: (householdId: string, checklistId: string, itemId: string, data: UpdateItemRequest) =>
    apiClient
      .patch<ItemResponse>(`/households/${householdId}/visit-checklists/${checklistId}/items/${itemId}`, data)
      .then((res) => res.data),

  deleteItem: (householdId: string, checklistId: string, itemId: string) =>
    apiClient.delete(`/households/${householdId}/visit-checklists/${checklistId}/items/${itemId}`),

  checkItem: (householdId: string, checklistId: string, itemId: string, checked: boolean) =>
    apiClient
      .put<ItemResponse>(`/households/${householdId}/visit-checklists/${checklistId}/items/${itemId}/check`, {
        checked,
      })
      .then((res) => res.data),

  addVoiceNote: (householdId: string, checklistId: string, itemId: string, voiceNoteKey: string) =>
    apiClient
      .post<ItemResponse>(`/households/${householdId}/visit-checklists/${checklistId}/items/${itemId}/voice-note`, {
        voice_note_key: voiceNoteKey,
      })
      .then((res) => res.data),

  reorderItems: (householdId: string, checklistId: string, data: ReorderItemsRequest) =>
    apiClient
      .put<ChecklistResponse>(`/households/${householdId}/visit-checklists/${checklistId}/reorder`, data)
      .then((res) => res.data),

  // Templates
  getTemplates: (householdId: string) =>
    apiClient
      .get<TemplatesResponse>(`/households/${householdId}/visit-checklists/templates/all`)
      .then((res) => res.data),

  getTemplatesByCategory: (householdId: string, category: string) =>
    apiClient
      .get<TemplatesResponse>(`/households/${householdId}/visit-checklists/templates/category/${category}`)
      .then((res) => res.data),

  getTemplate: (householdId: string, templateId: string) =>
    apiClient
      .get<TemplateResponse>(`/households/${householdId}/visit-checklists/templates/${templateId}`)
      .then((res) => res.data),

  // Technical Terms
  getTechnicalTerm: (householdId: string, termKey: string) =>
    apiClient
      .get<TechnicalTermResponse>(`/households/${householdId}/visit-checklists/technical-terms/${termKey}`)
      .then((res) => res.data),

  // AI Conversations
  startAIConversation: (householdId: string, data: AIConversationRequest) =>
    apiClient
      .post<AIConversationResponse>(`/households/${householdId}/visit-checklists/ai/conversation`, data)
      .then((res) => res.data),

  sendAIMessage: (householdId: string, conversationId: string, data: AIMessageRequest) =>
    apiClient
      .post<AIConversationResponse>(
        `/households/${householdId}/visit-checklists/ai/conversation/${conversationId}/message`,
        data
      )
      .then((res) => res.data),

  // AI Suggestions
  generateAISuggestions: (householdId: string, checklistId: string, data: GenerateAISuggestionsRequest) =>
    apiClient
      .post<AISuggestionsResponse>(
        `/households/${householdId}/visit-checklists/${checklistId}/generate-ai-suggestions`,
        data
      )
      .then((res) => res.data),

  acceptAISuggestion: (householdId: string, checklistId: string, itemId: string) =>
    apiClient
      .post<ItemResponse>(`/households/${householdId}/visit-checklists/${checklistId}/items/${itemId}/accept`, {})
      .then((res) => res.data),

  dismissAISuggestion: (householdId: string, checklistId: string, itemId: string) =>
    apiClient.post(`/households/${householdId}/visit-checklists/${checklistId}/items/${itemId}/dismiss`, {}),

  // Photo Management
  addPhoto: (householdId: string, checklistId: string, itemId: string, data: AddPhotoRequest) =>
    apiClient
      .post<PhotoResponse>(
        `/households/${householdId}/visit-checklists/${checklistId}/items/${itemId}/photos`,
        data
      )
      .then((res) => res.data),

  getPhotos: (householdId: string, checklistId: string, itemId: string) =>
    apiClient
      .get<PhotosResponse>(`/households/${householdId}/visit-checklists/${checklistId}/items/${itemId}/photos`)
      .then((res) => res.data),

  deletePhoto: (householdId: string, checklistId: string, itemId: string, photoId: string) =>
    apiClient.delete(
      `/households/${householdId}/visit-checklists/${checklistId}/items/${itemId}/photos/${photoId}`
    ),

  // Multi-Contractor Comparison
  getChecklistsForTask: (householdId: string, taskId: string) =>
    apiClient
      .get<ChecklistsForTaskResponse>(`/households/${householdId}/visit-checklists/for-task/${taskId}`)
      .then((res) => res.data),

  getMultiContractorComparison: (householdId: string, taskId: string) =>
    apiClient
      .get<MultiContractorComparisonResponse>(`/households/${householdId}/visit-checklists/comparison/${taskId}`)
      .then((res) => res.data),
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens call
 * `visitChecklistsApi` exactly as before; the Proxy is what makes the H11 B4
 * cutover cost zero screen edits. See `documents/requirements/House v2/` §6, §11
 * (sub-wave B4).
 *
 * The largest surface in the programme, and the one whose subject is most
 * obviously offline: a member holding their phone in a crawlspace while a
 * contractor talks. Nineteen of the 26 methods are local — every question, tick,
 * comment, reorder, photo and voice note.
 *
 * `remoteMethods` names the four TIER C reads. `checklist_templates` and
 * `technical_terms` are global reference data, identical for every household and
 * carrying nothing of theirs, so fetching them from the Worker leaks nothing —
 * the same call `garbageCollectionApi` makes for municipality config. They are
 * declared here rather than left to fall through, so "this one goes to the
 * server" is a decision in the code.
 *
 * The remaining three (`createFromTemplate`, `generateAISuggestions`,
 * `startAIConversation`, `sendAIMessage`) are PRESENT locally as throws with
 * member-facing copy, which is what the coverage rule asks for: a missing key
 * would route to a Worker holding no checklists for this household and answer
 * 200 with an empty list.
 */
export const visitChecklistsApi: typeof remoteVisitChecklistsApi = createHouseLocalProxy(
  remoteVisitChecklistsApi,
  {
    moduleName: 'visitChecklists',
    remoteMethods: ['getTemplates', 'getTemplatesByCategory', 'getTemplate', 'getTechnicalTerm'],
    // Narrow require: the barrel would pull the sync orchestrator and status
    // store into every api call from every screen.
    resolveLocal: () =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@features/house/local/localVisitChecklistsApi').localVisitChecklistsApi,
  },
);
