/**
 * Tool registry — v1.2 baseline + Aihousekeeper §C6 extensions.
 *
 * Two concerns live here:
 *
 *   1. The legacy Gemini-native `toolRegistry` (FunctionDeclaration[]) used by
 *      the existing `tool-executor.ts`. Declarations live in
 *      `ai/gemini-legacy-tool-registry.ts` (re-exported below).
 *
 *   2. The Aihousekeeper tool framework: `AihousekeeperTool`, `AihousekeeperToolContext`, `ToolResult`,
 *      and `buildToolRegistry(env)`. This is the API consumed by Stream E's
 *      routes and Stream D's trigger orchestration.
 *
 * Tool shape (§4 Tool Shapes):
 *
 *   export const toolName: AihousekeeperTool = {
 *     name: 'recall',
 *     kind: 'READ' | 'LOW_WRITE' | 'HIGH_WRITE',
 *     description: '...',
 *     input: z.object({ ... }),
 *     async execute(ctx, input): Promise<ToolResult> { ... },
 *   };
 *
 * The executor (Stream E) is expected to:
 *   - Look up the tool by name in the registry's mode allowlist.
 *   - Zod-parse input (surface validation errors as tool errors).
 *   - Invoke `execute(ctx, parsedInput)`.
 *   - Route `HIGH_WRITE` results through the approval UI.
 */
import type { z } from 'zod';

import { geminiLegacyToolRegistry as toolRegistry } from '../../../ai/gemini-legacy-tool-registry';
export { toolRegistry };

import type { Database, Env } from '../../../types';
import type { AihousekeeperEventBus } from '../../aihousekeeper/event-bus';
import type { FamilyRouter } from '../../aihousekeeper/family-router';
import type { MemoryService } from '../../aihousekeeper/memory-service';
import type { OutboundDispatcher } from '../../aihousekeeper/outbound-dispatcher';
import type { HouseholdService } from '../../household-service';
import type {
  GoogleCalendarClient,
} from '../../integrations/google-calendar';
import type { SendGridClient } from '../../integrations/sendgrid';
import { ApprovalQueueShim } from '../approval-queue-shim';

// Stream C Aihousekeeper tool modules.
import {
  approvalManagementTools,
  cancelPendingApproval,
  listPendingApprovals,
} from './aihousekeeper/approval-management-tools';
import { assignTools } from './aihousekeeper/assign-tool';
import { assignTaskToMember } from './aihousekeeper/assign-tool';
import { attachmentTools, classifyAndSaveAttachment } from './aihousekeeper/attachment-tools';
import { calendarTools } from './aihousekeeper/calendar-tools';
import { proposeCalendarSlots } from './aihousekeeper/calendar-tools';
import {
  chatHistoryTools,
  clearChatHistory,
  exportChatHistory,
} from './aihousekeeper/chat-history-tools';
import { delegationTools } from './aihousekeeper/delegation-tools';
import {
  draftEmailToContractor,
  forwardBriefingTo,
  requestQuotesFromSavedContractors,
  sendEmailToContractor,
} from './aihousekeeper/delegation-tools';
import { floorPlanTools } from './aihousekeeper/floor-plan-tools';
import { followupTools } from './aihousekeeper/followup-tools';
import {
  cancelFollowup,
  scheduleSelfFollowup,
} from './aihousekeeper/followup-tools';
import {
  createPendingGardenBoundary,
  deletePendingGardenBoundary,
  editPendingGardenBoundary,
  gardenBoundaryTools,
  listPendingGardenBoundaries,
} from './aihousekeeper/garden-boundary-tools';
import {
  gardenPlanFlowTools,
  startGardenPlanFlow,
} from './aihousekeeper/garden-plan-flow-tool';
import {
  createGardenSitePlan,
} from './aihousekeeper/garden-site-plan-tool';
import {
  householdSettingsTools,
  listHouseholdProperties,
  getHouseholdDetails,
  createHouseholdProperty,
  updateHouseholdDetails,
  updateHouseholdProperty,
  deleteHouseholdProperty,
} from './aihousekeeper/household-settings-tools';
import {
  invitationTools,
  listHouseholdMembers,
  listPendingInvitations,
  inviteHouseholdMember,
  cancelHouseholdInvitation,
  removeHouseholdMember,
} from './aihousekeeper/invitation-tools';
import {
  forget,
  memoryTools,
  recall,
  remember,
  updateMemory,
} from './aihousekeeper/memory-tools';
import {
  reminderTools,
  listTaskReminders,
  updateTaskReminder,
} from './aihousekeeper/reminder-tools';
import {
  noteTools,
  listHouseholdNotes,
  createHouseholdNote,
  updateHouseholdNote,
  deleteHouseholdNote,
} from './aihousekeeper/note-tools';
import {
  spaceTools,
  listSpaces,
  createSpace,
  updateSpace,
  deleteSpace,
} from './aihousekeeper/space-tools';
import {
  subscriptionTools,
  getSubscription,
  openManageSubscription,
} from './aihousekeeper/subscription-tools';
import {
  notificationPreferenceTools,
  getNotificationPreferences,
  updateNotificationPreferences,
} from './aihousekeeper/notification-preference-tools';
import { reportTools, listReports, getReport } from './aihousekeeper/report-tools';
import {
  taskTools,
  createMaintenanceTask,
  updateMaintenanceTask,
  rescheduleMaintenanceTask,
  completeMaintenanceTask,
  snoozeMaintenanceTask,
  deleteMaintenanceTask,
  listMaintenanceTasks,
  getMaintenanceTask,
} from './aihousekeeper/task-tools';
import { closeVoiceMode, voiceTools } from './aihousekeeper/voice-tools';

// ============ Aihousekeeper tool framework types ============

export type ToolKind = 'READ' | 'LOW_WRITE' | 'HIGH_WRITE';

export type ChatMode =
  | 'task_assistant'
  | 'report_assistant'
  | 'family_chat'
  | 'contractor_context'
  | 'morning_briefing';

export const CHAT_MODES: readonly ChatMode[] = [
  'task_assistant',
  'report_assistant',
  'family_chat',
  'contractor_context',
  'morning_briefing',
] as const;

/**
 * `ok: true` is the happy path; every other field is tool-specific. `ok: false`
 * is recoverable — the executor surfaces the error object to the LLM so it can
 * retry or ask the user. Unrecoverable errors should throw.
 */
export type ToolResult =
  | ({ ok: true } & Record<string, unknown>)
  | ({ ok: false; error: string } & Record<string, unknown>);

export interface ApprovalQueueFacade {
  park(args: {
    householdId: string;
    userId: string;
    toolName: string;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ pendingId: string; status: string }>;
}

export interface AihousekeeperToolContext {
  env: Env;
  db: Database;
  householdId: string;
  userId: string;
  householdService: HouseholdService;
  memory: MemoryService;
  dispatcher: OutboundDispatcher;
  familyRouter: FamilyRouter;
  events: AihousekeeperEventBus;
  approvalQueue: ApprovalQueueFacade;
  /**
   * Ordered list of `aihousekeeper_attachments.id` values for the current turn, in the
   * same order they appear in the `<attachments>` block sent to the model.
   * Tools receive a positional `attachment_index` from the model and resolve
   * it here — the real UUID is never exposed to Claude's context.
   */
  attachmentOrder?: readonly string[];
  integrations: {
    sendgrid: SendGridClient;
    googleCalendar: GoogleCalendarClient;
  };
}

/**
 * AihousekeeperTool keeps zod as the input declaration. The `execute` method receives
 * the zod-parsed input, so its parameter type is inferred from the schema via
 * `z.infer`. Consumers that construct a AihousekeeperTool with a literal object get
 * the correct `input` parameter type without annotating it, thanks to the
 * `z.ZodType<TInput>` constraint binding TInput from the zod schema.
 */
export interface AihousekeeperTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  kind: ToolKind;
  description: string;
  input: TSchema;
  execute(ctx: AihousekeeperToolContext, input: z.infer<TSchema>): Promise<ToolResult>;
}

/**
 * Mode-scoped registry. Each mode has an allowlist of tools; tools may appear
 * in multiple modes. `register` is additive — calling it twice for the same
 * (mode, tool) is a silent no-op so §C6's multiple-register pattern is safe.
 */
export class ToolRegistry {
  private byMode = new Map<ChatMode, Map<string, AihousekeeperTool>>();

  constructor() {
    for (const mode of CHAT_MODES) {
      this.byMode.set(mode, new Map());
    }
  }

  register(mode: ChatMode, tools: readonly AihousekeeperTool[]): void {
    const bucket = this.byMode.get(mode);
    if (!bucket) return;
    for (const tool of tools) {
      if (!bucket.has(tool.name)) {
        bucket.set(tool.name, tool);
      }
    }
  }

  get(mode: ChatMode, name: string): AihousekeeperTool | undefined {
    return this.byMode.get(mode)?.get(name);
  }

  /** Every tool available in the given mode. */
  list(mode: ChatMode): AihousekeeperTool[] {
    const bucket = this.byMode.get(mode);
    return bucket ? Array.from(bucket.values()) : [];
  }

  /** Union of tools across all modes, deduped by name. */
  listAll(): AihousekeeperTool[] {
    const seen = new Map<string, AihousekeeperTool>();
    for (const bucket of this.byMode.values()) {
      for (const [name, tool] of bucket) {
        if (!seen.has(name)) seen.set(name, tool);
      }
    }
    return Array.from(seen.values());
  }
}

// ============ Aihousekeeper registry construction (§C6) ============

/**
 * v1.2 baseline — today the v1.2 Phase 4/6 tool set is not yet implemented as
 * `AihousekeeperTool` records. Return an empty registry so Aihousekeeper's §C6 block is the
 * only source of AihousekeeperTool registrations until v1.2 lands. The legacy Gemini
 * `toolRegistry` below is unaffected.
 */
function buildV1(_env: Env): ToolRegistry {
  return new ToolRegistry();
}

/**
 * Wire all 14 Aihousekeeper tools per-chat-mode per plan §C6. Consumers (Stream E
 * routes, Stream D trigger orchestration, Stream F queue workers) call this
 * once per request/tick with the bound `Env`.
 */
export function buildToolRegistry(env: Env): ToolRegistry {
  const registry = buildV1(env);

  // Memory — all 5 modes (universal).
  for (const mode of CHAT_MODES) {
    registry.register(mode, memoryTools);
  }

  // Approval management (list + cancel) — every mode. Users can ask
  // "what's pending" or "cancel that" from any chat surface, and Mira must
  // read the live state instead of guessing. Approve is intentionally NOT
  // a tool: it stays a deliberate user gesture in the approvals screen.
  for (const mode of CHAT_MODES) {
    registry.register(mode, approvalManagementTools);
  }

  // Attachment routing — all 5 modes (user may attach files in any chat).
  for (const mode of CHAT_MODES) {
    registry.register(mode, attachmentTools);
  }

  // Followup — task + briefing.
  registry.register('task_assistant', followupTools);
  registry.register('morning_briefing', followupTools);

  // Delegation — task gets email + briefing forward tools.
  registry.register('task_assistant', delegationTools);
  // Contractor context gets contractor email + quote batch tools.
  registry.register('contractor_context', [
    draftEmailToContractor,
    sendEmailToContractor,
    requestQuotesFromSavedContractors,
  ]);

  // Calendar — task + family.
  registry.register('task_assistant', calendarTools);
  registry.register('family_chat', calendarTools);

  // Assign — task + family.
  registry.register('task_assistant', assignTools);
  registry.register('family_chat', assignTools);

  // Task CRUD — task + family + briefing (full create/read/update/delete surface).
  registry.register('task_assistant', taskTools);
  registry.register('family_chat', taskTools);
  registry.register('morning_briefing', taskTools);

  // Site / yard + indoor plans (read-only).
  registry.register('task_assistant', floorPlanTools);
  registry.register('family_chat', floorPlanTools);
  registry.register('morning_briefing', floorPlanTools);

  // Garden plan creation starts from the Gardening upload flow or chat concept plans.
  registry.register('task_assistant', gardenPlanFlowTools);
  registry.register('family_chat', gardenPlanFlowTools);
  registry.register('morning_briefing', gardenPlanFlowTools);
  registry.register('task_assistant', gardenBoundaryTools);
  registry.register('family_chat', gardenBoundaryTools);
  registry.register('morning_briefing', gardenBoundaryTools);

  // Voice-session control — available in every mode a user might enter voice
  // from. Text chat sees the tool too, which is fine: Claude only calls it
  // when the user asks to leave voice, and if there's no active voice session
  // the signal is simply a no-op client-side.
  for (const mode of CHAT_MODES) {
    registry.register(mode, voiceTools);
  }

  // Chat history (clear/export) — available in every chat mode so the user
  // can always say "clear our conversation" or "export this chat". The
  // action is client-side (aihousekeeperStore.clearChatMessages), so the server
  // tool just signals intent via the tool_result payload.
  for (const mode of CHAT_MODES) {
    registry.register(mode, chatHistoryTools);
  }

  // Reminder settings on tasks — task + family + briefing, alongside task CRUD.
  registry.register('task_assistant', reminderTools);
  registry.register('family_chat', reminderTools);
  registry.register('morning_briefing', reminderTools);

  // Member invitations + roster — task + family (coordination surfaces).
  registry.register('task_assistant', invitationTools);
  registry.register('family_chat', invitationTools);

  // Household shared notes — every mode; notes are the low-ceremony
  // replacement for asking Aihousekeeper to "just remember X" when it isn't a
  // structured memory/fact.
  for (const mode of CHAT_MODES) {
    registry.register(mode, noteTools);
  }

  // Household/property records — available in any chat surface so Mira can
  // manage saved homes/properties whenever the user asks.
  for (const mode of CHAT_MODES) {
    registry.register(mode, householdSettingsTools);
  }

  // Spaces / rooms — task + family + briefing (task creation often
  // references spaces).
  registry.register('task_assistant', spaceTools);
  registry.register('family_chat', spaceTools);
  registry.register('morning_briefing', spaceTools);

  // Subscription — task + family (the mode the user is most likely in when
  // asking "what plan am I on" or "cancel my subscription").
  registry.register('task_assistant', subscriptionTools);
  registry.register('family_chat', subscriptionTools);

  // Notification preferences — every mode; user can ask "turn off task
  // reminders" from any chat.
  for (const mode of CHAT_MODES) {
    registry.register(mode, notificationPreferenceTools);
  }

  // Reports — report_assistant primarily; also task + briefing so the user
  // can reference a report from those modes.
  registry.register('report_assistant', reportTools);
  registry.register('task_assistant', reportTools);
  registry.register('morning_briefing', reportTools);

  return registry;
}

/**
 * Convenience factory used by Stream E / F to wire up the default
 * ApprovalQueueShim until v1.2 ADR-32 lands. Stream E is welcome to replace
 * `approvalQueue` with the real `ApprovalQueueService` without touching this
 * module by re-exporting `ApprovalQueueShim` as the fallback name here.
 */
export { ApprovalQueueShim };

// Re-export each tool at the module level so tests (Stream I) and route
// handlers (Stream E) can import by name without reaching into sub-modules.
export {
  // memory
  recall,
  remember,
  forget,
  updateMemory,
  // approval management
  listPendingApprovals,
  cancelPendingApproval,
  // followup
  scheduleSelfFollowup,
  cancelFollowup,
  // delegation
  draftEmailToContractor,
  sendEmailToContractor,
  requestQuotesFromSavedContractors,
  forwardBriefingTo,
  // calendar
  proposeCalendarSlots,
  // assign
  assignTaskToMember,
  // garden site plan (AI image)
  createGardenSitePlan,
  startGardenPlanFlow,
  createPendingGardenBoundary,
  listPendingGardenBoundaries,
  editPendingGardenBoundary,
  deletePendingGardenBoundary,
  // attachments
  classifyAndSaveAttachment,
  // tasks
  createMaintenanceTask,
  updateMaintenanceTask,
  rescheduleMaintenanceTask,
  completeMaintenanceTask,
  snoozeMaintenanceTask,
  deleteMaintenanceTask,
  listMaintenanceTasks,
  getMaintenanceTask,
  // voice control
  closeVoiceMode,
  // chat history
  clearChatHistory,
  exportChatHistory,
  // reminders
  listTaskReminders,
  updateTaskReminder,
  // invitations / members
  listHouseholdMembers,
  listPendingInvitations,
  inviteHouseholdMember,
  cancelHouseholdInvitation,
  removeHouseholdMember,
  // notes
  listHouseholdNotes,
  createHouseholdNote,
  updateHouseholdNote,
  deleteHouseholdNote,
  // household settings
  listHouseholdProperties,
  getHouseholdDetails,
  createHouseholdProperty,
  updateHouseholdDetails,
  updateHouseholdProperty,
  deleteHouseholdProperty,
  // spaces
  listSpaces,
  createSpace,
  updateSpace,
  deleteSpace,
  // subscription
  getSubscription,
  openManageSubscription,
  // notification preferences
  getNotificationPreferences,
  updateNotificationPreferences,
  // reports
  listReports,
  getReport,
};
