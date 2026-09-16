/**
 * Shared bootstrap for a HOUSE scale phase: read the scale from the
 * environment, enforce the load gate, open the recorder. The driver runs
 * exactly one phase × scale per process, so everything here is per-process
 * state.
 *
 * Mirrors `phase.ts` structurally; the differences are the corpus it sizes
 * against (House's, not Budget's) and the default seed.
 */
import { enableDevAssertions } from './dev-global';
import {
  HOUSE_DEFAULT_SEED,
  corpusFingerprint,
  scaleId,
  type HouseScaleId,
  type HouseScaleSpec,
} from './house-ledger-factory';
import { assertMeasurableEnvironment, envInfo, type ScaleEnv } from './measure';
import { openRecorder, type Recorder, type ScalePhase } from './record';

export type HousePhaseContext = {
  spec: Required<HouseScaleSpec>;
  scale: HouseScaleId;
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

export function startHousePhase(phase: ScalePhase): HousePhaseContext {
  enableDevAssertions();

  const spec = {
    years: intEnv('SCALE_YEARS', 5),
    adults: intEnv('SCALE_ADULTS', 2),
    seed: intEnv('SCALE_SEED', HOUSE_DEFAULT_SEED),
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
    iters: {
      light: rows >= 20_000 ? 200 : rows >= 10_000 ? 400 : 800,
      medium: rows >= 20_000 ? 15 : rows >= 10_000 ? 25 : 40,
      heavy: rows >= 20_000 ? 2 : rows >= 10_000 ? 3 : 5,
    },
  };
}
