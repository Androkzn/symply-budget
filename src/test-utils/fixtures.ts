/**
 * Real upload fixtures for the app Jest suites.
 *
 * Re-exports the framework-agnostic resolver in `e2e/fixtures` (plain CommonJS +
 * Node `fs`) so tests can feed REAL documents (resourses/testing) through mocked
 * pickers and text readers instead of hand-rolled fake URIs / inline strings.
 * See e2e/fixtures/manifest.json for the manifest of available keys.
 */
 
const fixtures = require('../../e2e/fixtures');

export const {
  fixture,
  pickerAsset,
  fixtureText,
  fixtureBytes,
  fixtureArrayBuffer,
  fixtureFile,
  listFixtures,
} = fixtures as typeof import('../../e2e/fixtures');
