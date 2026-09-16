import type { HouseBlobDescriptor } from '@features/house/local/blobs';
import { createHouseLocalProxy } from '@features/house/local/localApiProxy';
import {
  applianceResponseSchema,
  appliancesListResponseSchema,
} from '@symply/contracts';
import type { IoniconName } from '@utils/categoryIcons';


import { apiClient } from './client';
import { shouldValidateApiResponses, validateApiResponse } from './validateResponse';

// Types
export interface ApplianceWarranty {
  manufacturer?: {
    expiration: string;
    coverage: string;
  };
  extended?: {
    provider: string;
    expiration: string;
    coverage: string;
    claimPhone?: string;
  };
}

export interface Appliance {
  id: string;
  household_id: string;
  space_id?: string;
  name: string;
  category: string;
  type: string;
  location?: string;
  brand?: string;
  model?: string;
  serial_number?: string;
  purchase_date?: string;
  install_date?: string;
  expected_lifespan?: number;
  warranty?: ApplianceWarranty;
  purchase_cost?: number;
  total_maintenance_cost: number;
  created_at: string;
  updated_at: string;
}

export interface ApplianceDocument {
  id: string;
  appliance_id: string;
  type: 'receipt' | 'warranty' | 'manual' | 'service_record' | 'photo';
  r2_key: string;
  url?: string;
  uploaded_at: string;
  /**
   * H6 encrypted-channel descriptor, when the BYTES travelled through
   * `@features/house/local/blobs` instead of the legacy R2 upload.
   *
   * This field is what makes an appliance attachment reach a peer at all.
   * `r2_key` names an R2 object a local-first household never wrote, so a row
   * carrying only the key is Budget's `localWishMedia.ts` bug one table over:
   * the metadata syncs and the file does not. A descriptor is content-derived
   * and device-independent, so any enrolled peer can open it.
   *
   * Optional and additive, exactly as `TaskPhoto.blob` is. A document created on
   * the legacy server path has no descriptor and keeps its `r2_key`; only rows
   * written through the ledger carry this, and only those render through
   * `HouseBlobImage`.
   *
   * Type-only import: the blobs barrel pulls `expo-file-system` and the crypto
   * engine, and this module is on the cold path of every screen. `import type`
   * is erased at compile time, so nothing is added to the module graph.
   */
  blob?: HouseBlobDescriptor;
}

export interface ServiceHistoryEntry {
  id: string;
  appliance_id: string;
  service_date: string;
  description: string;
  cost?: number;
  provider_id?: string;
  provider_name?: string;
  created_at: string;
}

// Request types
interface CreateApplianceRequest {
  space_id?: string;
  name: string;
  category: string;
  type: string;
  location?: string;
  brand?: string;
  model?: string;
  serial_number?: string;
  purchase_date?: string;
  install_date?: string;
  expected_lifespan?: number;
  warranty?: ApplianceWarranty;
  purchase_cost?: number;
}

interface UpdateApplianceRequest extends Partial<CreateApplianceRequest> {}

interface AddDocumentRequest {
  type: 'receipt' | 'warranty' | 'manual' | 'service_record' | 'photo';
  r2_key: string;
  /**
   * Rides alongside the key so the descriptor reaches the ledger row. The Worker
   * ignores it — `addDocumentSchema` in `routes/appliances.ts` validates exactly
   * `type` + `r2_key` — which is what lets one call site compile and behave on
   * both paths instead of the screens branching on the flag.
   */
  blob?: HouseBlobDescriptor;
}

interface AddServiceHistoryRequest {
  service_date: string;
  description: string;
  cost?: number;
  provider_id?: string;
}

// Response types
interface ApplianceResponse {
  appliance: Appliance;
}

interface AppliancesListResponse {
  appliances: Appliance[];
}

interface DocumentsResponse {
  documents: ApplianceDocument[];
}

interface ServiceHistoryResponse {
  history: ServiceHistoryEntry[];
}

const remoteAppliancesApi = {
  list: (householdId: string, filters?: { category?: string; space_id?: string }) =>
    apiClient
      .get<AppliancesListResponse>(`/households/${householdId}/appliances`, { params: filters })
      .then((res) => {
        const data = res.data;
        if (!shouldValidateApiResponses()) return data;
        return validateApiResponse(
          appliancesListResponseSchema,
          data,
          `GET /households/${householdId}/appliances`,
        );
      }),

  get: (householdId: string, applianceId: string) =>
    apiClient
      .get<ApplianceResponse>(`/households/${householdId}/appliances/${applianceId}`)
      .then((res) => {
        const data = res.data;
        if (!shouldValidateApiResponses()) return data;
        return validateApiResponse(
          applianceResponseSchema,
          data,
          `GET /households/${householdId}/appliances/${applianceId}`,
        );
      }),

  create: (householdId: string, data: CreateApplianceRequest) =>
    apiClient
      .post<ApplianceResponse>(`/households/${householdId}/appliances`, data)
      .then((res) => res.data),

  update: (householdId: string, applianceId: string, data: UpdateApplianceRequest) =>
    apiClient
      .patch<ApplianceResponse>(`/households/${householdId}/appliances/${applianceId}`, data)
      .then((res) => res.data),

  delete: (householdId: string, applianceId: string) =>
    apiClient.delete(`/households/${householdId}/appliances/${applianceId}`),

  // Documents
  getDocuments: (householdId: string, applianceId: string) =>
    apiClient
      .get<DocumentsResponse>(`/households/${householdId}/appliances/${applianceId}/documents`)
      .then((res) => res.data),

  addDocument: (householdId: string, applianceId: string, data: AddDocumentRequest) =>
    apiClient
      .post<{ document: ApplianceDocument }>(
        `/households/${householdId}/appliances/${applianceId}/documents`,
        data
      )
      .then((res) => res.data),

  // Service History
  getServiceHistory: (householdId: string, applianceId: string) =>
    apiClient
      .get<ServiceHistoryResponse>(
        `/households/${householdId}/appliances/${applianceId}/service-history`
      )
      .then((res) => res.data),

  addServiceHistory: (householdId: string, applianceId: string, data: AddServiceHistoryRequest) =>
    apiClient
      .post<{ entry: ServiceHistoryEntry }>(
        `/households/${householdId}/appliances/${applianceId}/service-history`,
        data
      )
      .then((res) => res.data),
};

// Appliance category helpers. `icon` is an Ionicons glyph name so screens can
// render it via <Ionicons> for consistent, on-brand iconography.
export const APPLIANCE_CATEGORIES: Array<{ id: string; label: string; icon: IoniconName }> = [
  { id: 'hvac', label: 'HVAC', icon: 'snow' },
  { id: 'kitchen', label: 'Kitchen', icon: 'restaurant' },
  { id: 'laundry', label: 'Laundry', icon: 'shirt' },
  { id: 'plumbing', label: 'Plumbing', icon: 'water' },
  { id: 'outdoor', label: 'Outdoor', icon: 'leaf' },
  { id: 'garage', label: 'Garage', icon: 'car' },
  { id: 'other', label: 'Other', icon: 'cube' },
];

export const APPLIANCE_TYPES: Record<string, string[]> = {
  hvac: ['Furnace', 'Air Conditioner', 'Heat Pump', 'Boiler', 'Water Heater', 'Humidifier', 'Thermostat'],
  kitchen: ['Refrigerator', 'Dishwasher', 'Oven', 'Range', 'Microwave', 'Garbage Disposal', 'Range Hood'],
  laundry: ['Washer', 'Dryer', 'Washer/Dryer Combo'],
  plumbing: ['Water Heater', 'Sump Pump', 'Water Softener', 'Water Filter'],
  outdoor: ['Pool Pump', 'Hot Tub', 'Irrigation System', 'Outdoor Lighting'],
  garage: ['Garage Door Opener', 'Lawn Mower', 'Snow Blower', 'Generator'],
  other: ['Other'],
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens and stores call
 * `appliancesApi` exactly as before; the Proxy is what makes the H3 cutover cost
 * zero screen edits. See `documents/requirements/House v2/` §6.
 */
export const appliancesApi: typeof remoteAppliancesApi = createHouseLocalProxy(remoteAppliancesApi, {
  moduleName: 'appliances',
  // Narrow require: the barrel would pull the sync orchestrator and status
  // store into every api call from every screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveLocal: () => require('@features/house/local/localAppliancesApi').localAppliancesApi,
});
