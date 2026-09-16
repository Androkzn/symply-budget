import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { users, households, householdSpaces } from './schema';

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
  updated_by: text('updated_by'),
  version: integer('version').notNull().default(1),
};

// ============ GARBAGE COLLECTION ============

export const garbageSchedules = sqliteTable(
  'garbage_schedules',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    municipality: text('municipality').notNull(), // 'Vancouver', 'Burnaby', etc.
    schedules: text('schedules').notNull(), // JSON: collection types and frequencies
    set_out_time: text('set_out_time'), // "19:00" day before
    collection_start_time: text('collection_start_time'), // "07:00"
    remove_by_time: text('remove_by_time'), // "19:00" same day
    holiday_shifts: text('holiday_shifts'), // JSON: holiday adjustments
    reminders: text('reminders'), // JSON: reminder preferences
    source: text('source'), // 'municipal_api' | 'manual' | 'scraped'
    last_verified: text('last_verified'),
    ...auditFields,
  },
  (table) => ({
    household_id_idx: index('garbage_schedules_household_id_idx').on(table.household_id),
    municipality_idx: index('garbage_schedules_municipality_idx').on(table.municipality),
  })
);

export const municipalityConfigs = sqliteTable(
  'municipality_configs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    code: text('code').notNull().unique(), // 'VAN', 'BUR', etc.
    garbage_provider: text('garbage_provider'),
    garbage_schedule_lookup_url: text('garbage_schedule_lookup_url'),
    waste_regulations: text('waste_regulations'), // JSON: { garbage: [], recycling: [], organics: [] }
    noise_bylaws: text('noise_bylaws'), // JSON: quiet hours, lawn equipment hours
    property_maintenance_bylaws: text('property_maintenance_bylaws'), // JSON
    contacts: text('contacts'), // JSON: bylaw enforcement, waste collection
    last_updated: text('last_updated'),
    ...auditFields,
  },
  (table) => ({
    name_idx: uniqueIndex('municipality_configs_name_idx').on(table.name),
    code_idx: uniqueIndex('municipality_configs_code_idx').on(table.code),
  })
);

// ============ APPLIANCES ============

export const appliances = sqliteTable(
  'appliances',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    space_id: text('space_id').references(() => householdSpaces.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    category: text('category').notNull(), // 'hvac', 'plumbing', 'kitchen', etc.
    type: text('type').notNull(), // 'Refrigerator', 'Furnace', etc.
    location: text('location'), // 'Kitchen', 'Basement', etc.
    brand: text('brand'),
    model: text('model'),
    serial_number: text('serial_number'),
    purchase_date: text('purchase_date'),
    install_date: text('install_date'),
    expected_lifespan: integer('expected_lifespan'), // years
    warranty: text('warranty'), // JSON: manufacturer + extended warranty
    purchase_cost: integer('purchase_cost'), // cents
    total_maintenance_cost: integer('total_maintenance_cost').default(0), // cents
    ...auditFields,
  },
  (table) => ({
    household_id_idx: index('appliances_household_id_idx').on(table.household_id),
    space_id_idx: index('appliances_space_id_idx').on(table.space_id),
    category_idx: index('appliances_category_idx').on(table.category),
  })
);

export const applianceDocuments = sqliteTable(
  'appliance_documents',
  {
    id: text('id').primaryKey(),
    appliance_id: text('appliance_id')
      .notNull()
      .references(() => appliances.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'receipt', 'warranty', 'manual', 'service_record', 'photo'
    r2_key: text('r2_key').notNull(),
    upload_date: text('upload_date').notNull(),
    ...auditFields,
  },
  (table) => ({
    appliance_id_idx: index('appliance_documents_appliance_id_idx').on(table.appliance_id),
    type_idx: index('appliance_documents_type_idx').on(table.type),
  })
);

export const applianceServiceHistory = sqliteTable(
  'appliance_service_history',
  {
    id: text('id').primaryKey(),
    appliance_id: text('appliance_id')
      .notNull()
      .references(() => appliances.id, { onDelete: 'cascade' }),
    service_date: text('service_date').notNull(),
    description: text('description').notNull(),
    cost: integer('cost'), // cents
    provider_id: text('provider_id'), // References serviceProviders (no FK in TS, handled in SQL)
    completed_by: text('completed_by').references(() => users.id),
    ...auditFields,
  },
  (table) => ({
    appliance_id_idx: index('appliance_service_history_appliance_id_idx').on(table.appliance_id),
    service_date_idx: index('appliance_service_history_service_date_idx').on(table.service_date),
  })
);

// ============ TASK TEMPLATES ============

export const maintenanceTaskTemplates = sqliteTable(
  'maintenance_task_templates',
  {
    id: text('id').primaryKey(),
    category: text('category').notNull(), // maps to SystemCategory
    name: text('name').notNull(),
    description: text('description'),
    frequency: text('frequency').notNull(),
    custom_interval_days: integer('custom_interval_days'),
    preferred_months: text('preferred_months'), // JSON array: [1,2,3] for Jan-Mar
    seasonal_only: text('seasonal_only'), // 'spring', 'summer', 'fall', 'winter'
    difficulty: text('difficulty'), // 'easy', 'moderate', 'hard', 'professional'
    estimated_duration: integer('estimated_duration'), // minutes
    estimated_cost: text('estimated_cost'), // JSON: { diy: 2500, professional: 15000 }
    tools_required: text('tools_required'), // JSON array
    tutorial_url: text('tutorial_url'),
    gva_specific: integer('gva_specific', { mode: 'boolean' }).default(false),
    climate_zone: text('climate_zone'), // 'pacific_northwest'
    ...auditFields,
  },
  (table) => ({
    category_idx: index('maintenance_task_templates_category_idx').on(table.category),
    frequency_idx: index('maintenance_task_templates_frequency_idx').on(table.frequency),
    gva_specific_idx: index('maintenance_task_templates_gva_specific_idx').on(table.gva_specific),
  })
);

// ============ SERVICE PROVIDERS ============

export const serviceProviders = sqliteTable(
  'service_providers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    category: text('category').notNull(), // 'plumber', 'electrician', 'hvac', etc.
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    address: text('address'),
    service_areas: text('service_areas'), // JSON: ['Vancouver', 'Burnaby']
    rating: real('rating'), // 1-5 stars
    review_count: integer('review_count').default(0),
    is_verified: integer('is_verified', { mode: 'boolean' }).default(false),
    ...auditFields,
  },
  (table) => ({
    category_idx: index('service_providers_category_idx').on(table.category),
    rating_idx: index('service_providers_rating_idx').on(table.rating),
    is_verified_idx: index('service_providers_is_verified_idx').on(table.is_verified),
  })
);

export const serviceProviderReviews = sqliteTable(
  'service_provider_reviews',
  {
    id: text('id').primaryKey(),
    provider_id: text('provider_id')
      .notNull()
      .references(() => serviceProviders.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .references(() => households.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(), // 1-5
    review_text: text('review_text'),
    service_date: text('service_date'),
    cost: integer('cost'), // cents
    ...auditFields,
  },
  (table) => ({
    provider_id_idx: index('service_provider_reviews_provider_id_idx').on(table.provider_id),
    user_id_idx: index('service_provider_reviews_user_id_idx').on(table.user_id),
    rating_idx: index('service_provider_reviews_rating_idx').on(table.rating),
  })
);

// ============ SEASONAL CHECKLISTS ============

export const seasonalChecklists = sqliteTable(
  'seasonal_checklists',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    season: text('season').notNull(), // 'spring', 'summer', 'fall', 'winter'
    year: integer('year').notNull(),
    climate_zone: text('climate_zone').notNull(), // 'pacific_northwest'
    progress: integer('progress').default(0), // 0-100
    completed_at: text('completed_at'),
    ...auditFields,
  },
  (table) => ({
    household_id_idx: index('seasonal_checklists_household_id_idx').on(table.household_id),
    season_year_idx: index('seasonal_checklists_season_year_idx').on(table.season, table.year),
  })
);

export const seasonalChecklistItems = sqliteTable(
  'seasonal_checklist_items',
  {
    id: text('id').primaryKey(),
    checklist_id: text('checklist_id')
      .notNull()
      .references(() => seasonalChecklists.id, { onDelete: 'cascade' }),
    task_template_id: text('task_template_id')
      .references(() => maintenanceTaskTemplates.id),
    title: text('title').notNull(),
    category: text('category'), // 'exterior', 'hvac', 'safety', etc.
    is_completed: integer('is_completed', { mode: 'boolean' }).default(false),
    completed_at: text('completed_at'),
    completed_by: text('completed_by').references(() => users.id),
    notes: text('notes'),
    photo_keys: text('photo_keys'), // JSON array of R2 keys
    sort_order: integer('sort_order'),
    ...auditFields,
  },
  (table) => ({
    checklist_id_idx: index('seasonal_checklist_items_checklist_id_idx').on(table.checklist_id),
    is_completed_idx: index('seasonal_checklist_items_is_completed_idx').on(table.is_completed),
  })
);

// Export types
export type GarbageSchedule = typeof garbageSchedules.$inferSelect;
export type NewGarbageSchedule = typeof garbageSchedules.$inferInsert;
export type MunicipalityConfig = typeof municipalityConfigs.$inferSelect;
export type NewMunicipalityConfig = typeof municipalityConfigs.$inferInsert;
export type Appliance = typeof appliances.$inferSelect;
export type NewAppliance = typeof appliances.$inferInsert;
export type ApplianceDocument = typeof applianceDocuments.$inferSelect;
export type NewApplianceDocument = typeof applianceDocuments.$inferInsert;
export type ApplianceServiceHistory = typeof applianceServiceHistory.$inferSelect;
export type NewApplianceServiceHistory = typeof applianceServiceHistory.$inferInsert;
export type MaintenanceTaskTemplate = typeof maintenanceTaskTemplates.$inferSelect;
export type NewMaintenanceTaskTemplate = typeof maintenanceTaskTemplates.$inferInsert;
export type ServiceProvider = typeof serviceProviders.$inferSelect;
export type NewServiceProvider = typeof serviceProviders.$inferInsert;
export type ServiceProviderReview = typeof serviceProviderReviews.$inferSelect;
export type NewServiceProviderReview = typeof serviceProviderReviews.$inferInsert;
export type SeasonalChecklist = typeof seasonalChecklists.$inferSelect;
export type NewSeasonalChecklist = typeof seasonalChecklists.$inferInsert;
export type SeasonalChecklistItem = typeof seasonalChecklistItems.$inferSelect;
export type NewSeasonalChecklistItem = typeof seasonalChecklistItems.$inferInsert;
