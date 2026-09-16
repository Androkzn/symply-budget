import type { GardenObjectType, GardenPlanObject } from './garden-objects';

/**
 * Curated catalogue of pre-designed garden objects (pool, fountain, hedge,
 * pergola, bench, …) layered on top of the seven backend `GardenObjectType`s.
 *
 * Every preset maps to one of the existing backend types so storage stays
 * compatible without a migration. The richer identity (icon, default size,
 * color, label) lives on the object's `metadata` field via:
 *   metadata.presetId  → which catalogue entry the user picked
 *   metadata.iconKey   → which custom on-canvas renderer to use
 *   metadata.shape     → already-supported circle/square/rectangle override
 */

export type GardenObjectCategoryId =
  | 'water'
  | 'plants'
  | 'structures'
  | 'outdoor'
  | 'furniture'
  | 'decor'
  | 'beds'
  | 'paths'
  | 'play'
  | 'notes';

export interface GardenObjectCategory {
  id: GardenObjectCategoryId;
  label: string;
  ionIcon: string;
  accent: string;
}

export const GARDEN_OBJECT_CATEGORIES: readonly GardenObjectCategory[] = [
  { id: 'water', label: 'Water', ionIcon: 'water', accent: '#0EA5E9' },
  { id: 'plants', label: 'Plants', ionIcon: 'leaf', accent: '#16A34A' },
  { id: 'structures', label: 'Structures', ionIcon: 'home', accent: '#92400E' },
  { id: 'outdoor', label: 'Outdoor living', ionIcon: 'flame', accent: '#EA580C' },
  { id: 'furniture', label: 'Furniture', ionIcon: 'bed', accent: '#7C3AED' },
  { id: 'decor', label: 'Decor & lights', ionIcon: 'sparkles', accent: '#F59E0B' },
  { id: 'beds', label: 'Beds & borders', ionIcon: 'flower', accent: '#A16207' },
  { id: 'paths', label: 'Paths & surfaces', ionIcon: 'trail-sign', accent: '#64748B' },
  { id: 'play', label: 'Play', ionIcon: 'happy', accent: '#DB2777' },
  { id: 'notes', label: 'Notes', ionIcon: 'pricetag', accent: '#0F766E' },
] as const;

/**
 * Iconography used when drawing presets on the canvas. Each `iconKey` is wired
 * to a custom SVG renderer in `garden-object-renderer.tsx`. `shape` is the
 * shape primitive used as a fallback / hit-test bounds.
 */
export type GardenObjectIconKey =
  // water
  | 'pool'
  | 'pool_round'
  | 'hot_tub'
  | 'fountain'
  | 'pond'
  | 'bird_bath'
  | 'waterfall'
  // plants
  | 'tree'
  | 'tree_pine'
  | 'palm'
  | 'shrub'
  | 'hedge'
  | 'flower'
  | 'grass'
  | 'cactus'
  | 'fern'
  | 'vine'
  // structures
  | 'shed'
  | 'greenhouse'
  | 'pergola'
  | 'gazebo'
  | 'arbor'
  | 'trellis'
  | 'fence'
  | 'gate'
  | 'wall'
  // outdoor living
  | 'patio'
  | 'deck'
  | 'kitchen'
  | 'firepit'
  | 'bbq'
  | 'pizza_oven'
  // furniture
  | 'bench'
  | 'table_chairs'
  | 'lounger'
  | 'hammock'
  | 'swing'
  | 'umbrella'
  // decor
  | 'statue'
  | 'planter'
  | 'lantern'
  | 'lamp_post'
  | 'bird_feeder'
  // beds
  | 'raised_bed'
  | 'flower_bed'
  | 'veg_patch'
  | 'mulch'
  // paths
  | 'path_curve'
  | 'stepping_stones'
  | 'driveway'
  | 'gravel'
  | 'lawn'
  // play
  | 'sandbox'
  | 'trampoline'
  | 'play_set'
  // notes
  | 'note';

export type SimpleShape = 'circle' | 'square' | 'rectangle';

export interface GardenObjectPreset {
  id: string;
  name: string;
  category: GardenObjectCategoryId;
  /** extra search keywords (lower-cased) */
  searchTags: string[];
  /** which backend GardenObjectType to use for storage */
  type: GardenObjectType;
  /** which on-canvas renderer to draw */
  iconKey: GardenObjectIconKey;
  /** primitive shape used for hit-test / fallback rendering */
  shape: SimpleShape;
  defaultWidth: number;
  defaultHeight: number;
  defaultColor: string;
  defaultLabel: string;
}

const W = (w: number, h: number) => ({ defaultWidth: w, defaultHeight: h });

export const GARDEN_OBJECT_PRESETS: readonly GardenObjectPreset[] = [
  // ─── Water features ──────────────────────────────────────────────
  {
    id: 'pool',
    name: 'Swimming pool',
    category: 'water',
    searchTags: ['swim', 'pool', 'swimming'],
    type: 'patio',
    iconKey: 'pool',
    shape: 'rectangle',
    ...W(0.32, 0.18),
    defaultColor: '#38BDF8',
    defaultLabel: 'Pool',
  },
  {
    id: 'pool_round',
    name: 'Round pool',
    category: 'water',
    searchTags: ['plunge', 'circular', 'pool'],
    type: 'patio',
    iconKey: 'pool_round',
    shape: 'circle',
    ...W(0.18, 0.18),
    defaultColor: '#38BDF8',
    defaultLabel: 'Round pool',
  },
  {
    id: 'hot_tub',
    name: 'Hot tub',
    category: 'water',
    searchTags: ['jacuzzi', 'spa', 'tub'],
    type: 'patio',
    iconKey: 'hot_tub',
    shape: 'square',
    ...W(0.1, 0.1),
    defaultColor: '#0E7490',
    defaultLabel: 'Hot tub',
  },
  {
    id: 'fountain',
    name: 'Fountain',
    category: 'water',
    searchTags: ['water feature', 'fountain'],
    type: 'patio',
    iconKey: 'fountain',
    shape: 'circle',
    ...W(0.1, 0.1),
    defaultColor: '#0EA5E9',
    defaultLabel: 'Fountain',
  },
  {
    id: 'pond',
    name: 'Pond',
    category: 'water',
    searchTags: ['water', 'koi', 'pond'],
    type: 'patio',
    iconKey: 'pond',
    shape: 'circle',
    ...W(0.18, 0.14),
    defaultColor: '#3B82F6',
    defaultLabel: 'Pond',
  },
  {
    id: 'bird_bath',
    name: 'Bird bath',
    category: 'water',
    searchTags: ['birds', 'bath', 'water'],
    type: 'patio',
    iconKey: 'bird_bath',
    shape: 'circle',
    ...W(0.06, 0.06),
    defaultColor: '#94A3B8',
    defaultLabel: 'Bird bath',
  },
  {
    id: 'waterfall',
    name: 'Waterfall',
    category: 'water',
    searchTags: ['cascade', 'fall', 'water'],
    type: 'patio',
    iconKey: 'waterfall',
    shape: 'rectangle',
    ...W(0.08, 0.18),
    defaultColor: '#0284C7',
    defaultLabel: 'Waterfall',
  },

  // ─── Plants & trees ──────────────────────────────────────────────
  {
    id: 'tree',
    name: 'Tree',
    category: 'plants',
    searchTags: ['tree', 'oak', 'maple', 'plant'],
    type: 'tree',
    iconKey: 'tree',
    shape: 'circle',
    ...W(0.12, 0.12),
    defaultColor: '#15803D',
    defaultLabel: 'Tree',
  },
  {
    id: 'tree_pine',
    name: 'Pine tree',
    category: 'plants',
    searchTags: ['conifer', 'evergreen', 'pine', 'fir'],
    type: 'tree',
    iconKey: 'tree_pine',
    shape: 'circle',
    ...W(0.1, 0.1),
    defaultColor: '#166534',
    defaultLabel: 'Pine',
  },
  {
    id: 'palm',
    name: 'Palm tree',
    category: 'plants',
    searchTags: ['tropical', 'palm'],
    type: 'tree',
    iconKey: 'palm',
    shape: 'circle',
    ...W(0.1, 0.1),
    defaultColor: '#65A30D',
    defaultLabel: 'Palm',
  },
  {
    id: 'shrub',
    name: 'Shrub',
    category: 'plants',
    searchTags: ['bush', 'shrub'],
    type: 'shrub',
    iconKey: 'shrub',
    shape: 'circle',
    ...W(0.09, 0.09),
    defaultColor: '#4D7C0F',
    defaultLabel: 'Shrub',
  },
  {
    id: 'hedge',
    name: 'Hedge',
    category: 'plants',
    searchTags: ['hedgerow', 'boxwood', 'hedge'],
    type: 'shrub',
    iconKey: 'hedge',
    shape: 'rectangle',
    ...W(0.28, 0.06),
    defaultColor: '#3F6212',
    defaultLabel: 'Hedge',
  },
  {
    id: 'flower',
    name: 'Flowers',
    category: 'plants',
    searchTags: ['flower', 'bloom'],
    type: 'flower',
    iconKey: 'flower',
    shape: 'circle',
    ...W(0.1, 0.1),
    defaultColor: '#D946EF',
    defaultLabel: 'Flowers',
  },
  {
    id: 'grass',
    name: 'Ornamental grass',
    category: 'plants',
    searchTags: ['grass', 'pampas', 'ornamental'],
    type: 'flower',
    iconKey: 'grass',
    shape: 'circle',
    ...W(0.08, 0.08),
    defaultColor: '#A3E635',
    defaultLabel: 'Grass',
  },
  {
    id: 'cactus',
    name: 'Cactus',
    category: 'plants',
    searchTags: ['cactus', 'succulent', 'desert'],
    type: 'shrub',
    iconKey: 'cactus',
    shape: 'rectangle',
    ...W(0.06, 0.1),
    defaultColor: '#15803D',
    defaultLabel: 'Cactus',
  },
  {
    id: 'fern',
    name: 'Fern',
    category: 'plants',
    searchTags: ['fern', 'leaf'],
    type: 'shrub',
    iconKey: 'fern',
    shape: 'circle',
    ...W(0.08, 0.08),
    defaultColor: '#16A34A',
    defaultLabel: 'Fern',
  },
  {
    id: 'vine',
    name: 'Vine',
    category: 'plants',
    searchTags: ['vine', 'climber', 'ivy'],
    type: 'flower',
    iconKey: 'vine',
    shape: 'rectangle',
    ...W(0.18, 0.05),
    defaultColor: '#16A34A',
    defaultLabel: 'Vine',
  },

  // ─── Structures ──────────────────────────────────────────────────
  {
    id: 'shed',
    name: 'Shed',
    category: 'structures',
    searchTags: ['storage', 'shed'],
    type: 'patio',
    iconKey: 'shed',
    shape: 'rectangle',
    ...W(0.16, 0.12),
    defaultColor: '#92400E',
    defaultLabel: 'Shed',
  },
  {
    id: 'greenhouse',
    name: 'Greenhouse',
    category: 'structures',
    searchTags: ['glass', 'house', 'greenhouse'],
    type: 'patio',
    iconKey: 'greenhouse',
    shape: 'rectangle',
    ...W(0.18, 0.12),
    defaultColor: '#7DD3FC',
    defaultLabel: 'Greenhouse',
  },
  {
    id: 'pergola',
    name: 'Pergola',
    category: 'structures',
    searchTags: ['shade', 'wood', 'pergola'],
    type: 'patio',
    iconKey: 'pergola',
    shape: 'rectangle',
    ...W(0.22, 0.16),
    defaultColor: '#A16207',
    defaultLabel: 'Pergola',
  },
  {
    id: 'gazebo',
    name: 'Gazebo',
    category: 'structures',
    searchTags: ['gazebo', 'pavilion'],
    type: 'patio',
    iconKey: 'gazebo',
    shape: 'circle',
    ...W(0.18, 0.18),
    defaultColor: '#A16207',
    defaultLabel: 'Gazebo',
  },
  {
    id: 'arbor',
    name: 'Arbor',
    category: 'structures',
    searchTags: ['arch', 'arbor'],
    type: 'patio',
    iconKey: 'arbor',
    shape: 'rectangle',
    ...W(0.12, 0.05),
    defaultColor: '#A16207',
    defaultLabel: 'Arbor',
  },
  {
    id: 'trellis',
    name: 'Trellis',
    category: 'structures',
    searchTags: ['lattice', 'trellis'],
    type: 'patio',
    iconKey: 'trellis',
    shape: 'rectangle',
    ...W(0.16, 0.04),
    defaultColor: '#A16207',
    defaultLabel: 'Trellis',
  },
  {
    id: 'fence',
    name: 'Fence',
    category: 'structures',
    searchTags: ['fence', 'border'],
    type: 'patio',
    iconKey: 'fence',
    shape: 'rectangle',
    ...W(0.32, 0.03),
    defaultColor: '#78350F',
    defaultLabel: 'Fence',
  },
  {
    id: 'gate',
    name: 'Gate',
    category: 'structures',
    searchTags: ['gate', 'entrance'],
    type: 'patio',
    iconKey: 'gate',
    shape: 'rectangle',
    ...W(0.08, 0.03),
    defaultColor: '#7C2D12',
    defaultLabel: 'Gate',
  },
  {
    id: 'wall',
    name: 'Garden wall',
    category: 'structures',
    searchTags: ['wall', 'retaining'],
    type: 'patio',
    iconKey: 'wall',
    shape: 'rectangle',
    ...W(0.3, 0.04),
    defaultColor: '#57534E',
    defaultLabel: 'Wall',
  },

  // ─── Outdoor living ──────────────────────────────────────────────
  {
    id: 'patio',
    name: 'Patio',
    category: 'outdoor',
    searchTags: ['patio', 'paving'],
    type: 'patio',
    iconKey: 'patio',
    shape: 'rectangle',
    ...W(0.22, 0.16),
    defaultColor: '#94A3B8',
    defaultLabel: 'Patio',
  },
  {
    id: 'deck',
    name: 'Deck',
    category: 'outdoor',
    searchTags: ['deck', 'wood', 'planks'],
    type: 'patio',
    iconKey: 'deck',
    shape: 'rectangle',
    ...W(0.24, 0.16),
    defaultColor: '#A16207',
    defaultLabel: 'Deck',
  },
  {
    id: 'kitchen',
    name: 'Outdoor kitchen',
    category: 'outdoor',
    searchTags: ['kitchen', 'cook', 'counter'],
    type: 'patio',
    iconKey: 'kitchen',
    shape: 'rectangle',
    ...W(0.2, 0.08),
    defaultColor: '#475569',
    defaultLabel: 'Kitchen',
  },
  {
    id: 'firepit',
    name: 'Fire pit',
    category: 'outdoor',
    searchTags: ['fire', 'pit', 'flame'],
    type: 'patio',
    iconKey: 'firepit',
    shape: 'circle',
    ...W(0.1, 0.1),
    defaultColor: '#EA580C',
    defaultLabel: 'Fire pit',
  },
  {
    id: 'bbq',
    name: 'BBQ grill',
    category: 'outdoor',
    searchTags: ['bbq', 'grill', 'barbecue'],
    type: 'patio',
    iconKey: 'bbq',
    shape: 'rectangle',
    ...W(0.08, 0.05),
    defaultColor: '#1F2937',
    defaultLabel: 'BBQ',
  },
  {
    id: 'pizza_oven',
    name: 'Pizza oven',
    category: 'outdoor',
    searchTags: ['pizza', 'oven', 'wood-fired'],
    type: 'patio',
    iconKey: 'pizza_oven',
    shape: 'circle',
    ...W(0.08, 0.08),
    defaultColor: '#B45309',
    defaultLabel: 'Pizza oven',
  },

  // ─── Furniture ───────────────────────────────────────────────────
  {
    id: 'bench',
    name: 'Bench',
    category: 'furniture',
    searchTags: ['bench', 'seat'],
    type: 'patio',
    iconKey: 'bench',
    shape: 'rectangle',
    ...W(0.14, 0.04),
    defaultColor: '#78350F',
    defaultLabel: 'Bench',
  },
  {
    id: 'table_chairs',
    name: 'Table & chairs',
    category: 'furniture',
    searchTags: ['table', 'chairs', 'dining'],
    type: 'patio',
    iconKey: 'table_chairs',
    shape: 'circle',
    ...W(0.12, 0.12),
    defaultColor: '#A16207',
    defaultLabel: 'Table',
  },
  {
    id: 'lounger',
    name: 'Lounger',
    category: 'furniture',
    searchTags: ['sun', 'lounger', 'chaise'],
    type: 'patio',
    iconKey: 'lounger',
    shape: 'rectangle',
    ...W(0.08, 0.16),
    defaultColor: '#0EA5E9',
    defaultLabel: 'Lounger',
  },
  {
    id: 'hammock',
    name: 'Hammock',
    category: 'furniture',
    searchTags: ['hammock', 'rest'],
    type: 'patio',
    iconKey: 'hammock',
    shape: 'rectangle',
    ...W(0.18, 0.06),
    defaultColor: '#F472B6',
    defaultLabel: 'Hammock',
  },
  {
    id: 'swing',
    name: 'Swing',
    category: 'furniture',
    searchTags: ['swing', 'porch'],
    type: 'patio',
    iconKey: 'swing',
    shape: 'rectangle',
    ...W(0.12, 0.05),
    defaultColor: '#7C2D12',
    defaultLabel: 'Swing',
  },
  {
    id: 'umbrella',
    name: 'Umbrella',
    category: 'furniture',
    searchTags: ['umbrella', 'parasol', 'shade'],
    type: 'patio',
    iconKey: 'umbrella',
    shape: 'circle',
    ...W(0.1, 0.1),
    defaultColor: '#EF4444',
    defaultLabel: 'Umbrella',
  },

  // ─── Decor & lighting ────────────────────────────────────────────
  {
    id: 'statue',
    name: 'Statue',
    category: 'decor',
    searchTags: ['statue', 'sculpture'],
    type: 'patio',
    iconKey: 'statue',
    shape: 'square',
    ...W(0.05, 0.05),
    defaultColor: '#94A3B8',
    defaultLabel: 'Statue',
  },
  {
    id: 'planter',
    name: 'Planter pot',
    category: 'decor',
    searchTags: ['planter', 'pot', 'urn'],
    type: 'patio',
    iconKey: 'planter',
    shape: 'circle',
    ...W(0.06, 0.06),
    defaultColor: '#B45309',
    defaultLabel: 'Planter',
  },
  {
    id: 'lantern',
    name: 'Lantern',
    category: 'decor',
    searchTags: ['lantern', 'light', 'lamp'],
    type: 'patio',
    iconKey: 'lantern',
    shape: 'square',
    ...W(0.04, 0.04),
    defaultColor: '#FACC15',
    defaultLabel: 'Lantern',
  },
  {
    id: 'lamp_post',
    name: 'Lamp post',
    category: 'decor',
    searchTags: ['lamp', 'light', 'post'],
    type: 'patio',
    iconKey: 'lamp_post',
    shape: 'circle',
    ...W(0.04, 0.04),
    defaultColor: '#F59E0B',
    defaultLabel: 'Lamp',
  },
  {
    id: 'bird_feeder',
    name: 'Bird feeder',
    category: 'decor',
    searchTags: ['bird', 'feeder'],
    type: 'patio',
    iconKey: 'bird_feeder',
    shape: 'circle',
    ...W(0.05, 0.05),
    defaultColor: '#92400E',
    defaultLabel: 'Bird feeder',
  },

  // ─── Beds & borders ──────────────────────────────────────────────
  {
    id: 'raised_bed',
    name: 'Raised bed',
    category: 'beds',
    searchTags: ['raised', 'bed', 'planter'],
    type: 'raised_bed',
    iconKey: 'raised_bed',
    shape: 'rectangle',
    ...W(0.18, 0.1),
    defaultColor: '#A16207',
    defaultLabel: 'Raised bed',
  },
  {
    id: 'flower_bed',
    name: 'Flower bed',
    category: 'beds',
    searchTags: ['flower', 'bed', 'border'],
    type: 'raised_bed',
    iconKey: 'flower_bed',
    shape: 'rectangle',
    ...W(0.2, 0.1),
    defaultColor: '#D946EF',
    defaultLabel: 'Flower bed',
  },
  {
    id: 'veg_patch',
    name: 'Vegetable patch',
    category: 'beds',
    searchTags: ['vegetable', 'patch', 'garden'],
    type: 'raised_bed',
    iconKey: 'veg_patch',
    shape: 'rectangle',
    ...W(0.22, 0.14),
    defaultColor: '#65A30D',
    defaultLabel: 'Veg patch',
  },
  {
    id: 'mulch',
    name: 'Mulch area',
    category: 'beds',
    searchTags: ['mulch', 'bark'],
    type: 'raised_bed',
    iconKey: 'mulch',
    shape: 'rectangle',
    ...W(0.22, 0.12),
    defaultColor: '#78350F',
    defaultLabel: 'Mulch',
  },

  // ─── Paths & surfaces ────────────────────────────────────────────
  {
    id: 'path_curve',
    name: 'Path',
    category: 'paths',
    searchTags: ['path', 'walkway'],
    type: 'path',
    iconKey: 'path_curve',
    shape: 'rectangle',
    ...W(0.28, 0.05),
    defaultColor: '#94A3B8',
    defaultLabel: 'Path',
  },
  {
    id: 'stepping_stones',
    name: 'Stepping stones',
    category: 'paths',
    searchTags: ['stones', 'stepping', 'path'],
    type: 'path',
    iconKey: 'stepping_stones',
    shape: 'rectangle',
    ...W(0.24, 0.06),
    defaultColor: '#64748B',
    defaultLabel: 'Stones',
  },
  {
    id: 'driveway',
    name: 'Driveway',
    category: 'paths',
    searchTags: ['driveway', 'asphalt', 'concrete'],
    type: 'patio',
    iconKey: 'driveway',
    shape: 'rectangle',
    ...W(0.32, 0.12),
    defaultColor: '#475569',
    defaultLabel: 'Driveway',
  },
  {
    id: 'gravel',
    name: 'Gravel area',
    category: 'paths',
    searchTags: ['gravel', 'pebble'],
    type: 'patio',
    iconKey: 'gravel',
    shape: 'rectangle',
    ...W(0.18, 0.14),
    defaultColor: '#A8A29E',
    defaultLabel: 'Gravel',
  },
  {
    id: 'lawn',
    name: 'Lawn',
    category: 'paths',
    searchTags: ['lawn', 'grass', 'turf'],
    type: 'patio',
    iconKey: 'lawn',
    shape: 'rectangle',
    ...W(0.4, 0.3),
    defaultColor: '#86EFAC',
    defaultLabel: 'Lawn',
  },

  // ─── Play ────────────────────────────────────────────────────────
  {
    id: 'sandbox',
    name: 'Sandbox',
    category: 'play',
    searchTags: ['sand', 'box', 'kids'],
    type: 'patio',
    iconKey: 'sandbox',
    shape: 'square',
    ...W(0.12, 0.12),
    defaultColor: '#FDE68A',
    defaultLabel: 'Sandbox',
  },
  {
    id: 'trampoline',
    name: 'Trampoline',
    category: 'play',
    searchTags: ['trampoline', 'jump', 'kids'],
    type: 'patio',
    iconKey: 'trampoline',
    shape: 'circle',
    ...W(0.16, 0.16),
    defaultColor: '#1E3A8A',
    defaultLabel: 'Trampoline',
  },
  {
    id: 'play_set',
    name: 'Play set',
    category: 'play',
    searchTags: ['playground', 'kids', 'slide'],
    type: 'patio',
    iconKey: 'play_set',
    shape: 'rectangle',
    ...W(0.18, 0.14),
    defaultColor: '#DB2777',
    defaultLabel: 'Play set',
  },

  // ─── Notes ───────────────────────────────────────────────────────
  {
    id: 'note',
    name: 'Note label',
    category: 'notes',
    searchTags: ['note', 'label', 'text'],
    type: 'label',
    iconKey: 'note',
    shape: 'rectangle',
    ...W(0.16, 0.06),
    defaultColor: '#0F766E',
    defaultLabel: 'Note',
  },
] as const;

const PRESETS_BY_ID = new Map<string, GardenObjectPreset>(
  GARDEN_OBJECT_PRESETS.map(preset => [preset.id, preset]),
);

const PRESETS_BY_ICON = new Map<GardenObjectIconKey, GardenObjectPreset>(
  GARDEN_OBJECT_PRESETS.map(preset => [preset.iconKey, preset]),
);

export function getGardenObjectPreset(presetId: string | null | undefined): GardenObjectPreset | null {
  if (!presetId) return null;
  return PRESETS_BY_ID.get(presetId) ?? null;
}

export function getGardenObjectPresetByIconKey(
  iconKey: GardenObjectIconKey | null | undefined,
): GardenObjectPreset | null {
  if (!iconKey) return null;
  return PRESETS_BY_ICON.get(iconKey) ?? null;
}

export function presetMetadataFromObject(
  object: Pick<GardenPlanObject, 'metadata'>,
): {
  presetId: string | null;
  iconKey: GardenObjectIconKey | null;
  shape: SimpleShape | null;
} {
  const metadata = object.metadata ?? null;
  const presetId =
    metadata && typeof metadata.presetId === 'string' ? metadata.presetId : null;
  const iconKey =
    metadata && typeof metadata.iconKey === 'string'
      ? (metadata.iconKey as GardenObjectIconKey)
      : null;
  const shape =
    metadata && typeof metadata.shape === 'string' &&
    (metadata.shape === 'circle' || metadata.shape === 'square' || metadata.shape === 'rectangle')
      ? (metadata.shape as SimpleShape)
      : null;
  return { presetId, iconKey, shape };
}

export function buildPresetMetadata(
  preset: GardenObjectPreset,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(extra ?? {}),
    presetId: preset.id,
    iconKey: preset.iconKey,
    shape: preset.shape,
  };
}

export interface CustomShapeOptions {
  shape: SimpleShape;
  label: string;
  color: string;
}

export function buildCustomShapeMetadata(
  options: CustomShapeOptions,
): Record<string, unknown> {
  return {
    presetId: 'custom',
    iconKey: null,
    shape: options.shape,
    custom: true,
  };
}

export function searchGardenObjectPresets(query: string): GardenObjectPreset[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...GARDEN_OBJECT_PRESETS];
  return GARDEN_OBJECT_PRESETS.filter(preset => {
    if (preset.name.toLowerCase().includes(trimmed)) return true;
    if (preset.id.includes(trimmed)) return true;
    if (preset.category.includes(trimmed)) return true;
    return preset.searchTags.some(tag => tag.includes(trimmed));
  });
}

export function presetsForCategory(category: GardenObjectCategoryId): GardenObjectPreset[] {
  return GARDEN_OBJECT_PRESETS.filter(preset => preset.category === category);
}
