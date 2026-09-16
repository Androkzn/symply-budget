/**
 * Aihousekeeper family router — plan §B8.
 *
 * Picks an assignee for a task from the household's members based on:
 *   - Exact match on member `responsibilities_json` (+1.0)
 *   - Fuzzy / synonym match (+0.5)
 *   - Recent task count in the same category (+0.3 × count)
 *
 * Tiebreaker is the most recent `joined_at` (schema doesn't have
 * last_active_at; documented fallback — revisit when members track activity).
 *
 * Fallback to household owner if no member scored above 0.
 */

import { and, eq, gte, isNull, sql } from 'drizzle-orm';

import { householdMembers, tasks } from '../../db/schema';
import type { Database } from '../../types';

import {
  exactCategoryMatch,
  fuzzyCategoryMatch,
} from './category-synonyms';

export interface RoutingDecision {
  memberId: string;
  reason: string;
  confidence: number;
}

export interface PickAssigneeOpts {
  excludeMemberIds?: string[];
}

export class FamilyRouter {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async pickAssignee(
    householdId: string,
    taskCategory: string,
    opts: PickAssigneeOpts = {}
  ): Promise<RoutingDecision> {
    const exclude = new Set(opts.excludeMemberIds ?? []);

    // Fetch all live members with their responsibilities.
    const members = await this.db
      .select({
        id: householdMembers.id,
        user_id: householdMembers.user_id,
        role: householdMembers.role,
        joined_at: householdMembers.joined_at,
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

    const candidates = members.filter((m) => !exclude.has(m.id));
    if (candidates.length === 0) {
      throw new Error(
        `FamilyRouter: no eligible members for household ${householdId.slice(0, 8)}`
      );
    }

    // Precompute recent-category-task-count in the last 30 days.
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const recentCounts = await this.db
      .select({
        assigned_to: tasks.assigned_to,
        count: sql<number>`count(*)`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.household_id, householdId),
          eq(tasks.system_category, taskCategory),
          gte(tasks.created_at, since)
        )
      )
      .groupBy(tasks.assigned_to)
      .all();
    const recentCountByUserId = new Map<string, number>();
    for (const row of recentCounts) {
      if (row.assigned_to) recentCountByUserId.set(row.assigned_to, row.count);
    }

    // Score each candidate.
    let bestScore = 0;
    let bestCandidate: (typeof candidates)[number] | null = null;
    let bestReason = '';
    for (const m of candidates) {
      const responsibilities = this.parseResponsibilities(m.responsibilities_json);
      let score = 0;
      const parts: string[] = [];
      if (exactCategoryMatch(taskCategory, responsibilities)) {
        score += 1.0;
        parts.push(`exact match on "${taskCategory}"`);
      } else if (fuzzyCategoryMatch(taskCategory, responsibilities)) {
        score += 0.5;
        parts.push(`fuzzy match on "${taskCategory}"`);
      }
      const recentCount = recentCountByUserId.get(m.user_id) ?? 0;
      if (recentCount > 0) {
        score += 0.3 * recentCount;
        parts.push(`${recentCount} recent ${taskCategory} task(s)`);
      }
      if (
        score > bestScore ||
        (score === bestScore &&
          bestCandidate &&
          m.joined_at > bestCandidate.joined_at)
      ) {
        bestScore = score;
        bestCandidate = m;
        bestReason = parts.length > 0 ? parts.join('; ') : '';
      }
    }

    if (bestCandidate && bestScore > 0) {
      return {
        memberId: bestCandidate.id,
        reason: bestReason,
        confidence: Math.min(1.0, bestScore / 1.5),
      };
    }

    // Fallback: owner.
    const owner = candidates.find((c) => c.role === 'owner') ?? candidates[0];
    return {
      memberId: owner.id,
      reason: `Defaulting to household owner — no member has declared "${taskCategory}".`,
      confidence: 0.1,
    };
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
