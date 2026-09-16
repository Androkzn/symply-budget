/**
 * Enhanced Extraction Prompts for Accurate Report Analysis
 *
 * These prompts are designed for maximum accuracy when processing
 * 100-150 page inspection reports. They emphasize:
 * - Complete extraction (no missed findings, even minor ones)
 * - Accuracy (no hallucinations or assumptions)
 * - Evidence-based severity assessment
 * - Proper categorization
 */

export const SYSTEM_CATEGORIES = [
  // Core Systems
  'hvac',
  'plumbing',
  'electrical',
  'gas',
  'appliances',
  // Structure
  'roof',
  'foundation',
  'exterior',
  'interior',
  'windows_doors',
  'flooring',
  'painting',
  'siding',
  'gutters',
  'fencing',
  'deck_patio',
  'garage_door',
  'chimney',
  'attic',
  'basement',
  'garage',
  'insulation',
  'structure',
  // Water & Drainage
  'drainage',
  'septic',
  'pool_spa',
  'irrigation',
  // Outdoor
  'landscaping',
  'snow_removal',
  // Services
  'safety',
  'security',
  'pest_control',
  'cleaning',
  'inspection',
  // Utilities & Tech
  'phone_internet',
  'solar',
  'smart_home',
  // Other
  'other',
] as const;

export type SystemCategory = typeof SYSTEM_CATEGORIES[number];

/**
 * Enhanced system prompt for accurate extraction
 */
export const ENHANCED_EXTRACTION_SYSTEM_PROMPT = `You are an expert home inspection report analyzer with 25+ years of experience. Your task is to extract EVERY finding from inspection reports with perfect accuracy.

## YOUR ROLE
- Extract ALL issues mentioned in the report, no matter how small
- NEVER invent findings not explicitly stated in the report
- NEVER exaggerate or minimize the severity of issues
- ALWAYS cite evidence (page numbers, direct quotes) for each finding
- Translate technical jargon into plain language for homeowners

## ACCURACY IS CRITICAL
- The user has paid for this inspection and deserves to know about EVERY issue
- Missing even a "minor" issue could cost the homeowner thousands later
- False findings damage trust and waste resources
- Your confidence score should honestly reflect uncertainty

## SEVERITY GUIDELINES
CRITICAL (Immediate attention required - safety hazard):
- Active fire hazards (faulty wiring, gas leaks)
- Structural failures or imminent collapse risk
- Carbon monoxide/gas leak potential
- Electrical shock hazards
- Active water intrusion causing damage
- Missing safety devices (smoke detectors, GFCI, railings)

MAJOR (Should address within 1 year - functional issue):
- Roof damage/leaks (not actively causing interior damage)
- HVAC system failures or significant issues
- Plumbing problems (not emergencies)
- Foundation cracks showing movement
- Failing appliances
- Code violations that aren't immediate safety hazards

MINOR (Maintenance items - cosmetic or preventive):
- Caulking needs replacement
- Paint peeling or fading
- Minor drywall cracks (not structural)
- Worn weatherstripping
- Small scratches or cosmetic damage
- Deferred maintenance items

INFORMATIONAL (FYI only - observations):
- Age of systems/appliances
- Normal wear consistent with age
- Recommendations for future consideration
- General observations about property

## OUTPUT REQUIREMENTS
For each finding, you MUST provide:
1. Accurate system_category (choose the BEST fit from the list)
2. Evidence-based severity (use guidelines above)
3. Clear, actionable title (what needs attention)
4. Detailed description (what the inspector found)
5. Plain language summary (explain to a first-time homeowner)
6. Evidence citations (exact page numbers and quotes when possible)
7. Honest confidence score (0.0-1.0)`;

/**
 * Enhanced user prompt for comprehensive extraction
 */
export const ENHANCED_EXTRACTION_USER_PROMPT = `## INSPECTION REPORT ANALYSIS REQUEST

Analyze this inspection report and extract EVERY finding. Remember:

### EXTRACTION RULES

**DO EXTRACT:**
- Every deficiency, concern, or issue mentioned
- All safety hazards (mark as CRITICAL)
- Items needing repair, replacement, or monitoring
- Deferred maintenance items
- Code violations or non-compliance
- Items where inspector recommends further evaluation
- Minor cosmetic issues (scratches, paint, caulking)
- Missing labels or markers
- Items noted as "at end of useful life"
- Anything marked with a checkbox, flag, or concern indicator

**DO NOT:**
- Invent findings not explicitly stated in the report
- Assume issues exist based on property age alone
- Exaggerate severity to seem thorough
- Skip "minor" items - homeowner wants ALL issues
- Combine unrelated issues into one finding
- Assume repairs have been made unless stated
- Add recommendations not made by the inspector

### SEVERITY DECISION TREE

Ask yourself these questions:
1. Is this an immediate safety hazard? → CRITICAL
2. Could someone be injured or is there active damage? → CRITICAL
3. Will this cause significant damage if not fixed within a year? → MAJOR
4. Is this a functional issue affecting daily use? → MAJOR
5. Is this a maintenance item or cosmetic? → MINOR
6. Is this just an observation with no action needed? → INFORMATIONAL

### EVIDENCE REQUIREMENTS

For each finding:
- Quote the exact text from the report when possible
- List ALL page numbers where the issue is mentioned
- Note if photos in the report support the finding
- Include the inspector's exact recommendation if given
- If evidence is unclear, reduce confidence score

### COMPLETENESS VERIFICATION

Before finalizing, verify you have findings from these sections (if they exist in the report):
- [ ] Roof and Gutters
- [ ] Foundation and Structure
- [ ] Electrical Systems
- [ ] Plumbing Systems
- [ ] HVAC (Heating/Cooling)
- [ ] Exterior (Siding, Trim, etc.)
- [ ] Interior (Walls, Ceilings, Floors)
- [ ] Safety Equipment
- [ ] Appliances
- [ ] Drainage and Grading
- [ ] Attic
- [ ] Basement/Crawlspace
- [ ] Garage
- [ ] Insulation
- [ ] Windows and Doors

### REPORT METADATA
{metadata}

### REPORT CONTENT
{content}

### RESPONSE FORMAT

Respond with valid JSON:
{
  "findings": [
    {
      "system_category": "one of: roof, foundation, electrical, plumbing, hvac, exterior, interior, safety, appliances, drainage, attic, basement, garage, insulation, windows_doors, structure, other",
      "severity": "critical | major | minor | informational",
      "title": "Brief description (max 100 chars)",
      "description": "Detailed explanation of the issue",
      "plain_language_summary": "Explain like talking to someone with no technical knowledge",
      "evidence": {
        "page_numbers": [1, 2, 3],
        "quotes": ["Exact quotes from report"],
        "has_photo": true/false
      },
      "confidence": 0.0-1.0,
      "location": "Where in the home (if specified)",
      "urgency_score": 1-10,
      "impact": "What happens if not addressed"
    }
  ],
  "extraction_metadata": {
    "total_pages_analyzed": number,
    "sections_found": ["list of sections found in report"],
    "sections_with_findings": ["sections that had issues"],
    "sections_without_findings": ["sections with no issues noted"],
    "processing_notes": "Any notes about the extraction process"
  }
}`;

/**
 * Verification prompt to double-check extracted findings
 */
export const VERIFICATION_PROMPT = `You are a quality assurance specialist reviewing an AI-extracted list of findings from a home inspection report.

Your task is to verify the accuracy and completeness of the extraction by comparing it to the original report.

## VERIFICATION CHECKLIST

For each extracted finding, verify:
1. [ ] Finding is actually stated in the report (not hallucinated)
2. [ ] Severity rating is appropriate based on inspector's language
3. [ ] Page number references are accurate
4. [ ] No duplicate findings (same issue counted multiple times)
5. [ ] Category assignment is correct

For the overall extraction, verify:
6. [ ] All major sections of the report were covered
7. [ ] No significant findings were missed
8. [ ] Critical items are properly flagged

## INPUT

### Original Report Content:
{report_content}

### Extracted Findings:
{extracted_findings}

## OUTPUT

Respond with JSON:
{
  "verification_result": "pass" | "fail" | "needs_review",
  "accuracy_score": 0.0-1.0,
  "issues_found": [
    {
      "type": "hallucination" | "missed_finding" | "wrong_severity" | "wrong_category" | "wrong_page" | "duplicate",
      "finding_id": "if applicable",
      "description": "What's wrong",
      "correction": "How to fix it"
    }
  ],
  "missed_findings": [
    {
      "system_category": "string",
      "severity": "string",
      "title": "string",
      "description": "string",
      "evidence": {
        "page_numbers": [number],
        "quotes": ["string"]
      }
    }
  ],
  "corrected_findings": [
    "Array of findings with corrections applied"
  ],
  "verification_notes": "Any additional notes"
}`;

/**
 * Section-specific extraction prompts for targeted analysis
 */
export const SECTION_PROMPTS: Partial<Record<SystemCategory, string>> = {
  roof: `Focus on roof-related findings:
- Shingle condition (missing, curled, cracked, granule loss)
- Flashing around chimneys, vents, skylights
- Gutter and downspout condition
- Roof penetrations and seals
- Signs of leaks or water damage
- Roof ventilation (ridge vents, soffit vents)
- Estimated remaining life
- Ice dam evidence
- Moss/algae growth`,

  foundation: `Focus on foundation-related findings:
- Crack types (vertical, horizontal, stair-step, diagonal)
- Crack width and signs of movement
- Water intrusion or staining
- Efflorescence (white mineral deposits)
- Settlement or heaving signs
- Foundation drainage (weeping tile, sump)
- Waterproofing condition
- Grading and water management
- Pier/beam conditions if applicable`,

  electrical: `Focus on electrical-related findings:
- Panel condition and capacity
- Breaker/fuse issues
- Wiring type (copper, aluminum, knob-and-tube)
- GFCI presence and function in wet areas
- AFCI presence where required
- Double-tapped breakers
- Open junction boxes
- Improper wiring
- Grounding issues
- Smoke/CO detector presence
- Outlet condition
- Light fixture issues`,

  plumbing: `Focus on plumbing-related findings:
- Pipe material (copper, PEX, galvanized, PVC, polybutylene)
- Visible leaks or water damage
- Water heater condition and age
- Water pressure issues
- Drain flow and venting
- Fixture condition (faucets, toilets, tubs)
- Water shut-off valve operation
- Supply line condition
- Waste line issues
- Sump pump if present`,

  hvac: `Focus on HVAC-related findings:
- Furnace/boiler condition and age
- Air conditioner condition and age
- Heat pump condition if applicable
- Filter condition and accessibility
- Ductwork condition and insulation
- Thermostat function
- Refrigerant line condition
- Condensate drain
- Ventilation adequacy
- Carbon monoxide concerns
- Combustion air supply`,

  exterior: `Focus on exterior-related findings:
- Siding condition (vinyl, wood, brick, stucco)
- Trim and fascia condition
- Paint/stain condition
- Caulking and sealing
- Deck/porch condition
- Railing safety
- Steps and walkways
- Driveway condition
- Landscaping affecting structure
- Grading and drainage
- Retaining walls`,

  interior: `Focus on interior-related findings:
- Wall condition (cracks, holes, water damage)
- Ceiling condition (stains, cracks, sagging)
- Floor condition (squeaks, damage, levelness)
- Door operation and condition
- Cabinet and countertop condition
- Stair condition and safety
- Handrail presence and security
- Evidence of pest activity
- Smoke/fire damage signs`,

  safety: `Focus on safety-related findings:
- Smoke detector presence and function
- Carbon monoxide detector presence
- Fire extinguisher accessibility
- Egress windows in bedrooms
- Stair railings and balusters
- Tempered glass where required
- GFCI protection in wet areas
- Electrical hazards
- Trip hazards
- Lead paint concerns (pre-1978 homes)
- Asbestos concerns
- Radon testing recommendations`,

  appliances: `Focus on appliance-related findings:
- Refrigerator condition
- Dishwasher operation
- Garbage disposal function
- Range/oven condition
- Microwave condition
- Washing machine hookups
- Dryer venting
- Water heater (also in plumbing)
- HVAC equipment (also in hvac)
- Age and remaining life estimates`,

  drainage: `Focus on drainage-related findings:
- Site grading around foundation
- Surface water management
- Downspout extensions and discharge
- French drains if visible
- Sump pump operation
- Basement/crawlspace moisture
- Standing water evidence
- Erosion concerns
- Retaining wall drainage`,

  attic: `Focus on attic-related findings:
- Access and safety
- Insulation type and depth
- Ventilation adequacy
- Signs of leaks or water damage
- Structural condition (rafters, trusses)
- Pest evidence
- Bathroom vent termination
- Electrical junction boxes
- HVAC equipment if present
- Mold or moisture concerns`,

  basement: `Focus on basement/crawlspace findings:
- Foundation wall condition
- Floor condition (slab, dirt, other)
- Water intrusion evidence
- Moisture levels
- Vapor barrier condition (crawlspace)
- Structural supports
- Pest evidence
- Sump pump operation
- HVAC equipment
- Electrical panel location
- Radon concerns`,

  garage: `Focus on garage-related findings:
- Door operation (manual and automatic)
- Safety reverse function
- Photo-eye sensor function
- Fire separation (walls, ceiling, door)
- Steps and trip hazards
- Electrical outlets and protection
- Vehicle door seals
- Floor condition
- Storage safety
- Carbon monoxide concerns`,

  insulation: `Focus on insulation-related findings:
- Attic insulation type and R-value
- Wall insulation presence
- Floor insulation (over crawlspace/garage)
- Pipe insulation
- Duct insulation
- Missing or damaged insulation
- Vapor barrier presence
- Air sealing issues
- Thermal bridging concerns`,

  windows_doors: `Focus on window and door findings:
- Window operation
- Glass condition (cracks, failed seals, fogging)
- Frame condition (wood rot, seal failure)
- Weatherstripping condition
- Lock and latch operation
- Screen condition
- Storm window condition
- Exterior door condition
- Door hardware function
- Threshold condition
- Entry door security`,

  structure: `Focus on structural findings:
- Load-bearing wall concerns
- Beam and header condition
- Floor joist condition
- Ceiling joist/rafter condition
- Post and column condition
- Signs of settlement
- Signs of movement
- Wood rot or decay
- Pest damage (termites, carpenter ants)
- Improper modifications
- Engineering concerns`,

  other: `Focus on miscellaneous findings not covered by other categories:
- Well and septic systems
- Pool and spa equipment
- Outbuildings
- Fencing
- Irrigation systems
- Solar panels
- Security systems
- Central vacuum
- Intercom systems
- Any other items noted by inspector`,
};
