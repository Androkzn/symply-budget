#!/usr/bin/env node
/**
 * normalize-lender-logos.mjs
 *
 * Turns raw lender logo source images into uniform, bundle-ready assets and
 * regenerates the require-map the app renders from. Run:
 *
 *   node scripts/normalize-lender-logos.mjs
 *   npm run logos:lenders
 *
 * INPUTS (either or both):
 *   1. Local files in `scripts/lender-logo-sources/<slug>.<png|svg|jpg|jpeg|webp>`.
 *   2. A manifest `scripts/lender-logos.manifest.mjs` exporting a `{ <slug>: <url> }`
 *      map; each URL is downloaded, then normalized. (See the sample manifest.)
 *
 *   `<slug>` MUST match a lender slug in `src/utils/lender-logos.ts`
 *   (e.g. `td`, `rbc`, `national-bank`). Unknown slugs are skipped with a warning.
 *
 * OUTPUT:
 *   - `src/assets/images/lenders/<slug>.png` — trimmed, letterboxed onto a
 *     transparent square, resized to a uniform box (crisp on all densities).
 *   - `src/utils/lender-logos.generated.ts` — regenerated require-map of exactly
 *     the slugs that produced an asset.
 *
 * IMPORTANT — trademarks: bank names and logos are trademarks of their owners.
 * This script only processes source images YOU provide (locally or via a
 * manifest you populate) and that you are entitled to use. It ships with NO
 * logo sources and downloads nothing on its own.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const SOURCES_DIR = join(REPO, 'scripts', 'lender-logo-sources');
const MANIFEST = join(REPO, 'scripts', 'lender-logos.manifest.mjs');
const REGISTRY = join(REPO, 'src', 'utils', 'lender-logos.ts');
const OUT_DIR = join(REPO, 'src', 'assets', 'images', 'lenders');
const GENERATED = join(REPO, 'src', 'utils', 'lender-logos.generated.ts');

/** Uniform box the logo is fit inside (transparent letterbox, aspect preserved). */
const BOX = 160;
const SUPPORTED = new Set(['.png', '.svg', '.jpg', '.jpeg', '.webp']);

/** Valid slugs = every `slug: '<x>'` in the registry — keeps this script in sync. */
function validSlugs() {
  const src = readFileSync(REGISTRY, 'utf8');
  const set = new Set();
  for (const m of src.matchAll(/slug:\s*'([a-z0-9-]+)'/g)) set.add(m[1]);
  return set;
}

/** { slug -> { kind: 'file'|'url', ref } } from the sources dir + optional manifest. */
async function collectSources() {
  const out = new Map();

  if (existsSync(SOURCES_DIR)) {
    for (const f of readdirSync(SOURCES_DIR)) {
      const ext = extname(f).toLowerCase();
      if (!SUPPORTED.has(ext)) continue;
      const slug = f.slice(0, -ext.length).toLowerCase();
      out.set(slug, { kind: 'file', ref: join(SOURCES_DIR, f) });
    }
  }

  if (existsSync(MANIFEST)) {
    const mod = await import(pathToFileURL(MANIFEST).href);
    const map = mod.LENDER_LOGO_SOURCES ?? mod.default ?? {};
    for (const [slug, url] of Object.entries(map)) {
      if (!url) continue; // null/'' → intentionally skipped (renders a monogram)
      // A local file with the same slug wins over a manifest URL.
      if (!out.has(slug)) out.set(slug.toLowerCase(), { kind: 'url', ref: url });
    }
  }

  return out;
}

async function loadBytes(source) {
  if (source.kind === 'file') return readFileSync(source.ref);
  const res = await fetch(source.ref);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${source.ref}`);
  return Buffer.from(await res.arrayBuffer());
}

async function normalize(bytes, outPath) {
  // Trim uniform borders when possible (logos often ship with padding), then
  // letterbox onto a transparent BOX×BOX square so every tile is identical.
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  let img = sharp(bytes, { density: 384 }); // density helps rasterize SVG crisply
  try {
    img = sharp(await img.trim().toBuffer(), { density: 384 });
  } catch {
    img = sharp(bytes, { density: 384 }); // trim can fail on some inputs — skip it
  }
  await img
    .resize(BOX, BOX, { fit: 'contain', background: transparent })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

function writeGenerated(slugs) {
  const sorted = [...slugs].sort();
  const entries = sorted.length
    ? `${sorted.map((s) => `  '${s}': require('../assets/images/lenders/${s}.png'),`).join('\n')}\n`
    : "  // '<slug>': require('../assets/images/lenders/<slug>.png'),\n";
  const body = `import type { ImageSourcePropType } from 'react-native';

/**
 * GENERATED — do not edit by hand.
 *
 * Written by \`scripts/normalize-lender-logos.mjs\`. Maps a lender slug (see
 * \`POPULAR_LENDERS\` in \`@utils/lender-logos\`) to a bundled, size-normalized
 * wordmark PNG under \`src/assets/images/lenders/\`. Metro requires literal
 * \`require()\` paths, so this map is codegen'd rather than built dynamically —
 * the same reason \`src/brand/icons.generated.ts\` is generated.
 *
 * It starts EMPTY: until you add real logo assets (drop licensed source images
 * into \`scripts/lender-logo-sources/\` and run the normalize script), every
 * lender renders a branded monogram tile via \`<LenderLogo>\`. No third-party
 * logo binaries are committed by default.
 */
export const LENDER_LOGO_ASSETS: Partial<Record<string, ImageSourcePropType>> = {
${entries}};
`;
  writeFileSync(GENERATED, body, 'utf8');
}

/** Slugs that currently have a bundled PNG in the assets dir (source of truth for the map). */
function bundledSlugs() {
  if (!existsSync(OUT_DIR)) return [];
  return readdirSync(OUT_DIR)
    .filter((f) => extname(f).toLowerCase() === '.png')
    .map((f) => f.slice(0, -4));
}

async function main() {
  const known = validSlugs();
  const sources = await collectSources();

  if (sources.size === 0) {
    console.log(
      'No lender logo sources found.\n' +
        `  • Drop images into ${SOURCES_DIR}/<slug>.png (see its README), or\n` +
        `  • populate ${MANIFEST} with { <slug>: <url> } entries.\n` +
        'Lenders without an asset render a branded monogram tile.'
    );
  } else {
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    for (const [slug, source] of sources) {
      if (!known.has(slug)) {
        console.warn(`⚠︎  "${slug}" is not a known lender slug — skipping. Add it to POPULAR_LENDERS first.`);
        continue;
      }
      try {
        const bytes = await loadBytes(source);
        await normalize(bytes, join(OUT_DIR, `${slug}.png`));
        console.log(`✓  ${slug} → src/assets/images/lenders/${slug}.png`);
      } catch (err) {
        console.error(`✗  ${slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Always regenerate the require-map from the PNGs that actually exist, so it is
  // idempotent and self-healing (a deleted asset drops out; nothing goes stale).
  const bundled = bundledSlugs();
  writeGenerated(bundled);
  console.log(
    `\nRegenerated src/utils/lender-logos.generated.ts — ${bundled.length} bundled logo(s).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
