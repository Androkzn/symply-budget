import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';

import { householdMembers } from '../db/schema';
import {
  contractors,
  contractorVisits,
  contractorDocuments,
  type Contractor,
  type ContractorVisit,
  type ContractorDocument,
  SPECIALTY_INFO,
  type ContractorSpecialty,
} from '../db/schema-contractors';
import type { Env } from '../types';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { nowIso } from '../utils/id';

// Types for API responses
export interface ContractorWithStats extends Contractor {
  totalVisits: number;
  totalSpent: number;
  lastVisitDate: string | null;
  specialtyInfo: { label: string; icon: string; color: string };
}

export interface ContractorDetail extends ContractorWithStats {
  recentVisits: ContractorVisit[];
  documentCount: number;
}

export class ContractorService {
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

  // ============ CONTRACTORS ============

  async getContractors(
    householdId: string,
    userId: string,
    filters?: { specialty?: string; isFavorite?: boolean; search?: string }
  ): Promise<ContractorWithStats[]> {
    await this.checkHouseholdAccess(householdId, userId);

    let contractorList = await this.db
      .select()
      .from(contractors)
      .where(eq(contractors.household_id, householdId))
      .orderBy(asc(contractors.name))
      .all();

    // Apply filters
    if (filters?.specialty) {
      contractorList = contractorList.filter((c) => c.specialty === filters.specialty);
    }
    if (filters?.isFavorite !== undefined) {
      contractorList = contractorList.filter((c) => c.is_favorite === filters.isFavorite);
    }
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      contractorList = contractorList.filter(
        (c) =>
          c.name.toLowerCase().includes(searchLower) ||
          c.company_name?.toLowerCase().includes(searchLower)
      );
    }

    // Get stats for each contractor
    const contractorsWithStats: ContractorWithStats[] = await Promise.all(
      contractorList.map(async (contractor) => {
        const visits = await this.db
          .select()
          .from(contractorVisits)
          .where(eq(contractorVisits.contractor_id, contractor.id))
          .orderBy(desc(contractorVisits.visit_date))
          .all();

        const totalSpent = visits.reduce((sum, v) => sum + (v.cost || 0), 0);
        const lastVisit = visits.find((v) => v.status === 'completed');

        return {
          ...contractor,
          totalVisits: visits.filter((v) => v.status === 'completed').length,
          totalSpent,
          lastVisitDate: lastVisit?.visit_date || null,
          specialtyInfo: SPECIALTY_INFO[contractor.specialty as ContractorSpecialty] || SPECIALTY_INFO.other,
        };
      })
    );

    return contractorsWithStats;
  }

  async getContractor(householdId: string, contractorId: string, userId: string): Promise<ContractorDetail> {
    await this.checkHouseholdAccess(householdId, userId);

    const contractor = await this.db
      .select()
      .from(contractors)
      .where(and(eq(contractors.id, contractorId), eq(contractors.household_id, householdId)))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    // Get visits
    const visits = await this.db
      .select()
      .from(contractorVisits)
      .where(eq(contractorVisits.contractor_id, contractorId))
      .orderBy(desc(contractorVisits.visit_date))
      .all();

    // Get document count
    const documents = await this.db
      .select()
      .from(contractorDocuments)
      .where(eq(contractorDocuments.contractor_id, contractorId))
      .all();

    const totalSpent = visits.reduce((sum, v) => sum + (v.cost || 0), 0);
    const completedVisits = visits.filter((v) => v.status === 'completed');
    const lastVisit = completedVisits[0];

    return {
      ...contractor,
      totalVisits: completedVisits.length,
      totalSpent,
      lastVisitDate: lastVisit?.visit_date || null,
      specialtyInfo: SPECIALTY_INFO[contractor.specialty as ContractorSpecialty] || SPECIALTY_INFO.other,
      recentVisits: visits.slice(0, 5),
      documentCount: documents.length,
    };
  }

  async createContractor(
    householdId: string,
    userId: string,
    input: {
      name: string;
      companyName?: string;
      specialty: string;
      phone?: string;
      email?: string;
      website?: string;
      address?: string;
      notes?: string;
      rating?: number;
      isFavorite?: boolean;
    }
  ): Promise<Contractor> {
    await this.checkHouseholdAccess(householdId, userId);

    const id = crypto.randomUUID();
    const now = nowIso();

    const contractorData = {
      id,
      household_id: householdId,
      name: input.name,
      company_name: input.companyName || null,
      specialty: input.specialty,
      phone: input.phone || null,
      email: input.email || null,
      website: input.website || null,
      address: input.address || null,
      notes: input.notes || null,
      rating: input.rating ?? null,
      is_favorite: input.isFavorite ?? false,
      created_at: now,
      updated_at: now,
    };

    try {
      console.log('[ContractorService] Inserting contractor:', JSON.stringify(contractorData));
      await this.db.insert(contractors).values(contractorData);
      console.log('[ContractorService] Insert successful');
    } catch (dbError) {
      console.error('[ContractorService] Database insert error:', dbError);
      console.error('[ContractorService] Error message:', (dbError as Error).message);
      console.error('[ContractorService] Error stack:', (dbError as Error).stack);
      throw dbError;
    }

    const contractor = contractorData as Contractor;

    return contractor;
  }

  async updateContractor(
    householdId: string,
    contractorId: string,
    userId: string,
    updates: Partial<{
      name: string;
      companyName: string;
      specialty: string;
      phone: string;
      email: string;
      website: string;
      address: string;
      notes: string;
      rating: number;
      isFavorite: boolean;
    }>
  ): Promise<Contractor> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(contractors)
      .where(and(eq(contractors.id, contractorId), eq(contractors.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Contractor not found');
    }

    const updateData: Record<string, unknown> = {
      updated_at: nowIso(),
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.companyName !== undefined) updateData.company_name = updates.companyName;
    if (updates.specialty !== undefined) updateData.specialty = updates.specialty;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.website !== undefined) updateData.website = updates.website;
    if (updates.address !== undefined) updateData.address = updates.address;
    if (updates.notes !== undefined) updateData.notes = updates.notes;
    if (updates.rating !== undefined) updateData.rating = updates.rating;
    if (updates.isFavorite !== undefined) updateData.is_favorite = updates.isFavorite;

    await this.db.update(contractors).set(updateData).where(eq(contractors.id, contractorId));

    return { ...existing, ...updateData } as Contractor;
  }

  async deleteContractor(householdId: string, contractorId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(contractors)
      .where(and(eq(contractors.id, contractorId), eq(contractors.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Contractor not found');
    }

    // Delete will cascade to visits and documents
    await this.db
      .delete(contractors)
      .where(and(eq(contractors.id, contractorId), eq(contractors.household_id, householdId)));
  }

  // ============ VISITS ============

  async getVisits(
    householdId: string,
    userId: string,
    filters?: { contractorId?: string; status?: string; startDate?: string; endDate?: string }
  ): Promise<(ContractorVisit & { contractor: Contractor })[]> {
    await this.checkHouseholdAccess(householdId, userId);

    let visits = await this.db
      .select()
      .from(contractorVisits)
      .where(eq(contractorVisits.household_id, householdId))
      .orderBy(desc(contractorVisits.visit_date))
      .all();

    // Apply filters
    if (filters?.contractorId) {
      visits = visits.filter((v) => v.contractor_id === filters.contractorId);
    }
    if (filters?.status) {
      visits = visits.filter((v) => v.status === filters.status);
    }
    if (filters?.startDate) {
      visits = visits.filter((v) => v.visit_date >= filters.startDate!);
    }
    if (filters?.endDate) {
      visits = visits.filter((v) => v.visit_date <= filters.endDate!);
    }

    // Get contractor info for each visit
    const visitsWithContractor = await Promise.all(
      visits.map(async (visit) => {
        const contractor = await this.db
          .select()
          .from(contractors)
          .where(eq(contractors.id, visit.contractor_id))
          .get();

        return {
          ...visit,
          contractor: contractor!,
        };
      })
    );

    return visitsWithContractor;
  }

  async getVisit(householdId: string, visitId: string, userId: string): Promise<ContractorVisit> {
    await this.checkHouseholdAccess(householdId, userId);

    const visit = await this.db
      .select()
      .from(contractorVisits)
      .where(and(eq(contractorVisits.id, visitId), eq(contractorVisits.household_id, householdId)))
      .get();

    if (!visit) {
      throw new NotFoundError('Visit not found');
    }

    return visit;
  }

  async createVisit(
    householdId: string,
    contractorId: string,
    userId: string,
    input: {
      visitDate: string;
      description?: string;
      cost?: number;
      status: string;
      notes?: string;
      rating?: number;
      linkedTaskId?: string;
      linkedBudgetItemId?: string;
    }
  ): Promise<ContractorVisit> {
    await this.checkHouseholdAccess(householdId, userId);

    // Verify contractor exists and belongs to household
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(and(eq(contractors.id, contractorId), eq(contractors.household_id, householdId)))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    const id = crypto.randomUUID();
    const now = nowIso();

    const values: typeof contractorVisits.$inferInsert = {
      id,
      contractor_id: contractorId,
      household_id: householdId,
      visit_date: input.visitDate,
      description: input.description || null,
      cost: input.cost || null,
      status: input.status,
      notes: input.notes || null,
      rating: input.rating || null,
      linked_task_id: input.linkedTaskId || null,
      linked_budget_item_id: input.linkedBudgetItemId || null,
      created_at: now,
      updated_at: now,
    };

    await this.db.insert(contractorVisits).values(values);

    const created = await this.db
      .select()
      .from(contractorVisits)
      .where(eq(contractorVisits.id, id))
      .get();

    return created!;
  }

  async updateVisit(
    householdId: string,
    visitId: string,
    userId: string,
    updates: Partial<{
      visitDate: string;
      description: string;
      cost: number;
      status: string;
      notes: string;
      rating: number;
      linkedTaskId: string;
      linkedBudgetItemId: string;
      receiptReceived: boolean;
      visit_mode_started_at: string;
      visit_mode_ended_at: string;
      contractor_rep_name: string;
      voice_recording_key: string;
      voice_recording_transcription: string;
      voice_recording_duration_seconds: number;
    }>
  ): Promise<ContractorVisit> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(contractorVisits)
      .where(and(eq(contractorVisits.id, visitId), eq(contractorVisits.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Visit not found');
    }

    const updateData: Record<string, unknown> = {
      updated_at: nowIso(),
    };

    if (updates.visitDate !== undefined) updateData.visit_date = updates.visitDate;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.cost !== undefined) updateData.cost = updates.cost;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.notes !== undefined) updateData.notes = updates.notes;
    if (updates.rating !== undefined) updateData.rating = updates.rating;
    if (updates.linkedTaskId !== undefined) updateData.linked_task_id = updates.linkedTaskId;
    if (updates.linkedBudgetItemId !== undefined) updateData.linked_budget_item_id = updates.linkedBudgetItemId;
    if (updates.receiptReceived !== undefined) updateData.receipt_received = updates.receiptReceived ? 1 : 0;
    if (updates.visit_mode_started_at !== undefined) updateData.visit_mode_started_at = updates.visit_mode_started_at;
    if (updates.visit_mode_ended_at !== undefined) updateData.visit_mode_ended_at = updates.visit_mode_ended_at;
    if (updates.contractor_rep_name !== undefined) updateData.contractor_rep_name = updates.contractor_rep_name;
    if (updates.voice_recording_key !== undefined) updateData.voice_recording_key = updates.voice_recording_key;
    if (updates.voice_recording_transcription !== undefined)
      updateData.voice_recording_transcription = updates.voice_recording_transcription;
    if (updates.voice_recording_duration_seconds !== undefined)
      updateData.voice_recording_duration_seconds = updates.voice_recording_duration_seconds;

    await this.db.update(contractorVisits).set(updateData).where(eq(contractorVisits.id, visitId));

    return { ...existing, ...updateData } as ContractorVisit;
  }

  async deleteVisit(householdId: string, visitId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.db
      .delete(contractorVisits)
      .where(and(eq(contractorVisits.id, visitId), eq(contractorVisits.household_id, householdId)));
  }

  // ============ DOCUMENTS ============

  async getDocuments(
    householdId: string,
    userId: string,
    filters?: { contractorId?: string; visitId?: string; type?: string }
  ): Promise<ContractorDocument[]> {
    await this.checkHouseholdAccess(householdId, userId);

    let documents = await this.db
      .select()
      .from(contractorDocuments)
      .where(eq(contractorDocuments.household_id, householdId))
      .orderBy(desc(contractorDocuments.created_at))
      .all();

    if (filters?.contractorId) {
      documents = documents.filter((d) => d.contractor_id === filters.contractorId);
    }
    if (filters?.visitId) {
      documents = documents.filter((d) => d.visit_id === filters.visitId);
    }
    if (filters?.type) {
      documents = documents.filter((d) => d.type === filters.type);
    }

    return documents;
  }

  async createDocument(
    householdId: string,
    userId: string,
    input: {
      contractorId: string;
      visitId?: string;
      type: string;
      title: string;
      fileKey: string;
      fileName: string;
      fileSize?: number;
      mimeType?: string;
      amount?: number;
      documentDate?: string;
      notes?: string;
    }
  ): Promise<ContractorDocument> {
    await this.checkHouseholdAccess(householdId, userId);

    // Verify contractor exists
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(and(eq(contractors.id, input.contractorId), eq(contractors.household_id, householdId)))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    const id = crypto.randomUUID();
    const now = nowIso();

    const document: ContractorDocument = {
      id,
      contractor_id: input.contractorId,
      visit_id: input.visitId || null,
      household_id: householdId,
      type: input.type,
      title: input.title,
      file_key: input.fileKey,
      file_name: input.fileName,
      file_size: input.fileSize || null,
      mime_type: input.mimeType || null,
      amount: input.amount || null,
      document_date: input.documentDate || null,
      notes: input.notes || null,
      created_at: now,
    };

    await this.db.insert(contractorDocuments).values(document);

    return document;
  }

  async deleteDocument(householdId: string, documentId: string, userId: string): Promise<string> {
    await this.checkHouseholdAccess(householdId, userId);

    const document = await this.db
      .select()
      .from(contractorDocuments)
      .where(and(eq(contractorDocuments.id, documentId), eq(contractorDocuments.household_id, householdId)))
      .get();

    if (!document) {
      throw new NotFoundError('Document not found');
    }

    await this.db
      .delete(contractorDocuments)
      .where(and(eq(contractorDocuments.id, documentId), eq(contractorDocuments.household_id, householdId)));

    // Return file key so caller can delete from R2
    return document.file_key;
  }

  // ============ UPLOAD URL ============

  async generateFileKey(
    householdId: string,
    userId: string,
    input: { fileName: string; contentType: string }
  ): Promise<{ fileKey: string }> {
    await this.checkHouseholdAccess(householdId, userId);

    const fileKey = `contractors/${householdId}/${crypto.randomUUID()}/${input.fileName}`;

    return { fileKey };
  }

  async uploadDocument(
    householdId: string,
    userId: string,
    fileKey: string,
    fileData: ArrayBuffer,
    contentType: string
  ): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    if (!this.env.REPORTS_BUCKET) {
      throw new Error('Document storage not configured');
    }

    await this.env.REPORTS_BUCKET.put(fileKey, fileData, {
      httpMetadata: {
        contentType,
      },
    });
  }

  async getDocumentFile(fileKey: string): Promise<R2ObjectBody | null> {
    if (!this.env.REPORTS_BUCKET) {
      throw new Error('Document storage not configured');
    }

    return this.env.REPORTS_BUCKET.get(fileKey);
  }

  async deleteDocumentFile(fileKey: string): Promise<void> {
    if (!this.env.REPORTS_BUCKET) {
      return;
    }

    try {
      await this.env.REPORTS_BUCKET.delete(fileKey);
    } catch (error) {
      console.error('Failed to delete file from R2:', error);
    }
  }

  // ============ RECEIPT MANAGEMENT ============

  async requestReceipt(
    householdId: string,
    visitId: string,
    userId: string,
    input: {
      method: 'email' | 'sms';
      contractorEmail?: string;
      contractorPhone?: string;
      propertyAddress: string;
      customMessage?: string;
    }
  ): Promise<{ success: boolean; message: string; receipt_requested_at: string }> {
    await this.checkHouseholdAccess(householdId, userId);

    // Get visit details
    const visit = await this.db
      .select()
      .from(contractorVisits)
      .where(and(eq(contractorVisits.id, visitId), eq(contractorVisits.household_id, householdId)))
      .get();

    if (!visit) {
      throw new NotFoundError('Visit not found');
    }

    // Get contractor details
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(eq(contractors.id, visit.contractor_id))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    const now = nowIso();
    const visitDate = new Date(visit.visit_date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Update the visit to mark receipt as requested
    await this.db
      .update(contractorVisits)
      .set({
        receipt_requested_at: now,
        updated_at: now,
      })
      .where(eq(contractorVisits.id, visitId));

    // Generate the message text
    const messageText = input.customMessage || this.generateReceiptRequestMessage(
      contractor.name,
      contractor.company_name,
      visitDate,
      input.propertyAddress,
      visit.description || 'service visit'
    );

    // For now, return success with the message - actual email/SMS sending would be implemented separately
    // In production, this would integrate with email service (SendGrid, Resend, etc.) or SMS service (Twilio)
    return {
      success: true,
      message: `Receipt request ${input.method === 'email' ? 'email' : 'message'} prepared. Message: ${messageText}`,
      receipt_requested_at: now,
    };
  }

  private generateReceiptRequestMessage(
    contractorName: string,
    _companyName: string | null,
    visitDate: string,
    propertyAddress: string,
    workDescription: string
  ): string {
    return `Hello ${contractorName},

I hope this message finds you well. I am writing to kindly request a receipt for the work completed at my property.

Visit Details:
- Date: ${visitDate}
- Property Address: ${propertyAddress}
- Work Performed: ${workDescription}

Having a receipt would be greatly appreciated for my records. If you could please send it at your earliest convenience, that would be wonderful.

Thank you for your excellent service!

Best regards`;
  }

  async createReceiptReminderTask(
    householdId: string,
    visitId: string,
    userId: string
  ): Promise<{ success: boolean; task_id: string; message: string }> {
    await this.checkHouseholdAccess(householdId, userId);

    // Get visit details
    const visit = await this.db
      .select()
      .from(contractorVisits)
      .where(and(eq(contractorVisits.id, visitId), eq(contractorVisits.household_id, householdId)))
      .get();

    if (!visit) {
      throw new NotFoundError('Visit not found');
    }

    // Get contractor details
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(eq(contractors.id, visit.contractor_id))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    // Check if task already exists
    if (visit.receipt_reminder_task_id) {
      return {
        success: false,
        task_id: visit.receipt_reminder_task_id,
        message: 'A reminder task already exists for this visit',
      };
    }

    const taskId = crypto.randomUUID();
    const now = nowIso();
    const displayName = contractor.company_name || contractor.name;
    const visitDate = new Date(visit.visit_date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    // Create a maintenance task for the receipt reminder
    // Using raw SQL since we need to insert into the tasks table
    await this.db.run(sql`
      INSERT INTO tasks (
        id, household_id, title, description, system_category,
        frequency, next_due_date, reminder_enabled, reminder_days_before,
        reminder_time, reminder_repeat, status, source, created_at, updated_at
      ) VALUES (
        ${taskId},
        ${householdId},
        ${`Request receipt from ${displayName}`},
        ${`Follow up on receipt for the visit on ${visitDate}. Work performed: ${visit.description || 'service visit'}`},
        ${'other'},
        ${'daily'},
        ${now.split('T')[0]},
        ${1},
        ${0},
        ${'09:00'},
        ${1},
        ${'pending'},
        ${'system_generated'},
        ${now},
        ${now}
      )
    `);

    // Update the visit with the task ID
    await this.db
      .update(contractorVisits)
      .set({
        receipt_reminder_task_id: taskId,
        updated_at: now,
      })
      .where(eq(contractorVisits.id, visitId));

    return {
      success: true,
      task_id: taskId,
      message: `Daily reminder task created to request receipt from ${displayName}`,
    };
  }
}
