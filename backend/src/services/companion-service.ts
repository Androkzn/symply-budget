/**
 * House companion read-only data access (Track A / A4).
 */
import { and, eq, gte, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import * as schema from '../db/schema';

export interface CompanionTaskSummary {
  id: string;
  title: string;
  next_due_date: string | null;
  is_active: boolean;
  updated_at: string;
}

export async function listRecentCompanionTasks(
  d1: D1Database,
  householdId: string,
  days: number,
): Promise<CompanionTaskSummary[]> {
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();
  const db = drizzle(d1, { schema });
  const tasks = await db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      next_due_date: schema.tasks.next_due_date,
      is_active: schema.tasks.is_active,
      updated_at: schema.tasks.updated_at,
    })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.household_id, householdId),
        isNull(schema.tasks.deleted_at),
        gte(schema.tasks.updated_at, sinceIso),
      ),
    )
    .all()
    .catch(() => []);

  return tasks.slice(0, 50);
}
