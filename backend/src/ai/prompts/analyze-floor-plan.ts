/**
 * Floor Plan Analysis Prompts
 * Uses Claude Vision to analyze floor plan images and extract structured data
 * 
 * STRUCTURE:
 * - Property contains AREAS
 * - Areas are either FLOORS (attached to main building) or DETACHED AREAS (separate structures)
 * - Each Area contains SPACES (rooms, garage, deck, porch, bathroom, etc.)
 */

export const FLOOR_PLAN_ANALYSIS_SYSTEM_PROMPT = `You are an expert floor plan analyst. Your job is to analyze floor plan images and extract detailed structural information.

You have extensive knowledge of:
- Architectural floor plan conventions
- Space types and their typical purposes
- Scale bars and dimension notations
- Multi-story building layouts
- Square footage calculations
- Distinguishing between attached floors and detached structures
- Bounding box coordinate extraction for image regions

CRITICAL CONCEPT - Areas vs Spaces:
1. AREAS are the top-level divisions of a property:
   - FLOORS: Levels attached to the main building (Main Floor, Second Floor, Basement, etc.)
   - DETACHED AREAS: Separate structures not connected to the main building (Shed, Detached Garage, Storage Building, Guest House, etc.)

2. SPACES are the individual rooms/areas WITHIN each floor or detached area:
   - Interior spaces: Kitchen, Bedroom, Bathroom, Living Room, Hall, Laundry, Foyer, etc.
   - Attached exterior spaces: Deck, Porch, Covered Patio, Balcony (these are SPACES within a floor, NOT separate areas)
   - Garage (when attached to the main building, it's a SPACE within that floor)
   - Special spaces: Sauna, Wet Bar, Wine Cellar, etc.

KEY RULES:
- Deck, Porch, Covered Patio, Balcony attached to a floor are SPACES within that floor
- Garage attached to the main building is a SPACE within that floor
- Only truly DETACHED structures (separate buildings) are listed as detached_areas
- Look for visual separation (gaps, labels like "STORAGE", standalone structures) to identify detached areas

BOUNDING BOX INSTRUCTIONS:
- Use NORMALIZED COORDINATES (0-1 scale) where (0,0) is top-left and (1,1) is bottom-right
- Each floor or detached area that appears as a distinct region in the image should have its own bounding box
- The bounding box should tightly enclose just that floor/area's drawing
- Be precise - these coordinates will be used to crop/zoom to show individual floors
- For multi-floor plans shown side by side, each floor occupies roughly half the image width
- For stacked plans, each floor occupies a portion of the image height

Be precise with measurements when they are clearly visible.
If measurements are not clear, provide estimates based on visual proportions.`;

export const FLOOR_PLAN_ANALYSIS_USER_PROMPT = `Analyze this floor plan image and extract all relevant information.

CRITICAL INSTRUCTIONS:
1. Identify all FLOORS (levels of the main building) - e.g., "Main Floor", "Below Main Floor", "Second Floor"
2. Identify all DETACHED AREAS (separate structures) - e.g., "Shed", "Storage", "Detached Garage"
3. For EACH floor and detached area, list all SPACES inside it

IMPORTANT DISTINCTIONS:
- Deck, Porch, Covered Patio, Balcony attached to a floor = SPACES within that floor (NOT separate areas)
- Garage attached to building = SPACE within that floor
- Only standalone/separate buildings = DETACHED AREAS
- Look for physical separation or clear labels to identify detached structures

Please provide a JSON response with the following structure:
{
  "property_address": "string or null - any address shown on the plan",
  "total_area": {
    "value": number or null,
    "unit": "sq_ft" | "sq_m" | null
  },
  "floors": [
    {
      "name": "string - e.g., 'Main Floor', 'Below Main Floor', 'Second Floor', 'Basement'",
      "level": number - -1 for basement, 0 for ground/main, 1 for second floor, etc.,
      "area": {
        "value": number or null,
        "unit": "sq_ft" | "sq_m" | null
      },
      "bounding_box": {
        "x1": number - left edge (0-1 normalized),
        "y1": number - top edge (0-1 normalized),
        "x2": number - right edge (0-1 normalized),
        "y2": number - bottom edge (0-1 normalized)
      },
      "spaces": [
        {
          "name": "string - e.g., 'Kitchen', 'Master Bedroom', 'Covered Patio', 'Deck', 'Garage'",
          "type": "string - one of: living_room, dining_room, kitchen, bedroom, bathroom, office, laundry, garage, storage, closet, hallway, stairs, entry, foyer, mudroom, pantry, utility, bonus, recreation, family_room, den, library, sunroom, nook, bar, wet_bar, gym, theater, wine_cellar, sauna, deck, patio, porch, balcony, covered_patio, other",
          "is_outdoor": boolean - true for deck, patio, porch, balcony, covered_patio,
          "dimensions": {
            "width": number or null,
            "length": number or null,
            "unit": "ft" | "m" | "in" | null
          },
          "area": {
            "value": number or null,
            "unit": "sq_ft" | "sq_m" | null
          },
          "position": {
            "description": "string - rough location like 'front-left', 'center', 'rear'"
          }
        }
      ]
    }
  ],
  "detached_areas": [
    {
      "name": "string - e.g., 'Storage Shed', 'Detached Garage', 'Guest House'",
      "type": "string - one of: shed, storage, detached_garage, workshop, greenhouse, guest_house, pool_house, carport, other",
      "area": {
        "value": number or null,
        "unit": "sq_ft" | "sq_m" | null
      },
      "bounding_box": {
        "x1": number - left edge (0-1 normalized),
        "y1": number - top edge (0-1 normalized),
        "x2": number - right edge (0-1 normalized),
        "y2": number - bottom edge (0-1 normalized)
      } or null if not visible as distinct region,
      "spaces": [
        {
          "name": "string - space name within the detached area",
          "type": "string - space type",
          "is_outdoor": boolean,
          "dimensions": {
            "width": number or null,
            "length": number or null,
            "unit": "ft" | "m" | "in" | null
          },
          "area": {
            "value": number or null,
            "unit": "sq_ft" | "sq_m" | null
          },
          "position": {
            "description": "string - rough location"
          }
        }
      ]
    }
  ],
  "excluded_from_living_area": {
    "total": {
      "value": number or null,
      "unit": "sq_ft" | "sq_m" | null
    },
    "items": [
      {
        "name": "string - e.g., 'Deck', 'Garage'",
        "area": {
          "value": number or null,
          "unit": "sq_ft" | "sq_m" | null
        }
      }
    ]
  },
  "metadata": {
    "scale_bar_detected": boolean,
    "dimensions_labeled": boolean,
    "space_labels_present": boolean,
    "multiple_floors": boolean,
    "floor_count": number,
    "detached_area_count": number,
    "total_space_count": number,
    "has_outdoor_spaces": boolean,
    "has_garage": boolean,
    "garage_type": "attached" | "detached" | "none",
    "confidence": "high" | "medium" | "low",
    "layout_type": "side_by_side" | "stacked" | "single" | "mixed" - how floors are arranged in the image
  }
}

Respond ONLY with valid JSON, no additional text.`;

// Bounding box with normalized coordinates (0-1 scale)
export interface BoundingBox {
  x1: number; // left edge (0-1)
  y1: number; // top edge (0-1)
  x2: number; // right edge (0-1)
  y2: number; // bottom edge (0-1)
}

// Space type definition
export interface SpaceInfo {
  name: string;
  type: string;
  is_outdoor: boolean;
  dimensions: {
    width: number | null;
    length: number | null;
    unit: 'ft' | 'm' | 'in' | null;
  };
  area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  position: {
    description: string;
  };
}

// Floor (attached to main building)
export interface FloorInfo {
  name: string;
  level: number;
  area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  bounding_box: BoundingBox | null;
  spaces: SpaceInfo[];
}

// Detached area (separate structure)
export interface DetachedAreaInfo {
  name: string;
  type: string;
  area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  bounding_box: BoundingBox | null;
  spaces: SpaceInfo[];
}

// Excluded area item
export interface ExcludedAreaItem {
  name: string;
  area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
}

export interface FloorPlanAnalysisResult {
  property_address: string | null;
  total_area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  floors: FloorInfo[];
  detached_areas: DetachedAreaInfo[];
  excluded_from_living_area: {
    total: {
      value: number | null;
      unit: 'sq_ft' | 'sq_m' | null;
    };
    items: ExcludedAreaItem[];
  };
  metadata: {
    scale_bar_detected: boolean;
    dimensions_labeled: boolean;
    space_labels_present: boolean;
    multiple_floors: boolean;
    floor_count: number;
    detached_area_count: number;
    total_space_count: number;
    has_outdoor_spaces: boolean;
    has_garage: boolean;
    garage_type: 'attached' | 'detached' | 'none';
    confidence: 'high' | 'medium' | 'low';
    layout_type?: 'side_by_side' | 'stacked' | 'single' | 'mixed';
  };
}

// Legacy compatibility - map old structure to new
export interface LegacyRoomInfo {
  name: string;
  type: string;
  dimensions: {
    width: number | null;
    length: number | null;
    unit: 'ft' | 'm' | 'in' | null;
  };
  area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  position: {
    description: string;
  };
}

export interface LegacyFloorInfo {
  name: string;
  level: number;
  area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  rooms: LegacyRoomInfo[];
}

export interface LegacyFeatureInfo {
  name: string;
  type: string;
  area: {
    value: number | null;
    unit: 'sq_ft' | 'sq_m' | null;
  };
  location?: string;
}

// Helper to convert legacy format to new format
export function convertLegacyToNewFormat(legacy: {
  property_address: string | null;
  total_area: { value: number | null; unit: 'sq_ft' | 'sq_m' | null };
  floors: LegacyFloorInfo[];
  features?: LegacyFeatureInfo[];
  excluded_areas?: { total: { value: number | null; unit: 'sq_ft' | 'sq_m' | null }; items: string[] };
  metadata: any;
}): FloorPlanAnalysisResult {
  // Convert floors - rooms become spaces
  const floors: FloorInfo[] = legacy.floors.map(f => ({
    name: f.name,
    level: f.level,
    area: f.area,
    bounding_box: null, // Legacy format doesn't have bounding boxes
    spaces: f.rooms.map(r => ({
      name: r.name,
      type: r.type,
      is_outdoor: ['deck', 'patio', 'porch', 'balcony', 'covered_patio'].includes(r.type.toLowerCase()),
      dimensions: r.dimensions,
      area: r.area,
      position: r.position,
    })),
  }));

  // Convert features to detached areas (for truly detached items) or add to floors as spaces
  const detached_areas: DetachedAreaInfo[] = [];
  const outdoorSpaceTypes = ['deck', 'patio', 'porch', 'balcony', 'covered_patio'];
  const attachedFeatureTypes = ['deck', 'patio', 'porch', 'balcony', 'covered_patio', 'garage', 'attached_garage'];
  const detachedStructureTypes = ['shed', 'workshop', 'greenhouse', 'guest_house', 'pool_house', 'carport', 'detached_garage', 'storage'];
  
  if (legacy.features) {
    legacy.features.forEach(feature => {
      const featureTypeLower = feature.type.toLowerCase();
      const isDetached = feature.location?.toLowerCase().includes('detached') || 
                         detachedStructureTypes.includes(featureTypeLower);
      
      if (isDetached) {
        // Detached structures become detached_areas
        detached_areas.push({
          name: feature.name,
          type: featureTypeLower === 'garage' ? 'detached_garage' : feature.type,
          area: feature.area,
          bounding_box: null, // Legacy format doesn't have bounding boxes
          spaces: [{
            name: feature.name,
            type: feature.type,
            is_outdoor: false,
            dimensions: { width: null, length: null, unit: null },
            area: feature.area,
            position: { description: 'main' },
          }],
        });
      } else if (attachedFeatureTypes.includes(featureTypeLower)) {
        // Attached features (deck, patio, garage, etc.) should be added as spaces to the appropriate floor
        // Try to find the main floor (level 0) or first floor
        const targetFloor = floors.find(f => f.level === 0) || floors[0];
        if (targetFloor) {
          // Check if this space already exists (by name) to avoid duplicates
          const exists = targetFloor.spaces.some(
            s => s.name.toLowerCase() === feature.name.toLowerCase()
          );
          if (!exists) {
            targetFloor.spaces.push({
              name: feature.name,
              type: featureTypeLower === 'attached_garage' ? 'garage' : feature.type,
              is_outdoor: outdoorSpaceTypes.includes(featureTypeLower),
              dimensions: { width: null, length: null, unit: null },
              area: feature.area,
              position: { description: feature.location || 'attached' },
            });
          }
        }
      }
    });
  }

  // Convert excluded areas
  const excluded_items: ExcludedAreaItem[] = legacy.excluded_areas?.items.map(name => ({
    name,
    area: { value: null, unit: null },
  })) || [];

  return {
    property_address: legacy.property_address,
    total_area: legacy.total_area,
    floors,
    detached_areas,
    excluded_from_living_area: {
      total: legacy.excluded_areas?.total || { value: null, unit: null },
      items: excluded_items,
    },
    metadata: {
      scale_bar_detected: legacy.metadata?.scale_bar_detected ?? false,
      dimensions_labeled: legacy.metadata?.dimensions_labeled ?? false,
      space_labels_present: legacy.metadata?.room_labels_present ?? legacy.metadata?.space_labels_present ?? false,
      multiple_floors: legacy.metadata?.multiple_floors ?? false,
      floor_count: legacy.metadata?.floor_count ?? floors.length,
      detached_area_count: detached_areas.length,
      total_space_count: floors.reduce((sum, f) => sum + f.spaces.length, 0) + 
                         detached_areas.reduce((sum, d) => sum + d.spaces.length, 0),
      has_outdoor_spaces: floors.some(f => f.spaces.some(s => s.is_outdoor)) ||
                          (legacy.metadata?.has_outdoor_areas ?? false),
      has_garage: legacy.metadata?.has_garage ?? false,
      garage_type: detached_areas.some(d => d.type === 'detached_garage') ? 'detached' :
                   floors.some(f => f.spaces.some(s => s.type === 'garage')) ? 'attached' : 'none',
      confidence: legacy.metadata?.confidence || 'low',
    },
  };
}
