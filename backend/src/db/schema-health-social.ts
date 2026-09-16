import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { users } from './schema';

// ============ SYMPLY HEALTH — parity phase P4: SOCIAL ============
// Columns match backend/migrations/0121_health_social.sql EXACTLY.
//
// SHIPS DISABLED: `routes/health-social.ts` 404s the whole surface unless
// CONFIG_KV `health_social_enabled` === 'true'. See the migration header and
// documents/apps/symply-health/migration.md ("sharing is denied by default").
//
// NOT re-exported from schema.ts — hand-written SQL migrations, same as
// schema-health.ts / schema-health-p2.ts and the budget/savings/mortgage domains.
//
// Drizzle cannot express SQLite PARTIAL unique indexes, so the
// `WHERE deleted_at IS NULL` unique indexes of 0121 are declared here as plain
// `uniqueIndex` for name parity only. The migration is the source of truth; no
// code path relies on drizzle emitting this DDL (we never `drizzle-kit push`
// these tables).

export const healthFamilies = sqliteTable(
  'health_families',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    owner_id: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    owner: uniqueIndex('idx_health_families_owner_active').on(t.owner_id),
    sync: index('idx_health_families_sync').on(t.owner_id, t.updated_at),
  })
);

export const healthFamilyMembers = sqliteTable(
  'health_family_members',
  {
    id: text('id').primaryKey(),
    family_id: text('family_id')
      .notNull()
      .references(() => healthFamilies.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'owner' | 'member'
    role: text('role').notNull().default('member'),
    joined_at: text('joined_at').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    user: uniqueIndex('idx_health_family_members_user_active').on(t.user_id),
    family: index('idx_health_family_members_family').on(t.family_id, t.deleted_at),
    sync: index('idx_health_family_members_sync').on(t.user_id, t.updated_at),
  })
);

/**
 * `invitee_id` is resolved server-side when the address happens to belong to an
 * account, but it is NEVER serialised back to the inviter — echoing it would
 * answer "is this email registered?".
 */
export const healthFamilyInvitations = sqliteTable(
  'health_family_invitations',
  {
    id: text('id').primaryKey(),
    family_id: text('family_id')
      .notNull()
      .references(() => healthFamilies.id, { onDelete: 'cascade' }),
    inviter_id: text('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    invitee_id: text('invitee_id'),
    invitee_email: text('invitee_email').notNull(),
    // 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'
    status: text('status').notNull().default('pending'),
    message: text('message'),
    invite_code: text('invite_code').notNull(),
    responded_at: text('responded_at'),
    expires_at: text('expires_at').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    code: uniqueIndex('idx_health_family_invites_code').on(t.invite_code),
    email: index('idx_health_family_invites_email').on(t.invitee_email, t.status),
    family: index('idx_health_family_invites_family').on(t.family_id, t.status),
    sync: index('idx_health_family_invites_sync').on(t.inviter_id, t.updated_at),
  })
);

/**
 * A buddy request is addressed to an EMAIL, not a user id — one code path (and
 * one invariant response) covers "already a user" and "not yet a user".
 */
export const healthBuddies = sqliteTable(
  'health_buddies',
  {
    id: text('id').primaryKey(),
    requester_id: text('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipient_email: text('recipient_email').notNull(),
    recipient_id: text('recipient_id'),
    // 'pending' | 'accepted' | 'declined'
    status: text('status').notNull().default('pending'),
    message: text('message'),
    responded_at: text('responded_at'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    pair: uniqueIndex('idx_health_buddies_pair_active').on(t.requester_id, t.recipient_email),
    recipient: index('idx_health_buddies_recipient').on(t.recipient_id, t.status),
    email: index('idx_health_buddies_email').on(t.recipient_email, t.status),
    sync: index('idx_health_buddies_sync').on(t.requester_id, t.updated_at),
  })
);

export const healthCommunityTopics = sqliteTable(
  'health_community_topics',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    // 'nutrition' | 'fitness' | 'recipes' | 'motivation' | 'tips' | 'general' | 'challenges'
    category: text('category').notNull(),
    icon: text('icon'),
    color: text('color'),
    creator_id: text('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    is_locked: integer('is_locked', { mode: 'boolean' }).notNull().default(false),
    message_count: integer('message_count').notNull().default(0),
    participant_count: integer('participant_count').notNull().default(1),
    last_message_at: text('last_message_at'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    category: index('idx_health_community_topics_category').on(t.category, t.last_message_at),
    sync: index('idx_health_community_topics_sync').on(t.creator_id, t.updated_at),
  })
);

export const healthCommunityParticipants = sqliteTable(
  'health_community_participants',
  {
    id: text('id').primaryKey(),
    topic_id: text('topic_id')
      .notNull()
      .references(() => healthCommunityTopics.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'creator' | 'moderator' | 'member'
    role: text('role').notNull().default('member'),
    last_read_at: text('last_read_at'),
    joined_at: text('joined_at').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    active: uniqueIndex('idx_health_community_participants_active').on(t.topic_id, t.user_id),
    user: index('idx_health_community_participants_user').on(t.user_id, t.deleted_at),
    sync: index('idx_health_community_participants_sync').on(t.user_id, t.updated_at),
  })
);

/** TEXT ONLY — no `data_json` attachment; see the migration header. */
export const healthCommunityMessages = sqliteTable(
  'health_community_messages',
  {
    id: text('id').primaryKey(),
    topic_id: text('topic_id')
      .notNull()
      .references(() => healthCommunityTopics.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    reply_to_id: text('reply_to_id'),
    is_edited: integer('is_edited', { mode: 'boolean' }).notNull().default(false),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    topic: index('idx_health_community_messages_topic').on(t.topic_id, t.created_at),
    sync: index('idx_health_community_messages_sync').on(t.user_id, t.updated_at),
  })
);

/** `metric` is constrained (in SQL) to the grantable scopes — never cycle/vitality/body. */
export const healthChallenges = sqliteTable(
  'health_challenges',
  {
    id: text('id').primaryKey(),
    creator_id: text('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    // 'activity' | 'nutrition' | 'weight' | 'water' | 'habits' | 'sleep'
    metric: text('metric').notNull(),
    target_value: real('target_value').notNull(),
    unit: text('unit').notNull().default('unit'),
    // 'daily' | 'weekly'
    frequency: text('frequency').notNull().default('daily'),
    // 'public' | 'family' | 'buddies'
    visibility: text('visibility').notNull().default('family'),
    start_date: text('start_date').notNull(),
    end_date: text('end_date'),
    is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    participant_count: integer('participant_count').notNull().default(1),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    active: index('idx_health_challenges_active').on(t.is_active, t.start_date),
    sync: index('idx_health_challenges_sync').on(t.creator_id, t.updated_at),
  })
);

export const healthChallengeParticipants = sqliteTable(
  'health_challenge_participants',
  {
    id: text('id').primaryKey(),
    challenge_id: text('challenge_id')
      .notNull()
      .references(() => healthChallenges.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joined_at: text('joined_at').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    active: uniqueIndex('idx_health_challenge_participants_active').on(t.challenge_id, t.user_id),
    user: index('idx_health_challenge_participants_user').on(t.user_id, t.deleted_at),
    sync: index('idx_health_challenge_participants_sync').on(t.user_id, t.updated_at),
  })
);

/** Private like every other health row: visible to a peer only through a grant. */
export const healthChallengeProgress = sqliteTable(
  'health_challenge_progress',
  {
    id: text('id').primaryKey(),
    challenge_id: text('challenge_id')
      .notNull()
      .references(() => healthChallenges.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    value: real('value').notNull().default(0),
    target_value: real('target_value').notNull(),
    is_completed: integer('is_completed', { mode: 'boolean' }).notNull().default(false),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    active: uniqueIndex('idx_health_challenge_progress_active').on(
      t.challenge_id,
      t.user_id,
      t.date
    ),
    user: index('idx_health_challenge_progress_user').on(t.user_id, t.date),
    sync: index('idx_health_challenge_progress_sync').on(t.user_id, t.updated_at),
  })
);

/**
 * THE SCOPED GRANT — the only row type that can make one user's health data
 * readable by another.
 *
 * EXPLICIT (no row, no read) · SCOPED (one metric group per row, hard SQL
 * allowlist that cannot express cycle/vitality/body) · REVOCABLE (`revoked_at`
 * stamped in place, so the next read fails while the audit trail survives).
 */
export const healthMetricShares = sqliteTable(
  'health_metric_shares',
  {
    id: text('id').primaryKey(),
    owner_id: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewer_id: text('viewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'family' | 'buddy'
    relationship_type: text('relationship_type').notNull(),
    relationship_id: text('relationship_id').notNull(),
    // 'activity' | 'nutrition' | 'weight' | 'water' | 'habits' | 'sleep'
    scope: text('scope').notNull(),
    granted_at: text('granted_at').notNull(),
    revoked_at: text('revoked_at'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    grant: uniqueIndex('idx_health_metric_shares_grant').on(
      t.owner_id,
      t.viewer_id,
      t.relationship_type,
      t.scope
    ),
    viewer: index('idx_health_metric_shares_viewer').on(t.viewer_id, t.owner_id, t.revoked_at),
    relationship: index('idx_health_metric_shares_relationship').on(
      t.relationship_type,
      t.relationship_id
    ),
    sync: index('idx_health_metric_shares_sync').on(t.owner_id, t.updated_at),
  })
);
