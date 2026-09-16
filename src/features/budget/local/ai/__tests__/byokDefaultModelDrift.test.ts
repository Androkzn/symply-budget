import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The device-side BYOK clients keep their own DEFAULT_MODEL map — they call the
 * provider directly from the member's key and cannot reach the server resolver.
 * That second copy silently rots: on 2026-08-14 `gemini-2.0-flash` returned
 * "This model is no longer available", and `gpt-4o-mini` was not in the catalog
 * at all. Both surfaced to the member as a failed receipt scan.
 *
 * The backend catalog is the maintained source of truth, so pin the clients to
 * it by text rather than by import (the mobile tsconfig excludes backend/**).
 */
const ROOT = join(__dirname, '../../../../../..');

function readVendorModelIds(): Set<string> {
  const catalog = readFileSync(join(ROOT, 'backend/src/ai/model-catalog.ts'), 'utf8');
  const ids = [...catalog.matchAll(/vendorModelId:\s*'([^']+)'/g)].map((m) => m[1]);
  return new Set(ids);
}

function readDefaultModels(relPath: string): Record<string, string> {
  const src = readFileSync(join(ROOT, relPath), 'utf8');
  const block = src.match(/const DEFAULT_MODEL: Record<AIProviderId, string> = \{([\s\S]*?)\};/);
  if (!block) throw new Error(`DEFAULT_MODEL not found in ${relPath}`);
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/(\w+):\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

const CLIENTS = [
  'src/features/budget/local/ai/localByokClient.ts',
  'src/features/house/local/ai/houseByokClient.ts',
];

describe('BYOK client default models track the backend catalog', () => {
  const vendorIds = readVendorModelIds();

  it('the catalog itself parses and has entries', () => {
    expect(vendorIds.size).toBeGreaterThan(0);
  });

  it.each(CLIENTS)('%s defaults are all real vendor model ids', (relPath) => {
    const defaults = readDefaultModels(relPath);
    expect(Object.keys(defaults).sort()).toEqual(['anthropic', 'gemini', 'openai']);

    for (const [provider, modelId] of Object.entries(defaults)) {
      // A default that is not in the catalog is a 404 on every offline call.
      expect({ provider, modelId, known: vendorIds.has(modelId) }).toEqual({
        provider,
        modelId,
        known: true,
      });
    }
  });

  it.each(CLIENTS)('%s never falls back to a retired id', (relPath) => {
    const defaults = readDefaultModels(relPath);
    // Retired 2026-08-14 / 2026-06-15 respectively — both shipped as defaults.
    expect(Object.values(defaults)).not.toContain('gemini-2.0-flash');
    expect(Object.values(defaults)).not.toContain('claude-sonnet-4-20250514');
  });

  it('both clients agree — one app must not silently use a different model', () => {
    const [budget, house] = CLIENTS.map(readDefaultModels);
    expect(budget).toEqual(house);
  });
});
