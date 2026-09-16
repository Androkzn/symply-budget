import { Ionicons } from '@expo/vector-icons';

/**
 * Canonical Ionicon lookups for the app's category taxonomies.
 *
 * Before this module, ~8 screens each kept their own emoji→category map
 * (`Record<string, string>` of 📋🧹⚡…). That produced inconsistent, off-brand
 * icons. Everything now resolves through here so a "plumbing" task, a "plumber"
 * contractor and a plumbing finding all render the SAME Ionicon.
 *
 * Render with the shared component, e.g.
 *   <Ionicons name={getSystemCategoryIcon(task.system_category)} size={22} color={color} />
 */
export type IoniconName = keyof typeof Ionicons.glyphMap;

/** Fallback when a category is unknown/unmapped. */
export const DEFAULT_CATEGORY_ICON: IoniconName = 'ellipsis-horizontal-circle';

/**
 * System maintenance/home categories (the ~45 `system_category` values used by
 * tasks, findings and maintenance cards). Keys are the backend snake_case value.
 */
const SYSTEM_CATEGORY_ICONS: Record<string, IoniconName> = {
  // Home & life
  general: 'list',
  other: 'list',
  cleaning: 'sparkles',
  errands: 'cart',
  finance: 'cash',
  documents: 'document-text',
  family: 'people',
  pets: 'paw',
  health: 'medkit',
  vehicle: 'car-sport',
  events: 'balloon',
  moving: 'cube',
  // Systems
  hvac: 'snow',
  plumbing: 'water',
  electrical: 'flash',
  gas: 'flame',
  appliances: 'tv',
  smart_home: 'hardware-chip',
  solar: 'sunny',
  phone_internet: 'wifi',
  // Structure
  roof: 'home',
  foundation: 'layers',
  exterior: 'business',
  interior: 'bed',
  windows_doors: 'browsers',
  flooring: 'grid',
  painting: 'color-palette',
  siding: 'albums',
  gutters: 'rainy',
  fencing: 'reorder-four',
  deck_patio: 'umbrella',
  garage_door: 'car',
  garage: 'car',
  chimney: 'bonfire',
  attic: 'archive',
  basement: 'file-tray-stacked',
  insulation: 'thermometer',
  structure: 'construct',
  // Water & outdoor
  drainage: 'funnel',
  septic: 'water',
  pool_spa: 'water',
  irrigation: 'rainy',
  landscaping: 'leaf',
  snow_removal: 'snow',
  // Services
  safety: 'shield-checkmark',
  security: 'lock-closed',
  pest_control: 'bug',
  inspection: 'search',
};

/** Resolve a system category to its Ionicon (falls back to a neutral glyph). */
export function getSystemCategoryIcon(category?: string | null): IoniconName {
  if (!category) return DEFAULT_CATEGORY_ICON;
  return SYSTEM_CATEGORY_ICONS[category.trim().toLowerCase()] ?? DEFAULT_CATEGORY_ICON;
}

/**
 * Multi-word / acronym labels that a plain snake_case → Title Case humanize
 * would get wrong. Everything else is humanized generically below.
 */
const SYSTEM_CATEGORY_LABEL_OVERRIDES: Record<string, string> = {
  hvac: 'HVAC',
  pool_spa: 'Pool & Spa',
  deck_patio: 'Deck & Patio',
  windows_doors: 'Windows & Doors',
  phone_internet: 'Phone & Internet',
  smart_home: 'Smart Home',
  snow_removal: 'Snow Removal',
  pest_control: 'Pest Control',
  garage_door: 'Garage Door',
};

/**
 * Human-readable label for a system category (e.g. 'garage_door' → 'Garage Door').
 * Keeps task cards in sync with the detail view instead of collapsing everything
 * to "General".
 */
export function getSystemCategoryLabel(category?: string | null): string {
  if (!category) return 'General';
  const key = category.trim().toLowerCase();
  if (SYSTEM_CATEGORY_LABEL_OVERRIDES[key]) return SYSTEM_CATEGORY_LABEL_OVERRIDES[key];
  return key
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Contractor / service-provider categories (`contractor_category` values used by
 * the contractor + labor-hub features).
 */
const CONTRACTOR_CATEGORY_ICONS: Record<string, IoniconName> = {
  plumber: 'water',
  electrician: 'flash',
  hvac: 'snow',
  roofer: 'home',
  general: 'construct',
  landscaper: 'leaf',
  painter: 'color-palette',
  carpenter: 'hammer',
  appliance: 'tv',
  pest_control: 'bug',
  cleaning: 'sparkles',
  government: 'business',
  municipal: 'business',
  utility_bchydro: 'flash',
  utility_fortisbc: 'flame',
  utility_telus: 'call',
  utility_shaw: 'wifi',
  utility_water: 'water',
  insurance: 'shield-checkmark',
  strata: 'business',
  property_mgmt: 'key',
  security: 'lock-closed',
  waste_mgmt: 'trash',
  home_warranty: 'document-text',
  inspector: 'search',
  surveyor: 'map',
  other: 'construct',
};

/** Resolve a contractor category to its Ionicon (falls back to a wrench). */
export function getContractorCategoryIcon(category?: string | null): IoniconName {
  if (!category) return 'construct';
  return CONTRACTOR_CATEGORY_ICONS[category.trim().toLowerCase()] ?? 'construct';
}

/**
 * Detached-structure / outbuilding types used by the floor-plan feature.
 */
const STRUCTURE_TYPE_ICONS: Record<string, IoniconName> = {
  shed: 'home',
  storage: 'cube',
  detached_garage: 'car',
  garage: 'car',
  workshop: 'hammer',
  greenhouse: 'leaf',
  guest_house: 'home',
  pool_house: 'water',
  carport: 'car-sport',
  barn: 'home',
  entrance: 'enter',
  other: 'business',
};

/** Resolve a detached-structure type to its Ionicon. */
export function getStructureTypeIcon(type?: string | null): IoniconName {
  if (!type) return 'business';
  return STRUCTURE_TYPE_ICONS[type.trim().toLowerCase()] ?? 'business';
}
