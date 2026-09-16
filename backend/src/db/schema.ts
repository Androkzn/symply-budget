import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

// Helper for timestamps
const timestamps = {
  created_at: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updated_at: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
};

const softDelete = {
  deleted_at: text('deleted_at'),
};

const auditFields = {
  ...timestamps,
  ...softDelete,
  // FK applied in DB via 0104 on tables that own this column; keep Drizzle unbound
  // here because `users` also spreads auditFields (self-reference / ordering).
  updated_by: text('updated_by'),
  version: integer('version').notNull().default(1),
};

// ============ USERS ============

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    email_verified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    password_hash: text('password_hash'),
    apple_id: text('apple_id').unique(),
    google_id: text('google_id').unique(),
    display_name: text('display_name'),
    avatar_url: text('avatar_url'),
    terms_accepted_at: text('terms_accepted_at'),
    // Platform role. 'user' is everyone; 'admin' unlocks staff-only switchboards
    // (today: Symply Health's per-feature toggles — see src/config/healthFeatures.ts).
    // Deliberately NOT a household role: household_members.role stays
    // 'owner'/'member' and says nothing about platform privilege.
    role: text('role').notNull().default('user'),
    // Onboarding tracking
    has_completed_onboarding: integer('has_completed_onboarding', { mode: 'boolean' }).notNull().default(false),
    onboarding_household_created: integer('onboarding_household_created', { mode: 'boolean' }).notNull().default(false),
    onboarding_report_added: integer('onboarding_report_added', { mode: 'boolean' }).notNull().default(false),
    onboarding_garbage_setup: integer('onboarding_garbage_setup', { mode: 'boolean' }).notNull().default(false),
    onboarding_floor_plan_added: integer('onboarding_floor_plan_added', { mode: 'boolean' }).notNull().default(false),
    ...auditFields,
  },
  (table) => ({
    email_idx: index('users_email_idx').on(table.email),
    apple_id_idx: index('users_apple_id_idx').on(table.apple_id),
    google_id_idx: index('users_google_id_idx').on(table.google_id),
  })
);

export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token_hash: text('token_hash').notNull().unique(),
    device_info: text('device_info'), // JSON
    expires_at: text('expires_at').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    revoked_at: text('revoked_at'),
  },
  (table) => ({
    user_id_idx: index('refresh_tokens_user_id_idx').on(table.user_id),
    token_hash_idx: uniqueIndex('refresh_tokens_token_hash_idx').on(table.token_hash),
  })
);

export const emailVerifications = sqliteTable(
  'email_verifications',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token_hash: text('token_hash').notNull().unique(),
    expires_at: text('expires_at').notNull(),
    verified_at: text('verified_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('email_verifications_user_id_idx').on(table.user_id),
    token_hash_idx: uniqueIndex('email_verifications_token_hash_idx').on(table.token_hash),
  })
);

export const passwordResets = sqliteTable(
  'password_resets',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token_hash: text('token_hash').notNull().unique(),
    expires_at: text('expires_at').notNull(),
    used_at: text('used_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('password_resets_user_id_idx').on(table.user_id),
    token_hash_idx: uniqueIndex('password_resets_token_hash_idx').on(table.token_hash),
  })
);

// ============ HOUSEHOLDS ============

export const households = sqliteTable(
  'households',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    address_line1: text('address_line1'),
    address_line2: text('address_line2'),
    city: text('city'),
    state_province: text('state_province'),
    postal_code: text('postal_code'),
    country: text('country'), // 'CA' or 'US'
    /**
     * The ONE global "Imperial vs Metric" preference (0142) for this
     * property's room/space size display and entry — 'metric' | 'imperial'.
     * Household-wide, same tier as `country` above: one physical property,
     * one unit system, not a per-member display choice. `household_spaces
     * .area_sqft` stays canonical square feet regardless — this column only
     * controls how a size is displayed and typed. NULL = not set; the client
     * falls back to a country-derived default rather than a guessed value
     * stored here.
     */
    unit_system: text('unit_system'), // 'metric' or 'imperial'
    photo_key: text('photo_key'), // R2 storage key for property photo
    // The owner's REAL purchase price (what they paid), in cents, + the purchase
    // date. Distinct from BC Assessment's assessed value and the notice's public
    // sales history. Nullable — set by the owner, optionally pre-filled from the
    // most recent sale on an imported assessment notice.
    purchase_price: integer('purchase_price'), // in cents
    purchase_date: text('purchase_date'), // ISO 'YYYY-MM-DD'
    ...auditFields,
  },
  (table) => ({
    name_idx: index('households_name_idx').on(table.name),
  })
);

export const householdMembers = sqliteTable(
  'household_members',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'owner' or 'member'
    invited_by: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    joined_at: text('joined_at').notNull(),
    // Aihousekeeper §A6: responsibilities assigned to this member (JSON array of strings).
    responsibilities_json: text('responsibilities_json').notNull().default('[]'),
    // Aihousekeeper §A6: 'auto' | 'push' | 'email' | 'sms' | 'none'
    notification_channel_preference: text('notification_channel_preference')
      .notNull()
      .default('auto'),
    ...timestamps,
    ...softDelete,
  },
  (table) => ({
    household_user_idx: uniqueIndex('household_members_household_user_idx').on(
      table.household_id,
      table.user_id
    ),
    user_id_idx: index('household_members_user_id_idx').on(table.user_id),
  })
);

export const householdInvitations = sqliteTable(
  'household_invitations',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    invited_by: text('invited_by')
      .notNull()
      .references(() => users.id),
    token_hash: text('token_hash').notNull().unique(),
    expires_at: text('expires_at').notNull(),
    accepted_at: text('accepted_at'),
    declined_at: text('declined_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('household_invitations_household_id_idx').on(table.household_id),
    email_idx: index('household_invitations_email_idx').on(table.email),
    token_hash_idx: uniqueIndex('household_invitations_token_hash_idx').on(table.token_hash),
  })
);

// Shareable, non-email-bound invite links. Anyone with the link can open the
// Join screen and submit a join request that a household owner then approves.
// Unlike `householdInvitations` (one email → one accept), a link can yield many
// requests, is bounded by `expires_at` / optional `max_uses`, and is revocable.
export const householdInviteLinks = sqliteTable(
  'household_invite_links',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    // Role granted to members who join via this link (applied on approval).
    role: text('role').notNull().default('member'),
    created_by: text('created_by')
      .notNull()
      .references(() => users.id),
    token_hash: text('token_hash').notNull().unique(),
    // Short, shareable code (`/j/<short_code>`). Alternate identifier for the
    // same link — resolved interchangeably with the raw token.
    short_code: text('short_code').unique(),
    expires_at: text('expires_at').notNull(),
    // null = unlimited. Counts approved joins, not pending requests.
    max_uses: integer('max_uses'),
    use_count: integer('use_count').notNull().default(0),
    revoked_at: text('revoked_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('household_invite_links_household_id_idx').on(table.household_id),
    token_hash_idx: uniqueIndex('household_invite_links_token_hash_idx').on(table.token_hash),
    short_code_idx: uniqueIndex('household_invite_links_short_code_idx').on(table.short_code),
  })
);

// Pending "request to join" submissions created when someone opens a share link.
// Owners approve/deny; approval inserts the corresponding `householdMembers` row.
export const householdJoinRequests = sqliteTable(
  'household_join_requests',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    invite_link_id: text('invite_link_id').references(() => householdInviteLinks.id, {
      onDelete: 'set null',
    }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'denied'
    requested_at: text('requested_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    decided_by: text('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decided_at: text('decided_at'),
  },
  (table) => ({
    household_status_idx: index('household_join_requests_household_status_idx').on(
      table.household_id,
      table.status
    ),
    user_idx: index('household_join_requests_user_idx').on(table.user_id),
  })
);

// ============ REPORTS ============

export const reports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    // Nullable so ON DELETE SET NULL can clear the actor (DATA-6 / 0104).
    uploaded_by: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    filename: text('filename').notNull(),
    file_size: integer('file_size').notNull(),
    file_key: text('file_key').notNull(), // R2 object key
    status: text('status').notNull(), // 'pending_upload', 'uploaded', 'processing', 'completed', 'failed'
    processing_started_at: text('processing_started_at'),
    processing_completed_at: text('processing_completed_at'),
    error_message: text('error_message'),
    page_count: integer('page_count'),
    inspection_date: text('inspection_date'),
    inspector_name: text('inspector_name'),
    property_address: text('property_address'),
    // New fields for enhanced processing
    total_findings_count: integer('total_findings_count').default(0),
    critical_findings_count: integer('critical_findings_count').default(0),
    processing_progress: integer('processing_progress').default(0),
    processing_stage: text('processing_stage'),
    ...auditFields,
  },
  (table) => ({
    household_id_idx: index('reports_household_id_idx').on(table.household_id),
    status_idx: index('reports_status_idx').on(table.status),
    processing_stage_idx: index('reports_processing_stage_idx').on(table.processing_stage),
  })
);

export const reportChunks = sqliteTable(
  'report_chunks',
  {
    id: text('id').primaryKey(),
    report_id: text('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    chunk_index: integer('chunk_index').notNull(),
    page_number: integer('page_number'),
    section_type: text('section_type'),
    content: text('content').notNull(),
    embedding_key: text('embedding_key'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    report_id_idx: index('report_chunks_report_id_idx').on(table.report_id),
    report_chunk_idx: index('report_chunks_report_chunk_idx').on(
      table.report_id,
      table.chunk_index
    ),
  })
);

// ============ FINDINGS ============

export const findings = sqliteTable(
  'findings',
  {
    id: text('id').primaryKey(),
    report_id: text('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    chunk_id: text('chunk_id').references(() => reportChunks.id),
    system_category: text('system_category').notNull(),
    severity: text('severity').notNull(), // 'critical', 'major', 'minor', 'informational'
    title: text('title').notNull(),
    description: text('description').notNull(),
    plain_language_summary: text('plain_language_summary'),
    ai_confidence: real('ai_confidence'),
    evidence_page_numbers: text('evidence_page_numbers'), // JSON array
    raw_ai_output: text('raw_ai_output'),
    // New fields for inspection enhancements
    location_description: text('location_description'),
    urgency_score: integer('urgency_score'), // 1-10 scale
    impact_description: text('impact_description'),
    ...timestamps,
    version: integer('version').notNull().default(1),
  },
  (table) => ({
    report_id_idx: index('findings_report_id_idx').on(table.report_id),
    severity_idx: index('findings_severity_idx').on(table.severity),
    system_category_idx: index('findings_system_category_idx').on(table.system_category),
    urgency_score_idx: index('findings_urgency_score_idx').on(table.urgency_score),
  })
);

// ============ FINDING SPACES (MAPPING) ============

export const findingSpaces = sqliteTable(
  'finding_spaces',
  {
    id: text('id').primaryKey(),
    finding_id: text('finding_id')
      .notNull()
      .references(() => findings.id, { onDelete: 'cascade' }),
    space_id: text('space_id')
      .notNull()
      .references(() => householdSpaces.id, { onDelete: 'cascade' }),
    ai_confidence: real('ai_confidence'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    finding_id_idx: index('finding_spaces_finding_id_idx').on(table.finding_id),
    space_id_idx: index('finding_spaces_space_id_idx').on(table.space_id),
    unique_finding_space: uniqueIndex('finding_spaces_unique_idx').on(
      table.finding_id,
      table.space_id
    ),
  })
);

// ============ REPORT IMAGES ============

export const reportImages = sqliteTable(
  'report_images',
  {
    id: text('id').primaryKey(),
    report_id: text('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    household_id: text('household_id').references(() => households.id, { onDelete: 'cascade' }),
    chunk_id: text('chunk_id').references(() => reportChunks.id, { onDelete: 'set null' }),
    finding_id: text('finding_id').references(() => findings.id, { onDelete: 'set null' }),
    page_number: integer('page_number'),
    image_key: text('image_key').notNull(),
    thumbnail_key: text('thumbnail_key'),
    original_filename: text('original_filename'),
    content_type: text('content_type').default('image/jpeg'),
    file_size: integer('file_size'),
    image_type: text('image_type'), // 'photo' | 'chart' | 'table' | 'diagram' | 'other'
    caption: text('caption'),
    ai_description: text('ai_description'),
    ai_confidence: real('ai_confidence'),
    system_category: text('system_category'),
    finding_ids: text('finding_ids'), // JSON array for multiple findings
    tags: text('tags'), // JSON array of tags
    position_x: real('position_x'),
    position_y: real('position_y'),
    extraction_method: text('extraction_method'), // 'pdf_native' | 'pdf_render' | 'ocr' | 'manual_upload'
    extraction_confidence: real('extraction_confidence'),
    status: text('status').default('ready'), // 'processing' | 'ready' | 'failed' | 'deleted'
    error_message: text('error_message'),
    width: integer('width'),
    height: integer('height'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at').default(sql`(datetime('now'))`),
  },
  (table) => ({
    report_id_idx: index('report_images_report_id_idx').on(table.report_id),
    household_id_idx: index('report_images_household_id_idx').on(table.household_id),
    finding_id_idx: index('report_images_finding_id_idx').on(table.finding_id),
    page_number_idx: index('report_images_page_number_idx').on(table.page_number),
    status_idx: index('report_images_status_idx').on(table.status),
    system_category_idx: index('report_images_system_category_idx').on(table.system_category),
  })
);

// ============ REPORT SUMMARIES ============

export const reportSummaries = sqliteTable(
  'report_summaries',
  {
    id: text('id').primaryKey(),
    report_id: text('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    summary_type: text('summary_type').notNull(), // 'executive' | 'novice' | 'diy' | 'technical'
    overall_condition: text('overall_condition'), // 'excellent' | 'good' | 'fair' | 'poor'
    key_concerns: text('key_concerns'), // JSON array
    immediate_actions: text('immediate_actions'), // JSON array
    estimated_total_cost_min: integer('estimated_total_cost_min'),
    estimated_total_cost_max: integer('estimated_total_cost_max'),
    summary_text: text('summary_text').notNull(),
    generated_at: text('generated_at').notNull(),
    ai_model_version: text('ai_model_version'),
    prompt_version: text('prompt_version'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    version: integer('version').notNull().default(1),
  },
  (table) => ({
    report_id_idx: index('report_summaries_report_id_idx').on(table.report_id),
    summary_type_idx: index('report_summaries_type_idx').on(table.summary_type),
    unique_report_type: uniqueIndex('report_summaries_report_type_idx').on(
      table.report_id,
      table.summary_type
    ),
  })
);

// ============ HOUSEHOLD SPACES ============

export const householdSpaces = sqliteTable(
  'household_spaces',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    // Space identification
    name: text('name').notNull(),
    space_type: text('space_type').notNull(), // 'preset' | 'custom'

    // Categorization
    category: text('category'), // 'indoor' | 'outdoor' | 'garage' | 'basement' | 'attic'
    floor_level: integer('floor_level'), // -1 (basement), 0 (ground), 1, 2, etc.

    // Visual representation
    icon_emoji: text('icon_emoji'),
    icon_color: text('icon_color'), // hex color
    custom_image_key: text('custom_image_key'), // R2 storage key

    // Organization
    display_order: integer('display_order').notNull().default(0),

    // Metadata
    description: text('description'),
    area_sqft: integer('area_sqft'),

    // Floor plan placement (FK enforced in SQL migration; no cross-schema ref here)
    floor_plan_id: text('floor_plan_id'),
    plan_x_percent: real('plan_x_percent'),
    plan_y_percent: real('plan_y_percent'),
    plan_width_percent: real('plan_width_percent'),
    plan_height_percent: real('plan_height_percent'),

    ...auditFields,
  },
  (table) => ({
    household_id_idx: index('household_spaces_household_id_idx').on(table.household_id),
    display_order_idx: index('household_spaces_display_order_idx').on(
      table.household_id,
      table.display_order
    ),
  })
);

// ============ MAINTENANCE ============

// Task workflow stages for contractor hiring process
export const TASK_WORKFLOW_STAGES = [
  'planning',           // Initial state, deciding what needs to be done
  'getting_quotes',     // Requesting quotes from contractors
  'comparing_quotes',   // Have quotes, comparing options
  'quote_selected',     // Selected a quote, ready to schedule
  'scheduled',          // Work scheduled with contractor
  'in_progress',        // Contractor working on task
  'completed',          // Work finished
  'cancelled'           // Task cancelled
] as const;

export type TaskWorkflowStage = (typeof TASK_WORKFLOW_STAGES)[number];

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    space_id: text('space_id').references(() => householdSpaces.id, { onDelete: 'set null' }),
    system_category: text('system_category'),
    title: text('title').notNull(),
    description: text('description'),
    frequency: text('frequency').notNull(), // 'one_time', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'
    custom_interval_days: integer('custom_interval_days'),
    next_due_date: text('next_due_date'),
    last_completed_at: text('last_completed_at'),
    assigned_to: text('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    reminder_days_before: integer('reminder_days_before'),
    is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    source: text('source'), // 'manual', 'ai_generated', 'template'

    // Reminder fields (added by migration 0011)
    reminder_enabled: integer('reminder_enabled', { mode: 'boolean' }).default(true),
    reminder_time: text('reminder_time').default('09:00'),
    reminder_repeat: integer('reminder_repeat', { mode: 'boolean' }).default(true),
    last_reminder_sent_at: text('last_reminder_sent_at'),
    reminder_claimed_at: text('reminder_claimed_at'),
    reminder_attempt_count: integer('reminder_attempt_count').notNull().default(0),
    snooze_until: text('snooze_until'),

    // Suggestion tracking fields (added by migration 0011)
    // Note: FK constraints handled by migration, not Drizzle (to avoid circular deps)
    suggested_by: text('suggested_by'), // 'system' | 'report' | 'user' | 'template'
    home_feature_id: text('home_feature_id'),
    template_id: text('template_id'),
    suggestion_reason: text('suggestion_reason'),
    why_important: text('why_important'),
    neglect_consequences: text('neglect_consequences'),

    // Contractor and quote management fields
    needs_contractor: integer('needs_contractor', { mode: 'boolean' }).default(false),
    contractor_category: text('contractor_category'), // plumber, electrician, hvac, etc.
    workflow_stage: text('workflow_stage').default('planning'),
    scheduled_work_date: text('scheduled_work_date'),
    scheduled_work_time_start: text('scheduled_work_time_start'),
    scheduled_work_time_end: text('scheduled_work_time_end'),
    selected_quote_id: text('selected_quote_id'),
    linked_project_id: text('linked_project_id'),

    // Priority/severity: nice_to_have | low | medium | high | urgent | critical
    priority_severity: text('priority_severity').default('nice_to_have').notNull(),

    // ===== Smart Task Assistant (added by migration 00XX) =====
    // Risk is assessed independently of priority: a low-priority task can carry
    // high risk (e.g. an overheating router that could start a fire). Enum:
    // 'low' | 'medium' | 'high' | 'critical'. Null until AI enrichment runs.
    risk_level: text('risk_level'),
    // Effort/skill required: 'trivial' | 'simple' | 'moderate' | 'involved' | 'expert'.
    complexity: text('complexity'),
    // Coarse "how long will this take" tier (see services/time-effort.ts):
    // 'quick' | 'short' | 'medium' | 'half_day' | 'all_day'. Null until AI
    // enrichment runs. Replaced the old estimated_minutes (dropped in migration
    // 0080) — the planner maps a tier to representative minutes when packing its
    // "what can I do in N minutes?" budget.
    time_effort: text('time_effort'),
    // Short human-readable explanation of the risk/priority call, surfaced in
    // the UI for transparency.
    ai_rationale: text('ai_rationale'),
    // Async enrichment lifecycle: 'pending' (just captured, awaiting AI) |
    // 'enriching' (job in flight) | 'enriched' (done) | 'failed' (gave up).
    // Tasks created manually (not via quick-capture) stay null = "no enrichment".
    // 'needs_clarification' = the AI couldn't make sense of raw_capture_text
    // (gibberish, transcription noise, too vague) and is asking the user a
    // question instead of fabricating a task. clarification_question holds it.
    enrichment_status: text('enrichment_status'),
    enrichment_error: text('enrichment_error'),
    enrichment_attempts: integer('enrichment_attempts').default(0),
    enriched_at: text('enriched_at'),
    clarification_question: text('clarification_question'),
    // Raw user-supplied text (voice transcript or typed) the AI enriches from.
    raw_capture_text: text('raw_capture_text'),

    // ===== Purchase → planned-spending suggestion (added by migration 0066) =====
    // AI enrichment flags a task that requires buying something (is_purchase)
    // plus a rough cost range in CENTS, so the app can offer an OPTIONAL "add to
    // planned spending" chip. Nothing is ever auto-added to the budget.
    is_purchase: integer('is_purchase', { mode: 'boolean' }).default(false),
    purchase_estimated_cost_min: integer('purchase_estimated_cost_min'), // cents
    purchase_estimated_cost_max: integer('purchase_estimated_cost_max'), // cents
    // User tapped "dismiss" on the suggestion — stop showing the chip for this task.
    purchase_suggestion_dismissed: integer('purchase_suggestion_dismissed', {
      mode: 'boolean',
    }).default(false),
    // Set to the budget_items.id when the user accepts the suggestion. Convenience
    // pointer powering the chip's "added ✓" state; cleared if that item is deleted.
    budget_item_id: text('budget_item_id'),

    // ===== Blockers (added by migration 0056) =====
    // A household member can flag a task as blocked (waiting on a part, a quote,
    // someone else, etc.). Blocked tasks surface to the household and pause the
    // "overdue" nagging until resolved.
    blocked: integer('blocked', { mode: 'boolean' }).default(false),
    blocker_reason: text('blocker_reason'),
    blocked_at: text('blocked_at'),
    blocked_by: text('blocked_by').references(() => users.id, { onDelete: 'set null' }),

    // ===== Personal tasks (added by migration 0064) =====
    // Personal tasks are visible only to the user who created them.
    // Other household members cannot see, edit, or delete personal tasks.
    is_personal: integer('is_personal', { mode: 'boolean' }).notNull().default(false),
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),

    /** FK to task_photos — image shown on task cards. */
    cover_photo_id: text('cover_photo_id'),

    ...auditFields,
  },
  (table) => ({
    household_id_idx: index('maintenance_tasks_household_id_idx').on(table.household_id),
    priority_severity_idx: index('maintenance_tasks_priority_severity_idx').on(table.priority_severity),
    next_due_date_idx: index('maintenance_tasks_next_due_date_idx').on(table.next_due_date),
    is_active_idx: index('maintenance_tasks_is_active_idx').on(table.is_active),
    space_id_idx: index('maintenance_tasks_space_id_idx').on(table.space_id),
    reminder_idx: index('maintenance_tasks_reminder_idx').on(table.reminder_enabled, table.next_due_date),
    feature_idx: index('maintenance_tasks_feature_idx').on(table.home_feature_id),
    template_idx: index('maintenance_tasks_template_idx').on(table.template_id),
    workflow_stage_idx: index('maintenance_tasks_workflow_stage_idx').on(table.workflow_stage),
    needs_contractor_idx: index('maintenance_tasks_needs_contractor_idx').on(table.needs_contractor),
    // Lets the enrichment stuck-row sweep scan only in-flight rows cheaply.
    enrichment_status_idx: index('maintenance_tasks_enrichment_status_idx').on(table.enrichment_status),
    risk_level_idx: index('maintenance_tasks_risk_level_idx').on(table.risk_level),
    blocked_idx: index('maintenance_tasks_blocked_idx').on(table.blocked),
  })
);

export const taskPhotos = sqliteTable(
  'task_photos',
  {
    id: text('id').primaryKey(),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    photo_key: text('photo_key').notNull(),
    sort_order: integer('sort_order').notNull().default(0),
    ...auditFields,
  },
  (table) => ({
    task_id_idx: index('task_photos_task_id_idx').on(table.task_id),
    household_id_idx: index('task_photos_household_id_idx').on(table.household_id),
  })
);

export const maintenanceCompletions = sqliteTable(
  'maintenance_completions',
  {
    id: text('id').primaryKey(),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    completed_by: text('completed_by')
      .notNull()
      .references(() => users.id),
    completed_at: text('completed_at').notNull(),
    notes: text('notes'),
    photo_keys: text('photo_keys'), // JSON array of R2 keys
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    task_id_idx: index('maintenance_completions_task_id_idx').on(table.task_id),
    completed_at_idx: index('maintenance_completions_completed_at_idx').on(table.completed_at),
  })
);

// ============ MAINTENANCE SUBTASKS ============

export const maintenanceSubtasks = sqliteTable(
  'maintenance_subtasks',
  {
    id: text('id').primaryKey(),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),

    // Content
    title: text('title').notNull(),
    description: text('description'),

    // Ordering for user-defined sequence
    sort_order: integer('sort_order').notNull().default(0),

    // Simple completion tracking (boolean, not separate table)
    is_completed: integer('is_completed', { mode: 'boolean' }).notNull().default(false),
    completed_at: text('completed_at'),
    completed_by: text('completed_by').references(() => users.id, { onDelete: 'set null' }),

    // Optional independent reminders
    reminder_enabled: integer('reminder_enabled', { mode: 'boolean' }).default(false),
    reminder_days_before: integer('reminder_days_before').default(1),
    reminder_time: text('reminder_time').default('09:00'),
    reminder_date: text('reminder_date'),

    // Audit fields
    ...timestamps,
    updated_by: text('updated_by'),
    deleted_at: text('deleted_at'), // Soft delete support
  },
  (table) => ({
    task_id_idx: index('maintenance_subtasks_task_id_idx').on(table.task_id),
    task_order_idx: index('maintenance_subtasks_task_order_idx').on(table.task_id, table.sort_order),
    completed_idx: index('maintenance_subtasks_completed_idx').on(table.is_completed),
    reminder_idx: index('maintenance_subtasks_reminder_idx').on(table.reminder_enabled, table.reminder_date),
    updated_idx: index('maintenance_subtasks_updated_idx').on(table.updated_at),
  })
);

// ============ MAINTENANCE TASK NOTES (activity feed) ============

// Household-visible activity on a task: free-text progress updates, blocker
// reports, and resolutions. Lets members "see progress" and coordinate
// (Smart Task Assistant household sharing). Added by migration 0056.
export const maintenanceTaskNotes = sqliteTable(
  'maintenance_task_notes',
  {
    id: text('id').primaryKey(),
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    author_id: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    // 'progress' | 'blocker' | 'resolution'
    kind: text('kind').notNull().default('progress'),
    body: text('body').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    task_id_idx: index('maintenance_task_notes_task_id_idx').on(table.task_id),
    created_at_idx: index('maintenance_task_notes_created_at_idx').on(table.created_at),
  })
);

// ============ PROCESSING JOBS ============

export const processingJobs = sqliteTable(
  'processing_jobs',
  {
    id: text('id').primaryKey(),
    report_id: text('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    job_type: text('job_type').notNull(), // 'extraction', 'summary', 'action_plan'
    status: text('status').notNull(), // 'queued', 'processing', 'completed', 'failed', 'retrying'
    attempts: integer('attempts').notNull().default(0),
    max_attempts: integer('max_attempts').notNull().default(3),
    last_error: text('last_error'),
    started_at: text('started_at'),
    completed_at: text('completed_at'),
    // AI Access Migration — actor / audit (nullable for legacy rows)
    initiated_by_user_id: text('initiated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    access_source: text('access_source'),
    provider: text('provider'),
    required_capability: text('required_capability'),
    selected_model_id: text('selected_model_id'),
    ...timestamps,
  },
  (table) => ({
    report_id_idx: index('processing_jobs_report_id_idx').on(table.report_id),
    status_idx: index('processing_jobs_status_idx').on(table.status),
    initiated_by_user_id_idx: index('processing_jobs_initiated_by_user_id_idx').on(
      table.initiated_by_user_id
    ),
  })
);

// ============ SUBSCRIPTIONS ============

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .unique(),
    tier: text('tier').notNull(), // 'free', 'basic', 'premium', 'enterprise'
    status: text('status').notNull(), // 'active', 'canceled', 'past_due', 'trialing'
    stripe_customer_id: text('stripe_customer_id'),
    stripe_subscription_id: text('stripe_subscription_id'),
    // RevenueCat / Apple IAP (AI Access Migration)
    provider: text('provider'), // 'revenuecat' | legacy stripe null
    entitlement_id: text('entitlement_id'), // 'pro'
    store_environment: text('store_environment'), // sandbox | production
    revenuecat_app_user_id: text('revenuecat_app_user_id'),
    revenuecat_product_id: text('revenuecat_product_id'),
    billing_state: text('billing_state').default('normal'), // normal | grace | paused
    current_period_start: text('current_period_start').notNull(),
    current_period_end: text('current_period_end').notNull(),
    cancel_at_period_end: integer('cancel_at_period_end', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    user_id_idx: uniqueIndex('subscriptions_user_id_idx').on(table.user_id),
    stripe_customer_id_idx: index('subscriptions_stripe_customer_id_idx').on(table.stripe_customer_id),
    entitlement_id_idx: index('subscriptions_entitlement_id_idx').on(table.entitlement_id),
    revenuecat_app_user_id_idx: index('subscriptions_revenuecat_app_user_id_idx').on(
      table.revenuecat_app_user_id
    ),
  })
);

// ============ AUDIT LOG ============

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').references(() => users.id),
    action: text('action').notNull(),
    entity_type: text('entity_type').notNull(),
    entity_id: text('entity_id').notNull(),
    metadata: text('metadata'), // JSON
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('audit_log_user_id_idx').on(table.user_id),
    action_idx: index('audit_log_action_idx').on(table.action),
    entity_idx: index('audit_log_entity_idx').on(table.entity_type, table.entity_id),
    created_at_idx: index('audit_log_created_at_idx').on(table.created_at),
  })
);

// ============ TASK DRAFTS ============

export const taskDrafts = sqliteTable(
  'task_drafts',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    report_id: text('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    finding_id: text('finding_id').references(() => findings.id, { onDelete: 'set null' }),

    // Task Info
    title: text('title').notNull(),
    description: text('description'),
    plain_language_summary: text('plain_language_summary'),

    // Categorization
    system_category: text('system_category').notNull(),
    severity: text('severity').notNull(),
    priority_score: integer('priority_score'),

    // Scheduling Suggestions
    suggested_timeframe: text('suggested_timeframe'),
    suggested_frequency: text('suggested_frequency'),
    is_recurring_suggestion: integer('is_recurring_suggestion', { mode: 'boolean' }).default(false),

    // Cost Estimates
    estimated_cost_min: integer('estimated_cost_min'),
    estimated_cost_max: integer('estimated_cost_max'),
    diy_possible: integer('diy_possible', { mode: 'boolean' }).default(false),
    diy_difficulty: text('diy_difficulty'),
    diy_cost_min: integer('diy_cost_min'),
    diy_cost_max: integer('diy_cost_max'),

    // Evidence
    source_page_numbers: text('source_page_numbers'), // JSON array
    source_quotes: text('source_quotes'), // JSON array
    image_ids: text('image_ids'), // JSON array

    // Status
    status: text('status').default('draft'),
    converted_to_task_id: text('converted_to_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    dismissed_reason: text('dismissed_reason'),
    dismissed_at: text('dismissed_at'),
    converted_at: text('converted_at'),

    ...timestamps,
  },
  (table) => ({
    household_id_idx: index('task_drafts_household_id_idx').on(table.household_id),
    report_id_idx: index('task_drafts_report_id_idx').on(table.report_id),
    finding_id_idx: index('task_drafts_finding_id_idx').on(table.finding_id),
    status_idx: index('task_drafts_status_idx').on(table.status),
    severity_idx: index('task_drafts_severity_idx').on(table.severity),
    category_idx: index('task_drafts_category_idx').on(table.system_category),
  })
);

// ============ HOME FEATURES ============

export const homeFeatures = sqliteTable(
  'home_features',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    // Feature identification
    feature_type: text('feature_type').notNull(),
    feature_subtype: text('feature_subtype'),
    quantity: integer('quantity').default(1),
    location: text('location'),

    // Details
    brand: text('brand'),
    model: text('model'),
    serial_number: text('serial_number'),
    install_date: text('install_date'),
    warranty_expires: text('warranty_expires'),
    age_years: integer('age_years'),
    condition: text('condition'),
    notes: text('notes'),

    // Source tracking
    source: text('source').default('manual'),
    source_report_id: text('source_report_id').references(() => reports.id, { onDelete: 'set null' }),
    extraction_confidence: real('extraction_confidence'),

    ...timestamps,
    ...softDelete,
  },
  (table) => ({
    household_id_idx: index('home_features_household_id_idx').on(table.household_id),
    feature_type_idx: index('home_features_feature_type_idx').on(table.feature_type),
  })
);

// ============ MAINTENANCE TEMPLATES ============

export const maintenanceTemplates = sqliteTable(
  'maintenance_templates',
  {
    id: text('id').primaryKey(),

    // Template Info
    title: text('title').notNull(),
    description: text('description'),
    plain_language_description: text('plain_language_description'),

    // Matching Rules
    feature_type: text('feature_type').notNull(),
    feature_subtype: text('feature_subtype'),
    climate_zone: text('climate_zone'),
    home_age_min: integer('home_age_min'),
    home_age_max: integer('home_age_max'),

    // Schedule
    frequency: text('frequency').notNull(),
    best_season: text('best_season'),
    best_month: integer('best_month'),

    // Task Details
    system_category: text('system_category').notNull(),
    estimated_duration_minutes: integer('estimated_duration_minutes'),
    diy_difficulty: text('diy_difficulty'),
    professional_recommended: integer('professional_recommended', { mode: 'boolean' }).default(false),
    estimated_cost_min: integer('estimated_cost_min'),
    estimated_cost_max: integer('estimated_cost_max'),
    diy_cost_min: integer('diy_cost_min'),
    diy_cost_max: integer('diy_cost_max'),

    // Educational Content
    why_important: text('why_important'),
    neglect_consequences: text('neglect_consequences'),
    how_to_steps: text('how_to_steps'), // JSON array
    tools_needed: text('tools_needed'), // JSON array
    materials_needed: text('materials_needed'), // JSON array
    safety_warnings: text('safety_warnings'), // JSON array
    video_url: text('video_url'),
    article_url: text('article_url'),

    // Metadata
    source: text('source').default('system'),
    is_active: integer('is_active', { mode: 'boolean' }).default(true),
    priority_weight: integer('priority_weight').default(50),
    ...timestamps,
  },
  (table) => ({
    feature_type_idx: index('maintenance_templates_feature_type_idx').on(table.feature_type),
    frequency_idx: index('maintenance_templates_frequency_idx').on(table.frequency),
    category_idx: index('maintenance_templates_category_idx').on(table.system_category),
  })
);

// ============ MAINTENANCE SUGGESTIONS ============

export const maintenanceSuggestions = sqliteTable(
  'maintenance_suggestions',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    home_feature_id: text('home_feature_id')
      .notNull()
      .references(() => homeFeatures.id, { onDelete: 'cascade' }),
    template_id: text('template_id')
      .notNull()
      .references(() => maintenanceTemplates.id, { onDelete: 'cascade' }),

    // Suggestion details
    title: text('title').notNull(),
    description: text('description'),
    frequency: text('frequency').notNull(),
    suggested_start_date: text('suggested_start_date'),

    // Status
    status: text('status').default('pending'),
    accepted_at: text('accepted_at'),
    dismissed_at: text('dismissed_at'),
    dismissed_reason: text('dismissed_reason'),
    snooze_until: text('snooze_until'),

    // If accepted, link to created task
    created_task_id: text('created_task_id').references(() => tasks.id, { onDelete: 'set null' }),

    ...timestamps,
  },
  (table) => ({
    household_id_idx: index('maintenance_suggestions_household_id_idx').on(table.household_id),
    status_idx: index('maintenance_suggestions_status_idx').on(table.status),
    feature_id_idx: index('maintenance_suggestions_feature_id_idx').on(table.home_feature_id),
  })
);

// ============ SCHEDULED NOTIFICATIONS ============

export const scheduledNotifications = sqliteTable(
  'scheduled_notifications',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Reference to source
    task_id: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),

    // Notification details
    notification_type: text('notification_type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: text('data'), // JSON payload

    // Schedule
    scheduled_for: text('scheduled_for').notNull(),
    sent_at: text('sent_at'),
    failed_at: text('failed_at'),
    failure_reason: text('failure_reason'),

    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('scheduled_notifications_user_id_idx').on(table.user_id),
    scheduled_for_idx: index('scheduled_notifications_scheduled_for_idx').on(table.scheduled_for),
    task_id_idx: index('scheduled_notifications_task_id_idx').on(table.task_id),
  })
);

// ============ PLATFORM BRIDGE (Data Bridge Phase A1) ============
// Shared User / joined-platform identity, auth, entitlements, Soft Transfer,
// bridge control, and deletion. See migration 0092_shared_user_entitlements.sql
// and documents/design/Ecosystem_Data_Bridge_Plan.md §3.

export const platformIdentityLinks = sqliteTable(
  'platform_identity_links',
  {
    id: text('id').primaryKey(),
    link_type: text('link_type').notNull(),
    link_value: text('link_value').notNull(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    type_value_idx: uniqueIndex('platform_identity_links_type_value_idx').on(
      table.link_type,
      table.link_value
    ),
    user_id_idx: index('platform_identity_links_user_id_idx').on(table.user_id),
  })
);

export const platformProfiles = sqliteTable('platform_profiles', {
  user_id: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  display_name: text('display_name'),
  avatar_url: text('avatar_url'),
  contact_email: text('contact_email'),
  contact_email_verified: integer('contact_email_verified', { mode: 'boolean' })
    .notNull()
    .default(false),
  locale: text('locale'),
  timezone: text('timezone'),
  profile_version: integer('profile_version').notNull().default(1),
  created_at: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updated_at: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const platformCredentials = sqliteTable(
  'platform_credentials',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    password_hash: text('password_hash').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: uniqueIndex('platform_credentials_user_id_idx').on(table.user_id),
  })
);

export const platformRefreshTokens = sqliteTable(
  'platform_refresh_tokens',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token_hash: text('token_hash').notNull(),
    sid: text('sid').notNull(),
    client_id: text('client_id').notNull(),
    ent_ver: integer('ent_ver').notNull().default(1),
    device_info: text('device_info'),
    expires_at: text('expires_at').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    revoked_at: text('revoked_at'),
  },
  (table) => ({
    token_hash_idx: uniqueIndex('platform_refresh_tokens_token_hash_idx').on(table.token_hash),
    user_id_idx: index('platform_refresh_tokens_user_id_idx').on(table.user_id),
    sid_idx: index('platform_refresh_tokens_sid_idx').on(table.sid),
  })
);

export const platformIdpChallenges = sqliteTable(
  'platform_idp_challenges',
  {
    id: text('id').primaryKey(),
    nonce_hash: text('nonce_hash').notNull(),
    caller_brand: text('caller_brand').notNull(),
    environment: text('environment').notNull(),
    provider: text('provider').notNull(),
    intent: text('intent').notNull(),
    expires_at: text('expires_at').notNull(),
    consumed_at: text('consumed_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    nonce_hash_idx: uniqueIndex('platform_idp_challenges_nonce_hash_idx').on(table.nonce_hash),
    expires_at_idx: index('platform_idp_challenges_expires_at_idx').on(table.expires_at),
  })
);

export const userAppEntitlements = sqliteTable(
  'user_app_entitlements',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    brand_id: text('brand_id').notNull(),
    entitlement_version: integer('entitlement_version').notNull().default(1),
    status: text('status').notNull().default('revoked'),
    revocation_pending: integer('revocation_pending', { mode: 'boolean' }).notNull().default(false),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_brand_idx: uniqueIndex('user_app_entitlements_user_brand_idx').on(
      table.user_id,
      table.brand_id
    ),
    brand_id_idx: index('user_app_entitlements_brand_id_idx').on(table.brand_id),
  })
);

export const userEntitlements = sqliteTable('user_entitlements', {
  user_id: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  ai_master_enabled: integer('ai_master_enabled', { mode: 'boolean' }).notNull().default(false),
  ai_status: text('ai_status').notNull().default('off'),
  ai_mode: text('ai_mode').notNull().default('platform'),
  created_at: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updated_at: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const platformBridgeControl = sqliteTable('platform_bridge_control', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_at: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const platformProfileOutbox = sqliteTable(
  'platform_profile_outbox',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    profile_version: integer('profile_version').notNull(),
    payload_json: text('payload_json').notNull(),
    delivered_at: text('delivered_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('platform_profile_outbox_user_id_idx').on(table.user_id),
  })
);

export const platformProfileMirrors = sqliteTable(
  'platform_profile_mirrors',
  {
    user_id: text('user_id').notNull(),
    brand_id: text('brand_id').notNull(),
    profile_version: integer('profile_version').notNull(),
    payload_json: text('payload_json').notNull(),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.user_id, table.brand_id] }),
  })
);

export const platformSessionRevocations = sqliteTable(
  'platform_session_revocations',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sid: text('sid').notNull(),
    reason: text('reason').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    delivered_at: text('delivered_at'),
  },
  (table) => ({
    sid_idx: index('platform_session_revocations_sid_idx').on(table.sid),
    user_id_idx: index('platform_session_revocations_user_id_idx').on(table.user_id),
  })
);

export const platformSessionRevocationOutbox = sqliteTable(
  'platform_session_revocation_outbox',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull(),
    sid: text('sid').notNull(),
    target_brand_id: text('target_brand_id').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    delivered_at: text('delivered_at'),
  }
);

export const transferConsents = sqliteTable(
  'transfer_consents',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source_brand_id: text('source_brand_id').notNull(),
    destination_brand_id: text('destination_brand_id').notNull(),
    package_id: text('package_id').notNull(),
    purpose: text('purpose').notNull(),
    consent_version: integer('consent_version').notNull().default(1),
    status: text('status').notNull().default('active'),
    expires_at: text('expires_at'),
    revoked_at: text('revoked_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('transfer_consents_user_id_idx').on(table.user_id),
    package_idx: index('transfer_consents_package_idx').on(
      table.user_id,
      table.package_id,
      table.status
    ),
  })
);

export const tokenExchangeJtis = sqliteTable(
  'token_exchange_jtis',
  {
    jti_hash: text('jti_hash').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    operation_id: text('operation_id').notNull(),
    package_id: text('package_id').notNull(),
    source_brand_id: text('source_brand_id').notNull(),
    destination_brand_id: text('destination_brand_id').notNull(),
    expires_at: text('expires_at').notNull(),
    consumed_at: text('consumed_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    operation_id_idx: index('token_exchange_jtis_operation_id_idx').on(table.operation_id),
    expires_at_idx: index('token_exchange_jtis_expires_at_idx').on(table.expires_at),
  })
);

export const transferImportReceipts = sqliteTable(
  'transfer_import_receipts',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    operation_id: text('operation_id').notNull(),
    idempotency_fingerprint: text('idempotency_fingerprint').notNull(),
    package_id: text('package_id').notNull(),
    source_brand_id: text('source_brand_id').notNull(),
    destination_brand_id: text('destination_brand_id').notNull(),
    consent_id: text('consent_id').references(() => transferConsents.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('imported'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    operation_id_idx: uniqueIndex('transfer_import_receipts_operation_id_idx').on(
      table.operation_id
    ),
    idempotency_idx: uniqueIndex('transfer_import_receipts_idempotency_idx').on(
      table.idempotency_fingerprint
    ),
    user_id_idx: index('transfer_import_receipts_user_id_idx').on(table.user_id),
  })
);

export const transferPackageEvents = sqliteTable(
  'transfer_package_events',
  {
    id: text('id').primaryKey(),
    package_id: text('package_id').notNull(),
    package_version: integer('package_version').notNull().default(1),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source_brand_id: text('source_brand_id').notNull(),
    destination_brand_id: text('destination_brand_id').notNull(),
    consent_id: text('consent_id').references(() => transferConsents.id, { onDelete: 'set null' }),
    operation_id: text('operation_id'),
    event_type: text('event_type').notNull(),
    event_status: text('event_status').notNull(),
    envelope_id_hash: text('envelope_id_hash'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('transfer_package_events_user_id_idx').on(table.user_id),
    operation_id_idx: index('transfer_package_events_operation_id_idx').on(table.operation_id),
    consent_id_idx: index('transfer_package_events_consent_id_idx').on(table.consent_id),
  })
);

export const transferOnboardingContexts = sqliteTable(
  'transfer_onboarding_contexts',
  {
    id: text('id').primaryKey(),
    context_hash: text('context_hash').notNull(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    brand_id: text('brand_id').notNull(),
    purpose: text('purpose'),
    expires_at: text('expires_at').notNull(),
    consumed_at: text('consumed_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    hash_idx: uniqueIndex('transfer_onboarding_contexts_hash_idx').on(table.context_hash),
    user_id_idx: index('transfer_onboarding_contexts_user_id_idx').on(table.user_id),
    expires_at_idx: index('transfer_onboarding_contexts_expires_at_idx').on(table.expires_at),
  })
);

export const transferPrepareOperations = sqliteTable(
  'transfer_prepare_operations',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    idempotency_fingerprint: text('idempotency_fingerprint').notNull(),
    package_id: text('package_id').notNull(),
    source_brand_id: text('source_brand_id').notNull(),
    destination_brand_id: text('destination_brand_id').notNull(),
    consent_id: text('consent_id').references(() => transferConsents.id, { onDelete: 'set null' }),
    operation_id: text('operation_id').notNull(),
    status: text('status').notNull().default('prepared'),
    expires_at: text('expires_at').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    idempotency_idx: uniqueIndex('transfer_prepare_operations_idempotency_idx').on(
      table.idempotency_fingerprint
    ),
    operation_id_idx: uniqueIndex('transfer_prepare_operations_operation_id_idx').on(
      table.operation_id
    ),
    user_id_idx: index('transfer_prepare_operations_user_id_idx').on(table.user_id),
    expires_at_idx: index('transfer_prepare_operations_expires_at_idx').on(table.expires_at),
  })
);

export const platformDeletionRequests = sqliteTable(
  'platform_deletion_requests',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    idempotency_fingerprint: text('idempotency_fingerprint').notNull(),
    status_secret_hash: text('status_secret_hash').notNull(),
    pepper_version: text('pepper_version').notNull(),
    state: text('state').notNull().default('pending'),
    terminal_at: text('terminal_at'),
    status_expires_at: text('status_expires_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    idempotency_idx: uniqueIndex('platform_deletion_requests_idempotency_idx').on(
      table.idempotency_fingerprint
    ),
    status_secret_idx: uniqueIndex('platform_deletion_requests_status_secret_idx').on(
      table.status_secret_hash
    ),
    user_id_idx: index('platform_deletion_requests_user_id_idx').on(table.user_id),
    state_idx: index('platform_deletion_requests_state_idx').on(table.state),
  })
);

export const platformDeletionOutbox = sqliteTable(
  'platform_deletion_outbox',
  {
    id: text('id').primaryKey(),
    request_id: text('request_id')
      .notNull()
      .references(() => platformDeletionRequests.id, { onDelete: 'cascade' }),
    target_brand_id: text('target_brand_id').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    delivered_at: text('delivered_at'),
    terminal_state: text('terminal_state'),
  },
  (table) => ({
    request_id_idx: index('platform_deletion_outbox_request_id_idx').on(table.request_id),
  })
);

export const platformRequestIdempotency = sqliteTable(
  'platform_request_idempotency',
  {
    idempotency_fingerprint: text('idempotency_fingerprint').primaryKey(),
    route_key: text('route_key').notNull(),
    user_id: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    request_fingerprint: text('request_fingerprint').notNull(),
    response_status: integer('response_status'),
    response_body_hash: text('response_body_hash'),
    expires_at: text('expires_at').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    expires_at_idx: index('platform_request_idempotency_expires_at_idx').on(table.expires_at),
    route_key_idx: index('platform_request_idempotency_route_key_idx').on(table.route_key),
  })
);

// Export settings table
export { settings } from './schema-settings';

// Queue ops — DLQ drain audit (migration 0099).
export { queueDlqRecords } from './schema-queue-ops';
export type { QueueDlqRecord, NewQueueDlqRecord } from './schema-queue-ops';

// Aihousekeeper (Proactive Layer) tables — see schema-aihousekeeper.ts and migrations 0035–0041.
export {
  assistantIdentity,
  assistantMemory,
  assistantFollowups,
  assistantBriefings,
  assistantOutboundLog,
  assistantTrustLedger,
  googleCalendarTokens,
  aihousekeeperAttachments,
} from './schema-aihousekeeper';

// v1.2 ai_chat tables (Aihousekeeper's carve-out) — see schema-ai-chat.ts and migration 0034.
export { aiToolPending } from './schema-ai-chat';

// Export types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type Household = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;
export type HouseholdMember = typeof householdMembers.$inferSelect;
export type NewHouseholdMember = typeof householdMembers.$inferInsert;
export type HouseholdInvitation = typeof householdInvitations.$inferSelect;
export type HouseholdInviteLink = typeof householdInviteLinks.$inferSelect;
export type NewHouseholdInviteLink = typeof householdInviteLinks.$inferInsert;
export type HouseholdJoinRequest = typeof householdJoinRequests.$inferSelect;
export type NewHouseholdJoinRequest = typeof householdJoinRequests.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskPhoto = typeof taskPhotos.$inferSelect;
export type NewTaskPhoto = typeof taskPhotos.$inferInsert;
export type ProcessingJob = typeof processingJobs.$inferSelect;
export type NewProcessingJob = typeof processingJobs.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type HouseholdSpace = typeof householdSpaces.$inferSelect;
export type NewHouseholdSpace = typeof householdSpaces.$inferInsert;
export type TaskDraft = typeof taskDrafts.$inferSelect;
export type NewTaskDraft = typeof taskDrafts.$inferInsert;
export type HomeFeature = typeof homeFeatures.$inferSelect;
export type NewHomeFeature = typeof homeFeatures.$inferInsert;
export type MaintenanceTemplate = typeof maintenanceTemplates.$inferSelect;
export type NewMaintenanceTemplate = typeof maintenanceTemplates.$inferInsert;
export type MaintenanceSuggestion = typeof maintenanceSuggestions.$inferSelect;
export type NewMaintenanceSuggestion = typeof maintenanceSuggestions.$inferInsert;
export type ScheduledNotification = typeof scheduledNotifications.$inferSelect;
export type NewScheduledNotification = typeof scheduledNotifications.$inferInsert;

export type PlatformIdentityLink = typeof platformIdentityLinks.$inferSelect;
export type NewPlatformIdentityLink = typeof platformIdentityLinks.$inferInsert;
export type PlatformProfile = typeof platformProfiles.$inferSelect;
export type NewPlatformProfile = typeof platformProfiles.$inferInsert;
export type PlatformCredential = typeof platformCredentials.$inferSelect;
export type NewPlatformCredential = typeof platformCredentials.$inferInsert;
export type PlatformRefreshToken = typeof platformRefreshTokens.$inferSelect;
export type NewPlatformRefreshToken = typeof platformRefreshTokens.$inferInsert;
export type PlatformIdpChallenge = typeof platformIdpChallenges.$inferSelect;
export type NewPlatformIdpChallenge = typeof platformIdpChallenges.$inferInsert;
export type UserAppEntitlement = typeof userAppEntitlements.$inferSelect;
export type NewUserAppEntitlement = typeof userAppEntitlements.$inferInsert;
export type UserEntitlement = typeof userEntitlements.$inferSelect;
export type NewUserEntitlement = typeof userEntitlements.$inferInsert;
export type PlatformBridgeControl = typeof platformBridgeControl.$inferSelect;
export type NewPlatformBridgeControl = typeof platformBridgeControl.$inferInsert;
export type TransferConsent = typeof transferConsents.$inferSelect;
export type NewTransferConsent = typeof transferConsents.$inferInsert;
export type TokenExchangeJti = typeof tokenExchangeJtis.$inferSelect;
export type NewTokenExchangeJti = typeof tokenExchangeJtis.$inferInsert;
export type TransferImportReceipt = typeof transferImportReceipts.$inferSelect;
export type NewTransferImportReceipt = typeof transferImportReceipts.$inferInsert;
export type TransferPackageEvent = typeof transferPackageEvents.$inferSelect;
export type NewTransferPackageEvent = typeof transferPackageEvents.$inferInsert;
export type TransferOnboardingContext = typeof transferOnboardingContexts.$inferSelect;
export type NewTransferOnboardingContext = typeof transferOnboardingContexts.$inferInsert;
export type TransferPrepareOperation = typeof transferPrepareOperations.$inferSelect;
export type NewTransferPrepareOperation = typeof transferPrepareOperations.$inferInsert;
export type PlatformDeletionRequest = typeof platformDeletionRequests.$inferSelect;
export type NewPlatformDeletionRequest = typeof platformDeletionRequests.$inferInsert;
export type PlatformRequestIdempotency = typeof platformRequestIdempotency.$inferSelect;
export type NewPlatformRequestIdempotency = typeof platformRequestIdempotency.$inferInsert;

// Aihousekeeper (Proactive Layer) — see schema-aihousekeeper.ts.
export type {
  AssistantIdentity,
  NewAssistantIdentity,
  AssistantMemory,
  NewAssistantMemory,
  AssistantFollowup,
  NewAssistantFollowup,
  AssistantBriefing,
  NewAssistantBriefing,
  AssistantOutboundLogEntry,
  NewAssistantOutboundLogEntry,
  AssistantTrustLedgerEntry,
  NewAssistantTrustLedgerEntry,
} from './schema-aihousekeeper';

export type {
  AIToolPending,
  NewAIToolPending,
  AIToolPendingStatus,
} from './schema-ai-chat';

export { householdNotes } from './schema-household-notes';
export type { HouseholdNote, NewHouseholdNote } from './schema-household-notes';

// AI usage / cost telemetry — one row per AI request. See schema-ai-usage.ts
// and migration 0073_ai_usage_events.sql.
export { aiUsageEvents } from './schema-ai-usage';
export type { AiUsageEventRow, NewAiUsageEventRow } from './schema-ai-usage';

export {
  userAiCredentials,
  userAiPreferences,
  aiCredentialAudit,
  aiCredentialLeases,
  revenuecatWebhookEvents,
} from './schema-ai-credentials';
export type {
  UserAiCredential,
  NewUserAiCredential,
  UserAiPreference,
  NewUserAiPreference,
} from './schema-ai-credentials';

// Household chat — multi-room messaging + AI assistant. See schema-chat.ts and
// migration 0053_household_chat.sql.
export { chatRooms, chatMessages, chatRoomReads, chatRoomParticipants } from './schema-chat';
export type {
  ChatRoom,
  NewChatRoom,
  ChatMessage,
  NewChatMessage,
  ChatRoomRead,
  NewChatRoomRead,
  ChatRoomParticipant,
  NewChatRoomParticipant,
} from './schema-chat';

// Budget household chat — a 100%-independent fork of the House chat, owned by
// the Symply Budget app. Separate tables (budget_chat_*). See
// schema-budget-chat.ts and migration 0091_budget_chat.sql.
export {
  budgetChatRooms,
  budgetChatMessages,
  budgetChatRoomReads,
  budgetChatRoomParticipants,
} from './schema-budget-chat';
export type {
  BudgetChatRoom,
  NewBudgetChatRoom,
  BudgetChatMessage,
  NewBudgetChatMessage,
  BudgetChatRoomRead,
  NewBudgetChatRoomRead,
  BudgetChatRoomParticipant,
  NewBudgetChatRoomParticipant,
} from './schema-budget-chat';

// Wishes — long-term dreams / household wishlist with a chat/feed of entries
// (notes, photos, links). Distinct from savings goals + budget items. See
// schema-wishes.ts and migration 0076_wishes.sql.
export { wishes, wishEntries } from './schema-wishes';
export type { Wish, NewWish, WishEntry, NewWishEntry } from './schema-wishes';

// Home Projects — household renovation / improvement planning (not Labor Hub).
export {
  homeProjects,
  homeProjectSpaces,
  homeProjectBudgetLines,
  homeProjectSelections,
  homeProjectPhases,
  homeProjectMilestones,
  homeProjectBlockers,
  homeProjectAttachments,
  homeProjectPlanLinks,
  homeProjectGeometry,
  homeProjectComments,
  homeProjectActivity,
  // `homeProjectTasks` was here until migration 0170 folded the link into
  // `home_projects.linked_task_ids`.
  homeProjectContractors,
} from './schema-home-projects';
export type {
  HomeProject,
  NewHomeProject,
  HomeProjectSelection,
  HomeProjectBudgetLine,
  HomeProjectPhase,
  HomeProjectMilestone,
  HomeProjectBlocker,
  HomeProjectAttachment,
  HomeProjectPlanLink,
  HomeProjectGeometry,
  HomeProjectComment,
  HomeProjectActivityRow,
} from './schema-home-projects';

// Neighbours — the homes around this property and the people in them. Re-exported
// so `drizzle(d1, { schema })` resolves the three tables from the same barrel
// every other House service already imports.
export { neighbourhoods, neighbours, neighbourPeople } from './schema-neighbours';
export {
  NEIGHBOUR_RELATIONS,
  NEIGHBOUR_PLACE_SOURCES,
  NEIGHBOUR_PERSON_ROLES,
} from './schema-neighbours';
export type {
  NeighbourRelation,
  NeighbourPlaceSource,
  NeighbourPersonRole,
} from './schema-neighbours';
