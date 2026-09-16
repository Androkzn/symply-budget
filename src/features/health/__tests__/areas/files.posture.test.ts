/**
 * POSTURE GUARD — Symply Health "user files" (`/health/files*` on the
 * `symply-health-api` Worker, backed by R2).
 *
 * ## Why this file exists
 *
 * The Worker has shipped six handlers over four paths since parity phase P2
 * (`backend/src/routes/health-assets.ts`): reserve, list, read metadata, PUT the
 * bytes, proxy the bytes back, delete. They are covered exhaustively by
 * `backend/src/routes/__tests__/health-files.test.ts`.
 *
 * For most of that time the surface had **no client at all** — no screen, no
 * `src/api` module, no store. A deployed, authenticated, byte-serving surface
 * with no caller is not a stable state: it either grows one or it should be
 * deleted. This guard covers the "grows one" direction, which is the dangerous
 * one, because the files client is where this app's most sensitive artefact —
 * a `body_photo` — is uploaded, listed and deleted, and the Worker suite can
 * never see any of that: it does not run the client.
 *
 * It asserts three things that stay true whoever lands the UI:
 *
 *  1. **A caller may not ship untested.** Any non-test module under `src/` or
 *     `app/` that invokes a FILES operation must have at least one client test
 *     that references it.
 *  2. **The R2 key vocabulary never crosses into the files client.**
 *     `storage_key`, `thumbnail_key` and the `health-files/` bucket prefix are
 *     server-only by construction: the Worker projects them out of every
 *     response (`FILE_COLUMNS`) and reads go through the proxied,
 *     ownership-checked `content_path`. A files module that handles one in CODE
 *     is either parsing a field that should not exist or assembling a URL that
 *     bypasses the per-request ownership check — the only thing between one
 *     member's body photos and another's. (Other domains — floor plans, garden
 *     plans, visits — legitimately publish their own `thumbnail_key`; this rule
 *     is scoped to the health files chain, not the repo.)
 *  3. **The guard is anchored to the real route**, not to a string that could
 *     drift: it reads the Worker source and requires the four `/files` paths to
 *     still be registered, and the R2 prefix is read out of the service rather
 *     than duplicated here.
 *
 * ## When to delete this file
 *
 * Rule 3 is the tripwire: if `/health/files` is removed from the Worker, this
 * suite fails and the correct fix is to DELETE this file together with
 * `backend/src/routes/__tests__/health-files.test.ts` — not to relax it.
 * Rules 1 and 2 should OUTLIVE the "no client" era they were written in:
 * deleting them because a client finally landed would remove the check exactly
 * when it starts to matter.
 *
 * Cheap by construction: pure `fs`, no React, no network, no simulator.
 */

import fs from 'fs';
import path from 'path';

/** …/src/features/health/__tests__/areas → repo root. */
const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const WORKER_ROUTE = path.join(REPO_ROOT, 'backend/src/routes/health-assets.ts');
const WORKER_SERVICE = path.join(REPO_ROOT, 'backend/src/services/health-assets-service.ts');

/** The client trees. Backend, e2e and scripts are out of scope. */
const CLIENT_ROOTS = ['src', 'app'];

/** This file itself — it names every symbol below and would satisfy its own rule. */
const SELF = path.relative(REPO_ROOT, __filename);

interface SourceFile {
  /** Repo-relative path — what a failure message should name. */
  rel: string;
  /** Comment-stripped source: a doc comment that MENTIONS a route is not a caller. */
  code: string;
  raw: string;
}

/**
 * Drop block and line comments.
 *
 * Load-bearing for both rules: `src/brand/types.ts` documents the files routes
 * in a comment, and `src/api/healthAssets.ts` documents that `storage_key` is
 * never published. Flagging either would make the guard a nag rather than a
 * contract. The `[^:]` lookbehind stand-in keeps `https://` intact.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function collect(matchTests: boolean): SourceFile[] {
  const out: SourceFile[] = [];
  const isTest = (name: string) => /\.(test|spec)\.[jt]sx?$/.test(name);
  for (const root of CLIENT_ROOTS) {
    const base = path.join(REPO_ROOT, root);
    if (!fs.existsSync(base)) continue;
    const stack = [base];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '__snapshots__') stack.push(full);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
        if (isTest(entry.name) !== matchTests) continue;
        const rel = path.relative(REPO_ROOT, full);
        if (rel === SELF) continue;
        const raw = fs.readFileSync(full, 'utf8');
        out.push({ rel, raw, code: stripComments(raw) });
      }
    }
  }
  return out;
}

/**
 * A module "calls the files surface" if it names the route prefix or one of the
 * client entry points for FILES specifically.
 *
 * `healthAssetsApi` also carries widget preferences and the widget snapshot, so
 * matching the bare object would drag the widget client in here; the file
 * operations are named explicitly instead.
 */
const FILES_CALL =
  /\/health\/files|healthFileContentSource|healthAssetsApi\.(listFiles|getFile|createFileUpload|uploadFile|deleteFile|reserveFile|putFileContent)/;

/** The Worker's own R2 prefix, read from source so it can never drift from ours. */
function fileKeyPrefix(): string {
  const source = fs.readFileSync(WORKER_SERVICE, 'utf8');
  const match = source.match(/export const FILE_KEY_PREFIX = '([^']+)'/);
  if (!match) {
    throw new Error(
      'FILE_KEY_PREFIX not found in health-assets-service.ts — the anchor this guard reads has moved'
    );
  }
  return match[1];
}

describe('HEALTH files — posture guard (R2-backed Worker surface)', () => {
  it('HEALTH-ASSET-095: no client module calls /health/files without a test', () => {
    // The failure this catches: a Files screen (or store, or api module) lands,
    // uploads and deletes BODY PHOTOS, and nothing client-side ever proves the
    // delete fires or that the bytes are not cached to disk. Until 2026-07-26
    // the surface had no caller at all, so this guard was the whole coverage
    // story; the moment a caller appears it must bring its own tests.
    const callers = collect(false).filter((f) => FILES_CALL.test(f.code));
    const tests = collect(true);

    const untested = callers
      .filter((caller) => {
        // A "matching test" is any client test that references the module by
        // name — deliberately loose about HOW it is tested, strict about the
        // module being named somewhere. Anchored on the module basename rather
        // than on the route string, so this guard cannot satisfy its own rule.
        const moduleName = path.basename(caller.rel).replace(/\.[jt]sx?$/, '');
        const needle = new RegExp(`\\b${moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        return !tests.some((t) => needle.test(t.raw));
      })
      .map(
        (c) =>
          `${c.rel} — calls the /health/files surface with NO client test. ` +
          'This is not a flake and not a stale assertion: add a test that names this module ' +
          '(a store test, a screen test, anything that exercises it), or delete the caller. ' +
          'The Worker suite backend/src/routes/__tests__/health-files.test.ts does NOT cover it.'
      );

    expect(untested).toEqual([]);
  });

  it('HEALTH-ASSET-096: the R2 key vocabulary never reaches the files client', () => {
    const prefix = fileKeyPrefix(); // 'health-files', read from the Worker service
    const bucketPath = `${prefix}/`;
    const offenders: string[] = [];

    for (const file of collect(false)) {
      // Scope: the files chain only. `health-files` is ALSO a brand-icon slug
      // and a testID stem (`health-files-screen`), which is why the bucket check
      // matches the KEY shape — prefix + separator — and not the bare word.
      if (!FILES_CALL.test(file.code)) continue;
      if (file.code.includes(bucketPath)) offenders.push(`${file.rel} — builds a ${bucketPath} key`);
      if (/\bstorage_key\b/.test(file.code)) offenders.push(`${file.rel} — handles storage_key`);
      if (/\bthumbnail_key\b/.test(file.code)) {
        offenders.push(`${file.rel} — handles thumbnail_key`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('HEALTH-ASSET-097: the Worker still serves the four /files paths', () => {
    // The anchor. This guard is only meaningful while the surface exists; if the
    // route file loses these registrations, DELETE this file and the backend
    // suite with it rather than weakening either.
    const source = fs.readFileSync(WORKER_ROUTE, 'utf8');
    const handlers = [
      "healthAssets.get('/files'",
      "healthAssets.post('/files'",
      "healthAssets.get('/files/:id'",
      "healthAssets.put('/files/:id/content'",
      "healthAssets.get('/files/:id/content'",
      "healthAssets.delete('/files/:id'",
    ];
    expect(handlers.filter((h) => !source.includes(h))).toEqual([]);

    // …and the proxied read path a client is required to use is still DERIVED by
    // the service, so a client can never be "right" by hardcoding its own.
    const service = fs.readFileSync(WORKER_SERVICE, 'utf8');
    expect(service).toContain('return `/health/files/${fileId}/content`;');
  });
});
