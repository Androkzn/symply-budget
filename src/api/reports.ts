import { useAuthStore } from '@stores/authStore';
import {
  reportDetailResponseSchema,
  reportsListResponseSchema,
} from '@symply/contracts';


import { apiClient } from './client';
import { putUploadViaXhr } from './e2ePutUpload';
import { shouldValidateApiResponses, validateApiResponse } from './validateResponse';

// Types
export interface Report {
  id: string;
  household_id: string;
  filename: string;
  file_size: number;
  status: 'pending_upload' | 'uploaded' | 'processing' | 'completed' | 'failed';
  error_message: string | null;
  page_count: number | null;
  inspection_date: string | null;
  inspector_name: string | null;
  property_address: string | null;
  uploaded_by: {
    id: string;
    display_name: string | null;
  };
  processing_progress?: number | null;
  processing_stage?: string | null;
  total_findings_count?: number | null;
  critical_findings_count?: number | null;
  created_at: string;
  updated_at: string;
}

export interface ReportSummary {
  id: string;
  report_id: string;
  summary_type: 'novice' | 'diy' | 'technical' | 'executive';
  overall_condition: 'excellent' | 'good' | 'fair' | 'poor' | null;
  key_concerns: string[];
  immediate_actions: string[];
  estimated_total_cost_min: number | null;
  estimated_total_cost_max: number | null;
  summary_text: string;
  generated_at: string;
  ai_model_version: string | null;
  prompt_version: string | null;
  created_at: string;
}

export interface ProcessingStatus {
  status: 'pending_upload' | 'uploaded' | 'processing' | 'completed' | 'failed';
  processing_progress: number;
  processing_stage: string | null;
  error_message: string | null;
}

export interface Finding {
  id: string;
  system_category: string;
  severity: 'critical' | 'major' | 'minor' | 'informational';
  title: string;
  description: string;
  plain_language_summary: string | null;
  ai_confidence: number | null;
  evidence_page_numbers: number[];
  created_at: string;
}

export interface ActionPlan {
  id: string;
  timeframe: '0-30_days' | '3-6_months' | '1_year' | '2-5_years' | '5-10_years';
  items: ActionPlanItem[];
  generated_at: string;
}

export interface ActionPlanItem {
  id: string;
  priority: string;
  title: string;
  description: string;
  status: string;
}

export interface ProcessingJob {
  id: string;
  report_id: string;
  job_type: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'retrying';
  attempts: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

// Request types
interface UploadUrlRequest {
  filename: string;
  file_size: number;
  content_type: 'application/pdf';
}

interface ReportFilters {
  status?: string;
  limit?: number;
  cursor?: string;
}

interface FindingFilters {
  system_category?: string;
  severity?: string;
  limit?: number;
  cursor?: string;
}

// Response types
interface UploadUrlResponse {
  report_id: string;
  upload_url: string;
  expires_at: string;
}

interface ReportsListResponse {
  reports: Report[];
  next_cursor?: string;
}

interface ReportResponse {
  report: Report;
}

interface FindingsListResponse {
  findings: Finding[];
  next_cursor?: string;
}

interface ActionPlansResponse {
  action_plans: ActionPlan[];
}

interface ProcessJobResponse {
  job_id: string;
  status: string;
}

interface JobResponse {
  job: ProcessingJob;
}

interface ProcessingStatusResponse {
  status: string;
  processing_progress: number;
  processing_stage: string | null;
  error_message: string | null;
}

interface SummariesResponse {
  summaries: ReportSummary[];
}

export const reportsApi = {
  // Upload flow
  getUploadUrl: (householdId: string, data: UploadUrlRequest) =>
    apiClient
      .post<UploadUrlResponse>(
        `/households/${householdId}/reports/upload-url`,
        data
      )
      .then((res) => res.data),

  uploadFile: async (
    uploadUrl: string,
    file: Blob,
    onProgress?: (progress: number) => void
  ) => {
    const token = useAuthStore.getState().token;

    return putUploadViaXhr({
      uploadUrl,
      body: file,
      contentType: 'application/pdf',
      authorization: token,
      label: 'report',
      onProgress,
    });
  },

  confirmUpload: (householdId: string, reportId: string) =>
    apiClient
      .post<ReportResponse>(
        `/households/${householdId}/reports/${reportId}/confirm-upload`
      )
      .then((res) => res.data),

  // Processing
  initiateProcessing: (householdId: string, reportId: string) =>
    apiClient
      .post<ProcessJobResponse>(
        `/households/${householdId}/reports/${reportId}/process`
      )
      .then((res) => res.data),

  // Enhanced processing with AI features
  initiateEnhancedProcessing: (householdId: string, reportId: string) =>
    apiClient
      .post<{ message: string; reportId: string; status: string }>(
        `/households/${householdId}/reports/${reportId}/process-enhanced`
      )
      .then((res) => res.data),

  getProcessingStatus: (householdId: string, reportId: string) =>
    apiClient
      .get<ProcessingStatusResponse>(
        `/households/${householdId}/reports/${reportId}/status`
      )
      .then((res) => res.data),

  getJobStatus: (jobId: string) =>
    apiClient.get<JobResponse>(`/jobs/${jobId}`).then((res) => res.data),

  // Summaries
  getSummaries: (
    householdId: string,
    reportId: string,
    type?: 'novice' | 'diy' | 'technical' | 'executive'
  ) =>
    apiClient
      .get<SummariesResponse>(
        `/households/${householdId}/reports/${reportId}/summaries`,
        { params: type ? { type } : undefined }
      )
      .then((res) => res.data),

  // Report CRUD
  list: (householdId: string, filters?: ReportFilters) =>
    apiClient
      .get<ReportsListResponse>(`/households/${householdId}/reports`, {
        params: filters,
      })
      .then((res) => {
        const data = res.data;
        if (!shouldValidateApiResponses()) return data;
        return validateApiResponse(
          reportsListResponseSchema,
          data,
          `GET /households/${householdId}/reports`
        );
      }),

  get: (householdId: string, reportId: string) =>
    apiClient
      .get<ReportResponse>(`/households/${householdId}/reports/${reportId}`)
      .then((res) => {
        const data = res.data;
        if (!shouldValidateApiResponses()) return data;
        return validateApiResponse(
          reportDetailResponseSchema,
          data,
          `GET /households/${householdId}/reports/${reportId}`
        );
      }),

  delete: (householdId: string, reportId: string) =>
    apiClient.delete(`/households/${householdId}/reports/${reportId}`),

  // Findings
  getFindings: (householdId: string, reportId: string, filters?: FindingFilters) =>
    apiClient
      .get<FindingsListResponse>(
        `/households/${householdId}/reports/${reportId}/findings`,
        { params: filters }
      )
      .then((res) => res.data),

  // Action Plans
  getActionPlans: (householdId: string, reportId: string) =>
    apiClient
      .get<ActionPlansResponse>(
        `/households/${householdId}/reports/${reportId}/action-plans`
      )
      .then((res) => res.data),

  // PDF Viewing
  getPdfUrl: (householdId: string, reportId: string) =>
    apiClient
      .get<{ url: string; expires_at: string; page_count: number; file_size: number }>(
        `/households/${householdId}/reports/${reportId}/pdf-url`
      )
      .then((res) => res.data),
};
