import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { apiClient } from './client';

// ============ TYPES ============

export interface ContractorRepresentative {
  id: string;
  contractor_id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
  notes: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

// ============ REQUEST TYPES ============

interface CreateRepresentativeRequest {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  is_primary?: boolean;
  notes?: string;
  photo_url?: string;
}

interface UpdateRepresentativeRequest {
  name?: string;
  role?: string;
  phone?: string;
  email?: string;
  is_primary?: boolean;
  notes?: string;
  photo_url?: string;
}

// ============ RESPONSE TYPES ============

interface RepresentativesResponse {
  representatives: ContractorRepresentative[];
}

interface RepresentativeResponse {
  representative: ContractorRepresentative;
}

// ============ API CLIENT ============

const remoteRepresentativesApi = {
  // List all representatives for a contractor
  getAll: (householdId: string, contractorId: string) =>
    apiClient
      .get<RepresentativesResponse>(
        `/households/${householdId}/contractors/${contractorId}/representatives`
      )
      .then((res) => res.data),

  // Get single representative
  getOne: (householdId: string, contractorId: string, representativeId: string) =>
    apiClient
      .get<RepresentativeResponse>(
        `/households/${householdId}/contractors/${contractorId}/representatives/${representativeId}`
      )
      .then((res) => res.data),

  // Create representative
  create: (householdId: string, contractorId: string, data: CreateRepresentativeRequest) =>
    apiClient
      .post<RepresentativeResponse>(
        `/households/${householdId}/contractors/${contractorId}/representatives`,
        data
      )
      .then((res) => res.data),

  // Update representative
  update: (
    householdId: string,
    contractorId: string,
    representativeId: string,
    data: UpdateRepresentativeRequest
  ) =>
    apiClient
      .patch<RepresentativeResponse>(
        `/households/${householdId}/contractors/${contractorId}/representatives/${representativeId}`,
        data
      )
      .then((res) => res.data),

  // Delete representative
  delete: (householdId: string, contractorId: string, representativeId: string) =>
    apiClient.delete(
      `/households/${householdId}/contractors/${contractorId}/representatives/${representativeId}`
    ),

  // Set as primary contact
  setPrimary: (householdId: string, contractorId: string, representativeId: string) =>
    apiClient
      .post<RepresentativeResponse>(
        `/households/${householdId}/contractors/${contractorId}/representatives/${representativeId}/set-primary`
      )
      .then((res) => res.data),
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens call
 * `representativesApi` exactly as before. See `documents/requirements/House v2/`
 * §6, §11 (sub-wave B1).
 *
 * `contractor_representatives` has no `household_id` column — it is reached only
 * through its contractor — so the local half lives in `localContractorsApi.ts`
 * beside the contractor guards it depends on, and is exported from there under
 * its own name. All six methods are local; nothing about a person's name and
 * phone number needs a server.
 */
export const representativesApi: typeof remoteRepresentativesApi = createHouseLocalProxy(
  remoteRepresentativesApi,
  {
    moduleName: 'representatives',
    // Narrow require: the barrel would pull the sync orchestrator and status
    // store into every api call from every screen.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolveLocal: () => require('@features/house/local/localContractorsApi').localRepresentativesApi,
  },
);
