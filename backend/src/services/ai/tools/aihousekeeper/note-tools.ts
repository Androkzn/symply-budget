/**
 * Household shared-notes tools.
 *
 * Notes differ from assistant_memory: memory redacts PII before returning
 * to the LLM, notes are returned verbatim. Use notes for shared household
 * info the family wants Aihousekeeper to recall as written (door codes, wifi,
 * instructions, sticky reminders).
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { householdNotes } from '../../../../db/schema-household-notes';
import { generateId, nowIso } from '../../../../utils/id';
import type { AihousekeeperTool, AihousekeeperToolContext, ToolResult } from '../index';

export const listHouseholdNotes: AihousekeeperTool = {
  name: 'list_household_notes',
  kind: 'READ',
  description:
    'List shared household notes (verbatim free-form notes the family stores for quick recall — door codes, wifi, instructions, sticky reminders). Notes are distinct from memory: memory is redacted, notes are returned as written. Pinned notes come first.',
  input: z.object({
    limit: z.number().int().positive().max(100).optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const rows = await ctx.db
      .select()
      .from(householdNotes)
      .where(
        and(
          eq(householdNotes.household_id, ctx.householdId),
          isNull(householdNotes.deleted_at)
        )
      )
      .orderBy(desc(householdNotes.pinned), desc(householdNotes.updated_at))
      .limit(input.limit ?? 50)
      .all();

    return {
      ok: true,
      count: rows.length,
      notes: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        pinned: Boolean(r.pinned),
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    };
  },
};

export const createHouseholdNote: AihousekeeperTool = {
  name: 'create_household_note',
  kind: 'LOW_WRITE',
  description:
    'Create a shared household note. Use for free-form info the user wants to stick on the household fridge (wifi password, garage code, family instructions). For facts/preferences about people or patterns, use remember instead.',
  input: z.object({
    body: z.string().min(1).max(4000),
    title: z.string().max(120).optional(),
    pinned: z.boolean().optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const id = generateId();
    const ts = nowIso();
    await ctx.db.insert(householdNotes).values({
      id,
      household_id: ctx.householdId,
      created_by: ctx.userId,
      title: input.title ?? null,
      body: input.body,
      pinned: input.pinned ?? false,
      created_at: ts,
      updated_at: ts,
    });
    return {
      ok: true,
      note_id: id,
      title: input.title ?? null,
      body: input.body,
      pinned: input.pinned ?? false,
    };
  },
};

export const updateHouseholdNote: AihousekeeperTool = {
  name: 'update_household_note',
  kind: 'LOW_WRITE',
  description:
    'Update a household note (edit body, rename title, pin/unpin). Resolve note_id from list_household_notes first.',
  input: z.object({
    note_id: z.string().min(1),
    body: z.string().min(1).max(4000).optional(),
    title: z.string().max(120).nullable().optional(),
    pinned: z.boolean().optional(),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const existing = await ctx.db
      .select({ id: householdNotes.id })
      .from(householdNotes)
      .where(
        and(
          eq(householdNotes.id, input.note_id),
          eq(householdNotes.household_id, ctx.householdId),
          isNull(householdNotes.deleted_at)
        )
      )
      .get();
    if (!existing) return { ok: false, error: 'note_not_found' };

    const updates: Record<string, unknown> = {
      updated_at: nowIso(),
    };
    if (input.body !== undefined) updates.body = input.body;
    if (input.title !== undefined) updates.title = input.title;
    if (input.pinned !== undefined) updates.pinned = input.pinned;

    if (Object.keys(updates).length === 1) {
      return { ok: false, error: 'no_fields_provided' };
    }

    await ctx.db
      .update(householdNotes)
      .set(updates)
      .where(eq(householdNotes.id, input.note_id));

    return { ok: true, note_id: input.note_id, updated: updates };
  },
};

export const deleteHouseholdNote: AihousekeeperTool = {
  name: 'delete_household_note',
  kind: 'LOW_WRITE',
  description:
    'Soft-delete a household note. Resolve note_id from list_household_notes first — never ask the user for an id.',
  input: z.object({
    note_id: z.string().min(1),
  }),
  async execute(ctx: AihousekeeperToolContext, input): Promise<ToolResult> {
    const existing = await ctx.db
      .select({ id: householdNotes.id })
      .from(householdNotes)
      .where(
        and(
          eq(householdNotes.id, input.note_id),
          eq(householdNotes.household_id, ctx.householdId),
          isNull(householdNotes.deleted_at)
        )
      )
      .get();
    if (!existing) return { ok: false, error: 'note_not_found' };

    await ctx.db
      .update(householdNotes)
      .set({ deleted_at: nowIso() })
      .where(eq(householdNotes.id, input.note_id));

    return { ok: true, note_id: input.note_id, deleted: true };
  },
};

export const noteTools: readonly AihousekeeperTool[] = [
  listHouseholdNotes,
  createHouseholdNote,
  updateHouseholdNote,
  deleteHouseholdNote,
] as const;
