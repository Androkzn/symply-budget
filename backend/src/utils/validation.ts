import { paginationQuerySchema } from '@symply/contracts';
import { z } from 'zod';

import { SYSTEM_CATEGORIES } from '../types';

// ============ AUTH SCHEMAS ============

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Password must contain at least one special character'),
  display_name: z.string().min(1).max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Password must contain at least one special character'),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Password must contain at least one special character'),
});

export const appleAuthSchema = z.object({
  identity_token: z.string().min(1, 'Identity token is required'),
  authorization_code: z.string().min(1, 'Authorization code is required'),
  user: z
    .object({
      email: z.string().email().optional(),
      name: z
        .object({
          firstName: z.string().optional(),
          lastName: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export const googleAuthSchema = z.object({
  id_token: z.string().min(1, 'ID token is required'),
});

// ============ USER SCHEMAS ============

export const updateUserSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  avatar_url: z.string().optional().nullable().refine(
    (val) => !val || val.startsWith('data:image/') || val.startsWith('http://') || val.startsWith('https://'),
    { message: 'Avatar must be a valid URL or base64 data URL' }
  ),
});

// ============ HOUSEHOLD SCHEMAS ============

export const createHouseholdSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  address_line1: z.string().max(200).optional(),
  address_line2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state_province: z.string().max(100).optional(),
  postal_code: z.string().max(20).optional(),
  country: z.enum(['CA', 'US']).optional(),
  // IANA timezone string (e.g. 'America/New_York'). Aihousekeeper §A1 — the mobile
  // client passes `Intl.DateTimeFormat().resolvedOptions().timeZone` at
  // creation time so Aihousekeeper's briefing schedule is household-local from
  // day one. Optional; if omitted the DB column defaults to 'UTC' and
  // the user can update it later via PATCH /aihousekeeper/identity.
  timezone: z.string().optional(),
  // The ONE global "Imperial vs Metric" preference (0142) for this property's
  // room/space size display and entry. Household-wide, optional/nullable so
  // it can be unset (falls back to a country-derived default client-side).
  unit_system: z.enum(['metric', 'imperial']).optional().nullable(),
  photo_key: z.string().max(500).optional().nullable(),
  // Real purchase price in cents (what the owner paid) + purchase date. Both
  // optional/nullable so the property can exist without them and the owner can
  // clear them. Price is a non-negative integer; date is ISO 'YYYY-MM-DD'.
  purchase_price: z.number().int().min(0).optional().nullable(),
  purchase_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
    .optional()
    .nullable(),
});

export const updateHouseholdSchema = createHouseholdSchema.partial();

export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['owner', 'member']),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(['owner', 'member']),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

// Create a shareable invite link. All fields optional — sensible defaults are
// applied server-side (role 'member', 7-day expiry, unlimited uses).
export const createInviteLinkSchema = z.object({
  role: z.enum(['owner', 'member']).optional(),
  expires_in_days: z.number().int().min(1).max(90).optional(),
  max_uses: z.number().int().min(1).max(100).optional(),
});

// Validate / request-to-join against a shareable invite link token.
export const inviteLinkTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

// ============ REPORT SCHEMAS ============

export const uploadUrlSchema = z.object({
  filename: z.string().min(1, 'Filename is required').max(255),
  file_size: z.number().positive().max(52428800, 'File size cannot exceed 50MB'),
  content_type: z.literal('application/pdf'),
});

// ============ ACTION ITEM SCHEMAS ============

export const updateActionItemSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'skipped']).optional(),
  notes: z.string().max(2000).optional().nullable(),
  due_date: z.string().datetime().optional().nullable(),
  space_id: z.string().uuid().optional().nullable(),
});

// ============ MAINTENANCE TASK SCHEMAS ============

const PRIORITY_SEVERITIES = ['nice_to_have', 'low', 'medium', 'high', 'urgent', 'critical'] as const;

/** Coarse "how long will this take" tiers. Mirrors TimeEffort on the client. */
const TIME_EFFORTS = ['quick', 'short', 'medium', 'half_day', 'all_day'] as const;

export const createMaintenanceTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional(),
  system_category: z.enum(SYSTEM_CATEGORIES).optional(),
  frequency: z.enum(['one_time', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']),
  custom_interval_days: z.number().int().positive().optional(),
  next_due_date: z.string().datetime().optional(),
  assigned_to: z.string().uuid().optional(),
  reminder_days_before: z.number().int().min(0).max(365).optional(),
  space_id: z.string().uuid().optional().nullable(),
  // Priority/severity (default: nice_to_have)
  priority_severity: z.enum(PRIORITY_SEVERITIES).optional().default('nice_to_have'),
  // Coarse effort tier. Normally AI-enriched, but user-settable. Nullable so it
  // can be cleared back to "unset" (letting enrichment fill it later).
  time_effort: z.enum(TIME_EFFORTS).optional().nullable(),
  // Reminder settings
  reminder_enabled: z.boolean().optional().default(true),
  reminder_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format (HH:MM)').optional().default('09:00'),
  reminder_repeat: z.boolean().optional().default(true),
  // Personal task: visible only to the creator within the household
  is_personal: z.boolean().optional().default(false),
  // Attachment photos (max 5). When provided on update, replaces existing photos.
  photos: z
    .array(
      z.object({
        photo_key: z.string().min(1).max(500),
      })
    )
    .max(5)
    .optional(),
  cover_photo_index: z.number().int().min(0).max(4).optional(),
});

// Smart Task Assistant fast capture: just the raw text (voice transcript or
// typed). The async enrichment job fills everything else.
export const quickCreateMaintenanceTaskSchema = z.object({
  text: z.string().min(1, 'Description is required').max(2000),
  assigned_to: z.string().optional(),
  space_id: z.string().optional().nullable(),
  is_personal: z.boolean().optional().default(false),
});

export const updateMaintenanceTaskSchema = createMaintenanceTaskSchema.partial().extend({
  is_active: z.boolean().optional(),
  snooze_until: z.string().datetime().optional().nullable(),
  priority_severity: z.enum(PRIORITY_SEVERITIES).optional(),
  // Nullable so a task can be UNassigned (cleared) via update, not just reassigned.
  assigned_to: z.string().optional().nullable(),
  // Contractor fields
  needs_contractor: z.boolean().optional(),
  contractor_category: z.string().optional(),
  workflow_stage: z.string().optional(),
  scheduled_work_date: z.string().optional(),
  scheduled_work_time_start: z.string().optional(),
  scheduled_work_time_end: z.string().optional(),
  selected_quote_id: z.string().uuid().optional(),
  linked_project_id: z.string().uuid().optional(),
});

export const completeMaintenanceTaskSchema = z.object({
  notes: z.string().max(2000).optional(),
  photo_keys: z.array(z.string()).max(10).optional(),
});

// ============ PAGINATION SCHEMAS ============

export { paginationQuerySchema as paginationSchema };
const paginationSchema = paginationQuerySchema;

// ============ FILTER SCHEMAS ============

export const reportFiltersSchema = paginationSchema.extend({
  status: z.enum(['pending_upload', 'uploaded', 'processing', 'completed', 'failed']).optional(),
});

export const findingFiltersSchema = paginationSchema.extend({
  system_category: z.enum(SYSTEM_CATEGORIES).optional(),
  severity: z.enum(['critical', 'major', 'minor', 'informational']).optional(),
});

export const actionItemFiltersSchema = paginationSchema.extend({
  status: z.enum(['pending', 'in_progress', 'completed', 'skipped']).optional(),
  priority: z.enum(['critical', 'recommended', 'cosmetic']).optional(),
  timeframe: z.enum(['0-30_days', '3-6_months', '1_year', '2-5_years', '5-10_years']).optional(),
});

export const maintenanceTaskFiltersSchema = paginationSchema.extend({
  system_category: z.enum(SYSTEM_CATEGORIES).optional(),
  is_active: z.coerce.boolean().optional(),
});

// ============ HOUSEHOLD SPACE SCHEMAS ============

export const createHouseholdSpaceSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  space_type: z.enum(['preset', 'custom']),
  category: z.enum(['indoor', 'outdoor', 'garage', 'basement', 'attic']).optional(),
  floor_level: z.number().int().min(-2).max(10).optional(),
  icon_emoji: z.string().max(10).optional(),
  icon_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format').optional(),
  custom_image_key: z.string().optional(),
  description: z.string().max(500).optional(),
  area_sqft: z.number().int().positive().optional(),
  display_order: z.number().int().min(0).optional(),
  floor_plan_id: z.string().uuid().optional(),
  plan_x_percent: z.number().min(0).max(100).optional(),
  plan_y_percent: z.number().min(0).max(100).optional(),
  plan_width_percent: z.number().min(0).max(100).optional(),
  plan_height_percent: z.number().min(0).max(100).optional(),
});

export const updateHouseholdSpaceSchema = createHouseholdSpaceSchema.partial().extend({
  version: z.number().int().positive(),
});

export const reorderSpacesSchema = z.object({
  space_orders: z.array(
    z.object({
      space_id: z.string().uuid(),
      display_order: z.number().int().min(0),
      version: z.number().int().positive(),
    })
  ),
});

export const bulkCreateSpacesSchema = z.object({
  template_type: z.enum(['small_apartment', 'apartment', 'single_family', 'large_house']),
});

export const householdSpaceFiltersSchema = paginationSchema.extend({
  category: z.enum(['indoor', 'outdoor', 'garage', 'basement', 'attic']).optional(),
  floor_level: z.coerce.number().int().optional(),
});

// Export types
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type CreateInviteLinkInput = z.infer<typeof createInviteLinkSchema>;
export type CreateMaintenanceTaskInput = z.infer<typeof createMaintenanceTaskSchema>;
export type UpdateMaintenanceTaskInput = z.infer<typeof updateMaintenanceTaskSchema>;
export type CreateHouseholdSpaceInput = z.infer<typeof createHouseholdSpaceSchema>;
export type UpdateHouseholdSpaceInput = z.infer<typeof updateHouseholdSpaceSchema>;
