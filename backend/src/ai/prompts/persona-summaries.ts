/**
 * Persona-Specific Summary Prompts for Home Inspection Reports
 *
 * Three personas served:
 * 1. Novice Homeowner - First-time buyers, minimal home maintenance knowledge
 * 2. DIY Enthusiast - Handy homeowners who want to know what they can tackle
 * 3. Technical/Professional - Detailed technical information for pros
 */

export const NOVICE_HOMEOWNER_SUMMARY_PROMPT = `You are creating a summary for a first-time homeowner who knows little about home maintenance.

IMPORTANT GUIDELINES:
- Use simple, plain language - NO jargon or technical terms
- Explain WHY each issue matters in human terms
- Focus on safety and financial impact
- Provide clear, actionable next steps
- Be encouraging but honest

PROPERTY DETAILS:
Address: {property_address}
Inspection Date: {inspection_date}

FINDINGS FROM INSPECTION:
{findings_json}

Create a homeowner-friendly summary with this structure:

{
  "overall_health": "One simple sentence about the home's condition",
  "most_important_now": [
    {
      "what": "Clear, simple title (e.g., 'Electrical Panel Needs Replacement')",
      "why_it_matters": "Explain in plain language why this is important (safety, cost, damage prevention)",
      "what_to_do": "Specific action in simple terms (e.g., 'Call an electrician this week')",
      "cost_range": "Realistic estimate in local currency",
      "urgency": "This week" | "This month" | "Next few months"
    }
  ],
  "budget_for_later": [
    {
      "what": "Issue title",
      "when": "Timeframe (e.g., 'Next 3-6 months', 'Within a year')",
      "why": "Brief explanation",
      "cost_range": "Estimate"
    }
  ],
  "good_news": [
    "Positive aspects of the property (be specific and genuine)"
  ],
  "total_investment": {
    "immediate": "$X-Y",
    "short_term": "$X-Y (3-6 months)",
    "long_term": "$X-Y (1-2 years)",
    "total_range": "$X-Y"
  },
  "next_steps": [
    "Specific, prioritized actions to take"
  ]
}

TONE: Friendly, supportive, educational. Like explaining to a friend.
AVOID: Technical jargon, alarmist language, vague recommendations.`;

export const DIY_ENTHUSIAST_SUMMARY_PROMPT = `You are creating a summary for an experienced DIY homeowner who wants to know what they can handle themselves vs. when to hire professionals.

IMPORTANT GUIDELINES:
- Include technical details and specifications
- Clearly mark DIY-suitable vs. professional-only tasks
- Provide difficulty ratings and effort levels
- List required tools and materials
- Include safety warnings where appropriate
- Explain when/why to hire a professional

PROPERTY DETAILS:
Address: {property_address}
Inspection Date: {inspection_date}

FINDINGS FROM INSPECTION:
{findings_json}

Create a DIY-focused summary with this structure:

{
  "quick_assessment": "Technical overview in 2-3 sentences",
  "hire_a_pro_critical": [
    {
      "issue": "Technical description",
      "why_not_diy": "Specific reasons (safety, code requirements, specialized tools, liability)",
      "specialist_needed": "Type of contractor (electrician, HVAC, structural engineer)",
      "estimated_cost": "$X-Y",
      "urgency": "immediate" | "short_term" | "long_term"
    }
  ],
  "diy_projects": [
    {
      "task": "Clear description",
      "difficulty": "easy" | "moderate" | "difficult",
      "time_estimate": "X-Y hours",
      "tools_required": ["Specific tools needed"],
      "materials": ["Materials with rough quantities"],
      "materials_cost": "$X-Y",
      "key_steps": ["High-level steps"],
      "safety_notes": ["Important safety considerations"],
      "when_to_stop": "Signs you should call a professional instead"
    }
  ],
  "maintenance_tasks": [
    {
      "task": "Regular maintenance item",
      "frequency": "How often",
      "difficulty": "easy" | "moderate",
      "why_important": "Preventive benefit"
    }
  ],
  "cost_analysis": {
    "must_hire_pros": "$X-Y",
    "diy_materials_only": "$X-Y",
    "if_hired_all": "$X-Y",
    "potential_savings": "$X-Y (labor you save by DIY)"
  },
  "recommended_sequence": [
    "Order of operations for tackling projects"
  ]
}

TONE: Respectful of skills but realistic about limits. Technical but accessible.
FOCUS: Empower DIY where appropriate, but prioritize safety and code compliance.`;

export const TECHNICAL_PROFESSIONAL_SUMMARY_PROMPT = `You are creating a detailed technical summary for a professional inspector, contractor, or highly experienced homeowner.

IMPORTANT GUIDELINES:
- Use proper technical terminology and industry standards
- Include specific code references where applicable
- Provide detailed specifications and measurements
- Note material grades, conditions, and remaining service life
- Include manufacturer specifications where relevant

PROPERTY DETAILS:
Address: {property_address}
Inspection Date: {inspection_date}

FINDINGS FROM INSPECTION:
{findings_json}

Create a comprehensive technical summary with this structure:

{
  "executive_summary": "High-level technical assessment",
  "critical_deficiencies": [
    {
      "system": "Building system",
      "component": "Specific component",
      "deficiency": "Technical description of issue",
      "code_reference": "Relevant building code section if applicable",
      "safety_impact": "Specific safety concerns",
      "repair_scope": "Detailed repair specifications",
      "estimated_cost": "$X-Y",
      "priority": 1-5
    }
  ],
  "systems_assessment": [
    {
      "system": "System name (HVAC, Electrical, Plumbing, etc.)",
      "overall_condition": "excellent" | "good" | "fair" | "poor",
      "age": "Approximate age",
      "remaining_service_life": "Estimated years",
      "components": [
        {
          "component": "Specific item",
          "condition": "Assessment",
          "notes": "Technical observations"
        }
      ],
      "recommendations": ["Specific technical recommendations"]
    }
  ],
  "deferred_maintenance": [
    {
      "item": "Maintenance item",
      "current_condition": "Assessment",
      "impact_if_deferred": "Consequences of continued deferral",
      "recommended_action": "Specific technical solution",
      "cost_range": "$X-Y"
    }
  ],
  "specification_notes": [
    "Detailed technical notes, measurements, material specifications"
  ],
  "estimated_capital_expenditures": {
    "immediate_0_1_year": "$X-Y",
    "short_term_1_3_years": "$X-Y",
    "medium_term_3_5_years": "$X-Y",
    "long_term_5_10_years": "$X-Y"
  }
}

TONE: Professional, technical, precise. Suitable for contractor bids and professional decision-making.
FOCUS: Actionable technical intelligence with cost and timeline projections.`;

export const EXECUTIVE_SUMMARY_PROMPT = `Create a concise executive summary for quick decision-making by busy homeowners, real estate professionals, or property managers.

PROPERTY DETAILS:
Address: {property_address}
Inspection Date: {inspection_date}

FINDINGS FROM INSPECTION:
{findings_json}

Create a brief executive summary with this structure:

{
  "one_paragraph_summary": "Concise overview of property condition and key considerations",
  "overall_condition": "excellent" | "good" | "fair" | "poor",
  "critical_issues": [
    {
      "issue": "Brief description",
      "impact": "Why it matters",
      "cost": "$X-Y",
      "timeframe": "When to address"
    }
  ],
  "financial_overview": {
    "immediate_needs": "$X-Y",
    "short_term_needs": "$X-Y (within 1 year)",
    "total_10_year_projection": "$X-Y"
  },
  "key_decision_points": [
    "Important decisions owner needs to make"
  ],
  "positive_aspects": [
    "Notable strengths of the property"
  ]
}

TONE: Concise, factual, focused on decision-making.
LENGTH: Keep it brief - this should be scannable in 2 minutes.`;

export const SPACE_MAPPING_PROMPT = `Analyze this inspection report and map all findings to physical spaces/areas in the home.

INSPECTION REPORT FINDINGS:
{findings}

AVAILABLE PRESET SPACES:
{preset_spaces}

For each finding, determine:
1. The specific space/room where the issue is located
2. Whether it maps to an existing preset space or needs a custom space
3. Confidence level in the mapping

GUIDELINES:
- "Throughout" or "General" means the issue affects multiple spaces
- "First Floor Panel" likely means a hallway, utility room, or basement
- "Exterior Deck" is outdoor space
- Create custom spaces for unique areas not in presets

Return JSON:
{
  "space_mappings": [
    {
      "finding_id": "ID from findings",
      "finding_title": "Brief title for reference",
      "location_raw": "Original location string from report",
      "mapped_space_name": "Name of space to map to",
      "space_type": "preset" | "custom",
      "preset_template": "Template name if preset",
      "category": "indoor" | "outdoor" | "garage" | "basement" | "attic",
      "confidence": 0.0-1.0,
      "notes": "Any mapping ambiguity or special considerations"
    }
  ],
  "suggested_custom_spaces": [
    {
      "name": "Space name",
      "category": "Category",
      "reason": "Why this custom space is needed"
    }
  ]
}`;

export const DIY_GUIDANCE_PROMPT = `Generate detailed DIY guidance for this home repair/maintenance task.

TASK DETAILS:
{task_details}

FINDING CONTEXT:
{finding_context}

Evaluate whether this is DIY-suitable and provide comprehensive guidance:

{
  "is_diy_suitable": true | false,
  "diy_difficulty": "easy" | "moderate" | "difficult" | "expert_only",
  "reasoning": "Why this is or isn't suitable for DIY",
  "time_effort": "quick" | "short" | "medium" | "half_day" | "all_day",
  "required_skills": [
    "Specific skills needed (e.g., 'Basic electrical knowledge', 'Soldering')"
  ],
  "required_tools": [
    {
      "tool": "Tool name",
      "essential": true | false,
      "alternative": "Possible alternative if not essential"
    }
  ],
  "materials_list": [
    {
      "item": "Material name",
      "quantity": "Approximate quantity",
      "estimated_cost": "$X-Y",
      "specifications": "Important specs (size, grade, type)"
    }
  ],
  "safety_equipment": [
    "Required safety gear"
  ],
  "step_by_step_instructions": [
    {
      "step_number": 1,
      "instruction": "Clear, detailed instruction",
      "tips": ["Helpful tips for this step"],
      "common_mistakes": ["What to avoid"]
    }
  ],
  "safety_warnings": [
    "Critical safety considerations and hazards"
  ],
  "code_considerations": [
    "Building code requirements to be aware of"
  ],
  "when_to_call_professional": [
    "Specific situations where you should stop and call a pro"
  ],
  "estimated_total_cost": {
    "materials": "$X-Y",
    "tools_if_buying": "$X-Y",
    "professional_cost_comparison": "$X-Y"
  }
}

BE HONEST: If something is genuinely dangerous or requires licensing, clearly state it's not DIY-suitable.
BE HELPFUL: For suitable DIY tasks, provide clear, confidence-building guidance.`;
