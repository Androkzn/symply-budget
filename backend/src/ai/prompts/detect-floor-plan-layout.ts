/**
 * Pass 1 — Layout detection only.
 * Identifies floors + detached areas + bounding boxes + property totals.
 * Does NOT extract deep space lists (that is Pass 2 per crop).
 */

export const FLOOR_PLAN_LAYOUT_SYSTEM_PROMPT = `You are an expert floor plan layout analyst.

Your ONLY job is to identify the top-level regions on a floor plan page:
1. FLOORS — levels of the main building (Main Floor, Below Main Floor, Basement, Second Floor, etc.)
2. DETACHED AREAS — separate structures (Shed, Storage, Detached Garage, Guest House, etc.)

For each region provide a tight bounding box in NORMALIZED coordinates (0-1),
where (0,0) is top-left and (1,1) is bottom-right.

Rules:
- Ignore title blocks, agent contact info, area summary tables, legends, and page margins.
- Only box the actual architectural drawings.
- Deck / porch / garage attached to a floor are NOT separate regions — they belong inside that floor.
- Only truly detached structures get their own region.
- Prefer slightly tight boxes over loose ones; a small padding will be added later.
- If only one floor drawing is present, return a single floor region covering it.
- Be precise — these boxes are used to crop each region for further analysis.

Respond ONLY with valid JSON.`;

export const FLOOR_PLAN_LAYOUT_USER_PROMPT = `Detect all floors and detached areas on this floor plan page.

Return JSON with this structure:
{
  "property_address": "string or null",
  "total_area": { "value": number or null, "unit": "sq_ft" | "sq_m" | null },
  "floors": [
    {
      "name": "string — e.g. Main Floor, Below Main Floor",
      "level": number — -1 basement, 0 main, 1 second, etc.,
      "area": { "value": number or null, "unit": "sq_ft" | "sq_m" | null },
      "bounding_box": { "x1": 0-1, "y1": 0-1, "x2": 0-1, "y2": 0-1 }
    }
  ],
  "detached_areas": [
    {
      "name": "string — e.g. Storage, Shed",
      "type": "shed|storage|detached_garage|workshop|greenhouse|guest_house|pool_house|carport|other",
      "area": { "value": number or null, "unit": "sq_ft" | "sq_m" | null },
      "bounding_box": { "x1": 0-1, "y1": 0-1, "x2": 0-1, "y2": 0-1 }
    }
  ],
  "excluded_from_living_area": {
    "total": { "value": number or null, "unit": "sq_ft" | "sq_m" | null },
    "items": [{ "name": "string", "area": { "value": number or null, "unit": "sq_ft" | "sq_m" | null } }]
  },
  "metadata": {
    "multiple_floors": boolean,
    "floor_count": number,
    "detached_area_count": number,
    "confidence": "high" | "medium" | "low",
    "layout_type": "side_by_side" | "stacked" | "single" | "mixed"
  }
}

Do NOT list individual rooms/spaces. Layout and bounding boxes only.
Respond ONLY with valid JSON.`;

/**
 * Pass 2a — Spaces analysis for a single cropped region.
 */
export const FLOOR_PLAN_REGION_SPACES_SYSTEM_PROMPT = `You are an expert floor plan analyst focused on ONE floor or detached area crop.

Extract every space (room, garage, deck, patio, etc.) visible in this crop only.
Do not invent spaces that are not visible. Do not reference other floors.

Space types: living_room, dining_room, kitchen, bedroom, bathroom, office, laundry,
garage, storage, closet, hallway, stairs, entry, foyer, mudroom, pantry, utility,
bonus, recreation, family_room, den, library, sunroom, nook, bar, wet_bar, gym,
theater, wine_cellar, sauna, deck, patio, porch, balcony, covered_patio, other.

Respond ONLY with valid JSON.`;

export function buildRegionSpacesUserPrompt(regionName: string, kind: 'floor' | 'detached'): string {
  return `This image is a crop of a single ${kind === 'floor' ? 'floor' : 'detached area'} named "${regionName}".

List all spaces inside it with dimensions when labeled.

Return JSON:
{
  "name": "${regionName}",
  "spaces": [
    {
      "name": "string",
      "type": "string — space type from the allowed list",
      "is_outdoor": boolean,
      "dimensions": { "width": number or null, "length": number or null, "unit": "ft"|"m"|"in"|null },
      "area": { "value": number or null, "unit": "sq_ft"|"sq_m"|null },
      "position": { "description": "string — e.g. front-left, center, rear" }
    }
  ]
}

Respond ONLY with valid JSON.`;
}

export interface FloorPlanLayoutResult {
  property_address: string | null;
  total_area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  floors: Array<{
    name: string;
    level: number;
    area: { value: number | null; unit: 'sq_ft' | 'sq_m' | null };
    bounding_box: { x1: number; y1: number; x2: number; y2: number } | null;
  }>;
  detached_areas: Array<{
    name: string;
    type: string;
    area: { value: number | null; unit: 'sq_ft' | 'sq_m' | null };
    bounding_box: { x1: number; y1: number; x2: number; y2: number } | null;
  }>;
  excluded_from_living_area: {
    total: { value: number | null; unit: 'sq_ft' | 'sq_m' | null };
    items: Array<{
      name: string;
      area: { value: number | null; unit: 'sq_ft' | 'sq_m' | null };
    }>;
  };
  metadata: {
    multiple_floors: boolean;
    floor_count: number;
    detached_area_count: number;
    confidence: 'high' | 'medium' | 'low';
    layout_type?: 'side_by_side' | 'stacked' | 'single' | 'mixed';
  };
}
