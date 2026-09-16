import { describe, expect, it } from 'vitest';

/**
 * The Symply Health tracking domain is mounted at `/health`, and every Worker
 * also answers the platform monitoring healthcheck at exactly `/health`.
 *
 * Hono resolves the exact-path `app.get('/health')` before the `/health` router
 * mount, so both coexist — but ONLY while the healthcheck is registered first.
 * Reordering those two lines would silently turn the monitoring endpoint into a
 * 401 and every uptime check would start failing.
 *
 * This test pins the ordering at the source level so a reorder fails here
 * rather than in production.
 */
describe('health route precedence', () => {
  it('registers the /health healthcheck BEFORE the /health domain mount', async () => {
    const source = await import('../index.ts?raw').then((m) => m.default as string);

    const healthcheck = source.indexOf("app.get('/health'");
    const domainMount = source.indexOf("app.route('/health', healthRoutes)");

    expect(healthcheck).toBeGreaterThan(-1);
    expect(domainMount).toBeGreaterThan(-1);
    // Strictly before — equal or after means the healthcheck is shadowed.
    expect(healthcheck).toBeLessThan(domainMount);
  });

  it('registers the P4 social kill switch BEFORE any /health mount', async () => {
    /**
     * Hono applies a mounted router's `use('/*')` middleware to every path under
     * the shared prefix. `routes/health.ts` mounts first at `/health` and
     * registers `authMiddleware()`, so the social router's OWN flag check ran
     * second — an unauthenticated probe of a DISABLED surface returned 401
     * instead of 404, confirming the path exists to anyone who asked.
     *
     * It shipped green because the social route tests mount that router
     * STANDALONE, where the shared auth middleware does not exist. Only a probe
     * against the deployed Worker showed it. This asserts the composed order
     * that the isolated tests cannot see.
     */
    const source = await import('../index.ts?raw').then((m) => m.default as string);

    const flagGate = source.indexOf("app.use('/health/social/*', requireHealthSocialFlag())");
    const firstHealthMount = source.indexOf("app.route('/health', healthRoutes)");

    expect(flagGate).toBeGreaterThan(-1);
    expect(firstHealthMount).toBeGreaterThan(-1);
    // Strictly before: equal or after means auth wins and the 401 leak returns.
    expect(flagGate).toBeLessThan(firstHealthMount);
  });
});
