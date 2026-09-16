/**
 * Cheap guard — runs in the package's normal `npm test`.
 *
 * `lib/mirror.ts` is a copy of five product functions that cannot be imported
 * from this package (engine.ts pulls `@api/*`, persistence.ts pulls
 * `@services/storage`). This test pins the normalized source of each original.
 *
 * Stage 2 rewrote persist() to per-row AEAD. The harness now imports
 * `collectRowWrites` (projection.ts) and `sealRowBody` (row-aead.ts) directly.
 * This guard pins `collectRowWrites` + `normalizeLedger` so a silent rewrite of
 * the write set cannot report fake gains. Re-run the baseline when it fails.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractFunctionSource, normalizeSource } from './lib/source-extract';

const repoFile = (relative: string) =>
  fileURLToPath(new URL(`../../../../${relative}`, import.meta.url));

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Digests taken at git a8a76ce79ef2485b066d5563fbab769f8daa22f6 (branch
 * feat/budget-v2-local-first, 2026-08-12). `takenAt` is informational — the
 * digest is the contract.
 */
const MIRRORED = [
  {
    file: 'src/features/budget/local/engine.ts',
    symbol: 'normalizeLedger',
    mirroredAs: 'normalizeLedger',
    sha256: '96cf761abfbd1d45740612df38f126ff8806cdbbcfe96dfcc796c56d3011237c',
  },
  {
    // Promoted out of `src/features/budget/local/projection.ts` into the shared
    // core (House plan §3.1). The app file now only supplies the registry, so
    // the write set the harness measures is pinned at its new home.
    file: 'packages/local-first/src/projection/projection.ts',
    symbol: 'collectRowWrites',
    mirroredAs: 'Stage 2 persist writes (imported directly by edit.scale.ts)',
    sha256: '35172c1590f0100d97419de84c9b859786c961e5974491cc14ded9904b6f4ed0',
  },
] as const;

describe('mirror guard', () => {
  for (const entry of MIRRORED) {
    it(`${entry.file} :: ${entry.symbol} is unchanged`, () => {
      const source = readFileSync(repoFile(entry.file), 'utf8');
      const extracted = normalizeSource(extractFunctionSource(source, entry.symbol));
      expect(
        sha256(extracted),
        `${entry.file} :: ${entry.symbol}() changed. lib/mirror.ts mirrors it as ` +
          `${entry.mirroredAs}. Re-mirror it, re-pin this digest, and RE-RUN THE ` +
          'BASELINE — numbers taken against the old write path are not comparable.',
      ).toBe(entry.sha256);
    });
  }
});

describe('mirror guard — self-proof', () => {
  const SAMPLE = [
    'function sample(a: number): number {',
    "  const label = 'a } brace in a string';",
    '  // a } brace in a comment',
    '  /* and { another } here */',
    '  return a + label.length;',
    '}',
    'function after() { return 1; }',
  ].join('\n');

  it('extracts exactly the function body, braces in strings and comments included', () => {
    const extracted = extractFunctionSource(SAMPLE, 'sample');
    expect(extracted.startsWith('function sample')).toBe(true);
    expect(extracted.endsWith('}')).toBe(true);
    expect(extracted).not.toContain('function after');
    expect(extracted).toContain('a } brace in a string');
  });

  it('is capable of failing: a one-character change moves the digest', () => {
    const original = sha256(normalizeSource(extractFunctionSource(SAMPLE, 'sample')));
    const perturbed = sha256(
      normalizeSource(extractFunctionSource(SAMPLE.replace('a + label', 'a - label'), 'sample')),
    );
    expect(perturbed).not.toBe(original);
  });

  it('ignores reformatting and comment rewording', () => {
    const original = sha256(normalizeSource(extractFunctionSource(SAMPLE, 'sample')));
    const reformatted = sha256(
      normalizeSource(
        extractFunctionSource(
          SAMPLE.replace('  // a } brace in a comment', '      // reworded }').replace(
            '  return',
            '\n\n    return',
          ),
          'sample',
        ),
      ),
    );
    expect(reformatted).toBe(original);
  });
});
