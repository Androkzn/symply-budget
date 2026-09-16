import { z } from 'zod';

/** Lean home-feature row for GET /households/:id/home-features list. */
export const homeFeatureListItemSchema = z.object({
  id: z.string(),
  household_id: z.string(),
  feature_type: z.string(),
  feature_subtype: z.string().nullable(),
  quantity: z.number().int(),
  location: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  serial_number: z.string().nullable(),
  install_date: z.string().nullable(),
  warranty_expires: z.string().nullable(),
  age_years: z.number().nullable(),
  condition: z.enum(['excellent', 'good', 'fair', 'poor', 'unknown']),
  notes: z.string().nullable(),
  source: z.enum(['manual', 'report_extraction', 'user_input']),
  source_report_id: z.string().nullable(),
  extraction_confidence: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type HomeFeatureListItem = z.infer<typeof homeFeatureListItemSchema>;

/** GET /households/:id/home-features response envelope. */
export const homeFeaturesListResponseSchema = z.object({
  features: z.array(homeFeatureListItemSchema),
});

export type HomeFeaturesListResponse = z.infer<typeof homeFeaturesListResponseSchema>;
