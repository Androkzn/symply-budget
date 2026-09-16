/**
 * The Symply Health API clients must not go through the `api.*` helpers.
 *
 * THE BUG THIS PREVENTS (found 2026-07-25, after P1 had already shipped):
 * `api.get<T>()` in `client.ts` types the response body as `ApiResponse<T>` —
 * `{ data: T }` — so callers write `res.data?.entries`. The Health Worker
 * returns the payload BARE (`c.json({ entries })`) with no wrapping middleware.
 * Every Health read therefore resolved `undefined` against the live server and
 * silently fell back to the offline cache: the app looked like it worked, and
 * nothing in the app ever showed server data.
 *
 * It survived because the unit fixtures wrapped the payload the same way the
 * type claimed, so the tests agreed with the client and both disagreed with the
 * server. The live-API suite missed it too, because it calls `fetch` directly
 * rather than through this client.
 *
 * The fix is to call `apiClient` directly (as `src/api/savings.ts` does) so the
 * body IS the payload. This test pins that at the source level, because the
 * failure mode is invisible at runtime — there is no crash, just empty screens.
 */

import fs from 'fs';
import path from 'path';

const API_DIR = path.join(__dirname, '..');

/** Every client module that talks to the Symply Health Worker. */
const HEALTH_CLIENTS = [
  'health.ts',
  'healthAssets.ts',
  'healthFood.ts',
  'healthFridge.ts',
  'healthExercises.ts',
  'healthInjuries.ts',
  'healthAi.ts',
];

function read(file: string): string {
  return fs.readFileSync(path.join(API_DIR, file), 'utf8');
}

describe('Symply Health API envelope', () => {
  it.each(HEALTH_CLIENTS)('HEALTH-ENV-001: %s calls apiClient, never the api.* helpers', (file) => {
    const source = read(file);

    // `api.get<`, `api.post<`, … — the wrapping helpers.
    const helperCalls = source.match(/\bapi\.(get|post|put|patch|delete)\s*</g) ?? [];
    expect(helperCalls).toEqual([]);
    expect(source).toContain('apiClient');
  });

  it.each(HEALTH_CLIENTS)('HEALTH-ENV-002: %s does not import the api helper object', (file) => {
    const source = read(file);

    // Importing `api` at all is the first step toward reintroducing the bug.
    const importsApiHelper = /import\s*\{[^}]*\bapi\b[^}]*\}\s*from\s*'\.\/client'/.test(source);
    expect(importsApiHelper).toBe(false);
  });

  it('HEALTH-ENV-003: no Health caller reads a `.data` envelope off a client call', () => {
    // Mirrors the client contract on the consumer side: if a repository or hook
    // reaches for `.data`, it is expecting the wrapper that does not exist.
    const featureDir = path.join(API_DIR, '..', 'features', 'health');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'test-utils') continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
        const source = fs.readFileSync(full, 'utf8');
        // `healthApi.foo(...)).data` or `await healthApi.foo()).data?.`
        if (/health\w*Api\.[\w]+\([^)]*\)\s*\)?\s*\.data\b/.test(source)) {
          offenders.push(path.relative(featureDir, full));
        }
      }
    };
    walk(featureDir);

    expect(offenders).toEqual([]);
  });
});
