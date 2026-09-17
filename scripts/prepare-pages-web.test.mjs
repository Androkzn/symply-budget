import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePagesWeb } from './prepare-pages-web.mjs';

test('preserves Expo asset URLs and existing routing, idempotently', async () => {
  const output = await mkdtemp(join(tmpdir(), 'pages-assets-test-'));
  const folder = join(output, 'assets/node_modules/@expo/icons');
  await mkdir(folder, { recursive: true });
  await writeFile(join(output, 'index.html'), '<html></html>');
  await writeFile(join(folder, 'Ionicons.ttf'), new Uint8Array([0, 1, 0, 0, 10]));
  await writeFile(join(output, '_redirects'), '/old /new 302\n');
  await preparePagesWeb(output);
  await preparePagesWeb(output);
  assert.deepEqual(await readFile(join(output, 'assets/vendor/@expo/icons/Ionicons.ttf')), await readFile(join(folder, 'Ionicons.ttf')));
  const rules = await readFile(join(output, '_redirects'), 'utf8');
  assert.equal(rules, '/assets/node_modules/* /assets/vendor/:splat 200\n/old /new 302\n');
});
test('requires an explicit Expo export directory', async () => {
  await assert.rejects(preparePagesWeb(), /Usage/);
  const empty = await mkdtemp(join(tmpdir(), 'pages-empty-test-'));
  await assert.rejects(preparePagesWeb(empty), /ENOENT/);
});
