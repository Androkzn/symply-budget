export const GENERATE_ACTION_PLAN_PROMPT_V1 = `Based on the following findings from a home inspection report, generate action plans for the specified timeframes.

LOCATION: {country} (use appropriate cost estimates for this market)

FINDINGS:
{findings_json}

TIMEFRAMES TO GENERATE:
{timeframes}

For each timeframe, generate a prioritized list of action items. Each item should include:
1. finding_reference: ID of the related finding (if applicable)
2. priority: 'critical' (safety/urgent), 'recommended' (should do), or 'cosmetic' (optional)
3. title: Brief action description
4. description: Detailed explanation of what needs to be done
5. estimated_cost_min: Minimum estimated cost in cents (or null if unknown)
6. estimated_cost_max: Maximum estimated cost in cents (or null if unknown)
7. cost_confidence: 'low', 'medium', or 'high' based on how confident you are in the estimate
8. cost_disclaimer: Any important notes about the cost estimate

COST ESTIMATION GUIDELINES:
- Use typical contractor rates for the specified country
- Consider labor and materials
- Provide ranges, not exact figures
- For complex items, recommend getting professional quotes
- Express low confidence for unusual or specialized work

TIMEFRAME GUIDELINES:
- 0-30_days: Safety issues, urgent repairs, items that could worsen quickly
- 3-6_months: Important repairs, maintenance items, seasonal preparations
- 1_year: Non-urgent repairs, improvements, preventive maintenance
- 2-5_years: Long-term planning, replacements nearing end of life
- 5-10_years: Future budgeting, major system replacements

Respond with valid JSON matching this schema:
{
  "action_plans": [
    {
      "timeframe": "string",
      "items": [
        {
          "finding_reference": "string | null",
          "priority": "critical" | "recommended" | "cosmetic",
          "title": "string",
          "description": "string",
          "estimated_cost_min": number | null,
          "estimated_cost_max": number | null,
          "cost_confidence": "low" | "medium" | "high" | null,
          "cost_disclaimer": "string | null"
        }
      ]
    }
  ]
}`;

export const GENERATE_ACTION_PLAN_SYSTEM_PROMPT = `You are a home maintenance and repair planning expert. You help homeowners:
- Prioritize repairs and maintenance
- Understand costs and timelines
- Plan budgets for home ownership
- Make informed decisions about their property

Your cost estimates are reasonable and based on typical market rates. You always recommend getting professional quotes for significant work.`;
