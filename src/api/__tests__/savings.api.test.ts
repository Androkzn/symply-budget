/**
 * Savings API layer — overview / income / spending / goals / import.
 *
 * Mocks the axios client so every test is pure logic — no network, no auth
 * store, no native modules. Asserts that each helper builds the right URL,
 * passes the right params/payload, and unwraps the response correctly.
 */

jest.mock('../client', () => ({
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

import { api, apiClient } from '../client';
import { savingsApi } from '../savings';

const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;
const mockPatch = apiClient.patch as jest.Mock;
const mockDelete = apiClient.delete as jest.Mock;
const mockUpload = (api as unknown as { upload: jest.Mock }).upload;

const HID = 'hh_test_01';
const base = `/households/${HID}/savings`;

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── overview & trend ─────────────────────────────────────────────────────────

describe('savingsApi.getOverview', () => {
  it('GETs /savings/overview with year + month params and unwraps data', async () => {
    const overview = { year: 2026, month: 7, netSavings: 1234 };
    mockGet.mockResolvedValueOnce({ data: overview });
    const result = await savingsApi.getOverview(HID, 2026, 7);
    expect(mockGet).toHaveBeenCalledWith(`${base}/overview`, {
      params: { year: 2026, month: 7 },
    });
    expect(result).toEqual(overview);
  });
});

describe('savingsApi.getTrend', () => {
  it('GETs /savings/trend with default 6-month window', async () => {
    mockGet.mockResolvedValueOnce({ data: { months: [] } });
    await savingsApi.getTrend(HID, 2026, 7);
    expect(mockGet).toHaveBeenCalledWith(`${base}/trend`, {
      params: { year: 2026, month: 7, months: 6 },
    });
  });

  it('respects a custom months param', async () => {
    mockGet.mockResolvedValueOnce({ data: { months: [] } });
    await savingsApi.getTrend(HID, 2026, 7, 12);
    expect(mockGet).toHaveBeenCalledWith(`${base}/trend`, {
      params: { year: 2026, month: 7, months: 12 },
    });
  });
});

// ─── income ───────────────────────────────────────────────────────────────────

describe('savingsApi.listIncome', () => {
  it('GETs /savings/income with year + month params', async () => {
    mockGet.mockResolvedValueOnce({ data: { entries: [] } });
    const result = await savingsApi.listIncome(HID, 2026, 7);
    expect(mockGet).toHaveBeenCalledWith(`${base}/income`, {
      params: { year: 2026, month: 7 },
    });
    expect(result.entries).toEqual([]);
  });
});

describe('savingsApi.createIncome', () => {
  it('POSTs to /savings/income with the body incl. client-generated id', async () => {
    const body = {
      id: 'inc_client_uuid',
      source_type: 'payroll' as const,
      label: 'July paycheck',
      amount_cents: 500000,
      income_date: '2026-07-15',
    };
    mockPost.mockResolvedValueOnce({ data: { entry: { ...body, household_id: HID } } });
    const result = await savingsApi.createIncome(HID, body);
    expect(mockPost).toHaveBeenCalledWith(`${base}/income`, body);
    const payload = mockPost.mock.calls[0][1] as { id: string; amount_cents: number };
    expect(payload.id).toBe('inc_client_uuid');
    expect(payload.amount_cents).toBe(500000);
    expect(result.entry.id).toBe('inc_client_uuid');
  });
});

describe('savingsApi.updateIncome / deleteIncome', () => {
  it('PATCHes /savings/income/:id with the update body', async () => {
    mockPatch.mockResolvedValueOnce({ data: { entry: { id: 'inc_1', label: 'Renamed' } } });
    await savingsApi.updateIncome(HID, 'inc_1', { label: 'Renamed' });
    expect(mockPatch).toHaveBeenCalledWith(`${base}/income/inc_1`, { label: 'Renamed' });
  });

  it('DELETEs /savings/income/:id', async () => {
    mockDelete.mockResolvedValueOnce({});
    await savingsApi.deleteIncome(HID, 'inc_1');
    expect(mockDelete).toHaveBeenCalledWith(`${base}/income/inc_1`);
  });
});

// ─── spending ─────────────────────────────────────────────────────────────────

describe('savingsApi.createSpending', () => {
  it('POSTs to /savings/spending with the body incl. client id', async () => {
    const body = {
      id: 'sp_client_uuid',
      label: 'Groceries',
      amount_cents: 8500,
      spending_date: '2026-07-10',
    };
    mockPost.mockResolvedValueOnce({ data: { entry: { ...body, household_id: HID } } });
    await savingsApi.createSpending(HID, body);
    expect(mockPost).toHaveBeenCalledWith(`${base}/spending`, body);
    expect((mockPost.mock.calls[0][1] as { id: string }).id).toBe('sp_client_uuid');
  });
});

// ─── goals ────────────────────────────────────────────────────────────────────

describe('savingsApi.createGoal', () => {
  it('POSTs to /savings/goals with the body incl. client id', async () => {
    const body = {
      id: 'goal_client_uuid',
      type: 'custom' as const,
      name: 'Vacation',
      target_amount_cents: 300000,
    };
    mockPost.mockResolvedValueOnce({ data: { goal: { ...body, household_id: HID } } });
    await savingsApi.createGoal(HID, body);
    expect(mockPost).toHaveBeenCalledWith(`${base}/goals`, body);
  });
});

describe('savingsApi.getEmergencyFundSuggestion', () => {
  it('GETs the emergency-fund suggestion with a months param', async () => {
    mockGet.mockResolvedValueOnce({ data: { suggestedTarget: 0, essentialMonthlySpending: 0, months: 6 } });
    await savingsApi.getEmergencyFundSuggestion(HID, 6);
    expect(mockGet).toHaveBeenCalledWith(`${base}/goals/emergency-fund/suggestion`, {
      params: { months: 6 },
    });
  });
});

// ─── AI import ────────────────────────────────────────────────────────────────

describe('savingsApi.importCommit', () => {
  it('POSTs selections to /savings/import/:jobId/commit', async () => {
    const selections = { income: [], spending: [], recurringPayments: [] };
    mockPost.mockResolvedValueOnce({
      data: { income: 0, spending: 0, recurringPayments: 0 },
    });
    const result = await savingsApi.importCommit(HID, 'job_1', selections);
    expect(mockPost).toHaveBeenCalledWith(`${base}/import/job_1/commit`, { selections });
    expect(result).toEqual({ income: 0, spending: 0, recurringPayments: 0 });
  });
});

describe('savingsApi.importAnalyzeWithFile', () => {
  it('uploads FormData to /savings/import via api.upload', async () => {
    mockUpload.mockResolvedValueOnce({ jobId: 'job_2', draft: null });
    await savingsApi.importAnalyzeWithFile(
      HID,
      { uri: 'file:///doc.pdf', type: 'application/pdf', name: 'doc.pdf' },
      'statement'
    );
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0][0]).toBe(`${base}/import`);
    expect(mockUpload.mock.calls[0][1]).toBeInstanceOf(FormData);
  });
});
