/**
 * Utilities API layer — property tax methods (upload/extract, create, update,
 * list). Mocks the axios client so every test is pure logic — no network, no
 * auth store, no native modules. Asserts each helper builds the right URL,
 * passes the right payload, and unwraps the response correctly.
 */

jest.mock('@api/client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
  api: {
    upload: jest.fn(),
  },
}));

import { api, apiClient } from '@api/client';

import { utilitiesApi } from '../utilities';

const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;
const mockPatch = apiClient.patch as jest.Mock;
const mockUpload = (api as unknown as { upload: jest.Mock }).upload;

const HID = 'hh_test_01';
const base = `/households/${HID}/utilities`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('utilitiesApi.uploadAndExtractPropertyTax', () => {
  it('POSTs a FormData file to /property-taxes/upload via api.upload', async () => {
    mockUpload.mockResolvedValueOnce({ success: true, suggestedTax: { taxYear: 2026 } });
    const result = await utilitiesApi.uploadAndExtractPropertyTax(HID, {
      uri: 'file:///notice.pdf',
      type: 'application/pdf',
      name: 'notice.pdf',
    });
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0][0]).toBe(`${base}/property-taxes/upload`);
    expect(mockUpload.mock.calls[0][1]).toBeInstanceOf(FormData);
    expect(result.success).toBe(true);
  });
});

describe('utilitiesApi.createPropertyTax', () => {
  it('POSTs the create request (incl. paid date + municipality) and unwraps data', async () => {
    const request = {
      taxYear: 2026,
      assessedValue: 118100000,
      taxAmount: 505334,
      mainPaymentAmount: 505334,
      mainPaymentDueDate: '2026-07-02',
      homeownerGrantEligible: true,
      homeownerGrantAmount: 57000,
      mainPaymentPaidDate: '2026-07-06',
      municipalityName: 'City of Surrey',
    };
    mockPost.mockResolvedValueOnce({ data: { id: 'pt_1', ...request } });
    const result = await utilitiesApi.createPropertyTax(HID, request);
    expect(mockPost).toHaveBeenCalledWith(`${base}/property-taxes`, request);
    expect(result.id).toBe('pt_1');
  });
});

describe('utilitiesApi.updatePropertyTax', () => {
  it('PATCHes /property-taxes/:id with the update body (mark paid)', async () => {
    mockPatch.mockResolvedValueOnce({ data: { id: 'pt_1', main_payment_task_id: null } });
    await utilitiesApi.updatePropertyTax(HID, 'pt_1', { mainPaymentPaidDate: '2026-07-01' });
    expect(mockPatch).toHaveBeenCalledWith(`${base}/property-taxes/pt_1`, {
      mainPaymentPaidDate: '2026-07-01',
    });
  });
});

describe('utilitiesApi.getPropertyTaxes', () => {
  it('GETs /property-taxes and unwraps the array', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'pt_1', tax_year: 2026 }] });
    const result = await utilitiesApi.getPropertyTaxes(HID);
    expect(mockGet).toHaveBeenCalledWith(`${base}/property-taxes`);
    expect(result).toHaveLength(1);
    expect(result[0].tax_year).toBe(2026);
  });
});
