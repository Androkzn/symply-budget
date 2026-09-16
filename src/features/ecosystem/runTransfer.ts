import {
  createIdempotencyKey,
  smartEngineApi,
  type TransferConsentRecord,
  type TransferPackageId,
} from '@api/smart-engine';

export type RunTransferInput = {
  packageId: TransferPackageId;
  sourceBrandId: string;
  destinationBrandId: string;
  purpose?: string;
  sourceHouseholdId?: string | null;
  destinationHouseholdId?: string | null;
  existingConsents?: TransferConsentRecord[];
  /** Local-first Budget: client-built budget.summary.v1 manifest payload. */
  clientPayload?: Record<string, unknown>;
  localFirstExport?: boolean;
};

export type RunTransferResult = {
  operationId: string;
  importStatus: 'imported' | 'already_imported';
  consentId: string;
};

async function findOrGrantConsent(
  input: RunTransferInput
): Promise<TransferConsentRecord> {
  const consents =
    input.existingConsents ??
    (await smartEngineApi.listConsents()).filter((c) => c.status === 'active');

  const match = consents.find(
    (c) =>
      c.package_id === input.packageId &&
      c.source_brand_id === input.sourceBrandId &&
      c.destination_brand_id === input.destinationBrandId
  );
  if (match) return match;

  return smartEngineApi.grantConsent({
    package_id: input.packageId,
    source_brand_id: input.sourceBrandId,
    destination_brand_id: input.destinationBrandId,
    purpose: input.purpose,
  });
}

/**
 * Consent → prepare → export → import on the local Worker.
 * Cross-brand export (e.g. House source from Budget) is handled server-side via RPC.
 */
export async function runSoftTransfer(input: RunTransferInput): Promise<RunTransferResult> {
  const consent = await findOrGrantConsent(input);

  const prepared = await smartEngineApi.prepare(
    {
      package_id: input.packageId,
      source_brand_id: input.sourceBrandId,
      destination_brand_id: input.destinationBrandId,
      consent_id: consent.id,
      source_context_id: input.sourceHouseholdId ?? null,
      destination_context_id: input.destinationHouseholdId ?? null,
    },
    createIdempotencyKey()
  );

  const exportBody = {
    transfer_token: prepared.transfer_token,
    source_household_id: input.sourceHouseholdId ?? null,
    ...(input.clientPayload ? { client_payload: input.clientPayload } : {}),
  };
  const exported = await smartEngineApi.exportPackage(
    exportBody,
    input.localFirstExport ? { localFirst: true } : undefined
  );

  const imported = await smartEngineApi.importPackage(
    {
      envelope: exported.envelope,
      destination_household_id: input.destinationHouseholdId ?? null,
    },
    createIdempotencyKey()
  );

  return {
    operationId: imported.operation_id,
    importStatus: imported.status,
    consentId: consent.id,
  };
}
