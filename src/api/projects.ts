import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { apiClient } from './client';

// ============ TYPES ============

export const PROJECT_STATUSES = [
  'planning',
  'in_progress',
  'on_hold',
  'completed',
  'cancelled',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_INFO: Record<ProjectStatus, { label: string; color: string }> = {
  planning: { label: 'Planning', color: '#5856D6' },
  in_progress: { label: 'In Progress', color: '#007AFF' },
  on_hold: { label: 'On Hold', color: '#FF9500' },
  completed: { label: 'Completed', color: '#34C759' },
  cancelled: { label: 'Cancelled', color: '#FF3B30' },
};

export const MILESTONE_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const PAYMENT_TYPES = ['deposit', 'progress', 'final', 'change_order'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_STATUSES = ['pending', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface Project {
  id: string;
  household_id: string;
  contractor_id: string;
  quote_id: string | null;
  title: string;
  description: string | null;
  status: ProjectStatus;
  start_date: string | null;
  estimated_end_date: string | null;
  actual_end_date: string | null;
  total_budget_cents: number | null;
  notes: string | null;
  linked_report_ids: string | null; // JSON array
  linked_task_ids: string | null; // JSON array
  created_at: string;
  updated_at: string;
}

export interface ProjectMilestone {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: MilestoneStatus;
  due_date: string | null;
  completed_date: string | null;
  sort_order: number;
  notes: string | null;
  created_at: string;
}

export interface ProjectPayment {
  id: string;
  project_id: string;
  type: PaymentType;
  title: string;
  amount_cents: number;
  status: PaymentStatus;
  due_date: string | null;
  paid_date: string | null;
  receipt_document_key: string | null;
  notes: string | null;
  created_at: string;
}

export interface ProjectProgressPhoto {
  id: string;
  project_id: string;
  milestone_id: string | null;
  photo_key: string;
  caption: string | null;
  taken_at: string | null;
  tags: string | null; // JSON array
  created_at: string;
}

export interface ProjectWithDetails extends Project {
  contractor: {
    id: string;
    name: string;
    company_name: string | null;
    specialty: string;
    phone: string | null;
    email: string | null;
    specialtyInfo: { label: string; icon: string; color: string };
  };
  milestones: ProjectMilestone[];
  payments: ProjectPayment[];
  progressPhotos: ProjectProgressPhoto[];
  progress: {
    completedMilestones: number;
    totalMilestones: number;
    paidAmount: number;
    totalAmount: number;
  };
}

// ============ REQUEST TYPES ============

interface CreateProjectRequest {
  contractor_id: string;
  quote_id?: string;
  title: string;
  description?: string;
  start_date?: string;
  estimated_end_date?: string;
  total_budget_cents?: number;
  notes?: string;
  linked_report_ids?: string[];
  linked_task_ids?: string[];
}

interface UpdateProjectRequest {
  title?: string;
  description?: string;
  status?: ProjectStatus;
  start_date?: string;
  estimated_end_date?: string;
  actual_end_date?: string;
  total_budget_cents?: number;
  notes?: string;
  linked_report_ids?: string[];
  linked_task_ids?: string[];
}

interface CreateMilestoneRequest {
  title: string;
  description?: string;
  due_date?: string;
  notes?: string;
}

interface UpdateMilestoneRequest {
  title?: string;
  description?: string;
  status?: MilestoneStatus;
  due_date?: string;
  completed_date?: string;
  notes?: string;
  sort_order?: number;
}

interface CreatePaymentRequest {
  type: PaymentType;
  title: string;
  amount_cents: number;
  due_date?: string;
  notes?: string;
}

interface UpdatePaymentRequest {
  type?: PaymentType;
  title?: string;
  amount_cents?: number;
  status?: PaymentStatus;
  due_date?: string;
  paid_date?: string;
  receipt_document_key?: string;
  notes?: string;
}

interface CreateProgressPhotoRequest {
  milestone_id?: string;
  photo_key: string;
  caption?: string;
  taken_at?: string;
  tags?: string[];
}

interface ProjectFilters {
  contractor_id?: string;
  status?: ProjectStatus;
}

// ============ RESPONSE TYPES ============

interface ProjectsResponse {
  projects: ProjectWithDetails[];
}

interface ProjectResponse {
  project: ProjectWithDetails;
}

interface MilestoneResponse {
  milestone: ProjectMilestone;
}

interface PaymentResponse {
  payment: ProjectPayment;
}

interface ProgressPhotoResponse {
  photo: ProjectProgressPhoto;
}

// ============ API CLIENT ============

const remoteProjectsApi = {
  // Projects
  getAll: (householdId: string, filters?: ProjectFilters) =>
    apiClient
      .get<ProjectsResponse>(`/households/${householdId}/projects`, { params: filters })
      .then((res) => res.data),

  getActive: (householdId: string) =>
    apiClient
      .get<ProjectsResponse>(`/households/${householdId}/projects/active`)
      .then((res) => res.data),

  getOne: (householdId: string, projectId: string) =>
    apiClient
      .get<ProjectResponse>(`/households/${householdId}/projects/${projectId}`)
      .then((res) => res.data),

  create: (householdId: string, data: CreateProjectRequest) =>
    apiClient
      .post<ProjectResponse>(`/households/${householdId}/projects`, data)
      .then((res) => res.data),

  update: (householdId: string, projectId: string, data: UpdateProjectRequest) =>
    apiClient
      .patch<ProjectResponse>(`/households/${householdId}/projects/${projectId}`, data)
      .then((res) => res.data),

  delete: (householdId: string, projectId: string) =>
    apiClient.delete(`/households/${householdId}/projects/${projectId}`),

  // Milestones
  addMilestone: (householdId: string, projectId: string, data: CreateMilestoneRequest) =>
    apiClient
      .post<MilestoneResponse>(`/households/${householdId}/projects/${projectId}/milestones`, data)
      .then((res) => res.data),

  updateMilestone: (householdId: string, projectId: string, milestoneId: string, data: UpdateMilestoneRequest) =>
    apiClient
      .patch<MilestoneResponse>(`/households/${householdId}/projects/${projectId}/milestones/${milestoneId}`, data)
      .then((res) => res.data),

  deleteMilestone: (householdId: string, projectId: string, milestoneId: string) =>
    apiClient.delete(`/households/${householdId}/projects/${projectId}/milestones/${milestoneId}`),

  completeMilestone: (householdId: string, projectId: string, milestoneId: string) =>
    apiClient
      .post<MilestoneResponse>(`/households/${householdId}/projects/${projectId}/milestones/${milestoneId}/complete`)
      .then((res) => res.data),

  // Payments
  addPayment: (householdId: string, projectId: string, data: CreatePaymentRequest) =>
    apiClient
      .post<PaymentResponse>(`/households/${householdId}/projects/${projectId}/payments`, data)
      .then((res) => res.data),

  updatePayment: (householdId: string, projectId: string, paymentId: string, data: UpdatePaymentRequest) =>
    apiClient
      .patch<PaymentResponse>(`/households/${householdId}/projects/${projectId}/payments/${paymentId}`, data)
      .then((res) => res.data),

  deletePayment: (householdId: string, projectId: string, paymentId: string) =>
    apiClient.delete(`/households/${householdId}/projects/${projectId}/payments/${paymentId}`),

  markPaymentPaid: (householdId: string, projectId: string, paymentId: string, receiptDocumentKey?: string) =>
    apiClient
      .post<PaymentResponse>(`/households/${householdId}/projects/${projectId}/payments/${paymentId}/mark-paid`, {
        receipt_document_key: receiptDocumentKey,
      })
      .then((res) => res.data),

  // Progress Photos
  addProgressPhoto: (householdId: string, projectId: string, data: CreateProgressPhotoRequest) =>
    apiClient
      .post<ProgressPhotoResponse>(`/households/${householdId}/projects/${projectId}/photos`, data)
      .then((res) => res.data),

  deleteProgressPhoto: (householdId: string, projectId: string, photoId: string) =>
    apiClient.delete(`/households/${householdId}/projects/${projectId}/photos/${photoId}`),
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens call `projectsApi`
 * exactly as before; the Proxy is what makes the H11 B3 cutover cost zero screen
 * edits. See `documents/requirements/House v2/` §6, §11 (sub-wave B3).
 *
 * This module serves the labor-hub `projects` table — the job commissioned from
 * a contractor. It has nothing to do with `home-projects.ts`, the C4 renovation
 * planner, which keeps its own api module and will get its own facade.
 *
 * `remoteMethods` is empty, and unusually for a labor-hub module there is
 * nothing on the other side of the ledger either: all 16 methods have a working
 * local counterpart and none of them throws. Nothing here runs a model, and
 * nothing here moves bytes — `addProgressPhoto` records a `photo_key` a caller
 * already holds, the same metadata-only split `contractorsApi.createDocument`
 * uses, so the only R2-shaped surface in the module is a string column. Marking
 * a deposit paid, ticking off a milestone or captioning a photo of the framing
 * from a job site with no signal is the case this table exists for.
 */
export const projectsApi: typeof remoteProjectsApi = createHouseLocalProxy(remoteProjectsApi, {
  moduleName: 'projects',
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localProjectsApi').localProjectsApi,
});
