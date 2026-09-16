import { z } from 'zod';

import { householdListItemSchema } from './household';

/** Household member row in GET /households/:id (detail) responses. */
export const householdMemberSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  email: z.string(),
  role: z.enum(['owner', 'member']),
  joined_at: z.string(),
});

export type HouseholdMemberContract = z.infer<typeof householdMemberSchema>;

/** GET /households/:id response envelope (household + members). */
export const householdDetailResponseSchema = z.object({
  household: householdListItemSchema,
  members: z.array(householdMemberSchema),
});

export type HouseholdDetailResponse = z.infer<typeof householdDetailResponseSchema>;
