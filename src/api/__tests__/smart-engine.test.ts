/**
 * smart-engine API client — list/grant/revoke consents and prepare/export/import.
 */
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();

jest.mock('../client', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

import { createIdempotencyKey, smartEngineApi } from '../smart-engine';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createIdempotencyKey', () => {
  it('returns a hex string at least 16 characters', () => {
    const key = createIdempotencyKey();
    expect(key.length).toBeGreaterThanOrEqual(16);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });
});

describe('smartEngineApi.listPackages', () => {
  it('GETs /smart-engine/packages and returns data', async () => {
    const packages = [{ package_id: 'profile.core.v1' }];
    mockGet.mockResolvedValue({ data: packages });

    const result = await smartEngineApi.listPackages();

    expect(mockGet).toHaveBeenCalledWith('/smart-engine/packages');
    expect(result).toEqual(packages);
  });
});

describe('smartEngineApi.listConsents', () => {
  it('GETs /smart-engine/consents and returns data', async () => {
    const consents = [{ id: 'c1', status: 'active' }];
    mockGet.mockResolvedValue({ data: consents });

    const result = await smartEngineApi.listConsents();

    expect(mockGet).toHaveBeenCalledWith('/smart-engine/consents');
    expect(result).toEqual(consents);
  });
});

describe('smartEngineApi.grantConsent', () => {
  it('POSTs consent body to /smart-engine/consents', async () => {
    const consent = { id: 'c1', package_id: 'profile.core.v1' };
    mockPost.mockResolvedValue({ data: consent });

    const result = await smartEngineApi.grantConsent({
      package_id: 'profile.core.v1',
      source_brand_id: 'symply-house',
      destination_brand_id: 'symply-budget',
      purpose: 'Test',
    });

    expect(mockPost).toHaveBeenCalledWith('/smart-engine/consents', {
      package_id: 'profile.core.v1',
      source_brand_id: 'symply-house',
      destination_brand_id: 'symply-budget',
      purpose: 'Test',
    });
    expect(result).toEqual(consent);
  });
});

describe('smartEngineApi.revokeConsent', () => {
  it('DELETEs /smart-engine/consents/:id', async () => {
    mockDelete.mockResolvedValue({ data: { id: 'c1', status: 'revoked' } });

    await smartEngineApi.revokeConsent('c1');

    expect(mockDelete).toHaveBeenCalledWith('/smart-engine/consents/c1');
  });
});

describe('smartEngineApi.prepare', () => {
  it('POSTs prepare body with Idempotency-Key header', async () => {
    const prepared = {
      operation_id: 'op1',
      transfer_token: 'tok',
      expires_at: '2026-01-01T00:00:00Z',
      consent_id: 'c1',
    };
    mockPost.mockResolvedValue({ data: prepared });

    const body = {
      package_id: 'house.property.v1' as const,
      source_brand_id: 'symply-house',
      destination_brand_id: 'symply-budget',
      consent_id: 'c1',
      source_context_id: 'hh-house',
      destination_context_id: 'hh-budget',
    };

    const result = await smartEngineApi.prepare(body, 'abcd1234efgh5678');

    expect(mockPost).toHaveBeenCalledWith('/smart-engine/prepare', body, {
      headers: { 'Idempotency-Key': 'abcd1234efgh5678' },
    });
    expect(result).toEqual(prepared);
  });
});

describe('smartEngineApi.exportPackage', () => {
  it('POSTs export body to /smart-engine/export', async () => {
    const exported = { envelope: 'env', operation_id: 'op1' };
    mockPost.mockResolvedValue({ data: exported });

    const result = await smartEngineApi.exportPackage({
      transfer_token: 'tok',
      source_household_id: 'hh1',
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/smart-engine/export',
      {
        transfer_token: 'tok',
        source_household_id: 'hh1',
      },
      undefined
    );
    expect(result).toEqual(exported);
  });

  it('POSTs client_payload with local-first header when requested', async () => {
    mockPost.mockResolvedValue({ data: { envelope: 'env', operation_id: 'op1' } });

    await smartEngineApi.exportPackage(
      {
        transfer_token: 'tok',
        source_household_id: 'hh1',
        client_payload: { currency: 'CAD', monthTotal: 1, ytdTotal: 2 },
      },
      { localFirst: true }
    );

    expect(mockPost).toHaveBeenCalledWith(
      '/smart-engine/export',
      {
        transfer_token: 'tok',
        source_household_id: 'hh1',
        client_payload: { currency: 'CAD', monthTotal: 1, ytdTotal: 2 },
      },
      { headers: { 'X-Budget-Local-First': '1' } }
    );
  });
});

describe('smartEngineApi.importPackage', () => {
  it('POSTs import body with Idempotency-Key header', async () => {
    const imported = { status: 'imported', operation_id: 'op1' };
    mockPost.mockResolvedValue({ data: imported });

    const result = await smartEngineApi.importPackage(
      { envelope: 'env', destination_household_id: 'hh2' },
      'import-key-16chars'
    );

    expect(mockPost).toHaveBeenCalledWith(
      '/smart-engine/import',
      { envelope: 'env', destination_household_id: 'hh2' },
      { headers: { 'Idempotency-Key': 'import-key-16chars' } }
    );
    expect(result).toEqual(imported);
  });
});
