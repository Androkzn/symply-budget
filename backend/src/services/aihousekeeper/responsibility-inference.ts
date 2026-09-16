/**
 * Aihousekeeper responsibility inference — plan §B9.
 *
 * For each (member, category) pair where the member completed ≥3 tasks in
 * the last 30d AND the category is not in their responsibilities_json AND
 * no active "declined" preference memory exists, write a `preference`
 * memory surfacing the inference. The UI prompts the user with "Should
 * Aihousekeeper learn that {member} usually handles {category}?".
 *
 * The weekly cadence gate lives in Stream F's scheduled() handler; this
 * service implements the per-household work.
 */

import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';

import { householdMembers, tasks } from '../../db/schema';
import type { Database } from '../../types';

import type { MemoryService } from './memory-service';

export interface InferenceCandidate {
  memberId: string;
  userId: string;
  category: string;
  completedCount: number;
}

export class ResponsibilityInferenceRunner {
  private db: Database;
  private memory: MemoryService;

  constructor(params: { db: Database; memory: MemoryService }) {
    this.db = params.db;
    this.memory = params.memory;
  }

  /**
   * Finds inference candidates for the household and writes a
   * `preference` memory per candidate (unless declined / already known).
   * Returns the list of candidates processed.
   */
  async runFor(householdId: string): Promise<InferenceCandidate[]> {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

    // Pull recent completed tasks grouped by (assignee, category).
    const recentByMember = await this.db
      .select({
        assigned_to: tasks.assigned_to,
        category: tasks.system_category,
        count: sql<number>`count(*)`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.household_id, householdId),
          isNotNull(tasks.assigned_to),
          isNotNull(tasks.system_category),
          isNotNull(tasks.last_completed_at),
          gte(tasks.last_completed_at, since)
        )
      )
      .groupBy(tasks.assigned_to, tasks.system_category)
      .all();

    // Member responsibility lookup.
    const members = await this.db
      .select({
        id: householdMembers.id,
        user_id: householdMembers.user_id,
        responsibilities_json: householdMembers.responsibilities_json,
      })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.household_id, householdId),
          isNull(householdMembers.deleted_at)
        )
      )
      .all();
    const memberByUserId = new Map(members.map((m) => [m.user_id, m]));

    // Declined cache (per-household). A `preference` memory whose body
    // starts with 'User declined to auto-learn' suppresses future
    // inference of the same (member, category) pair.
    const existingPreferences = await this.memory.list(householdId, {
      type: 'preference',
      limit: 200,
    });

    const candidates: InferenceCandidate[] = [];
    for (const row of recentByMember) {
      if (!row.assigned_to || !row.category || row.count < 3) continue;
      const category = row.category; // narrow — closure below needs this
      const member = memberByUserId.get(row.assigned_to);
      if (!member) continue;
      const existing = this.parseResponsibilities(member.responsibilities_json);
      if (existing.includes(category)) continue;

      // Already declined?
      const declined = existingPreferences.some((p) => {
        const body = (p.body || '').toLowerCase();
        return (
          body.includes('declined to auto-learn') &&
          body.includes(category.toLowerCase()) &&
          body.includes(member.id.slice(0, 8).toLowerCase())
        );
      });
      if (declined) continue;

      const candidate: InferenceCandidate = {
        memberId: member.id,
        userId: member.user_id,
        category,
        completedCount: row.count,
      };
      candidates.push(candidate);
      await this.memory.write({
        householdId,
        type: 'preference',
        body: `Inferred: member ${member.id.slice(0, 8)} usually handles ${category} (${row.count} tasks/30d).`,
        subjectKind: 'member',
        subjectId: member.id,
        confidence: 0.7,
        source: 'inferred',
        sourceRef: `responsibility_inference:${category}`,
      });
    }
    return candidates;
  }

  private parseResponsibilities(json: string | null): string[] {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === 'string');
      }
      return [];
    } catch {
      return [];
    }
  }
}
