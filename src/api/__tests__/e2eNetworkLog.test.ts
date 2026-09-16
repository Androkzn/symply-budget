import {
  clearE2ENetworkLog,
  findE2ENetworkEntry,
  getE2ENetworkLog,
  recordE2ENetworkEntry,
} from '../e2eNetworkLog';

describe('e2eNetworkLog', () => {
  beforeEach(() => {
    clearE2ENetworkLog();
  });

  it('records and strips query strings in __DEV__', () => {
    recordE2ENetworkEntry({
      method: 'post',
      url: '/households/h1/budget/items?foo=1',
      status: 201,
      ok: true,
    });
    const log = getE2ENetworkLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.url).toBe('/households/h1/budget/items');
    expect(log[0]?.method).toBe('POST');
    expect(log[0]?.ok).toBe(true);
  });

  it('finds the latest matching entry', () => {
    recordE2ENetworkEntry({ method: 'get', url: '/a', status: 200, ok: true });
    recordE2ENetworkEntry({ method: 'post', url: '/b', status: 500, ok: false });
    const hit = findE2ENetworkEntry((e) => e.url === '/b');
    expect(hit?.status).toBe(500);
    expect(hit?.ok).toBe(false);
  });
});
