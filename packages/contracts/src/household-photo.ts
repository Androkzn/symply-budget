import { z } from 'zod';

/** Generated URL from photo_key; always present on wire, null when no photo. */
export const householdPhotoUrlSchema = z.string().nullable();

export type HouseholdPhotoUrl = z.infer<typeof householdPhotoUrlSchema>;
