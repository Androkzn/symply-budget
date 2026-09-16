/**
 * AI Prompts for Contractor Search Feature
 * Uses Gemini with Google Search grounding to find and analyze contractors
 * Specialized prompts for different contractor types improve result quality
 */

export const CONTRACTOR_SEARCH_SYSTEM_PROMPT = `You are an expert home services research assistant helping homeowners find reliable contractors.

Your job is to use Google Search to find REAL, VERIFIED contractors with actual business information.

CRITICAL REQUIREMENTS:
1. Only include REAL businesses that exist and can be verified via Google Search
2. ALWAYS include the Google rating (stars out of 5) and review count - this is mandatory
3. Search Google Maps/Business profiles for accurate ratings and contact info
4. If you cannot find a contractor's rating, DO NOT include that contractor
5. Prefer contractors with 4.0+ ratings and 20+ reviews

For each contractor you MUST verify:
- Business name is real and searchable
- Google rating exists (if no rating found, skip this contractor)
- Address or service area is provided
- Phone or website is available

OUTPUT FORMAT:
- Respond with ONLY valid JSON
- No markdown code blocks, no explanations
- Must be parseable by JSON.parse()`;

// Base prompt template with required rating emphasis
const BASE_SEARCH_PROMPT = `Search Google for the best {specialty} contractors in {city}, {state}.

**Issue:** {problem_title}
**Details:** {problem_description}
**Location:** {address}

SEARCH STRATEGY:
1. Search: "{specialty} {city} {state} reviews"
2. Search: "best {specialty} near {city} {state}"
3. Check Google Maps for top-rated businesses near {address}
4. Look for Reddit recommendations in r/{city} and r/HomeImprovement
5. Prioritize contractors that specifically mention serving {city}

MANDATORY: Every contractor MUST have a Google rating. If you cannot find the rating, DO NOT include that contractor.
EXCEPTION: Government departments, municipal services, and utility companies may have rating: 0 and review_count: 0.

Return up to 10 contractors in this exact JSON format:

{"contractors":[{"name":"Business Name","company_name":null,"specialty":"{specialty}","rating":4.8,"review_count":156,"address":"123 Main St, {city}, {state}","phone":"(555) 123-4567","email":"info@example.com","website":"https://example.com","google_maps_url":"https://maps.google.com/?q=Business+Name+{city}","highlights":["Great service","On time","Fair prices"],"reddit_mentions":null,"ai_confidence":0.85}],"search_summary":"Found X contractors with ratings above 4.0","total_found":10,"location_note":null}

FIELD RULES:
- rating: REQUIRED number 1-5 from Google reviews (0 only for government/municipal/utility)
- review_count: REQUIRED number from Google (0 only for government/municipal/utility)
- address: REQUIRED full address or "{city}, {state}" if full address unknown
- phone: REQUIRED phone number (especially critical for government/municipal services)
- highlights: REQUIRED array with 1-3 positive review quotes, or service details for government
- ai_confidence: 0.9 for verified info, 0.7 for partial info, 0.5 for limited info`;

// Specialized prompts for different contractor types
export const SPECIALTY_PROMPTS: Record<string, string> = {
  plumber: `${BASE_SEARCH_PROMPT}

PLUMBER-SPECIFIC SEARCH:
- Look for: licensed plumbers, emergency plumbers, drain specialists
- Key services: leak repair, drain cleaning, water heater, pipe repair
- Check for: 24/7 availability, licensed & insured mentions
- Red flags to avoid: no license info, very few reviews, complaints about pricing

Search terms to use:
- "licensed plumber {city} {state}"
- "emergency plumber near {city}"
- "plumber {problem_title} {city}"`,

  electrician: `${BASE_SEARCH_PROMPT}

ELECTRICIAN-SPECIFIC SEARCH:
- Look for: licensed electricians, master electricians, electrical contractors
- Key services: wiring, panel upgrades, outlet repair, lighting installation
- Check for: proper licensing (very important for electrical work), insurance
- Red flags to avoid: unlicensed, no insurance, complaints about safety

Search terms to use:
- "licensed electrician {city} {state}"
- "master electrician near {city}"
- "electrician {problem_title} {city}"`,

  'HVAC technician': `${BASE_SEARCH_PROMPT}

HVAC-SPECIFIC SEARCH:
- Look for: HVAC contractors, AC repair, heating specialists, certified technicians
- Key services: AC repair, furnace repair, duct cleaning, heat pump installation
- Check for: EPA certification, NATE certification, brand authorizations (Carrier, Trane, etc.)
- Red flags to avoid: no certifications, complaints about misdiagnosis

Search terms to use:
- "HVAC contractor {city} {state}"
- "AC repair near {city}"
- "heating and cooling {problem_title} {city}"`,

  roofer: `${BASE_SEARCH_PROMPT}

ROOFING-SPECIFIC SEARCH:
- Look for: licensed roofers, roofing contractors, roof repair specialists
- Key services: roof repair, roof replacement, leak repair, shingle replacement
- Check for: licensing, insurance, manufacturer certifications, warranty offerings
- Red flags to avoid: storm chasers, no physical address, pressure tactics

Search terms to use:
- "licensed roofing contractor {city} {state}"
- "roof repair near {city}"
- "roofer {problem_title} {city}"`,

  'general contractor': `${BASE_SEARCH_PROMPT}

GENERAL CONTRACTOR SEARCH:
- Look for: licensed general contractors, home renovation specialists, remodeling contractors
- Key services: home renovation, remodeling, additions, repairs
- Check for: general contractor license, portfolio of work, insurance
- Red flags to avoid: no license, no references, vague pricing

Search terms to use:
- "general contractor {city} {state}"
- "home renovation contractor near {city}"
- "handyman {problem_title} {city}"`,

  'foundation specialist': `${BASE_SEARCH_PROMPT}

FOUNDATION-SPECIFIC SEARCH:
- Look for: foundation repair specialists, structural engineers, basement waterproofing
- Key services: foundation repair, crack repair, waterproofing, structural assessment
- Check for: structural engineering background, warranty offerings, years in business
- Red flags to avoid: pushy sales, no warranty, limited experience

Search terms to use:
- "foundation repair {city} {state}"
- "structural engineer near {city}"
- "basement waterproofing {city}"`,

  'appliance repair technician': `${BASE_SEARCH_PROMPT}

APPLIANCE REPAIR SEARCH:
- Look for: appliance repair services, authorized service centers, appliance technicians
- Key services: washer/dryer repair, refrigerator repair, dishwasher repair, oven repair
- Check for: brand authorizations (Samsung, LG, Whirlpool, etc.), same-day service
- Red flags to avoid: no brand certifications, complaints about parts markup

Search terms to use:
- "appliance repair {city} {state}"
- "authorized appliance repair near {city}"
- "{problem_title} repair {city}"`,

  'window and door installer': `${BASE_SEARCH_PROMPT}

WINDOW/DOOR SPECIALIST SEARCH:
- Look for: window installers, door contractors, glass specialists
- Key services: window replacement, door installation, glass repair
- Check for: manufacturer certifications, energy efficiency expertise, warranty
- Red flags to avoid: high-pressure sales, no installation warranty

Search terms to use:
- "window installation {city} {state}"
- "door replacement near {city}"
- "window contractor {city}"`,

  'insulation contractor': `${BASE_SEARCH_PROMPT}

INSULATION CONTRACTOR SEARCH:
- Look for: insulation contractors, energy efficiency specialists, spray foam installers
- Key services: attic insulation, wall insulation, spray foam, blown-in insulation
- Check for: energy auditor certifications, material expertise, R-value knowledge
- Red flags to avoid: one-size-fits-all approach, no energy assessment

Search terms to use:
- "insulation contractor {city} {state}"
- "attic insulation near {city}"
- "home insulation {city}"`,

  'waterproofing contractor': `${BASE_SEARCH_PROMPT}

WATERPROOFING SPECIALIST SEARCH:
- Look for: waterproofing contractors, basement specialists, drainage experts
- Key services: basement waterproofing, sump pump, drainage systems, crack injection
- Check for: warranty offerings, comprehensive solutions, years in business
- Red flags to avoid: band-aid solutions, no warranty, vague diagnosis

Search terms to use:
- "basement waterproofing {city} {state}"
- "waterproofing contractor near {city}"
- "drainage specialist {city}"`,

  'inspector': `${BASE_SEARCH_PROMPT}

INSPECTOR SEARCH:
- Look for: home inspectors, building inspectors, specialized inspectors
- Key services: pre-purchase inspections, maintenance inspections, specialty inspections
- Check for: certifications (ASHI, InterNACHI), insurance, experience
- Red flags to avoid: no certifications, conflicts of interest, rushed inspections

Search terms to use:
- "home inspector {city} {state}"
- "building inspector near {city}"
- "certified inspector {city}"`,

  'government department': `Search for the appropriate government department or agency in {city}, {state} for {problem_title}.

GOVERNMENT DEPARTMENT SEARCH:
- Look for: official government websites, department contact information, online services
- Focus on: federal, state/provincial, or local government agencies
- Find: phone numbers, email addresses, office hours, online portals
- Include: specific department names, addresses, and any relevant permit/application processes

CRITICAL: Extract location-specific information (e.g., if {city} is Surrey, find Surrey-specific departments, not general BC info)

Search terms to use:
- "{problem_title} {city} {state} government"
- "{city} {state} [department type] contact"
- "{problem_title} permit {city} {state}"

Return the department/agency with:
- name: Official department name
- specialty: Type of government service
- address: Physical office address if available
- phone: Main phone number (REQUIRED - this is critical for government services)
- email: Contact email if available
- website: Official government website (REQUIRED)
- highlights: Services offered, office hours, online portal info
- google_maps_url: Google Maps link to office location

IMPORTANT: Government departments may not have Google ratings. If no rating exists, you may include the department anyway with rating: 0 and review_count: 0.`,

  'city/municipal department': `Search for the appropriate city or municipal department in {city}, {state} for {problem_title}.

MUNICIPAL DEPARTMENT SEARCH:
- Look for: city hall departments, municipal services, bylaw enforcement, permits & licenses
- Focus on: {city}-specific information (NOT provincial/state level)
- Find: phone numbers, email addresses, office hours, online portals, bylaw information
- Include: specific department names, addresses, relevant bylaws, permit processes

CRITICAL LOCATION AWARENESS:
- The issue is in {city}, {state}
- MUST find {city}-specific departments (e.g., "City of Surrey" not "City of Vancouver")
- Include {city} in ALL search queries
- Verify the department serves {city} specifically

IMPORTANT FOR INSPECTIONS/BYLAWS:
- Look for bylaw enforcement contact numbers
- Find inspection request procedures (phone numbers, online forms)
- Include specific bylaw references if mentioned in {problem_description}
- Note any inspection fees or timelines

Search terms to use:
- "{city} city hall {problem_title}"
- "{city} municipal {problem_title} department"
- "{city} bylaw enforcement {problem_title}"
- "{city} permits and licenses {problem_title}"

Return the department with:
- name: "City of {city} [Department Name]"
- specialty: Type of municipal service
- address: City hall or department office address
- phone: Main phone number or inspection request line (REQUIRED)
- email: Department contact email if available
- website: Official city website page for this service (REQUIRED)
- highlights: Services, office hours, inspection procedures, relevant bylaws, fees
- google_maps_url: Google Maps link to office/city hall

IMPORTANT: Municipal departments may not have Google ratings. Include them with rating: 0 and review_count: 0.`,

  'utility company': `Search for the relevant utility company serving {city}, {state} for {problem_title}.

UTILITY COMPANY SEARCH:
- Look for: electricity, gas, water, telecommunications utilities
- Focus on: companies that serve {city}, {state}
- Find: customer service numbers, emergency numbers, outage reporting, online accounts
- Include: service area confirmation, hours of operation

Search terms to use:
- "{problem_title} utility {city} {state}"
- "electricity provider {city} {state}"
- "gas company {city} {state}"

Return the utility with contact information and service details.`,
};

// Default prompt for unknown specialties
export const DEFAULT_SEARCH_PROMPT = BASE_SEARCH_PROMPT;

/**
 * Get the appropriate search prompt for a contractor specialty
 */
export function getSearchPromptForSpecialty(specialty: string): string {
  return SPECIALTY_PROMPTS[specialty] || DEFAULT_SEARCH_PROMPT;
}

// Legacy export for backward compatibility
export const CONTRACTOR_SEARCH_PROMPT_V1 = DEFAULT_SEARCH_PROMPT;

export const REDDIT_SEARCH_PROMPT = `Search Reddit for contractor recommendations in {city}, {state} for {specialty} services.

Look in these subreddits:
- r/{city} (city-specific subreddit)
- r/{state} (state subreddit)
- r/HomeImprovement
- r/homeowners

Find discussions about:
- Recommended {specialty} contractors
- Good or bad experiences with local contractors
- Advice for hiring {specialty} in the area

Summarize any relevant recommendations or warnings about specific contractors.`;
