import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { apiClient } from './client';

// ============ TYPES ============

export const QUOTE_STATUSES = [
  'requested',
  'received',
  'reviewing',
  'accepted',
  'declined',
  'expired',
] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_INFO: Record<QuoteStatus, { label: string; color: string }> = {
  requested: { label: 'Requested', color: '#FF9500' },
  received: { label: 'Received', color: '#007AFF' },
  reviewing: { label: 'Reviewing', color: '#5856D6' },
  accepted: { label: 'Accepted', color: '#34C759' },
  declined: { label: 'Declined', color: '#8E8E93' },
  expired: { label: 'Expired', color: '#FF3B30' },
};

export interface Quote {
  id: string;
  household_id: string;
  contractor_id: string;
  appointment_id: string | null;
  title: string;
  description: string | null;
  amount_cents: number | null;
  amount_range_low_cents: number | null;
  amount_range_high_cents: number | null;
  valid_until: string | null;
  estimated_duration: string | null;
  warranty_terms: string | null;
  status: QuoteStatus;
  document_key: string | null;
  notes: string | null;
  linked_report_id: string | null;
  linked_task_id: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteWithDetails extends Quote {
  contractor: {
    id: string;
    name: string;
    company_name: string | null;
    specialty: string;
    phone: string | null;
    email: string | null;
    rating: number | null;
    specialtyInfo: { label: string; icon: string; color: string };
  };
  isExpiringSoon: boolean;
  isExpired: boolean;
  daysUntilExpiration: number | null;
}

/**
 * Rule-based (non-AI) comparison returned by POST /quotes/compare — and the base
 * of the AI variant. Mirrors `QuoteComparison` in backend/src/services/quote-service.ts.
 */
export interface QuoteComparison {
  quotes: QuoteWithDetails[];
  summary: {
    lowestPrice: { quoteId: string; amount: number } | null;
    highestPrice: { quoteId: string; amount: number } | null;
    fastestTimeline: { quoteId: string; duration: string } | null;
    bestWarranty: { quoteId: string; terms: string } | null;
    highestRatedContractor: { quoteId: string; rating: number } | null;
  };
}

export interface AIQuoteAnalysis {
  recommendedQuoteId: string;
  reasoning: string;
  comparisonMatrix: {
    quoteId: string;
    contractorName: string;
    priceScore: number;
    qualityScore: number;
    timelineScore: number;
    warrantyScore: number;
    overallScore: number;
    pros: string[];
    cons: string[];
  }[];
  redFlags: { quoteId: string; contractorName: string; flag: string }[];
  negotiationTips: string[];
  confidence: number;
}

export interface AIQuoteComparison {
  comparison: QuoteComparison;
  aiAnalysis: AIQuoteAnalysis | null;
}

// ============ REQUEST TYPES ============

interface CreateQuoteRequest {
  contractor_id: string;
  title: string;
  description?: string;
  amount_cents?: number;
  amount_range_low_cents?: number;
  amount_range_high_cents?: number;
  valid_until?: string;
  estimated_duration?: string;
  warranty_terms?: string;
  notes?: string;
  appointment_id?: string;
  linked_report_id?: string;
  linked_task_id?: string;
}

interface UpdateQuoteRequest {
  title?: string;
  description?: string;
  amount_cents?: number;
  amount_range_low_cents?: number;
  amount_range_high_cents?: number;
  valid_until?: string;
  estimated_duration?: string;
  warranty_terms?: string;
  status?: QuoteStatus;
  document_key?: string;
  notes?: string;
}

interface RequestQuotesRequest {
  contractor_ids: string[];
  title: string;
  description: string;
  linked_report_id?: string;
  linked_task_id?: string;
}

interface CompareQuotesRequest {
  quote_ids: string[];
}

interface CompareQuotesAIRequest {
  quote_ids: string[];
  task_context?: {
    title: string;
    description?: string;
    category?: string;
  };
}

interface QuoteFilters {
  contractor_id?: string;
  status?: QuoteStatus;
  expiring_soon?: boolean;
}

interface MarkReceivedRequest {
  amount_cents?: number;
  amount_range_low_cents?: number;
  amount_range_high_cents?: number;
  valid_until?: string;
  estimated_duration?: string;
  warranty_terms?: string;
  document_key?: string;
}

// ============ RESPONSE TYPES ============

interface QuotesResponse {
  quotes: QuoteWithDetails[];
}

interface QuoteResponse {
  quote: QuoteWithDetails;
}

interface QuoteComparisonResponse {
  comparison: QuoteComparison;
}

interface AIQuoteComparisonResponse {
  comparison: AIQuoteComparison;
}

interface AcceptQuoteResponse {
  quote: QuoteWithDetails;
  project?: {
    id: string;
    title: string;
  };
}

// ============ API CLIENT ============

const remoteQuotesApi = {
  // List quotes
  getAll: (householdId: string, filters?: QuoteFilters) =>
    apiClient
      .get<QuotesResponse>(`/households/${householdId}/quotes`, { params: filters })
      .then((res) => res.data),

  // Get pending quotes
  getPending: (householdId: string) =>
    apiClient
      .get<QuotesResponse>(`/households/${householdId}/quotes/pending`)
      .then((res) => res.data),

  // Get single quote
  getOne: (householdId: string, quoteId: string) =>
    apiClient
      .get<QuoteResponse>(`/households/${householdId}/quotes/${quoteId}`)
      .then((res) => res.data),

  // Create single quote
  create: (householdId: string, data: CreateQuoteRequest) =>
    apiClient
      .post<QuoteResponse>(`/households/${householdId}/quotes`, data)
      .then((res) => res.data),

  // Request quotes from multiple contractors
  requestQuotes: (householdId: string, data: RequestQuotesRequest) =>
    apiClient
      .post<QuotesResponse>(`/households/${householdId}/quotes/request`, data)
      .then((res) => res.data),

  // Compare quotes (rule-based)
  compare: (householdId: string, data: CompareQuotesRequest) =>
    apiClient
      .post<QuoteComparisonResponse>(`/households/${householdId}/quotes/compare`, data)
      .then((res) => res.data),

  // Compare quotes with AI analysis
  compareWithAI: (householdId: string, data: CompareQuotesAIRequest) =>
    apiClient
      .post<AIQuoteComparisonResponse>(`/households/${householdId}/quotes/compare-ai`, data)
      .then((res) => res.data),

  // Update quote
  update: (householdId: string, quoteId: string, data: UpdateQuoteRequest) =>
    apiClient
      .patch<QuoteResponse>(`/households/${householdId}/quotes/${quoteId}`, data)
      .then((res) => res.data),

  // Delete quote
  delete: (householdId: string, quoteId: string) =>
    apiClient.delete(`/households/${householdId}/quotes/${quoteId}`),

  // Accept quote (optionally create project)
  accept: (householdId: string, quoteId: string, createProject?: boolean) =>
    apiClient
      .post<AcceptQuoteResponse>(`/households/${householdId}/quotes/${quoteId}/accept`, {
        create_project: createProject,
      })
      .then((res) => res.data),

  // Decline quote
  decline: (householdId: string, quoteId: string, reason?: string) =>
    apiClient
      .post<QuoteResponse>(`/households/${householdId}/quotes/${quoteId}/decline`, { reason })
      .then((res) => res.data),

  // Mark quote as received
  markReceived: (householdId: string, quoteId: string, data: MarkReceivedRequest) =>
    apiClient
      .post<QuoteResponse>(`/households/${householdId}/quotes/${quoteId}/mark-received`, data)
      .then((res) => res.data),

  // Get document URL for viewing
  getDocumentUrl: (householdId: string, quoteId: string): string => {
    // Lazy on purpose — `@config/env` reads the brand at import time, and this
    // module is pulled in by the home dashboard on first paint. Same narrow
    // require the House proxy below uses, and disabled for the same reason.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { API_BASE_URL } = require('@config/env');
    return `${API_BASE_URL}/households/${householdId}/quotes/${quoteId}/document`;
  },
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens call `quotesApi`
 * exactly as before. See `documents/requirements/House v2/` §6, §11 (sub-wave
 * B2).
 *
 * This module serves the labor-hub `quotes` table. It does NOT serve
 * `contractor_quotes`, which is the task-scoped table behind
 * `tasksApi.getTaskQuotes`; both are ledgered by B2 and only this one has a
 * facade, because only this one has writes a device can perform.
 *
 * `remoteMethods` is empty on purpose. The two methods that cannot work offline
 * (`compareWithAI`, `getDocumentUrl`) are PRESENT in `localQuotesApi` as thrown
 * `HouseLocalUnsupportedError`s with member-facing copy, which is what the
 * coverage rule requires. Declaring them here instead would route them to a
 * Worker that holds no quotes for a local-first household — a 200 with an empty
 * comparison, which is the exact silence the Proxy exists to prevent.
 *
 * `getDocumentUrl` is the one synchronous method in either B2 module, so its
 * gap surfaces as a synchronous throw rather than the Proxy's usual rejected
 * promise. That is correct for a string-builder: there is no promise to reject.
 */
export const quotesApi: typeof remoteQuotesApi = createHouseLocalProxy(remoteQuotesApi, {
  moduleName: 'quotes',
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localQuotesApi').localQuotesApi,
});
