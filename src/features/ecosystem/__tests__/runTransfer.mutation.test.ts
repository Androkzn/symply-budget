/**
 * Soft Transfer mutation path: consent → prepare → export → import.
 * Asserts smartEngineApi method sequence and payloads (not Zustand).
 */
const mockListConsents = jest.fn();
const mockGrantConsent = jest.fn();
const mockPrepare = jest.fn();
const mockExportPackage = jest.fn();
const mockImportPackage = jest.fn();

jest.mock('@api/smart-engine', () => ({
  createIdempotencyKey: () => 'idem-key-0123456789ab',
  smartEngineApi: {
    listConsents: (...a: unknown[]) => mockListConsents(...a),
    grantConsent: (...a: unknown[]) => mockGrantConsent(...a),
    prepare: (...a: unknown[]) => mockPrepare(...a),
    exportPackage: (...a: unknown[]) => mockExportPackage(...a),
    importPackage: (...a: unknown[]) => mockImportPackage(...a),
  },
}));

import { runSoftTransfer } from '../runTransfer';

beforeEach(() => {
  jest.clearAllMocks();
  mockListConsents.mockResolvedValue([]);
  mockGrantConsent.mockResolvedValue({
    id: 'consent-1',
    package_id: 'budget.summary.v1',
    source_brand_id: 'symply-budget',
    destination_brand_id: 'symply-house',
    status: 'active',
  });
  mockPrepare.mockResolvedValue({
    operation_id: 'op-1',
    transfer_token: 'tok-1',
    expires_at: '2099-01-01T00:00:00Z',
    consent_id: 'consent-1',
  });
  mockExportPackage.mockResolvedValue({ envelope: 'env-1', operation_id: 'op-1' });
  mockImportPackage.mockResolvedValue({ status: 'imported', operation_id: 'op-1' });
});

describe('runSoftTransfer — API mutation sequence', () => {
  it('grants consent then prepare/export/import with household contexts', async () => {
    const result = await runSoftTransfer({
      packageId: 'budget.summary.v1',
      sourceBrandId: 'symply-budget',
      destinationBrandId: 'symply-house',
      purpose: 'Share budget summary',
      sourceHouseholdId: 'hh-budget',
      destinationHouseholdId: 'hh-house',
    });

    expect(mockListConsents).toHaveBeenCalledTimes(1);
    expect(mockGrantConsent).toHaveBeenCalledWith({
      package_id: 'budget.summary.v1',
      source_brand_id: 'symply-budget',
      destination_brand_id: 'symply-house',
      purpose: 'Share budget summary',
    });
    expect(mockPrepare).toHaveBeenCalledWith(
      {
        package_id: 'budget.summary.v1',
        source_brand_id: 'symply-budget',
        destination_brand_id: 'symply-house',
        consent_id: 'consent-1',
        source_context_id: 'hh-budget',
        destination_context_id: 'hh-house',
      },
      'idem-key-0123456789ab'
    );
    expect(mockExportPackage).toHaveBeenCalledWith(
      {
        transfer_token: 'tok-1',
        source_household_id: 'hh-budget',
      },
      undefined
    );
    expect(mockImportPackage).toHaveBeenCalledWith(
      { envelope: 'env-1', destination_household_id: 'hh-house' },
      'idem-key-0123456789ab'
    );
    expect(result).toEqual({
      operationId: 'op-1',
      importStatus: 'imported',
      consentId: 'consent-1',
    });
  });

  it('passes client_payload for local-first budget.summary export', async () => {
    await runSoftTransfer({
      packageId: 'budget.summary.v1',
      sourceBrandId: 'symply-budget',
      destinationBrandId: 'symply-house',
      sourceHouseholdId: 'hh-budget',
      destinationHouseholdId: 'hh-house',
      clientPayload: {
        currency: 'CAD',
        monthTotal: 100,
        ytdTotal: 500,
        remaining: null,
        topCategories: [],
      },
      localFirstExport: true,
    });

    expect(mockExportPackage).toHaveBeenCalledWith(
      {
        transfer_token: 'tok-1',
        source_household_id: 'hh-budget',
        client_payload: {
          currency: 'CAD',
          monthTotal: 100,
          ytdTotal: 500,
          remaining: null,
          topCategories: [],
        },
      },
      { localFirst: true }
    );
  });

  it('reuses an active consent without grantConsent', async () => {
    mockListConsents.mockResolvedValue([
      {
        id: 'consent-existing',
        package_id: 'budget.summary.v1',
        source_brand_id: 'symply-budget',
        destination_brand_id: 'symply-house',
        status: 'active',
      },
    ]);

    await runSoftTransfer({
      packageId: 'budget.summary.v1',
      sourceBrandId: 'symply-budget',
      destinationBrandId: 'symply-house',
    });

    expect(mockGrantConsent).not.toHaveBeenCalled();
    expect(mockPrepare).toHaveBeenCalledWith(
      expect.objectContaining({ consent_id: 'consent-existing' }),
      expect.any(String)
    );
  });
});
