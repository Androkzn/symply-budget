import type { HouseholdSpace } from '@api/household-spaces';
import { deterministicRowId } from '@symply/local-first';

import type { LocalSeasonalChecklist, LocalSeasonalChecklistItem } from './engine';

/**
 * Client copy of `backend/src/data/preset-spaces.ts`.
 *
 * A local-first household is minted on device with no network, so the seed can
 * no longer come from the Worker. Kept byte-identical in content to the backend
 * table so a household created offline and one created through the legacy API
 * present the same starting spaces; `__tests__/presetSpaces.test.ts` pins that.
 */
export type PresetSpaceSeed = {
  name: string;
  category: 'indoor' | 'outdoor' | 'garage' | 'basement' | 'attic';
  emoji: string;
  color: string;
};

export const PRESET_SPACE_SEEDS: readonly PresetSpaceSeed[] = [
  // Indoor living spaces
  { name: 'Living Room', category: 'indoor', emoji: '🛋️', color: '#E8F5F3' },
  { name: 'Kitchen', category: 'indoor', emoji: '🍳', color: '#FFF3E8' },
  { name: 'Dining Room', category: 'indoor', emoji: '🍽️', color: '#F5F5F5' },
  { name: 'Master Bedroom', category: 'indoor', emoji: '🛏️', color: '#E3F2FD' },
  { name: 'Bedroom', category: 'indoor', emoji: '🛏️', color: '#E3F2FD' },
  { name: 'Bathroom', category: 'indoor', emoji: '🚿', color: '#E8F5F3' },
  { name: 'Home Office', category: 'indoor', emoji: '💻', color: '#F5F5F5' },
  { name: 'Laundry Room', category: 'indoor', emoji: '🧺', color: '#FFFDE7' },
  // Outdoor spaces
  { name: 'Backyard', category: 'outdoor', emoji: '🌳', color: '#E8F5E9' },
  { name: 'Front Yard', category: 'outdoor', emoji: '🌿', color: '#E8F5E9' },
  { name: 'Deck', category: 'outdoor', emoji: '🪵', color: '#FFF3E8' },
  { name: 'Patio', category: 'outdoor', emoji: '🪑', color: '#FFF3E8' },
  { name: 'Garden', category: 'outdoor', emoji: '🌻', color: '#E8F5E9' },
  { name: 'Pool Area', category: 'outdoor', emoji: '🏊', color: '#E3F2FD' },
  { name: 'Shed', category: 'outdoor', emoji: '🏚️', color: '#FFF3E8' },
  { name: 'Roof', category: 'outdoor', emoji: '🏠', color: '#E8E8E8' },
  // Utility spaces
  { name: 'Garage', category: 'garage', emoji: '🚗', color: '#F5F5F5' },
  { name: 'Basement', category: 'basement', emoji: '📦', color: '#E8E8E8' },
  { name: 'Attic', category: 'attic', emoji: '📦', color: '#FFFDE7' },
  { name: 'Storage Room', category: 'indoor', emoji: '📦', color: '#F5F5F5' },
  { name: 'Utility Room', category: 'indoor', emoji: '🔧', color: '#F5F5F5' },
];

/**
 * The subset seeded into a brand-new local household. Deliberately smaller than
 * the full preset table: onboarding should not hand a member 21 empty rooms to
 * delete. The remaining presets stay available through "add a space".
 */
const SEEDED_SPACE_NAMES: readonly string[] = [
  'Living Room',
  'Kitchen',
  'Master Bedroom',
  'Bathroom',
  'Garage',
  'Backyard',
];

/**
 * Ids are deterministic per household, not random: minting the same starting
 * space twice (two devices that both mint before enrolling, a re-seed after a
 * restore) must merge, not duplicate. This is the S3b rule applied to a seed.
 */
export function defaultHouseholdSpaces(householdId: string): HouseholdSpace[] {
  const now = new Date().toISOString();
  return SEEDED_SPACE_NAMES.map((name, index) => {
    const preset = PRESET_SPACE_SEEDS.find((seed) => seed.name === name)!;
    return {
      id: deterministicRowId('spc', [householdId, preset.name]),
      household_id: householdId,
      name: preset.name,
      space_type: 'preset' as const,
      category: preset.category,
      floor_level: null,
      icon_emoji: preset.emoji,
      icon_color: preset.color,
      custom_image_key: null,
      custom_image_url: null,
      description: null,
      area_sqft: null,
      display_order: index,
      created_at: now,
      updated_at: now,
      version: 1,
    };
  });
}

const SEASONS = ['spring', 'summer', 'fall', 'winter'] as const;

/**
 * One empty seasonal checklist per season for the current year. The item bodies
 * come from the Tier-C template catalogue over HTTP (plan §1.2) — seeding the
 * shells offline is what makes the Seasonal tab render on a fresh install with
 * no network.
 */
export function defaultSeasonalChecklists(
  householdId: string,
  year: number = new Date().getFullYear(),
): { checklists: LocalSeasonalChecklist[]; items: LocalSeasonalChecklistItem[] } {
  const now = new Date().toISOString();
  const checklists = SEASONS.map((season) => ({
    id: deterministicRowId('scl', [householdId, season, year]),
    household_id: householdId,
    season,
    year,
    climate_zone: 'unknown',
    created_at: now,
    updated_at: now,
  }));
  return { checklists, items: [] };
}
