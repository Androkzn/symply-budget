import {
  CONTRACTOR_SEARCH_SYSTEM_PROMPT,
  getSearchPromptForSpecialty,
} from '../ai/prompts/contractor-search';
import {
  EMAIL_GENERATION_SYSTEM_PROMPT,
  EMAIL_TYPE_PROMPTS,
} from '../ai/prompts/email-generation';
import type { Env } from '../types';

import { resolveProviderApiKey } from './ai-credential-resolver';
import { EmailService } from './email-service';
import { HouseholdService } from './household-service';

// Types for contractor search
export interface SearchContractorRequest {
  problem_description: string;
  problem_title: string;
  system_category: string;
  location: {
    latitude?: number;
    longitude?: number;
    city: string;
    state: string;
    address?: string;
  };
  source_type: 'action_item' | 'maintenance_task' | 'task_draft';
  source_id: string;
  // Enhanced metadata
  contractor_category?: string;
  subtasks?: string[];
  severity?: 'critical' | 'major' | 'minor' | 'informational';
  urgency_score?: number;
  source_page_numbers?: number[];
  source_quotes?: string[];
}

export interface FoundContractor {
  name: string;
  company_name: string | null;
  specialty: string;
  rating: number;
  review_count: number;
  address: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  google_maps_url: string;
  highlights: string[];
  reddit_mentions: string | null;
  ai_confidence: number;
}

export interface ContractorSearchResult {
  contractors: FoundContractor[];
  search_summary: string;
  total_found: number;
  location_note: string | null;
}

export interface GenerateEmailRequest {
  contractor: FoundContractor;
  problem_description: string;
  problem_title: string;
  email_type: 'quote_request' | 'question' | 'availability_check';
  user_name?: string;
  property_address?: string;
}

export interface GeneratedEmail {
  subject: string;
  body: string;
  contractor_name: string;
  contractor_email: string | null;
}

export interface SendEmailRequest {
  to_email: string;
  subject: string;
  body: string;
  from_name: string;
  reply_to?: string;
}

// Map system categories to contractor specialties
const CATEGORY_TO_SPECIALTY: Record<string, string> = {
  electrical: 'electrician',
  plumbing: 'plumber',
  hvac: 'HVAC technician',
  roof: 'roofer',
  foundation: 'foundation specialist',
  exterior: 'general contractor',
  interior: 'general contractor',
  safety: 'home inspector',
  appliances: 'appliance repair technician',
  drainage: 'plumber',
  attic: 'insulation contractor',
  basement: 'waterproofing contractor',
  garage: 'general contractor',
  insulation: 'insulation contractor',
  windows_doors: 'window and door installer',
  structure: 'structural engineer',
  inspection: 'inspector',
  government: 'government department',
  municipal: 'city/municipal department',
  utility: 'utility company',
  other: 'general contractor',
};

interface GeminiGroundingResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    groundingMetadata?: {
      searchEntryPoint?: {
        renderedContent?: string;
      };
      groundingChunks?: Array<{
        web?: {
          uri: string;
          title: string;
        };
      }>;
      webSearchQueries?: string[];
    };
  }>;
  error?: {
    message: string;
    code: number;
  };
}

export class ContractorSearchService {
  private env: Env;
  private householdService: HouseholdService;
  private emailService: EmailService;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  /**
   * Gemini key to bill this request against — the acting user's own BYOK key
   * when connected, otherwise the SimpleHouse-managed key. Set per request in
   * {@link searchContractors}; falls back to the managed env key if unset.
   */
  private geminiApiKey: string | null = null;

  constructor(env: Env, d1: D1Database) {
    this.env = env;
    this.householdService = new HouseholdService(env, d1);
    this.emailService = new EmailService(env);
  }

  /**
   * Search for contractors using AI with Google Search grounding
   */
  async searchContractors(
    householdId: string,
    userId: string,
    request: SearchContractorRequest
  ): Promise<ContractorSearchResult> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    // Run inference on the user's own Gemini key when they've connected one
    // (BYOK); otherwise the SimpleHouse-managed key.
    this.geminiApiKey = (await resolveProviderApiKey(this.env, userId, 'gemini')).apiKey;

    // Determine specialty - prefer contractor_category if provided
    const specialty = request.contractor_category
      ? request.contractor_category
      : (CATEGORY_TO_SPECIALTY[request.system_category] || 'general contractor');

    // Get specialized prompt for this contractor type
    const promptTemplate = getSearchPromptForSpecialty(specialty);

    // Build enhanced context for the AI
    let enhancedDescription = request.problem_description;

    // Add subtasks context if available
    if (request.subtasks && request.subtasks.length > 0) {
      enhancedDescription += '\n\nRelated subtasks:\n' + request.subtasks.map((st, i) => `${i + 1}. ${st}`).join('\n');
    }

    // Add severity/urgency context if available
    if (request.severity || request.urgency_score) {
      const severityText = request.severity ? `Severity: ${request.severity}` : '';
      const urgencyText = request.urgency_score ? `Urgency: ${request.urgency_score}/10` : '';
      enhancedDescription += `\n\nPriority: ${[severityText, urgencyText].filter(Boolean).join(', ')}`;
    }

    // Add source quotes if available (from inspection reports)
    if (request.source_quotes && request.source_quotes.length > 0) {
      enhancedDescription += '\n\nFrom inspection report:\n' + request.source_quotes.map(q => `"${q}"`).join('\n');
    }

    // Build the search prompt with all replacements
    const prompt = promptTemplate
      .replace(/{problem_title}/g, request.problem_title)
      .replace(/{problem_description}/g, enhancedDescription)
      .replace(/{specialty}/g, specialty)
      .replace(/{city}/g, request.location.city)
      .replace(/{state}/g, request.location.state)
      .replace(/{address}/g, request.location.address || `${request.location.city}, ${request.location.state}`);

    // Call Gemini with Google Search grounding
    const response = await this.callGeminiWithGrounding(
      CONTRACTOR_SEARCH_SYSTEM_PROMPT,
      prompt
    );

    try {
      const parsed = JSON.parse(this.extractJsonFromResponse(response));
      
      // Validate and normalize the response with proper defaults for required fields
      const allContractors: FoundContractor[] = (parsed.contractors || []).map((c: Partial<FoundContractor>) => {
        const name = c.name || 'Unknown Contractor';
        const city = request.location.city || '';
        
        // Build Google Maps URL if missing
        let googleMapsUrl = c.google_maps_url || '';
        if (!googleMapsUrl && name && city) {
          const searchQuery = encodeURIComponent(`${name} ${city}`);
          googleMapsUrl = `https://maps.google.com/?q=${searchQuery}`;
        }
        
        // Parse rating - handle various formats
        let rating = 0;
        if (typeof c.rating === 'number' && c.rating > 0) {
          rating = Math.min(5, Math.max(0, c.rating));
        } else if (typeof c.rating === 'string') {
          const parsed = parseFloat(c.rating);
          if (!isNaN(parsed) && parsed > 0) {
            rating = Math.min(5, Math.max(0, parsed));
          }
        }
        
        // Parse review count
        let reviewCount = 0;
        if (typeof c.review_count === 'number' && c.review_count > 0) {
          reviewCount = Math.max(0, Math.round(c.review_count));
        } else if (typeof c.review_count === 'string') {
          const parsed = parseInt(c.review_count, 10);
          if (!isNaN(parsed) && parsed > 0) {
            reviewCount = parsed;
          }
        }
        
        return {
          name,
          company_name: c.company_name || null,
          specialty: c.specialty || specialty,
          rating,
          review_count: reviewCount,
          address: c.address || `${city}, ${request.location.state}`,
          phone: c.phone || null,
          email: c.email || null,
          website: c.website ? (c.website.startsWith('http') ? c.website : `https://${c.website}`) : null,
          google_maps_url: googleMapsUrl,
          highlights: Array.isArray(c.highlights) && c.highlights.length > 0 ? c.highlights : ['Recommended contractor'],
          reddit_mentions: c.reddit_mentions || null,
          ai_confidence: typeof c.ai_confidence === 'number' ? Math.min(1, Math.max(0, c.ai_confidence)) : 0.5,
        };
      });

      // Filter: prefer contractors with ratings, but keep all if none have ratings
      const withRatings = allContractors.filter(c => c.rating > 0);
      const contractors = withRatings.length > 0 ? withRatings : allContractors;
      
      // Sort by rating (descending), then by review count (descending)
      contractors.sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        return b.review_count - a.review_count;
      });

      return {
        contractors: contractors.slice(0, 10), // Ensure max 10
        search_summary: parsed.search_summary || `Found ${contractors.length} contractors in ${request.location.city}`,
        total_found: parsed.total_found || allContractors.length,
        location_note: parsed.location_note || null,
      };
    } catch (error) {
      console.error('Failed to parse contractor search response:', error, response);
      
      // Return empty result on parse failure
      return {
        contractors: [],
        search_summary: 'Unable to complete search. Please try again.',
        total_found: 0,
        location_note: null,
      };
    }
  }

  /**
   * Generate an email to a contractor using AI
   */
  async generateEmail(
    householdId: string,
    userId: string,
    request: GenerateEmailRequest
  ): Promise<GeneratedEmail> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    // Bind the acting member's key the same way `searchContractors` does.
    // Without this the generator silently fell through to the managed key, so a
    // BYOK member's email drafting was billed to the platform, not to them.
    this.geminiApiKey = (await resolveProviderApiKey(this.env, userId, 'gemini')).apiKey;

    // Get the appropriate prompt template
    const promptTemplate = EMAIL_TYPE_PROMPTS[request.email_type];
    if (!promptTemplate) {
      throw new Error(`Unknown email type: ${request.email_type}`);
    }

    // Build the email prompt
    const prompt = promptTemplate
      .replace(/{contractor_name}/g, request.contractor.name)
      .replace(/{company_name}/g, request.contractor.company_name || request.contractor.name)
      .replace(/{user_name}/g, request.user_name || 'Homeowner')
      .replace(/{property_address}/g, request.property_address || 'my property')
      .replace(/{problem_title}/g, request.problem_title)
      .replace(/{problem_description}/g, request.problem_description);

    // Call Gemini to generate the email
    const response = await this.callGemini(
      EMAIL_GENERATION_SYSTEM_PROMPT,
      prompt
    );

    try {
      const parsed = JSON.parse(this.extractJsonFromResponse(response));

      return {
        subject: parsed.subject || `Inquiry about ${request.problem_title}`,
        body: parsed.body || 'Unable to generate email. Please try again.',
        contractor_name: request.contractor.name,
        contractor_email: request.contractor.email,
      };
    } catch (error) {
      console.error('Failed to parse email generation response:', error, response);

      // Return a default email on parse failure
      return {
        subject: `Inquiry: ${request.problem_title}`,
        body: `Hello,\n\nI am reaching out regarding ${request.problem_title}.\n\n${request.problem_description}\n\nPlease let me know if you can help with this issue.\n\nThank you,\n${request.user_name || 'Homeowner'}`,
        contractor_name: request.contractor.name,
        contractor_email: request.contractor.email,
      };
    }
  }

  /**
   * Send an email to a contractor using Resend
   * Note: This sends from the app's email address, with reply-to set to user's email
   */
  async sendEmail(
    householdId: string,
    userId: string,
    request: SendEmailRequest
  ): Promise<{ success: boolean; message: string }> {
    // Verify user has access to household
    await this.householdService.getHousehold(householdId, userId);

    if (!request.to_email) {
      return {
        success: false,
        message: 'Contractor email address is not available. Please use the native email app option.',
      };
    }

    // Build email HTML
    const htmlBody = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .footer { margin-top: 40px; font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            ${request.body.split('\n').map(line => `<p>${line || '&nbsp;'}</p>`).join('')}
            <div class="footer">
              <p>Sent via Simple House - Home Management App</p>
              ${request.reply_to ? `<p>Please reply to: ${request.reply_to}</p>` : ''}
            </div>
          </div>
        </body>
      </html>
    `;

    const success = await this.emailService.send({
      to: request.to_email,
      subject: request.subject,
      html: htmlBody,
      text: request.body,
    });

    return {
      success,
      message: success
        ? 'Email sent successfully'
        : 'Failed to send email. Please try again or use the native email app.',
    };
  }

  /**
   * Call Gemini API with Google Search grounding enabled
   */
  private async callGeminiWithGrounding(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const url = `${this.baseUrl}/models/gemini-3.5-flash:generateContent`;
    const geminiKey = this.geminiApiKey ?? this.env.GEMINI_API_KEY ?? '';

    // Enhanced prompt to strictly enforce JSON output
    const enhancedPrompt = `${systemPrompt}

CRITICAL: You MUST respond ONLY with valid JSON. No markdown, no explanations, no text before or after the JSON. Just the raw JSON object.

${userPrompt}

Remember: Output ONLY the JSON object, nothing else.`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: enhancedPrompt }],
          },
        ],
        tools: [
          {
            google_search: {},
          },
        ],
        generationConfig: {
          temperature: 0.3,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
          // Note: responseMimeType: "application/json" doesn't work with grounding tools
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as GeminiGroundingResponse;

    if (data.error) {
      throw new Error(`Gemini API error: ${data.error.message}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('No response text from Gemini');
    }

    // Log grounding metadata for debugging
    const groundingMetadata = data.candidates?.[0]?.groundingMetadata;
    if (groundingMetadata) {
      console.log('Gemini grounding used queries:', groundingMetadata.webSearchQueries);
      console.log('Gemini grounding sources:', groundingMetadata.groundingChunks?.length || 0);
    }

    return text;
  }

  /**
   * Call Gemini API without grounding (for email generation)
   * Uses JSON response mode for reliable parsing
   */
  private async callGemini(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const url = `${this.baseUrl}/models/gemini-3.5-flash:generateContent`;
    const geminiKey = this.geminiApiKey ?? this.env.GEMINI_API_KEY ?? '';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json', // Force JSON output
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as GeminiGroundingResponse;

    if (data.error) {
      throw new Error(`Gemini API error: ${data.error.message}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('No response text from Gemini');
    }

    return text;
  }

  /**
   * Extract JSON from a response that may contain markdown code blocks
   * Handles various AI response formats robustly
   */
  private extractJsonFromResponse(response: string): string {
    // First, try to parse directly (for responseMimeType: application/json)
    try {
      JSON.parse(response);
      return response;
    } catch {
      // Continue with extraction
    }

    // Try to extract JSON from markdown code blocks (```json ... ```)
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      const extracted = jsonMatch[1].trim();
      try {
        JSON.parse(extracted);
        return extracted;
      } catch {
        // Continue with other methods
      }
    }

    // Try to find the outermost JSON object
    let braceCount = 0;
    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < response.length; i++) {
      if (response[i] === '{') {
        if (braceCount === 0) {
          startIndex = i;
        }
        braceCount++;
      } else if (response[i] === '}') {
        braceCount--;
        if (braceCount === 0 && startIndex !== -1) {
          endIndex = i + 1;
          break;
        }
      }
    }

    if (startIndex !== -1 && endIndex !== -1) {
      const extracted = response.substring(startIndex, endIndex);
      try {
        JSON.parse(extracted);
        return extracted;
      } catch {
        // Continue with fallback
      }
    }

    // Last resort - try to find any JSON object pattern
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return objectMatch[0];
    }

    return response;
  }
}
