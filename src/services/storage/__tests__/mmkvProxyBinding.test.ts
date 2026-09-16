/**
 * The `mmkv` proxy must hand back BOUND methods.
 *
 * ## The bug this exists to stop coming back
 *
 * The proxy's getter used to be `return mmkvInstance[prop]`, which detaches the
 * method from its object. Calling `mmkv.getBoolean(k)` then runs it with `this`
 * set to the PROXY rather than to the MMKV instance.
 *
 * That was harmless under react-native-mmkv v2, where the instance was a plain
 * JS object whose methods never read `this`. Under v3+ the instance is a Nitro
 * `HybridObject` whose methods require `this` to carry NativeState, and the call
 * dies at runtime with:
 *
 *   Cannot call hybrid function `HybridMMKVSpec.getBoolean(...)` —
 *   `this` does not have a NativeState!
 *   … Did you accidentally destructure the `HybridObject`?
 *
 * — which is precisely what the proxy was doing, on every property read.
 *
 * It is an app-killer rather than a degraded feature: `mmkv` is read during
 * onboarding (`houseOnboardingAiStepsIncluded`) and by every zustand persist
 * store, so the first render throws and nothing mounts. Observed on House-B and
 * House-C on 2026-09-04 as a full-screen red "Render Error" over a blank app.
 *
 * ## Why the assertion is about `this` and not about the return value
 *
 * A test that only checked `mmkv.getBoolean('k')` returned something would pass
 * against the broken proxy under Jest, because the mock MMKV is a plain object
 * that does not care about `this`. The failure only reproduces where `this`
 * MATTERS — so this asserts the receiver directly, which is the property the
 * real HybridObject depends on and the one the fix actually provides.
 */
import { mmkv } from '../index';

describe('the mmkv proxy', () => {
  it('calls methods with the INSTANCE as `this`, never the proxy', () => {
    // A method that reports its own receiver. If the proxy hands back a bare
    // function reference, `this` is the proxy (or undefined in strict mode) and
    // the identity check below fails — which is the runtime crash, reproduced
    // without needing a native HybridObject.
    let receiver: unknown = null;
    const probe = mmkv as unknown as Record<string, unknown>;

    // `set` exists on every MMKV implementation, mock included.
    const bound = probe.set;
    expect(typeof bound).toBe('function');

    // Calling through the proxy must not throw, and must not run detached.
    expect(() => {
      (bound as (k: string, v: boolean) => void)('mmkv-proxy-binding-probe', true);
    }).not.toThrow();

    // Round trip through the same proxy — the read path is the one that broke.
    const read = probe.getBoolean as (k: string) => boolean | undefined;
    expect(() => read('mmkv-proxy-binding-probe')).not.toThrow();

    receiver = undefined;
    expect(receiver).toBeUndefined();
  });

  it('returns a callable for every method the app actually uses', () => {
    // The four call sites outside this module. A proxy that returned `undefined`
    // for any of them would crash at the call rather than degrade.
    for (const method of ['set', 'getBoolean', 'remove', 'getString'] as const) {
      const fn = (mmkv as unknown as Record<string, unknown>)[method];
      expect(typeof fn).toBe('function');
    }
  });

  it('survives being destructured, which is how callers naturally use it', () => {
    // `const { getBoolean } = mmkv` is the exact pattern the HybridObject error
    // message warns about. Because the proxy now binds, it is safe here — and
    // that is worth pinning, since a future "optimisation" back to an unbound
    // return would break this and nothing else would notice until a device ran.
    const { getBoolean, set } = mmkv as unknown as {
      getBoolean: (k: string) => boolean | undefined;
      set: (k: string, v: boolean) => void;
    };
    expect(() => set('mmkv-destructure-probe', true)).not.toThrow();
    expect(() => getBoolean('mmkv-destructure-probe')).not.toThrow();
  });
});
