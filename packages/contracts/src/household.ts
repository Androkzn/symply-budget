import { z } from 'zod';

import { householdPhotoUrlSchema } from './household-photo';

export { householdPhotoUrlSchema, type HouseholdPhotoUrl } from './household-photo';

/** Household row in GET /households list (shared FE/BE contract). */
export const householdListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  address_line1: z.string().nullable(),
  address_line2: z.string().nullable(),
  city: z.string().nullable(),
  state_province: z.string().nullable(),
  postal_code: z.string().nullable(),
  country: z.enum(['CA', 'US']).nullable(),
  unit_system: z.enum(['metric', 'imperial']).nullable(),
  photo_key: z.string().nullable(),
  photo_url: householdPhotoUrlSchema,
  purchase_price: z.number().int().nullable(),
  purchase_date: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  member_count: z.number().int().nonnegative(),
  my_role: z.enum(['owner', 'member']),
  floor_plan_count: z.number().int().nonnegative().optional(),
});

export type HouseholdListItem = z.infer<typeof householdListItemSchema>;

/** GET /households response envelope. */
export const householdsListResponseSchema = z.object({
  households: z.array(householdListItemSchema),
});

export type HouseholdsListResponse = z.infer<typeof householdsListResponseSchema>;
