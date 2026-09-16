import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { households, tasks } from './schema';
import { budgetItems } from './schema-budget';

// ============ TRUSTED CONTRACTORS ============

// Contractor specialties
export const CONTRACTOR_SPECIALTIES = [
  'plumber',
  'electrician',
  'hvac',
  'roofer',
  'general',
  'landscaper',
  'painter',
  'carpenter',
  'appliance',
  'pest_control',
  'cleaning',
  'other',
] as const;

export type ContractorSpecialty = (typeof CONTRACTOR_SPECIALTIES)[number];

// Specialty display info
export const SPECIALTY_INFO: Record<ContractorSpecialty, { label: string; icon: string; color: string }> = {
  plumber: { label: 'Plumber', icon: '🔧', color: '#2196F3' },
  electrician: { label: 'Electrician', icon: '⚡', color: '#FFD600' },
  hvac: { label: 'HVAC Technician', icon: '❄️', color: '#4ECDC4' },
  roofer: { label: 'Roofer', icon: '🏠', color: '#8BC34A' },
  general: { label: 'General Contractor', icon: '🔨', color: '#795548' },
  landscaper: { label: 'Landscaper', icon: '🌿', color: '#4CAF50' },
  painter: { label: 'Painter', icon: '🎨', color: '#9C27B0' },
  carpenter: { label: 'Carpenter', icon: '🪵', color: '#A1887F' },
  appliance: { label: 'Appliance Repair', icon: '🍳', color: '#FF5722' },
  pest_control: { label: 'Pest Control', icon: '🐜', color: '#607D8B' },
  cleaning: { label: 'Cleaning', icon: '🧹', color: '#00BCD4' },
  other: { label: 'Other', icon: '📦', color: '#9E9E9E' },
};

// Business types
export const BUSINESS_TYPES = ['individual', 'small_business', 'company'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

// Contractors table
export const contractors = sqliteTable(
  'contractors',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    company_name: text('company_name'),
    specialty: text('specialty').notNull(),
    secondary_specialties: text('secondary_specialties'), // JSON array for multiple specialties
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    address: text('address'),
    notes: text('notes'),
    rating: integer('rating'),
    is_favorite: integer('is_favorite', { mode: 'boolean' }).default(false),
    // New Labor Hub fields
    business_type: text('business_type'), // BusinessType
    license_number: text('license_number'),
    insurance_verified: integer('insurance_verified', { mode: 'boolean' }).default(false),
    insurance_expiry: text('insurance_expiry'),
    years_in_business: integer('years_in_business'),
    emergency_available: integer('emergency_available', { mode: 'boolean' }).default(false),
    response_time: text('response_time'), // "Same day", "1-2 days", etc.
    service_area: text('service_area'), // JSON array of areas served
    business_hours: text('business_hours'), // JSON object with hours
    certifications: text('certifications'), // JSON array
    portfolio_images: text('portfolio_images'), // JSON array of R2 keys
    is_blocked: integer('is_blocked', { mode: 'boolean' }).default(false),
    custom_tags: text('custom_tags'), // JSON array
    recommended_by: text('recommended_by'), // Who recommended this contractor
    source: text('source'), // 'manual', 'ai_search', 'shared', 'imported'
    // Aihousekeeper §A5: TCPA compliance + canonical phone storage (migration 0039).
    phone_e164: text('phone_e164'),
    sms_opt_in_at: text('sms_opt_in_at'),
    sms_opt_out_at: text('sms_opt_out_at'),
    // 'homeowner_attest' | 'self_reply_start' | 'inbound_sms'
    sms_opt_in_source: text('sms_opt_in_source'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('contractors_household_id_idx').on(table.household_id),
    specialty_idx: index('contractors_specialty_idx').on(table.specialty),
    is_favorite_idx: index('contractors_is_favorite_idx').on(table.is_favorite),
    is_blocked_idx: index('contractors_is_blocked_idx').on(table.is_blocked),
    // Aihousekeeper §A5 indexes.
    sms_optin_idx: index('idx_contractors_sms_optin').on(table.sms_opt_in_at, table.sms_opt_out_at),
    phone_e164_idx: index('idx_contractors_phone_e164').on(table.phone_e164),
  })
);

// Visit statuses
export const VISIT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

// Contractor visits table
export const contractorVisits = sqliteTable(
  'contractor_visits',
  {
    id: text('id').primaryKey(),
    contractor_id: text('contractor_id')
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    visit_date: text('visit_date').notNull(),
    description: text('description'),
    cost: integer('cost'),
    status: text('status').notNull(),
    notes: text('notes'),
    rating: integer('rating'),
    linked_task_id: text('linked_task_id').references(() => tasks.id, {
      onDelete: 'set null',
    }),
    linked_budget_item_id: text('linked_budget_item_id').references(() => budgetItems.id, {
      onDelete: 'set null',
    }),
    // Receipt tracking fields
    receipt_received: integer('receipt_received', { mode: 'boolean' }).default(false),
    receipt_reminder_task_id: text('receipt_reminder_task_id'),
    receipt_requested_at: text('receipt_requested_at'),
    // Visit mode fields (for on-site visit management)
    visit_mode_started_at: text('visit_mode_started_at'),
    visit_mode_ended_at: text('visit_mode_ended_at'),
    contractor_rep_name: text('contractor_rep_name'),
    task_id: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    // Visit-level voice recording
    voice_recording_key: text('voice_recording_key'), // R2 storage key
    voice_recording_transcription: text('voice_recording_transcription'), // AI transcription
    voice_recording_duration_seconds: integer('voice_recording_duration_seconds'),
    voice_recording_analysis: text('voice_recording_analysis'), // JSON: AI analysis
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    contractor_id_idx: index('contractor_visits_contractor_id_idx').on(table.contractor_id),
    household_id_idx: index('contractor_visits_household_id_idx').on(table.household_id),
    visit_date_idx: index('contractor_visits_visit_date_idx').on(table.visit_date),
    status_idx: index('contractor_visits_status_idx').on(table.status),
    task_id_idx: index('contractor_visits_task_id_idx').on(table.task_id),
  })
);

// Document types
export const DOCUMENT_TYPES = ['receipt', 'invoice', 'quote', 'warranty', 'contract', 'photo', 'other'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

// Contractor documents table
export const contractorDocuments = sqliteTable(
  'contractor_documents',
  {
    id: text('id').primaryKey(),
    contractor_id: text('contractor_id')
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    visit_id: text('visit_id').references(() => contractorVisits.id, { onDelete: 'set null' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    file_key: text('file_key').notNull(),
    file_name: text('file_name').notNull(),
    file_size: integer('file_size'),
    mime_type: text('mime_type'),
    amount: integer('amount'),
    document_date: text('document_date'),
    notes: text('notes'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    contractor_id_idx: index('contractor_documents_contractor_id_idx').on(table.contractor_id),
    visit_id_idx: index('contractor_documents_visit_id_idx').on(table.visit_id),
    household_id_idx: index('contractor_documents_household_id_idx').on(table.household_id),
    type_idx: index('contractor_documents_type_idx').on(table.type),
  })
);

// ============ CONTRACTOR QUOTES ============

// Quote statuses
export const QUOTE_STATUSES = ['pending', 'accepted', 'rejected', 'expired', 'withdrawn'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

// Quote entry methods
export const QUOTE_ENTRY_METHODS = ['manual', 'document_upload'] as const;
export type QuoteEntryMethod = (typeof QUOTE_ENTRY_METHODS)[number];

// AI extraction statuses
export const AI_EXTRACTION_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;
export type AIExtractionStatus = (typeof AI_EXTRACTION_STATUSES)[number];

// Contractor quotes table
export const contractorQuotes = sqliteTable(
  'contractor_quotes',
  {
    id: text('id').primaryKey(),

    // References
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    contractor_id: text('contractor_id')
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    visit_id: text('visit_id').references(() => contractorVisits.id, { onDelete: 'set null' }), // Link to on-site visit

    // Quote details
    amount: integer('amount'), // in cents
    currency: text('currency').notNull().default('USD'),
    description: text('description'),
    notes: text('notes'),

    // Timeline
    estimated_start_date: text('estimated_start_date'),
    estimated_completion_date: text('estimated_completion_date'),
    estimated_duration_days: integer('estimated_duration_days'),

    // Validity
    valid_until: text('valid_until'), // Quote expiration date

    // Status tracking
    status: text('status').notNull().default('pending'), // QuoteStatus
    submitted_at: text('submitted_at').notNull(),
    accepted_at: text('accepted_at'),
    rejected_at: text('rejected_at'),
    rejection_reason: text('rejection_reason'),

    // Document attachment (quote document/PDF)
    document_file_key: text('document_file_key'), // R2 storage key
    document_file_name: text('document_file_name'),
    document_file_size: integer('document_file_size'),
    document_mime_type: text('document_mime_type'),

    // Additional details
    warranty_terms: text('warranty_terms'),
    payment_terms: text('payment_terms'),
    materials_included: integer('materials_included', { mode: 'boolean' }).default(false),
    labor_cost: integer('labor_cost'), // separate labor cost in cents
    materials_cost: integer('materials_cost'), // separate materials cost in cents

    // Breakdown (JSON array for line items)
    cost_breakdown: text('cost_breakdown'), // JSON array: [{ description, amount, quantity }]

    // Entry method and AI extraction
    entry_method: text('entry_method').notNull().default('manual'), // QuoteEntryMethod
    ai_extraction_status: text('ai_extraction_status'), // AIExtractionStatus
    ai_extracted_data: text('ai_extracted_data'), // JSON: raw AI extracted data for reference
    ai_extraction_confidence: real('ai_extraction_confidence'), // 0-1 confidence score
    ai_extraction_error: text('ai_extraction_error'), // Error message if extraction failed
    needs_review: integer('needs_review', { mode: 'boolean' }).default(false), // If AI extraction needs human review

    // Badges and labels
    is_recommended: integer('is_recommended', { mode: 'boolean' }).default(false), // Contractor recommended by system
    is_lowest_price: integer('is_lowest_price', { mode: 'boolean' }).default(false), // Badge for lowest price
    is_fastest: integer('is_fastest', { mode: 'boolean' }).default(false), // Badge for fastest completion
    custom_badges: text('custom_badges'), // JSON array: custom badges/labels

    // Additional notes
    internal_notes: text('internal_notes'), // Private notes not visible to contractor
    contractor_notes: text('contractor_notes'), // Notes from contractor

    // Metadata
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    task_id_idx: index('contractor_quotes_task_id_idx').on(table.task_id),
    contractor_id_idx: index('contractor_quotes_contractor_id_idx').on(table.contractor_id),
    household_id_idx: index('contractor_quotes_household_id_idx').on(table.household_id),
    visit_id_idx: index('contractor_quotes_visit_id_idx').on(table.visit_id),
    status_idx: index('contractor_quotes_status_idx').on(table.status),
    submitted_at_idx: index('contractor_quotes_submitted_at_idx').on(table.submitted_at),
    entry_method_idx: index('contractor_quotes_entry_method_idx').on(table.entry_method),
    ai_extraction_status_idx: index('contractor_quotes_ai_extraction_status_idx').on(
      table.ai_extraction_status
    ),
    // Unique constraint: prevent duplicate quotes from same contractor for same task
    unique_task_contractor: uniqueIndex('contractor_quotes_task_contractor_unique_idx').on(
      table.task_id,
      table.contractor_id
    ),
  })
);

// ============ QUOTE REQUESTS ============

// Quote request statuses
export const QUOTE_REQUEST_STATUSES = [
  'pending',
  'sent',
  'viewed',
  'responded',
  'declined',
  'expired',
] as const;
export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];

// Quote requests table - track when homeowner requests quotes from contractors
export const quoteRequests = sqliteTable(
  'quote_requests',
  {
    id: text('id').primaryKey(),

    // References
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    contractor_id: text('contractor_id')
      .notNull()
      .references(() => contractors.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),

    // Request details
    message: text('message'), // Custom message to contractor
    requested_by: text('requested_by')
      .notNull()
      .references(() => households.id),
    requested_at: text('requested_at')
      .notNull()
      .default(sql`(datetime('now'))`),

    // Status tracking
    status: text('status').notNull().default('pending'), // QuoteRequestStatus
    sent_at: text('sent_at'),
    viewed_at: text('viewed_at'),
    responded_at: text('responded_at'),
    declined_at: text('declined_at'),
    decline_reason: text('decline_reason'),
    expires_at: text('expires_at'), // When this request expires

    // Response tracking
    quote_id: text('quote_id').references(() => contractorQuotes.id, { onDelete: 'set null' }),

    // Communication
    last_message_at: text('last_message_at'),
    unread_messages_count: integer('unread_messages_count').default(0),

    // Metadata
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    task_id_idx: index('quote_requests_task_id_idx').on(table.task_id),
    contractor_id_idx: index('quote_requests_contractor_id_idx').on(table.contractor_id),
    household_id_idx: index('quote_requests_household_id_idx').on(table.household_id),
    status_idx: index('quote_requests_status_idx').on(table.status),
    requested_at_idx: index('quote_requests_requested_at_idx').on(table.requested_at),
    // Unique constraint: one active request per task-contractor pair
    unique_task_contractor: uniqueIndex('quote_requests_task_contractor_unique_idx').on(
      table.task_id,
      table.contractor_id
    ),
  })
);

// ============ CONTRACTOR RECOMMENDATIONS ============

// Recommendation sources
export const RECOMMENDATION_SOURCES = ['ai', 'existing', 'external_search', 'user_shared'] as const;
export type RecommendationSource = (typeof RECOMMENDATION_SOURCES)[number];

// Recommendation statuses
export const RECOMMENDATION_STATUSES = ['suggested', 'viewed', 'request_sent', 'dismissed', 'saved'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

// Contractor recommendations table - AI-generated contractor suggestions
export const contractorRecommendations = sqliteTable(
  'contractor_recommendations',
  {
    id: text('id').primaryKey(),

    // References
    task_id: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    contractor_id: text('contractor_id').references(() => contractors.id, { onDelete: 'cascade' }), // NULL if new/external

    // Recommendation source
    source: text('source').notNull().default('ai'), // RecommendationSource

    // External contractor details (for contractors not in DB yet)
    external_contractor_name: text('external_contractor_name'),
    external_contractor_phone: text('external_contractor_phone'),
    external_contractor_email: text('external_contractor_email'),
    external_contractor_website: text('external_contractor_website'),
    external_contractor_address: text('external_contractor_address'),
    external_contractor_specialty: text('external_contractor_specialty'),

    // AI analysis
    match_score: real('match_score'), // 0-1 confidence score
    match_reasons: text('match_reasons'), // JSON array: reasons why this contractor matches
    ai_analysis: text('ai_analysis'), // JSON: detailed AI analysis data

    // Recommendation details
    estimated_response_time: text('estimated_response_time'),
    distance_miles: real('distance_miles'),
    availability_estimate: text('availability_estimate'),

    // User actions
    status: text('status').notNull().default('suggested'), // RecommendationStatus
    viewed_at: text('viewed_at'),
    dismissed_at: text('dismissed_at'),
    dismiss_reason: text('dismiss_reason'),
    saved_as_contractor_id: text('saved_as_contractor_id').references(() => contractors.id, {
      onDelete: 'set null',
    }),

    // Ranking
    rank_position: integer('rank_position'),
    is_featured: integer('is_featured', { mode: 'boolean' }).default(false),

    // Metadata
    generated_at: text('generated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    task_id_idx: index('contractor_recommendations_task_id_idx').on(table.task_id),
    household_id_idx: index('contractor_recommendations_household_id_idx').on(table.household_id),
    contractor_id_idx: index('contractor_recommendations_contractor_id_idx').on(table.contractor_id),
    status_idx: index('contractor_recommendations_status_idx').on(table.status),
    match_score_idx: index('contractor_recommendations_match_score_idx').on(table.match_score),
    source_idx: index('contractor_recommendations_source_idx').on(table.source),
  })
);

// Export types
export type Contractor = typeof contractors.$inferSelect;
export type NewContractor = typeof contractors.$inferInsert;
export type ContractorVisit = typeof contractorVisits.$inferSelect;
export type NewContractorVisit = typeof contractorVisits.$inferInsert;
export type ContractorDocument = typeof contractorDocuments.$inferSelect;
export type NewContractorDocument = typeof contractorDocuments.$inferInsert;
export type ContractorQuote = typeof contractorQuotes.$inferSelect;
export type NewContractorQuote = typeof contractorQuotes.$inferInsert;
export type QuoteRequest = typeof quoteRequests.$inferSelect;
export type NewQuoteRequest = typeof quoteRequests.$inferInsert;
export type ContractorRecommendation = typeof contractorRecommendations.$inferSelect;
export type NewContractorRecommendation = typeof contractorRecommendations.$inferInsert;
