import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Dedicated config for the scale phases.
 *
 * `packages/local-first` has no vitest config of its own, so `npm test` uses
 * vitest's default include (`**\/*.{test,spec}.?(c|m)[jt]s?(x)`). A phase named
 * `*.test.ts` would therefore be swept into the normal package suite, where a
 * ten-year persist takes tens of seconds and can OOM. Phases are named
 * `*.scale.ts` — never matched by the default include — and only this config
 * picks them up. The cheap guards next door keep the `.test.ts` suffix on
 * purpose: they SHOULD run in `npm test`.
 *
 * Single non-isolated fork with `--expose-gc`: measurements need a stable heap
 * and forced collection between samples, and the driver already runs one
 * process per phase x scale so an OOM cannot take the whole run with it.
 */
const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: packageRoot,
  test: {
    include: ['__tests__/scale/phases/**/*.scale.ts'],
    setupFiles: ['__tests__/scale/setup.scale.ts'],
    // Vitest 4 flattened poolOptions to the top level; `maxWorkers: 1` plus
    // `fileParallelism: false` is what `singleFork` used to mean.
    pool: 'forks',
    isolate: false,
    execArgv: ['--expose-gc'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 45 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
    reporters: ['default'],
  },
});
