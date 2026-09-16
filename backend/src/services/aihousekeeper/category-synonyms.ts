/**
 * Category synonyms for fuzzy routing — plan §B8.
 *
 * Used by FamilyRouter to stem-match task categories against member
 * `responsibilities_json` entries. Simple lowercase + substring check; no
 * stemming library needed at this scale.
 *
 * The synonym sets deliberately overlap with the project's SYSTEM_CATEGORIES
 * list but aren't 1:1 — users describe responsibilities in everyday terms
 * ("water", "outside"), while system categories use the plan's canonical
 * names.
 */

export const CATEGORY_SYNONYMS: Record<string, string[]> = {
  plumbing: ['water', 'faucet', 'pipe', 'leak', 'drain', 'toilet', 'shower', 'sink'],
  electrical: ['wiring', 'outlet', 'circuit', 'breaker', 'lighting', 'bulb', 'switch'],
  hvac: ['heating', 'cooling', 'ac', 'furnace', 'ventilation', 'air', 'thermostat', 'filter'],
  appliances: [
    'fridge',
    'refrigerator',
    'washer',
    'dryer',
    'dishwasher',
    'oven',
    'stove',
    'microwave',
  ],
  landscaping: ['garden', 'lawn', 'yard', 'trees', 'shrubs', 'grass', 'mowing', 'outdoor'],
  cleaning: ['vacuum', 'mop', 'wipe', 'dust', 'tidy', 'tidying'],
  roof: ['roof', 'shingle', 'gutter', 'gutters', 'downspout'],
  exterior: ['siding', 'paint', 'painting', 'caulk', 'outside'],
  interior: ['indoor', 'wall', 'walls', 'trim'],
  safety: ['alarm', 'smoke', 'carbon', 'detector', 'extinguisher'],
  snow_removal: ['snow', 'shovel', 'salt', 'ice', 'plow'],
  pest_control: ['pest', 'bug', 'bugs', 'insect', 'rodent', 'mice', 'mouse'],
  pool_spa: ['pool', 'spa', 'hot tub', 'chlorine'],
  garage_door: ['garage'],
  windows_doors: ['window', 'windows', 'door', 'doors', 'lock'],
  chimney: ['chimney', 'fireplace'],
  septic: ['septic', 'sewage'],
  drainage: ['drainage', 'sump'],
  irrigation: ['irrigation', 'sprinkler', 'sprinklers'],
};

/**
 * Normalize a label: lowercase + trim + collapse internal whitespace.
 */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Returns true if `taskCategory` is an exact match or fuzzy/synonym match
 * against any of `memberResponsibilities`.
 */
export function fuzzyCategoryMatch(
  taskCategory: string,
  memberResponsibilities: string[]
): boolean {
  if (!taskCategory || memberResponsibilities.length === 0) return false;
  const needle = normalize(taskCategory);
  const haystack = memberResponsibilities.map(normalize);

  // Exact match.
  if (haystack.includes(needle)) return true;

  // Direct synonym-set overlap.
  const needleSyns = CATEGORY_SYNONYMS[needle] ?? [];
  for (const h of haystack) {
    if (needleSyns.includes(h)) return true;
    const hSyns = CATEGORY_SYNONYMS[h] ?? [];
    if (hSyns.includes(needle)) return true;
    // Cross-synonym overlap.
    for (const ns of needleSyns) {
      if (hSyns.includes(ns)) return true;
    }
    // Substring fallback (handles "hvac_filter" vs "hvac").
    if (h.includes(needle) || needle.includes(h)) return true;
  }
  return false;
}

/**
 * Returns true if `taskCategory` === `responsibility` after normalization.
 */
export function exactCategoryMatch(
  taskCategory: string,
  memberResponsibilities: string[]
): boolean {
  if (!taskCategory || memberResponsibilities.length === 0) return false;
  const needle = normalize(taskCategory);
  return memberResponsibilities.map(normalize).includes(needle);
}
