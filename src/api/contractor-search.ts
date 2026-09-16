import { apiClient } from './client';

// ============ TYPES ============

export interface SearchLocation {
  latitude?: number;
  longitude?: number;
  city: string;
  state: string;
  address?: string; // Full property address
}

export interface FoundContractor {
  name: string;
  company_name: string | null;
  specialty: string;
  rating: number; // 0-5 (0 for government/municipal without ratings)
  review_count: number; // 0+ (0 for government/municipal without ratings)
  address: string;
  phone: string | null; // Critical for government/municipal services
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

export interface GeneratedEmail {
  subject: string;
  body: string;
  contractor_name: string;
  contractor_email: string | null;
}

export type EmailType = 'quote_request' | 'question' | 'availability_check';

export interface SendEmailResult {
  success: boolean;
  message: string;
}

// ============ REQUEST TYPES ============

export interface SearchContractorsRequest {
  problem_title: string;
  problem_description: string;
  system_category: string;
  location: SearchLocation;
  source_type: 'task' | 'task_draft';
  source_id: string;
  // Enhanced metadata for better AI search
  contractor_category?: string; // e.g., 'electrician', 'plumber', 'government', 'municipal'
  subtasks?: string[]; // Array of related subtask descriptions
  severity?: 'critical' | 'major' | 'minor' | 'informational';
  urgency_score?: number; // 1-10 scale
  source_page_numbers?: number[]; // Pages from inspection report
  source_quotes?: string[]; // Verbatim quotes from report
}

export interface GenerateEmailRequest {
  contractor: FoundContractor;
  problem_title: string;
  problem_description: string;
  email_type: EmailType;
  user_name?: string;
  property_address?: string;
}

export interface SendEmailRequest {
  to_email: string;
  subject: string;
  body: string;
  from_name: string;
  reply_to?: string;
}

// ============ API CLIENT ============

// Extended timeout for AI-powered search (60 seconds)
const AI_SEARCH_TIMEOUT = 60000;

export const contractorSearchApi = {
  /**
   * Search for contractors using AI with Google Search grounding
   * Note: This can take up to 60 seconds due to AI processing
   */
  search: (householdId: string, data: SearchContractorsRequest) =>
    apiClient
      .post<ContractorSearchResult>(
        `/households/${householdId}/contractors/search`,
        data,
        { timeout: AI_SEARCH_TIMEOUT }
      )
      .then((res) => res.data),

  /**
   * Generate an email template for a contractor
   */
  generateEmail: (householdId: string, data: GenerateEmailRequest) =>
    apiClient
      .post<GeneratedEmail>(
        `/households/${householdId}/contractors/generate-email`,
        data,
        { timeout: AI_SEARCH_TIMEOUT }
      )
      .then((res) => res.data),

  /**
   * Send an email to a contractor via the backend
   */
  sendEmail: (householdId: string, data: SendEmailRequest) =>
    apiClient
      .post<SendEmailResult>(`/households/${householdId}/contractors/send-email`, data)
      .then((res) => res.data),
};
