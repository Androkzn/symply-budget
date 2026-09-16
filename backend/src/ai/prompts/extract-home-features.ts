/**
 * Home Features Extraction Prompts
 *
 * Extracts home features from inspection reports to power
 * smart maintenance suggestions. Features like fireplaces,
 * pools, HVAC systems, etc. each have specific maintenance needs.
 */

export const HOME_FEATURE_TYPES = [
  // HVAC Systems
  'hvac',
  'central_ac',
  'furnace',
  'heat_pump',
  'boiler',
  'mini_split',
  'window_ac',

  // Water Systems
  'water_heater',
  'tankless_water_heater',
  'well',
  'septic',
  'water_softener',
  'sump_pump',

  // Heating Features
  'fireplace',
  'wood_stove',
  'pellet_stove',

  // Outdoor Features
  'pool',
  'hot_tub',
  'irrigation_system',
  'outdoor_kitchen',

  // Structure
  'roof',
  'foundation',
  'basement',
  'crawl_space',
  'attic',
  'deck',
  'garage',
  'garage_door',

  // Systems
  'solar_panels',
  'generator',
  'security_system',
  'smart_home',
  'radon_mitigation',
  'central_vacuum',

  // Safety Equipment
  'smoke_detector',
  'co_detector',
  'fire_extinguisher',

  // Appliances
  'refrigerator',
  'dishwasher',
  'washing_machine',
  'dryer',
  'range',
  'microwave',
  'garbage_disposal',

  // Other
  'gutter',
  'siding',
  'windows',
  'doors',
  'plumbing',
  'electrical',
] as const;

export type HomeFeatureType = typeof HOME_FEATURE_TYPES[number];

export const HOME_FEATURES_SYSTEM_PROMPT = `You are an expert at identifying home features from inspection reports. Your task is to extract all features that require ongoing maintenance.

## YOUR ROLE
- Identify all significant home features from the report
- Extract details like type, brand, model, age when available
- Note the condition of each feature
- Count multiples (e.g., "2 wood-burning fireplaces")
- Note locations when specified

## FEATURE IDENTIFICATION GUIDELINES

### HVAC Systems
Look for:
- Central air conditioning units
- Furnaces (gas, electric, oil)
- Heat pumps
- Boilers
- Mini-split systems
- Window AC units
- Radiant heating

Extract: Type, fuel source, brand, model, age, BTU/ton capacity

### Water Systems
Look for:
- Water heaters (tank/tankless, gas/electric)
- Well pumps and equipment
- Septic tanks and drain fields
- Water softeners
- Sump pumps

Extract: Type, capacity (gallons), fuel source, age

### Heating Features
Look for:
- Wood-burning fireplaces
- Gas fireplaces
- Pellet stoves
- Wood stoves
- Electric fireplaces
- Chimney types (masonry, metal)

Extract: Type, location, venting type, count

### Outdoor Features
Look for:
- Swimming pools (inground, above ground)
- Hot tubs/spas
- Irrigation/sprinkler systems
- Outdoor kitchens
- Fire pits

Extract: Type, size, heating method, cover type

### Structure Types
Look for:
- Roof material (asphalt, metal, tile, flat)
- Foundation type (basement, crawl space, slab)
- Siding material (vinyl, wood, brick, stucco)
- Deck/patio material (wood, composite, concrete)
- Garage type (attached, detached)

Extract: Material, age/condition, special features

### Safety Equipment
Look for:
- Smoke detectors (battery, hardwired)
- CO detectors
- Fire extinguishers
- Security systems
- Radon mitigation systems

Extract: Type, count, locations, power source

### Major Appliances
Look for mentions of:
- Refrigerators
- Dishwashers
- Washing machines
- Dryers
- Ranges/ovens
- Microwaves
- Garbage disposals

Extract: Brand, approximate age, condition noted`;

export const HOME_FEATURES_USER_PROMPT = `## HOME FEATURE EXTRACTION REQUEST

Extract all home features from this inspection report that require ongoing maintenance.

### REPORT CONTENT:
{content}

### FOR EACH FEATURE, EXTRACT:

1. **feature_type**: Primary category (e.g., "fireplace", "hvac", "pool")

2. **feature_subtype**: Specific type (e.g., "wood_burning", "central_ac", "inground")

3. **quantity**: How many (default 1 if not specified)

4. **location**: Where in the home (e.g., "living room", "basement", "backyard")

5. **brand**: Manufacturer if mentioned

6. **model**: Model number if visible

7. **age_years**: Approximate age if mentioned (or calculated from install date)

8. **condition**: Based on inspector's assessment
   - "excellent": Like new, well maintained
   - "good": Normal wear, functioning well
   - "fair": Showing age, may need attention soon
   - "poor": Needs repair/replacement
   - "unknown": Not assessed

9. **notes**: Any relevant details from the report

10. **extraction_confidence**: How confident you are this feature exists (0.0-1.0)

### RESPONSE FORMAT:

{
  "home_features": [
    {
      "feature_type": "fireplace",
      "feature_subtype": "wood_burning",
      "quantity": 2,
      "location": "living room, master bedroom",
      "brand": null,
      "model": null,
      "age_years": null,
      "condition": "good",
      "notes": "Masonry chimneys, dampers operational",
      "extraction_confidence": 0.95
    },
    {
      "feature_type": "hvac",
      "feature_subtype": "central_ac",
      "quantity": 1,
      "location": "exterior side yard",
      "brand": "Carrier",
      "model": "24ACC636A003",
      "age_years": 8,
      "condition": "good",
      "notes": "3-ton unit, R-410A refrigerant",
      "extraction_confidence": 0.9
    }
  ],
  "extraction_summary": {
    "total_features": number,
    "high_confidence_features": number,
    "features_by_category": {
      "hvac": 2,
      "water": 1,
      "safety": 5
    },
    "notes": "Any extraction notes or uncertainties"
  }
}

### IMPORTANT NOTES:
- Only extract features that are explicitly mentioned in the report
- If age is given as a date (e.g., "installed 2018"), calculate years from current date
- Set extraction_confidence lower for features where details are unclear
- Count features accurately - "two fireplaces" = quantity: 2
- Don't assume features exist just because they're common`;

/**
 * Feature to maintenance template mapping hints
 */
export const FEATURE_MAINTENANCE_HINTS: Record<string, string[]> = {
  fireplace_wood_burning: [
    'Annual chimney inspection',
    'Annual chimney sweep',
    'Check damper before each season',
    'Ash removal after use',
  ],
  fireplace_gas: [
    'Annual professional inspection',
    'Monthly CO detector test',
    'Annual glass and log cleaning',
  ],
  hvac: [
    'Monthly filter change',
    'Annual heating tune-up (fall)',
    'Annual cooling tune-up (spring)',
    'Quarterly condensate drain cleaning',
  ],
  water_heater: [
    'Annual tank flush',
    'TPR valve test every 6 months',
    'Anode rod check every 3-5 years',
  ],
  tankless_water_heater: ['Annual descaling', 'Filter cleaning'],
  pool: [
    'Weekly water chemistry test',
    'Weekly shocking',
    'Monthly filter cleaning',
    'Annual professional inspection',
  ],
  hot_tub: [
    '2-3x weekly water chemistry',
    'Weekly shocking',
    'Weekly filter rinse',
    'Monthly deep filter clean',
    'Quarterly drain and refill',
  ],
  septic: ['Pumping every 3-5 years', 'Inspection every 3 years'],
  well: ['Annual water quality test', 'Annual system inspection'],
  roof: [
    'Semi-annual visual inspection',
    'Professional inspection every 3 years',
    'Gutter cleaning 2-4x yearly',
  ],
  sump_pump: ['Quarterly operation test', 'Annual backup battery check'],
  garage_door: [
    'Monthly safety reverse test',
    'Monthly sensor test',
    'Semi-annual lubrication',
  ],
  smoke_detector: [
    'Monthly test',
    'Annual battery replacement',
    'Replacement every 10 years',
  ],
  co_detector: [
    'Monthly test',
    'Annual battery replacement',
    'Replacement every 5-7 years',
  ],
  dryer: [
    'Clean lint trap every load',
    'Monthly housing clean',
    'Annual vent cleaning',
  ],
  refrigerator: ['Quarterly coil cleaning', 'Semi-annual filter replacement'],
  dishwasher: ['Monthly cleaning cycle', 'Monthly filter cleaning'],
  washing_machine: ['Monthly cleaning cycle', 'Annual hose inspection'],
  solar_panels: [
    'Monthly visual inspection',
    'Semi-annual cleaning',
    'Monthly production monitoring',
  ],
};
