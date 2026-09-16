/**
 * BYOK + AI access preference schema (AI Access Migration).
 */

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { users } from './schema';

const timestamps = {
  created_at: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updated_at: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
};

export const userAiCredentials = sqliteTable(
  'user_ai_credentials',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    key_version: text('key_version').notNull(),
    key_hint: text('key_hint').notNull(),
    status: text('status').notNull().default('pending_validation'),
    last_validated_at: text('last_validated_at'),
    last_used_at: text('last_used_at'),
    last_error_code: text('last_error_code'),
    // Hybrid storage: device Keychain is the durable home; this server copy is a
    // short-lived, encrypted session lease that expires (re-leased on foreground).
    expires_at: text('expires_at'),
    session_leased: integer('session_leased', { mode: 'boolean' }).notNull().default(false),
    // Per-provider data-sharing consent (Apple 5.1.2(i)): the explicit, logged
    // acknowledgement the user gave on Connect before any data was sent to this
    // third-party provider. `consent_version` bumps when the disclaimer materially
    // changes (forces re-consent). Cleared with the row on disconnect → the flag
    // genuinely resets, so reconnecting always re-prompts. See
    // documents/engineering/ai-provider-consent-legal.md.
    consent_version: text('consent_version'),
    consent_at: text('consent_at'),
    ...timestamps,
  },
  (table) => ({
    user_provider_idx: uniqueIndex('user_ai_credentials_user_provider_idx').on(
      table.user_id,
      table.provider
    ),
    user_id_idx: index('user_ai_credentials_user_id_idx').on(table.user_id),
  })
);

export const userAiPreferences = sqliteTable('user_ai_preferences', {
  user_id: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  credential_source: text('credential_source'),
  active_provider: text('active_provider'),
  selected_model_id: text('selected_model_id'),
  allow_paid_fallback: integer('allow_paid_fallback', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
});

/**
 * Per-provider chosen model. `user_ai_preferences.selected_model_id` is a single
 * global field (the active provider's model); this table remembers each provider's
 * pick so switching the active provider restores its own model instead of resetting.
 * Absent row → resolves to the provider's flagship (BYOK) or default (managed).
 */
export const userAiProviderModels = sqliteTable(
  'user_ai_provider_models',
  {
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    selected_model_id: text('selected_model_id').notNull(),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_provider_pk: uniqueIndex('user_ai_provider_models_user_provider_idx').on(
      table.user_id,
      table.provider
    ),
  })
);

export const aiCredentialAudit = sqliteTable(
  'ai_credential_audit',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    action: text('action').notNull(),
    result: text('result'),
    request_id: text('request_id'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('ai_credential_audit_user_id_idx').on(table.user_id),
    created_at_idx: index('ai_credential_audit_created_at_idx').on(table.created_at),
  })
);

export const aiCredentialLeases = sqliteTable(
  'ai_credential_leases',
  {
    token_hash: text('token_hash').primaryKey(),
    job_id: text('job_id').notNull(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    required_capability: text('required_capability'),
    selected_model_id: text('selected_model_id'),
    expires_at: text('expires_at').notNull(),
    consumed_at: text('consumed_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    job_id_idx: index('ai_credential_leases_job_id_idx').on(table.job_id),
    expires_at_idx: index('ai_credential_leases_expires_at_idx').on(table.expires_at),
  })
);

export const revenuecatWebhookEvents = sqliteTable(
  'revenuecat_webhook_events',
  {
    id: text('id').primaryKey(),
    event_id: text('event_id').notNull().unique(),
    event_type: text('event_type').notNull(),
    app_user_id: text('app_user_id'),
    processed_at: text('processed_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    event_id_idx: index('revenuecat_webhook_events_event_id_idx').on(table.event_id),
  })
);

export type UserAiCredential = typeof userAiCredentials.$inferSelect;
export type NewUserAiCredential = typeof userAiCredentials.$inferInsert;
export type UserAiPreference = typeof userAiPreferences.$inferSelect;
export type NewUserAiPreference = typeof userAiPreferences.$inferInsert;
export type UserAiProviderModel = typeof userAiProviderModels.$inferSelect;
export type NewUserAiProviderModel = typeof userAiProviderModels.$inferInsert;
