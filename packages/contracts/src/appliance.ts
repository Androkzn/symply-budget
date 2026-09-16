import { z } from 'zod';

/** Lean appliance row for GET /households/:id/appliances list. */
export const applianceListItemSchema = z.object({
  id: z.string(),
  household_id: z.string(),
  space_id: z.string().optional(),
  name: z.string(),
  category: z.string(),
  type: z.string(),
  location: z.string().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  serial_number: z.string().optional(),
  purchase_date: z.string().optional(),
  install_date: z.string().optional(),
  expected_lifespan: z.number().int().optional(),
  purchase_cost: z.number().optional(),
  total_maintenance_cost: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ApplianceListItem = z.infer<typeof applianceListItemSchema>;

/** GET /households/:id/appliances response envelope. */
export const appliancesListResponseSchema = z.object({
  appliances: z.array(applianceListItemSchema),
});

export type AppliancesListResponse = z.infer<typeof appliancesListResponseSchema>;

/** GET /households/:id/appliances/:applianceId response envelope. */
export const applianceResponseSchema = z.object({
  appliance: applianceListItemSchema,
});

export type ApplianceResponse = z.infer<typeof applianceResponseSchema>;
