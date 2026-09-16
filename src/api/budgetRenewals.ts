import { ENV } from '@config/env';
import { useAuthStore } from '@stores/authStore';

import { apiClient } from './client';

/**
 * Renewal reminders for one Monthly-Payments item (Savings → Monthly,
 * Budget-only). Base path:
 * `/households/:householdId/savings/recurring-payments/:paymentId/renewal`,
 * served by `backend/src/routes/savings.ts` (delegates to
 * `BudgetRenewalService`). Envelopes MUST match that file EXACTLY.
 *
 * Attachment contract mirrors `src/api/healthAssets.ts`: `POST .../documents`
 * RESERVES a row and hands back `upload.path` (a relative Worker path,
 * `upload_url` always null — R2 bindings can't presign), then
 * {@link uploadRenewalDocumentBytes} PUTs the raw bytes there through
 * `apiClient` (never a bare XHR — a relative path has no base URL or bearer
 * token without it). Reading the bytes back is a proxied, ownership-checked
 * path — see {@link budgetRenewalDocumentContentSource}.
 */

export const RENEWAL_CATEGORIES = [
  'insurance',
  'warranty',
  'subscription',
  'membership',
  'license',
  'other',
] as const;
export type RenewalCategory = (typeof RENEWAL_CATEGORIES)[number];

export const RENEWAL_CYCLES = ['monthly', 'quarterly', 'semi_annual', 'annual', 'custom'] as const;
export type RenewalCycle = (typeof RENEWAL_CYCLES)[number];

export type RenewalStatus = 'upcoming' | 'renewed' | 'lapsed' | 'cancelled';

export const RENEWAL_DOCUMENT_SOURCES = ['camera', 'gallery', 'file', 'drive', 'manual'] as const;
export type RenewalDocumentSource = (typeof RENEWAL_DOCUMENT_SOURCES)[number];

/** Server cap — mirrors `MAX_RENEWAL_DOCUMENT_BYTES` in `budget-renewal-service.ts`. */
export const RENEWAL_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

export const RENEWAL_DOCUMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
];

export interface BudgetRenewal {
  id: string;
  household_id: string;
  recurring_payment_id: string;
  category: RenewalCategory;
  provider: string | null;
  reference_number: string | null;
  cycle: RenewalCycle;
  cycle_months: number | null;
  next_renewal_date: string;
  renewal_amount_cents: number | null;
  auto_renew: boolean;
  reminder_lead_days: number;
  status: RenewalStatus;
  notes: string | null;
  last_renewed_at: string | null;
  renewal_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetRenewalDocument {
  id: string;
  renewal_id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  source: RenewalDocumentSource;
  created_at: string;
}

export interface UpsertRenewalRequest {
  category?: RenewalCategory;
  provider?: string | null;
  reference_number?: string | null;
  cycle?: RenewalCycle;
  cycle_months?: number | null;
  next_renewal_date: string;
  renewal_amount_cents?: number | null;
  auto_renew?: boolean;
  reminder_lead_days?: number;
  notes?: string | null;
}

export interface RenewalDocumentReservation {
  document: BudgetRenewalDocument;
  upload: { upload_url: null; method: 'PUT'; path: string };
}

const base = (householdId: string, paymentId: string) =>
  `/households/${householdId}/savings/recurring-payments/${paymentId}/renewal`;

const remoteBudgetRenewalsApi = {
  get: (householdId: string, paymentId: string) =>
    apiClient
      .get<{ renewal: BudgetRenewal | null; documents: BudgetRenewalDocument[] }>(base(householdId, paymentId))
      .then((r) => r.data),

  upsert: (householdId: string, paymentId: string, body: UpsertRenewalRequest) =>
    apiClient
      .put<{ renewal: BudgetRenewal }>(base(householdId, paymentId), body)
      .then((r) => r.data),

  markRenewed: (householdId: string, paymentId: string) =>
    apiClient
      .post<{ renewal: BudgetRenewal }>(`${base(householdId, paymentId)}/mark-renewed`)
      .then((r) => r.data),

  remove: (householdId: string, paymentId: string) =>
    apiClient.delete<{ success: boolean }>(base(householdId, paymentId)).then((r) => r.data),

  /** Step 1 of 2 — reserve the row and learn where to PUT. */
  createDocument: (
    householdId: string,
    paymentId: string,
    body: { file_name: string; mime_type: string; file_size: number; source: RenewalDocumentSource }
  ) =>
    apiClient
      .post<RenewalDocumentReservation>(`${base(householdId, paymentId)}/documents`, body)
      .then((r) => r.data),

  /**
   * Step 2 of 2 — PUT the raw bytes to the RELATIVE `upload.path`.
   * `transformRequest` is the identity function so axios doesn't try to
   * JSON-encode the Blob.
   */
  uploadDocumentBytes: (path: string, body: ArrayBuffer | Blob, contentType: string) =>
    apiClient
      .put<{ document: BudgetRenewalDocument }>(path, body, {
        headers: { 'Content-Type': contentType },
        transformRequest: [(data) => data],
      })
      .then((r) => r.data),

  deleteDocument: (householdId: string, paymentId: string, docId: string) =>
    apiClient
      .delete<{ deleted: boolean }>(`${base(householdId, paymentId)}/documents/${docId}`)
      .then((r) => r.data),
};

/**
 * Budget renewals API facade — routes to the local ledger (metadata-only
 * offline rows; R2 document upload remains unsupported) when Budget local-first
 * is on. See `localBudgetRenewalsApi`.
 */
export const budgetRenewalsApi: typeof remoteBudgetRenewalsApi = new Proxy(remoteBudgetRenewalsApi, {
  get(target, prop, receiver) {
    try {
      const { isBudgetLocalFirst } =
        require('@features/budget/local/flag') as typeof import('@features/budget/local/flag');
      if (isBudgetLocalFirst()) {
        const { localBudgetRenewalsApi } =
          require('@features/budget/local/renewals/localBudgetRenewalsApi') as typeof import('@features/budget/local/renewals/localBudgetRenewalsApi');
        const localFn = (localBudgetRenewalsApi as Record<string | symbol, unknown>)[prop];
        if (typeof localFn === 'function') {
          return localFn.bind(localBudgetRenewalsApi);
        }
      }
    } catch {
      // Feature not ready — fall through to remote.
    }
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

/**
 * `<Image source={...}>` / download source for a stored renewal document.
 * There is no public URL, so the bearer token has to ride on the request.
 * Returns null when there is no session.
 */
export function budgetRenewalDocumentContentSource(
  householdId: string,
  paymentId: string,
  docId: string
): { uri: string; headers: Record<string, string> } | null {
  const token = useAuthStore.getState().token;
  if (!token) return null;
  return {
    uri: `${ENV.API_BASE_URL}${base(householdId, paymentId)}/documents/${docId}/content`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

export default budgetRenewalsApi;
