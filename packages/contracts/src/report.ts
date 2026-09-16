import { z } from 'zod';

/** Lean report row for GET /households/:id/reports list (hot path). */
export const reportListItemSchema = z.object({
  id: z.string(),
  household_id: z.string(),
  filename: z.string(),
  file_size: z.number().int(),
  status: z.enum(['pending_upload', 'uploaded', 'processing', 'completed', 'failed']),
  error_message: z.string().nullable(),
  page_count: z.number().int().nullable(),
  inspection_date: z.string().nullable(),
  inspector_name: z.string().nullable(),
  property_address: z.string().nullable(),
  processing_progress: z.number().nullable().optional(),
  processing_stage: z.string().nullable().optional(),
  total_findings_count: z.number().int().nullable().optional(),
  critical_findings_count: z.number().int().nullable().optional(),
  uploaded_by: z.object({
    id: z.string(),
    display_name: z.string().nullable(),
  }),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ReportListItem = z.infer<typeof reportListItemSchema>;

/** GET /households/:id/reports response envelope. */
export const reportsListResponseSchema = z.object({
  reports: z.array(reportListItemSchema),
  next_cursor: z.string().optional(),
});

export type ReportsListResponse = z.infer<typeof reportsListResponseSchema>;

/** GET /households/:id/reports/:reportId response envelope. */
export const reportDetailResponseSchema = z.object({
  report: reportListItemSchema,
});

export type ReportDetailResponse = z.infer<typeof reportDetailResponseSchema>;
