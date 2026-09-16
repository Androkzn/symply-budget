import type { TransferPackageId } from '@symply/contracts';

import { api } from './client';

export type { TransferPackageId };

export type SmartEnginePackage = {
  package_id: TransferPackageId;
  version: number;
  source_brand_id: string;
  destination_brand_id: string;
  field_manifest: readonly string[];
  requires_source_household: boolean;
  requires_destination_household: boolean;
};

export type TransferConsentRecord = {
  id: string;
  package_id: TransferPackageId;
  source_brand_id: string;
  destination_brand_id: string;
  purpose: string;
  consent_version: number;
  status: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type PrepareTransferResult = {
  operation_id: string;
  transfer_token: string;
  expires_at: string;
  consent_id: string;
};

export type ExportPackageResult = {
  envelope: string;
  operation_id: string;
};

export type ImportPackageResult = {
  status: 'imported' | 'already_imported';
  operation_id: string;
};

const SMART_ENGINE_PREFIX = '/smart-engine';

/** CSPRNG idempotency key (≥16 chars) for prepare/import. */
export function createIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const smartEngineApi = {
  listPackages: () =>
    api.get<SmartEnginePackage[]>(`${SMART_ENGINE_PREFIX}/packages`).then((res) => res.data ?? []),

  listConsents: () =>
    api.get<TransferConsentRecord[]>(`${SMART_ENGINE_PREFIX}/consents`).then((res) => res.data ?? []),

  grantConsent: (body: {
    package_id: TransferPackageId;
    source_brand_id: string;
    destination_brand_id: string;
    purpose?: string;
  }) =>
    api
      .post<TransferConsentRecord>(`${SMART_ENGINE_PREFIX}/consents`, body)
      .then((res) => res.data!),

  revokeConsent: (consentId: string) =>
    api.delete<{ id: string; status: string }>(`${SMART_ENGINE_PREFIX}/consents/${consentId}`),

  prepare: (
    body: {
      package_id: TransferPackageId;
      source_brand_id: string;
      destination_brand_id: string;
      consent_id: string;
      source_context_id?: string | null;
      destination_context_id?: string | null;
    },
    idempotencyKey: string = createIdempotencyKey()
  ) =>
    api
      .post<PrepareTransferResult>(`${SMART_ENGINE_PREFIX}/prepare`, body, {
        headers: { 'Idempotency-Key': idempotencyKey },
      })
      .then((res) => res.data!),

  exportPackage: (
    body: {
      transfer_token: string;
      source_household_id?: string | null;
      client_payload?: Record<string, unknown>;
    },
    options?: { localFirst?: boolean }
  ) => {
    const config = options?.localFirst
      ? { headers: { 'X-Budget-Local-First': '1' } }
      : undefined;
    return api
      .post<ExportPackageResult>(`${SMART_ENGINE_PREFIX}/export`, body, config)
      .then((res) => res.data!);
  },

  importPackage: (
    body: { envelope: string; destination_household_id?: string | null },
    idempotencyKey: string = createIdempotencyKey()
  ) =>
    api
      .post<ImportPackageResult>(`${SMART_ENGINE_PREFIX}/import`, body, {
        headers: { 'Idempotency-Key': idempotencyKey },
      })
      .then((res) => res.data!),
};
