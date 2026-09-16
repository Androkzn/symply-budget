/**
 * Rate lookup: cache, TTL, and — the point of the module — what happens when
 * the network is not there.
 *
 * A member with a receipt from an airport is the case this is written for, so
 * "offline" must degrade to a usable answer rather than to an error.
 */
import { FX_CACHE_KEY, FX_CACHE_TTL_MS, getExchangeRate } from '@services/exchangeRates';
import { storageHelpers } from '@services/storage';

const okResponse = (rate: number, date = '2026-09-04') => ({
  ok: true,
  json: async () => ({ amount: 1, base: 'USD', date, rates: { CAD: rate } }),
});

describe('getExchangeRate', () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    await storageHelpers.setObject(FX_CACHE_KEY, {});
  });

  it('is 1 for a pair that is the same currency, without a lookup', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as never);
    await expect(getExchangeRate('CAD', 'CAD')).resolves.toMatchObject({ rate: 1 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches a pair and reports the reference date it was published for', async () => {
    jest.spyOn(global, 'fetch' as never).mockResolvedValue(okResponse(1.3712) as never);
    await expect(getExchangeRate('USD', 'CAD')).resolves.toMatchObject({
      from: 'USD',
      to: 'CAD',
      rate: 1.3712,
      asOf: '2026-09-04',
    });
  });

  it('serves a fresh cache hit without going back to the network', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch' as never)
      .mockResolvedValue(okResponse(1.3712) as never);
    await getExchangeRate('USD', 'CAD');
    await getExchangeRate('USD', 'CAD');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the cached rate is older than the TTL', async () => {
    await storageHelpers.setObject(FX_CACHE_KEY, {
      'USD>CAD': { rate: 1.2, asOf: '2026-01-01', fetchedAt: Date.now() - FX_CACHE_TTL_MS - 1 },
    });
    jest.spyOn(global, 'fetch' as never).mockResolvedValue(okResponse(1.3712) as never);
    await expect(getExchangeRate('USD', 'CAD')).resolves.toMatchObject({ rate: 1.3712 });
  });

  it('falls back to a STALE cached rate when the network is gone', async () => {
    // Yesterday's ECB rate beats an empty box on a plane, and the caption on
    // screen shows its date so the member can judge it.
    await storageHelpers.setObject(FX_CACHE_KEY, {
      'USD>CAD': { rate: 1.2, asOf: '2026-01-01', fetchedAt: Date.now() - FX_CACHE_TTL_MS - 1 },
    });
    jest.spyOn(global, 'fetch' as never).mockRejectedValue(new Error('offline') as never);
    await expect(getExchangeRate('USD', 'CAD')).resolves.toMatchObject({
      rate: 1.2,
      asOf: '2026-01-01',
    });
  });

  it('returns null when there is no network and nothing cached', async () => {
    jest.spyOn(global, 'fetch' as never).mockRejectedValue(new Error('offline') as never);
    await expect(getExchangeRate('USD', 'CAD')).resolves.toBeNull();
  });

  it('returns null rather than a garbage rate when the provider misbehaves', async () => {
    jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({ date: '2026-09-04', rates: { CAD: 0 } }),
    } as never);
    await expect(getExchangeRate('USD', 'CAD')).resolves.toBeNull();
  });

  it('returns null on a non-OK response', async () => {
    jest.spyOn(global, 'fetch' as never).mockResolvedValue({ ok: false } as never);
    await expect(getExchangeRate('USD', 'CAD')).resolves.toBeNull();
  });
});
