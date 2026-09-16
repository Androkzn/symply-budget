/**
 * Real test-document fixtures for the Workers (workerd) test runtime.
 *
 * The shared disk resolver (e2e/fixtures/index.js) reads files with Node `fs`,
 * which cannot run inside workerd here: the repo path contains spaces and
 * workerd's fs proxy mangles them to `%20`, so every read fails (the same
 * known issue the jpeg-js/upng-js aliases work around in vitest.config.ts).
 *
 * Instead, the real bytes are read from disk in the Vite/Node host process by
 * the `symply-fixtures` plugin (see vitest.config.ts) and inlined as base64
 * into the worker bundle. This module decodes them back into the Buffer /
 * ArrayBuffer / File / string shapes the tests need — same real documents from
 * resourses/testing/, just delivered without an in-worker disk read.
 *
 * Only a curated set of SMALL fixtures is inlined (see FIXTURE_KEYS in the
 * plugin); the 25MB inspection report and 8MB book are intentionally excluded.
 */
// @ts-expect-error - virtual module provided by the symply-fixtures Vite plugin
import FIXTURES from 'virtual:symply-fixtures';

interface InlineFixture {
  name: string;
  mime: string;
  base64: string;
}

const table = FIXTURES as Record<string, InlineFixture>;

function get(key: string): InlineFixture {
  const entry = table[key];
  if (!entry) {
    throw new Error(
      `Fixture "${key}" is not inlined for the worker runtime. ` +
        `Inlined keys: ${Object.keys(table).join(', ')}. ` +
        `Add it to FIXTURE_KEYS in backend/vitest.config.ts.`
    );
  }
  return entry;
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Raw bytes as a Uint8Array (Buffer-like; accepted by R2 puts and File). */
export function fixtureBytes(key: string): Uint8Array {
  return decodeBase64(get(key).base64);
}

/** Bytes as a fresh ArrayBuffer (for services that take ArrayBuffer). */
export function fixtureArrayBuffer(key: string): ArrayBuffer {
  const u = fixtureBytes(key);
  const copy = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
  return copy instanceof ArrayBuffer ? copy : new Uint8Array(u).buffer;
}

/** UTF-8 text (for .txt fixtures). */
export function fixtureText(key: string): string {
  return new TextDecoder('utf-8').decode(fixtureBytes(key));
}

/** A web `File` for multipart FormData uploads. */
export function fixtureFile(key: string): File {
  const entry = get(key);
  return new File([fixtureBytes(key)], entry.name, { type: entry.mime });
}

export default { fixtureBytes, fixtureArrayBuffer, fixtureText, fixtureFile };
