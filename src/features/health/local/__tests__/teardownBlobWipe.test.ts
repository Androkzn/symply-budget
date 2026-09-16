/**
 * A Health wipe must reach the He6 blob cache — the only thing it stores
 * DECRYPTED.
 *
 * `teardown.test.ts` covers the four things `clearLocalHealthPersistence`
 * destroys: the ledger `.db`, both WAL sidecars, and the DEK. All four are
 * ciphertext or the key to it. The blob store is different in kind: it keeps
 * body photos and clinical documents in `cacheDirectory` **as plaintext**, so
 * screens can render them without decrypting on every frame.
 *
 * That makes the blob cache the one artefact a wipe can miss while still
 * looking complete — every existing assertion passes, the ledger really is
 * gone, and the next person on a shared handset opens the previous person's
 * body photos with no key at all. `privacy-cross-user-leak.yaml` is the E2E
 * that would eventually catch it; this is the unit test that catches it first.
 *
 * The wiring is one call in `teardownHealthLocalSession`'s `wipe` branch —
 * exactly the kind of line a refactor drops silently.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SESSION_SRC = readFileSync(join(__dirname, '..', 'ensureSession.ts'), 'utf8');

/** Comments stripped — assert on code, not on prose about the code. */
function stripComments(source: string): string {
  // ONE pass, alternation ordered so whichever delimiter appears FIRST wins.
  //
  // Stripping block comments first is the subtle bug this avoids: a line
  // comment containing `/*` — e.g. ``// `@noble/*` captures globalThis.crypto``
  // on line 1 of `ensureSession.ts` — opens a phantom block that swallows
  // everything up to the next `*/`, silently deleting real code and making
  // every assertion below pass vacuously.
  //
  // The `[^:]` guard keeps `https://` in a string from reading as a comment.
  return source.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, (_match, before) =>
    before === undefined ? ' ' : `${before} `,
  );
}

const strip = stripComments;
const SESSION_CODE = stripComments(SESSION_SRC);

describe('the wipe branch clears the blob cache', () => {
  it('imports the blob wipe', () => {
    expect(SESSION_CODE).toMatch(
      /import\s*\{[^}]*clearHealthBlobLocalState[^}]*\}\s*from\s*'\.\/blobs'/,
    );
  });

  it('calls it inside teardown', () => {
    expect(SESSION_CODE).toMatch(/await\s+clearHealthBlobLocalState\(\)/);
  });

  it('calls it in the WIPE branch, not merely on close', () => {
    // Scope to `teardownHealthLocalSession`'s `wipe` block: a call placed after
    // the early `return` would satisfy the assertion above while never running
    // on sign-out.
    const teardown = SESSION_CODE.slice(
      SESSION_CODE.indexOf('export async function teardownHealthLocalSession'),
    );
    const wipeBranch = teardown.slice(
      teardown.indexOf('options?.wipe'),
      teardown.indexOf('return;'),
    );

    expect(wipeBranch).toContain('clearHealthBlobLocalState()');
    // Beside the other wipes and inside the `finally`, so one failing delete
    // cannot skip it.
    expect(wipeBranch).toContain('clearLocalHealthPersistence()');
    expect(wipeBranch).toContain('clearHealthCaches()');
    expect(wipeBranch).toContain('finally');
  });

  it('the exported wipe really exists and is callable', () => {
    // Guards the import resolving to `undefined` under Babel — the failure
    // class `syncImports.test.ts` exists for, applied to this one call.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const blobs = require('../blobs') as Record<string, unknown>;
    expect(typeof blobs.clearHealthBlobLocalState).toBe('function');
  });

  it('the comment stripper does not hide a real call', () => {
    expect(strip('/** mentions clearHealthBlobLocalState() in prose */')).not.toContain(
      'clearHealthBlobLocalState',
    );
    expect(strip('await clearHealthBlobLocalState();')).toContain('clearHealthBlobLocalState');
  });
});
