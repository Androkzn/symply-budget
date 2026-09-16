/**
 * Health He10 — the FACADE READ PATH: the 17-loader `health-homehydrate`.
 *
 * This is the phase the plan added on top of Budget's and House's four (§4):
 *
 *   "Measure the read path, not just the write path. §4's thresholds previously
 *    covered `mutate` and `applyLedgerDelta` only. The path that decides whether
 *    Home is usable is the facade read path: `HealthHomeScreen.tsx:198-219`
 *    fires a 17-way `Promise.all` of `load*()` on every focus, and
 *    `useHealthKitSyncHydration` fires the same hydrate again after every
 *    HealthKit sync."
 *
 * House shipped H3 owing exactly this — "the harness measures the projection
 * directly, not through the facades" — so Health measures it before He3 starts.
 *
 * WHAT IS REPORTED
 * ----------------
 *   homehydrate.promiseAll      the gated number: all 17 awaited together
 *   homehydrate.loader.<name>   per-loader breakdown, so a breach names a
 *                               culprit instead of a screen
 *   homehydrate.ledgerBacked    the 13 that touch the ledger, summed
 *   homehydrate.mmkvBacked      the 4 that do not (notes/prefs/layout/flag)
 *   homehydrate.onFocus         the same fan-out a second time, warm — a focus
 *                               return is not a cold open, and the screen fires
 *                               this on EVERY focus
 *
 * THE GATE READS p95; `compare` GRADES AT p50 — deliberately, not by accident.
 * The plan's threshold is a p95, and the fan-out resolves at its slowest
 * member, so the Exit check below reads the `p95` field that travels on every
 * record. `compare`'s regression tolerance supports `min` and `p50` only
 * (`record.ts`, `MetricStat`), and p50 is the right regression statistic for a
 * linear scan; declaring `p95` there would silently be read as `min`.
 */
import { performance } from 'node:perf_hooks';

import { describe, it } from 'vitest';

import { buildHomeLoaders, runHomeHydrate, type Loader } from '../lib/health-home-loaders';
import {
  CORPUS_END_DATE,
  generateHealthLedger,
  type HealthScaleLedger,
} from '../lib/health-ledger-factory';
import { startHealthPhase } from '../lib/health-phase';
import {
  HEALTH_EXIT_THRESHOLDS,
  assertExitChecks,
  recordExitChecks,
  timeCheck,
} from '../lib/health-thresholds';
import { forceGc, stats } from '../lib/measure';

/** `compare`'s regression statistic. The He10 gate reads `p95` off the record. */
const GRADE_P50 = { stat: 'p50' } as const;

async function timeFanOut(loaders: readonly Loader[], iters: number): Promise<number[]> {
  const samples: number[] = [];
  // Two warm-up passes: the first hydrate JIT-compiles seventeen closures, and
  // reporting that as the steady state would overstate every focus after it.
  await runHomeHydrate(loaders);
  await runHomeHydrate(loaders);
  for (let k = 0; k < iters; k += 1) {
    const t0 = performance.now();
    await runHomeHydrate(loaders);
    samples.push(performance.now() - t0);
  }
  return samples;
}

describe('health scale: 17-loader home hydrate', () => {
  it('measures', async () => {
    const ctx = startHealthPhase('homehydrate');
    const { recorder, scale, iters } = ctx;

    const ledger: HealthScaleLedger = generateHealthLedger(ctx.spec);
    const today = CORPUS_END_DATE;
    const loaders = buildHomeLoaders(ledger, today);

    if (loaders.length !== 17) {
      throw new Error(`expected 17 Home loaders, modelled ${loaders.length}`);
    }
    recorder.count('homehydrate.loaders', loaders.length, 'count', 'flat', 'HealthHomeScreen.tsx:198-219');
    recorder.count(
      'homehydrate.loaders.ledgerBacked',
      loaders.filter((l) => l.ledgerBacked).length,
      'count',
      'flat',
      'the rest are MMKV: notes, prefs, layout, widget flag',
    );

    // ---- per-loader breakdown -------------------------------------------
    //
    // Run individually and in isolation, so a slow one is attributable. The sum
    // of these is NOT the fan-out: `Promise.all` over synchronous bodies runs
    // them back to back on one thread, but the microtask turn and the shared
    // cache state differ, which is why the fan-out is measured separately
    // rather than added up.
    const perLoader = Math.max(8, Math.min(60, iters.medium * 2));
    let ledgerBackedTotal = 0;
    let mmkvBackedTotal = 0;

    for (const loader of loaders) {
      forceGc();
      const samples: number[] = [];
      loader.run();
      loader.run();
      for (let k = 0; k < perLoader; k += 1) {
        const t0 = performance.now();
        loader.run();
        samples.push(performance.now() - t0);
      }
      const st = stats(samples);
      recorder.time(
        `homehydrate.loader.${loader.name}`,
        st,
        loader.ledgerBacked ? 'ledger read' : 'MMKV read — not ledgered',
        GRADE_P50,
      );
      if (loader.ledgerBacked) ledgerBackedTotal += st.p50;
      else mmkvBackedTotal += st.p50;
    }

    recorder.ratio('homehydrate.ledgerBacked.sumMs', ledgerBackedTotal, 'lower', '13 ledger loaders, p50 summed');
    recorder.ratio('homehydrate.mmkvBacked.sumMs', mmkvBackedTotal, 'lower', '4 MMKV loaders, p50 summed');

    // ---- the fan-out the screen actually awaits --------------------------
    forceGc();
    const fanOut = stats(await timeFanOut(loaders, Math.max(40, iters.medium * 4)));
    recorder.time(
      'homehydrate.promiseAll',
      fanOut,
      `17-way Promise.all over ${scale.rows} rows — the gated number`,
      GRADE_P50,
    );
    recorder.ratio(
      'homehydrate.usPerRow',
      (fanOut.p95 * 1000) / Math.max(scale.rows, 1),
      'lower',
      'microseconds of p95 fan-out per ledger row',
    );

    // A focus return re-fires the identical hydrate with everything warm. The
    // screen does this on every navigation back to Home and after every
    // HealthKit sync, so it is the COMMON case, not the tail.
    forceGc();
    const onFocus = stats(await timeFanOut(loaders, Math.max(40, iters.medium * 4)));
    recorder.time('homehydrate.onFocus', onFocus, 'second and subsequent focus', GRADE_P50);

    // ---- He10 Exit ------------------------------------------------------
    const checks = [
      timeCheck({
        id: 'homeHydrate',
        label: '17-loader `health-homehydrate` (p95)',
        measuredMs: fanOut.p95,
        thresholdMs: HEALTH_EXIT_THRESHOLDS.homeHydrateP95Ms,
        notes: 'the descope trigger the plan reads',
      }),
    ];
    recordExitChecks(recorder, checks);
    recorder.end();
    assertExitChecks(ctx.spec.years, checks);
  });
});
