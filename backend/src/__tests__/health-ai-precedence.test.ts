import { describe, expect, it } from 'vitest';

/**
 * Composed-app assertions for the Symply Health P3 AI surface.
 *
 * `src/routes/__tests__/health-ai.test.ts` mounts the router STANDALONE, which
 * is the same isolation that hid the P4 social 401 leak until someone probed the
 * deployed Worker. Anything that is a property of the ORDER things are
 * registered in — and rate limiting is exactly that — cannot be seen from there,
 * so it is pinned here at source level instead.
 *
 * > Rule (PARITY_PLAN §5b): middleware order is a property of the COMPOSED app.
 * > A router tested in isolation cannot prove it.
 */
describe('Symply Health AI route precedence', () => {
  it('HEALTH-AI-190: rate-limits /health/ai/* BEFORE the first /health mount', async () => {
    /**
     * Hono applies a mounted router's `use('/*')` to every path under the shared
     * prefix. `routes/health.ts` mounts first at `/health` and registers
     * `authMiddleware()`, so a rate limiter declared INSIDE `routes/health-ai.ts`
     * would run after it — every unauthenticated probe would still pay for the
     * auth path, and, more importantly, a bucket declared later cannot be relied
     * on to be the first decision on a surface where every request costs model
     * tokens.
     */
    const source = await import('../index.ts?raw').then((m) => m.default as string);

    const limiter = source.indexOf("app.use('/health/ai/*', rateLimitDO('health:ai'))");
    const firstHealthMount = source.indexOf("app.route('/health', healthRoutes)");

    expect(limiter).toBeGreaterThan(-1);
    expect(firstHealthMount).toBeGreaterThan(-1);
    expect(limiter).toBeLessThan(firstHealthMount);
  });

  it('HEALTH-AI-191: the AI router is actually mounted at /health', async () => {
    // A router that exists, is tested, and is never mounted is the quietest
    // possible way to ship nothing.
    const source = await import('../index.ts?raw').then((m) => m.default as string);
    expect(source).toContain("app.route('/health', healthAiRoutes)");
    expect(source).toContain("import healthAiRoutes from './routes/health-ai'");
  });

  it('HEALTH-AI-192: `health:ai` is a DO-backed bucket, not the in-memory map', async () => {
    /**
     * `AI_RATE_LIMIT_ACTIONS` is what routes an action to the RATE_LIMITER
     * Durable Object. An AI action missing from that set silently falls back to
     * a per-isolate `Map`, which means the ceiling is per-Worker-instance and
     * effectively unenforced — the exact defect the donor shipped (its 100/hr AI
     * limit lives in a module-level Map).
     */
    const source = await import('../middleware/rate-limit.ts?raw').then(
      (m) => m.default as string
    );
    const actionsBlock = source.slice(
      source.indexOf('AI_RATE_LIMIT_ACTIONS'),
      source.indexOf('AI_RATE_LIMIT_ACTIONS') + 400
    );
    expect(actionsBlock).toContain("'health:ai'");
    expect(source).toContain("'health:ai': { windowMs:");
  });
});
