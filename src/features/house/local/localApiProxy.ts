/**
 * The Proxy facade that makes the H3 screen churn zero (plan §6).
 *
 * Every Wave-A `src/api/*.ts` module keeps its exported name and its type. The
 * Proxy decides per call whether the method comes from the on-device ledger or
 * from the server, so ~163 screens and ~36 stores need no edit at all.
 *
 * TWO LESSONS CARRIED FROM BUDGET, BOTH PAID FOR ONCE ALREADY
 * -----------------------------------------------------------
 * 1. **The `require` must target `flag.ts` directly, never the barrel.**
 *    `@features/house/local` pulls the sync orchestrator, the status store and
 *    the control-plane client into the module graph — on EVERY api call, from
 *    every screen. Narrow requires keep the cold path cold.
 * 2. **A missing local method must THROW, not fall through.** Silently routing
 *    to the server is the worst failure mode available here: the server has no
 *    data for a local-first household, so the screen renders empty and correct,
 *    and nobody finds out until a member notices their home is gone. Budget
 *    learned this at `savings.ts:1454`.
 *
 * `strict: false` exists only for modules whose surface is genuinely part local,
 * part Tier B/C — `garbage-collection` reads municipality config from the
 * server, `task-drafts` generates through the AI Housekeeper. Those declare the
 * remote-by-design methods explicitly in `remoteMethods` rather than relying on
 * a silent fallthrough, so the split is auditable instead of accidental.
 */
import { HouseLocalUnsupportedError } from './errors';

export type HouseLocalProxyOptions<TRemote extends object> = {
  /** Module name, for the error message a member never sees but an engineer does. */
  moduleName: string;
  /** Lazily resolve the local implementation. Must use a NARROW require. */
  resolveLocal: () => Partial<Record<keyof TRemote, unknown>> | null;
  /**
   * Methods that are remote BY DESIGN — Tier B/C surfaces the ledger will never
   * own. Listed explicitly so "this one goes to the server" is a decision in the
   * code rather than the absence of one.
   */
  remoteMethods?: ReadonlyArray<keyof TRemote>;
  /**
   * When true (the default), a method that is neither local nor declared remote
   * throws `HouseLocalUnsupportedError`. Turn it off only while a module is
   * mid-port, and never on a release branch.
   */
  strict?: boolean;
};

/**
 * Wrap a remote api module so local-first households read and write the ledger.
 *
 * Returns the remote object unchanged in shape and type — `typeof remoteApi` —
 * so no call site can tell the difference.
 */
export function createHouseLocalProxy<TRemote extends object>(
  remote: TRemote,
  options: HouseLocalProxyOptions<TRemote>,
): TRemote {
  const remoteMethods = new Set<string | symbol>(
    (options.remoteMethods ?? []) as ReadonlyArray<string | symbol>,
  );
  const strict = options.strict ?? true;

  return new Proxy(remote, {
    get(target, prop, receiver) {
      const remoteValue = Reflect.get(target, prop, receiver);

      // Anything that is not a callable api method — a constant, a key factory,
      // `then` during promise resolution — passes straight through.
      if (typeof remoteValue !== 'function' || remoteMethods.has(prop)) {
        return typeof remoteValue === 'function' ? remoteValue.bind(target) : remoteValue;
      }

      let localApi: Partial<Record<string | symbol, unknown>> | null = null;
      let localFirst = false;
      try {
        // Narrow require — flag.ts only. See the header.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { isHouseLocalFirst } = require('./flag') as typeof import('./flag');
        localFirst = isHouseLocalFirst();
        if (localFirst) {
          localApi = options.resolveLocal() as Partial<Record<string | symbol, unknown>> | null;
        }
      } catch {
        // The feature is not wired in this build (or this test). Fall through to
        // the server, which is the correct behaviour for a non-local-first brand.
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
        //    network failure would have been caught. The gap must behave like
        //    the failure it stands in for.
        //  - rejected rather than resolved-empty: an empty result is the exact
        //    silence the coverage rule exists to prevent.
        return () =>
          Promise.reject(new HouseLocalUnsupportedError(`${options.moduleName}.${String(prop)}`));
      }
      return remoteValue.bind(target);
    },
  });
}

/**
 * Names a local module must implement to satisfy its remote counterpart.
 *
 * `parityGap` powers the DoD's programmatic method diff: it returns what is
 * missing in each direction, so a new remote method added later fails the test
 * instead of silently becoming a server call for local-first households.
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
