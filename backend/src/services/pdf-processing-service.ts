import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import type { ExtractedFinding, ReportChunk, ReportMetadata } from '../ai/provider';
import { createProviderAdapter } from '../ai/provider-factory';
import * as schema from '../db/schema';
import type { Database, Env } from '../types';
import { generateId, now } from '../utils/id';

import { resolveProviderApiKey } from './ai-credential-resolver';
import { usageRecorderFor } from './ai-usage-service';
import { NotificationService } from './notification-service';

// Section patterns for home inspection reports
const SECTION_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /^\s*(roof|roofing)/i, type: 'roof' },
  { pattern: /^\s*(foundation|basement|crawl\s*space)/i, type: 'foundation' },
  { pattern: /^\s*(electrical|wiring|panel)/i, type: 'electrical' },
  { pattern: /^\s*(plumbing|water\s*heater|pipes)/i, type: 'plumbing' },
  { pattern: /^\s*(hvac|heating|cooling|air\s*condition)/i, type: 'hvac' },
  { pattern: /^\s*(exterior|siding|trim)/i, type: 'exterior' },
  { pattern: /^\s*(interior|walls|ceilings|floors)/i, type: 'interior' },
  { pattern: /^\s*(safety|smoke|carbon\s*monoxide|fire)/i, type: 'safety' },
  { pattern: /^\s*(appliances|kitchen)/i, type: 'appliances' },
  { pattern: /^\s*(drainage|grading|gutters)/i, type: 'drainage' },
  { pattern: /^\s*(attic|insulation)/i, type: 'attic' },
  { pattern: /^\s*(garage)/i, type: 'garage' },
  { pattern: /^\s*(windows|doors)/i, type: 'windows_doors' },
  { pattern: /^\s*(structure|structural)/i, type: 'structure' },
  { pattern: /^\s*(summary|executive|overview)/i, type: 'summary' },
];

export class PdfProcessingService {
  private db: Database;
  private env: Env;
  private userId: string | null;
  private notificationService: NotificationService;

  constructor(env: Env, d1: D1Database, userId?: string | null) {
    this.db = drizzle(d1, { schema });
    this.env = env;
    // Bill report inference to the acting user's own Gemini key when connected (BYOK).
    this.userId = userId ?? null;
    this.notificationService = new NotificationService(env, d1);
  }

  /**
   * Process a report synchronously (fallback when queue is not available)
   */
  async processReportSync(reportId: string): Promise<void> {
    const report = await this.db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, reportId))
      .get();

    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }

    // Update job status
    const job = await this.db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.report_id, reportId))
      .get();

    if (job) {
      await this.db
        .update(schema.processingJobs)
        .set({
          status: 'processing',
          started_at: now(),
          attempts: job.attempts + 1,
          updated_at: now(),
        })
        .where(eq(schema.processingJobs.id, job.id));
    }

    try {
      // Step 1: Extract text from PDF
      const pdfText = await this.extractTextFromPdf(report.file_key);

      // Step 2: Chunk the text
      const chunks = this.chunkText(pdfText, reportId);

      // Step 3: Store chunks
      await this.storeChunks(reportId, chunks);

      // Step 4: Extract findings using AI
      const findings = await this.extractFindings(chunks);

      // Step 5: Store findings
      await this.storeFindings(reportId, findings);

      // Step 6: Generate and store action plans
      const household = await this.db
        .select()
        .from(schema.households)
        .where(eq(schema.households.id, report.household_id))
        .get();

      const country = (household?.country as 'CA' | 'US') || 'US';
      await this.generateAndStoreActionPlans(reportId, report.household_id, findings, country);

      // Step 7: Update report status
      await this.db
        .update(schema.reports)
        .set({
          status: 'completed',
          processing_completed_at: now(),
          updated_at: now(),
        })
        .where(eq(schema.reports.id, reportId));

      // Update job status
      if (job) {
        await this.db
          .update(schema.processingJobs)
          .set({
            status: 'completed',
            completed_at: now(),
            updated_at: now(),
          })
          .where(eq(schema.processingJobs.id, job.id));
      }

      // Step 8: Send notification to the user who uploaded the report
      try {
        const findingsCount = findings.length;
        const criticalCount = findings.filter(f => f.severity === 'critical' || (f.severity as string) === 'safety').length;
        
        let notificationBody = `Your inspection report "${report.filename}" has been processed.`;
        if (findingsCount > 0) {
          notificationBody += ` Found ${findingsCount} item${findingsCount > 1 ? 's' : ''}`;
          if (criticalCount > 0) {
            notificationBody += ` (${criticalCount} critical)`;
          }
          notificationBody += '.';
        }

        if (report.uploaded_by) {
          await this.notificationService.sendNotification({
            userId: report.uploaded_by,
            type: 'report_ready',
            title: 'Report Ready',
            body: notificationBody,
            data: {
              reportId: reportId,
              householdId: report.household_id,
              screen: 'ReportDetail',
            },
            referenceType: 'report',
            referenceId: reportId,
          });
        }
      } catch (notifError) {
        // Don't fail the processing if notification fails
        console.error('Failed to send report ready notification:', notifError);
      }
    } catch (error) {
      console.error('PDF processing failed:', error);

      // Update report status to failed
      await this.db
        .update(schema.reports)
        .set({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          updated_at: now(),
        })
        .where(eq(schema.reports.id, reportId));

      // Update job status
      if (job) {
        await this.db
          .update(schema.processingJobs)
          .set({
            status: 'failed',
            last_error: error instanceof Error ? error.message : 'Unknown error',
            updated_at: now(),
          })
          .where(eq(schema.processingJobs.id, job.id));
      }

      // Send failure notification
      try {
        if (!report.uploaded_by) {
          // Actor cleared (DATA-6 SET NULL) — skip notify.
        } else await this.notificationService.sendNotification({
          userId: report.uploaded_by,
          type: 'report_ready',
          title: 'Report Processing Failed',
          body: `We couldn't process your report "${report.filename}". Please try uploading it again.`,
          data: {
            reportId: reportId,
            householdId: report.household_id,
            screen: 'Reports',
          },
          referenceType: 'report',
          referenceId: reportId,
        });
      } catch (notifError) {
        console.error('Failed to send report failure notification:', notifError);
      }

      throw error;
    }
  }

  /**
   * Extract text from PDF stored in R2
   * Note: In production, you'd use a proper PDF parsing library like pdf-parse
   * For Cloudflare Workers, we need to use a simpler approach or external service
   */
  private async extractTextFromPdf(fileKey: string): Promise<string> {
    const object = await this.env.REPORTS_BUCKET.get(fileKey);
    if (!object) {
      throw new Error('PDF file not found in storage');
    }

    const arrayBuffer = await object.arrayBuffer();

    // Simple text extraction - in production, use proper PDF parsing
    // This is a placeholder that extracts visible text patterns
    const bytes = new Uint8Array(arrayBuffer);
    let text = '';

    // Try to find text streams in PDF
    // This is a basic implementation - for production, use pdf.js or similar
    const decoder = new TextDecoder('utf-8');
    const rawText = decoder.decode(bytes);

    // Extract text between BT (begin text) and ET (end text) markers
    const textMatches = rawText.match(/BT[\s\S]*?ET/g) || [];
    for (const match of textMatches) {
      // Extract text from Tj and TJ operators
      const tjMatches = match.match(/\(([^)]+)\)\s*Tj/g) || [];
      for (const tj of tjMatches) {
        const textContent = tj.match(/\(([^)]+)\)/);
        if (textContent) {
          text += textContent[1] + ' ';
        }
      }
    }

    // If no text found via PDF operators, try plain text extraction
    if (!text.trim()) {
      // Look for readable ASCII sequences
      const readableChars: string[] = [];
      let currentWord = '';

      for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];
        // Printable ASCII range
        if (byte >= 32 && byte <= 126) {
          currentWord += String.fromCharCode(byte);
        } else if (currentWord.length > 3) {
          // Keep words longer than 3 chars
          readableChars.push(currentWord);
          currentWord = '';
        } else {
          currentWord = '';
        }
      }

      text = readableChars.join(' ');
    }

    // Clean up the text
    text = text
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\n]/g, '')
      .trim();

    if (!text || text.length < 100) {
      // Return a placeholder message if extraction fails
      // In production, you'd want to use a more robust PDF parsing solution
      return `[PDF text extraction limited in current environment. File: ${fileKey}]

This inspection report requires manual review or processing through an external PDF service.
The AI analysis will be based on the available extracted content.`;
    }

    return text;
  }

  /**
   * Chunk text into manageable pieces with semantic awareness
   */
  private chunkText(text: string, _reportId: string): ReportChunk[] {
    const chunks: ReportChunk[] = [];
    const lines = text.split('\n');

    let currentChunk = '';
    let currentSection: string | null = null;
    let chunkIndex = 0;
    let currentPage = 1;

    const maxChunkSize = 4000; // Characters per chunk

    for (const line of lines) {
      // Check for page markers
      const pageMatch = line.match(/page\s*(\d+)/i);
      if (pageMatch) {
        currentPage = parseInt(pageMatch[1], 10);
      }

      // Check for section headers
      for (const { pattern, type } of SECTION_PATTERNS) {
        if (pattern.test(line)) {
          // Save current chunk if it has content
          if (currentChunk.trim()) {
            chunks.push({
              chunk_index: chunkIndex++,
              page_number: currentPage,
              section_type: currentSection,
              content: currentChunk.trim(),
            });
            currentChunk = '';
          }
          currentSection = type;
          break;
        }
      }

      currentChunk += line + '\n';

      // Split if chunk gets too large
      if (currentChunk.length > maxChunkSize) {
        chunks.push({
          chunk_index: chunkIndex++,
          page_number: currentPage,
          section_type: currentSection,
          content: currentChunk.trim(),
        });
        currentChunk = '';
      }
    }

    // Don't forget the last chunk
    if (currentChunk.trim()) {
      chunks.push({
        chunk_index: chunkIndex,
        page_number: currentPage,
        section_type: currentSection,
        content: currentChunk.trim(),
      });
    }

    return chunks;
  }

  /**
   * Store chunks in database
   */
  private async storeChunks(reportId: string, chunks: ReportChunk[]): Promise<void> {
    for (const chunk of chunks) {
      await this.db.insert(schema.reportChunks).values({
        id: generateId(),
        report_id: reportId,
        chunk_index: chunk.chunk_index,
        page_number: chunk.page_number,
        section_type: chunk.section_type,
        content: chunk.content,
        created_at: now(),
      });
    }
  }

  /**
   * Extract findings using AI
   */
  private async extractFindings(chunks: ReportChunk[]): Promise<ExtractedFinding[]> {
    // Bind inference to the acting user's own Gemini key (BYOK) when connected,
    // otherwise the SimpleHouse-managed key. Always construct via the AI port (CA-2).
    const { apiKey } = await resolveProviderApiKey(this.env, this.userId, 'gemini');
    const aiProvider = createProviderAdapter({
      provider: 'gemini',
      apiKey,
      options: {
        onUsage: usageRecorderFor(this.env, {
          feature: 'report_processing',
          userId: this.userId,
        }),
      },
    });

    if (!aiProvider.isAvailable()) {
      console.warn('AI provider not available, returning empty findings');
      return [];
    }

    try {
      return await aiProvider.extractFindings({
        chunks,
        promptVersion: 'v1',
      });
    } catch (error) {
      console.error('AI extraction failed:', error);
      return [];
    }
  }

  /**
   * Store findings in database
   */
  private async storeFindings(reportId: string, findings: ExtractedFinding[]): Promise<void> {
    for (const finding of findings) {
      await this.db.insert(schema.findings).values({
        id: generateId(),
        report_id: reportId,
        system_category: finding.system_category,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        plain_language_summary: finding.plain_language_summary,
        ai_confidence: finding.confidence,
        evidence_page_numbers: JSON.stringify(finding.evidence.page_numbers),
        raw_ai_output: JSON.stringify(finding),
        created_at: now(),
        updated_at: now(),
      });
    }
  }

  /**
   * No-op: action_plans/action_items tables were removed; task_drafts are created via the webhook flow instead.
   */
   
  private async generateAndStoreActionPlans(
    _reportId: string,
    _householdId: string,
    _findings: ExtractedFinding[],
    _country: 'CA' | 'US'
  ): Promise<void> {}

  /**
   * Get report metadata for AI processing
   */
  async getReportMetadata(reportId: string): Promise<ReportMetadata> {
    const report = await this.db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, reportId))
      .get();

    if (!report) {
      throw new Error('Report not found');
    }

    return {
      filename: report.filename,
      page_count: report.page_count,
      property_address: report.property_address,
      inspection_date: report.inspection_date,
      inspector_name: report.inspector_name,
    };
  }
}
