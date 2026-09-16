/**
 * Aihousekeeper HIGH_WRITE approval executor — runs the mutation after a user
 * approves a parked tool invocation (plan §B19 / §C5 / §C3).
 *
 * Called from `POST /households/:hid/aihousekeeper/approvals/:id/approve` AFTER
 * `ApprovalQueueShim.approve()` flips the row to `status='approved'`. Keyed
 * on `tool_name` in the parked row; switches to the per-tool execution
 * logic. Returns a unified outcome that the route handler passes to
 * `ApprovalQueueShim.markExecuted(pendingId, outcome)`.
 *
 * Each tool's execute path mirrors what the tool's `execute()` would have
 * done synchronously if HIGH_WRITE parking weren't in the way — the
 * difference is that here we run AFTER user approval, not before.
 */

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../../db/schema';
import {
  householdMembers,
  tasks,
  reports,
} from '../../db/schema';
import { aihousekeeperAttachments } from '../../db/schema-aihousekeeper';
import { contractors } from '../../db/schema-contractors';
import { floorPlans } from '../../db/schema-floor-plans';
import {
  GARDEN_PLAN_TYPES,
  type GardenPlanType,
} from '../../db/schema-garden-plans';
import { contractorMessages } from '../../db/schema-labor-hub';
import { pushTokens } from '../../db/schema-notifications';
import { utilityBills } from '../../db/schema-utilities';
import type { Database, Env } from '../../types';
import { generateId, now as nowIso } from '../../utils/id';
import { AihousekeeperEventBus, sha256Hex } from '../aihousekeeper/event-bus';
import { ExpoPushClient } from '../aihousekeeper/expo-push';
import { OutboundDispatcher } from '../aihousekeeper/outbound-dispatcher';
import { TrustLedgerService } from '../aihousekeeper/trust-ledger-service';
import { EnhancedPdfProcessorService } from '../enhanced-pdf-processor';
import { HouseholdService } from '../household-service';
import { createSendGridClient } from '../integrations/sendgrid';

import { enqueueGardenPlanGeneration } from './garden-plan-generation-service';

export type ExecutionOutcome =
  | {
      ok: true;
      result: Record<string, unknown>;
      /**
       * Set when execution was deferred to a Cloudflare Queue (currently only
       * `create_garden_site_plan`). The route handler MUST skip
       * `markExecuted()` in this case — the queue consumer will mark
       * 'executed' or 'failed' itself when the async job finishes.
       */
      queued?: boolean;
    }
  | { ok: false; error: string };

export interface ParkedRow {
  id: string;
  household_id: string;
  user_id: string;
  tool_name: string;
  input_json: string;
}

/**
 * Top-level dispatcher. Keyed on tool_name; each branch parses the stored
 * input and runs the mutation. Unknown tool_name returns an error rather
 * than throwing so the queue row gets a clean `status='failed'`.
 */
export async function executeApproved(
  row: ParkedRow,
  env: Env
): Promise<ExecutionOutcome> {
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(row.input_json);
  } catch (err) {
    return {
      ok: false,
      error: `malformed input_json: ${(err as Error).message}`,
    };
  }

  const ctx = buildExecutionContext(env);

  try {
    switch (row.tool_name) {
      case 'assign_task_to_member':
        return await executeAssignTask(row, input, ctx);
      case 'send_email_to_contractor':
        return await executeSendEmailToContractor(row, input, ctx);
      case 'request_quotes_from_saved_contractors':
        return await executeRequestQuotes(row, input, ctx);
      case 'classify_and_save_attachment':
        return await executeClassifyAndSaveAttachment(row, input, ctx);
      case 'create_garden_site_plan':
        return await executeCreateGardenSitePlan(row, input, ctx);
      case 'delete_household_property':
        return await executeDeleteHouseholdProperty(row, input, ctx);
      default:
        return {
          ok: false,
          error: `unknown tool_name: ${row.tool_name}`,
        };
    }
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message ?? 'execution failed',
    };
  }
}

async function executeDeleteHouseholdProperty(
  row: ParkedRow,
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ExecutionOutcome> {
  const householdId =
    typeof input.household_id === 'string' ? input.household_id : row.household_id;
  const propertyName =
    typeof input.property_name === 'string' ? input.property_name : 'Property';

  const service = new HouseholdService(ctx.env, ctx.env.DB);
  await service.deleteHousehold(householdId, row.user_id);

  await ctx.events.emit({
    householdId: row.household_id,
    eventIdempotencyKey: await sha256Hex(
      `delete_household_property:${row.id}:${householdId}`
    ),
    kind: 'decision_made',
    summary: `Deleted property "${propertyName}"`,
    rationale: 'The user approved the deletion in Aihousekeeper approvals.',
    reversible: false,
  });

  return {
    ok: true,
    result: {
      household_id: householdId,
      property_name: propertyName,
      deleted: true,
    },
  };
}

// ============ SHARED EXECUTION CONTEXT ============

interface ExecutionContext {
  env: Env;
  db: Database;
  dispatcher: OutboundDispatcher;
  events: AihousekeeperEventBus;
}

function buildExecutionContext(env: Env): ExecutionContext {
  const db = drizzle(env.DB, { schema }) as unknown as Database;
  const events = new AihousekeeperEventBus();
  // Subscribe the ledger so every emitted event lands as a ledger row.
  new TrustLedgerService(db, events);

  // Google Calendar client isn't used by any of the current HIGH_WRITE
  // executors but is referenced by OutboundDispatcher's shape — no, actually
  // the dispatcher doesn't depend on Calendar. Omit to keep the context lean.
  const dispatcher = new OutboundDispatcher({
    db,
    env,
    events,
    expoPush: new ExpoPushClient(),
    sendgrid: createSendGridClient({
      SENDGRID_API_KEY: env.SENDGRID_API_KEY,
      SENDGRID_DIGEST_TEMPLATE_ID: env.SENDGRID_DIGEST_TEMPLATE_ID,
      SENDGRID_FROM_EMAIL: env.SENDGRID_FROM_EMAIL,
    }),
  });

  return { env, db, dispatcher, events };
}

// ============ TOOL EXECUTORS ============

/**
 * `assign_task_to_member` — parked input has `{ task_id, member_id, reason, task_title }`.
 * On approval:
 *   1. UPDATE maintenance_tasks.assigned_to = member's user_id.
 *   2. Send a push to the assignee (if they have an active push_token).
 *   3. Emit `task_assigned` on the event bus → ledger row.
 */
async function executeAssignTask(
  row: ParkedRow,
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ExecutionOutcome> {
  const taskId = input.task_id as string | undefined;
  const memberId = input.member_id as string | undefined;
  const reason = (input.reason as string | undefined) ?? 'Assigned by Aihousekeeper';
  const taskTitle = (input.task_title as string | undefined) ?? 'Task';
  if (!taskId || !memberId) {
    return { ok: false, error: 'missing_task_id_or_member_id' };
  }

  // Resolve member → user_id. Re-verify household scoping to guard against
  // any edits between park and approve.
  const member = await ctx.db
    .select({ user_id: householdMembers.user_id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.id, memberId),
        eq(householdMembers.household_id, row.household_id)
      )
    )
    .get();
  if (!member) {
    return { ok: false, error: 'member_not_found_or_cross_household' };
  }

  // Update the task assignment.
  const updateResult = await ctx.db
    .update(tasks)
    .set({
      assigned_to: member.user_id,
      updated_at: nowIso(),
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.household_id, row.household_id)
      )
    )
    .run();
  const changes =
    (updateResult as { meta?: { changes?: number } } | undefined)?.meta
      ?.changes ?? 0;
  if (changes === 0) {
    return { ok: false, error: 'task_not_found_or_cross_household' };
  }

  // Emit `task_assigned` → ledger row via subscriber.
  const eventKey = await sha256Hex(
    `task_assigned:${row.household_id}:${taskId}:${memberId}:${row.id}`
  );
  await ctx.events.emit({
    kind: 'task_assigned',
    householdId: row.household_id,
    eventIdempotencyKey: eventKey,
    taskId,
    memberId,
    reason,
  });

  // Send a push to the assignee if they have an active token.
  const assigneeToken = await ctx.db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(
      and(
        eq(pushTokens.user_id, member.user_id),
        eq(pushTokens.is_active, true)
      )
    )
    .get();

  let pushResult: { status: string; reason?: string } = {
    status: 'skipped_no_token',
  };
  if (assigneeToken?.token) {
    const pushIdempotency = await sha256Hex(
      `assign_push:${taskId}:${memberId}:${row.id}`
    );
    const result = await ctx.dispatcher.sendPush({
      householdId: row.household_id,
      toExpoToken: assigneeToken.token,
      toMemberId: memberId,
      title: 'New task for you',
      body: `Aihousekeeper assigned "${taskTitle}"${reason ? ` — ${reason}` : ''}`,
      template: 'task_assigned',
      severity: 3,
      kind: 'nudge',
      idempotencyKey: pushIdempotency,
      triggerRef: { taskId, memberId, pendingId: row.id },
      now: new Date(),
    });
    pushResult = {
      status: result.status,
      ...(result.status === 'skipped' && 'reason' in result
        ? { reason: result.reason }
        : {}),
    };
  }

  return {
    ok: true,
    result: {
      task_id: taskId,
      member_id: memberId,
      assigned_user_id: member.user_id,
      push: pushResult,
    },
  };
}

/**
 * `send_email_to_contractor` — parked input has `{ contractor_id, subject, body }`.
 * Requires SendGrid `SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL`.
 */
async function executeSendEmailToContractor(
  row: ParkedRow,
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ExecutionOutcome> {
  const contractorId = input.contractor_id as string | undefined;
  const subject = (input.subject as string | undefined) ?? 'Message from your homeowner';
  const body = input.body as string | undefined;
  if (!contractorId || !body) {
    return { ok: false, error: 'missing_contractor_id_or_body' };
  }

  const contractor = await ctx.db
    .select({
      id: contractors.id,
      email: contractors.email,
      name: contractors.name,
    })
    .from(contractors)
    .where(
      and(
        eq(contractors.id, contractorId),
        eq(contractors.household_id, row.household_id)
      )
    )
    .get();
  if (!contractor) return { ok: false, error: 'contractor_not_found' };
  if (!contractor.email) return { ok: false, error: 'contractor_missing_email' };

  const idempotency = await sha256Hex(`email_send:${row.id}:${contractorId}`);
  const result = await ctx.dispatcher.sendEmail({
    householdId: row.household_id,
    toEmail: contractor.email,
    subject,
    html: `<p>${body.replace(/</g, '&lt;')}</p>`,
    template: 'contractor_delegation',
    severity: 2,
    kind: 'nudge',
    idempotencyKey: idempotency,
    triggerRef: { pendingId: row.id, contractorId },
    now: new Date(),
  });

  const eventKey = await sha256Hex(
    `delegation_sent:email:${row.id}:${contractorId}`
  );
  await ctx.events.emit({
    kind: 'delegation_sent',
    householdId: row.household_id,
    eventIdempotencyKey: eventKey,
    tool: 'send_email_to_contractor',
    draftId: row.id,
  });

  return {
    ok: true,
    result: { email: result, contractor_id: contractorId },
  };
}

/**
 * `request_quotes_from_saved_contractors` — fan-out. Parked input has
 * `{ category, scope, deadline_days, contractor_ids[] }`. On approval, send
 * the request to each contractor via email.
 */
async function executeRequestQuotes(
  row: ParkedRow,
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ExecutionOutcome> {
  const ids = (input.contractor_ids as string[] | undefined) ?? [];
  const scope = (input.scope as string | undefined) ?? 'a project at our home';
  const deadlineDays = (input.deadline_days as number | undefined) ?? 7;
  if (!ids.length) {
    return { ok: false, error: 'no_contractors_in_batch' };
  }

  const body = `We're looking for a quote on ${scope}. Please reply within ${deadlineDays} days if you're available.`;

  const outcomes: Array<{ contractor_id: string; channel: string; status: string; error?: string }> = [];
  for (const cid of ids) {
    try {
      const c = await ctx.db
        .select({
          id: contractors.id,
          email: contractors.email,
        })
        .from(contractors)
        .where(
          and(
            eq(contractors.id, cid),
            eq(contractors.household_id, row.household_id)
          )
        )
        .get();
      if (!c) {
        outcomes.push({ contractor_id: cid, channel: 'none', status: 'not_found' });
        continue;
      }
      if (c.email) {
        const idem = await sha256Hex(`quotes_email:${row.id}:${cid}`);
        const r = await ctx.dispatcher.sendEmail({
          householdId: row.household_id,
          toEmail: c.email,
          subject: 'Quote request',
          html: `<p>${body.replace(/</g, '&lt;')}</p>`,
          template: 'quote_request',
          severity: 2,
          kind: 'nudge',
          idempotencyKey: idem,
          triggerRef: { pendingId: row.id, contractorId: cid },
          now: new Date(),
        });
        outcomes.push({ contractor_id: cid, channel: 'email', status: r.status });
      } else {
        outcomes.push({
          contractor_id: cid,
          channel: 'none',
          status: 'no_usable_channel',
        });
      }
    } catch (err) {
      outcomes.push({
        contractor_id: cid,
        channel: 'error',
        status: 'failed',
        error: (err as Error).message,
      });
    }
  }

  return { ok: true, result: { batch: outcomes } };
}

/**
 * `classify_and_save_attachment` — parked input has:
 *   { attachment_id, kind, metadata, file_name, mime_type }
 *
 * Kind-specific routing:
 *   - report: copy R2 object into `reports/<hh>/<rid>/<file>`, insert a
 *     `reports` row with status='uploaded', then kick off Lambda OCR via
 *     EnhancedPdfProcessorService.processReportDirect.
 *   - floor_plan: copy into `floor-plans/<hh>/<fpid>/<file>`, insert a
 *     `floor_plans` row with status='completed' + display_image_key set.
 *   - receipt: insert `utility_bills` row; `document_url` points at the
 *     attachment's existing R2 key (no copy).
 *   - quote: insert `contractor_messages` row (direction='inbound',
 *     channel='upload'), attachments array holds the r2 key, body is the
 *     AI-provided quote summary (or a default).
 *   - photo / note: keep the attachment in place; just flip status='routed'.
 *
 * Always updates `aihousekeeper_attachments` with kind, linked_entity_*, and
 * status='routed' on success, status='failed' + failure_reason on error.
 */
async function executeClassifyAndSaveAttachment(
  row: ParkedRow,
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ExecutionOutcome> {
  const attachmentId = input.attachment_id as string | undefined;
  const kind = input.kind as string | undefined;
  const metadata = (input.metadata as Record<string, unknown> | undefined) ?? {};
  if (!attachmentId || !kind) {
    return { ok: false, error: 'missing_attachment_id_or_kind' };
  }

  // Re-verify the attachment at approval time — user may have deleted it.
  const att = await ctx.db
    .select()
    .from(aihousekeeperAttachments)
    .where(
      and(
        eq(aihousekeeperAttachments.id, attachmentId),
        eq(aihousekeeperAttachments.household_id, row.household_id)
      )
    )
    .get();
  if (!att) {
    return { ok: false, error: 'attachment_not_found' };
  }
  if (att.status !== 'uploaded' && att.status !== 'classified') {
    return { ok: false, error: `attachment_status_${att.status}` };
  }

  const ts = nowIso();

  try {
    let linkedEntityType: string | null = null;
    let linkedEntityId: string | null = null;
    let result: Record<string, unknown> = {};

    switch (kind) {
      case 'report': {
        const reportId = generateId();
        const newKey = `reports/${row.household_id}/${reportId}/${att.file_name}`;
        await copyR2Object(ctx.env, att.r2_key, newKey, att.mime_type);

        await ctx.db.insert(reports).values({
          id: reportId,
          household_id: row.household_id,
          uploaded_by: row.user_id,
          filename: att.file_name,
          file_size: att.size_bytes ?? 0,
          file_key: newKey,
          status: 'uploaded',
          inspector_name:
            (metadata.inspector_name as string | undefined) ?? null,
          inspection_date:
            (metadata.inspection_date as string | undefined) ?? null,
          property_address:
            (metadata.property_address as string | undefined) ?? null,
          created_at: ts,
          updated_at: ts,
          updated_by: row.user_id,
        });

        // Kick off Lambda OCR — same pipeline normal report uploads use.
        // Failure here is logged but does NOT fail the approval: the user
        // can retry processing from the report detail screen.
        try {
          const processor = new EnhancedPdfProcessorService(ctx.env, ctx.env.DB);
          await processor.processReportDirect(reportId);
        } catch (err) {
          console.warn('[approval-executor] Lambda dispatch failed', {
            reportId,
            error: (err as Error).message,
          });
        }

        linkedEntityType = 'reports';
        linkedEntityId = reportId;
        result = { report_id: reportId, file_key: newKey };
        break;
      }

      case 'floor_plan': {
        const floorPlanId = generateId();
        const newKey = `floor-plans/${row.household_id}/${floorPlanId}/${att.file_name}`;
        await copyR2Object(ctx.env, att.r2_key, newKey, att.mime_type);

        await ctx.db.insert(floorPlans).values({
          id: floorPlanId,
          household_id: row.household_id,
          filename: att.file_name,
          file_size: att.size_bytes ?? 0,
          content_type: att.mime_type,
          original_file_key: newKey,
          display_image_key: newKey,
          thumbnail_key: newKey,
          content_hash: att.content_hash ?? null,
          building_name:
            (metadata.building_name as string | undefined) ?? 'Main Building',
          floor_number:
            (metadata.floor_number as number | undefined) ?? null,
          floor_label:
            (metadata.floor_label as string | undefined) ?? null,
          status: 'completed',
          created_at: ts,
          updated_at: ts,
        });

        linkedEntityType = 'floor_plans';
        linkedEntityId = floorPlanId;
        result = { floor_plan_id: floorPlanId, file_key: newKey };
        break;
      }

      case 'receipt': {
        // Utility bill. document_url points at the existing R2 key so we
        // avoid a redundant copy; the attachment row stays and is linked.
        const billId = generateId();
        const billType =
          (metadata.bill_type as string | undefined) ?? 'other';
        const amount = (metadata.amount_cents as number | undefined) ?? 0;
        const dueDate =
          (metadata.due_date as string | undefined) ?? ts.slice(0, 10);
        const periodStart =
          (metadata.billing_period_start as string | undefined) ??
          ts.slice(0, 10);
        const periodEnd =
          (metadata.billing_period_end as string | undefined) ??
          ts.slice(0, 10);

        await ctx.db.insert(utilityBills).values({
          id: billId,
          household_id: row.household_id,
          account_id: null,
          bill_type: billType,
          provider: (metadata.provider as string | undefined) ?? null,
          account_number: null,
          billing_period_start: periodStart,
          billing_period_end: periodEnd,
          amount,
          due_date: dueDate,
          paid_date: null,
          paid_amount: null,
          usage_quantity: null,
          usage_unit: null,
          document_url: att.r2_key,
          ai_extracted_data: null,
          confidence_score: null,
          created_at: ts,
          updated_at: ts,
        });

        linkedEntityType = 'utility_bills';
        linkedEntityId = billId;
        result = { utility_bill_id: billId, bill_type: billType };
        break;
      }

      case 'quote': {
        const contractorId = metadata.contractor_id as string | undefined;
        if (!contractorId) {
          return { ok: false, error: 'quote_requires_contractor_id' };
        }
        // Verify the contractor belongs to this household.
        const c = await ctx.db
          .select({ id: contractors.id })
          .from(contractors)
          .where(
            and(
              eq(contractors.id, contractorId),
              eq(contractors.household_id, row.household_id)
            )
          )
          .get();
        if (!c) {
          return { ok: false, error: 'contractor_not_found' };
        }

        const messageId = generateId();
        const body =
          (metadata.quote_summary as string | undefined) ??
          `Quote uploaded: ${att.file_name}`;

        await ctx.db.insert(contractorMessages).values({
          id: messageId,
          household_id: row.household_id,
          contractor_id: contractorId,
          direction: 'inbound',
          channel: 'upload',
          subject: null,
          body,
          attachments: JSON.stringify([att.r2_key]),
          status: 'received',
          sent_at: ts,
          read_at: null,
          template_used: null,
          created_at: ts,
        });

        linkedEntityType = 'contractor_messages';
        linkedEntityId = messageId;
        result = { contractor_message_id: messageId, contractor_id: contractorId };
        break;
      }

      case 'photo':
      case 'note': {
        // Leave the file in its aihousekeeper-attachments location; just mark
        // classified so it can be browsed later.
        result = { kept_in_place: true };
        break;
      }

      default:
        return { ok: false, error: `unsupported_kind:${kind}` };
    }

    await ctx.db
      .update(aihousekeeperAttachments)
      .set({
        status: 'routed',
        kind,
        linked_entity_type: linkedEntityType,
        linked_entity_id: linkedEntityId,
        updated_at: ts,
      })
      .where(eq(aihousekeeperAttachments.id, attachmentId));

    return {
      ok: true,
      result: {
        attachment_id: attachmentId,
        kind,
        linked_entity_type: linkedEntityType,
        linked_entity_id: linkedEntityId,
        ...result,
      },
    };
  } catch (err) {
    // Mark the attachment as failed so the user can see the failure reason
    // in the attachments list / approvals ledger.
    const reason = (err as Error).message ?? 'routing_failed';
    try {
      await ctx.db
        .update(aihousekeeperAttachments)
        .set({
          status: 'failed',
          failure_reason: reason.slice(0, 500),
          updated_at: ts,
        })
        .where(eq(aihousekeeperAttachments.id, attachmentId));
    } catch {
      // swallow — the outer failure is what matters
    }
    return { ok: false, error: reason };
  }
}

/**
 * Rekey an object inside REPORTS_BUCKET. Workers R2 has no native copy, so
 * we GET → PUT. The source object is left in place; the aihousekeeper_attachments
 * row still points at it, which is fine for audit.
 */
/**
 * `create_garden_site_plan` — after approval, **enqueue** the actual OpenAI
 * call to a Cloudflare Queue and return immediately. The user-facing approve
 * request finishes in <200ms; the queue consumer (see
 * `garden-plan-job-handler.ts`) generates the PNG, uploads to R2, flips the
 * `garden_plans` row to 'completed', marks the approval 'executed', and pushes
 * a notification.
 *
 * Why queue, not synchronous: DALL·E 3 latency (12–60s) blows past Workers'
 * ~30s wall-clock. A 28s timeout was hitting users; longer timeouts kill the
 * whole Worker request and leave the approval row stuck in 'approved'.
 *
 * Failure handling here covers only **pre-flight validation** (bad plan_type,
 * empty prompt). Anything that requires actually calling OpenAI lives in the
 * queue handler.
 *
 * State transitions on success:
 *   - garden_plans row inserted with status='generating' (placeholder R2 key)
 *   - ai_tool_pending stays 'approved' until the queue handler completes
 *   - Trust ledger gets a `decision_made` event so the action is auditable
 */
async function executeCreateGardenSitePlan(
  row: ParkedRow,
  input: Record<string, unknown>,
  ctx: ExecutionContext
): Promise<ExecutionOutcome> {
  const env = ctx.env;
  const householdId = row.household_id;

  const rawType = (input.plan_type as string | undefined)
    ?? (input.plan_context as string | undefined)
    ?? 'garden';
  if (!GARDEN_PLAN_TYPES.includes(rawType as GardenPlanType)) {
    return { ok: false, error: 'invalid_plan_type' };
  }
  const planType = rawType as GardenPlanType;
  const areaLabel = (input.area_label as string | undefined) ?? 'Garden';
  const diagramPrompt = (input.diagram_prompt as string | undefined) ?? '';
  if (!diagramPrompt.trim()) {
    return { ok: false, error: 'missing_diagram_prompt' };
  }

  // Resolve a reference image so gpt-image-1 can trace the real lot rather
  // than hallucinating a generic suburban property. Source priority:
  //   1. User-attached photo via `attachment_id` on the parked input
  //   2. None — fall back to text-only generation; the mobile UI rebrands
  //      the result as a "concept" so the user knows it isn't their lot
  // All branches are best-effort: a failure resolving the reference is
  // logged and the queue message simply omits the reference key.
  const referenceResolved = await resolveReferenceImageBestEffort(
    env,
    householdId,
    input
  );

  let gardenPlanId: string;
  try {
    const queued = await enqueueGardenPlanGeneration(env, {
      approvalId: row.id,
      householdId,
      userId: row.user_id,
      diagramPrompt,
      planType,
      areaLabel,
      referenceImageR2Key:
        'r2Key' in referenceResolved ? referenceResolved.r2Key : undefined,
      referenceImageSource: referenceResolved.source,
    });
    gardenPlanId = queued.gardenPlanId;
  } catch (err) {
    console.warn('[garden-plan] enqueue failed', {
      householdId: householdId.slice(0, 8),
      error: (err as Error).message,
    });
    return { ok: false, error: (err as Error).message };
  }

  try {
    const eventKey = await sha256Hex(
      `garden_site_plan_queued:${householdId}:${gardenPlanId}`
    );
    await ctx.events.emit({
      kind: 'decision_made',
      householdId,
      eventIdempotencyKey: eventKey,
      summary: `Queued garden site plan: ${areaLabel}`,
      rationale: `Async generation enqueued for 2D ${planType.replace(/_/g, ' ')} plan.`,
      reversible: true,
      undoToken: gardenPlanId,
    });
  } catch (ledgerErr) {
    console.warn('[garden-plan] ledger emit failed', {
      error: (ledgerErr as Error).message,
    });
  }

  return {
    ok: true,
    queued: true,
    result: {
      garden_plan_id: gardenPlanId,
      plan_type: planType,
      area_label: areaLabel,
      queued: true,
    },
  };
}

async function copyR2Object(
  env: Env,
  fromKey: string,
  toKey: string,
  contentType: string
): Promise<void> {
  const obj = await env.REPORTS_BUCKET.get(fromKey);
  if (!obj) {
    throw new Error(`source_object_missing:${fromKey}`);
  }
  const body = await obj.arrayBuffer();
  await env.REPORTS_BUCKET.put(toKey, body, {
    httpMetadata: { contentType },
  });
}

/**
 * Resolve a reference image to feed into gpt-image-1's edits endpoint.
 *
 * Returns one of:
 *   - { source: 'user_attachment', r2Key } — the household uploaded a yard
 *     photo / satellite screenshot and Mira passed `attachment_id` on the
 *     tool input. Best fidelity: the user knows their own lot.
 *   - { source: 'none' } — no reference image was available. The queue handler
 *     falls back to text-only generation and the UI labels the plan as a
 *     "stylized concept" instead of "AI-traced from your lot".
 *
 * Never throws — failures fall through to the next source. The intent is
 * "always produce SOMETHING the user can see"; honesty about what was
 * actually used is captured in the `source` discriminator.
 */
async function resolveReferenceImageBestEffort(
  env: Env,
  householdId: string,
  input: Record<string, unknown>
): Promise<{ source: 'user_attachment'; r2Key: string } | { source: 'none' }> {
  // 1. User-attached photo (preferred when present)
  const attachmentId = input.attachment_id as string | undefined;
  if (typeof attachmentId === 'string' && attachmentId.length > 0) {
    try {
      const db = drizzle(env.DB, { schema }) as unknown as Database;
      const att = await db
        .select({
          r2_key: aihousekeeperAttachments.r2_key,
          mime_type: aihousekeeperAttachments.mime_type,
          status: aihousekeeperAttachments.status,
        })
        .from(aihousekeeperAttachments)
        .where(
          and(
            eq(aihousekeeperAttachments.id, attachmentId),
            eq(aihousekeeperAttachments.household_id, householdId)
          )
        )
        .get();
      if (
        att &&
        (att.status === 'uploaded' ||
          att.status === 'classified' ||
          att.status === 'routed') &&
        // gpt-image-1 only accepts png + jpeg
        (att.mime_type === 'image/png' || att.mime_type === 'image/jpeg')
      ) {
        return { source: 'user_attachment', r2Key: att.r2_key };
      }
    } catch (err) {
      console.warn(
        '[garden-plan] reference image: user attachment lookup failed',
        {
          householdId: householdId.slice(0, 8),
          attachmentId: attachmentId.slice(0, 8),
          error: (err as Error).message,
        }
      );
    }
  }

  return { source: 'none' };
}
