import { eq, and, desc, asc } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { v4 as uuidv4 } from 'uuid';

import { householdMembers } from '../db/schema';
import { contractors, SPECIALTY_INFO, type ContractorSpecialty } from '../db/schema-contractors';
import {
  projects,
  projectMilestones,
  projectPayments,
  projectProgressPhotos,
  type Project,
  type ProjectMilestone,
  type ProjectPayment,
  type ProjectProgressPhoto,
  type ProjectStatus,
  type MilestoneStatus,
  type PaymentType,
  type PaymentStatus,
} from '../db/schema-labor-hub';
import type { Env } from '../types';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { nowIso } from '../utils/id';

// Types for API responses
export interface ProjectWithDetails extends Project {
  contractor: {
    id: string;
    name: string;
    company_name: string | null;
    specialty: string;
    specialtyInfo: { label: string; icon: string; color: string };
  };
  milestones: ProjectMilestone[];
  payments: ProjectPayment[];
  progressPhotos: ProjectProgressPhoto[];
  progress: {
    completedMilestones: number;
    totalMilestones: number;
    paidAmount: number;
    remainingAmount: number;
  };
}

export class ProjectService {
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

  // ============ HELPER METHODS ============

  private async enrichProject(project: Project): Promise<ProjectWithDetails> {
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(eq(contractors.id, project.contractor_id))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    const milestones = await this.db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.project_id, project.id))
      .orderBy(asc(projectMilestones.sort_order))
      .all();

    const payments = await this.db
      .select()
      .from(projectPayments)
      .where(eq(projectPayments.project_id, project.id))
      .orderBy(asc(projectPayments.created_at))
      .all();

    const photos = await this.db
      .select()
      .from(projectProgressPhotos)
      .where(eq(projectProgressPhotos.project_id, project.id))
      .orderBy(desc(projectProgressPhotos.created_at))
      .all();

    const completedMilestones = milestones.filter((m) => m.status === 'completed').length;
    const paidAmount = payments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount_cents, 0);
    const totalAmount = payments.reduce((sum, p) => sum + p.amount_cents, 0);

    return {
      ...project,
      contractor: {
        id: contractor.id,
        name: contractor.name,
        company_name: contractor.company_name,
        specialty: contractor.specialty,
        specialtyInfo: SPECIALTY_INFO[contractor.specialty as ContractorSpecialty] || SPECIALTY_INFO.other,
      },
      milestones,
      payments,
      progressPhotos: photos,
      progress: {
        completedMilestones,
        totalMilestones: milestones.length,
        paidAmount,
        remainingAmount: totalAmount - paidAmount,
      },
    };
  }

  // ============ PROJECTS ============

  async getProjects(
    householdId: string,
    userId: string,
    filters?: {
      contractorId?: string;
      status?: string;
      activeOnly?: boolean;
    }
  ): Promise<ProjectWithDetails[]> {
    await this.checkHouseholdAccess(householdId, userId);

    let projectList = await this.db
      .select()
      .from(projects)
      .where(eq(projects.household_id, householdId))
      .orderBy(desc(projects.created_at))
      .all();

    // Apply filters
    if (filters?.contractorId) {
      projectList = projectList.filter((p) => p.contractor_id === filters.contractorId);
    }
    if (filters?.status) {
      projectList = projectList.filter((p) => p.status === filters.status);
    }
    if (filters?.activeOnly) {
      projectList = projectList.filter((p) => ['planning', 'in_progress'].includes(p.status));
    }

    return Promise.all(projectList.map((p) => this.enrichProject(p)));
  }

  async getProject(householdId: string, projectId: string, userId: string): Promise<ProjectWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);

    const project = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.household_id, householdId)))
      .get();

    if (!project) {
      throw new NotFoundError('Project not found');
    }

    return this.enrichProject(project);
  }

  async createProject(
    householdId: string,
    userId: string,
    input: {
      contractorId: string;
      title: string;
      description?: string;
      quoteId?: string;
      startDate?: string;
      estimatedEndDate?: string;
      totalBudgetCents?: number;
      linkedReportId?: string;
      linkedTaskIds?: string[];
      notes?: string;
    }
  ): Promise<ProjectWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);

    // Verify contractor
    const contractor = await this.db
      .select()
      .from(contractors)
      .where(and(eq(contractors.id, input.contractorId), eq(contractors.household_id, householdId)))
      .get();

    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    const id = uuidv4();
    const now = nowIso();

    await this.db.insert(projects).values({
      id,
      household_id: householdId,
      contractor_id: input.contractorId,
      title: input.title,
      description: input.description || null,
      quote_id: input.quoteId || null,
      status: 'planning',
      start_date: input.startDate || null,
      estimated_end_date: input.estimatedEndDate || null,
      total_budget_cents: input.totalBudgetCents || null,
      linked_report_id: input.linkedReportId || null,
      linked_task_ids: input.linkedTaskIds ? JSON.stringify(input.linkedTaskIds) : null,
      notes: input.notes || null,
      created_at: now,
      updated_at: now,
    });

    return this.getProject(householdId, id, userId);
  }

  async updateProject(
    householdId: string,
    projectId: string,
    userId: string,
    input: {
      title?: string;
      description?: string;
      status?: ProjectStatus;
      startDate?: string;
      estimatedEndDate?: string;
      actualEndDate?: string;
      totalBudgetCents?: number;
      totalSpentCents?: number;
      notes?: string;
    }
  ): Promise<ProjectWithDetails> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Project not found');
    }

    const updateData: Partial<Project> = {
      updated_at: nowIso(),
    };

    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.startDate !== undefined) updateData.start_date = input.startDate;
    if (input.estimatedEndDate !== undefined) updateData.estimated_end_date = input.estimatedEndDate;
    if (input.actualEndDate !== undefined) updateData.actual_end_date = input.actualEndDate;
    if (input.totalBudgetCents !== undefined) updateData.total_budget_cents = input.totalBudgetCents;
    if (input.totalSpentCents !== undefined) updateData.total_spent_cents = input.totalSpentCents;
    if (input.notes !== undefined) updateData.notes = input.notes;

    await this.db.update(projects).set(updateData).where(eq(projects.id, projectId));

    return this.getProject(householdId, projectId, userId);
  }

  async deleteProject(householdId: string, projectId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.household_id, householdId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Project not found');
    }

    // Delete related data (cascades handle some, but let's be explicit)
    await this.db.delete(projectMilestones).where(eq(projectMilestones.project_id, projectId));
    await this.db.delete(projectPayments).where(eq(projectPayments.project_id, projectId));
    await this.db.delete(projectProgressPhotos).where(eq(projectProgressPhotos.project_id, projectId));
    await this.db.delete(projects).where(eq(projects.id, projectId));
  }

  // ============ MILESTONES ============

  async getMilestones(householdId: string, projectId: string, userId: string): Promise<ProjectMilestone[]> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getProject(householdId, projectId, userId); // Verify project access

    return this.db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.project_id, projectId))
      .orderBy(asc(projectMilestones.sort_order))
      .all();
  }

  async createMilestone(
    householdId: string,
    projectId: string,
    userId: string,
    input: {
      title: string;
      description?: string;
      dueDate?: string;
      sortOrder?: number;
    }
  ): Promise<ProjectMilestone> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getProject(householdId, projectId, userId);

    const id = uuidv4();
    const now = nowIso();

    // Get max sort order
    const existing = await this.db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.project_id, projectId))
      .all();
    const maxOrder = Math.max(0, ...existing.map((m) => m.sort_order || 0));

    await this.db.insert(projectMilestones).values({
      id,
      project_id: projectId,
      title: input.title,
      description: input.description || null,
      status: 'pending',
      due_date: input.dueDate || null,
      sort_order: input.sortOrder ?? maxOrder + 1,
      created_at: now,
    });

    const milestone = await this.db.select().from(projectMilestones).where(eq(projectMilestones.id, id)).get();
    return milestone!;
  }

  async updateMilestone(
    householdId: string,
    projectId: string,
    milestoneId: string,
    userId: string,
    input: {
      title?: string;
      description?: string;
      status?: MilestoneStatus;
      dueDate?: string;
      completedDate?: string;
      notes?: string;
      sortOrder?: number;
    }
  ): Promise<ProjectMilestone> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getProject(householdId, projectId, userId);

    const existing = await this.db
      .select()
      .from(projectMilestones)
      .where(and(eq(projectMilestones.id, milestoneId), eq(projectMilestones.project_id, projectId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Milestone not found');
    }

    const updateData: Partial<ProjectMilestone> = {};

    if (input.title !== undefined) updateData.title = input.title;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.dueDate !== undefined) updateData.due_date = input.dueDate;
    if (input.completedDate !== undefined) updateData.completed_date = input.completedDate;
    if (input.notes !== undefined) updateData.notes = input.notes;
    if (input.sortOrder !== undefined) updateData.sort_order = input.sortOrder;

    await this.db.update(projectMilestones).set(updateData).where(eq(projectMilestones.id, milestoneId));

    const milestone = await this.db.select().from(projectMilestones).where(eq(projectMilestones.id, milestoneId)).get();
    return milestone!;
  }

  async deleteMilestone(householdId: string, projectId: string, milestoneId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getProject(householdId, projectId, userId);

    const existing = await this.db
      .select()
      .from(projectMilestones)
      .where(and(eq(projectMilestones.id, milestoneId), eq(projectMilestones.project_id, projectId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Milestone not found');
    }

    await this.db.delete(projectMilestones).where(eq(projectMilestones.id, milestoneId));
  }

  async completeMilestone(householdId: string, projectId: string, milestoneId: string, userId: string): Promise<ProjectMilestone> {
    return this.updateMilestone(householdId, projectId, milestoneId, userId, {
      status: 'completed',
      completedDate: nowIso(),
    });
  }

  // ============ PAYMENTS ============

  async getPayments(householdId: string, projectId: string, userId: string): Promise<ProjectPayment[]> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getProject(householdId, projectId, userId);

    return this.db
      .select()
      .from(projectPayments)
      .where(eq(projectPayments.project_id, projectId))
      .orderBy(asc(projectPayments.created_at))
      .all();
  }

  async createPayment(
    householdId: string,
    projectId: string,
    userId: string,
    input: {
      type: PaymentType;
      amountCents: number;
      dueDate?: string;
      notes?: string;
    }
  ): Promise<ProjectPayment> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getProject(householdId, projectId, userId);

    const id = uuidv4();
    const now = nowIso();

    await this.db.insert(projectPayments).values({
      id,
      project_id: projectId,
      type: input.type,
      amount_cents: input.amountCents,
      status: 'pending',
      due_date: input.dueDate || null,
      notes: input.notes || null,
      created_at: now,
    });

    const payment = await this.db.select().from(projectPayments).where(eq(projectPayments.id, id)).get();
    return payment!;
  }

  async updatePayment(
    householdId: string,
    projectId: string,
    paymentId: string,
    userId: string,
    input: {
      type?: PaymentType;
      amountCents?: number;
      status?: PaymentStatus;
      dueDate?: string;
      paidDate?: string;
      receiptDocumentKey?: string;
      notes?: string;
    }
  ): Promise<ProjectPayment> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getProject(householdId, projectId, userId);

    const existing = await this.db
      .select()
      .from(projectPayments)
      .where(and(eq(projectPayments.id, paymentId), eq(projectPayments.project_id, projectId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Payment not found');
    }

    const updateData: Partial<ProjectPayment> = {};

    if (input.type !== undefined) updateData.type = input.type;
    if (input.amountCents !== undefined) updateData.amount_cents = input.amountCents;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.dueDate !== undefined) updateData.due_date = input.dueDate;
    if (input.paidDate !== undefined) updateData.paid_date = input.paidDate;
    if (input.receiptDocumentKey !== undefined) updateData.receipt_document_key = input.receiptDocumentKey;
    if (input.notes !== undefined) updateData.notes = input.notes;

    await this.db.update(projectPayments).set(updateData).where(eq(projectPayments.id, paymentId));

    const payment = await this.db.select().from(projectPayments).where(eq(projectPayments.id, paymentId)).get();
    return payment!;
  }

  async markPaymentPaid(
    householdId: string,
    projectId: string,
    paymentId: string,
    userId: string,
    receiptDocumentKey?: string
  ): Promise<ProjectPayment> {
    const payment = await this.updatePayment(householdId, projectId, paymentId, userId, {
      status: 'paid',
      paidDate: nowIso(),
      receiptDocumentKey,
    });

    // Update project total_spent_cents
    const project = await this.getProject(householdId, projectId, userId);
    const totalSpent = project.payments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount_cents, 0);

    await this.db
      .update(projects)
      .set({ total_spent_cents: totalSpent, updated_at: nowIso() })
      .where(eq(projects.id, projectId));

    return payment;
  }

  // ============ PROGRESS PHOTOS ============

  async getProgressPhotos(householdId: string, projectId: string, userId: string): Promise<ProjectProgressPhoto[]> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getProject(householdId, projectId, userId);

    return this.db
      .select()
      .from(projectProgressPhotos)
      .where(eq(projectProgressPhotos.project_id, projectId))
      .orderBy(desc(projectProgressPhotos.created_at))
      .all();
  }

  async addProgressPhoto(
    householdId: string,
    projectId: string,
    userId: string,
    input: {
      photoKey: string;
      caption?: string;
      milestoneId?: string;
      tags?: string[];
    }
  ): Promise<ProjectProgressPhoto> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getProject(householdId, projectId, userId);

    const id = uuidv4();
    const now = nowIso();

    await this.db.insert(projectProgressPhotos).values({
      id,
      project_id: projectId,
      milestone_id: input.milestoneId || null,
      photo_key: input.photoKey,
      caption: input.caption || null,
      tags: input.tags ? JSON.stringify(input.tags) : null,
      taken_at: now,
      created_at: now,
    });

    const photo = await this.db.select().from(projectProgressPhotos).where(eq(projectProgressPhotos.id, id)).get();
    return photo!;
  }

  async deleteProgressPhoto(householdId: string, projectId: string, photoId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);
    await this.getProject(householdId, projectId, userId);

    const existing = await this.db
      .select()
      .from(projectProgressPhotos)
      .where(and(eq(projectProgressPhotos.id, photoId), eq(projectProgressPhotos.project_id, projectId)))
      .get();

    if (!existing) {
      throw new NotFoundError('Photo not found');
    }

    await this.db.delete(projectProgressPhotos).where(eq(projectProgressPhotos.id, photoId));
  }
}
