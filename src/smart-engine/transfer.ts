/**
 * Smart Engine transfer packages (Phase 6b).
 *
 * Apps export/import only — no cross-product DB joins.
 * Consent is required before any package leaves an app.
 *
 * Canonical mobile entrypoint: `runSoftTransfer` (@features/ecosystem/runTransfer).
 * The helpers below are thin wrappers for older call sites.
 */

import {
  smartEngineApi,
  type TransferConsentRecord,
} from '@api/smart-engine';
import {
  runSoftTransfer,
  type RunTransferResult,
} from '@features/ecosystem/runTransfer';
import {
  TRANSFER_PACKAGE_CATALOG,
  TRANSFER_PACKAGE_LABELS,
  type TransferPackageId,
} from '@symply/contracts';

export type { TransferPackageId, RunTransferResult };

export { TRANSFER_PACKAGE_CATALOG, TRANSFER_PACKAGE_LABELS };

export type TransferConsent = {
  packageId: TransferPackageId;
  fromBrandId: string;
  toBrandId: string;
  userId: string;
  grantedAt: string;
  expiresAt?: string;
};

export type TransferEnvelope<T = unknown> = {
  packageId: TransferPackageId;
  schemaVersion: 1;
  userId: string;
  exportedAt: string;
  fromBrandId: string;
  payload: T;
};

export async function listTransferPackages() {
  return smartEngineApi.listPackages();
}

export async function listTransferConsents(): Promise<TransferConsentRecord[]> {
  return smartEngineApi.listConsents();
}

/**
 * Consent → prepare → export → import (atomic Soft Transfer).
 * Prefer importing `runSoftTransfer` directly in new code.
 */
export async function exportTransferPackage(
  packageId: TransferPackageId,
  consent: TransferConsent,
  options?: {
    sourceHouseholdId?: string | null;
    destinationHouseholdId?: string | null;
    existingConsents?: TransferConsentRecord[];
  }
): Promise<RunTransferResult> {
  return runSoftTransfer({
    packageId,
    sourceBrandId: consent.fromBrandId,
    destinationBrandId: consent.toBrandId,
    sourceHouseholdId: options?.sourceHouseholdId,
    destinationHouseholdId: options?.destinationHouseholdId,
    existingConsents: options?.existingConsents,
  });
}

/**
 * Soft Transfer is atomic — there is no standalone import path on mobile.
 * Use `runSoftTransfer` / `exportTransferPackage`, or `smartEngineApi.importPackage`
 * when you already hold a server envelope.
 */
export async function importTransferPackage(
  _envelope: TransferEnvelope,
  _consent: TransferConsent
): Promise<{ ok: false; reason: string }> {
  return { ok: false, reason: 'use_runSoftTransfer_or_smartEngineApi' };
}
