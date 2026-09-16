/**
 * `healthFridgeApi` — the donor's "Smart Fridge" client (parity P2, P5).
 *
 * P5 added three capabilities the Fridge used to say it did not have: barcode
 * lookup, receipt scanning and meal ideas. This file proves each hits the
 * right route with the right timeout, and that the two AI paths keep the
 * `/ai/` segment that puts them behind the Health AI rate limiter — a
 * "tidied" `/health/fridge/receipt` would silently escape it.
 */

jest.mock('../client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

import { apiClient } from '../client';
import { AI_TIMEOUT_MS } from '../healthAi';
import { healthFridgeApi } from '../healthFridge';

const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;
const mockPut = apiClient.put as jest.Mock;
const mockDelete = apiClient.delete as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CRUD', () => {
  it('listFridge GETs /health/fridge, params optional', async () => {
    mockGet.mockResolvedValue({ data: { items: [] } });
    await healthFridgeApi.listFridge();
    expect(mockGet).toHaveBeenCalledWith('/health/fridge', { params: undefined });

    await healthFridgeApi.listFridge({ expiring_within_days: 3, today: '2026-07-26' });
    expect(mockGet).toHaveBeenCalledWith('/health/fridge', {
      params: { expiring_within_days: 3, today: '2026-07-26' },
    });
  });

  it('createFridgeItem POSTs the payload verbatim', async () => {
    mockPost.mockResolvedValue({ data: { item: {} } });
    const body = { name: 'Milk', quantity: 1, unit: 'carton' as const };
    await healthFridgeApi.createFridgeItem(body as never);
    expect(mockPost).toHaveBeenCalledWith('/health/fridge', body);
  });

  it('updateFridgeItem PUTs only the partial patch given', async () => {
    mockPut.mockResolvedValue({ data: { item: {} } });
    await healthFridgeApi.updateFridgeItem('item1', { is_favorite: true });
    expect(mockPut).toHaveBeenCalledWith('/health/fridge/item1', { is_favorite: true });
  });

  it('deleteFridgeItem DELETEs the item route and unwraps { deleted }', async () => {
    mockDelete.mockResolvedValue({ data: { deleted: true } });
    const result = await healthFridgeApi.deleteFridgeItem('item1');
    expect(mockDelete).toHaveBeenCalledWith('/health/fridge/item1');
    expect(result.deleted).toBe(true);
  });
});

describe('lookupBarcode', () => {
  it('GETs /health/foods/barcode with the code as a param, and returns the provider status AS SENT', async () => {
    const answer = {
      barcode: '0012345678905',
      food: null,
      provider: { id: 'fatsecret', configured: false, status: 'not_configured' as const },
    };
    mockGet.mockResolvedValue({ data: answer });

    const result = await healthFridgeApi.lookupBarcode('012345678905');

    expect(mockGet).toHaveBeenCalledWith('/health/foods/barcode', { params: { code: '012345678905' } });
    // The client passes the code through untouched — the Worker owns the
    // GTIN-13 padding, never the device.
    expect(result.provider.status).toBe('not_configured');
    expect(result.food).toBeNull();
  });
});

describe('scanFridgeReceipt', () => {
  it('POSTs to the /ai/ path (rate-limiter gate) with the AI timeout', async () => {
    mockPost.mockResolvedValue({ data: { draft: { vendor: null, purchase_date: null, items: [] } } });
    const images = [{ data: 'base64==' }];

    await healthFridgeApi.scanFridgeReceipt(images);

    expect(mockPost).toHaveBeenCalledWith(
      '/health/ai/fridge-receipt',
      { images },
      { timeout: AI_TIMEOUT_MS }
    );
  });
});

describe('fridgeMealIdeas', () => {
  it('POSTs to the /ai/ path with the AI timeout and sends NO inventory — the Worker reads the fridge itself', async () => {
    mockPost.mockResolvedValue({ data: { plan: { meals: [], notes: null, considered: [] } } });
    const body = { today: '2026-07-26', goal: 'high protein' };

    await healthFridgeApi.fridgeMealIdeas(body);

    expect(mockPost).toHaveBeenCalledWith('/health/ai/fridge-meals', body, { timeout: AI_TIMEOUT_MS });
    // The call site never attaches an `items`/`inventory` key.
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('items');
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('inventory');
  });
});
