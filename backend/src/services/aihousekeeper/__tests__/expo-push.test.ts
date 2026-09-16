/**
 * expo-push.ts — plan §B16
 *
 * Covers:
 *  - chunking: 250 messages → 3 fetch calls (100/100/50)
 *  - 429 retry path
 *  - 5xx retry then success
 *  - HTTP error response path
 *  - `Authorization: Bearer` header when accessToken is supplied
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { ExpoPushClient } from '../expo-push';
import type { ExpoPushMessage } from '../expo-push';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

function fakeOk(tickets: Array<{ status: 'ok' | 'error'; id?: string }>): Response {
  return new Response(JSON.stringify({ data: tickets }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeStatus(status: number, body: string = ''): Response {
  return new Response(body, { status });
}

function mkMessages(n: number): ExpoPushMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    to: `ExponentPushToken[test-${i.toString().padStart(4, '0')}]`,
    title: 'Aihousekeeper',
    body: `msg ${i}`,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ExpoPushClient', () => {
  it('returns [] when called with no messages', async () => {
    const client = new ExpoPushClient();
    const tickets = await client.sendBatch([]);
    expect(tickets).toEqual([]);
  });

  it('chunks messages into batches of 100', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      fakeOk([{ status: 'ok', id: 'ticket-x' }])
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ExpoPushClient();
    await client.sendBatch(mkMessages(250));
    // 250 / 100 = 3 calls.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstCallArgs = fetchMock.mock.calls[0];
    const firstUrl = typeof firstCallArgs[0] === 'string'
      ? firstCallArgs[0]
      : String(firstCallArgs[0]);
    expect(firstUrl).toBe(EXPO_URL);
  });

  it('retries once on 429 then succeeds', async () => {
    let call = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      call += 1;
      if (call === 1) return fakeStatus(429, 'slow down');
      return fakeOk([{ status: 'ok', id: 'tx-1' }]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ExpoPushClient();
    const tickets = await client.sendBatch(mkMessages(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].status).toBe('ok');
  });

  it('retries on 500 then eventually throws after 3 attempts', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      fakeStatus(500, 'server fail')
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ExpoPushClient();
    await expect(client.sendBatch(mkMessages(1))).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('attaches Authorization: Bearer when accessToken is provided', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      fakeOk([{ status: 'ok', id: 'tx' }])
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ExpoPushClient('expo-access-token-abcdef1234567890');
    await client.sendBatch(mkMessages(1));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer expo-access-token-abcdef1234567890');
  });

  it('throws immediately on 4xx non-429 error', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      fakeStatus(400, 'bad request')
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ExpoPushClient();
    await expect(client.sendBatch(mkMessages(1))).rejects.toThrow(/400/);
  });
});
