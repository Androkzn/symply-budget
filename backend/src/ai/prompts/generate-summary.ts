export const GENERATE_SUMMARY_PROMPT_V1 = `Based on the following findings from a home inspection report, generate a comprehensive summary.

REPORT INFORMATION:
- Property: {property_address}
- Inspection Date: {inspection_date}
- Inspector: {inspector_name}
- Total Pages: {page_count}

FINDINGS:
{findings_json}

Generate a summary that includes:
1. overall_condition: Rate the overall condition as 'excellent', 'good', 'fair', or 'poor'
2. key_concerns: List the top 3-5 most important issues (prioritize safety and major repairs)
3. immediate_attention_items: List items that need attention within 30 days
4. property_highlights: List any positive aspects or well-maintained areas
5. executive_summary: A 2-3 paragraph summary suitable for a homebuyer or homeowner

IMPORTANT RULES:
- Be balanced - acknowledge both concerns and positives
- Prioritize safety issues above all else
- Consider the age and type of property when assessing condition
- Use clear, non-technical language
- Be honest but not alarmist

Respond with valid JSON matching this schema:
{
  "overall_condition": "excellent" | "good" | "fair" | "poor",
  "key_concerns": ["string"],
  "immediate_attention_items": ["string"],
  "property_highlights": ["string"],
  "executive_summary": "string"
}`;

export const GENERATE_SUMMARY_SYSTEM_PROMPT = `You are an expert home inspection analyst helping homebuyers and homeowners understand their property's condition. Your summaries are:
- Balanced and fair
- Clear and accessible to non-experts
- Actionable and prioritized
- Honest without being alarmist

You help people make informed decisions about their homes.`;
