import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import {
  isHomeDomainLocalFirstPath,
  rejectHomeWritesForLocalFirstEarly,
} from '../house-local-first-gate';

function mkEnv(brand: string): Env {
  return { APP_BRAND: brand } as unknown as Env;
}

describe('isHomeDomainLocalFirstPath', () => {
  it('matches Tier-A paths and excludes Tier B/C surfaces', () => {
    expect(isHomeDomainLocalFirstPath('/households/hh_1/tasks')).toBe(true);
    expect(isHomeDomainLocalFirstPath('/households/hh_1/tasks/abc')).toBe(true);
    expect(isHomeDomainLocalFirstPath('/households/hh_1/reports')).toBe(false);
    expect(isHomeDomainLocalFirstPath('/households/hh_1/chat')).toBe(false);
    expect(isHomeDomainLocalFirstPath('/households/hh_1/chat-rooms')).toBe(false);
    expect(isHomeDomainLocalFirstPath('/households/hh_1/home-budget')).toBe(false);
    expect(isHomeDomainLocalFirstPath('/municipalities')).toBe(false);
  });
});

describe('rejectHomeWritesForLocalFirstEarly', () => {
  it('returns 410 for local-first clients on Tier-A paths', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', rejectHomeWritesForLocalFirstEarly());
    app.post('/households/:householdId/tasks', (c) => c.json({ ok: true }));

    const res = await app.request(
      'http://x/households/hh_1/tasks',
      { method: 'POST', headers: { 'X-House-Local-First': '1' } },
      mkEnv('symply-house'),
    );
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      error: {
        code: 'local_first_enabled',
        message:
          'House domain API is disabled for local-first clients. Use the on-device ledger and /v2 control-plane routes.',
      },
    });
  });

  it('passes through when the header is absent', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', rejectHomeWritesForLocalFirstEarly());
    app.post('/households/:householdId/tasks', (c) => c.json({ ok: true }));

    const res = await app.request(
      'http://x/households/hh_1/tasks',
      { method: 'POST' },
      mkEnv('symply-house'),
    );
    expect(res.status).toBe(200);
  });
});
