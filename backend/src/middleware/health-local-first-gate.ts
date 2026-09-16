import type { Context, Next } from 'hono';

import type { Env } from '../types';

/**
 * Symply Health V2 local-first 410 gate — a **reject-list**, not a broad gate.
 *
 * When a Health V2 local-first client identifies itself, reject the Wave A
 * surfaces (the 8 ledgered D1 tables) plus the legacy sync contract so D1 cannot
 * become a second system of record. Everything else — Tier B / Wave C / Tier D
 * surfaces — falls through completely untouched.
 *
 * Signal (either):
 * - Header: `X-Health-Local-First: 1`
 * - Query: `local_first=1` (fallback if intermediaries strip custom headers,
 *   same spelling as the Budget sibling)
 *
 * See `documents/requirements/Health v2/health-local-first-implementation-plan.md`
 * §2 item 3 (reject-list + method gate + registration slot) and item 10
 * (instrumentation), and `middleware/house-local-first-gate.ts` for the pattern
 * this mirrors.
 */
export function isHealthLocalFirstClient(c: Context): boolean {
  const flag = c.req.header('X-Health-Local-First') ?? c.req.header('x-health-local-first');
  if (flag === '1' || flag === 'true') return true;
  const q = c.req.query('local_first');
  return q === '1' || q === 'true';
}

/**
 * Wave A path prefixes that local-first clients must not touch via legacy REST.
 *
 * Locked against the eight Wave A tables (plan §1.5) and verified against the
 * live routers, NOT copied from the plan's prose:
 *
 * | prefix                  | Wave A table(s)                  | router                    |
 * |-------------------------|----------------------------------|---------------------------|
 * | `/health/weight`        | `weight_entries`                 | `routes/health.ts:61-143` |
 * | `/health/water`         | `water_entries`                  | `routes/health.ts:146-225`|
 * | `/health/nutrition`     | `nutrition_entries`              | `routes/health.ts:227-428`|
 * | `/health/entries`       | `health_entries`                 | `routes/health.ts:509-686`|
 * | `/health/measurements`  | `body_measurements`              | `routes/health.ts:430-507`|
 * | `/health/habits`        | `user_habits` + `habit_logs`     | `routes/health.ts:811-872`|
 * | `/health/goals`         | `health_goals`                   | `routes/health.ts:688-809`|
 * | `/health/sync`          | the delta pull/push over all 8   | `routes/health.ts:1139+`  |
 *
 * ⚠️ The plan writes the last one as `/health/sync/*`. The real router exposes
 * `GET /health/sync` (delta PULL) at the BARE path and only `POST
 * /health/sync/push` below it — a `/*`-shaped match would let the pull, i.e. the
 * single largest D1 read in the app, through. Matching is therefore
 * "exact prefix OR prefix + `/`", which covers both spellings the plan uses
 * (`/health/entries*` and `/health/weight/*`) with one rule.
 *
 * ⚠️ Every entry starts with `/health/`, so the platform healthcheck
 * `app.get('/health', …)` (`index.ts:207`) can never match. Do not add a bare
 * `/health` entry.
 */
const HEALTH_WAVE_A_REJECT_PREFIXES = [
  '/health/weight',
  '/health/water',
  '/health/nutrition',
  '/health/entries',
  '/health/measurements',
  '/health/habits',
  '/health/goals',
  '/health/sync',
] as const;

/**
 * Wave A mutators that do NOT live under a Wave A prefix.
 *
 * ⚠️ `POST /health/ai/coach/commit` is a Wave A WRITE despite sitting under
 * `/health/ai/*`, which plan §2 item 3 assigns to the fall-through set. The
 * coach's commit step materializes the proposal the user just confirmed, and
 * `backend/src/services/health-ai/coach-service.ts` writes FIVE Wave A tables
 * from it — `createWater` (:718), `createWeight` (:726), `createHealthEntry`
 * (:738), `toggleHabit` (:780) and `createNutrition` (:788).
 *
 * Left on the fall-through side, a flag-1 client that confirms a coach proposal
 * writes straight to D1 while its ledger is the system of record — the exact
 * dual-world state §1.3 rejects, arriving through the one door the reject-list
 * left open. Found by the §2 item-3 path audit, not by the plan text.
 *
 * Scoped to the single path on purpose: the rest of `/health/ai/*` (consent,
 * turn, label/meal scan, body-insight generation) is genuinely Tier B and must
 * keep working for a flag-1 client.
 */
const HEALTH_WAVE_A_EXACT_PATHS = ['/health/ai/coach/commit'] as const;

/**
 * True for a Wave A path. Everything else — `/health/cycle/*`,
 * `/health/mens-health/*`, the REST of `/health/ai/*`, `/health/reminders/*`,
 * `/health/exercises/*`, `/health/foods/*`, `/health/custom-foods/*`,
 * `/health/recipes/*`, `/health/widget/*`, `/health/fridge/*`, `/health/files/*`,
 * `/health/injuries/*`, `/health/body-insights/*`, `/health/challenges*`,
 * `/health/social/*`, `/health/summary*` — is Tier B / Wave C / Tier D and stays
 * server-authoritative for all of Wave A.
 */
export function isHealthWaveAPath(pathname: string): boolean {
  if (HEALTH_WAVE_A_EXACT_PATHS.some((exact) => pathname === exact)) {
    return true;
  }
  return HEALTH_WAVE_A_REJECT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Methods the gate rejects on a Wave A prefix.
 *
 * `GET` is deliberately included, which is where this gate DIVERGES from the
 * method-blind House sibling. Plan §7 forbids a flag-1 client from reading D1 at
 * all, so a Wave A GET reaching D1 is not a partial-rollout convenience — it is
 * the §5.1 Proxy fall-through succeeding *silently*: the local read throws, the
 * Proxy catches, the GET returns 200 from D1, and `readThrough`
 * (`healthRepository.ts:364-366`) writes that answer over the MMKV mirror.
 * Nothing fails and no test goes red. Post-truncate it is worse — an empty 200
 * overwrites the mirror with emptiness. 410-ing it is the only thing that turns
 * that omission into a visible failure.
 *
 * `HEAD` and `OPTIONS` are excluded so CORS preflight and liveness probes are
 * never converted into a 410.
 */
const HEALTH_GATED_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/** Methods that can make D1 a second system of record. */
const HEALTH_MUTATING_METHODS: ReadonlySet<string> = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

const LOCAL_FIRST_ENABLED_BODY = {
  error: {
    code: 'local_first_enabled',
    message:
      'Health domain API is disabled for local-first clients. Use the on-device ledger and /v2 control-plane routes.',
  },
} as const;

/**
 * Structured counters for Workers Logs (plan §2 item 10).
 *
 * `health_410` feeds the §15 monitoring row; `health_flag0_mutation` is the ONLY
 * data source for the §14 step 10b(iii) truncate gate — the request logger at
 * `index.ts:126-132` is wrapped in `ENVIRONMENT === 'development'`, so staging
 * and production emit no per-request line at all and a "header-less mutations"
 * query would otherwise return a false zero.
 *
 * ⚠️ Appendix C.1 denylist: **path and method only**. Never body, query string,
 * user id, device id, or headers. `pathname` is used rather than `c.req.url`
 * precisely so the query string cannot leak.
 */
function emit(evt: 'health_410' | 'health_flag0_mutation', path: string, method: string): void {
  console.log(JSON.stringify({ evt, path, method }));
}

/**
 * Router-local variant (mirrors `rejectHomeWritesForLocalFirst`). The mount
 * point decides the path, so this checks only the arming signal and the method.
 * Prefer the `Early` variant — Health's Wave A prefixes are spread across
 * `routes/health.ts` only, but the gate must beat that router's own
 * `use('/*', authMiddleware())` or unauthenticated probes 401 instead of 410.
 */
export function rejectHealthWritesForLocalFirst() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const method = c.req.method.toUpperCase();
    if (!HEALTH_GATED_METHODS.has(method)) return next();
    const pathname = new URL(c.req.url).pathname;
    if (isHealthLocalFirstClient(c)) {
      emit('health_410', pathname, method);
      return c.json(LOCAL_FIRST_ENABLED_BODY, 410);
    }
    if (HEALTH_MUTATING_METHODS.has(method)) {
      emit('health_flag0_mutation', pathname, method);
    }
    return next();
  };
}

/**
 * App-level gate. Register with `app.use('/health/*', …)` **before**
 * `app.route('/health', healthRoutes)` (`index.ts:265`) — Hono runs handlers in
 * registration order, and the existing `rejectHomeWritesForLocalFirstEarly()`
 * slot at `:294` sits AFTER all eight `/health` mounts, so a gate registered
 * there would never fire for `/health/*`.
 *
 * Running before the routers also means an unauthenticated local-first probe
 * gets 410 rather than the 401 that `routes/health.ts`'s `use('/*',
 * authMiddleware())` would produce.
 */
export function rejectHealthWritesForLocalFirstEarly() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const method = c.req.method.toUpperCase();
    if (!HEALTH_GATED_METHODS.has(method)) return next();

    const pathname = new URL(c.req.url).pathname;
    if (!isHealthWaveAPath(pathname)) return next();

    if (isHealthLocalFirstClient(c)) {
      emit('health_410', pathname, method);
      return c.json(LOCAL_FIRST_ENABLED_BODY, 410);
    }

    // Fall-through: a Wave A write from a client that has NOT flipped the flag.
    // This is the flag-0 cohort counter the truncate gate reads.
    if (HEALTH_MUTATING_METHODS.has(method)) {
      emit('health_flag0_mutation', pathname, method);
    }
    return next();
  };
}
