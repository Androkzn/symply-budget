/**
 * Aihousekeeper attachment routing tool — plan §v3.1 schema-aihousekeeper comment on
 * `aihousekeeper_attachments`:
 *
 *   "Classification happens via the `classify_and_save_attachment` Aihousekeeper
 *    tool: for `report`/`floor_plan` the file is copied into the domain
 *    bucket and `linked_entity_*` points at the new row; other kinds stay
 *    in place."
 *
 * classify_and_save_attachment(attachment_index, kind, metadata?) → HIGH_WRITE
 *
 * The user attaches a file in the chat (image from gallery/camera, or a
 * document from Files). The chat route injects an <attachments> block into
 * the model context that references each file by positional index — the
 * real UUID is NEVER exposed to Claude (see Fix Plan — Aihousekeeper Clarification
 * Questions and ID Leak, §4.A). The tool resolves index → id via
 * ctx.attachmentOrder.
 *
 * For kind='floor_plan' the tool also runs a SHA-256 content-hash dedup
 * check against existing floor_plans rows on the household. If a match is
 * found it returns `error: 'duplicate_detected'` with a user-facing hint;
 * Aihousekeeper asks the user whether to attach anyway and retries with
 * metadata.allow_duplicate=true.
 *
 * Scoped to all 5 chat modes since attachments are universal.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { aihousekeeperAttachments } from '../../../../db/schema-aihousekeeper';
import { floorPlans } from '../../../../db/schema-floor-plans';
import { sha256Hex } from '../../../aihousekeeper/event-bus';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

/**
 * Metadata is all optional — Aihousekeeper fills what it can from the conversation
 * and the executor falls back to sensible defaults for the rest.
 */
const metadataSchema = z
  .object({
    // report
    inspector_name: z.string().max(200).optional(),
    inspection_date: z.string().max(40).optional(),
    property_address: z.string().max(500).optional(),
    // floor_plan (indoor)
    building_name: z.string().max(120).optional(),
    floor_number: z.number().int().optional(),
    floor_label: z.string().max(80).optional(),
    // receipt (utility bill)
    bill_type: z
      .enum(['electricity', 'gas', 'water', 'sewer', 'garbage', 'other'])
      .optional(),
    provider: z.string().max(200).optional(),
    amount_cents: z.number().int().nonnegative().optional(),
    due_date: z.string().max(40).optional(),
    billing_period_start: z.string().max(40).optional(),
    billing_period_end: z.string().max(40).optional(),
    // quote (contractor)
    contractor_id: z.string().min(1).optional(),
    quote_summary: z.string().max(2000).optional(),
    // Explicit override when the user confirms "attach anyway" after a
    // duplicate_detected result for floor_plan.
    allow_duplicate: z.boolean().optional(),
  })
  .optional();

export const classifyAndSaveAttachment: AihousekeeperTool = {
  name: 'classify_and_save_attachment',
  kind: 'HIGH_WRITE',
  description:
    'File a user-attached image or document to the correct household record. Reference the attachment by its positional index (0-based) from the <attachments> block in the user message. Call AFTER the user has confirmed the kind (report, floor_plan, receipt, quote, photo, or note). For floor_plan (indoor home plans) include metadata.floor_label and metadata.building_name. Note: yard/garden/bed plans are added separately in the Gardening tab, not via this tool. If this returns { ok: false, error: "duplicate_detected" }, tell the user what was already attached and ask "attach anyway?"; on confirm, retry with metadata.allow_duplicate=true. Parks for approval; on approve, the attachment is routed to reports/floor_plans/utility_bills/contractor_messages or kept in place for photos/notes.',
  input: z.object({
    attachment_index: z.number().int().min(0).max(9),
    kind: z.enum(['report', 'floor_plan', 'receipt', 'quote', 'photo', 'note']),
    metadata: metadataSchema,
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    await ctx.householdService.getHousehold(ctx.householdId, ctx.userId);

    const order = ctx.attachmentOrder;
    if (!order || order.length === 0) {
      return { ok: false, error: 'no_attachments_in_turn' };
    }
    if (input.attachment_index >= order.length) {
      return {
        ok: false,
        error: 'invalid_attachment_index',
        hint: `Index ${input.attachment_index} is out of range; only ${order.length} attachment(s) in this turn.`,
      };
    }
    const attachmentId = order[input.attachment_index];

    // Verify attachment exists, belongs to this household + user, and is
    // actually uploaded. Already-routed attachments are rejected so Aihousekeeper
    // can't double-file the same file.
    const row = await ctx.db
      .select({
        id: aihousekeeperAttachments.id,
        status: aihousekeeperAttachments.status,
        file_name: aihousekeeperAttachments.file_name,
        mime_type: aihousekeeperAttachments.mime_type,
        content_hash: aihousekeeperAttachments.content_hash,
      })
      .from(aihousekeeperAttachments)
      .where(
        and(
          eq(aihousekeeperAttachments.id, attachmentId),
          eq(aihousekeeperAttachments.household_id, ctx.householdId),
          eq(aihousekeeperAttachments.user_id, ctx.userId)
        )
      )
      .get();
    if (!row) {
      return { ok: false, error: 'attachment_not_found' };
    }
    if (row.status === 'pending_upload') {
      return { ok: false, error: 'attachment_not_yet_uploaded' };
    }
    if (row.status === 'routed') {
      return { ok: false, error: 'attachment_already_routed' };
    }
    if (row.status === 'failed') {
      return { ok: false, error: 'attachment_failed' };
    }

    // Report kind requires a PDF — guard early so the user doesn't approve
    // a doomed mutation.
    if (input.kind === 'report' && row.mime_type !== 'application/pdf') {
      return {
        ok: false,
        error: 'report_requires_pdf',
        hint: `Attachment mime is ${row.mime_type}; reports must be PDFs.`,
      };
    }

    // Floor plan must be a PDF or image.
    if (
      input.kind === 'floor_plan' &&
      row.mime_type !== 'application/pdf' &&
      !row.mime_type.startsWith('image/')
    ) {
      return {
        ok: false,
        error: 'floor_plan_requires_pdf_or_image',
      };
    }

    // Quote needs a contractor_id (so we know who sent it).
    if (input.kind === 'quote' && !input.metadata?.contractor_id) {
      return {
        ok: false,
        error: 'quote_requires_contractor_id',
        hint: 'Ask the user which contractor this quote is from.',
      };
    }

    // Duplicate detection for floor_plan — skipped if the user has
    // already confirmed "attach anyway" via metadata.allow_duplicate.
    // Other kinds are not deduplicated in this release (see Fix Plan
    // §8.2 — reports dedup is a follow-up).
    if (
      input.kind === 'floor_plan' &&
      row.content_hash &&
      !input.metadata?.allow_duplicate
    ) {
      const existing = await ctx.db
        .select({
          id: floorPlans.id,
          filename: floorPlans.filename,
          building_name: floorPlans.building_name,
          floor_label: floorPlans.floor_label,
          created_at: floorPlans.created_at,
        })
        .from(floorPlans)
        .where(
          and(
            eq(floorPlans.household_id, ctx.householdId),
            eq(floorPlans.content_hash, row.content_hash),
            isNull(floorPlans.deleted_at)
          )
        )
        .get();
      if (existing) {
        const label = existing.floor_label
          ? `"${existing.floor_label}"`
          : existing.filename;
        const when = existing.created_at.slice(0, 10);
        return {
          ok: false,
          error: 'duplicate_detected',
          hint: `A floor plan with identical content was already attached on ${when} as ${label} under "${existing.building_name}". Ask the user "attach anyway?"; if they confirm, retry with metadata.allow_duplicate=true.`,
          existing_floor_plan_id: existing.id,
        };
      }
    }

    const idempotencyKey = await sha256Hex(
      `classify_and_save_attachment:${ctx.householdId}:${attachmentId}:${input.kind}`
    );

    const parked = await ctx.approvalQueue.park({
      householdId: ctx.householdId,
      userId: ctx.userId,
      toolName: 'classify_and_save_attachment',
      input: {
        attachment_id: attachmentId,
        kind: input.kind,
        metadata: input.metadata ?? {},
        file_name: row.file_name,
        mime_type: row.mime_type,
      },
      idempotencyKey,
    });

    return {
      ok: true,
      pending_id: parked.pendingId,
      status: 'parked_for_approval',
      queue_status: parked.status,
      kind: input.kind,
      file_name: row.file_name,
    };
  },
};

export const attachmentTools: readonly AihousekeeperTool[] = [
  classifyAndSaveAttachment,
] as const;
