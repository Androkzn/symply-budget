/**
 * Every named import in `local/sync/**` actually exists.
 *
 * ## Why this is a test and not a typecheck
 *
 * It IS a typecheck — `tsc --noEmit` reports these. The problem is that this
 * repo carries a few hundred pre-existing `tsc` errors, so a new one does not
 * stand out, and nothing in CI fails on it. Meanwhile Jest and Metro both run
 * through Babel, which **strips types and does not resolve names**: a wrong
 * named import silently becomes `undefined` and only explodes at the call site,
 * at runtime, on a device.
 *
 * That is exactly what had happened. He4 (sync) and He8 (checkpoints) were both
 * reported as built, and both imported House/Budget-shaped names that Health's
 * `controlPlaneClient.ts` never exported:
 *
 * | imported | actually exported |
 * |---|---|
 * | `fetchCheckpointChunk` | `fetchHealthCheckpointChunk` |
 * | `fetchControlPlaneState` | `fetchHealthControlPlaneState` |
 * | `fetchLatestCheckpoint` | `fetchLatestHealthCheckpoint` |
 * | `putCheckpointChunk` | `putHealthCheckpointChunk` |
 * | `ackMailboxBlobs` | `ackHealthMailboxBlobs` |
 * | `depositMailboxBlob` | `depositHealthMailboxBlob` |
 * | `fetchMailboxBlobs` | `fetchHealthMailboxBlobs` |
 * | `syncLocalHouseholdToControlPlane` | `syncLocalHealthHouseholdToControlPlane` |
 * | `installHouseholdKeys` (engine) | `installHealthHouseholdKeys` |
 *
 * Nine dead references across four modules. Nothing was red: no suite covered
 * the call sites, so publishing a checkpoint or draining an HDK blob would have
 * thrown `TypeError: ... is not a function` the first time a real device tried
 * it — which is the first time anyone would have found out.
 *
 * The check is deliberately STATIC (parse the import, look up the export)
 * rather than behavioural. A behavioural test would need a live session, a
 * relay and a key hierarchy, and would be skipped in exactly the conditions
 * where this bug lives.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SYNC_DIR = join(__dirname, '..', 'sync');

/** `import { a, b as c } from '<spec>'` — value imports only. */
type ParsedImport = { specifier: string; names: string[] };

function parseNamedImports(source: string): ParsedImport[] {
  const out: ParsedImport[] = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(source)) !== null) {
    const [, clause, specifier] = match;
    // Only the two local modules this guards; third-party and `@symply/*` are
    // resolved by the bundler and would fail loudly at import time anyway.
    if (!specifier.startsWith('../')) continue;

    const names = clause
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      // `type Foo` is erased by Babel and cannot be a runtime miss.
      .filter((part) => !part.startsWith('type '))
      // `a as b` — the imported name is what must exist.
      .map((part) => part.split(/\s+as\s+/)[0].trim())
      .filter(Boolean);

    if (names.length > 0) out.push({ specifier, names });
  }
  return out;
}

const MODULES = readdirSync(SYNC_DIR).filter((f) => /\.ts$/.test(f) && !f.endsWith('.d.ts'));

/** Resolve `'../controlPlaneClient'` relative to `local/sync/`. */
function loadTarget(specifier: string): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(join(SYNC_DIR, specifier)) as Record<string, unknown>;
}

describe('local/sync — every named import resolves', () => {
  it('finds the sync modules (guards a vacuous pass)', () => {
    expect(MODULES.length).toBeGreaterThanOrEqual(5);
    expect(MODULES).toContain('checkpoints.ts');
    expect(MODULES).toContain('hdkTransfer.ts');
    expect(MODULES).toContain('orchestrator.ts');
  });

  it.each(MODULES)('%s', (file) => {
    const source = readFileSync(join(SYNC_DIR, file), 'utf8');
    const missing: string[] = [];

    for (const { specifier, names } of parseNamedImports(source)) {
      let target: Record<string, unknown>;
      try {
        target = loadTarget(specifier);
      } catch (error) {
        missing.push(`${specifier} (module failed to load: ${String(error)})`);
        continue;
      }
      for (const name of names) {
        if (!(name in target)) missing.push(`${specifier} → ${name}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('the parser sees `as` aliases and skips type-only imports', () => {
    // Guards the guard: a parser that silently matched nothing would make every
    // assertion above pass over an empty list.
    const parsed = parseNamedImports(
      "import { alpha as a, type Beta, gamma } from '../engine';\n" +
        "import { ignored } from '@symply/local-first';\n",
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].specifier).toBe('../engine');
    expect(parsed[0].names).toEqual(['alpha', 'gamma']);
  });

  it('would have caught the original nine', () => {
    const dead = [
      'fetchCheckpointChunk',
      'fetchControlPlaneState',
      'fetchLatestCheckpoint',
      'putCheckpointChunk',
      'ackMailboxBlobs',
      'depositMailboxBlob',
      'fetchMailboxBlobs',
      'syncLocalHouseholdToControlPlane',
    ];
    const controlPlane = loadTarget('../controlPlaneClient');
    for (const name of dead) expect(name in controlPlane).toBe(false);

    // ...and the engine one.
    expect('installHouseholdKeys' in loadTarget('../engine')).toBe(false);
    expect('installHealthHouseholdKeys' in loadTarget('../engine')).toBe(true);
  });
});
