import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { households, users, reports, tasks } from './schema';
import { contractors, contractorVisits } from './schema-contractors';

// ============ APPOINTMENT TYPES & STATUSES ============

export const APPOINTMENT_TYPES = [
  'consultation',
  'quote',
  'work',
  'multi_day_project',
  'inspection',
  'follow_up',
  'warranty',
  'emergency',
] as const;

export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'rescheduled',
  'no_show',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_TYPE_INFO: Record<AppointmentType, { label: string; icon: string; color: string }> = {
  consultation: { label: 'Initial Consultation', icon: '💬', color: '#5856D6' },
  quote: { label: 'Quote/Estimate Visit', icon: '📋', color: '#FF9500' },
  work: { label: 'Scheduled Work', icon: '🔧', color: '#007AFF' },
  multi_day_project: { label: 'Multi-Day Project', icon: '🏗️', color: '#34C759' },
  inspection: { label: 'Inspection', icon: '🔍', color: '#5AC8FA' },
  follow_up: { label: 'Follow-up', icon: '🔄', color: '#AF52DE' },
  warranty: { label: 'Warranty Service', icon: '🛡️', color: '#FF2D55' },
  emergency: { label: 'Emergency Call', icon: '🚨', color: '#FF3B30' },
};

// ============ APPOINTMENTS ============

export const appointments = sqliteTable(
  'appointments',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    contractor_id: text('contractor_id')
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // AppointmentType
    title: text('title').notNull(),
    description: text('description'),
    scheduled_date: text('scheduled_date').notNull(),
    scheduled_time_start: text('scheduled_time_start'),
    scheduled_time_end: text('scheduled_time_end'),
    status: text('status').notNull().default('pending'), // AppointmentStatus
    location: text('location'), // specific location in home
    estimated_duration_minutes: integer('estimated_duration_minutes'),
    actual_arrival_time: text('actual_arrival_time'),
    actual_departure_time: text('actual_departure_time'),
    notes: text('notes'),
    reminder_sent: integer('reminder_sent', { mode: 'boolean' }).default(false),
    calendar_event_id: text('calendar_event_id'), // iOS Calendar integration
    // Links to other entities
    linked_quote_id: text('linked_quote_id'),
    linked_visit_id: text('linked_visit_id').references(() => contractorVisits.id, { onDelete: 'set null' }),
    linked_report_id: text('linked_report_id').references(() => reports.id, { onDelete: 'set null' }),
    linked_task_id: text('linked_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    linked_project_id: text('linked_project_id'), // Will reference projects table
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('appointments_household_id_idx').on(table.household_id),
    contractor_id_idx: index('appointments_contractor_id_idx').on(table.contractor_id),
    scheduled_date_idx: index('appointments_scheduled_date_idx').on(table.scheduled_date),
    status_idx: index('appointments_status_idx').on(table.status),
    type_idx: index('appointments_type_idx').on(table.type),
    linked_project_idx: index('appointments_linked_project_idx').on(table.linked_project_id),
  })
);

// ============ QUOTE STATUSES ============

export const QUOTE_STATUSES = [
  'requested',
  'received',
  'reviewing',
  'accepted',
  'declined',
  'expired',
] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

// ============ QUOTES ============

export const quotes = sqliteTable(
  'quotes',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    contractor_id: text('contractor_id')
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    appointment_id: text('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    amount_cents: integer('amount_cents'),
    amount_range_low_cents: integer('amount_range_low_cents'),
    amount_range_high_cents: integer('amount_range_high_cents'),
    valid_until: text('valid_until'),
    estimated_duration: text('estimated_duration'), // e.g., "2-3 days"
    warranty_terms: text('warranty_terms'),
    status: text('status').notNull().default('requested'), // QuoteStatus
    document_key: text('document_key'), // R2 storage key
    notes: text('notes'),
    // Links
    linked_report_id: text('linked_report_id').references(() => reports.id, { onDelete: 'set null' }),
    linked_task_id: text('linked_task_id'), // Reference to tasks (cross-schema)
    accepted_at: text('accepted_at'),
    declined_at: text('declined_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('quotes_household_id_idx').on(table.household_id),
    contractor_id_idx: index('quotes_contractor_id_idx').on(table.contractor_id),
    status_idx: index('quotes_status_idx').on(table.status),
    valid_until_idx: index('quotes_valid_until_idx').on(table.valid_until),
    linked_task_idx: index('quotes_linked_task_idx').on(table.linked_task_id),
  })
);

// ============ CONTRACTOR REPRESENTATIVES ============

export const contractorRepresentatives = sqliteTable(
  'contractor_representatives',
  {
    id: text('id').primaryKey(),
    contractor_id: text('contractor_id')
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role'), // "Owner", "Estimator", "Technician", "Office Manager"
    phone: text('phone'),
    email: text('email'),
    is_primary: integer('is_primary', { mode: 'boolean' }).default(false),
    notes: text('notes'),
    photo_url: text('photo_url'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    contractor_id_idx: index('contractor_representatives_contractor_id_idx').on(table.contractor_id),
  })
);

// ============ PROJECTS ============

export const PROJECT_STATUSES = ['planning', 'in_progress', 'on_hold', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    contractor_id: text('contractor_id')
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    quote_id: text('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('planning'), // ProjectStatus
    start_date: text('start_date'),
    estimated_end_date: text('estimated_end_date'),
    actual_end_date: text('actual_end_date'),
    total_budget_cents: integer('total_budget_cents'),
    total_spent_cents: integer('total_spent_cents').default(0),
    // Links
    linked_report_id: text('linked_report_id').references(() => reports.id, { onDelete: 'set null' }),
    linked_task_ids: text('linked_task_ids'), // JSON array
    notes: text('notes'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('projects_household_id_idx').on(table.household_id),
    contractor_id_idx: index('projects_contractor_id_idx').on(table.contractor_id),
    status_idx: index('projects_status_idx').on(table.status),
  })
);

// ============ PROJECT MILESTONES ============

export const MILESTONE_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const projectMilestones = sqliteTable(
  'project_milestones',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('pending'), // MilestoneStatus
    due_date: text('due_date'),
    completed_date: text('completed_date'),
    sort_order: integer('sort_order').default(0),
    notes: text('notes'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    project_id_idx: index('project_milestones_project_id_idx').on(table.project_id),
    status_idx: index('project_milestones_status_idx').on(table.status),
  })
);

// ============ PROJECT PAYMENTS ============

export const PAYMENT_TYPES = ['deposit', 'progress', 'final', 'change_order'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_STATUSES = ['pending', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const projectPayments = sqliteTable(
  'project_payments',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // PaymentType
    amount_cents: integer('amount_cents').notNull(),
    status: text('status').notNull().default('pending'), // PaymentStatus
    due_date: text('due_date'),
    paid_date: text('paid_date'),
    receipt_document_key: text('receipt_document_key'),
    notes: text('notes'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    project_id_idx: index('project_payments_project_id_idx').on(table.project_id),
    status_idx: index('project_payments_status_idx').on(table.status),
  })
);

// ============ PROJECT PROGRESS PHOTOS ============

export const projectProgressPhotos = sqliteTable(
  'project_progress_photos',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    milestone_id: text('milestone_id').references(() => projectMilestones.id, { onDelete: 'set null' }),
    photo_key: text('photo_key').notNull(), // R2 storage key
    caption: text('caption'),
    taken_at: text('taken_at'),
    tags: text('tags'), // JSON array: ['before', 'during', 'after']
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    project_id_idx: index('project_progress_photos_project_id_idx').on(table.project_id),
    milestone_id_idx: index('project_progress_photos_milestone_id_idx').on(table.milestone_id),
  })
);

// ============ VISIT CHECKLISTS ============

export const visitChecklists = sqliteTable(
  'visit_checklists',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    appointment_id: text('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
    visit_id: text('visit_id').references(() => contractorVisits.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    template_id: text('template_id'),
    contractor_specialty: text('contractor_specialty'), // For AI context
    // AI-powered checklist fields
    task_id: text('task_id'), // Link to maintenance task (cross-schema reference)
    source: text('source').default('manual'), // 'manual', 'ai_generated', 'template'
    ai_generation_context: text('ai_generation_context'), // JSON: task details, images, category
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('visit_checklists_household_id_idx').on(table.household_id),
    appointment_id_idx: index('visit_checklists_appointment_id_idx').on(table.appointment_id),
    task_id_idx: index('visit_checklists_task_id_idx').on(table.task_id),
    source_idx: index('visit_checklists_source_idx').on(table.source),
  })
);

// ============ CHECKLIST ITEMS ============

export const CHECKLIST_PRIORITIES = ['must_ask', 'nice_to_have', 'optional'] as const;
export type ChecklistPriority = (typeof CHECKLIST_PRIORITIES)[number];

export const checklistItems = sqliteTable(
  'checklist_items',
  {
    id: text('id').primaryKey(),
    checklist_id: text('checklist_id')
      .notNull()
      .references(() => visitChecklists.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    checked: integer('checked', { mode: 'boolean' }).default(false),
    checked_at: text('checked_at'),
    comment: text('comment'),
    voice_note_key: text('voice_note_key'), // R2 storage key
    voice_note_transcription: text('voice_note_transcription'),
    has_info_icon: integer('has_info_icon', { mode: 'boolean' }).default(false),
    technical_term: text('technical_term'), // Key for AI lookup
    category: text('category'),
    priority: text('priority').default('must_ask'), // ChecklistPriority
    sort_order: integer('sort_order').default(0),
    // AI suggestion tracking fields
    source: text('source').default('manual'), // 'manual', 'ai_suggested'
    ai_confidence: real('ai_confidence'), // 0-1 confidence score
    suggested_at: text('suggested_at'), // When AI suggested this
    accepted_at: text('accepted_at'), // When user accepted suggestion
    dismissed_at: text('dismissed_at'), // When user dismissed suggestion
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    checklist_id_idx: index('checklist_items_checklist_id_idx').on(table.checklist_id),
    sort_order_idx: index('checklist_items_sort_order_idx').on(table.checklist_id, table.sort_order),
    source_idx: index('checklist_items_source_idx').on(table.source),
  })
);

// ============ CHECKLIST TEMPLATES ============

export const checklistTemplates = sqliteTable(
  'checklist_templates',
  {
    id: text('id').primaryKey(),
    specialty: text('specialty').notNull(), // ContractorSpecialty
    title: text('title').notNull(),
    description: text('description'),
    items: text('items').notNull(), // JSON array of template items
    is_system: integer('is_system', { mode: 'boolean' }).default(true),
    household_id: text('household_id').references(() => households.id, { onDelete: 'cascade' }), // null for system templates
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    specialty_idx: index('checklist_templates_specialty_idx').on(table.specialty),
    household_id_idx: index('checklist_templates_household_id_idx').on(table.household_id),
  })
);

// ============ TECHNICAL TERMS (Knowledge Base) ============

export const technicalTerms = sqliteTable(
  'technical_terms',
  {
    id: text('id').primaryKey(),
    term_key: text('term_key').notNull().unique(), // "afci_breakers"
    display_name: text('display_name').notNull(), // "AFCI Breakers"
    category: text('category').notNull(), // "electrical", "plumbing", etc.
    short_description: text('short_description'), // Brief 1-2 sentence description
    base_prompt: text('base_prompt').notNull(), // System prompt for AI
    related_terms: text('related_terms'), // JSON array
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    term_key_idx: uniqueIndex('technical_terms_term_key_idx').on(table.term_key),
    category_idx: index('technical_terms_category_idx').on(table.category),
  })
);

// ============ AI INFO CONVERSATIONS ============

export const aiInfoConversations = sqliteTable(
  'ai_info_conversations',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    checklist_item_id: text('checklist_item_id').references(() => checklistItems.id, { onDelete: 'set null' }),
    technical_term: text('technical_term').notNull(),
    context_json: text('context_json'), // Full context sent to AI
    messages_json: text('messages_json'), // Conversation history
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('ai_info_conversations_household_id_idx').on(table.household_id),
    checklist_item_id_idx: index('ai_info_conversations_checklist_item_id_idx').on(table.checklist_item_id),
  })
);

// ============ CONTRACTOR MESSAGES ============

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_CHANNELS = ['email', 'sms', 'in_app'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_STATUSES = ['draft', 'sent', 'delivered', 'read', 'failed'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const contractorMessages = sqliteTable(
  'contractor_messages',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    contractor_id: text('contractor_id')
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(), // MessageDirection
    channel: text('channel').notNull(), // MessageChannel
    subject: text('subject'),
    body: text('body').notNull(),
    attachments: text('attachments'), // JSON array of attachment keys
    status: text('status').notNull().default('sent'), // MessageStatus
    sent_at: text('sent_at'),
    read_at: text('read_at'),
    template_used: text('template_used'), // Which template was used
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('contractor_messages_household_id_idx').on(table.household_id),
    contractor_id_idx: index('contractor_messages_contractor_id_idx').on(table.contractor_id),
    sent_at_idx: index('contractor_messages_sent_at_idx').on(table.sent_at),
  })
);

// ============ MESSAGE TEMPLATES ============

export const MESSAGE_TEMPLATE_TYPES = [
  'quote_request',
  'schedule_appointment',
  'confirm_appointment',
  'request_reschedule',
  'thank_you',
  'follow_up',
  'report_issue',
  'warranty_service',
] as const;
export type MessageTemplateType = (typeof MESSAGE_TEMPLATE_TYPES)[number];

export const messageTemplates = sqliteTable(
  'message_templates',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(), // MessageTemplateType
    title: text('title').notNull(),
    subject_template: text('subject_template'),
    body_template: text('body_template').notNull(),
    is_system: integer('is_system', { mode: 'boolean' }).default(true),
    household_id: text('household_id').references(() => households.id, { onDelete: 'cascade' }), // null for system templates
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    type_idx: index('message_templates_type_idx').on(table.type),
    household_id_idx: index('message_templates_household_id_idx').on(table.household_id),
  })
);

// ============ CONTRACTOR JOB RATINGS ============

export const contractorJobRatings = sqliteTable(
  'contractor_job_ratings',
  {
    id: text('id').primaryKey(),
    contractor_id: text('contractor_id')
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    visit_id: text('visit_id')
      .notNull()
      .references(() => contractorVisits.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    rated_by: text('rated_by').references(() => users.id, { onDelete: 'set null' }),
    overall_rating: integer('overall_rating').notNull(), // 1-5
    quality_rating: integer('quality_rating'), // 1-5
    punctuality_rating: integer('punctuality_rating'), // 1-5
    communication_rating: integer('communication_rating'), // 1-5
    cleanliness_rating: integer('cleanliness_rating'), // 1-5
    value_rating: integer('value_rating'), // 1-5
    would_hire_again: integer('would_hire_again', { mode: 'boolean' }),
    review_text: text('review_text'),
    review_photos: text('review_photos'), // JSON array of photo keys
    is_private: integer('is_private', { mode: 'boolean' }).default(true),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    contractor_id_idx: index('contractor_job_ratings_contractor_id_idx').on(table.contractor_id),
    visit_id_idx: uniqueIndex('contractor_job_ratings_visit_id_idx').on(table.visit_id), // One rating per visit
    household_id_idx: index('contractor_job_ratings_household_id_idx').on(table.household_id),
  })
);

// ============ CONTRACTOR ISSUE RESOLUTIONS ============

export const RESOLUTION_STATUSES = ['pending', 'resolved', 'partially_resolved', 'unresolved'] as const;
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];

export const contractorIssueResolutions = sqliteTable(
  'contractor_issue_resolutions',
  {
    id: text('id').primaryKey(),
    contractor_id: text('contractor_id')
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    report_id: text('report_id').references(() => reports.id, { onDelete: 'set null' }),
    task_id: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    visit_id: text('visit_id').references(() => contractorVisits.id, { onDelete: 'set null' }),
    issue_title: text('issue_title').notNull(),
    issue_category: text('issue_category'),
    resolution_status: text('resolution_status').notNull().default('pending'), // ResolutionStatus
    resolution_notes: text('resolution_notes'),
    cost_cents: integer('cost_cents'),
    resolved_at: text('resolved_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    contractor_id_idx: index('contractor_issue_resolutions_contractor_id_idx').on(table.contractor_id),
    household_id_idx: index('contractor_issue_resolutions_household_id_idx').on(table.household_id),
    resolution_status_idx: index('contractor_issue_resolutions_status_idx').on(table.resolution_status),
  })
);

// ============ CONTRACTOR SHARES ============

export const contractorShares = sqliteTable(
  'contractor_shares',
  {
    id: text('id').primaryKey(),
    contractor_id: text('contractor_id')
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    shared_by_household_id: text('shared_by_household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    shared_by_user_id: text('shared_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    share_token: text('share_token').notNull().unique(),
    include_rating: integer('include_rating', { mode: 'boolean' }).default(true),
    include_review: integer('include_review', { mode: 'boolean' }).default(true),
    include_contact_info: integer('include_contact_info', { mode: 'boolean' }).default(true),
    expires_at: text('expires_at'),
    view_count: integer('view_count').default(0),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    contractor_id_idx: index('contractor_shares_contractor_id_idx').on(table.contractor_id),
    share_token_idx: uniqueIndex('contractor_shares_token_idx').on(table.share_token),
  })
);

// ============ VISIT NOTES (VOICE/PHOTO/TEXT) ============

export const VISIT_NOTE_TYPES = ['voice', 'photo', 'text', 'checklist'] as const;
export type VisitNoteType = (typeof VISIT_NOTE_TYPES)[number];

export const visitNotes = sqliteTable(
  'visit_notes',
  {
    id: text('id').primaryKey(),
    visit_id: text('visit_id')
      .notNull()
      .references(() => contractorVisits.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // VisitNoteType
    content: text('content'), // Text content or file key
    transcription: text('transcription'), // For voice notes
    tags: text('tags'), // JSON array: ['before', 'after', 'issue', 'recommendation']
    timestamp: text('timestamp').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    visit_id_idx: index('visit_notes_visit_id_idx').on(table.visit_id),
    household_id_idx: index('visit_notes_household_id_idx').on(table.household_id),
    type_idx: index('visit_notes_type_idx').on(table.type),
  })
);

// ============ LABOR HUB NOTIFICATION PREFERENCES ============

export const laborNotificationPreferences = sqliteTable(
  'labor_notification_preferences',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Appointment reminders
    appointment_reminder_24h: integer('appointment_reminder_24h', { mode: 'boolean' }).default(true),
    appointment_reminder_2h: integer('appointment_reminder_2h', { mode: 'boolean' }).default(true),
    appointment_confirmed: integer('appointment_confirmed', { mode: 'boolean' }).default(true),
    appointment_cancelled: integer('appointment_cancelled', { mode: 'boolean' }).default(true),
    // Quote notifications
    quote_received: integer('quote_received', { mode: 'boolean' }).default(true),
    quote_expiring_soon: integer('quote_expiring_soon', { mode: 'boolean' }).default(true),
    // Post-visit
    visit_followup_rating: integer('visit_followup_rating', { mode: 'boolean' }).default(true),
    // Warranty & project
    warranty_expiring: integer('warranty_expiring', { mode: 'boolean' }).default(true),
    project_milestone_due: integer('project_milestone_due', { mode: 'boolean' }).default(true),
    payment_due: integer('payment_due', { mode: 'boolean' }).default(true),
    // Weather
    weather_reschedule_suggestion: integer('weather_reschedule_suggestion', { mode: 'boolean' }).default(true),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_user_idx: uniqueIndex('labor_notification_preferences_household_user_idx').on(
      table.household_id,
      table.user_id
    ),
  })
);

// ============ CHECKLIST ITEM PHOTOS ============

export const checklistItemPhotos = sqliteTable(
  'checklist_item_photos',
  {
    id: text('id').primaryKey(),
    checklist_item_id: text('checklist_item_id')
      .notNull()
      .references(() => checklistItems.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    photo_key: text('photo_key').notNull(), // R2 storage key
    thumbnail_key: text('thumbnail_key'), // R2 storage key for thumbnail
    caption: text('caption'),
    taken_at: text('taken_at'), // When photo was taken
    file_size: integer('file_size'),
    mime_type: text('mime_type'),
    width: integer('width'),
    height: integer('height'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    checklist_item_id_idx: index('checklist_item_photos_item_id_idx').on(table.checklist_item_id),
    household_id_idx: index('checklist_item_photos_household_id_idx').on(table.household_id),
  })
);

// ============ EXPORT TYPES ============

export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;

export type Quote = typeof quotes.$inferSelect;
export type NewQuote = typeof quotes.$inferInsert;

export type ContractorRepresentative = typeof contractorRepresentatives.$inferSelect;
export type NewContractorRepresentative = typeof contractorRepresentatives.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type ProjectMilestone = typeof projectMilestones.$inferSelect;
export type NewProjectMilestone = typeof projectMilestones.$inferInsert;

export type ProjectPayment = typeof projectPayments.$inferSelect;
export type NewProjectPayment = typeof projectPayments.$inferInsert;

export type ProjectProgressPhoto = typeof projectProgressPhotos.$inferSelect;
export type NewProjectProgressPhoto = typeof projectProgressPhotos.$inferInsert;

export type VisitChecklist = typeof visitChecklists.$inferSelect;
export type NewVisitChecklist = typeof visitChecklists.$inferInsert;

export type ChecklistItem = typeof checklistItems.$inferSelect;
export type NewChecklistItem = typeof checklistItems.$inferInsert;

export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;
export type NewChecklistTemplate = typeof checklistTemplates.$inferInsert;

export type TechnicalTerm = typeof technicalTerms.$inferSelect;
export type NewTechnicalTerm = typeof technicalTerms.$inferInsert;

export type AIInfoConversation = typeof aiInfoConversations.$inferSelect;
export type NewAIInfoConversation = typeof aiInfoConversations.$inferInsert;

export type ContractorMessage = typeof contractorMessages.$inferSelect;
export type NewContractorMessage = typeof contractorMessages.$inferInsert;

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;

export type ContractorJobRating = typeof contractorJobRatings.$inferSelect;
export type NewContractorJobRating = typeof contractorJobRatings.$inferInsert;

export type ContractorIssueResolution = typeof contractorIssueResolutions.$inferSelect;
export type NewContractorIssueResolution = typeof contractorIssueResolutions.$inferInsert;

export type ContractorShare = typeof contractorShares.$inferSelect;
export type NewContractorShare = typeof contractorShares.$inferInsert;

export type VisitNote = typeof visitNotes.$inferSelect;
export type NewVisitNote = typeof visitNotes.$inferInsert;

export type LaborNotificationPreference = typeof laborNotificationPreferences.$inferSelect;
export type NewLaborNotificationPreference = typeof laborNotificationPreferences.$inferInsert;

export type ChecklistItemPhoto = typeof checklistItemPhotos.$inferSelect;
export type NewChecklistItemPhoto = typeof checklistItemPhotos.$inferInsert;
