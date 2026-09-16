import { createHouseLocalProxy } from '@features/house/local/localApiProxy';

import { apiClient } from './client';

// ============ TYPES ============

export const CONTRACTOR_SPECIALTIES = [
  // Trades
  'plumber',
  'electrician',
  'hvac',
  'roofer',
  'general',
  'landscaper',
  'painter',
  'carpenter',
  'appliance',
  'pest_control',
  'cleaning',
  // Government & Municipal
  'government',
  'municipal',
  // Utilities
  'utility_bchydro',
  'utility_fortisbc',
  'utility_telus',
  'utility_shaw',
  'utility_water',
  // Services
  'insurance',
  'strata',
  'property_mgmt',
  'security',
  'waste_mgmt',
  'home_warranty',
  'inspector',
  'surveyor',
  'other',
] as const;

export type ContractorSpecialty = (typeof CONTRACTOR_SPECIALTIES)[number];

// `icon` holds an Ionicons glyph name (see getContractorCategoryIcon in
// @utils/categoryIcons) so any consumer can render <Ionicons name={info.icon} />.
// Kept in sync with the canonical CONTRACTOR_CATEGORY_ICONS map.
export const SPECIALTY_INFO: Record<ContractorSpecialty, { label: string; icon: string; color: string }> = {
  // Trades
  plumber: { label: 'Plumber', icon: 'water', color: '#2196F3' },
  electrician: { label: 'Electrician', icon: 'flash', color: '#FFD600' },
  hvac: { label: 'HVAC Technician', icon: 'snow', color: '#4ECDC4' },
  roofer: { label: 'Roofer', icon: 'home', color: '#8BC34A' },
  general: { label: 'General Contractor', icon: 'construct', color: '#795548' },
  landscaper: { label: 'Landscaper', icon: 'leaf', color: '#4CAF50' },
  painter: { label: 'Painter', icon: 'color-palette', color: '#9C27B0' },
  carpenter: { label: 'Carpenter', icon: 'hammer', color: '#A1887F' },
  appliance: { label: 'Appliance Repair', icon: 'tv', color: '#FF5722' },
  pest_control: { label: 'Pest Control', icon: 'bug', color: '#607D8B' },
  cleaning: { label: 'Cleaning', icon: 'sparkles', color: '#00BCD4' },
  // Government & Municipal
  government: { label: 'Government', icon: 'business', color: '#3F51B5' },
  municipal: { label: 'City/Municipal', icon: 'business', color: '#5C6BC0' },
  // Utilities
  utility_bchydro: { label: 'BC Hydro', icon: 'flash', color: '#1E88E5' },
  utility_fortisbc: { label: 'FortisBC', icon: 'flame', color: '#FF6F00' },
  utility_telus: { label: 'Telus', icon: 'call', color: '#6A1B9A' },
  utility_shaw: { label: 'Shaw/Rogers', icon: 'wifi', color: '#0288D1' },
  utility_water: { label: 'Water Utility', icon: 'water', color: '#03A9F4' },
  // Services
  insurance: { label: 'Insurance', icon: 'shield-checkmark', color: '#00796B' },
  strata: { label: 'Strata', icon: 'business', color: '#5D4037' },
  property_mgmt: { label: 'Property Mgmt', icon: 'key', color: '#455A64' },
  security: { label: 'Security', icon: 'lock-closed', color: '#37474F' },
  waste_mgmt: { label: 'Waste Mgmt', icon: 'trash', color: '#689F38' },
  home_warranty: { label: 'Home Warranty', icon: 'document-text', color: '#7B1FA2' },
  inspector: { label: 'Inspector', icon: 'search', color: '#E65100' },
  surveyor: { label: 'Surveyor', icon: 'map', color: '#827717' },
  other: { label: 'Other', icon: 'construct', color: '#9E9E9E' },
};

export const VISIT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const DOCUMENT_TYPES = ['receipt', 'invoice', 'quote', 'warranty', 'contract', 'photo', 'other'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface Contractor {
  id: string;
  household_id: string;
  name: string;
  company_name: string | null;
  specialty: ContractorSpecialty;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  notes: string | null;
  rating: number | null;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContractorWithStats extends Contractor {
  totalVisits: number;
  totalSpent: number;
  lastVisitDate: string | null;
  specialtyInfo: { label: string; icon: string; color: string };
}

export interface ContractorDetail extends ContractorWithStats {
  recentVisits: ContractorVisit[];
  documentCount: number;
}

export interface ContractorVisit {
  id: string;
  contractor_id: string;
  household_id: string;
  visit_date: string;
  description: string | null;
  cost: number | null;
  status: VisitStatus;
  notes: string | null;
  rating: number | null;
  linked_task_id: string | null;
  linked_budget_item_id: string | null;
  // Receipt tracking fields
  receipt_received: boolean;
  receipt_reminder_task_id: string | null;
  receipt_requested_at: string | null;
  // Visit mode fields (for on-site visit management)
  visit_mode_started_at: string | null;
  visit_mode_ended_at: string | null;
  contractor_rep_name: string | null;
  task_id: string | null;
  // Visit-level voice recording
  voice_recording_key: string | null; // R2 storage key
  voice_recording_transcription: string | null; // AI transcription
  voice_recording_duration_seconds: number | null;
  voice_recording_analysis: string | null; // JSON: AI analysis
  created_at: string;
  updated_at: string;
}

export interface ContractorVisitWithContractor extends ContractorVisit {
  contractor: Contractor;
}

export interface ContractorDocument {
  id: string;
  contractor_id: string;
  visit_id: string | null;
  household_id: string;
  type: DocumentType;
  title: string;
  file_key: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  amount: number | null;
  document_date: string | null;
  notes: string | null;
  created_at: string;
}

// ============ REQUEST TYPES ============

interface CreateContractorRequest {
  name: string;
  company_name?: string;
  specialty: ContractorSpecialty;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  notes?: string;
  rating?: number;
  is_favorite?: boolean;
}

interface UpdateContractorRequest {
  name?: string;
  company_name?: string;
  specialty?: ContractorSpecialty;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  notes?: string;
  rating?: number;
  is_favorite?: boolean;
}

interface ContractorFilters {
  specialty?: ContractorSpecialty;
  is_favorite?: boolean;
  search?: string;
}

interface CreateVisitRequest {
  visit_date: string;
  description?: string;
  cost?: number;
  status: VisitStatus;
  notes?: string;
  rating?: number;
  linked_task_id?: string;
  linked_budget_item_id?: string;
}

interface UpdateVisitRequest {
  visit_date?: string;
  description?: string;
  cost?: number;
  status?: VisitStatus;
  notes?: string;
  rating?: number;
  linked_task_id?: string;
  linked_budget_item_id?: string;
  receipt_received?: boolean;
}

// Receipt request types
interface RequestReceiptRequest {
  method: 'email' | 'sms';
  contractor_email?: string;
  contractor_phone?: string;
  property_address: string;
  custom_message?: string;
}

interface RequestReceiptResponse {
  success: boolean;
  message: string;
  receipt_requested_at: string;
}

interface ReceiptReminderTaskResponse {
  success: boolean;
  task_id: string;
  message: string;
}

interface VisitFilters {
  contractor_id?: string;
  status?: VisitStatus;
  start_date?: string;
  end_date?: string;
}

interface CreateDocumentRequest {
  contractor_id: string;
  visit_id?: string;
  type: DocumentType;
  title: string;
  file_key: string;
  file_name: string;
  file_size?: number;
  mime_type?: string;
  amount?: number;
  document_date?: string;
  notes?: string;
}

interface DocumentFilters {
  contractor_id?: string;
  visit_id?: string;
  type?: DocumentType;
}

interface UploadUrlRequest {
  file_name: string;
  content_type: string;
}

// ============ RESPONSE TYPES ============

interface ContractorsResponse {
  contractors: ContractorWithStats[];
}

interface ContractorResponse {
  contractor: ContractorDetail;
}

interface ContractorCreateResponse {
  contractor: Contractor;
}

interface VisitsResponse {
  visits: ContractorVisitWithContractor[];
}

interface VisitResponse {
  visit: ContractorVisit;
}

interface DocumentsResponse {
  documents: ContractorDocument[];
}

interface DocumentResponse {
  document: ContractorDocument;
}

interface UploadUrlResponse {
  uploadUrl: string;
  fileKey: string;
}

// AI Lookup types
export interface AIContractorLookupResult {
  name?: string;
  company_name?: string;
  specialty?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  notes?: string;
  business_type?: string;
  license_number?: string;
  years_in_business?: number;
  service_area?: string;
  business_hours?: string;
}

interface AILookupResponse {
  success: boolean;
  contractor: AIContractorLookupResult | null;
  confidence?: number;
  message?: string;
  error?: string;
}

// ============ API CLIENT ============

const remoteContractorsApi = {
  // Contractors
  getAll: (householdId: string, filters?: ContractorFilters) =>
    apiClient
      .get<ContractorsResponse>(`/households/${householdId}/contractors`, { params: filters })
      .then((res) => res.data),

  getOne: (householdId: string, contractorId: string) =>
    apiClient
      .get<ContractorResponse>(`/households/${householdId}/contractors/${contractorId}`)
      .then((res) => res.data),

  create: (householdId: string, data: CreateContractorRequest) =>
    apiClient
      .post<ContractorCreateResponse>(`/households/${householdId}/contractors`, data)
      .then((res) => res.data),

  update: (householdId: string, contractorId: string, data: UpdateContractorRequest) =>
    apiClient
      .patch<ContractorCreateResponse>(`/households/${householdId}/contractors/${contractorId}`, data)
      .then((res) => res.data),

  delete: (householdId: string, contractorId: string) =>
    apiClient.delete(`/households/${householdId}/contractors/${contractorId}`),

  toggleFavorite: (householdId: string, contractorId: string, isFavorite: boolean) =>
    apiClient
      .patch<ContractorCreateResponse>(`/households/${householdId}/contractors/${contractorId}`, {
        is_favorite: isFavorite,
      })
      .then((res) => res.data),

  // Visits
  getAllVisits: (householdId: string, filters?: VisitFilters) =>
    apiClient
      .get<VisitsResponse>(`/households/${householdId}/contractors/visits`, { params: filters })
      .then((res) => res.data),

  getContractorVisits: (householdId: string, contractorId: string) =>
    apiClient
      .get<VisitsResponse>(`/households/${householdId}/contractors/${contractorId}/visits`)
      .then((res) => res.data),

  createVisit: (householdId: string, contractorId: string, data: CreateVisitRequest) =>
    apiClient
      .post<VisitResponse>(`/households/${householdId}/contractors/${contractorId}/visits`, data)
      .then((res) => res.data),

  updateVisit: (householdId: string, visitId: string, data: UpdateVisitRequest) =>
    apiClient
      .patch<VisitResponse>(`/households/${householdId}/contractors/visits/${visitId}`, data)
      .then((res) => res.data),

  deleteVisit: (householdId: string, visitId: string) =>
    apiClient.delete(`/households/${householdId}/contractors/visits/${visitId}`),

  // Receipt management
  markReceiptReceived: (householdId: string, visitId: string, received: boolean) =>
    apiClient
      .patch<VisitResponse>(`/households/${householdId}/contractors/visits/${visitId}`, {
        receipt_received: received,
      })
      .then((res) => res.data),

  requestReceipt: (householdId: string, visitId: string, data: RequestReceiptRequest) =>
    apiClient
      .post<RequestReceiptResponse>(
        `/households/${householdId}/contractors/visits/${visitId}/request-receipt`,
        data
      )
      .then((res) => res.data),

  createReceiptReminderTask: (householdId: string, visitId: string) =>
    apiClient
      .post<ReceiptReminderTaskResponse>(
        `/households/${householdId}/contractors/visits/${visitId}/receipt-reminder-task`
      )
      .then((res) => res.data),

  // Documents
  getAllDocuments: (householdId: string, filters?: DocumentFilters) =>
    apiClient
      .get<DocumentsResponse>(`/households/${householdId}/contractors/documents`, { params: filters })
      .then((res) => res.data),

  getContractorDocuments: (householdId: string, contractorId: string) =>
    apiClient
      .get<DocumentsResponse>(`/households/${householdId}/contractors/${contractorId}/documents`)
      .then((res) => res.data),

  getUploadUrl: (householdId: string, data: UploadUrlRequest) =>
    apiClient
      .post<UploadUrlResponse>(`/households/${householdId}/contractors/documents/upload-url`, data)
      .then((res) => res.data),

  uploadDocument: async (householdId: string, file: { uri: string; name: string; type: string }) => {
    const formData = new FormData();
    // React Native's FormData takes the `{uri,name,type}` shape the DOM typings
    // do not know about — `as unknown as Blob` is how every other upload in
    // `src/api/` spells it (`images.ts:134`, `savings.ts:1201`, `utilities.ts:791`).
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as unknown as Blob);

    const response = await apiClient.post<{
      success: boolean;
      fileKey: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    }>(`/households/${householdId}/contractors/documents/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  createDocument: (householdId: string, data: CreateDocumentRequest) =>
    apiClient
      .post<DocumentResponse>(`/households/${householdId}/contractors/documents`, data)
      .then((res) => res.data),

  deleteDocument: (householdId: string, documentId: string) =>
    apiClient.delete(`/households/${householdId}/contractors/documents/${documentId}`),

  // AI Lookup
  aiLookup: (householdId: string, companyName: string) =>
    apiClient
      .post<AILookupResponse>(`/households/${householdId}/contractors/ai-lookup`, {
        company_name: companyName,
      })
      .then((res) => res.data),

  // Visit Mode
  startVisitMode: (householdId: string, visitId: string, data?: { contractor_rep_name?: string; start_time?: string }) =>
    apiClient
      .post<VisitResponse>(`/households/${householdId}/contractors/visits/${visitId}/start`, data || {})
      .then((res) => res.data),

  completeVisit: (
    householdId: string,
    visitId: string,
    data?: {
      rating?: number;
      notes?: string;
      completed_at?: string;
      voice_recording_key?: string;
      voice_recording_transcription?: string;
      voice_recording_duration_seconds?: number;
    }
  ) =>
    apiClient
      .post<VisitResponse>(`/households/${householdId}/contractors/visits/${visitId}/complete`, data || {})
      .then((res) => res.data),
};

/**
 * House V2 facade — routes to the on-device ledger when House local-first is
 * enabled, otherwise to the Cloudflare D1 remote API. Screens and stores call
 * `contractorsApi` exactly as before; the Proxy is what makes the H11 B1 cutover
 * cost zero screen edits. See `documents/requirements/House v2/` §6, §11.
 *
 * Every method has a local counterpart, so `remoteMethods` is empty: the three
 * that cannot work offline (`getUploadUrl`, `uploadDocument`, `aiLookup`) are
 * present in `localContractorsApi` as thrown `HouseLocalUnsupportedError`s with
 * member-facing copy, which is what the coverage rule requires. Declaring them
 * here instead would route them to a Worker whose bucket holds nothing for a
 * local-first household — a 200 with an empty answer, which is the exact silence
 * the Proxy exists to prevent.
 */
export const contractorsApi: typeof remoteContractorsApi = createHouseLocalProxy(
  remoteContractorsApi,
  {
    moduleName: 'contractors',
    // Narrow require: the barrel would pull the sync orchestrator and status
    // store into every api call from every screen.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolveLocal: () => require('@features/house/local/localContractorsApi').localContractorsApi,
  },
);
