import { createHouseLocalProxy } from '@features/house/local/localApiProxy';
import type { IoniconName } from '@utils/categoryIcons';

import { apiClient } from './client';

// ============ TYPES ============

export interface ContractorJobRating {
  id: string;
  contractor_id: string;
  visit_id: string;
  household_id: string;
  rated_by: string | null;
  overall_rating: number; // 1-5
  quality_rating: number | null;
  punctuality_rating: number | null;
  communication_rating: number | null;
  cleanliness_rating: number | null;
  value_rating: number | null;
  would_hire_again: boolean | null;
  review_text: string | null;
  review_photos: string | null; // JSON array
  is_private: boolean;
  created_at: string;
}

export interface RatingWithDetails extends ContractorJobRating {
  visit: {
    id: string;
    visit_date: string;
    purpose: string | null;
  };
  rated_by_user: {
    id: string;
    name: string;
  } | null;
}

export interface RatingSummary {
  contractor_id: string;
  total_ratings: number;
  average_overall: number;
  average_quality: number | null;
  average_punctuality: number | null;
  average_communication: number | null;
  average_cleanliness: number | null;
  average_value: number | null;
  would_hire_again_percentage: number | null;
  rating_distribution: {
    '1': number;
    '2': number;
    '3': number;
    '4': number;
    '5': number;
  };
}

export const RATING_DIMENSIONS = [
  'quality',
  'punctuality',
  'communication',
  'cleanliness',
  'value',
] as const;

export type RatingDimension = (typeof RATING_DIMENSIONS)[number];

export const RATING_DIMENSION_INFO: Record<
  RatingDimension,
  { label: string; icon: string; iconName: IoniconName }
> = {
  quality: { label: 'Quality of Work', icon: '⭐', iconName: 'star' },
  punctuality: { label: 'Punctuality', icon: '⏰', iconName: 'time' },
  communication: { label: 'Communication', icon: '💬', iconName: 'chatbubbles' },
  cleanliness: { label: 'Cleanliness', icon: '🧹', iconName: 'sparkles' },
  value: { label: 'Value for Money', icon: '💰', iconName: 'cash' },
};

// ============ REQUEST TYPES ============

interface CreateRatingRequest {
  visit_id: string;
  overall_rating: number;
  quality_rating?: number;
  punctuality_rating?: number;
  communication_rating?: number;
  cleanliness_rating?: number;
  value_rating?: number;
  would_hire_again?: boolean;
  review_text?: string;
  review_photos?: string[];
  is_private?: boolean;
}

interface UpdateRatingRequest {
  overall_rating?: number;
  quality_rating?: number;
  punctuality_rating?: number;
  communication_rating?: number;
  cleanliness_rating?: number;
  value_rating?: number;
  would_hire_again?: boolean;
  review_text?: string;
  review_photos?: string[];
  is_private?: boolean;
}

// ============ RESPONSE TYPES ============

interface RatingsResponse {
  ratings: RatingWithDetails[];
}

interface RatingResponse {
  rating: RatingWithDetails;
}

interface RatingSummaryResponse {
  summary: RatingSummary;
}

// ============ API CLIENT ============

const remoteRatingsApi = {
  // List all ratings for a contractor
  getAll: (householdId: string, contractorId: string) =>
    apiClient
      .get<RatingsResponse>(`/households/${householdId}/contractors/${contractorId}/ratings`)
      .then((res) => res.data),

  // Get rating summary for contractor
  getSummary: (householdId: string, contractorId: string) =>
    apiClient
      .get<RatingSummaryResponse>(`/households/${householdId}/contractors/${contractorId}/ratings/summary`)
      .then((res) => res.data),

  // Get single rating
  getOne: (householdId: string, contractorId: string, ratingId: string) =>
    apiClient
      .get<RatingResponse>(`/households/${householdId}/contractors/${contractorId}/ratings/${ratingId}`)
      .then((res) => res.data),

  // Create rating
  create: (householdId: string, contractorId: string, data: CreateRatingRequest) =>
    apiClient
      .post<RatingResponse>(`/households/${householdId}/contractors/${contractorId}/ratings`, data)
      .then((res) => res.data),

  // Update rating
  update: (householdId: string, contractorId: string, ratingId: string, data: UpdateRatingRequest) =>
    apiClient
      .patch<RatingResponse>(
        `/households/${householdId}/contractors/${contractorId}/ratings/${ratingId}`,
        data
      )
      .then((res) => res.data),

  // Delete rating
  delete: (householdId: string, contractorId: string, ratingId: string) =>
    apiClient.delete(`/households/${householdId}/contractors/${contractorId}/ratings/${ratingId}`),
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens call `ratingsApi`
 * exactly as before; the Proxy is what makes the H11 B4 cutover cost zero screen
 * edits. See `documents/requirements/House v2/` §6, §11 (sub-wave B4).
 *
 * All six methods are local: `remoteMethods` is empty and there is no throw
 * site. Rating the plumber who has just left needs no server and no model, and
 * `contractor_job_ratings` is the S3b table of the sub-wave — its id is minted
 * from `visit_id`, so two members answering the same "how did it go?" prompt
 * offline converge on one review instead of counting the job twice.
 *
 * Every figure in `getSummary` is recomputed from the rows rather than stored;
 * `localRatingsApi`'s header explains why `contractors.rating` is deliberately
 * left alone, and why both composed shapes here follow the CLIENT's type rather
 * than the Worker's differently-shaped answer of the same name.
 */
export const ratingsApi: typeof remoteRatingsApi = createHouseLocalProxy(remoteRatingsApi, {
  moduleName: 'ratings',
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localRatingsApi').localRatingsApi,
});
