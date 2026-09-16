/**
 * Inspection-report tools — list + read reports uploaded to the household.
 * Upload itself stays a manual step (file picker / share sheet), but AI can
 * show what's on file and summarize a specific report.
 */
import { z } from 'zod';

import { ReportService } from '../../../report-service';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

const REPORT_STATUSES = [
  'pending_upload',
  'uploaded',
  'processing',
  'completed',
  'failed',
] as const;

function reportService(ctx: AihousekeeperToolContext): ReportService {
  return new ReportService(ctx.env, ctx.env.DB);
}

export const listReports: AihousekeeperTool = {
  name: 'list_reports',
  kind: 'READ',
  description:
    'List inspection reports uploaded to this household. Use when the user asks "what reports do we have", "show me the last inspection", or before opening a specific report by title. Supports filtering by processing status.',
  input: z.object({
    status: z.enum(REPORT_STATUSES).optional(),
    limit: z.number().int().positive().max(50).optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const { reports, next_cursor } = await reportService(ctx).listReports(
      ctx.householdId,
      ctx.userId,
      input
    );
    return {
      ok: true,
      count: reports.length,
      has_more: Boolean(next_cursor),
      reports: reports.map((r) => ({
        id: r.id,
        filename: r.filename,
        status: r.status,
        inspection_date: r.inspection_date,
        inspector_name: r.inspector_name,
        property_address: r.property_address,
        page_count: r.page_count,
        uploaded_at: r.created_at,
      })),
    };
  },
};

export const getReport: AihousekeeperTool = {
  name: 'get_report',
  kind: 'READ',
  description:
    'Get details of a single inspection report by id. Resolve report_id from list_reports first — never ask the user for an id.',
  input: z.object({
    report_id: z.string().min(1),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    try {
      const report = await reportService(ctx).getReport(
        ctx.householdId,
        input.report_id,
        ctx.userId
      );
      return {
        ok: true,
        report: {
          id: report.id,
          filename: report.filename,
          status: report.status,
          inspection_date: report.inspection_date,
          inspector_name: report.inspector_name,
          property_address: report.property_address,
          page_count: report.page_count,
          error_message: report.error_message,
          uploaded_at: report.created_at,
          uploaded_by: report.uploaded_by,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'report_not_found',
      };
    }
  },
};

export const reportTools: readonly AihousekeeperTool[] = [listReports, getReport] as const;
