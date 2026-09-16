import { eq, and, asc, desc, isNull } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { v4 as uuidv4 } from 'uuid';

import type { ClaudeProvider } from '../ai/claude-provider';
import {
  VISIT_CHECKLIST_SYSTEM_PROMPT,
  formatVisitChecklistPrompt,
  type VisitChecklistResponse,
} from '../ai/prompts/generate-visit-checklist';
import { createProviderAdapter } from '../ai/provider-factory';
import { householdMembers, tasks } from '../db/schema';
import { contractors, contractorVisits, contractorQuotes } from '../db/schema-contractors';
import {
  visitChecklists,
  checklistItems,
  checklistTemplates,
  technicalTerms,
  aiInfoConversations,
  checklistItemPhotos,
  type VisitChecklist,
  type ChecklistItem,
  type ChecklistTemplate,
  type TechnicalTerm,
  type AIInfoConversation,
  type ChecklistItemPhoto,
} from '../db/schema-labor-hub';
import type { Env } from '../types';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { nowIso } from '../utils/id';

import { resolveProviderApiKey } from './ai-credential-resolver';
import { usageRecorderFor } from './ai-usage-service';


export interface ChecklistWithItems extends VisitChecklist {
  items: ChecklistItem[];
}

export interface TemplateWithItems extends Omit<ChecklistTemplate, 'items'> {
  items: Array<{
    text: string;
    hasInfoIcon: boolean;
    technicalTerm?: string;
    category?: string;
    priority: string;
    sortOrder: number;
  }>;
}

export class VisitChecklistService {
  private db: DrizzleD1Database;
  private env: Env;

  constructor(env: Env, d1: D1Database) {
    this.env = env;
    this.db = drizzle(d1);
  }

  // ============ ACCESS CHECK ============

  private async checkHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const member = await this.db
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, userId)))
      .get();

    if (!member) {
      throw new ForbiddenError('You do not have access to this household');
    }
  }

  // ============ CHECKLISTS ============

  async getChecklists(householdId: string, userId: string): Promise<ChecklistWithItems[]> {
    await this.checkHouseholdAccess(householdId, userId);

    const checklists = await this.db
      .select()
      .from(visitChecklists)
      .where(eq(visitChecklists.household_id, householdId))
      .orderBy(asc(visitChecklists.created_at))
      .all();

    // Get items for each checklist
    return Promise.all(checklists.map(async (checklist) => {
      const items = await this.db
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklist_id, checklist.id))
        .orderBy(asc(checklistItems.sort_order))
        .all();
      return { ...checklist, items };
    }));
  }

  async getChecklist(householdId: string, checklistId: string, userId: string): Promise<ChecklistWithItems> {
    await this.checkHouseholdAccess(householdId, userId);

    const checklist = await this.db
      .select()
      .from(visitChecklists)
      .where(and(eq(visitChecklists.id, checklistId), eq(visitChecklists.household_id, householdId)))
      .get();

    if (!checklist) {
      throw new NotFoundError('Checklist not found');
    }

    const items = await this.db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.checklist_id, checklistId))
      .orderBy(asc(checklistItems.sort_order))
      .all();

    return { ...checklist, items };
  }

  async createChecklist(
    householdId: string,
    userId: string,
    input: {
      title: string;
      appointmentId?: string;
      visitId?: string;
      templateId?: string;
    }
  ): Promise<ChecklistWithItems> {
    await this.checkHouseholdAccess(householdId, userId);

    const id = uuidv4();
    const now = nowIso();

    await this.db.insert(visitChecklists).values({
      id,
      household_id: householdId,
      appointment_id: input.appointmentId || null,
      visit_id: input.visitId || null,
      template_id: input.templateId || null,
      title: input.title,
      created_at: now,
      updated_at: now,
    });

    return this.getChecklist(householdId, id, userId);
  }

  async createChecklistFromTemplate(
    householdId: string,
    userId: string,
    templateId: string,
    input: {
      appointmentId?: string;
      visitId?: string;
    }
  ): Promise<ChecklistWithItems> {
    await this.checkHouseholdAccess(householdId, userId);

    // Get template
    const template = await this.db
      .select()
      .from(checklistTemplates)
      .where(eq(checklistTemplates.id, templateId))
      .get();

    if (!template) {
      throw new NotFoundError('Template not found');
    }

    // Create checklist
    const checklistId = uuidv4();
    const now = nowIso();

    await this.db.insert(visitChecklists).values({
      id: checklistId,
      household_id: householdId,
      appointment_id: input.appointmentId || null,
      visit_id: input.visitId || null,
      template_id: templateId,
      title: template.title,
      created_at: now,
      updated_at: now,
    });

    // Parse and create items from template
    const templateItems = JSON.parse(template.items || '[]') as Array<{
      text: string;
      hasInfoIcon: boolean;
      technicalTerm?: string;
      category?: string;
      priority: string;
      sortOrder: number;
    }>;

    for (const item of templateItems) {
      await this.db.insert(checklistItems).values({
        id: uuidv4(),
        checklist_id: checklistId,
        text: item.text,
        checked: false,
        checked_at: null,
        comment: null,
        voice_note_key: null,
        has_info_icon: item.hasInfoIcon,
        technical_term: item.technicalTerm || null,
        category: item.category || null,
        priority: item.priority,
        sort_order: item.sortOrder,
        created_at: now,
      });
    }

    return this.getChecklist(householdId, checklistId, userId);
  }

  async updateChecklist(
    householdId: string,
    checklistId: string,
    userId: string,
    input: {
      title?: string;
      appointmentId?: string;
      visitId?: string;
    }
  ): Promise<ChecklistWithItems> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.getChecklist(householdId, checklistId, userId);

    const updateData: Partial<VisitChecklist> = {
      updated_at: nowIso(),
    };

    if (input.title !== undefined) updateData.title = input.title;
    if (input.appointmentId !== undefined) updateData.appointment_id = input.appointmentId;
    if (input.visitId !== undefined) updateData.visit_id = input.visitId;

    await this.db.update(visitChecklists).set(updateData).where(eq(visitChecklists.id, checklistId));

    return this.getChecklist(householdId, checklistId, userId);
  }

  async deleteChecklist(householdId: string, checklistId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.getChecklist(householdId, checklistId, userId);

    // Delete items first
    await this.db.delete(checklistItems).where(eq(checklistItems.checklist_id, checklistId));

    // Delete checklist
    await this.db.delete(visitChecklists).where(eq(visitChecklists.id, checklistId));
  }

  // ============ CHECKLIST ITEMS ============

  async addItem(
    householdId: string,
    checklistId: string,
    userId: string,
    input: {
      text: string;
      hasInfoIcon?: boolean;
      technicalTerm?: string;
      category?: string;
      priority?: string;
    }
  ): Promise<ChecklistItem> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getChecklist(householdId, checklistId, userId); // Verify checklist exists

    // Get max sort order
    const existingItems = await this.db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.checklist_id, checklistId))
      .all();

    const maxOrder = existingItems.reduce((max, item) => Math.max(max, item.sort_order ?? 0), 0);

    const id = uuidv4();
    const now = nowIso();

    await this.db.insert(checklistItems).values({
      id,
      checklist_id: checklistId,
      text: input.text,
      checked: false,
      checked_at: null,
      comment: null,
      voice_note_key: null,
      has_info_icon: input.hasInfoIcon ?? false,
      technical_term: input.technicalTerm || null,
      category: input.category || null,
      priority: input.priority || 'must_ask',
      sort_order: maxOrder + 1,
      created_at: now,
    });

    const item = await this.db.select().from(checklistItems).where(eq(checklistItems.id, id)).get();
    if (!item) throw new NotFoundError('Item not found');

    // Update checklist timestamp
    await this.db
      .update(visitChecklists)
      .set({ updated_at: now })
      .where(eq(visitChecklists.id, checklistId));

    return item;
  }

  async updateItem(
    householdId: string,
    checklistId: string,
    itemId: string,
    userId: string,
    input: {
      text?: string;
      hasInfoIcon?: boolean;
      technicalTerm?: string;
      category?: string;
      priority?: string;
      comment?: string;
      sortOrder?: number;
    }
  ): Promise<ChecklistItem> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getChecklist(householdId, checklistId, userId);

    const existing = await this.db
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.id, itemId), eq(checklistItems.checklist_id, checklistId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Item not found');
    }

    const updateData: Partial<ChecklistItem> = {};

    if (input.text !== undefined) updateData.text = input.text;
    if (input.hasInfoIcon !== undefined) updateData.has_info_icon = input.hasInfoIcon;
    if (input.technicalTerm !== undefined) updateData.technical_term = input.technicalTerm;
    if (input.category !== undefined) updateData.category = input.category;
    if (input.priority !== undefined) updateData.priority = input.priority;
    if (input.comment !== undefined) updateData.comment = input.comment;
    if (input.sortOrder !== undefined) updateData.sort_order = input.sortOrder;

    await this.db.update(checklistItems).set(updateData).where(eq(checklistItems.id, itemId));

    // Update checklist timestamp
    await this.db
      .update(visitChecklists)
      .set({ updated_at: nowIso() })
      .where(eq(visitChecklists.id, checklistId));

    const item = await this.db.select().from(checklistItems).where(eq(checklistItems.id, itemId)).get();
    if (!item) throw new NotFoundError('Item not found');

    return item;
  }

  async deleteItem(householdId: string, checklistId: string, itemId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getChecklist(householdId, checklistId, userId);

    const existing = await this.db
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.id, itemId), eq(checklistItems.checklist_id, checklistId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Item not found');
    }

    await this.db.delete(checklistItems).where(eq(checklistItems.id, itemId));

    // Update checklist timestamp
    await this.db
      .update(visitChecklists)
      .set({ updated_at: nowIso() })
      .where(eq(visitChecklists.id, checklistId));
  }

  async checkItem(
    householdId: string,
    checklistId: string,
    itemId: string,
    userId: string,
    checked: boolean
  ): Promise<ChecklistItem> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getChecklist(householdId, checklistId, userId);

    const existing = await this.db
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.id, itemId), eq(checklistItems.checklist_id, checklistId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Item not found');
    }

    const now = nowIso();

    await this.db
      .update(checklistItems)
      .set({
        checked,
        checked_at: checked ? now : null,
      })
      .where(eq(checklistItems.id, itemId));

    // Update checklist timestamp
    await this.db.update(visitChecklists).set({ updated_at: now }).where(eq(visitChecklists.id, checklistId));

    const item = await this.db.select().from(checklistItems).where(eq(checklistItems.id, itemId)).get();
    if (!item) throw new NotFoundError('Item not found');

    return item;
  }

  async addVoiceNoteToItem(
    householdId: string,
    checklistId: string,
    itemId: string,
    userId: string,
    voiceNoteKey: string
  ): Promise<ChecklistItem> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getChecklist(householdId, checklistId, userId);

    const existing = await this.db
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.id, itemId), eq(checklistItems.checklist_id, checklistId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Item not found');
    }

    await this.db.update(checklistItems).set({ voice_note_key: voiceNoteKey }).where(eq(checklistItems.id, itemId));

    // Update checklist timestamp
    await this.db
      .update(visitChecklists)
      .set({ updated_at: nowIso() })
      .where(eq(visitChecklists.id, checklistId));

    const item = await this.db.select().from(checklistItems).where(eq(checklistItems.id, itemId)).get();
    if (!item) throw new NotFoundError('Item not found');

    return item;
  }

  async reorderItems(
    householdId: string,
    checklistId: string,
    userId: string,
    itemOrder: string[]
  ): Promise<ChecklistWithItems> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getChecklist(householdId, checklistId, userId);

    // Update sort order for each item
    for (let i = 0; i < itemOrder.length; i++) {
      await this.db
        .update(checklistItems)
        .set({ sort_order: i })
        .where(and(eq(checklistItems.id, itemOrder[i]), eq(checklistItems.checklist_id, checklistId)));
    }

    // Update checklist timestamp
    await this.db
      .update(visitChecklists)
      .set({ updated_at: nowIso() })
      .where(eq(visitChecklists.id, checklistId));

    return this.getChecklist(householdId, checklistId, userId);
  }

  // ============ TEMPLATES ============

  async getTemplates(): Promise<TemplateWithItems[]> {
    const templates = await this.db
      .select()
      .from(checklistTemplates)
      .orderBy(asc(checklistTemplates.specialty), asc(checklistTemplates.title))
      .all();

    return templates.map((template) => ({
      ...template,
      items: JSON.parse(template.items || '[]'),
    }));
  }

  async getTemplatesByCategory(category: string): Promise<TemplateWithItems[]> {
    const templates = await this.db
      .select()
      .from(checklistTemplates)
      .where(eq(checklistTemplates.specialty, category))
      .orderBy(asc(checklistTemplates.title))
      .all();

    return templates.map((template) => ({
      ...template,
      items: JSON.parse(template.items || '[]'),
    }));
  }

  async getTemplate(templateId: string): Promise<TemplateWithItems> {
    const template = await this.db
      .select()
      .from(checklistTemplates)
      .where(eq(checklistTemplates.id, templateId))
      .get();

    if (!template) {
      throw new NotFoundError('Template not found');
    }

    return {
      ...template,
      items: JSON.parse(template.items || '[]'),
    };
  }

  // ============ TECHNICAL TERMS ============

  async getTechnicalTerm(termKey: string): Promise<TechnicalTerm | null> {
    const term = await this.db
      .select()
      .from(technicalTerms)
      .where(eq(technicalTerms.term_key, termKey))
      .get();

    return term || null;
  }

  async getTechnicalTermsByCategory(category: string): Promise<TechnicalTerm[]> {
    return this.db
      .select()
      .from(technicalTerms)
      .where(eq(technicalTerms.category, category))
      .all();
  }

  // ============ AI INFO CONVERSATIONS ============

  async getOrCreateAIConversation(
    householdId: string,
    userId: string,
    technicalTerm: string,
    checklistItemId?: string,
    context?: Record<string, unknown>
  ): Promise<AIInfoConversation> {
    await this.checkHouseholdAccess(householdId, userId);

    // Check for existing conversation
    if (checklistItemId) {
      const existing = await this.db
        .select()
        .from(aiInfoConversations)
        .where(
          and(
            eq(aiInfoConversations.household_id, householdId),
            eq(aiInfoConversations.checklist_item_id, checklistItemId)
          )
        )
        .get();

      if (existing) {
        return existing;
      }
    }

    // Create new conversation
    const id = uuidv4();
    const now = nowIso();

    await this.db.insert(aiInfoConversations).values({
      id,
      household_id: householdId,
      checklist_item_id: checklistItemId || null,
      technical_term: technicalTerm,
      context_json: context ? JSON.stringify(context) : null,
      messages_json: '[]',
      created_at: now,
      updated_at: now,
    });

    const conversation = await this.db
      .select()
      .from(aiInfoConversations)
      .where(eq(aiInfoConversations.id, id))
      .get();

    if (!conversation) throw new NotFoundError('Conversation not found');

    return conversation;
  }

  async addMessageToAIConversation(
    householdId: string,
    conversationId: string,
    userId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<AIInfoConversation> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(aiInfoConversations)
      .where(and(eq(aiInfoConversations.id, conversationId), eq(aiInfoConversations.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Conversation not found');
    }

    const messages = JSON.parse(existing.messages_json || '[]') as Array<{
      role: string;
      content: string;
      timestamp: string;
    }>;

    messages.push({
      role,
      content,
      timestamp: nowIso(),
    });

    await this.db
      .update(aiInfoConversations)
      .set({
        messages_json: JSON.stringify(messages),
        updated_at: nowIso(),
      })
      .where(eq(aiInfoConversations.id, conversationId));

    const conversation = await this.db
      .select()
      .from(aiInfoConversations)
      .where(eq(aiInfoConversations.id, conversationId))
      .get();

    if (!conversation) throw new NotFoundError('Conversation not found');

    return conversation;
  }

  // ============ AI QUESTION GENERATION ============

  async generateAISuggestions(
    householdId: string,
    checklistId: string,
    userId: string,
    context: {
      taskId?: string;
      taskCategory?: string;
      taskTitle?: string;
      taskDescription?: string;
      contractorSpecialty?: string;
      visitPurpose?: string;
      imageDescriptions?: string[];
    }
  ): Promise<{ suggestions: ChecklistItem[]; aiContext: any }> {
    await this.checkHouseholdAccess(householdId, userId);

    // Initialize Claude on the acting member's own key when connected, so a
    // BYOK-only account is not blocked by an absent managed key.
    const { apiKey } = await resolveProviderApiKey(this.env, userId, 'anthropic');
    if (!apiKey) {
      throw new Error('AI not configured');
    }

    const claude = createProviderAdapter({
      provider: 'anthropic',
      apiKey,
      options: {
        onUsage: usageRecorderFor(this.env, {
          feature: 'visit_checklist',
          householdId,
          userId,
        }),
      },
    }) as ClaudeProvider;

    // Fetch task details if taskId provided
    let taskDetails = {
      category: context.taskCategory || 'general',
      title: context.taskTitle || 'Contractor Visit',
      description: context.taskDescription || '',
    };

    if (context.taskId) {
      const task = await this.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, context.taskId), eq(tasks.household_id, householdId)))
        .get();

      if (task) {
        taskDetails = {
          category: task.contractor_category || task.system_category || 'general',
          title: task.title || 'Contractor Visit',
          description: task.description || '',
        };
      }
    }

    // Format prompt
    const userPrompt = formatVisitChecklistPrompt({
      taskCategory: taskDetails.category,
      taskTitle: taskDetails.title,
      taskDescription: taskDetails.description,
      contractorSpecialty: context.contractorSpecialty || taskDetails.category,
      visitPurpose: context.visitPurpose,
      hasImages: (context.imageDescriptions?.length || 0) > 0,
      imageDescriptions: context.imageDescriptions,
    });

    // Generate questions using Claude
    const response = await claude.generateJSON<VisitChecklistResponse>({
      systemPrompt: VISIT_CHECKLIST_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 2048,
    });

    if (!response || !response.questions || response.questions.length === 0) {
      throw new Error('Failed to generate questions');
    }

    // Create checklist items from AI suggestions
    const now = nowIso();
    const suggestions: ChecklistItem[] = [];

    // Get current max sort order
    const existingItems = await this.db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.checklist_id, checklistId))
      .all();

    const maxOrder = existingItems.reduce((max, item) => Math.max(max, item.sort_order ?? 0), 0);

    for (let i = 0; i < response.questions.length; i++) {
      const question = response.questions[i];
      const itemId = uuidv4();

      await this.db.insert(checklistItems).values({
        id: itemId,
        checklist_id: checklistId,
        text: question.text,
        category: question.category,
        priority: question.priority,
        has_info_icon: question.has_info_icon,
        technical_term: question.technical_term,
        sort_order: maxOrder + i + 1,
        source: 'ai_suggested',
        ai_confidence: 0.9, // Default confidence
        suggested_at: now,
        checked: false,
        created_at: now,
      });

      const item = await this.db.select().from(checklistItems).where(eq(checklistItems.id, itemId)).get();
      if (item) suggestions.push(item);
    }

    // Update checklist with AI generation context
    const aiContext = {
      task_category: taskDetails.category,
      task_title: taskDetails.title,
      task_description: taskDetails.description,
      contractor_specialty: context.contractorSpecialty,
      generated_at: now,
      question_count: response.questions.length,
    };

    await this.db
      .update(visitChecklists)
      .set({
        source: 'ai_generated',
        ai_generation_context: JSON.stringify(aiContext),
        updated_at: now,
      })
      .where(eq(visitChecklists.id, checklistId));

    return {
      suggestions,
      aiContext,
    };
  }

  async acceptAISuggestion(
    householdId: string,
    _checklistId: string,
    itemId: string,
    userId: string
  ): Promise<ChecklistItem> {
    await this.checkHouseholdAccess(householdId, userId);

    const now = nowIso();

    await this.db
      .update(checklistItems)
      .set({
        accepted_at: now,
        source: 'manual', // Once accepted, treat as manual item
      })
      .where(eq(checklistItems.id, itemId));

    const item = await this.db.select().from(checklistItems).where(eq(checklistItems.id, itemId)).get();
    if (!item) throw new NotFoundError('Item not found');

    return item;
  }

  async dismissAISuggestion(
    householdId: string,
    _checklistId: string,
    itemId: string,
    userId: string
  ): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    const now = nowIso();

    await this.db
      .update(checklistItems)
      .set({
        dismissed_at: now,
      })
      .where(eq(checklistItems.id, itemId));
  }

  // ============ PHOTO MANAGEMENT ============

  async addPhotoToItem(
    householdId: string,
    _checklistId: string,
    itemId: string,
    userId: string,
    photoData: {
      photoKey: string;
      thumbnailKey?: string;
      caption?: string;
      takenAt?: string;
      fileSize?: number;
      mimeType?: string;
      width?: number;
      height?: number;
    }
  ): Promise<ChecklistItemPhoto> {
    await this.checkHouseholdAccess(householdId, userId);

    const photoId = uuidv4();
    const now = nowIso();

    await this.db.insert(checklistItemPhotos).values({
      id: photoId,
      checklist_item_id: itemId,
      household_id: householdId,
      photo_key: photoData.photoKey,
      thumbnail_key: photoData.thumbnailKey || null,
      caption: photoData.caption || null,
      taken_at: photoData.takenAt || now,
      file_size: photoData.fileSize || null,
      mime_type: photoData.mimeType || null,
      width: photoData.width || null,
      height: photoData.height || null,
      created_at: now,
    });

    const photo = await this.db.select().from(checklistItemPhotos).where(eq(checklistItemPhotos.id, photoId)).get();
    if (!photo) throw new NotFoundError('Photo not found');

    return photo;
  }

  async getPhotosForItem(
    householdId: string,
    _checklistId: string,
    itemId: string,
    userId: string
  ): Promise<ChecklistItemPhoto[]> {
    await this.checkHouseholdAccess(householdId, userId);

    return this.db
      .select()
      .from(checklistItemPhotos)
      .where(and(eq(checklistItemPhotos.checklist_item_id, itemId), eq(checklistItemPhotos.household_id, householdId)))
      .all();
  }

  async deletePhotoFromItem(
    householdId: string,
    _checklistId: string,
    _itemId: string,
    photoId: string,
    userId: string
  ): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.db
      .delete(checklistItemPhotos)
      .where(and(eq(checklistItemPhotos.id, photoId), eq(checklistItemPhotos.household_id, householdId)));
  }

  // ============ MULTI-CONTRACTOR COMPARISON ============

  async getChecklistsForTask(
    householdId: string,
    taskId: string,
    userId: string
  ): Promise<
    Array<{
      checklist: VisitChecklist;
      visit?: typeof contractorVisits.$inferSelect;
      contractor?: typeof contractors.$inferSelect;
      itemsCompleted: number;
      itemsTotal: number;
    }>
  > {
    await this.checkHouseholdAccess(householdId, userId);

    // Get all checklists for this task
    const checklists = await this.db
      .select()
      .from(visitChecklists)
      .where(and(eq(visitChecklists.task_id, taskId), eq(visitChecklists.household_id, householdId)))
      .orderBy(desc(visitChecklists.created_at))
      .all();

    const results = [];

    for (const checklist of checklists) {
      // Get associated visit and contractor
      let visit = null;
      let contractor = null;

      if (checklist.visit_id) {
        visit = await this.db.select().from(contractorVisits).where(eq(contractorVisits.id, checklist.visit_id)).get();

        if (visit) {
          contractor = await this.db
            .select()
            .from(contractors)
            .where(eq(contractors.id, visit.contractor_id))
            .get();
        }
      }

      // Count completed vs total items (exclude dismissed AI suggestions)
      const items = await this.db
        .select()
        .from(checklistItems)
        .where(and(eq(checklistItems.checklist_id, checklist.id), isNull(checklistItems.dismissed_at)))
        .all();

      const itemsTotal = items.length;
      const itemsCompleted = items.filter((item) => item.checked).length;

      results.push({
        checklist,
        visit: visit || undefined,
        contractor: contractor || undefined,
        itemsCompleted,
        itemsTotal,
      });
    }

    return results;
  }

  async getMultiContractorComparison(
    householdId: string,
    taskId: string,
    userId: string
  ): Promise<{
    task: typeof tasks.$inferSelect | null;
    contractors: Array<{
      contractor: typeof contractors.$inferSelect;
      visit?: typeof contractorVisits.$inferSelect;
      checklist?: VisitChecklist;
      quote?: typeof contractorQuotes.$inferSelect;
      checklistProgress: { completed: number; total: number };
      keyResponses: Array<{ question: string; answer: string; priority: string }>;
    }>;
  }> {
    await this.checkHouseholdAccess(householdId, userId);

    // Get task
    const task = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.household_id, householdId)))
      .get();

    // Get all visits for this task
    const visits = await this.db
      .select()
      .from(contractorVisits)
      .where(and(eq(contractorVisits.task_id, taskId), eq(contractorVisits.household_id, householdId)))
      .all();

    const contractorsData = [];

    for (const visit of visits) {
      // Get contractor
      const contractor = await this.db.select().from(contractors).where(eq(contractors.id, visit.contractor_id)).get();

      if (!contractor) continue;

      // Get checklist for this visit
      const checklist = await this.db
        .select()
        .from(visitChecklists)
        .where(eq(visitChecklists.visit_id, visit.id))
        .get();

      // Get quote if exists
      const quote = await this.db
        .select()
        .from(contractorQuotes)
        .where(and(eq(contractorQuotes.task_id, taskId), eq(contractorQuotes.contractor_id, contractor.id)))
        .get();

      // Get checklist items with responses
      const checklistProgress = { completed: 0, total: 0 };
      let keyResponses: Array<{ question: string; answer: string; priority: string }> = [];

      if (checklist) {
        const items = await this.db
          .select()
          .from(checklistItems)
          .where(and(eq(checklistItems.checklist_id, checklist.id), isNull(checklistItems.dismissed_at)))
          .all();

        checklistProgress.total = items.length;
        checklistProgress.completed = items.filter((item) => item.checked).length;

        // Get key responses (must_ask items with comments)
        keyResponses = items
          .filter((item) => item.priority === 'must_ask' && (item.comment || item.checked))
          .map((item) => ({
            question: item.text,
            answer: item.comment || (item.checked ? 'Checked' : 'No response'),
            priority: item.priority || 'nice_to_have',
          }));
      }

      contractorsData.push({
        contractor,
        visit: visit || undefined,
        checklist: checklist || undefined,
        quote: quote || undefined,
        checklistProgress,
        keyResponses,
      });
    }

    return {
      task: task || null,
      contractors: contractorsData,
    };
  }
}
