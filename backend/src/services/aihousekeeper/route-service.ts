import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import * as schema from '../../db/schema';
import {
  assistantBriefings,
  assistantFollowups,
  assistantIdentity,
  aihousekeeperAttachments,
} from '../../db/schema-aihousekeeper';
import type { Env } from '../../types';
import { NotFoundError } from '../../utils/errors';
import { now as nowIso } from '../../utils/id';
import { createDb } from '../db';
import { getHouseholdWeather } from '../weather-service';

import {
  sha256Hex,
  type AihousekeeperEvent,
} from './event-bus';
import { HomeInsightService } from './home-insight-service';
import { buildAihousekeeperStack, getAihousekeeperDb } from './request-stack';

export async function listBriefings(d1: D1Database, householdId: string) {
  const db = createDb(d1);
  return db
    .select()
    .from(assistantBriefings)
    .where(eq(assistantBriefings.household_id, householdId))
    .orderBy(desc(assistantBriefings.date))
    .limit(30)
    .all();
}

export async function getBriefing(d1: D1Database, householdId: string, date: string) {
  const db = createDb(d1);
  const row = await db
    .select()
    .from(assistantBriefings)
    .where(
      and(eq(assistantBriefings.household_id, householdId), eq(assistantBriefings.date, date))
    )
    .get();
  if (!row) throw new NotFoundError('Briefing');
  return row;
}

export async function markBriefingRead(d1: D1Database, householdId: string, date: string) {
  const db = createDb(d1);
  const row = await db
    .select({ id: assistantBriefings.id })
    .from(assistantBriefings)
    .where(
      and(eq(assistantBriefings.household_id, householdId), eq(assistantBriefings.date, date))
    )
    .get();
  if (!row) throw new NotFoundError('Briefing');

  await db
    .update(assistantBriefings)
    .set({ read_at: sql`(datetime('now'))` })
    .where(eq(assistantBriefings.id, row.id));
}

export async function getBriefingWeather(env: Env, householdId: string) {
  return getHouseholdWeather(env, getAihousekeeperDb(env), householdId);
}

export async function getHomeInsight(
  env: Env,
  householdId: string,
  userId: string,
  tz?: string
) {
  const service = new HomeInsightService(env, getAihousekeeperDb(env));
  return service.getInsight(householdId, userId, { tz, nowMs: Date.now() });
}

export async function getOrCreateIdentity(d1: D1Database, householdId: string) {
  const db = createDb(d1);
  let row = await db
    .select()
    .from(assistantIdentity)
    .where(eq(assistantIdentity.household_id, householdId))
    .get();

  if (!row) {
    const ts = nowIso();
    row =
      (await db
        .insert(assistantIdentity)
        .values({
          household_id: householdId,
          created_at: ts,
          updated_at: ts,
        })
        .onConflictDoNothing()
        .returning()
        .get()) ??
      (await db
        .select()
        .from(assistantIdentity)
        .where(eq(assistantIdentity.household_id, householdId))
        .get());
    if (!row) throw new NotFoundError('Aihousekeeper identity');
  }
  return row;
}

export async function patchIdentity(
  d1: D1Database,
  householdId: string,
  update: Record<string, unknown>
) {
  const db = createDb(d1);
  await db
    .update(assistantIdentity)
    .set(update)
    .where(eq(assistantIdentity.household_id, householdId));

  return db
    .select()
    .from(assistantIdentity)
    .where(eq(assistantIdentity.household_id, householdId))
    .get();
}

export async function memoryBelongsToHousehold(
  d1: D1Database,
  householdId: string,
  memoryId: string
): Promise<boolean> {
  const db = createDb(d1);
  const row = await db
    .select({ id: schema.assistantMemory.id })
    .from(schema.assistantMemory)
    .where(
      and(eq(schema.assistantMemory.id, memoryId), eq(schema.assistantMemory.household_id, householdId))
    )
    .get();
  return Boolean(row);
}

export async function ledgerEntryBelongsToHousehold(
  d1: D1Database,
  householdId: string,
  entryId: string
): Promise<boolean> {
  const db = createDb(d1);
  const row = await db
    .select({ id: schema.assistantTrustLedger.id })
    .from(schema.assistantTrustLedger)
    .where(
      and(
        eq(schema.assistantTrustLedger.id, entryId),
        eq(schema.assistantTrustLedger.household_id, householdId)
      )
    )
    .get();
  return Boolean(row);
}

export async function listFollowups(
  d1: D1Database,
  householdId: string,
  status?: string,
  limit?: number
) {
  const db = createDb(d1);
  const conditions = [eq(assistantFollowups.household_id, householdId)];
  if (status) conditions.push(eq(assistantFollowups.status, status));
  return db
    .select()
    .from(assistantFollowups)
    .where(and(...conditions))
    .orderBy(desc(assistantFollowups.scheduled_for))
    .limit(limit ?? 100)
    .all();
}

export async function cancelFollowup(env: Env, householdId: string, id: string) {
  const db = createDb(env.DB);
  const row = await db
    .select()
    .from(assistantFollowups)
    .where(and(eq(assistantFollowups.id, id), eq(assistantFollowups.household_id, householdId)))
    .get();
  if (!row) throw new NotFoundError('Followup');
  if (row.status !== 'pending') {
    return {
      ok: false as const,
      status: 409,
      body: {
        error: {
          code: 'conflict',
          message: `Followup is already ${row.status}`,
        },
      },
    };
  }

  await db
    .update(assistantFollowups)
    .set({ status: 'cancelled', updated_at: nowIso() })
    .where(eq(assistantFollowups.id, id));

  const { events } = buildAihousekeeperStack(env);
  const idem = await sha256Hex(`followup_cancelled:${id}`);
  const event: AihousekeeperEvent = {
    kind: 'decision_made',
    householdId,
    eventIdempotencyKey: idem,
    summary: `Followup cancelled`,
    rationale: `User cancelled followup scheduled for ${row.scheduled_for}.`,
    reversible: false,
  };
  await events.emit(event);
  return { ok: true as const };
}

export async function loadChatAttachments(
  d1: D1Database,
  householdId: string,
  userId: string,
  attachmentIds: string[]
) {
  const db = createDb(d1);
  return db
    .select()
    .from(aihousekeeperAttachments)
    .where(
      and(
        eq(aihousekeeperAttachments.household_id, householdId),
        eq(aihousekeeperAttachments.user_id, userId),
        inArray(aihousekeeperAttachments.id, attachmentIds)
      )
    )
    .all();
}

export async function getAssistantIdentityForChat(d1: D1Database, householdId: string) {
  const db = createDb(d1);
  return db
    .select({ timezone: assistantIdentity.timezone, name: assistantIdentity.name })
    .from(assistantIdentity)
    .where(eq(assistantIdentity.household_id, householdId))
    .get();
}
