import { eq, and, asc, desc } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { v4 as uuidv4 } from 'uuid';

import { householdMembers } from '../db/schema';
import { contractors } from '../db/schema-contractors';
import {
  contractorMessages,
  messageTemplates,
  type ContractorMessage,
  type MessageTemplate,
  MESSAGE_DIRECTIONS,
  MESSAGE_CHANNELS,
} from '../db/schema-labor-hub';
import type { Env } from '../types';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { nowIso } from '../utils/id';

export interface MessageWithContractor extends ContractorMessage {
  contractor: {
    id: string;
    name: string;
    company_name: string | null;
    phone: string | null;
    email: string | null;
  };
}

export interface ConversationSummary {
  contractorId: string;
  contractorName: string;
  companyName: string | null;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  totalMessages: number;
}

export class MessageService {
  private db: DrizzleD1Database;

  constructor(_env: Env, d1: D1Database) {
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

  private async checkContractorAccess(householdId: string, contractorId: string): Promise<void> {
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(and(eq(contractors.id, contractorId), eq(contractors.household_id, householdId)))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }
  }

  // ============ MESSAGES ============

  async getMessages(
    householdId: string,
    userId: string,
    filters?: {
      contractorId?: string;
      channel?: string;
      status?: string;
      limit?: number;
    }
  ): Promise<MessageWithContractor[]> {
    await this.checkHouseholdAccess(householdId, userId);

    let messages = await this.db
      .select()
      .from(contractorMessages)
      .where(eq(contractorMessages.household_id, householdId))
      .orderBy(desc(contractorMessages.created_at))
      .all();

    if (filters?.contractorId) {
      messages = messages.filter((m) => m.contractor_id === filters.contractorId);
    }
    if (filters?.channel) {
      messages = messages.filter((m) => m.channel === filters.channel);
    }
    if (filters?.status) {
      messages = messages.filter((m) => m.status === filters.status);
    }
    if (filters?.limit) {
      messages = messages.slice(0, filters.limit);
    }

    // Enrich with contractor info
    return Promise.all(messages.map((m) => this.enrichMessage(m)));
  }

  async getConversation(
    householdId: string,
    contractorId: string,
    userId: string
  ): Promise<MessageWithContractor[]> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.checkContractorAccess(householdId, contractorId);

    const messages = await this.db
      .select()
      .from(contractorMessages)
      .where(
        and(
          eq(contractorMessages.household_id, householdId),
          eq(contractorMessages.contractor_id, contractorId)
        )
      )
      .orderBy(asc(contractorMessages.created_at))
      .all();

    return Promise.all(messages.map((m) => this.enrichMessage(m)));
  }

  async getConversationSummaries(householdId: string, userId: string): Promise<ConversationSummary[]> {
    await this.checkHouseholdAccess(householdId, userId);

    // Get all contractors with messages
    const messages = await this.db
      .select()
      .from(contractorMessages)
      .where(eq(contractorMessages.household_id, householdId))
      .orderBy(desc(contractorMessages.created_at))
      .all();

    // Group by contractor
    const contractorIds = [...new Set(messages.map((m) => m.contractor_id))];

    const summaries: ConversationSummary[] = [];

    for (const contractorId of contractorIds) {
      const contractorMessages = messages.filter((m) => m.contractor_id === contractorId);
      const lastMessage = contractorMessages[0];

      const contractor = await this.db
        .select()
        .from(contractors)
        .where(eq(contractors.id, contractorId))
        .get();

      if (contractor) {
        const unreadCount = contractorMessages.filter(
          (m) => m.direction === 'inbound' && m.status !== 'read'
        ).length;

        summaries.push({
          contractorId,
          contractorName: contractor.name,
          companyName: contractor.company_name,
          lastMessage: lastMessage.body.substring(0, 100) + (lastMessage.body.length > 100 ? '...' : ''),
          lastMessageTime: lastMessage.created_at,
          unreadCount,
          totalMessages: contractorMessages.length,
        });
      }
    }

    return summaries;
  }

  async getMessage(householdId: string, messageId: string, userId: string): Promise<MessageWithContractor> {
    await this.checkHouseholdAccess(householdId, userId);

    const message = await this.db
      .select()
      .from(contractorMessages)
      .where(and(eq(contractorMessages.id, messageId), eq(contractorMessages.household_id, householdId)))
      .get();

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    return this.enrichMessage(message);
  }

  async createMessage(
    householdId: string,
    contractorId: string,
    userId: string,
    input: {
      direction: (typeof MESSAGE_DIRECTIONS)[number];
      channel: (typeof MESSAGE_CHANNELS)[number];
      subject?: string;
      body: string;
      attachments?: string[];
    }
  ): Promise<MessageWithContractor> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.checkContractorAccess(householdId, contractorId);

    const id = uuidv4();
    const now = nowIso();

    await this.db.insert(contractorMessages).values({
      id,
      household_id: householdId,
      contractor_id: contractorId,
      direction: input.direction,
      channel: input.channel,
      subject: input.subject || null,
      body: input.body,
      attachments: input.attachments ? JSON.stringify(input.attachments) : null,
      status: input.direction === 'outbound' ? 'sent' : 'delivered',
      sent_at: input.direction === 'outbound' ? now : null,
      read_at: null,
      created_at: now,
    });

    return this.getMessage(householdId, id, userId);
  }

  async markAsRead(householdId: string, messageId: string, userId: string): Promise<MessageWithContractor> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.getMessage(householdId, messageId, userId);

    if (existing.status !== 'read') {
      await this.db
        .update(contractorMessages)
        .set({
          status: 'read',
          read_at: nowIso(),
        })
        .where(eq(contractorMessages.id, messageId));
    }

    return this.getMessage(householdId, messageId, userId);
  }

  async markConversationAsRead(
    householdId: string,
    contractorId: string,
    userId: string
  ): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.checkContractorAccess(householdId, contractorId);

    const now = nowIso();

    await this.db
      .update(contractorMessages)
      .set({
        status: 'read',
        read_at: now,
      })
      .where(
        and(
          eq(contractorMessages.household_id, householdId),
          eq(contractorMessages.contractor_id, contractorId),
          eq(contractorMessages.direction, 'inbound')
        )
      );
  }

  async deleteMessage(householdId: string, messageId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.getMessage(householdId, messageId, userId);

    await this.db.delete(contractorMessages).where(eq(contractorMessages.id, messageId));
  }

  private async enrichMessage(message: ContractorMessage): Promise<MessageWithContractor> {
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(eq(contractors.id, message.contractor_id))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    return {
      ...message,
      contractor: {
        id: contractor.id,
        name: contractor.name,
        company_name: contractor.company_name,
        phone: contractor.phone,
        email: contractor.email,
      },
    };
  }

  // ============ MESSAGE TEMPLATES ============

  async getTemplates(category?: string): Promise<MessageTemplate[]> {
    let templates = await this.db
      .select()
      .from(messageTemplates)
      .orderBy(asc(messageTemplates.type), asc(messageTemplates.title))
      .all();

    if (category) {
      templates = templates.filter((t) => t.type === category);
    }

    return templates;
  }

  async getTemplate(templateId: string): Promise<MessageTemplate> {
    const template = await this.db
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.id, templateId))
      .get();

    if (!template) {
      throw new NotFoundError('Template not found');
    }

    return template;
  }

  async applyTemplate(
    templateId: string,
    variables: Record<string, string>
  ): Promise<{ subject: string | null; body: string }> {
    const template = await this.getTemplate(templateId);

    let subject = template.subject_template;
    let body = template.body_template;

    // Replace variables in template
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      if (subject) {
        subject = subject.replace(new RegExp(placeholder, 'g'), value);
      }
      body = body.replace(new RegExp(placeholder, 'g'), value);
    }

    return { subject, body };
  }
}
