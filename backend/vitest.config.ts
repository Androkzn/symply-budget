import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// ---------------------------------------------------------------------------
// Real test-document fixtures for the worker runtime.
//
// Backend tests run inside workerd, whose fs proxy can't read this repo's
// spaced path (spaces become %20 → ENOENT), so the shared disk resolver
// (e2e/fixtures/index.js) can't run in-worker. This plugin reads the real
// documents from disk in the Vite/Node host (where the path resolves fine) and
// inlines a curated set of SMALL fixtures as base64 into a virtual module.
// src/test-utils/fixtures.ts decodes them. The 25MB inspection report and 8MB
// book are deliberately excluded to keep the bundle small.
// ---------------------------------------------------------------------------
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_KEYS = [
  'budget-receipt', // 240KB grocery receipt JPEG
  'house-bc-assessment', // 255KB small real PDF
  'kaizen-resume', // 80KB resume PDF
  'kaizen-transcript', // interview transcript .txt
  'kaizen-questions-technical', // technical questions .txt
];

function symplyFixturesPlugin() {
  const virtualId = 'virtual:symply-fixtures';
  const resolvedId = '\0' + virtualId;
  return {
    name: 'symply-fixtures',
    resolveId(id: string) {
      return id === virtualId ? resolvedId : undefined;
    },
    load(id: string) {
      if (id !== resolvedId) return undefined;
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'e2e/fixtures/manifest.json'), 'utf8')
      ) as { fixtures: Array<{ key: string; name: string; mime: string; source: string }> };
      const byKey = new Map(manifest.fixtures.map((f) => [f.key, f]));
      const out: Record<string, { name: string; mime: string; base64: string }> = {};
      for (const key of FIXTURE_KEYS) {
        const entry = byKey.get(key);
        if (!entry) throw new Error(`symply-fixtures: unknown fixture key "${key}"`);
        const bytes = readFileSync(join(REPO_ROOT, entry.source));
        out[key] = { name: entry.name, mime: entry.mime, base64: bytes.toString('base64') };
      }
      return `export default ${JSON.stringify(out)};`;
    },
  };
}

export default defineConfig({
  plugins: [
    symplyFixturesPlugin(),
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        d1Databases: ['DB'],
        kvNamespaces: ['CONFIG_KV'],
        r2Buckets: ['REPORTS_BUCKET'],
        // Tests run against wrangler.toml (House), where BUDGET_API_ENABLED is
        // "false" — that 404s every budget/savings/wishes route. Enable it here so
        // those suites exercise the real handlers (the Budget worker ships it "true").
        bindings: { BUDGET_API_ENABLED: 'true', LOCAL_FIRST_API_ENABLED: 'true' },
      },
    }),
  ],
  // jpeg-js / upng-js are CJS with relative sub-requires (jpeg-js/lib/encoder)
  // that workerd's loader can't resolve here — the space in the repo path becomes
  // %20 and breaks it. Alias to pre-bundled flat ESM (test-shims/*.mjs, built via
  // esbuild) so workerd loads a single module with no sub-requires.
  // https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/
  resolve: {
    alias: {
      'jpeg-js': fileURLToPath(new URL('./test-shims/jpeg-js.mjs', import.meta.url)),
      'upng-js': fileURLToPath(new URL('./test-shims/upng-js.mjs', import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/'],
    },
  },
});
