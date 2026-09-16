/**
 * Task Draft Generation Prompts
 *
 * Generates actionable task drafts from inspection report findings.
 * Each finding becomes one or more task drafts that the user can
 * review and add to their maintenance schedule.
 */

export const TASK_DRAFT_SYSTEM_PROMPT = `You are a home maintenance expert helping homeowners understand and act on inspection report findings. Your task is to convert technical inspection findings into clear, actionable task drafts.

## YOUR ROLE
- Transform each finding into actionable maintenance tasks
- Provide accurate cost estimates (be conservative, err on higher side)
- Assess DIY feasibility honestly (safety first)
- Suggest appropriate timeframes based on severity
- Identify recurring maintenance needs revealed by findings
- Explain WHY each task matters in plain language

## COST ESTIMATION GUIDELINES
- Use current market rates for North American contractors
- Include labor AND materials in professional estimates
- DIY estimates should include materials only
- Provide ranges, not single numbers
- Be conservative (slightly high) - better to over-budget than under

Typical cost ranges (2024-2025):
- Electrician: $50-100/hour
- Plumber: $75-150/hour
- HVAC tech: $75-150/hour
- Roofer: $50-100/hour
- General contractor: $50-100/hour
- Handyman: $50-80/hour

## DIY ASSESSMENT CRITERIA
Professional Only (diy_possible: false, diy_difficulty: "professional_only"):
- Electrical panel work
- Gas line work
- Structural repairs
- Roof replacement
- Foundation repairs
- HVAC installation/major repairs
- Anything requiring permits in most jurisdictions

Hard DIY (diy_possible: true, diy_difficulty: "hard"):
- Minor electrical (outlets, switches, fixtures)
- Plumbing fixture replacement
- Drywall repair/replacement
- Deck repair/staining
- Window replacement

Medium DIY (diy_possible: true, diy_difficulty: "medium"):
- Caulking and sealing
- Painting (interior/exterior)
- Gutter cleaning/repair
- Minor plumbing (faucets, supply lines)
- Weatherstripping
- Door adjustments

Easy DIY (diy_possible: true, diy_difficulty: "easy"):
- Filter replacements
- Smoke detector batteries
- Light bulb replacement
- Basic cleaning
- Testing GFCI outlets
- Minor touch-up painting`;

export const TASK_DRAFT_USER_PROMPT = `## TASK DRAFT GENERATION REQUEST

Generate task drafts from these inspection findings. For each finding, create ONE task draft that addresses the issue.

### FINDINGS TO PROCESS:
{findings}

### FOR EACH FINDING, GENERATE A TASK DRAFT WITH:

1. **title**: Clear, action-oriented task name (e.g., "Replace damaged roof shingles in northwest section")
   - Start with a verb (Replace, Repair, Install, Clean, Inspect, etc.)
   - Be specific about location when known
   - Max 100 characters

2. **description**: Detailed explanation of what needs to be done
   - What the issue is
   - What work is required
   - What materials might be needed
   - Any special considerations

3. **plain_language_summary**: Explain to a first-time homeowner
   - Why this matters
   - What could happen if ignored
   - How urgent it is

4. **priority_score** (1-100): Calculate using these factors:
   - Safety hazard: +50
   - Structural impact: +30
   - Will worsen if delayed: +20
   - Affects daily living: +15
   - Code violation: +25
   - Cosmetic only: +5
   (Cap at 100)

5. **suggested_timeframe**: Based on severity and urgency
   - "0-30_days": Critical/safety issues
   - "3-6_months": Major issues
   - "1_year": Minor issues, seasonal work
   - "2-5_years": Future planning
   - "5-10_years": Long-term considerations

6. **suggested_frequency**: If this reveals a recurring need
   - "one_time": Fix once and done
   - "monthly": Monthly maintenance task
   - "quarterly": Every 3 months
   - "yearly": Annual maintenance
   - "custom": Other frequency (specify in description)

7. **is_recurring_suggestion**: true if this finding suggests an ongoing maintenance need
   - Example: "HVAC filter dirty" → suggest recurring monthly filter change
   - Example: "Gutters clogged" → suggest recurring semi-annual cleaning

8. **Cost Estimates** (in cents, e.g., $150 = 15000):
   - estimated_cost_min: Low end of professional cost
   - estimated_cost_max: High end of professional cost
   - diy_cost_min: Low end if DIY (materials only)
   - diy_cost_max: High end if DIY

9. **DIY Assessment**:
   - diy_possible: true/false
   - diy_difficulty: "easy" | "medium" | "hard" | "professional_only"

10. **Evidence with Enhanced Context**: Link back to the report with rich citations
    - source_page_numbers: Array of page numbers where evidence appears
    - source_quotes: Extract 1-2 COMPLETE, VERBATIM quotes that support this task
      * CRITICAL: Choose quotes that are COMPLETE SENTENCES (not fragments)
      * Each quote should be 1-3 sentences that explain WHY this matters or HOW URGENT it is
      * Include EXACT WORDING from the report (verbatim)
      * Prefer quotes that provide actionable context (severity, urgency, consequences)
      * Good example: "The electrical panel shows signs of overheating and several breakers are loose. This poses a potential fire hazard and should be addressed immediately."
      * Bad example: "panel shows signs" (incomplete/fragment)
      * ALWAYS verify the quote appears in the source finding text

### RESPONSE FORMAT

IMPORTANT: Return ONLY valid JSON. No markdown code blocks, no explanation text, no comments.
Ensure proper comma placement between array elements and object properties.

\`\`\`json
{
  "task_drafts": [
    {
      "finding_id": "abc123",
      "title": "Replace electrical panel",
      "description": "Work needed",
      "plain_language_summary": "Why this matters",
      "system_category": "electrical",
      "severity": "critical",
      "priority_score": 85,
      "suggested_timeframe": "0-30_days",
      "suggested_frequency": "one_time",
      "is_recurring_suggestion": false,
      "estimated_cost_min": 200000,
      "estimated_cost_max": 500000,
      "diy_possible": false,
      "diy_difficulty": "professional_only",
      "diy_cost_min": null,
      "diy_cost_max": null,
      "source_page_numbers": [1, 2],
      "source_quotes": [
        "The electrical panel shows signs of overheating with loose breakers. This poses a fire hazard and requires immediate professional attention.",
        "Several circuit breakers are not properly seated in their slots, which can cause arcing and potential fire."
      ]
    }
  ],
  "summary": {
    "total_tasks": 1,
    "critical_count": 1,
    "major_count": 0,
    "minor_count": 0,
    "informational_count": 0,
    "total_cost_min": 200000,
    "total_cost_max": 500000,
    "recurring_tasks_suggested": 0
  }
}
\`\`\`

Field types:
- finding_id: string (ID from the finding)
- priority_score: integer 1-100
- suggested_timeframe: "0-30_days" | "3-6_months" | "1_year" | "2-5_years" | "5-10_years"
- suggested_frequency: "one_time" | "monthly" | "quarterly" | "yearly" | "custom"
- is_recurring_suggestion: boolean (true or false)
- diy_possible: boolean (true or false)
- diy_difficulty: "easy" | "medium" | "hard" | "professional_only"
- All costs are integers in cents (e.g., $150 = 15000)
- diy_cost_min/diy_cost_max: integer or null`;

/**
 * Prompt for generating maintenance suggestions from findings
 */
export const MAINTENANCE_SUGGESTION_PROMPT = `Based on the inspection findings, suggest recurring maintenance tasks that would prevent similar issues in the future.

For example:
- "HVAC filter dirty" → Suggest monthly filter changes
- "Gutter debris causing overflow" → Suggest semi-annual gutter cleaning
- "Water heater sediment" → Suggest annual flushing
- "Roof moss growth" → Suggest annual inspection and treatment

For each suggestion:
1. Connect it to the original finding
2. Recommend an appropriate frequency
3. Explain why the maintenance matters
4. Estimate effort and cost

### FINDINGS:
{findings}

### RESPONSE FORMAT:
{
  "maintenance_suggestions": [
    {
      "related_finding_id": "ID of finding that revealed this need",
      "task_title": "Regular maintenance task name",
      "description": "What the task involves",
      "why_important": "Why this maintenance matters",
      "frequency": "monthly | quarterly | semi_annual | yearly",
      "best_season": "spring | summer | fall | winter | any",
      "time_effort": "quick | short | medium | half_day | all_day",
      "diy_difficulty": "easy | medium | hard | professional_only",
      "estimated_cost_min": number,
      "estimated_cost_max": number
    }
  ]
}`;
