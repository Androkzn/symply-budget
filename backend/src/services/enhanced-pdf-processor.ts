import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';
import type { Database, Env } from '../types';
import { generateId, now } from '../utils/id';

import { isReportPipelinePaused } from './config-flags';
import { NotificationService } from './notification-service';

/** Statuses eligible for process-enhanced CAS (initial upload + retry after failure). */
export const REPROCESSABLE_REPORT_STATUSES = ['uploaded', 'failed'] as const;

/**
 * How long a report may sit in `processing` before the cron sweep marks it
 * failed. Lambda max runtime is 15min; pad to 45min so slow callbacks are not
 * preempted while still recovering dropped callbacks within ~1hr.
 */
export const STUCK_PROCESSING_GRACE_MS = 45 * 60 * 1000;

const STUCK_PROCESSING_SENTINEL = 'report_stuck_in_processing';

export class ReportProcessingConflictError extends Error {
  constructor(public readonly currentStatus: string) {
    super(`Report cannot be processed in ${currentStatus} status`);
    this.name = 'ReportProcessingConflictError';
  }
}

export interface SweepStuckProcessingReportsResult {
  scanned: number;
  reconciled: number;
  skipped?: 'paused';
}

function reportStuckCutoffExpr(cutoffIso: string) {
  return lte(
    sql`COALESCE(${schema.reports.processing_started_at}, ${schema.reports.updated_at})`,
    cutoffIso
  );
}

/**
 * Enhanced PDF Processing Service with Claude Native PDF Support
 *
 * This service orchestrates the AI-powered processing of inspection reports:
 * 1. Validates and stores PDFs in R2
 * 2. Creates processing jobs
 * 3. Invokes AWS Lambda for heavy processing
 * 4. Tracks progress and handles errors
 */
export class EnhancedPdfProcessorService {
  private db: Database;
  private env: Env;
  private notificationService: NotificationService;

  constructor(env: Env, d1: D1Database) {
    this.db = drizzle(d1, { schema });
    this.env = env;
    this.notificationService = new NotificationService(env, d1);
  }

  /**
   * Process report with Claude's native PDF support (for files <32MB)
   * This is the fast path - no extraction needed!
   */
  async processReportDirect(reportId: string): Promise<void> {
    console.log(`[PDF-PROCESSOR] Starting processReportDirect for report ${reportId}`);
    const startTime = Date.now();
    
    const report = await this.getReport(reportId);
    console.log(`[PDF-PROCESSOR] Report ${reportId} fetched in ${Date.now() - startTime}ms`);

    if (!report) {
      console.error(`[PDF-PROCESSOR] Report ${reportId} not found in database`);
      throw new Error(`Report ${reportId} not found`);
    }

    console.log(`[PDF-PROCESSOR] Report ${reportId} details:`, {
      filename: report.filename,
      file_size: report.file_size,
      file_key: report.file_key,
      status: report.status,
      household_id: report.household_id,
    });

    // Always use Lambda for processing to avoid Worker CPU timeout issues
    // Lambda has longer execution time (15 min) and more memory
    // This ensures reliable processing for all file sizes and includes:
    // - PDF processing with Claude
    // - Task draft generation
    // - Home features extraction
    // - Maintenance suggestion creation
    const fileSizeMB = (report.file_size || 0) / (1024 * 1024);

    console.log(`[PDF-PROCESSOR] Report ${reportId}: PDF size is ${fileSizeMB.toFixed(2)}MB, delegating to Lambda for reliable processing`);

    await this.claimReportForProcessing(reportId);

    try {
      await this.invokeLambdaProcessing(reportId, report.file_key);
      console.log(`[PDF-PROCESSOR] Report ${reportId}: Lambda processing completed successfully`);
    } catch (lambdaError) {
      console.error(`[PDF-PROCESSOR] Report ${reportId}: Lambda processing failed:`, lambdaError);
      throw lambdaError;
    }
  }

  /**
   * Invoke AWS Lambda for processing large files (>32MB)
   */
  async invokeLambdaProcessing(reportId: string, fileKey: string): Promise<void> {
    console.log(`[LAMBDA] Starting Lambda invocation for report ${reportId}, fileKey: ${fileKey}`);
    
    // Validate AWS configuration
    const hasLambdaArn = !!this.env.AWS_LAMBDA_ARN;
    const hasAccessKey = !!this.env.AWS_ACCESS_KEY_ID;
    const hasSecretKey = !!this.env.AWS_SECRET_ACCESS_KEY;
    
    console.log(`[LAMBDA] AWS config check - ARN: ${hasLambdaArn}, AccessKey: ${hasAccessKey}, SecretKey: ${hasSecretKey}`);
    
    if (!hasLambdaArn || !hasAccessKey || !hasSecretKey) {
      const missing = [];
      if (!hasLambdaArn) missing.push('AWS_LAMBDA_ARN');
      if (!hasAccessKey) missing.push('AWS_ACCESS_KEY_ID');
      if (!hasSecretKey) missing.push('AWS_SECRET_ACCESS_KEY');
      console.error(`[LAMBDA] Missing AWS config: ${missing.join(', ')}`);
      throw new Error(`AWS Lambda configuration missing: ${missing.join(', ')}`);
    }

    await this.updateReportStatus(reportId, 'processing', {
      processing_stage: 'queued_for_lambda',
      processing_progress: 15,
    });

    const report = await this.getReport(reportId);
    if (!report) {
      console.error(`[LAMBDA] Report ${reportId} not found when preparing Lambda payload`);
      throw new Error(`Report ${reportId} not found`);
    }

    // Resolve AI actor for Lambda (managed Anthropic default; BYOK when entitled).
    // For a BYOK actor we mint a one-time, job-bound credential lease: the Lambda
    // exchanges `leaseToken` at POST /internal/ai-credential-leases/consume for the
    // decrypted user key — the key itself never rides in the payload (§18.5).
    const jobId = generateId();
    let aiProvider = 'anthropic';
    const selectedModelId: string | null = null;
    let managedOnly = true;
    let leaseToken: string | null = null;
    try {
      const { resolveAIEntitlement } = await import('./entitlement-service');
      const uploaderId = report.uploaded_by;
      if (uploaderId) {
        const entitlement = await resolveAIEntitlement(uploaderId, this.env);
        if (entitlement.allowed) {
          aiProvider = entitlement.provider;
          managedOnly = entitlement.source === 'simplehouse';
          if (entitlement.source === 'byok') {
            const { issueCredentialLease } = await import('./ai-credential-resolver');
            const lease = await issueCredentialLease(this.env, {
              userId: uploaderId,
              jobId,
              provider: entitlement.provider,
              selectedModelId,
              requiredCapability: 'pdf_understanding',
            });
            leaseToken = lease?.token ?? null;
          }
        }
      }
    } catch (err) {
      console.warn(
        `[LAMBDA] entitlement resolve failed for report ${reportId}, defaulting anthropic:`,
        err instanceof Error ? err.message : err
      );
    }

    const reportsBucket = this.env.REPORTS_BUCKET_NAME;
    if (!reportsBucket) {
      throw new Error('REPORTS_BUCKET_NAME is not configured');
    }

    // Prepare Lambda payload — bucket + callback URL come from the invoking Worker
    // so a shared Lambda ARN can serve House, Budget, Kaizen, and Health.
    const payload = {
      jobId,
      reportId: reportId,
      householdId: report.household_id,
      pdfS3Bucket: reportsBucket,
      pdfS3Key: fileKey,
      workerApiBase: this.env.API_URL,
      aiProvider,
      selectedModelId,
      managedOnly,
      leaseToken,
    };

    console.log(`[LAMBDA] Invoking Lambda for report ${reportId} with payload:`, JSON.stringify(payload));

    try {
      // Invoke Lambda using AWS Signature V4
      const region = this.env.AWS_REGION || 'us-east-1';
      const functionName = (this.env.AWS_LAMBDA_ARN ?? '').split(':').pop() || 'inspection-report-processor';
      
      console.log(`[LAMBDA] Using region: ${region}, functionName: ${functionName}`);
      console.log(`[LAMBDA] Full ARN: ${this.env.AWS_LAMBDA_ARN}`);

      const response = await this.invokeLambdaWithSignature(
        functionName,
        region,
        payload
      );

      console.log(`[LAMBDA] Lambda response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[LAMBDA] Lambda invocation failed - Status: ${response.status}, Body: ${errorText}`);
        throw new Error(`Lambda invocation failed: ${response.status} - ${errorText}`);
      }

      const responseText = await response.text();
      console.log(`[LAMBDA] Lambda invocation successful for report ${reportId}, response: ${responseText || '(empty)'}`);

      // Lambda runs asynchronously, so we just confirm it was invoked
      // The Lambda will update the report status when processing completes
      await this.updateReportProgress(reportId, 20, 'processing_in_lambda');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error(`[LAMBDA] Lambda invocation failed for report ${reportId}:`, {
        error: errorMessage,
        stack: errorStack,
      });
      
      await this.updateReportStatus(reportId, 'failed', {
        error_message: errorMessage,
      });

      // Send failure notification for Lambda errors
      try {
        if (report.uploaded_by) {
          await this.notificationService.sendNotification({
            userId: report.uploaded_by,
            type: 'report_ready',
            title: 'Report Processing Failed',
            body: `We couldn't process your report "${report.filename}". The file may be too large or corrupted.`,
            data: {
              reportId: reportId,
              householdId: report.household_id,
              screen: 'Reports',
            },
            referenceType: 'report',
            referenceId: reportId,
          });
        }
      } catch (notifError) {
        console.error('[LAMBDA] Failed to send report failure notification:', notifError);
      }

      throw error;
    }
  }

  /**
   * Invoke Lambda using AWS Signature V4 (no SDK required)
   */
  private async invokeLambdaWithSignature(
    functionName: string,
    region: string,
    payload: object
  ): Promise<Response> {
    const service = 'lambda';
    const host = `lambda.${region}.amazonaws.com`;
    const endpoint = `https://${host}/2015-03-31/functions/${functionName}/invocations`;
    const method = 'POST';
    const body = JSON.stringify(payload);

    // Get current time for signing
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    // Create canonical request
    const canonicalUri = `/2015-03-31/functions/${functionName}/invocations`;
    const canonicalQuerystring = '';
    const payloadHash = await this.sha256(body);

    const canonicalHeaders =
      `content-type:application/json\n` +
      `host:${host}\n` +
      `x-amz-date:${amzDate}\n` +
      `x-amz-invocation-type:Event\n`; // Async invocation

    const signedHeaders = 'content-type;host;x-amz-date;x-amz-invocation-type';

    const canonicalRequest =
      `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    // Create string to sign
    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const canonicalRequestHash = await this.sha256(canonicalRequest);
    const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

    // Calculate signature
    const signingKey = await this.getSignatureKey(
      this.env.AWS_SECRET_ACCESS_KEY!,
      dateStamp,
      region,
      service
    );
    const signature = await this.hmacHex(signingKey, stringToSign);

    // Create authorization header
    const authorizationHeader =
      `${algorithm} Credential=${this.env.AWS_ACCESS_KEY_ID}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    // Make request
    return fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Host': host,
        'X-Amz-Date': amzDate,
        'X-Amz-Invocation-Type': 'Event', // Async invocation
        'Authorization': authorizationHeader,
      },
      body,
    });
  }

  /**
   * SHA256 hash helper
   */
  private async sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * HMAC-SHA256 helper returning hex string
   */
  private async hmacHex(key: ArrayBuffer, message: string): Promise<string> {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      new TextEncoder().encode(message)
    );
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * HMAC-SHA256 helper returning ArrayBuffer
   */
  private async hmac(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
    const keyBuffer = typeof key === 'string'
      ? new TextEncoder().encode(key)
      : key;
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    return crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      new TextEncoder().encode(message)
    );
  }

  /**
   * Generate AWS signature key
   */
  private async getSignatureKey(
    secretKey: string,
    dateStamp: string,
    region: string,
    service: string
  ): Promise<ArrayBuffer> {
    const kDate = await this.hmac('AWS4' + secretKey, dateStamp);
    const kRegion = await this.hmac(kDate, region);
    const kService = await this.hmac(kRegion, service);
    return this.hmac(kService, 'aws4_request');
  }

  /**
   * Atomically claim a report for processing. Only succeeds when status is
   * `uploaded` or `failed` (retry). Refuses concurrent/double-tap invocations.
   */
  private async claimReportForProcessing(reportId: string): Promise<void> {
    const ts = now();
    const claimResult = await this.db
      .update(schema.reports)
      .set({
        status: 'processing',
        processing_started_at: ts,
        processing_stage: 'delegating_to_lambda',
        processing_progress: 5,
        error_message: null,
        updated_at: ts,
      })
      .where(
        and(
          eq(schema.reports.id, reportId),
          inArray(schema.reports.status, [...REPROCESSABLE_REPORT_STATUSES])
        )
      )
      .run();

    const changes =
      (claimResult as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
    if (changes === 0) {
      const existing = await this.getReport(reportId);
      throw new ReportProcessingConflictError(existing?.status ?? 'unknown');
    }
  }

  /**
   * Update report status
   */
  private async updateReportStatus(
    reportId: string,
    status: string,
    additionalFields?: Record<string, any>
  ): Promise<void> {
    await this.db
      .update(schema.reports)
      .set({
        status,
        updated_at: now(),
        ...additionalFields,
      })
      .where(eq(schema.reports.id, reportId));
  }

  /**
   * Update report processing progress
   */
  private async updateReportProgress(
    reportId: string,
    progress: number,
    stage: string
  ): Promise<void> {
    await this.db
      .update(schema.reports)
      .set({
        processing_progress: progress,
        processing_stage: stage,
        updated_at: now(),
      })
      .where(eq(schema.reports.id, reportId));
  }

  /**
   * Get report by ID
   */
  private async getReport(reportId: string) {
    return this.db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, reportId))
      .get();
  }

}

/**
 * Reconcile reports stuck in `processing` past the grace window (dropped Lambda
 * callback / Worker crash). Marks them failed and notifies the uploader.
 * Never throws. Respects CONFIG_KV `report_pipeline_paused`.
 */
export async function sweepStuckProcessingReports(
  env: Env,
  nowDate: Date = new Date(),
  graceMs: number = STUCK_PROCESSING_GRACE_MS
): Promise<SweepStuckProcessingReportsResult> {
  if (await isReportPipelinePaused(env)) {
    return { scanned: 0, reconciled: 0, skipped: 'paused' };
  }

  const db = drizzle(env.DB, { schema }) as unknown as Database;
  const notificationService = new NotificationService(env, env.DB);
  const cutoffIso = new Date(nowDate.getTime() - graceMs).toISOString();
  const ts = now();

  let stuck: (typeof schema.reports.$inferSelect)[] = [];
  try {
    stuck = await db
      .select()
      .from(schema.reports)
      .where(
        and(
          eq(schema.reports.status, 'processing'),
          reportStuckCutoffExpr(cutoffIso),
          isNull(schema.reports.deleted_at)
        )
      )
      .all();
  } catch (err) {
    console.error('[report-sweep] scan failed', { error: (err as Error).message });
    return { scanned: 0, reconciled: 0 };
  }

  if (stuck.length === 0) {
    return { scanned: 0, reconciled: 0 };
  }

  let reconciled = 0;
  for (const row of stuck) {
    let rowChanges = 0;
    try {
      const updateResult = await db
        .update(schema.reports)
        .set({
          status: 'failed',
          error_message: row.error_message ?? STUCK_PROCESSING_SENTINEL,
          updated_at: ts,
        })
        .where(
          and(
            eq(schema.reports.id, row.id),
            eq(schema.reports.status, 'processing'),
            reportStuckCutoffExpr(cutoffIso)
          )
        )
        .run();
      rowChanges =
        (updateResult as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
    } catch (err) {
      console.warn('[report-sweep] row update failed', {
        reportId: row.id.slice(0, 8),
        error: (err as Error).message,
      });
      continue;
    }

    if (rowChanges === 0) {
      continue;
    }

    try {
      if (!row.uploaded_by) continue;
      await notificationService.sendNotification({
        userId: row.uploaded_by,
        type: 'report_ready',
        title: 'Report Processing Failed',
        body: `We couldn't finish processing your report "${row.filename}". Please try again.`,
        data: {
          reportId: row.id,
          householdId: row.household_id,
          screen: 'Reports',
        },
        referenceType: 'report',
        referenceId: row.id,
      });
    } catch (err) {
      console.warn('[report-sweep] push send failed (non-fatal)', {
        reportId: row.id.slice(0, 8),
        error: (err as Error).message,
      });
    }

    reconciled += 1;
  }

  if (stuck.length) {
    console.info('[report-sweep] reconciled', {
      scanned: stuck.length,
      reconciled,
      cutoffIso,
    });
  }

  return { scanned: stuck.length, reconciled };
}
