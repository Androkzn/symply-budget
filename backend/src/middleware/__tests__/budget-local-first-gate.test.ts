import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import {
  rejectFinancialWritesForLocalFirst,
  rejectFinancialWritesForLocalFirstEarly,
} from '../budget-local-first-gate';

describe('rejectFinancialWritesForLocalFirst', () => {
  it('returns 410 when local-first header is set', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('/budget/*', rejectFinancialWritesForLocalFirst());
    app.get('/budget/items', (c) => c.json({ ok: true }));

    const blocked = await app.request('/budget/items', {
      headers: { 'X-Budget-Local-First': '1' },
    });
    expect(blocked.status).toBe(410);
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe('local_first_enabled');

    const allowed = await app.request('/budget/items');
    expect(allowed.status).toBe(200);
  });

  it('early gate returns 410 before households auth', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', rejectFinancialWritesForLocalFirstEarly());
    app.use('*', async (c) =>
      c.json(
        { error: { code: 'unauthorized', message: 'Missing or invalid authorization header' } },
        401,
      ),
    );

    const blocked = await app.request('/households/hh1/budget/items', {
      headers: { 'X-Budget-Local-First': '1' },
    });
    expect(blocked.status).toBe(410);

    const viaQuery = await app.request('/households/hh1/savings/accounts?local_first=1');
    expect(viaQuery.status).toBe(410);
  });
});
