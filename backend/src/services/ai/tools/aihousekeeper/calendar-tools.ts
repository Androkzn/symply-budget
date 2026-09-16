/**
 * Aihousekeeper calendar tool — plan §4 / §C4.
 *
 * propose_calendar_slots(member_id, duration_min, window_days) → READ
 *
 * Queries Google Calendar free/busy through the injected `GoogleCalendarClient`
 * (Stream G replaces the stub at `services/integrations/google-calendar.ts`
 * with a real OAuth-backed impl). Returns candidate start times in the
 * member's window.
 *
 * Scoped to chat modes: task_assistant, family_chat.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { householdMembers } from '../../../../db/schema';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

// Tunable constants. 30-min granularity keeps the slot list human-sized and
// avoids proposing odd in-between starts.
const SLOT_STRIDE_MIN = 30;
// Only consider slots between 09:00 and 18:00 in the member's local day,
// approximated as UTC here since we don't yet carry per-member timezone. The
// client's identity timezone is the only one we have; we rely on the caller
// to pass reasonable window_days.
const WORK_START_HOUR_UTC = 13; // ~09:00 local for North American users
const WORK_END_HOUR_UTC = 23; // ~18:00 local
const MAX_PROPOSED_SLOTS = 5;

export const proposeCalendarSlots: AihousekeeperTool = {
  name: 'propose_calendar_slots',
  kind: 'READ',
  description:
    'Given a household member and a scheduling window, propose up to 5 candidate start times that do not overlap their Google Calendar busy ranges.',
  input: z.object({
    member_id: z.string().min(1),
    duration_min: z.number().int().positive().max(480),
    window_days: z.number().int().positive().max(60),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    await ctx.householdService.getHousehold(ctx.householdId, ctx.userId);

    // Verify the target member belongs to THIS household. Prevents cross-
    // household calendar queries.
    const member = await ctx.db
      .select({ id: householdMembers.id, user_id: householdMembers.user_id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.id, input.member_id),
          eq(householdMembers.household_id, ctx.householdId),
          isNull(householdMembers.deleted_at)
        )
      )
      .get();
    if (!member) {
      return { ok: false, error: 'member_not_found' };
    }

    const windowStart = new Date();
    const windowEnd = new Date(
      windowStart.getTime() + input.window_days * 86_400_000
    );

    let busy: Array<{ start: string; end: string }> = [];
    try {
      busy = await ctx.integrations.googleCalendar.listBusy(input.member_id, {
        start: windowStart,
        end: windowEnd,
      });
    } catch (err) {
      // Surface OAuth / network problems as a tool-level error rather than
      // crashing the turn. The error name is best-effort; most OAuth clients
      // throw a typed error, but we accept the generic Error signature.
      const message = err instanceof Error ? err.message : 'unknown_error';
      if (
        message.toLowerCase().includes('token') ||
        message.toLowerCase().includes('oauth') ||
        message.toLowerCase().includes('not been implemented')
      ) {
        return { ok: false, error: 'google_calendar_not_connected' };
      }
      return { ok: false, error: 'calendar_fetch_failed' };
    }

    // Build slot candidates: step through the window in SLOT_STRIDE_MIN
    // increments, skip out-of-work-hours, and drop any slot that overlaps a
    // busy range.
    const proposed: string[] = [];
    const durationMs = input.duration_min * 60_000;
    const strideMs = SLOT_STRIDE_MIN * 60_000;

    const alignedStart = alignToStride(windowStart, SLOT_STRIDE_MIN);
    for (
      let t = alignedStart.getTime();
      t + durationMs <= windowEnd.getTime() && proposed.length < MAX_PROPOSED_SLOTS;
      t += strideMs
    ) {
      const slotStart = new Date(t);
      const slotEnd = new Date(t + durationMs);
      const hour = slotStart.getUTCHours();
      if (hour < WORK_START_HOUR_UTC || hour >= WORK_END_HOUR_UTC) continue;
      if (overlapsAny(slotStart, slotEnd, busy)) continue;
      proposed.push(slotStart.toISOString());
    }

    return {
      ok: true,
      member_id: input.member_id,
      duration_min: input.duration_min,
      window: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
      },
      busy_ranges: busy,
      proposed_slots: proposed,
    };
  },
};

function alignToStride(d: Date, strideMin: number): Date {
  const ms = d.getTime();
  const strideMs = strideMin * 60_000;
  return new Date(Math.ceil(ms / strideMs) * strideMs);
}

function overlapsAny(
  start: Date,
  end: Date,
  ranges: Array<{ start: string; end: string }>
): boolean {
  const s = start.getTime();
  const e = end.getTime();
  for (const r of ranges) {
    const rs = Date.parse(r.start);
    const re = Date.parse(r.end);
    if (Number.isNaN(rs) || Number.isNaN(re)) continue;
    if (s < re && rs < e) return true;
  }
  return false;
}

export const calendarTools: readonly AihousekeeperTool[] = [proposeCalendarSlots] as const;
