/**
 * Shared bootstrap for a HEALTH scale phase: read the scale from the
 * environment, enforce the load gate, open the recorder. The driver runs
 * exactly one phase × scale per process, so everything here is per-process
 * state.
 *
 * Mirrors `house-phase.ts` structurally; the differences are the corpus it
 * sizes against and the default seed. `adults` is accepted and pinned at 1 by
 * the factory — a Health household has exactly one user (plan §1.2).
 */
import { enableDevAssertions } from './dev-global';
import {
  HEALTH_DEFAULT_SEED,
  corpusFingerprint,
  scaleId,
  type HealthScaleId,
  type HealthScaleSpec,
} from './health-ledger-factory';
import { assertMeasurableEnvironment, envInfo, type ScaleEnv } from './measure';
import { openRecorder, type Recorder, type ScalePhase } from './record';

export type HealthPhaseContext = {
  spec: Required<HealthScaleSpec>;
  scale: HealthScaleId;
  env: ScaleEnv;
  recorder: Recorder;
  /** Sample counts scaled to the corpus so a 10-year run still finishes. */
  iters: { light: number; medium: number; heavy: number };
};

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name}: not a number (${raw})`);
  return value;
}

export function startHealthPhase(phase: ScalePhase): HealthPhaseContext {
  enableDevAssertions();

  const spec = {
    years: intEnv('SCALE_YEARS', 5),
    adults: 1,
    seed: intEnv('SCALE_SEED', HEALTH_DEFAULT_SEED),
  };
  const scale = scaleId(spec);
  const { overridden } = assertMeasurableEnvironment();
  const env = envInfo();

  const rows = scale.rows;
  return {
    spec,
    scale,
    env,
    // Stamped on every record: two runs of different corpora are not comparable,
    // and the comparator has to be able to say so rather than reporting a
    // generator change as a product regression.
    recorder: openRecorder({
      phase,
      scale,
      env,
      corpus: corpusFingerprint(spec),
      loadOverridden: overridden,
    }),
    // Health's corpus is denser than House's at the same age (a diary logs more
    // rows per day than a property does), so the thresholds sit higher.
    iters: {
      light: rows >= 50_000 ? 150 : rows >= 25_000 ? 300 : 800,
      medium: rows >= 50_000 ? 12 : rows >= 25_000 ? 20 : 40,
      heavy: rows >= 50_000 ? 2 : rows >= 25_000 ? 3 : 5,
    },
  };
}
