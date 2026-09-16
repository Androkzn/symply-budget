#!/usr/bin/env node
/**
 * generate-icons.mjs — generate brush-style PNG icons for any Symply brand from
 * one unified prompt, then drop them straight into the brand's kit.
 *
 * It is AI-only by design (the vector path was removed): every icon is drawn by
 * an image model in the handcrafted paint-brush style defined once in
 * scripts/icon-gen/brand-prompts.mjs, so all five apps stay in the same family.
 *
 * PIPELINE (per requested slug)
 *   1. Resolve a visual concept (icon-concepts.json, --concept override, or a
 *      generic fallback) and build the brand's brush prompt.
 *   2. Ask the model for a 1024² icon. OpenAI gpt-image-1 returns a genuinely
 *      transparent PNG; Gemini returns white-bg art we key out.
 *   3. Trim to the ink, center on a 96² square (~85% fill) → the `selected` art.
 *   4. Derive `unselected-dark` / `unselected-light` as flat neutral-recolored
 *      silhouettes from the selected alpha (matches the hand-made kits' 3-state
 *      parity that brandIconKits.test enforces).
 *   5. Write into brands/<id>/src/assets/icons/png/{selected,unselected-dark,
 *      unselected-light}/<slug>.png, then optionally rebuild the require-map.
 *
 * USAGE
 *   node scripts/generate-icons.mjs <brand|all> [slug ...] [options]
 *
 *   <brand>            symply-house | symply-budget | symply-kaizen |
 *                      symply-language | symply-health | all
 *   [slug ...]         Explicit slugs to generate (the "per request" set).
 *
 * OPTIONS
 *   --missing          Instead of explicit slugs, generate this brand's gap:
 *                      the ecosystem union (scripts/icon-gen/ecosystem-icon-
 *                      names.json) minus what the brand already ships.
 *   --names <file>     Read slugs from a JSON array / newline / comma file.
 *   --concept "s=desc" Add/override a slug's visual concept (repeatable).
 *   --provider <p>     openai (default) | gemini.
 *   --quality <q>      openai image quality: low|medium|high|auto (default high).
 *   --concurrency <n>  Parallel image requests (default 3).
 *   --force            Overwrite icons that already exist.
 *   --selected-only    Only write the selected state (skip the two neutrals).
 *   --build            Run `APP_BRAND=<brand> npm run icons:build` afterwards
 *                      (House last, to keep the committed default clean).
 *   --out <dir>        Write to <dir>/<state>/<slug>.png instead of the kit.
 *   --print-prompts <f>  Write every resolved prompt to a file and exit (no API
 *                      key needed) — paste them into ChatGPT/Canva by hand.
 *   --sheet [cols x rows]  Print ONE grid-sheet prompt for the whole set and
 *                      exit (for hand-generation + extract-icon-sheet.mjs).
 *   --report <f>       Run report path (default: scripts/icon-gen/last-run.json).
 *   --dry-run          Resolve the set + concepts, write nothing, no API.
 *   --help
 *
 * KEYS (never printed): OPENAI_API_KEY / GEMINI_API_KEY from the environment,
 *   else macOS Keychain (symply.openai.key / symply.gemini.key).
 *
 * EXAMPLES
 *   node scripts/generate-icons.mjs symply-health breathing fasting vo2max
 *   node scripts/generate-icons.mjs symply-language --missing --build
 *   node scripts/generate-icons.mjs symply-budget net-worth cashflow \
 *     --concept "cashflow=a dollar sign with in and out arrows"
 *   node scripts/generate-icons.mjs symply-house --missing --print-prompts prompts.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  BRANDS, ALL_BRAND_IDS, buildIconPrompt, buildSheetPrompt, NEGATIVE_PROMPT,
} from './icon-gen/brand-prompts.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 96;
const CORE_STATES = ['selected', 'unselected-dark', 'unselected-light'];

const NEUTRALS = {
  'symply-house': { dark: '#A7B8B7', light: '#58716F' },
  'symply-budget': { dark: '#92A6A0', light: '#536A63' },
  'symply-kaizen': { dark: '#91A0B7', light: '#51627F' },
  'symply-language': { dark: '#AAA19C', light: '#695F5A' },
  'symply-health': { dark: '#AAA3A4', light: '#695F61' },
};

// ── args ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = {
    brand: null, slugs: [], missing: false, names: null, concepts: {},
    provider: 'openai', quality: 'high', concurrency: 3, force: false,
    selectedOnly: false, build: false, out: null, printPrompts: null,
    sheet: null, report: null, dryRun: false, help: false,
  };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--help': case '-h': o.help = true; break;
      case '--missing': o.missing = true; break;
      case '--names': o.names = next(); break;
      case '--concept': {
        const v = next(); const eq = v.indexOf('=');
        if (eq > 0) o.concepts[v.slice(0, eq).trim()] = v.slice(eq + 1).trim();
        break;
      }
      case '--provider': o.provider = next(); break;
      case '--quality': o.quality = next(); break;
      case '--concurrency': o.concurrency = Math.max(1, parseInt(next(), 10)); break;
      case '--force': o.force = true; break;
      case '--selected-only': o.selectedOnly = true; break;
      case '--build': o.build = true; break;
      case '--out': o.out = next(); break;
      case '--print-prompts': o.printPrompts = next(); break;
      case '--sheet': {
        // optional "4x3" following token
        const peek = argv[i + 1];
        if (peek && /^\d+x\d+$/.test(peek)) { const [c, r] = next().split('x'); o.sheet = { cols: +c, rows: +r }; }
        else o.sheet = { cols: 4, rows: 3 };
        break;
      }
      case '--report': o.report = next(); break;
      case '--dry-run': o.dryRun = true; break;
      default:
        if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`);
        pos.push(a);
    }
  }
  o.brand = pos.shift() || null;
  o.slugs = pos;
  return o;
}

const HELP = `generate-icons.mjs — brush-style PNG icons for any Symply brand.

  node scripts/generate-icons.mjs <brand|all> [slug ...] [--missing]
    [--names file] [--concept "slug=desc"] [--provider openai|gemini]
    [--quality high] [--concurrency 3] [--force] [--selected-only]
    [--build] [--out dir] [--print-prompts file] [--sheet [4x3]]
    [--dry-run]

See the file header for details. Needs OPENAI_API_KEY (or GEMINI_API_KEY) for
real generation; --dry-run / --print-prompts / --sheet need no key.`;

// ── concepts ──────────────────────────────────────────────────────────────────
const CONCEPTS = (() => {
  const raw = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/icon-gen/icon-concepts.json'), 'utf8'));
  delete raw._comment;
  return raw;
})();

function conceptFor(slug, overrides) {
  if (overrides[slug]) return overrides[slug];
  if (CONCEPTS[slug]) return CONCEPTS[slug];
  return `a simple, clear ${slug.replace(/-/g, ' ')} symbol`;
}

// ── slug set resolution ───────────────────────────────────────────────────────
function presentSlugs(brandId) {
  const d = path.join(REPO, 'brands', brandId, 'src/assets/icons/png/selected');
  if (!fs.existsSync(d)) return new Set();
  return new Set(fs.readdirSync(d).filter(f => f.endsWith('.png')).map(f => f.replace(/\.png$/, '')));
}

function loadNamesFile(spec) {
  const raw = fs.readFileSync(spec, 'utf8').trim();
  if (spec.toLowerCase().endsWith('.json')) return JSON.parse(raw);
  return raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
}

function resolveSlugSet(brandId, opts) {
  let slugs = [...opts.slugs];
  if (opts.names) slugs.push(...loadNamesFile(opts.names));
  if (opts.missing) {
    const union = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/icon-gen/ecosystem-icon-names.json'), 'utf8'));
    const have = presentSlugs(brandId);
    slugs.push(...union.filter(n => !have.has(n)));
  }
  slugs = [...new Set(slugs)];
  if (!opts.force && !opts.out) {
    slugs = slugs.filter(s => !fs.existsSync(pngPath(brandId, 'selected', s)));
  }
  return slugs;
}

// ── keys / providers ──────────────────────────────────────────────────────────
function readKey(provider) {
  const envName = provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
  if (process.env[envName]) return process.env[envName];
  // Repo Keychain secret names (see scripts/secrets/*).
  const kc = provider === 'gemini' ? 'symply.gemini.api_key' : 'symply.test.openai';
  try {
    const v = execFileSync('security', ['find-generic-password', '-s', kc, '-w'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (v) return v;
  } catch { /* none */ }
  return null;
}

async function openaiImage(prompt, key, quality) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-image-1', prompt, size: '1024x1024',
      background: 'transparent', output_format: 'png', quality, n: 1,
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error('openai: empty image');
  return Buffer.from(b64, 'base64');
}

async function geminiImage(prompt, key) {
  const model = 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: `${prompt}\n\nNEGATIVE: ${NEGATIVE_PROMPT}` }] }] }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const part = j?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  if (!part) throw new Error('gemini: empty image');
  return Buffer.from(part.inlineData.data, 'base64');
}

// ── image post-processing ─────────────────────────────────────────────────────
const hexToRgb = h => { const n = parseInt(h.replace('#', ''), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; };

/** Raw model image (transparent OR white-bg) → clean 96² RGBA selected art. */
async function keySelected(buf) {
  let img = sharp(buf).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const total = width * height;
  let opaque = 0;
  for (let i = 3; i < data.length; i += channels) if (data[i] > 250) opaque++;
  if (opaque / total > 0.95) {
    // No real alpha → key out a near-white studio background.
    for (let p = 0; p < total; p++) {
      const o = p * channels;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const minc = Math.min(r, g, b), maxc = Math.max(r, g, b);
      if (minc > 232 && maxc - minc < 16) data[o + 3] = 0;
      else if (minc > 205) data[o + 3] = Math.round(((240 - minc) / 35) * 255);
    }
    img = sharp(data, { raw: { width, height, channels } });
  }
  const inner = Math.round(SIZE * 0.85);
  const trimmed = await img.png().trim({ threshold: 10 }).toBuffer().catch(() => img.png().toBuffer());
  const fitted = await sharp(trimmed)
    .resize(inner, inner, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  const m = await sharp(fitted).metadata();
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: fitted, left: Math.round((SIZE - (m.width || inner)) / 2), top: Math.round((SIZE - (m.height || inner)) / 2) }])
    .png().toBuffer();
}

/** Flat neutral-recolored silhouette from the selected alpha (keeps brush edges). */
async function neutralFrom(selectedPng, hex) {
  const { data, info } = await sharp(selectedPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const { r, g, b } = hexToRgb(hex);
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    out[p * 4] = r; out[p * 4 + 1] = g; out[p * 4 + 2] = b; out[p * 4 + 3] = data[p * channels + 3];
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

// ── kit IO ────────────────────────────────────────────────────────────────────
function pngPath(brandId, state, slug, outDir) {
  if (outDir) return path.join(outDir, state, `${slug}.png`);
  return path.join(REPO, 'brands', brandId, 'src/assets/icons/png', state, `${slug}.png`);
}

async function writeIcon(brandId, slug, selected, opts) {
  const states = { selected };
  if (!opts.selectedOnly) {
    states['unselected-dark'] = await neutralFrom(selected, NEUTRALS[brandId].dark);
    states['unselected-light'] = await neutralFrom(selected, NEUTRALS[brandId].light);
  }
  for (const [state, buf] of Object.entries(states)) {
    const p = pngPath(brandId, state, slug, opts.out);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.brand) { console.log(HELP); process.exit(opts.brand ? 0 : 1); }

  const brands = opts.brand === 'all' ? ALL_BRAND_IDS : [opts.brand];
  for (const b of brands) if (!BRANDS[b]) throw new Error(`Unknown brand: ${b} (use ${ALL_BRAND_IDS.join('|')}|all)`);

  const report = { at: null, provider: opts.provider, brands: {} };

  // --- prompt-only modes (no API key needed) ---
  if (opts.printPrompts || opts.sheet) {
    const chunks = [];
    for (const brandId of brands) {
      const slugs = resolveSlugSet(brandId, opts);
      if (!slugs.length) { console.log(`${brandId}: nothing to generate`); continue; }
      const items = slugs.map(s => ({ name: s, concept: conceptFor(s, opts.concepts) }));
      if (opts.sheet) {
        // chunk into grid-sized sheets
        const per = opts.sheet.cols * opts.sheet.rows;
        for (let i = 0; i < items.length; i += per) {
          chunks.push(`\n===== ${brandId} — sheet ${i / per + 1} (${opts.sheet.cols}×${opts.sheet.rows}) =====\n` +
            buildSheetPrompt(brandId, items.slice(i, i + per), opts.sheet));
        }
      } else {
        for (const it of items) chunks.push(`\n===== ${brandId} / ${it.name} =====\n${buildIconPrompt(brandId, it.name, it.concept)}`);
      }
      console.log(`${brandId}: ${slugs.length} prompt(s) prepared`);
    }
    const text = chunks.join('\n');
    if (opts.printPrompts) { fs.writeFileSync(opts.printPrompts, text + '\n'); console.log(`\n✓ prompts → ${opts.printPrompts}`); }
    else console.log(text);
    return;
  }

  // --- dry run ---
  if (opts.dryRun) {
    for (const brandId of brands) {
      const slugs = resolveSlugSet(brandId, opts);
      console.log(`\n${brandId}: would generate ${slugs.length}`);
      for (const s of slugs.slice(0, 40)) console.log(`  ${s} — ${conceptFor(s, opts.concepts)}`);
      if (slugs.length > 40) console.log(`  … +${slugs.length - 40} more`);
    }
    console.log('\n(dry run — no API calls, nothing written)');
    return;
  }

  // --- real generation (needs a key) ---
  const key = readKey(opts.provider);
  if (!key) {
    console.error(
      `✗ No ${opts.provider} API key found (env ${opts.provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'} ` +
      `or Keychain ${opts.provider === 'gemini' ? 'symply.gemini.api_key' : 'symply.test.openai'}).\n` +
      `  Set one, or use --print-prompts <file> / --sheet to hand-generate, or --dry-run to preview.`);
    process.exit(1);
  }
  const imageFn = opts.provider === 'gemini'
    ? (prompt) => geminiImage(prompt, key)
    : (prompt) => openaiImage(prompt, key, opts.quality);

  for (const brandId of brands) {
    const slugs = resolveSlugSet(brandId, opts);
    const br = { requested: slugs.length, ok: 0, failed: 0, icons: [] };
    console.log(`\n${brandId}: generating ${slugs.length} icon(s) via ${opts.provider}…`);
    if (!slugs.length) { report.brands[brandId] = br; continue; }

    await mapLimit(slugs, opts.concurrency, async (slug) => {
      const concept = conceptFor(slug, opts.concepts);
      try {
        const raw = await imageFn(buildIconPrompt(brandId, slug, concept));
        const selected = await keySelected(raw);
        await writeIcon(brandId, slug, selected, opts);
        br.ok++; br.icons.push({ slug, concept, ok: true });
        console.log(`  ✓ ${slug}`);
      } catch (err) {
        br.failed++; br.icons.push({ slug, concept, ok: false, error: String(err.message || err).slice(0, 160) });
        console.warn(`  ✗ ${slug}: ${String(err.message || err).slice(0, 140)}`);
      }
    });
    report.brands[brandId] = br;
    console.log(`  ${brandId}: ${br.ok} ok, ${br.failed} failed`);
  }

  const reportPath = opts.report || path.join(REPO, 'scripts/icon-gen/last-run.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nReport → ${path.relative(REPO, reportPath)}`);

  if (opts.build && !opts.out) {
    const order = [...brands.filter(b => b !== 'symply-house'), ...(brands.includes('symply-house') ? ['symply-house'] : [])];
    for (const brandId of order) {
      console.log(`\n$ APP_BRAND=${brandId} npm run icons:build`);
      execFileSync('npm', ['run', 'icons:build'], { cwd: REPO, stdio: 'inherit', env: { ...process.env, APP_BRAND: brandId } });
    }
  }

  const failed = Object.values(report.brands).reduce((n, b) => n + b.failed, 0);
  console.log(failed ? `\n⚠ done with ${failed} failure(s)` : '\n✓ done');
  process.exit(failed ? 2 : 0);
}

main().catch(err => { console.error(err.stack || String(err)); process.exit(1); });
