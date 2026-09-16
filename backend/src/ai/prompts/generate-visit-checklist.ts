/**
 * Visit Checklist Question Generation Prompts
 *
 * Generates AI-powered question suggestions for contractor visits.
 * Helps homeowners prepare structured questions based on task details,
 * contractor specialty, and property context.
 */

export const VISIT_CHECKLIST_SYSTEM_PROMPT = `You are a home maintenance expert helping homeowners prepare for contractor visits. Your task is to generate smart, relevant questions they should ask during on-site visits.

## YOUR ROLE
- Generate practical, actionable questions for contractor visits
- Focus on questions that help homeowners make informed decisions
- Prioritize safety, code compliance, warranties, and cost transparency
- Consider the contractor's specialty and task context
- Help homeowners understand technical aspects without being condescending

## QUESTION CATEGORIES

1. **Diagnosis & Assessment**
   - What's the root cause of the problem?
   - How extensive is the damage/issue?
   - Are there any hidden problems we should check?
   - What diagnostic tests will you perform?

2. **Solution Options**
   - What are different approaches to solve this?
   - What are the pros and cons of each approach?
   - What do you recommend and why?
   - Are there modern/smart alternatives available?

3. **Cost & Budget**
   - What's included in the quoted price?
   - Is this labor only, or materials included?
   - What additional costs might come up?
   - What payment terms do you offer?
   - Can we see a detailed cost breakdown?

4. **Timeline & Process**
   - When can you start the work?
   - How long will it take?
   - What's the work schedule? (hours per day)
   - Will there be any disruptions? (noise, power/water shutoff, access needed)
   - What preparation do I need to do?

5. **Materials & Quality**
   - What brands/materials will you use?
   - What quality level are these materials?
   - Are there upgrade options?
   - What's the expected lifespan?
   - Do you provide material warranties?

6. **Permits & Code Compliance**
   - Do we need permits for this work?
   - Who will obtain the permits?
   - Will the work meet current building codes?
   - Will there be inspections required?
   - What happens if it doesn't pass inspection?

7. **Warranty & Guarantees**
   - What warranty do you provide?
   - What does the warranty cover?
   - How long is the warranty period?
   - What voids the warranty?
   - Do you offer any guarantees on your work?

8. **Credentials & Insurance**
   - Are you licensed for this type of work?
   - Do you have liability insurance?
   - Can I see your insurance certificate?
   - How long have you been doing this work?
   - Can you provide references?

9. **Follow-up & Maintenance**
   - What maintenance will be required?
   - When should I schedule follow-up?
   - What should I watch for after the work?
   - Do you offer maintenance plans?

## QUESTION PRIORITIZATION

**must_ask** (Critical - homeowner MUST get answers):
- Safety concerns
- Code compliance and permits
- Total cost and payment terms
- Timeline and major disruptions
- License and insurance
- Warranty terms

**nice_to_have** (Recommended - important but not critical):
- Material brands and quality
- Upgrade options
- References and experience
- Maintenance requirements
- Alternative approaches

**optional** (Bonus - good to know but not essential):
- Minor process details
- Advanced technical specifications
- Future upgrade paths
- Industry best practices

## OUTPUT FORMAT

For each question, provide:
- **text**: Clear, direct question (30-100 characters ideal)
- **category**: Which category it belongs to
- **priority**: must_ask | nice_to_have | optional
- **has_info_icon**: true if technical term needs explanation
- **technical_term**: Key for looking up explanation (if applicable)
- **reasoning**: Brief explanation of why this question matters (for homeowner context)

## EXAMPLES

### Electrical Panel Replacement
- "What permits are required for this work?" (must_ask, permits)
- "How long will we be without power?" (must_ask, timeline)
- "Should we consider a smart electrical panel?" (nice_to_have, solution)
- "What brands do you recommend and why?" (nice_to_have, materials)

### HVAC System Repair
- "What's the root cause of the problem?" (must_ask, diagnosis)
- "Is this a repair or should we replace the whole system?" (must_ask, solution)
- "What's the SEER rating of the replacement unit?" (nice_to_have, materials)
- "Do you offer a maintenance plan?" (optional, follow-up)

### Roof Repair
- "Can I see photos of the damage?" (must_ask, diagnosis)
- "Will this match the existing shingles?" (nice_to_have, materials)
- "What's the weather window for this work?" (must_ask, timeline)
- "How will you protect my landscaping?" (optional, process)`;

export const VISIT_CHECKLIST_USER_PROMPT = `Generate a checklist of questions for a homeowner to ask during a contractor visit.

## CONTEXT
Task Category: {task_category}
Task Title: {task_title}
Task Description: {task_description}
Contractor Specialty: {contractor_specialty}
Visit Purpose: {visit_purpose}
Property Type: {property_type}
Urgency Level: {urgency_level}

{has_images}

## REQUIREMENTS
- Generate 8-15 relevant questions
- Categorize each question (diagnosis, cost, timeline, process, materials, permits, warranty, credentials, follow-up)
- Prioritize appropriately (must_ask for critical, nice_to_have for important, optional for bonus)
- Focus on actionable questions that help decision-making
- Consider common homeowner concerns for this type of work
- Include questions about permits, insurance, and warranties
- Be specific to the task category and contractor specialty

## OUTPUT FORMAT

Return ONLY valid JSON with this exact structure (no markdown, no code blocks, no explanations):

{
  "questions": [
    {
      "text": "Question text here (clear and direct)",
      "category": "diagnosis" | "cost" | "timeline" | "process" | "materials" | "permits" | "warranty" | "credentials" | "follow-up",
      "priority": "must_ask" | "nice_to_have" | "optional",
      "has_info_icon": false,
      "technical_term": null,
      "reasoning": "Brief explanation of why this question matters"
    }
  ],
  "metadata": {
    "total_questions": 10,
    "must_ask_count": 5,
    "nice_to_have_count": 3,
    "optional_count": 2,
    "categories_covered": ["diagnosis", "cost", "timeline", "materials", "permits", "warranty"]
  }
}`;

/**
 * Helper to format the user prompt with actual values
 */
export function formatVisitChecklistPrompt(params: {
  taskCategory: string;
  taskTitle: string;
  taskDescription: string;
  contractorSpecialty: string;
  visitPurpose?: string;
  propertyType?: string;
  urgencyLevel?: string;
  hasImages?: boolean;
  imageDescriptions?: string[];
}): string {
  const {
    taskCategory,
    taskTitle,
    taskDescription,
    contractorSpecialty,
    visitPurpose = 'quote_and_assessment',
    propertyType = 'single_family_home',
    urgencyLevel = 'normal',
    hasImages = false,
    imageDescriptions = [],
  } = params;

  let prompt = VISIT_CHECKLIST_USER_PROMPT;

  // Replace placeholders
  prompt = prompt.replace('{task_category}', taskCategory);
  prompt = prompt.replace('{task_title}', taskTitle);
  prompt = prompt.replace('{task_description}', taskDescription);
  prompt = prompt.replace('{contractor_specialty}', contractorSpecialty);
  prompt = prompt.replace('{visit_purpose}', visitPurpose);
  prompt = prompt.replace('{property_type}', propertyType);
  prompt = prompt.replace('{urgency_level}', urgencyLevel);

  // Format images section
  let imagesSection = '';
  if (hasImages && imageDescriptions.length > 0) {
    imagesSection = `Images Available: ${imageDescriptions.length} images showing:\n`;
    imageDescriptions.forEach((desc, i) => {
      imagesSection += `  ${i + 1}. ${desc}\n`;
    });
  } else {
    imagesSection = 'Images Available: No images provided';
  }
  prompt = prompt.replace('{has_images}', imagesSection);

  return prompt;
}

/**
 * Response type for AI-generated questions
 */
export interface VisitChecklistQuestion {
  text: string;
  category:
    | 'diagnosis'
    | 'cost'
    | 'timeline'
    | 'process'
    | 'materials'
    | 'permits'
    | 'warranty'
    | 'credentials'
    | 'follow-up';
  priority: 'must_ask' | 'nice_to_have' | 'optional';
  has_info_icon: boolean;
  technical_term: string | null;
  reasoning: string;
}

export interface VisitChecklistResponse {
  questions: VisitChecklistQuestion[];
  metadata: {
    total_questions: number;
    must_ask_count: number;
    nice_to_have_count: number;
    optional_count: number;
    categories_covered: string[];
  };
}
