/**
 * Framework-agnostic accessor for the real test-document fixtures.
 *
 * Single resolver shared by Jest (app), Vitest (backend), node:test / tsx
 * (backend-language), the Maestro seed script, and the backend shell
 * integration scripts. Plain CommonJS (no TS syntax, no transform needed) so
 * every runner can `require`/`import` it by relative path.
 *
 * Binaries are NOT committed — they live in resourses/testing/ and are read
 * from disk on demand. `name` is the sanitized filename (see manifest.json).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const manifest = require('./manifest.json');

/** @type {Array<Record<string, any>>} */
const FIXTURES = manifest.fixtures;
const BY_KEY = new Map(FIXTURES.map((f) => [f.key, f]));

function resolve(key) {
  const entry = BY_KEY.get(key);
  if (!entry) {
    const known = FIXTURES.map((f) => f.key).join(', ');
    throw new Error(`Unknown fixture "${key}". Known keys: ${known}`);
  }
  const absPath = path.join(REPO_ROOT, entry.source);
  return {
    key: entry.key,
    app: entry.app,
    name: entry.name,
    mime: entry.mime,
    kind: entry.kind,
    targets: entry.targets || [],
    source: entry.source,
    absPath,
    uri: 'file://' + absPath,
  };
}

/** Full metadata for a fixture (does not read the file). */
function fixture(key) {
  return resolve(key);
}

/** All fixtures, optionally filtered by app ('house' | 'budget' | 'kaizen'). */
function listFixtures(app) {
  const items = FIXTURES.map((f) => resolve(f.key));
  return app ? items.filter((f) => f.app === app) : items;
}

/** Fixtures a given upload target/flow consumes (e.g. 'budget-receipt-scan'). */
function fixturesFor(target) {
  return listFixtures().filter((f) => f.targets.includes(target));
}

function assertExists(key) {
  const f = resolve(key);
  if (!fs.existsSync(f.absPath)) {
    throw new Error(
      `Fixture "${key}" missing on disk at ${f.absPath}. Expected the source ` +
        `document in resourses/testing/ (see e2e/fixtures/manifest.json).`,
    );
  }
  return f;
}

/** Raw bytes as a Node Buffer. */
function fixtureBytes(key) {
  return fs.readFileSync(assertExists(key).absPath);
}

/** UTF-8 text (for .txt fixtures). */
function fixtureText(key) {
  return fs.readFileSync(assertExists(key).absPath, 'utf8');
}

/** Bytes as an ArrayBuffer (for services that take ArrayBuffer / R2 puts). */
function fixtureArrayBuffer(key) {
  const buf = fixtureBytes(key);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * A web `File` built from the fixture (Node 20+ global File/Blob) — for
 * multipart route tests that append a real document to FormData.
 */
function fixtureFile(key) {
  const f = resolve(key);
  const bytes = fixtureBytes(key);
  return new File([bytes], f.name, { type: f.mime });
}

/** The shape expo-document-picker / image picker mocks should return. */
function pickerAsset(key) {
  const f = assertExists(key);
  return {
    uri: f.uri,
    name: f.name,
    mimeType: f.mime,
    size: fs.statSync(f.absPath).size,
  };
}

module.exports = {
  REPO_ROOT,
  fixture,
  listFixtures,
  fixturesFor,
  fixtureBytes,
  fixtureText,
  fixtureArrayBuffer,
  fixtureFile,
  pickerAsset,
  assertExists,
};
