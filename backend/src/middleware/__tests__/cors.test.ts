import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { corsMiddleware } from '../cors';
import type { Env } from '../../types';

describe('browser authentication CORS', () => {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', corsMiddleware());
  app.post('/auth/login', (c) => c.json({ error: 'Invalid credentials' }, 401));

  for (const brand of ['house', 'budget']) {
    const origin = `https://symply-${brand}-web.pages.dev`;
    const env = {
      ENVIRONMENT: 'production',
      APP_URL: `https://simple-${brand}-api.a-tekhtelev.workers.dev`,
      WEB_APP_ORIGINS: origin,
    } as Env;

    it(`allows the full ${brand} browser login preflight`, async () => {
      const response = await app.request('/auth/login', {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'cache-control,content-type,pragma',
        },
      }, env);
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      const allowed = response.headers.get('Access-Control-Allow-Headers')!.toLowerCase().split(',');
      for (const header of ['cache-control', 'content-type', 'pragma']) expect(allowed).toContain(header);
    });

    it(`exposes ${brand} auth errors and denies untrusted origins`, async () => {
      const response = await app.request('/auth/login', { method: 'POST', headers: { Origin: origin } }, env);
      expect(response.status).toBe(401);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      const denied = await app.request('/auth/login', {
        method: 'OPTIONS', headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'POST' },
      }, env);
      expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  }
});
