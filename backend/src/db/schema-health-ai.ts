import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

import { users } from './schema';

// ============ SYMPLY HEALTH — parity phase P3 (AI surfaces) ============
// Columns match backend/migrations/0128_health_ai.sql EXACTLY. Ported from the
// donor Worker's Health Coach V2; see documents/apps/symply-health/PARITY_PLAN.md §5 P3.
//
// NOT re-exported from schema.ts — hand-written SQL migrations, same as
// schema-health.ts / schema-health-p2.ts and the budget/savings/mortgage domains.
//
// There is deliberately NO conversation or message table: the donor does not
// persist coach transcripts either (history arrives from the client each turn),
// and the RN offline cache under `health.coach.v1` is already cleared on
// sign-out by HEALTH_CACHE_KEYS. See the migration header.

/**
 * Deny-by-default consent for the AI coach.
 *
 * The donor AUTO-GRANTS every scope on the first turn and says so in a comment
 * ("Remove and surface a real consent gate when the product requires explicit
 * opt-in"). This port does not: no live row with `granted = true` for the
 * required scope means the turn is refused BEFORE any model call.
 */
export const healthCoachConsentReceipts = sqliteTable(
  'health_coach_consent_receipts',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Donor vocabulary. Only `insights` is enforced today — see the migration. */
    scope: text('scope').notNull(),
    granted: integer('granted', { mode: 'boolean' }).notNull().default(false),
    /** Disclosure version this consent was given against; bumping it re-asks. */
    version: text('version').notNull(),
    granted_at: text('granted_at'),
    /** NEW vs the donor, which can only flip `granted` and loses the WHEN. */
    revoked_at: text('revoked_at'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    live: uniqueIndex('idx_health_coach_consent_user_scope').on(t.user_id, t.scope),
    sync: index('idx_health_coach_consent_sync').on(t.user_id, t.updated_at),
  })
);

/**
 * Proposal → commit ledger. The coach may only PROPOSE; the user confirms.
 *
 * `payload_hash` is what makes the confirmation meaningful: the commit route
 * refuses unless the client echoes back the exact hash it was shown, so a
 * reviewed proposal cannot be committed with different numbers. The composite
 * PK `(user_id, operation_id)` is what makes a replay idempotent per user.
 */
export const healthCoachOperations = sqliteTable(
  'health_coach_operations',
  {
    operation_id: text('operation_id').notNull(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * 'water' | 'weight' | 'nutrition' | 'workout' | 'period' | 'habit'
     *
     * The last three arrived with the added coach verbs. Migration 0128 declares
     * this as a bare TEXT with NO CHECK constraint, so widening the vocabulary
     * needed no migration — the authority is `ProposalTargetType` in
     * `services/health-ai/coach-proposals.ts`, enforced by `validateCommit`
     * before anything is written.
     */
    target_type: text('target_type').notNull(),
    target_id: text('target_id').notNull(),
    payload_hash: text('payload_hash').notNull(),
    commit_status: text('commit_status').notNull(),
    expected_target_version: integer('expected_target_version'),
    result_json: text('result_json'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.user_id, t.operation_id] }),
    target: index('idx_health_coach_ops_target').on(t.user_id, t.target_type, t.target_id),
    sync: index('idx_health_coach_ops_sync').on(t.user_id, t.updated_at),
  })
);
