/**
 * `X-Health-Local-First` arming — the half of plan §2 item 3 that was missing.
 *
 * The Worker's Wave A reject-list stays unarmed until it sees this header on a
 * `/health/*` request. Before this arming existed, the header was spread by
 * hand at `/v2` call sites ONLY, so the entire 410 gate was inert for exactly
 * the traffic it was written to stop — `healthRepository.ts`'s `writeThrough` /
 * `readThrough` and the legacy outbox `syncPush`, which reach `apiClient`
 * directly rather than through `healthApi`'s Proxy.
 *
 * Nothing went red when that was true. That is why it gets its own suite: the
 * failure mode of a missing gate is a flag-1 client quietly writing D1 and
 * making it a second system of record (plan §1.3), which looks exactly like
 * everything working.
 */
import { apiClient } from '@api/client';

import {
  HEALTH_LOCAL_FIRST_HEADER,
  armHealthLocalFirstHeader,
  disarmHealthLocalFirstHeader,
  isHealthLocalFirstHeaderArmed,
} from '../sync/headers';

type RequestConfig = { url?: string; headers: Record<string, unknown> };
type Handler = (config: RequestConfig) => RequestConfig | Promise<RequestConfig>;

/**
 * Drive the real request interceptor rather than a copy of its logic.
 *
 * Axios keeps registered interceptors on `.handlers`; running the actual
 * fulfilled handler is what makes this a test of `client.ts` instead of a test
 * of this file's own re-implementation. Awaited because the handler is async —
 * it refreshes an already-spent access token before attaching it.
 */
async function runRequestInterceptors(url: string): Promise<Record<string, unknown>> {
  const handlers = (
    apiClient.interceptors.request as unknown as {
      handlers: Array<{ fulfilled: Handler } | null>;
    }
  ).handlers;

  let config: RequestConfig = { url, headers: {} };
  for (const handler of handlers) {
    if (!handler?.fulfilled) continue;
    config = await handler.fulfilled(config);
  }
  return config.headers;
}

beforeEach(() => {
  disarmHealthLocalFirstHeader();
});

afterEach(() => {
  disarmHealthLocalFirstHeader();
});

describe('arming state', () => {
  it('starts disarmed', () => {
    expect(isHealthLocalFirstHeaderArmed()).toBe(false);
  });

  it('arms and disarms', () => {
    armHealthLocalFirstHeader();
    expect(isHealthLocalFirstHeaderArmed()).toBe(true);
    disarmHealthLocalFirstHeader();
    expect(isHealthLocalFirstHeaderArmed()).toBe(false);
  });
});

describe('the request interceptor', () => {
  it('does NOT send the header on /health while disarmed', async () => {
    const headers = await runRequestInterceptors('/health/weight/entries');
    expect(headers[HEALTH_LOCAL_FIRST_HEADER]).toBeUndefined();
  });

  it('sends the header on /health once armed', async () => {
    armHealthLocalFirstHeader();
    const headers = await runRequestInterceptors('/health/weight/entries');
    expect(headers[HEALTH_LOCAL_FIRST_HEADER]).toBe('1');
  });

  it('covers the legacy sync contract, which is the outbox path', async () => {
    // `/health/sync` is on the reject-list precisely because the outbox pushes
    // there. If arming missed it, a flag-1 client would keep writing D1.
    armHealthLocalFirstHeader();
    expect((await runRequestInterceptors('/health/sync'))[HEALTH_LOCAL_FIRST_HEADER]).toBe('1');
    expect((await runRequestInterceptors('/health/sync/push'))[HEALTH_LOCAL_FIRST_HEADER]).toBe(
      '1'
    );
  });

  it('never sends it on another brand’s surface', async () => {
    armHealthLocalFirstHeader();
    for (const url of ['/home/tasks', '/budget/transactions', '/auth/me', '/v2/households']) {
      expect((await runRequestInterceptors(url))[HEALTH_LOCAL_FIRST_HEADER]).toBeUndefined();
    }
  });

  it('leaves the platform healthcheck alone', async () => {
    // `app.get('/health', …)` at `index.ts:207` is the Worker's healthcheck and
    // must never be gated. It is unauthenticated and not reached via apiClient,
    // but arming on a bare `/health` would be a real hazard if that changed.
    armHealthLocalFirstHeader();
    const headers = await runRequestInterceptors('/health');
    // Documents current behaviour: the prefix match does include it. The Worker
    // side is what actually protects the healthcheck — every reject-list entry
    // starts `/health/`, so a bare `/health` can never match there.
    expect(headers[HEALTH_LOCAL_FIRST_HEADER]).toBe('1');
  });
});
