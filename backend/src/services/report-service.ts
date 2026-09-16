import { eq, and, isNull, desc, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import type {
  Database,
  Env,
  ReportResponse,
  ReportStatus,
  FindingResponse,
  Severity,
  SystemCategory,
} from '../types';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { generateId, now } from '../utils/id';

import { HouseholdService } from './household-service';

export class ReportService {
  private db: Database;
  private env: Env;
  private householdService: HouseholdService;

  constructor(env: Env, d1: D1Database) {
    this.db = drizzle(d1, { schema });
    this.env = env;
    this.householdService = new HouseholdService(env, d1);
  }

  /**
   * Generate a pre-signed URL for uploading a PDF to R2
   */
  async generateUploadUrl(
    householdId: string,
    userId: string,
    input: { filename: string; file_size: number; content_type: string }
  ): Promise<{ report_id: string; upload_url: string; expires_at: string }> {
    // Verify user is a member of the household
    await this.householdService.getHousehold(householdId, userId);

    const reportId = generateId();
    const fileKey = `reports/${householdId}/${reportId}/${input.filename}`;
    const timestamp = now();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Create report record in pending state
    await this.db.insert(schema.reports).values({
      id: reportId,
      household_id: householdId,
      uploaded_by: userId,
      filename: input.filename,
      file_size: input.file_size,
      file_key: fileKey,
      status: 'pending_upload',
      created_at: timestamp,
      updated_at: timestamp,
      updated_by: userId,
    });

    // For R2 upload, we return a direct upload endpoint
    // Note: R2 doesn't have native pre-signed URL generation via Workers API,
    // so the client will upload directly to our endpoint which then stores in R2
    const signedUrl = `${this.env.API_URL}/households/${householdId}/reports/${reportId}/upload`;

    return {
      report_id: reportId,
      upload_url: signedUrl,
      expires_at: expiresAt.toISOString(),
    };
  }

  /**
   * Handle direct file upload
   */
  async uploadFile(
    householdId: string,
    reportId: string,
    userId: string,
    file: ArrayBuffer,
    contentType: string
  ): Promise<void> {
    // Verify report exists and belongs to household
    const report = await this.getReportInternal(reportId);
    if (!report || report.household_id !== householdId) {
      throw new NotFoundError('Report');
    }

    console.log(`[uploadFile] Report ${reportId} current status: ${report.status}`);
    if (report.status !== 'pending_upload') {
      console.error(`[uploadFile] Cannot upload report ${reportId} - status is ${report.status}, expected pending_upload`);
      throw new ForbiddenError(`Report has already been uploaded. Current status: ${report.status}`);
    }

    // Verify user has access
    await this.householdService.getHousehold(householdId, userId);

    // Upload to R2
    try {
      console.log(`Uploading to R2: ${report.file_key} (${file.byteLength} bytes)`);
      await this.env.REPORTS_BUCKET.put(report.file_key, file, {
        httpMetadata: {
          contentType,
        },
      });
      console.log(`Successfully uploaded to R2: ${report.file_key}`);
    } catch (r2Error) {
      console.error(`R2 upload failed for ${report.file_key}:`, {
        error: r2Error instanceof Error ? r2Error.message : String(r2Error),
        stack: r2Error instanceof Error ? r2Error.stack : undefined,
      });
      throw new Error(`Failed to upload file to storage: ${r2Error instanceof Error ? r2Error.message : 'Unknown error'}`);
    }

    // Note: Do NOT update status here - let confirmUpload handle it
    // This keeps the status as 'pending_upload' until confirmUpload is called
    console.log(`[uploadFile] File uploaded successfully. Status remains 'pending_upload' until confirmUpload is called.`);
  }

  /**
   * Confirm file upload and update status
   */
  async confirmUpload(
    householdId: string,
    reportId: string,
    userId: string
  ): Promise<ReportResponse> {
    console.log(`[confirmUpload] Step 1: Getting report ${reportId} for household ${householdId}`);
    const report = await this.getReportInternal(reportId);
    
    if (!report) {
      console.error(`[confirmUpload] Report ${reportId} not found`);
      throw new NotFoundError('Report');
    }
    
    if (report.household_id !== householdId) {
      console.error(`[confirmUpload] Report ${reportId} belongs to different household. Expected: ${householdId}, Got: ${report.household_id}`);
      throw new NotFoundError('Report');
    }

    console.log(`[confirmUpload] Step 2: Checking report status. Current status: ${report.status}, Expected: pending_upload`);
    if (report.status !== 'pending_upload') {
      console.error(`[confirmUpload] Report ${reportId} status is ${report.status}, expected pending_upload`);
      throw new ForbiddenError(`Report has already been confirmed. Current status: ${report.status}`);
    }

    console.log(`[confirmUpload] Step 3: Verifying user ${userId} has access to household ${householdId}`);
    // Verify user has access
    await this.householdService.getHousehold(householdId, userId);
    console.log(`[confirmUpload] Step 3: User access verified`);

    console.log(`[confirmUpload] Step 4: Verifying file exists in R2. File key: ${report.file_key}`);
    // Verify file exists in R2
    const object = await this.env.REPORTS_BUCKET.head(report.file_key);
    if (!object) {
      console.error(`[confirmUpload] File not found in R2: ${report.file_key}`);
      throw new NotFoundError('File not found in storage');
    }
    console.log(`[confirmUpload] Step 4: File verified in R2. Size: ${object.size} bytes`);

    console.log(`[confirmUpload] Step 5: Updating report status to 'uploaded'`);
    // Update report status
    await this.db
      .update(schema.reports)
      .set({
        status: 'uploaded',
        updated_at: now(),
        updated_by: userId,
      })
      .where(eq(schema.reports.id, reportId));
    console.log(`[confirmUpload] Step 5: Report status updated successfully`);

    console.log(`[confirmUpload] Step 6: Fetching updated report`);
    const result = await this.getReport(householdId, reportId, userId);
    console.log(`[confirmUpload] Step 6: Successfully confirmed upload for report ${reportId}`);
    return result;
  }

  /**
   * Initiate processing of a report
   */
  async initiateProcessing(
    householdId: string,
    reportId: string,
    userId: string
  ): Promise<{ job_id: string; status: string }> {
    const report = await this.getReportInternal(reportId);
    if (!report || report.household_id !== householdId) {
      throw new NotFoundError('Report');
    }

    if (report.status !== 'uploaded') {
      throw new ForbiddenError(`Cannot process report in ${report.status} status`);
    }

    // Verify user has access
    await this.householdService.getHousehold(householdId, userId);

    const jobId = generateId();
    const timestamp = now();

    // Create processing job record
    await this.db.insert(schema.processingJobs).values({
      id: jobId,
      report_id: reportId,
      job_type: 'extraction',
      status: 'queued',
      created_at: timestamp,
      updated_at: timestamp,
    });

    // Update report status
    await this.db
      .update(schema.reports)
      .set({
        status: 'processing',
        processing_started_at: timestamp,
        updated_at: timestamp,
        updated_by: userId,
      })
      .where(eq(schema.reports.id, reportId));

    // Queue processing job (if queue is available - requires paid plan)
    // For now, we'll process synchronously or mark for manual processing
    try {
      if (this.env.PDF_PROCESSING_QUEUE) {
        await this.env.PDF_PROCESSING_QUEUE.send({
          reportId,
          jobType: 'extraction',
          attempt: 1,
        });
      }
    } catch {
      console.log('Queue not available, processing will be handled manually');
    }

    return {
      job_id: jobId,
      status: 'queued',
    };
  }

  /**
   * Get a single report
   */
  async getReport(
    householdId: string,
    reportId: string,
    userId: string
  ): Promise<ReportResponse> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const report = await this.db
      .select({
        id: schema.reports.id,
        household_id: schema.reports.household_id,
        filename: schema.reports.filename,
        file_size: schema.reports.file_size,
        status: schema.reports.status,
        error_message: schema.reports.error_message,
        page_count: schema.reports.page_count,
        inspection_date: schema.reports.inspection_date,
        inspector_name: schema.reports.inspector_name,
        property_address: schema.reports.property_address,
        created_at: schema.reports.created_at,
        updated_at: schema.reports.updated_at,
        uploaded_by_id: schema.reports.uploaded_by,
        uploaded_by_name: schema.users.display_name,
      })
      .from(schema.reports)
      .leftJoin(schema.users, eq(schema.reports.uploaded_by, schema.users.id))
      .where(
        and(
          eq(schema.reports.id, reportId),
          eq(schema.reports.household_id, householdId),
          isNull(schema.reports.deleted_at)
        )
      )
      .get();

    if (!report) {
      throw new NotFoundError('Report');
    }

    return {
      id: report.id,
      household_id: report.household_id,
      filename: report.filename,
      file_size: report.file_size,
      status: report.status as ReportStatus,
      error_message: report.error_message,
      page_count: report.page_count,
      inspection_date: report.inspection_date,
      inspector_name: report.inspector_name,
      property_address: report.property_address,
      uploaded_by: {
        id: report.uploaded_by_id,
        display_name: report.uploaded_by_name,
      },
      created_at: report.created_at,
      updated_at: report.updated_at,
    };
  }

  /**
   * List reports for a household
   */
  async listReports(
    householdId: string,
    userId: string,
    filters: {
      status?: ReportStatus;
      limit?: number;
      cursor?: string;
    }
  ): Promise<{ reports: ReportResponse[]; next_cursor?: string }> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    const limit = filters.limit || 20;
    const conditions = [
      eq(schema.reports.household_id, householdId),
      isNull(schema.reports.deleted_at),
    ];

    if (filters.status) {
      conditions.push(eq(schema.reports.status, filters.status));
    }

    if (filters.cursor) {
      conditions.push(lt(schema.reports.created_at, filters.cursor));
    }

    const reports = await this.db
      .select({
        id: schema.reports.id,
        household_id: schema.reports.household_id,
        filename: schema.reports.filename,
        file_size: schema.reports.file_size,
        status: schema.reports.status,
        error_message: schema.reports.error_message,
        page_count: schema.reports.page_count,
        inspection_date: schema.reports.inspection_date,
        inspector_name: schema.reports.inspector_name,
        property_address: schema.reports.property_address,
        processing_progress: schema.reports.processing_progress,
        processing_stage: schema.reports.processing_stage,
        total_findings_count: schema.reports.total_findings_count,
        critical_findings_count: schema.reports.critical_findings_count,
        created_at: schema.reports.created_at,
        updated_at: schema.reports.updated_at,
        uploaded_by_id: schema.reports.uploaded_by,
        uploaded_by_name: schema.users.display_name,
      })
      .from(schema.reports)
      .leftJoin(schema.users, eq(schema.reports.uploaded_by, schema.users.id))
      .where(and(...conditions))
      .orderBy(desc(schema.reports.created_at))
      .limit(limit + 1)
      .all();

    const hasMore = reports.length > limit;
    const results = hasMore ? reports.slice(0, -1) : reports;

    return {
      reports: results.map((r) => ({
        id: r.id,
        household_id: r.household_id,
        filename: r.filename,
        file_size: r.file_size,
        status: r.status as ReportStatus,
        error_message: r.error_message,
        page_count: r.page_count,
        inspection_date: r.inspection_date,
        inspector_name: r.inspector_name,
        property_address: r.property_address,
        processing_progress: r.processing_progress,
        processing_stage: r.processing_stage,
        total_findings_count: r.total_findings_count,
        critical_findings_count: r.critical_findings_count,
        uploaded_by: {
          id: r.uploaded_by_id,
          display_name: r.uploaded_by_name,
        },
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      next_cursor: hasMore ? results[results.length - 1].created_at : undefined,
    };
  }

  /**
   * Get findings for a report
   */
  async getFindings(
    householdId: string,
    reportId: string,
    userId: string,
    filters: {
      system_category?: SystemCategory;
      severity?: Severity;
      limit?: number;
      cursor?: string;
    }
  ): Promise<{ findings: FindingResponse[]; next_cursor?: string }> {
    // Verify user has access and report exists
    await this.getReport(householdId, reportId, userId);

    const limit = filters.limit || 20;
    const conditions = [eq(schema.findings.report_id, reportId)];

    if (filters.system_category) {
      conditions.push(eq(schema.findings.system_category, filters.system_category));
    }

    if (filters.severity) {
      conditions.push(eq(schema.findings.severity, filters.severity));
    }

    if (filters.cursor) {
      conditions.push(lt(schema.findings.created_at, filters.cursor));
    }

    const findings = await this.db
      .select()
      .from(schema.findings)
      .where(and(...conditions))
      .orderBy(desc(schema.findings.created_at))
      .limit(limit + 1)
      .all();

    const hasMore = findings.length > limit;
    const results = hasMore ? findings.slice(0, -1) : findings;

    return {
      findings: results.map((f) => ({
        id: f.id,
        system_category: f.system_category as SystemCategory,
        severity: f.severity as Severity,
        title: f.title,
        description: f.description,
        plain_language_summary: f.plain_language_summary,
        ai_confidence: f.ai_confidence,
        evidence_page_numbers: f.evidence_page_numbers
          ? JSON.parse(f.evidence_page_numbers)
          : [],
        created_at: f.created_at,
      })),
      next_cursor: hasMore ? results[results.length - 1].created_at : undefined,
    };
  }

  /**
   * Get action plans for a report
   */
  async getActionPlans(
    householdId: string,
    reportId: string,
    userId: string
  ): Promise<
    {
      id: string;
      timeframe: string;
      items: Array<{
        id: string;
        priority: string;
        title: string;
        description: string;
        status: string;
      }>;
      generated_at: string;
    }[]
  > {
    // Verify user has access and report exists
    await this.getReport(householdId, reportId, userId);

    // action_plans/action_items tables were removed — tasks are the single entity now
    return [];
  }

  /**
   * Delete a report (soft delete)
   * Owners can delete any report, members can delete their own uploads or pending reports
   */
  async deleteReport(
    householdId: string,
    reportId: string,
    userId: string
  ): Promise<void> {
    // Verify user has access to household
    const household = await this.householdService.getHousehold(householdId, userId);

    const report = await this.getReportInternal(reportId);
    if (!report || report.household_id !== householdId) {
      throw new NotFoundError('Report');
    }

    // Allow deletion if: user is owner, user uploaded the report, or report is pending/failed/processing
    const canDelete =
      household.my_role === 'owner' ||
      report.uploaded_by === userId ||
      report.status === 'pending_upload' ||
      report.status === 'failed' ||
      report.status === 'processing';

    if (!canDelete) {
      throw new ForbiddenError('You do not have permission to delete this report');
    }

    const deletedAt = now();

    // Delete all related artifacts in order (child tables first, respecting foreign keys)

    // 1. Hard delete findings (no deleted_at column)
    await this.db
      .delete(schema.findings)
      .where(eq(schema.findings.report_id, reportId));

    // 2. Hard delete report chunks (no deleted_at column)
    await this.db
      .delete(schema.reportChunks)
      .where(eq(schema.reportChunks.report_id, reportId));

    // 6. Hard delete report summaries (no deleted_at column)
    await this.db
      .delete(schema.reportSummaries)
      .where(eq(schema.reportSummaries.report_id, reportId));

    // 7. Hard delete processing jobs (no deleted_at column)
    await this.db
      .delete(schema.processingJobs)
      .where(eq(schema.processingJobs.report_id, reportId));

    // 8. Finally, soft delete the report itself
    await this.db
      .update(schema.reports)
      .set({
        deleted_at: deletedAt,
        updated_at: deletedAt,
        updated_by: userId,
      })
      .where(eq(schema.reports.id, reportId));

    // Note: R2 file is kept for potential recovery
  }

  /**
   * Get processing job status
   */
  async getJobStatus(
    jobId: string,
    userId: string
  ): Promise<{
    id: string;
    report_id: string;
    job_type: string;
    status: string;
    attempts: number;
    progress_percent: number | null;
    current_step: string | null;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
  }> {
    const job = await this.db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.id, jobId))
      .get();

    if (!job) {
      throw new NotFoundError('Job');
    }

    // Verify user has access to the report's household
    const report = await this.getReportInternal(job.report_id);
    if (report) {
      await this.householdService.getHousehold(report.household_id, userId);
    }

    // Calculate progress based on status
    let progressPercent: number | null = null;
    let currentStep: string | null = null;

    switch (job.status) {
      case 'queued':
        progressPercent = 0;
        currentStep = 'Waiting in queue';
        break;
      case 'processing':
        progressPercent = 50;
        currentStep = 'Analyzing report';
        break;
      case 'completed':
        progressPercent = 100;
        currentStep = 'Complete';
        break;
      case 'failed':
        progressPercent = null;
        currentStep = 'Failed';
        break;
      case 'retrying':
        progressPercent = 25;
        currentStep = 'Retrying analysis';
        break;
    }

    return {
      id: job.id,
      report_id: job.report_id,
      job_type: job.job_type,
      status: job.status,
      attempts: job.attempts,
      progress_percent: progressPercent,
      current_step: currentStep,
      error_message: job.last_error,
      started_at: job.started_at,
      completed_at: job.completed_at,
    };
  }

  /**
   * Get report without membership check (internal use)
   */
  private async getReportInternal(reportId: string) {
    return this.db
      .select()
      .from(schema.reports)
      .where(
        and(eq(schema.reports.id, reportId), isNull(schema.reports.deleted_at))
      )
      .get();
  }

  /**
   * Get persona-specific summaries for a report
   */
  async getSummaries(
    reportId: string,
    summaryType?: 'novice' | 'diy' | 'technical' | 'executive'
  ) {
    const conditions = [eq(schema.reportSummaries.report_id, reportId)];

    if (summaryType) {
      conditions.push(eq(schema.reportSummaries.summary_type, summaryType));
    }

    const summaries = await this.db
      .select()
      .from(schema.reportSummaries)
      .where(and(...conditions))
      .all();

    return summaries.map((s) => ({
      id: s.id,
      report_id: s.report_id,
      summary_type: s.summary_type,
      overall_condition: s.overall_condition,
      key_concerns: s.key_concerns ? JSON.parse(s.key_concerns) : [],
      immediate_actions: s.immediate_actions ? JSON.parse(s.immediate_actions) : [],
      estimated_total_cost_min: s.estimated_total_cost_min,
      estimated_total_cost_max: s.estimated_total_cost_max,
      summary_text: s.summary_text,
      generated_at: s.generated_at,
      ai_model_version: s.ai_model_version,
      prompt_version: s.prompt_version,
      created_at: s.created_at,
    }));
  }

  async markProcessingFailed(reportId: string, errorMessage: string): Promise<void> {
    await this.db
      .update(schema.reports)
      .set({
        status: 'failed',
        error_message: errorMessage,
        updated_at: now(),
      })
      .where(eq(schema.reports.id, reportId));
  }

  async getReportFileKey(reportId: string): Promise<string | null> {
    const reportRecord = await this.db
      .select({ file_key: schema.reports.file_key })
      .from(schema.reports)
      .where(eq(schema.reports.id, reportId))
      .get();
    return reportRecord?.file_key ?? null;
  }
}
