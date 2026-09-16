/**
 * The composition root — eight facades, one object, served to `healthApi`'s
 * Proxy (He3, plan §7).
 *
 * `src/api/health.ts` wraps `remoteHealthApi` in `createHealthLocalProxy` and
 * hands it `localHealthApi`. Per call the Proxy decides ledger or server, so
 * every Health screen and storage module keeps its import and its types, and
 * `git diff --stat src/features/health/screens` comes back empty.
 *
 * ## Why the merge is explicit rather than a spread chain
 *
 * A bare `{ ...a, ...b }` resolves a duplicated method name by silently keeping
 * the last one. For this object that is not a style question: each facade owns
 * a Wave A table, so a collision means one table's method quietly stops being
 * reachable while the app still compiles, still runs, and still renders. The
 * screen shows the OTHER table's answer — or an empty list — and no test goes
 * red unless it happens to cover that exact method.
 *
 * That is not hypothetical. `listHabits` was claimed by two facades during the
 * He3 build: `localHabitsApi` (returning `HealthHabit[]`, matching the remote)
 * and `localSummariesApi` (returning `HealthHabitWithStreak[]`, which hands
 * screens a decoded `custom_days` array where the Worker sends a JSON string).
 * A spread chain would have picked whichever came last and shipped a wire-shape
 * change nobody chose. `assertDisjointFacades` turns that into a loud failure,
 * and `apiParity.test.ts` proves it stays one.
 *
 * ## Order is documented, not incidental
 *
 * The order below is the order a reader should think about the surface —
 * logs first, then the derived reads — and it carries no precedence, because
 * `assertDisjointFacades` guarantees there is nothing to take precedence over.
 */
import { localBodyApi } from './localBodyApi';
import { localEntriesApi } from './localEntriesApi';
import { localGoalsApi } from './localGoalsApi';
import { localHabitsApi } from './localHabitsApi';
import { localNutritionApi } from './localNutritionApi';
import { localSummariesApi } from './localSummariesApi';
import { localWaterApi } from './localWaterApi';
import { localWeightApi } from './localWeightApi';

/**
 * Every facade, named, so tests can iterate them and error messages can say
 * WHICH modules collided rather than just that something did.
 */
export const HEALTH_LOCAL_FACADES = [
  ['localWeightApi', localWeightApi],
  ['localWaterApi', localWaterApi],
  ['localNutritionApi', localNutritionApi],
  ['localEntriesApi', localEntriesApi],
  ['localBodyApi', localBodyApi],
  ['localHabitsApi', localHabitsApi],
  ['localGoalsApi', localGoalsApi],
  ['localSummariesApi', localSummariesApi],
] as const satisfies ReadonlyArray<readonly [string, Record<string, unknown>]>;

/** `{ method → the facades claiming it }`, for any method claimed more than once. */
export function findFacadeCollisions(): Record<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const [name, facade] of HEALTH_LOCAL_FACADES) {
    for (const method of Object.keys(facade)) {
      owners.set(method, [...(owners.get(method) ?? []), name]);
    }
  }

  const collisions: Record<string, string[]> = {};
  for (const [method, claimants] of owners) {
    if (claimants.length > 1) collisions[method] = claimants;
  }
  return collisions;
}

/**
 * Fail loudly, and fail where a human is looking.
 *
 * Throwing unconditionally at module load would take the app down on a device
 * for a mistake that is always caught in CI, so production logs instead. Under
 * Jest and `__DEV__` it throws — those are the two places a collision can still
 * be fixed before it reaches anyone.
 */
function assertDisjointFacades(): void {
  const collisions = findFacadeCollisions();
  const methods = Object.keys(collisions);
  if (methods.length === 0) return;

  const detail = methods
    .map((method) => `${method} claimed by ${collisions[method].join(' + ')}`)
    .join('; ');
  const message =
    `[HealthLocal] two local facades claim the same method — one table's ` +
    `implementation is unreachable: ${detail}`;

  const underTest = process.env.JEST_WORKER_ID !== undefined;
  if (underTest || __DEV__) throw new Error(message);
  console.error(message);
}

assertDisjointFacades();

/**
 * The Wave A surface, served from the ledger.
 *
 * Typed as a plain object rather than `Partial<typeof remoteHealthApi>`: the
 * Proxy takes `Partial<Record<keyof TRemote, unknown>>` and `apiParity.test.ts`
 * is what proves the mapping is total in both directions. Declaring the type
 * here would let a method whose SIGNATURE drifted from the remote still satisfy
 * the compiler, which is the check that actually matters.
 */
export const localHealthApi = {
  ...localWeightApi,
  ...localWaterApi,
  ...localNutritionApi,
  ...localEntriesApi,
  ...localBodyApi,
  ...localHabitsApi,
  ...localGoalsApi,
  ...localSummariesApi,
};

export default localHealthApi;
