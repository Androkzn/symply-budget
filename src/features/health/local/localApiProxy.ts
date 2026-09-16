/**
 * The Proxy facade that makes the He3 screen churn zero (plan §7).
 *
 * Every Wave-A caller keeps the module it already imports — `healthApi` and the
 * 23 `health*Storage.ts` modules above it keep their exported names and their
 * types. The Proxy decides per call whether the method comes from the on-device
 * ledger or from the server, so the Health screens (Home alone is a 17-way
 * `Promise.all`, `HealthHomeScreen.tsx:198-219`) need no edit at all. The plan
 * says it in one line: *"Do not rewrite screens. Prefer Proxy on
 * `src/api/health.ts`."*
 *
 * TWO LESSONS CARRIED FROM BUDGET AND HOUSE, BOTH PAID FOR ONCE ALREADY
 * ---------------------------------------------------------------------
 * 1. **The `require` must target `flag.ts` directly, never the barrel.**
 *    `@features/health/local` pulls the sync orchestrator, the status store and
 *    the control-plane client into the module graph — on EVERY api call, from
 *    every screen. Narrow requires keep the cold path cold.
 * 2. **A missing local method must THROW `HealthLocalUnsupportedError`, never
 *    fall through to the server.** Silently routing to the server is the worst
 *    failure mode available here: on a local-first ledger the server holds no
 *    rows for this user, so the screen renders an empty-but-plausible state and
 *    nobody finds out until the user notices their logs are gone. A weight log
 *    that reads as "no entries yet" is indistinguishable from a fresh install.
 *    Budget learned this at `savings.ts:1454`.
 *
 * WHAT HEALTH DOES **NOT** INHERIT FROM HOUSE
 * -------------------------------------------
 * House's Proxy is written against a member who can hold several properties, so
 * its facades take a `householdId` per call and its `localWrite` refuses a write
 * addressed at a background property. Health is a **personal** ledger — one
 * user, N devices, exactly one household, and He5 makes the control plane
 * refuse a second `user_id` (plan §1.2). There is nothing to switch between, so
 * there is no property argument to validate and no cross-property write to
 * guard against. Nothing here is per-household.
 *
 * `strict: false` exists only for modules whose surface is genuinely part local,
 * part Tier B — `healthAiApi` reaches `/health/ai/*`, which stays server-side
 * until BYOK, and `healthFoodApi.searchFoods` / `lookupBarcode` are the
 * FatSecret lookup chokepoint (plan §1.4). Those declare the remote-by-design
 * methods explicitly in `remoteMethods` rather than relying on a silent
 * fallthrough, so the split is auditable instead of accidental.
 *
 * ⚠️ **`HealthLocalUnsupportedError` is not a way to defer the summary port.**
 * `errors.ts` says it and the plan's Hard Exit says it: a Home summary, streak
 * or trend method that throws is NOT an acceptable He3 exit — He7-lite lands in
 * the same ship. Use `remoteMethods` for Tier B, and implement the rest.
 */
import { HealthLocalUnsupportedError } from './errors';

export type HealthLocalProxyOptions<TRemote extends object> = {
  /** Module name, for the error message a user never sees but an engineer does. */
  moduleName: string;
  /** Lazily resolve the local implementation. Must use a NARROW require. */
  resolveLocal: () => Partial<Record<keyof TRemote, unknown>> | null;
  /**
   * Methods that are remote BY DESIGN — Tier B surfaces the ledger will never
   * own. Listed explicitly so "this one goes to the server" is a decision in the
   * code rather than the absence of one, and so `apiParity.test.ts` can demand a
   * written reason for each (He3a Exit).
   */
  remoteMethods?: ReadonlyArray<keyof TRemote>;
  /**
   * When true (the default), a method that is neither local nor declared remote
   * throws `HealthLocalUnsupportedError`. Turn it off only while a module is
   * mid-port, and never on a release branch.
   */
  strict?: boolean;
};

/**
 * Wrap a remote api module so a local-first device reads and writes the ledger.
 *
 * Returns the remote object unchanged in shape and type — `typeof remoteApi` —
 * so no call site can tell the difference.
 */
export function createHealthLocalProxy<TRemote extends object>(
  remote: TRemote,
  options: HealthLocalProxyOptions<TRemote>,
): TRemote {
  const remoteMethods = new Set<string | symbol>(
    (options.remoteMethods ?? []) as ReadonlyArray<string | symbol>,
  );
  const strict = options.strict ?? true;

  return new Proxy(remote, {
    get(target, prop, receiver) {
      const remoteValue = Reflect.get(target, prop, receiver);

      // Anything that is not a callable api method — a constant, a cache-key
      // factory, `then` during promise resolution — passes straight through.
      if (typeof remoteValue !== 'function' || remoteMethods.has(prop)) {
        return typeof remoteValue === 'function' ? remoteValue.bind(target) : remoteValue;
      }

      let localApi: Partial<Record<string | symbol, unknown>> | null = null;
      let localFirst = false;
      try {
        // Narrow require — flag.ts only. See the header.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { isHealthLocalFirst } = require('./flag') as typeof import('./flag');
        localFirst = isHealthLocalFirst();
        if (localFirst) {
          localApi = options.resolveLocal() as Partial<Record<string | symbol, unknown>> | null;
        }
      } catch {
        // The feature is not wired in this build (or this test). Fall through to
        // the server, which is the correct behaviour for a non-local-first brand
        // — Health ships from the same `src/` as House, Budget and Kaizen.
        return remoteValue.bind(target);
      }

      if (!localFirst) return remoteValue.bind(target);

      const localFn = localApi?.[prop];
      if (typeof localFn === 'function') {
        return (localFn as (...args: unknown[]) => unknown).bind(localApi);
      }

      if (strict) {
        // A REJECTED PROMISE, not a synchronous throw, and not a property-access
        // throw. Three separate decisions:
        //
        //  - not at property access: React reads methods off an api object while
        //    rendering, and throwing there takes down a screen that never called
        //    the method.
        //  - not synchronously at call time: every remote method returns a
        //    promise, so a caller written as `api.x().catch(...)` — rather than
        //    `try { await api.x() }` — would get an UNCAUGHT throw where a
        //    network failure would have been caught. Health's loaders are a
        //    17-way `Promise.all`, where one synchronous throw takes the other
        //    sixteen down with it. The gap must behave like the failure it
        //    stands in for.
        //  - rejected rather than resolved-empty: an empty result is the exact
        //    silence lesson 2 in the header exists to prevent.
        return () =>
          Promise.reject(new HealthLocalUnsupportedError(`${options.moduleName}.${String(prop)}`));
      }
      return remoteValue.bind(target);
    },
  });
}

/**
 * Names a local module must implement to satisfy its remote counterpart.
 *
 * `parityGap` powers the He3a DoD's programmatic method diff (`apiParity.test.ts`,
 * green **both directions**): it returns what is missing in each direction, so a
 * new remote method added later fails the test instead of silently becoming a
 * server call — or, worse under lesson 2, a rejected promise on a screen that
 * used to work.
 *
 * `allowedRemoteOnly` is the Tier B allowlist. It takes the same names passed to
 * `remoteMethods` above; the *reason* for each belongs beside the list in the
 * test, which is where He3a's "written reason per remote-by-design method" is
 * reviewable.
 */
export function parityGap(
  remote: object,
  local: object,
  allowedRemoteOnly: readonly string[] = [],
): { missingLocally: string[]; extraLocally: string[] } {
  const isMethod = (obj: object, key: string) =>
    typeof (obj as Record<string, unknown>)[key] === 'function';

  const remoteNames = Object.keys(remote).filter((key) => isMethod(remote, key));
  const localNames = Object.keys(local).filter((key) => isMethod(local, key));
  const allowed = new Set(allowedRemoteOnly);

  return {
    missingLocally: remoteNames.filter((name) => !allowed.has(name) && !localNames.includes(name)),
    extraLocally: localNames.filter((name) => !remoteNames.includes(name)),
  };
}
