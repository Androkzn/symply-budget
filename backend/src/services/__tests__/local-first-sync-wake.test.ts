import { describe, expect, it, vi, afterEach } from 'vitest';

import type { Env } from '../../types';
import {
  BUDGET_SYNC_WAKE_TYPE,
  HOUSE_SYNC_WAKE_TYPE,
  PROHIBITED_WAKE_PAYLOAD_KEYS,
  buildBudgetSyncWakePayload,
  buildHouseSyncWakePayload,
  validateOpaqueWakePayload,
  LocalFirstSyncWakeService,
} from '../local-first-sync-wake-service';

describe('buildBudgetSyncWakePayload', () => {
  it('returns only type and householdId', () => {
    const payload = buildBudgetSyncWakePayload('hh_test_123');
    expect(payload).toEqual({
      type: BUDGET_SYNC_WAKE_TYPE,
      householdId: 'hh_test_123',
    });
    expect(Object.keys(payload).sort()).toEqual(['householdId', 'type']);
  });
});

describe('buildHouseSyncWakePayload', () => {
  it('returns only type and householdId', () => {
    const payload = buildHouseSyncWakePayload('hh_test_123');
    expect(payload).toEqual({
      type: HOUSE_SYNC_WAKE_TYPE,
      householdId: 'hh_test_123',
    });
  });
});

describe('validateOpaqueWakePayload', () => {
  it('accepts house_sync_wake when allowed', () => {
    expect(() =>
      validateOpaqueWakePayload(buildHouseSyncWakePayload('hh_abc'), [HOUSE_SYNC_WAKE_TYPE]),
    ).not.toThrow();
  });

  it('accepts canonical opaque wake shape', () => {
    expect(() =>
      validateOpaqueWakePayload(buildBudgetSyncWakePayload('hh_abc')),
    ).not.toThrow();
  });

  it('rejects extra keys including financial fields', () => {
    for (const prohibited of PROHIBITED_WAKE_PAYLOAD_KEYS) {
      expect(() =>
        validateOpaqueWakePayload({
          type: BUDGET_SYNC_WAKE_TYPE,
          householdId: 'hh_1',
          [prohibited]: 'leak',
        }),
      ).toThrow(/prohibited_wake_field/);
    }
  });

  it('rejects unknown extra keys', () => {
    expect(() =>
      validateOpaqueWakePayload({
        type: BUDGET_SYNC_WAKE_TYPE,
        householdId: 'hh_1',
        peer_id: 'device_b',
      }),
    ).toThrow(/prohibited_wake_field:peer_id/);
  });

  it('rejects wrong type', () => {
    expect(() =>
      validateOpaqueWakePayload({ type: 'task_reminder', householdId: 'hh_1' }),
    ).toThrow(/invalid_wake_type/);
  });

  it('rejects empty householdId', () => {
    expect(() =>
      validateOpaqueWakePayload({ type: BUDGET_SYNC_WAKE_TYPE, householdId: '' }),
    ).toThrow(/invalid_household_id/);
  });
});

describe('LocalFirstSyncWakeService.sendSyncWake', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends expo messages whose data contains only type and householdId', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const env = {
      EXPO_ACCESS_TOKEN: 'expo-test-token',
      DB: {
        prepare: (_sql: string) => ({
          bind: () => ({
            all: async () => {
              if (_sql.includes('expo_push_token')) {
                return {
                  results: [
                    {
                      id: 'dev_peer',
                      expo_push_token: 'ExponentPushToken[peer-token]',
                    },
                  ],
                };
              }
              return { results: [] };
            },
            first: async () => null,
            run: async () => ({ success: true }),
          }),
        }),
      },
    } as unknown as Env;

    const service = new LocalFirstSyncWakeService(env);
    const result = await service.sendSyncWake({
      householdId: 'hh_wake',
      excludeDeviceId: 'dev_sender',
      excludeUserId: 'user_sender',
    });

    expect(result).toEqual({ attempted: 1, sent: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Array<{
      data: Record<string, string>;
      to: string;
    }>;
    expect(body[0]?.to).toBe('ExponentPushToken[peer-token]');
    expect(body[0]?.data).toEqual({
      type: BUDGET_SYNC_WAKE_TYPE,
      householdId: 'hh_wake',
    });
    validateOpaqueWakePayload(body[0]!.data, [BUDGET_SYNC_WAKE_TYPE]);
  });

  it('can emit house_sync_wake when requested', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const env = {
      EXPO_ACCESS_TOKEN: 'expo-test-token',
      DB: {
        prepare: (_sql: string) => ({
          bind: () => ({
            all: async () => ({
              results: [
                {
                  id: 'dev_peer',
                  expo_push_token: 'ExponentPushToken[peer-token]',
                },
              ],
            }),
            first: async () => null,
            run: async () => ({ success: true }),
          }),
        }),
      },
    } as unknown as Env;

    const service = new LocalFirstSyncWakeService(env);
    await service.sendSyncWake({
      householdId: 'hh_wake',
      wakeType: HOUSE_SYNC_WAKE_TYPE,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Array<{
      data: Record<string, string>;
    }>;
    expect(body[0]?.data.type).toBe(HOUSE_SYNC_WAKE_TYPE);
  });
});
