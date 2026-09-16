import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { authMiddleware } from '../middleware/auth';
import { resolveProviderApiKey } from '../services/ai-credential-resolver';
import { isReportPipelinePaused } from '../services/config-flags';
import { EnhancedPdfProcessorService, ReportProcessingConflictError, REPROCESSABLE_REPORT_STATUSES } from '../services/enhanced-pdf-processor';
import { assertCanUseAI } from '../services/entitlement-service';
import { PdfProcessingService } from '../services/pdf-processing-service';
import { ReportService } from '../services/report-service';
import type { Env } from '../types';
import { ServiceUnavailableError } from '../utils/errors';
import { now } from '../utils/id';
import {
  uploadUrlSchema,
  reportFiltersSchema,
  findingFiltersSchema,
} from '../utils/validation';

const reports = new Hono<{ Bindings: Env }>();

// All report routes require authentication
reports.use('/*', authMiddleware());

// Helper to get householdId from parent route param
function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

/**
 * POST /households/:householdId/reports/upload-url
 * Generate pre-signed URL for PDF upload
 */
reports.post('/upload-url', zValidator('json', uploadUrlSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const input = c.req.valid('json');
  const reportService = new ReportService(c.env, c.env.DB);

  const result = await reportService.generateUploadUrl(householdId, userId, input);

  return c.json(result, 200);
});

/**
 * PUT /households/:householdId/reports/:id/upload
 * Direct file upload endpoint
 */
reports.put('/:id/upload', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('id');
  const reportService = new ReportService(c.env, c.env.DB);

  try {
    const contentType = c.req.header('content-type') || 'application/pdf';
    const contentLength = c.req.header('content-length');
    
    console.log(`[upload] Upload request for report ${reportId}:`, {
      householdId,
      userId,
      contentType,
      contentLength,
      hasBody: !!c.req.raw.body,
    });

    const body = await c.req.arrayBuffer();
    const bodySize = body.byteLength;
    
    console.log(`[upload] Received file upload: ${bodySize} bytes for report ${reportId}`);

    if (bodySize === 0) {
      return c.json({ error: 'File is empty' }, 400);
    }

    await reportService.uploadFile(householdId, reportId, userId, body, contentType);

    console.log(`[upload] File uploaded successfully for report ${reportId}`);
    return c.json({ message: 'File uploaded successfully' }, 200);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Upload failed';
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    
    console.error(`[upload] Upload failed for report ${reportId}:`, {
      error: errorMessage,
      errorName,
      stack: errorStack,
      householdId,
      userId,
    });

    // Handle specific error types
    if (errorName === 'ForbiddenError' || (error instanceof Error && error.message.includes('already been uploaded'))) {
      return c.json({ 
        error: errorMessage,
        code: 'already_uploaded'
      }, 403);
    }
    if (errorName === 'NotFoundError' || (error instanceof Error && error.message.includes('not found'))) {
      return c.json({ error: 'Report not found' }, 404);
    }
    
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * POST /households/:householdId/reports/:id/confirm-upload
 * Confirm file upload completion
 */
reports.post('/:id/confirm-upload', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('id');
  
  console.log(`[confirm-upload] Starting for report ${reportId}, household ${householdId}, user ${userId}`);
  
  const reportService = new ReportService(c.env, c.env.DB);

  try {
    const report = await reportService.confirmUpload(householdId, reportId, userId);
    console.log(`[confirm-upload] Successfully confirmed upload for report ${reportId}, status: ${report.status}`);
    return c.json({ report }, 200);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error(`[confirm-upload] Failed for report ${reportId}:`, {
      error: errorMessage,
      errorName,
      stack: errorStack,
      householdId,
      userId,
      reportId,
      timestamp: now(),
    });
    
    // Handle specific error types
    if (errorName === 'NotFoundError' || (error instanceof Error && error.message.includes('not found'))) {
      return c.json({ 
        error: errorMessage,
        code: 'not_found'
      }, 404);
    }
    if (errorName === 'ForbiddenError' || (error instanceof Error && error.message.includes('already been confirmed'))) {
      return c.json({ 
        error: errorMessage,
        code: 'already_confirmed'
      }, 403);
    }
    
    return c.json({ 
      error: errorMessage,
      code: 'server_error'
    }, 500);
  }
});

/**
 * POST /households/:householdId/reports/:id/process
 * Initiate report processing
 */
reports.post('/:id/process', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('id');
  const reportService = new ReportService(c.env, c.env.DB);

  const result = await reportService.initiateProcessing(householdId, reportId, userId);

  return c.json(result, 202);
});

/**
 * POST /households/:householdId/reports/:id/process-sync
 * Process report synchronously (fallback for when queue is unavailable)
 * This is a long-running operation and should be used carefully
 */
reports.post('/:id/process-sync', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('id');
  await assertCanUseAI(userId, c.env);

  // First, initiate the job
  const reportService = new ReportService(c.env, c.env.DB);
  await reportService.initiateProcessing(householdId, reportId, userId);

  // Then process synchronously
  const pdfService = new PdfProcessingService(c.env, c.env.DB, userId);
  await pdfService.processReportSync(reportId);

  // Return the updated report
  const report = await reportService.getReport(householdId, reportId, userId);

  return c.json({ report, message: 'Report processed successfully' });
});

/**
 * POST /households/:householdId/reports/:id/process-enhanced
 * Process report with enhanced AI features (persona summaries, space mapping, etc.)
 * Uses Claude PDF native support for files <32MB, Lambda for larger files
 */
reports.post('/:id/process-enhanced', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('id');

  if (await isReportPipelinePaused(c.env)) {
    throw new ServiceUnavailableError('Report pipeline is temporarily paused');
  }

  await assertCanUseAI(userId, c.env);

  console.log(`[process-enhanced] Starting for report ${reportId}, household ${householdId}, user ${userId}`);

  try {
    // Verify user has access to this report and check status
    const reportService = new ReportService(c.env, c.env.DB);
    const report = await reportService.getReport(householdId, reportId, userId);
    
    console.log(`[process-enhanced] Report ${reportId} status: ${report.status}, file_size: ${report.file_size} bytes`);

    // Ensure report is eligible for processing (initial upload or retry after failure)
    const allowedStatuses: readonly string[] = REPROCESSABLE_REPORT_STATUSES;
    if (!allowedStatuses.includes(report.status)) {
      const statusCode = report.status === 'processing' || report.status === 'completed' ? 409 : 400;
      console.error(
        `[process-enhanced] Cannot process report ${reportId} - status is ${report.status}, expected ${allowedStatuses.join(' or ')}`
      );
      return c.json(
        {
          error: `Cannot process report in ${report.status} status.`,
          reportId,
          status: report.status,
          code: statusCode === 409 ? 'already_processing_or_complete' : 'invalid_status',
        },
        statusCode
      );
    }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    console.error(`[process-enhanced] Error getting report ${reportId}:`, {
      error: errorMessage,
      errorName,
      householdId,
      userId,
    });
    
    // Re-throw to let error handler deal with it
    throw error;
  }

  // Get report again after the try-catch (we know it exists and user has access)
  const reportService = new ReportService(c.env, c.env.DB);
  await reportService.getReport(householdId, reportId, userId);

  // Check that an Anthropic key is available for this user: their own connected
  // BYOK key when present, otherwise the SimpleHouse-managed key. The enhanced
  // processor issues a per-user credential lease downstream, so a BYOK-only user
  // (managed key absent) must NOT be blocked here.
  const { apiKey: anthropicApiKey } = await resolveProviderApiKey(c.env, userId, 'anthropic');
  console.log(`[process-enhanced] Checking Anthropic key: ${anthropicApiKey ? 'SET' : 'MISSING'}`);

  if (!anthropicApiKey) {
    console.error(`[process-enhanced] No Anthropic key available for report ${reportId}`);
    // Mark as failed immediately if API key not configured
    const reportService = new ReportService(c.env, c.env.DB);
    await reportService.markProcessingFailed(
      reportId,
      'AI processing is not configured. Please contact support.'
    );

    return c.json({
      error: 'Processing failed: AI service not configured',
      reportId,
      status: 'failed'
    }, 500);
  }

  // Process report synchronously with enhanced features
  console.log(`[process-enhanced] Starting synchronous enhanced processing for report ${reportId}`);

  try {
    const enhancedProcessor = new EnhancedPdfProcessorService(c.env, c.env.DB);
    await enhancedProcessor.processReportDirect(reportId);

    console.log(`[process-enhanced] Enhanced processing completed successfully for report ${reportId}`);

    // Get updated report
    const reportService = new ReportService(c.env, c.env.DB);
    const processedReport = await reportService.getReport(householdId, reportId, userId);

    return c.json({
      message: 'Enhanced processing completed successfully',
      report: processedReport
    }, 200);
  } catch (processingError) {
    if (processingError instanceof ReportProcessingConflictError) {
      return c.json(
        {
          error: processingError.message,
          reportId,
          status: processingError.currentStatus,
          code: 'already_processing_or_complete',
        },
        409
      );
    }

    const errorMessage = processingError instanceof Error ? processingError.message : 'Processing failed';
    const errorStack = processingError instanceof Error ? processingError.stack : undefined;

    console.error(`[process-enhanced] Enhanced processing failed for report ${reportId}:`, {
      error: errorMessage,
      stack: errorStack,
      reportId,
      householdId,
    });

    // Mark report as failed
    const reportService = new ReportService(c.env, c.env.DB);
    await reportService.markProcessingFailed(reportId, errorMessage);

    return c.json({
      error: 'Enhanced processing failed',
      message: errorMessage,
      reportId,
      status: 'failed'
    }, 500);
  }
});

/**
 * GET /households/:householdId/reports/:id/status
 * Get processing status for a report
 */
reports.get('/:id/status', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('id');
  const reportService = new ReportService(c.env, c.env.DB);

  const report = await reportService.getReport(householdId, reportId, userId);

  return c.json({
    status: report.status,
    processing_progress: report.processing_progress || 0,
    processing_stage: report.processing_stage || null,
    error_message: report.error_message || null,
  });
});

/**
 * GET /households/:householdId/reports/:id/summaries
 * Get persona-specific summaries for a report
 * Query param: type=novice|diy|technical|executive (optional, returns all if not specified)
 */
reports.get('/:id/summaries', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('id');
  const rawType = c.req.query('type');

  // Validate summary type
  const validTypes = ['novice', 'diy', 'technical', 'executive'];
  const summaryType = rawType && validTypes.includes(rawType)
    ? (rawType as 'novice' | 'diy' | 'technical' | 'executive')
    : undefined;

  const reportService = new ReportService(c.env, c.env.DB);

  // Verify user has access
  await reportService.getReport(householdId, reportId, userId);

  const summaries = await reportService.getSummaries(reportId, summaryType);

  return c.json({ summaries });
});

/**
 * GET /households/:householdId/reports
 * List reports for a household
 */
reports.get('/', zValidator('query', reportFiltersSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const filters = c.req.valid('query');
  const reportService = new ReportService(c.env, c.env.DB);

  const result = await reportService.listReports(householdId, userId, filters);

  return c.json(result);
});

/**
 * GET /households/:householdId/reports/:id
 * Get a single report
 */
reports.get('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('id');
  const reportService = new ReportService(c.env, c.env.DB);

  const report = await reportService.getReport(householdId, reportId, userId);

  return c.json({ report });
});

/**
 * GET /households/:householdId/reports/:id/pdf-url
 * Get authenticated PDF URL for viewing
 * Returns a time-limited URL that can be used to access the PDF file
 *
 * Rate limited: 60 requests per minute per user
 */
reports.get('/:id/pdf-url', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('id');
  const reportService = new ReportService(c.env, c.env.DB);

  const startTime = Date.now();

  try {
    // Verify user has access to this household's report
    const report = await reportService.getReport(householdId, reportId, userId);

    if (!report.file_size || report.file_size === 0) {
      console.warn(`[pdf-url] Report ${reportId} has no file`);
      return c.json({ error: 'Report file not found' }, 404);
    }

    // Validate file size is reasonable (warn if > 200MB)
    if (report.file_size > 200 * 1024 * 1024) {
      console.warn(`[pdf-url] Large PDF requested: ${reportId}, size: ${(report.file_size / (1024 * 1024)).toFixed(1)}MB`);
    }

    const pdfUrl = `${c.env.API_URL}/households/${householdId}/reports/${reportId}/pdf`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const duration = Date.now() - startTime;
    console.log(`[pdf-url] Success for report ${reportId} in ${duration}ms`);

    return c.json({
      url: pdfUrl,
      expires_at: expiresAt.toISOString(),
      page_count: report.page_count || 0,
      file_size: report.file_size,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Failed to get PDF URL';

    console.error(`[pdf-url] Error for report ${reportId} after ${duration}ms:`, {
      error: errorMessage,
      userId,
      householdId,
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (error instanceof Error && error.name === 'NotFoundError') {
      return c.json({ error: 'Report not found' }, 404);
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return c.json({ error: 'Access denied' }, 403);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * GET /households/:householdId/reports/:id/pdf
 * Stream PDF file with authentication
 * This endpoint streams the actual PDF content
 *
 * Features:
 * - Timeout protection (30s)
 * - Content-Range support for resumable downloads
 * - Rate limited to prevent abuse
 */
reports.get('/:id/pdf', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('id');
  const reportService = new ReportService(c.env, c.env.DB);

  const startTime = Date.now();

  try {
    // Verify user has access to this household's report
    const report = await reportService.getReport(householdId, reportId, userId);

    if (!report.file_size || report.file_size === 0) {
      console.warn(`[pdf] Report ${reportId} has no file`);
      return c.json({ error: 'Report file not found' }, 404);
    }

    // Validate file size (reject if > 500MB to prevent abuse)
    const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
    if (report.file_size > MAX_FILE_SIZE) {
      console.error(`[pdf] File too large: ${reportId}, size: ${(report.file_size / (1024 * 1024)).toFixed(1)}MB`);
      return c.json({
        error: 'PDF file is too large to stream',
        max_size_mb: 500,
        file_size_mb: (report.file_size / (1024 * 1024)).toFixed(1),
      }, 413);
    }

    // Get the file from R2
    const fileKey = await reportService.getReportFileKey(reportId);

    if (!fileKey) {
      console.error(`[pdf] No file_key found for report ${reportId}`);
      return c.json({ error: 'Report not found' }, 404);
    }

    // Fetch from R2 with timeout
    const R2_TIMEOUT_MS = 30000; // 30 seconds
    const object = await Promise.race([
      c.env.REPORTS_BUCKET.get(fileKey),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('R2 fetch timeout')), R2_TIMEOUT_MS)
      ),
    ]);

    if (!object) {
      console.error(`[pdf] File not found in R2: ${fileKey}`);
      return c.json({ error: 'PDF file not found in storage' }, 404);
    }

    // Validate object size matches database
    if (object.size !== report.file_size) {
      console.warn(`[pdf] Size mismatch for ${reportId}: DB=${report.file_size}, R2=${object.size}`);
    }

    // Handle Range requests (for resumable downloads)
    const rangeHeader = c.req.header('Range');
    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', 'application/pdf');
    responseHeaders.set('Cache-Control', 'private, max-age=3600');
    responseHeaders.set('Content-Disposition', `inline; filename="${report.filename}"`);
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('X-Content-Type-Options', 'nosniff');

    // If client supports range requests and sent a range header
    if (rangeHeader && object.range) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : object.size - 1;

        responseHeaders.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
        responseHeaders.set('Content-Length', (end - start + 1).toString());

        const duration = Date.now() - startTime;
        console.log(`[pdf] Streaming range ${start}-${end} for report ${reportId} in ${duration}ms`);

        return new Response(object.body, {
          status: 206, // Partial Content
          headers: responseHeaders,
        });
      }
    }

    // Full file response
    responseHeaders.set('Content-Length', object.size.toString());

    const duration = Date.now() - startTime;
    console.log(`[pdf] Streaming full file for report ${reportId} (${(object.size / (1024 * 1024)).toFixed(1)}MB) in ${duration}ms`);

    return new Response(object.body, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Failed to stream PDF';

    console.error(`[pdf] Error streaming report ${reportId} after ${duration}ms:`, {
      error: errorMessage,
      userId,
      householdId,
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (error instanceof Error && error.name === 'NotFoundError') {
      return c.json({ error: 'Report not found' }, 404);
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return c.json({ error: 'Access denied' }, 403);
    }
    if (error instanceof Error && error.message?.includes('timeout')) {
      return c.json({ error: 'Request timeout while fetching PDF' }, 504);
    }

    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * GET /households/:householdId/reports/:id/findings
 * Get findings for a report
 */
reports.get('/:id/findings', zValidator('query', findingFiltersSchema), async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('id');
  const filters = c.req.valid('query');
  const reportService = new ReportService(c.env, c.env.DB);

  const result = await reportService.getFindings(householdId, reportId, userId, filters);

  return c.json(result);
});

/**
 * GET /households/:householdId/reports/:id/action-plans
 * Get action plans for a report
 */
reports.get('/:id/action-plans', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('id');
  const reportService = new ReportService(c.env, c.env.DB);

  const actionPlans = await reportService.getActionPlans(householdId, reportId, userId);

  return c.json({ action_plans: actionPlans });
});

/**
 * DELETE /households/:householdId/reports/:id
 * Delete a report (owner only)
 */
reports.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const householdId = getHouseholdId(c);
  const reportId = c.req.param('id');
  const reportService = new ReportService(c.env, c.env.DB);

  await reportService.deleteReport(householdId, reportId, userId);

  return c.body(null, 204);
});

export default reports;
